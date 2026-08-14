/**
 * 下载进度估算（纯计算，双端共用，见 T16）。
 *
 * 现状 bug：`onDownloadProgress.total` 在 Content-Length 缺失 / chunked 传输时为
 * 0（假值），现有逻辑直接跳过更新 → 进度卡在 0%。修复：总大小未知时按「已收
 * 字节数」估算一个单调不减的软进度，不再卡 0%，但永不谎称 100%（完成判定永远
 * 来自流收尾，不来自字节数）。
 */
export interface ProgressInput {
  /** 已收字节 */
  loaded: number;
  /** 已知总大小；null 或 -1（expo onProgress 约定）表示未知 */
  total: number | null;
}

const UNKNOWN_TOTAL_CAP = 90; // 未知总量软进度封顶，给收尾跳到 100% 留空间

/** 未知总量时的软进度：log 曲线映射字节 → [0, cap]，随字节单调不减 */
function unknownTotalProgress(loaded: number): number {
  if (loaded <= 0) return 0;
  // log10(1024)=3 → log 因子; 25% 起步, 单调增长后封顶 UNKNOWN_TOTAL_CAP
  const factor = Math.log10(loaded + 1) / 10; // 1MB → 0.6；越大越接近 cap
  return Math.min(UNKNOWN_TOTAL_CAP, Math.max(0, Math.round(factor * 100)));
}

/**
 * 估算 0..100 的进度整数。
 * - 总大小已知：loaded/total，限幅 [0,100]。
 * - 总大小未知：软进度（单调、封顶 90），完成由调用方在收尾置 100。
 */
export function estimateDownloadProgress(input: ProgressInput): number {
  const total = input.total == null || input.total < 0 ? null : input.total;
  const loaded = Math.max(0, input.loaded);

  if (total == null || total <= 0) {
    return unknownTotalProgress(loaded);
  }
  const percent = Math.round((loaded / total) * 100);
  return Math.max(0, Math.min(100, percent));
}
