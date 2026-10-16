/**
 * 松手后的 seek 对账（#423）：`seekTo` 返回 ≠ 传输层状态已刷新，下一个 250ms 心跳可能带回旧位置、覆盖刚落地的乐观值。
 * 提交 seek 后记下目标、继续用乐观值，直到传输层追上（容差 0.35s）或超时兜底（≈1.5s，避免进度条永久冻结）。
 * 没有 pending 时一律接受传输位置（默认路径零变化）。做法与桌面 `playbackClock` 的 pendingSeek 同构。
 */
export interface PendingSeek {
  /** 用户松手时落点的秒数 */
  target: number;
  /** 提交时刻（Date.now()） */
  startedAt: number;
}

/** 传输层「追上目标」的容差（秒）：亚秒级误差不该继续压着心跳。 */
export const SEEK_SETTLE_TOLERANCE_S = 0.35;
/** 乐观值的兜底存活时间（ms）：超时即接受真实位置，避免 seek 失败把进度条冻住。 */
export const SEEK_SETTLE_TIMEOUT_MS = 1_500;

export function beginSeek(target: number, now: number): PendingSeek {
  return { target, startedAt: now };
}

/**
 * 这一次传输心跳的时间值能不能信？
 */
export function acceptsTransportTime(
  pending: PendingSeek | null,
  transportTime: number,
  now: number,
): boolean {
  if (!pending) return true;
  if (Math.abs(transportTime - pending.target) <= SEEK_SETTLE_TOLERANCE_S) return true;
  return now - pending.startedAt >= SEEK_SETTLE_TIMEOUT_MS;
}
