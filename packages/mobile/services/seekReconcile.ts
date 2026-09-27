/**
 * 松手后的 seek 对账（#423）。
 *
 * 现象：拖到某处松手后，进度条有一瞬间跳回**旧位置**。根因不是「拖动中被心跳改写」
 * （那一段 `@react-native-community/slider` 在 Android 上有 isSliding 守卫），而是
 * **松手之后**：`seekTo` 返回 ≠ 传输层状态已刷新，下一个 250ms 心跳仍可能带回旧位置，
 * 把刚落地的乐观值覆盖掉。
 *
 * 做法与桌面端 `playbackClock` 的 pendingSeek 同构（见
 * `src/renderer/services/playbackClock.ts:88-101`）：提交 seek 后记下目标，**继续用乐观值**，
 * 直到传输层追上（容差内）或超时兜底才恢复跟随。
 *  - 容差取心跳粒度的一半量级（心跳 250ms → 0.35s）；
 *  - 超时 ≈ 4~6 个心跳（1.5s），兜住「seek 压根没落地」的情况，避免进度条永久冻结；
 *  - 没有 pending 时一律接受传输位置（默认路径零变化）。
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
 * - 无 pending → 能信（正常播放推进）；
 * - 与目标差在容差内 → 能信（seek 已落地，调用方随后清掉 pending）；
 * - 超出容差但已过超时 → 能信（兜底，接受真实位置）；
 * - 否则 → **不能信**，调用方应丢弃该值、继续显示乐观值。
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
