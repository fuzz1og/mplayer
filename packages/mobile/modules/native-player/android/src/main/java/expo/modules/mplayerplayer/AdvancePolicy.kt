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

  fun repeatMode(): Int = when (loopMode) {
    LOOP_SINGLE -> Player.REPEAT_MODE_ONE
    LOOP_ALL -> Player.REPEAT_MODE_ALL
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
