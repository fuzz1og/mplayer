import {
  UPDATE_SOURCE_DEFS,
  buildAssetUrl,
  probeUpdateSources,
  rankSourcesByLatency,
  type UpdateSourceDef,
} from '@mplayer/core';
import type { File as ExpoFile } from 'expo-file-system';

/**
 * 移动端应用更新服务（#262/#263）。
 * 与桌面端同源的通道设计：镜像在前、GitHub 直连垫底；auto 通道按测速延迟择优；检查元数据优先走镜像 
 * latest.yml，全链失败再回落 GitHub Releases API。
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

/** 发布资产命名（#725）：APK 与 .apk.md5 同名前缀，四个更新源按 buildAssetUrl 同一规则拼接。 */
export function apkAssetName(version: string): string {
  return `MPlayer-v${version}.apk`;
}

export function checksumAssetName(version: string): string {
  return `${apkAssetName(version)}.md5`;
}

/**
 * 通道顺序（#725）：手动通道置顶所选源，其余按静态兜底顺序；auto 沿用静态顺序。
 * 检查更新与下载校验共用一份，避免同一通道在两处被理解成不同顺序。
 */
export function orderSourcesForChannel(channel: string): readonly UpdateSourceDef[] {
  const chosen = UPDATE_SOURCE_DEFS.find((s) => s.id === channel);
  return chosen ? [chosen, ...UPDATE_SOURCE_DEFS.filter((s) => s.id !== chosen.id)] : UPDATE_SOURCE_DEFS;
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
  if (channel !== 'auto') return orderSourcesForChannel(channel);
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
 * 检查最新版本：1. 按通道顺序逐源拉 `latest.yml`（几百字节，国内经镜像秒回）拿版本号 2. 镜像链全失
 * 败 → GitHub Releases API 直连兜底（旧路径，携带富 releaseNotes）有新版时附带按获胜源拼装的 APK 
 * 直链；notes 在镜像路径下尽力补取（不阻塞结果）。
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
      apkUrl: buildAssetUrl(githubDef, apkAssetName(apiVersion)),
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
    apkUrl: buildAssetUrl(winningDef, apkAssetName(version)),
    sourceLabel: winningDef.label,
    needsUninstallMigration: needsUninstallGuidance(currentVersion, version),
  };
}

/** 解析发布侧 md5sum 兼容行（#725）：取首个 32 位 hex 并归一为小写；取不到返回 null。 */
export function parseExpectedMd5(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([0-9a-fA-F]{32})\s+\S+/.exec(line);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/** MD5 比对（#725）：实际哈希缺失或大小写差异都在这里归一，绝不把坏包放行到安装器。 */
export function md5Matches(expected: string, actual: string | null | undefined): boolean {
  return !!actual && expected.toLowerCase() === actual.toLowerCase();
}

/** 设置页给人工核对的字节数文案（#725）：≥1MB 用 MB 两位小数。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '未知';
  if (bytes < 1024 * 1024) return `${bytes} B`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export type ApkAttemptStatus = 'ok' | 'checksum-unavailable' | 'download-failed' | 'info-failed' | 'md5-mismatch';

export interface ApkAttempt {
  sourceId: string;
  sourceLabel: string;
  expectedMd5: string | null;
  actualMd5: string | null;
  sizeBytes: number | null;
  status: ApkAttemptStatus;
  message: string;
}

export interface ApkVerifyReport {
  file: ExpoFile;
  sizeBytes: number;
  expectedMd5: string;
  actualMd5: string;
  sourceId: string;
  sourceLabel: string;
  attempts: ApkAttempt[];
}

/** 全通道校验失败（#725）：带每通道报告供设置页显示预期/实际哈希，不交给安装器。 */
export class ApkIntegrityError extends Error {
  readonly attempts: ApkAttempt[];
  constructor(attempts: ApkAttempt[]) {
    super('下载文件损坏，请换通道重试');
    this.name = 'ApkIntegrityError';
    this.attempts = attempts;
  }
}

export interface ApkDownloadCallbacks {
  onAttempt?: (attempt: ApkAttempt) => void;
  onProgress?: (ratio: number) => void;
}

/** 删缓存文件不留坏包；删除失败由系统回收缓存目录兜底。 */
function removeQuietly(file: ExpoFile): void {
  try { file.delete(); } catch { /* 缓存目录由系统回收 */ }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 应用内下载 + 校验（#725）：按通道顺序取 .apk.md5 与 APK，原生 info({ md5: true }) 算哈希和大小，
 * 不符即删文件换下一通道；全部失败抛 ApkIntegrityError。55MB 不进 JS，坏包不交给安装器。
 */
export async function downloadAndVerifyApk(
  version: string,
  channel: string,
  callbacks: ApkDownloadCallbacks = {},
): Promise<ApkVerifyReport> {
  const { File, Paths } = await import('expo-file-system');
  const attempts: ApkAttempt[] = [];
  const record = (attempt: ApkAttempt): void => {
    attempts.push(attempt);
    callbacks.onAttempt?.(attempt);
  };

  for (const def of orderSourcesForChannel(channel)) {
    let expectedMd5: string | null = null;
    try {
      expectedMd5 = parseExpectedMd5(await fetchText(buildAssetUrl(def, checksumAssetName(version)), 8000));
    } catch { /* 该通道取不到校验值，换下一通道 */ }
    if (!expectedMd5) {
      record({ sourceId: def.id, sourceLabel: def.label, expectedMd5: null, actualMd5: null, sizeBytes: null, status: 'checksum-unavailable', message: '取不到 .apk.md5 校验文件' });
      continue;
    }

    const file = new File(Paths.cache, `mplayer-update-${def.id}.apk`);
    try {
      await File.downloadFileAsync(buildAssetUrl(def, apkAssetName(version)), file, {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (totalBytes > 0) callbacks.onProgress?.(Math.min(1, bytesWritten / totalBytes));
        },
      });
    } catch (e) {
      removeQuietly(file);
      record({ sourceId: def.id, sourceLabel: def.label, expectedMd5, actualMd5: null, sizeBytes: null, status: 'download-failed', message: `下载失败：${errorMessage(e)}` });
      continue;
    }

    let actualMd5: string | null = null;
    let sizeBytes: number | null = null;
    try {
      const info = file.info({ md5: true });
      actualMd5 = info.md5 ?? null;
      sizeBytes = info.size ?? null;
    } catch (e) {
      removeQuietly(file);
      record({ sourceId: def.id, sourceLabel: def.label, expectedMd5, actualMd5: null, sizeBytes: null, status: 'info-failed', message: `读取文件信息失败：${errorMessage(e)}` });
      continue;
    }

    if (!md5Matches(expectedMd5, actualMd5)) {
      removeQuietly(file);
      record({ sourceId: def.id, sourceLabel: def.label, expectedMd5, actualMd5, sizeBytes, status: 'md5-mismatch', message: '下载文件损坏（MD5 不符）' });
      continue;
    }

    record({ sourceId: def.id, sourceLabel: def.label, expectedMd5, actualMd5, sizeBytes, status: 'ok', message: '校验通过' });
    return {
      file,
      sizeBytes: sizeBytes ?? 0,
      expectedMd5,
      actualMd5: actualMd5!,
      sourceId: def.id,
      sourceLabel: def.label,
      attempts,
    };
  }
  throw new ApkIntegrityError(attempts);
}

/** Intent.FLAG_GRANT_READ_URI_PERMISSION（#725）：把 contentUri 的读权限交给系统安装器。 */
export const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
export const APK_MIME_TYPE = 'application/vnd.android.package-archive';

/**
 * 校验通过后交给系统安装器（#725）：ACTION_VIEW + APK MIME + contentUri，
 * 带 FLAG_GRANT_READ_URI_PERMISSION；调用方只在拿到 ApkVerifyReport 后调用。
 */
export async function launchApkInstaller(file: ExpoFile): Promise<void> {
  const IntentLauncher = await import('expo-intent-launcher');
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    type: APK_MIME_TYPE,
    data: file.contentUri,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}
