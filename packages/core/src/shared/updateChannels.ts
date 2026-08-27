/**
 * 应用更新通道常量与工具（#262/#263）——桌面端 electron-updater 与移动端 APK 直链共享。
 *
 * 设计要点：
 * - 镜像在前、GitHub 直连垫底：国内直连 github.com 不稳定，直连只作最后兜底。
 * - 镜像是「URL 前缀」型代理（gh-proxy 系），前缀拼接 releases/latest/download/<file>
 *   即得固定资产地址（302 到最新 release，跨版本有效），元数据与安装包同一套前缀。
 * - 探针用 `latest.yml`（体积仅数百字节、electron-builder 发布时必然存在）测延迟，
 *   实现零依赖注入 fetch（桌面传 netSession.fetch 同享代理会话，移动端传全局 fetch）。
 */

/** 单个更新源定义。prefix 为空串表示 GitHub 直连。 */
export interface UpdateSourceDef {
  id: string;
  /** UI 展示名 */
  label: string;
  /** 资产 URL 前缀（含尾斜杠）；空串 = GitHub 直连 */
  prefix: string;
}

export const GITHUB_OWNER = 'fuzz1og';
export const GITHUB_REPO = 'mplayer';

// releases/latest/download 固定 URL（302 到最新 release），跨版本有效
export const GITHUB_LATEST_BASE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/`;

/**
 * 更新源清单——静态兜底顺序：镜像在前、GitHub 直连垫底（#262）。
 * 测速排序与手动选道都以该列表为基准（保持相对顺序，仅重排位置）。
 */
export const UPDATE_SOURCE_DEFS: readonly UpdateSourceDef[] = [
  { id: 'gh-proxy', label: 'gh-proxy.com 镜像', prefix: 'https://gh-proxy.com/' },
  { id: 'ghfast', label: 'ghfast.top 镜像', prefix: 'https://ghfast.top/' },
  { id: 'ghproxynet', label: 'ghproxy.net 镜像', prefix: 'https://ghproxy.net/' },
  { id: 'github', label: 'GitHub 直连', prefix: '' },
];

/** generic provider 的 feed 地址；直连源返回空串（由调用方换 github provider） */
export function toGenericFeedUrl(def: UpdateSourceDef): string {
  return def.prefix ? `${def.prefix}${GITHUB_LATEST_BASE}` : '';
}

/** 拼接某个发布资产的最终下载地址 */
export function buildAssetUrl(def: UpdateSourceDef, filename: string): string {
  return `${def.prefix}${GITHUB_LATEST_BASE}${filename}`;
}

/** 测速结果：源 id → 延迟 ms（null = 探测失败） */
export type UpdateLatencyMap = Map<string, number | null>;

/**
 * 稳定排序：成功探针按延迟升序，失败(null)垫底；
 * 并列（含全部失败）保持传入列表的相对顺序——即静态兜底顺序。
 */
export function rankSourcesByLatency<T extends { id: string }>(
  defs: readonly T[],
  latencies: UpdateLatencyMap,
): T[] {
  return [...defs].sort(
    (a, b) => (latencies.get(a.id) ?? Infinity) - (latencies.get(b.id) ?? Infinity),
  );
}

/** probeUpdateSources 可注入的最小 fetch 面（桌面 netSession.fetch / RN 全局 fetch 均满足） */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;

export interface ProbeOptions {
  /** 单源探测超时 ms */
  timeoutMs?: number;
  /** 默认 UPDATE_SOURCE_DEFS */
  defs?: readonly UpdateSourceDef[];
}

/**
 * 并发探测全部源（GET latest.yml + Range 截断），返回 id → 延迟 ms / null（失败）。
 * 任一源失败不影响其余源；整体不会 reject（失败以 null 表达），调用方无需 try/catch。
 */
export async function probeUpdateSources(
  fetchLike: FetchLike,
  options: ProbeOptions = {},
): Promise<UpdateLatencyMap> {
  const { timeoutMs = 5000, defs = UPDATE_SOURCE_DEFS } = options;
  const results = new Map<string, number | null>();
  await Promise.all(
    defs.map(async (def) => {
      results.set(def.id, await probeOne(fetchLike, def, timeoutMs));
    }),
  );
  return results;
}

async function probeOne(
  fetchLike: FetchLike,
  def: UpdateSourceDef,
  timeoutMs: number,
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    // Range 截断是双保险：latest.yml 本身极小，镜像忽略 Range 也只拉几百字节
    const res = await fetchLike(buildAssetUrl(def, 'latest.yml'), {
      signal: controller.signal,
      headers: { Range: 'bytes=0-4095' },
    });
    await res.arrayBuffer();
    return Date.now() - startedAt;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
