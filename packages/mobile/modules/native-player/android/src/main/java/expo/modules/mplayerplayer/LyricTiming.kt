package expo.modules.mplayerplayer

/** JS `setLyricLines` 的一行；`time` 单位秒，与 core `LyricLine.time` 相同（ADR 2026-11-19-android-lyric-overlay-service）。 */
internal data class OverlayLyricLine(val time: Double, val text: String)

/** 行推导，规则与 core `findCurrentLyricIndex` 一致（规格 2026-11-19-lyric-overlay §4.1）。 */
internal object LyricTiming {

  fun findCurrentIndex(lines: List<OverlayLyricLine>, positionSec: Double): Int {
    var left = 0
    var right = lines.size - 1
    while (left <= right) {
      val mid = (left + right) ushr 1
      if (lines[mid].time <= positionSec) left = mid + 1 else right = mid - 1
    }
    return right
  }

  fun currentText(lines: List<OverlayLyricLine>, index: Int): String? =
    if (index in lines.indices) lines[index].text else null

  /** 前奏时第 0 行进「下一句」位；末行无下一句（§4.1）。 */
  fun nextText(lines: List<OverlayLyricLine>, index: Int): String? = when {
    lines.isEmpty() -> null
    index < 0 -> lines[0].text
    index + 1 < lines.size -> lines[index + 1].text
    else -> null
  }

  /** 到下一行边界的毫秒数；没有下一行返回 -1。 */
  fun nextBoundaryDelayMs(lines: List<OverlayLyricLine>, index: Int, positionMs: Long): Long {
    val next = when {
      lines.isEmpty() -> return -1L
      index < 0 -> lines[0]
      index + 1 < lines.size -> lines[index + 1]
      else -> return -1L
    }
    return ((next.time * 1000.0).toLong() - positionMs).coerceAtLeast(0L)
  }
}
