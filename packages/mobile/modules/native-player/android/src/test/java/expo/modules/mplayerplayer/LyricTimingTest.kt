package expo.modules.mplayerplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 原生两行歌词的行推导与时序（#775 / 规格 2026-11-19-lyric-overlay §4.1 / §6.3）。
 * 规则必须与 core `findCurrentLyricIndex` 同口径，且前奏 / 末行的两行语义一致。
 */
class LyricTimingTest {

  private fun lines(vararg pairs: Pair<Double, String>) =
    pairs.map { OverlayLyricLine(it.first, it.second) }

  private fun indexAt(list: List<OverlayLyricLine>, positionSec: Double) =
    LyricTiming.findCurrentIndex(list, positionSec)

  @Test
  fun emptyTableIsAlwaysPrelude() {
    assertEquals(-1, indexAt(emptyList(), 0.0))
    assertEquals(-1, indexAt(emptyList(), 120.0))
  }

  @Test
  fun positionBeforeFirstLineIsPrelude() {
    val list = lines(5.0 to "a", 9.0 to "b")
    assertEquals(-1, indexAt(list, 0.0))
    assertEquals(-1, indexAt(list, 4.999))
  }

  @Test
  fun exactBoundaryBelongsToThatLine() {
    val list = lines(5.0 to "a", 9.0 to "b")
    assertEquals(0, indexAt(list, 5.0))
    assertEquals(1, indexAt(list, 9.0))
  }

  @Test
  fun positionBetweenLinesKeepsThePreviousLine() {
    val list = lines(5.0 to "a", 9.0 to "b")
    assertEquals(0, indexAt(list, 7.5))
    assertEquals(1, indexAt(list, 100.0))
  }

  @Test
  fun preludeShowsFirstLineOnlyInTheNextSlot() {
    val list = lines(5.0 to "a", 9.0 to "b")
    val index = indexAt(list, 1.0)
    assertNull(LyricTiming.currentText(list, index))
    assertEquals("a", LyricTiming.nextText(list, index))
  }

  @Test
  fun lastLineHasNoNextSlot() {
    val list = lines(5.0 to "a")
    val index = indexAt(list, 6.0)
    assertEquals("a", LyricTiming.currentText(list, index))
    assertNull(LyricTiming.nextText(list, index))
  }

  @Test
  fun boundaryDelayCountsDownToTheNextLine() {
    val list = lines(5.0 to "a", 9.0 to "b")
    assertEquals(2000L, LyricTiming.nextBoundaryDelayMs(list, 0, 7000L))
    assertEquals(0L, LyricTiming.nextBoundaryDelayMs(list, 0, 9000L))
  }

  @Test
  fun preludeBoundaryIsTheFirstLine() {
    val list = lines(5.0 to "a", 9.0 to "b")
    assertEquals(5000L, LyricTiming.nextBoundaryDelayMs(list, -1, 0L))
  }

  @Test
  fun noBoundaryAfterTheLastLine() {
    val list = lines(5.0 to "a")
    assertEquals(-1L, LyricTiming.nextBoundaryDelayMs(list, 0, 6000L))
    assertEquals(-1L, LyricTiming.nextBoundaryDelayMs(emptyList(), -1, 0L))
  }
}
