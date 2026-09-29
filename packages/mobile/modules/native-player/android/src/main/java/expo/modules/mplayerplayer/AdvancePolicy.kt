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

  /**
   * 只对「单曲循环」用原生 repeat；**绝不用 REPEAT_MODE_ALL**。
   *
   * 原生播放列表只是 JS 队列的一个**窗口**（loadQueue 一首 + patchQueue 追加），
   * 用 REPEAT_MODE_ALL 会让窗口绕回自己（把早就播过的歌当成「列表循环」重播），
   * 也不会向 JS 要新歌。列表循环 / 随机都由 JS 端 `planNextIndexes` 续队列
   * （规格 §7.3：随机由 JS 定序，原生只顺序推进）。
   */
  fun repeatMode(): Int = when (loopMode) {
    LOOP_SINGLE -> Player.REPEAT_MODE_ONE
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
