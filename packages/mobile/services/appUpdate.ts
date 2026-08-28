import {
  UPDATE_SOURCE_DEFS,
  buildAssetUrl,
  probeUpdateSources,
  rankSourcesByLatency,
  type UpdateSourceDef,
} from '@mplayer/core';

/**
 * 移动端应用更新服务（#262/#263）。
 * 与桌面端同源的通道设计：镜像在前、GitHub 直连垫底；
 * auto 通道按测速延迟择优；检查元数据优先走镜像 latest.yml，
 * 全链失败再回落 GitHub Releases API。
 */

export interface ChannelSpeedResult {
  id: string;
  label: string;
  latencyMs: number | null;
}

export interface ReleaseCheckResult {
  state: 'available' | 'not-available';
  version?: string;
  releaseNotes?: string;
  /** 按当前通道解析出的 APK 直链（镜像前缀或原生地址） */
  apkUrl?: string;
  sourceLabel?: string;
  /**
   * #263：目标 ≥1.7.2 且当前 ≤1.7.1 时为 true——
   * 旧版是 release.keystore 引入前的 debug 签名构建，覆盖安装必被拒，
   * 需要引导用户卸载重装。
   */
  needsUninstallMigration?: boolean;
}

const PROBE_TTL_MS = 10 * 60 * 1000;

let probeCache: { at: number; results: Map<string, number | null> } | null = null;

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map(Number);
  const pb = b.replace(/^v/i, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/** electron-updater 的 latest.yml 里抽 semver（meta 信息与 Android 无关） */
export function parseYmlVersion(text: string): string | null {
  const m = text.match(/^version:\s*v?(\d+\.\d+\.\d+)\s*$/m);
  return m ? m[1] : null;
}

/** debug→release 跨签名边界判定（#263）：≤1.7.1 升级到 ≥1.7.2 */
export function needsUninstallGuidance(from: string, to: string): boolean {
  return compareVersions(from, '1.7.1') <= 0 && compareVersions(to, '1.7.2') >= 0;
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 并发测速全部源；结果进程内缓存 10 分钟 */
export async function speedTestChannels(timeoutMs = 5000): Promise<ChannelSpeedResult[]> {
  const results = await probeUpdateSources((url, init) => fetch(url, init), { timeoutMs });
  probeCache = { at: Date.now(), results };
  const ranked = rankSourcesByLatency(UPDATE_SOURCE_DEFS, results);
  return ranked.map(def => ({ id: def.id, label: def.label, latencyMs: results.get(def.id) ?? null }));
}

/**
 * 计算本轮尝试顺序（与桌面端语义一致）：
 * 手动通道置顶所选源；auto 用测速缓存/即时探测排序；全不可用回落静态顺序。
 */
async function resolveAttemptOrder(channel: string, timeoutMs: number): Promise<readonly UpdateSourceDef[]> {
  if (channel !== 'auto') {
    const chosen = UPDATE_SOURCE_DEFS.find(s => s.id === channel);
    if (chosen) return [chosen, ...UPDATE_SOURCE_DEFS.filter(s => s.id !== chosen.id)];
    return UPDATE_SOURCE_DEFS;
  }
  let results: Map<string, number | null>;
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) {
    results = probeCache.results;
  } else {
    results = await probeUpdateSources((url, init) => fetch(url, init), { timeoutMs });
    probeCache = { at: Date.now(), results };
  }
  if ([...results.values()].some(v => v != null)) {
    return rankSourcesByLatency(UPDATE_SOURCE_DEFS, results);
  }
  return UPDATE_SOURCE_DEFS;
}

/** 依次尝试各源 latest.yml 取最新版本号；全部失败抛错由调用方走 API 兜底 */
async function versionFromMirrors(order: readonly UpdateSourceDef[], timeoutMs: number) {
  for (const def of order) {
    try {
      const text = await fetchText(buildAssetUrl(def, 'latest.yml'), timeoutMs);
      const version = parseYmlVersion(text);
      if (!version) throw new Error('latest.yml 格式异常');
      return { def, version };
    } catch { /* 降级下一源 */ }
  }
  return null;
}

/**
 * 检查最新版本：
 * 1. 按通道顺序逐源拉 `latest.yml`（几百字节，国内经镜像秒回）拿版本号
 * 2. 镜像链全失败 → GitHub Releases API 直连兜底（旧路径，携带富 releaseNotes）
 * 有新版时附带按获胜源拼装的 APK 直链；notes 在镜像路径下尽力补取（不阻塞结果）。
 */
export async function checkLatestRelease(currentVersion: string, channel: string): Promise<ReleaseCheckResult> {
  const order = await resolveAttemptOrder(channel, 5000);

  const mirrorHit = await versionFromMirrors(order, 8000);
  if (!mirrorHit) {
    // 兜底：GitHub Releases API 直连（镜像链全失败时的旧路径），携带富 releaseNotes
    const res = await fetchText('https://api.github.com/repos/fuzz1og/mplayer/releases/latest', 10000);
    const latest = JSON.parse(res) as { tag_name?: string; body?: string };
    if (!latest.tag_name) return { state: 'not-available' };
    const apiVersion = latest.tag_name.replace(/^v/i, '');
    if (compareVersions(currentVersion, apiVersion) >= 0) return { state: 'not-available' };
    const githubDef = UPDATE_SOURCE_DEFS.find(d => d.id === 'github')!;
    return {
      state: 'available',
      version: apiVersion,
      releaseNotes: latest.body || '',
      apkUrl: buildAssetUrl(githubDef, `MPlayer-v${apiVersion}.apk`),
      sourceLabel: githubDef.label,
      needsUninstallMigration: needsUninstallGuidance(currentVersion, apiVersion),
    };
  }

  const { def: winningDef, version } = mirrorHit;
  if (compareVersions(currentVersion, version) >= 0) return { state: 'not-available' };

  // 富文本 releaseNotes 尽力补取：latest.yml 没有 notes，直连 API 短超时拿一下，拿不到不影响主流程
  let releaseNotes = '';
  try {
    const apiRes = await fetchText('https://api.github.com/repos/fuzz1og/mplayer/releases/latest', 4000);
    releaseNotes = (JSON.parse(apiRes) as { body?: string }).body || '';
  } catch { /* notes 可选 */ }

  return {
    state: 'available',
    version,
    releaseNotes,
    apkUrl: buildAssetUrl(winningDef, `MPlayer-v${version}.apk`),
    sourceLabel: winningDef.label,
    needsUninstallMigration: needsUninstallGuidance(currentVersion, version),
  };
}
