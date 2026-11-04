import {
  UPDATE_SOURCE_DEFS,
  buildAssetUrl,
  probeUpdateSources,
  rankSourcesByLatency,
  type UpdateSourceDef,
} from '@mplayer/core';
import type { File as ExpoFile } from 'expo-file-system';

/** 移动端应用更新服务（#262/#263/#725）：latest.yml 取版本号，失败回落 GitHub Releases API。 */

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

/** 发布资产命名（#725）：APK 与 .apk.md5 同名前缀。 */
export function apkAssetName(version: string): string {
  return `MPlayer-v${version}.apk`;
}

export function checksumAssetName(version: string): string {
  return `${apkAssetName(version)}.md5`;
}

/** 旧 release 无 .apk.md5 时的浏览器兜底直链（#725）：与检查更新同一拼装规则。 */
export function browserFallbackUrl(version: string): string {
  return buildAssetUrl(UPDATE_SOURCE_DEFS[0], apkAssetName(version));
}

/**
 * 下载校验的通道顺序（#725）：手动置顶所选源，auto 用静态兜底顺序。
 * 检查更新的 auto 走测速排序，两处不共用一份顺序（见 resolveAttemptOrder）。
 */
export function orderSourcesForChannel(channel: string): readonly UpdateSourceDef[] {
  const chosen = UPDATE_SOURCE_DEFS.find((s) => s.id === channel);
  return chosen ? [chosen, ...UPDATE_SOURCE_DEFS.filter((s) => s.id !== chosen.id)] : UPDATE_SOURCE_DEFS;
}

const PROBE_TTL_MS = 10 * 60 * 1000;

let probeCache: { at: number; results: Map<string, number | null> } | null = null;

/** 重试时丢弃测速缓存（#725）：让 auto 通道重新探测，不复用上一轮已试完的顺序。 */
export function clearSpeedProbeCache(): void {
  probeCache = null;
}

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

/** 从 latest.yml 抽 semver（#262）。 */
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

export async function speedTestChannels(timeoutMs = 5000): Promise<ChannelSpeedResult[]> {
  const results = await probeUpdateSources((url, init) => fetch(url, init), { timeoutMs });
  probeCache = { at: Date.now(), results };
  const ranked = rankSourcesByLatency(UPDATE_SOURCE_DEFS, results);
  return ranked.map(def => ({ id: def.id, label: def.label, latencyMs: results.get(def.id) ?? null }));
}

/** 检查更新的尝试顺序（#262）：auto 走测速排序，与下载校验的静态顺序不同。 */
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

/** 检查最新版本（#262）：镜像链取版本号，失败回落 GitHub Releases API。 */
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

/** 解析 md5sum 兼容行（#725）：首个 32 位 hex 归一为小写；取不到返回 null。 */
export function parseExpectedMd5(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([0-9a-fA-F]{32})\s+\S+/.exec(line);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/** MD5 比对（#725）：归一大小写，缺实际哈希一律判不符。 */
export function md5Matches(expected: string, actual: string | null | undefined): boolean {
  return !!actual && expected.toLowerCase() === actual.toLowerCase();
}

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

/** 失败分类（#725）：只有 MD5 不符才叫「文件损坏」，其余各报各的。 */
export type ApkVerifyFailureKind =
  | 'corrupt'
  | 'checksum-unavailable'
  | 'download-failed'
  | 'info-failed'
  | 'unavailable';

const FAILURE_MESSAGES: Record<ApkVerifyFailureKind, string> = {
  corrupt: '下载文件损坏，请换通道重试',
  'checksum-unavailable': '发布包缺少 .apk.md5 校验文件，无法核对安装包完整性',
  'download-failed': '安装包下载失败，请检查网络后重试',
  'info-failed': '读取安装包信息失败，请重试或换通道',
  unavailable: '未能完成安装包校验，请换通道后重试',
};

/** 全通道失败的真实原因（#725）：取不到校验值/下载失败/读取失败不冒充文件损坏。 */
export function classifyVerifyFailure(attempts: readonly ApkAttempt[]): ApkVerifyFailureKind {
  if (attempts.some((a) => a.status === 'md5-mismatch')) return 'corrupt';
  if (attempts.length > 0 && attempts.every((a) => a.status === 'checksum-unavailable')) return 'checksum-unavailable';
  if (attempts.length > 0 && attempts.every((a) => a.status === 'download-failed')) return 'download-failed';
  if (attempts.length > 0 && attempts.every((a) => a.status === 'info-failed')) return 'info-failed';
  return 'unavailable';
}

/** 全通道校验失败（#725）：按真实原因给可读错误，带逐通道报告供设置页显示。 */
export class ApkIntegrityError extends Error {
  readonly attempts: ApkAttempt[];
  readonly kind: ApkVerifyFailureKind;
  constructor(attempts: ApkAttempt[], kind: ApkVerifyFailureKind = 'corrupt') {
    super(FAILURE_MESSAGES[kind]);
    this.name = 'ApkIntegrityError';
    this.attempts = attempts;
    this.kind = kind;
  }
}

export interface ApkDownloadCallbacks {
  onAttempt?: (attempt: ApkAttempt) => void;
  onProgress?: (ratio: number) => void;
}

/** 删缓存文件不留坏包；删除失败不影响换源。 */
function removeQuietly(file: ExpoFile): void {
  try { file.delete(); } catch { /* 缓存目录由系统回收 */ }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 应用内下载 + 校验（#725）：按通道顺序取 .apk.md5 与 APK，不符即删包换下一通道。 */
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
      record({ sourceId: def.id, sourceLabel: def.label, expectedMd5: null, actualMd5: null, sizeBytes: null, status: 'checksum-unavailable', message: '取不到 .apk.md5 校验文件，已换下一通道' });
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
      record({ sourceId: def.id, sourceLabel: def.label, expectedMd5, actualMd5: null, sizeBytes: null, status: 'download-failed', message: `下载失败：${errorMessage(e)}，已换下一通道` });
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
      record({ sourceId: def.id, sourceLabel: def.label, expectedMd5, actualMd5: null, sizeBytes: null, status: 'info-failed', message: `读取文件信息失败：${errorMessage(e)}，已换下一通道` });
      continue;
    }

    if (!md5Matches(expectedMd5, actualMd5)) {
      removeQuietly(file);
      record({ sourceId: def.id, sourceLabel: def.label, expectedMd5, actualMd5, sizeBytes, status: 'md5-mismatch', message: 'MD5 不符，文件损坏，已换下一通道' });
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
  throw new ApkIntegrityError(attempts, classifyVerifyFailure(attempts));
}

export const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
export const APK_MIME_TYPE = 'application/vnd.android.package-archive';

/** 交给系统安装器（#725）：调用方只在人工核对 ApkVerifyReport 之后调用。 */
export async function launchApkInstaller(file: ExpoFile): Promise<void> {
  const IntentLauncher = await import('expo-intent-launcher');
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    type: APK_MIME_TYPE,
    data: file.contentUri,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}
