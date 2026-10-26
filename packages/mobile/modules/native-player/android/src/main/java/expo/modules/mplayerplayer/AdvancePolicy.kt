@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import androidx.media3.common.Player

/**
 * 曲末/失败推进的决策参数容器。
 *
 * 它**只消费** JS 下发的 policy（core `shared/skipGuard` 是唯一语义来源，I5），
 * 不持有任何默认语义分支：`autoSkip`/`skipLimit`/`stopWhenOffline`/`loopMode` 全由 JS 给。
 */
internal class AdvancePolicy {
  @Volatile
  var autoSkip: Boolean = true

  @Volatile
  var skipLimit: Int = DEFAULT_SKIP_LIMIT

  @Volatile
  var stopWhenOffline: Boolean = false

  @Volatile
  var prefetchAhead: Int = DEFAULT_PREFETCH_AHEAD

  @Volatile
  var loopMode: String = LOOP_OFF

  /** #666 下推的曲末策略表；null = 缺表 → 曲末走内联兜底、repeat 按 loopMode 猜。 */
  @Volatile
  var endOfTrack: EndOfTrackPolicy? = null

  /**
   * 「曲末该不该重播自己」的唯一读法：有表读表，缺表才退回 loopMode。
   * 绝不用 REPEAT_MODE_ALL——原生列表只是 JS 队列的一个窗口，绕回会把早播过的歌重播。
   */
  fun restartOnSingleEffective(): Boolean = endOfTrack?.restartOnSingle ?: (loopMode == LOOP_SINGLE)

  /** 与 [restartOnSingleEffective] 同源；与曲末判定拆开，两者都读表、互不依赖。 */
  fun repeatMode(): Int = when {
    restartOnSingleEffective() -> Player.REPEAT_MODE_ONE
    else -> Player.REPEAT_MODE_OFF
  }

  /** 低水位：原生手里「从当前项起」的已解析项 <= 1 就要补窗。 */
  fun isLowWater(aheadCount: Int): Boolean = aheadCount <= LOW_WATER

  /** 会话内跳过上限（与 core SKIP_LIMIT 同源）。 */
  fun maySkip(skippedThisSession: Int): Boolean = autoSkip && skippedThisSession < skipLimit

  /** 每曲重试上限：与 core skipLimit 同一数值。 */
  fun mayRetry(retryCount: Int): Boolean = retryCount < skipLimit

  companion object {
    const val LOOP_OFF = "off"
    const val LOOP_ALL = "all"
    const val LOOP_SINGLE = "single"

    const val DEFAULT_SKIP_LIMIT = 3
    const val DEFAULT_PREFETCH_AHEAD = 3
    const val LOW_WATER = 1

    /** 踩空后等 JS 补窗的上限（规格 §4.1「建议 60s」）。 */
    const val WINDOW_HOLE_TIMEOUT_MS = 60_000L
  }
}
