package expo.modules.mplayerplayer

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 终局闩的坐标语义（#640 / #563 / #609）：闩按 `(revision, index)` 失效——任何真正的切歌或
 * 显式 play/next/prev 都会让旧闩自然解开，LOW_WATER 才会重新向 JS 要歌。
 */
class ExhaustionLatchTest {

  @Test
  fun latchHoldsExactlyAtItsCoordinate() {
    val latch = ExhaustionLatch()
    latch.mark(7L, 2)

    assertTrue(latch.isLatchedAt(7L, 2))
    assertFalse("同一 index、旧 revision → 已失效", latch.isLatchedAt(6L, 2))
    assertFalse("同一 revision、别的 index → 已失效", latch.isLatchedAt(7L, 1))
  }

  @Test
  fun unmarkedLatchHoldsNothing() {
    assertFalse(ExhaustionLatch().isLatchedAt(0L, 0))
  }

  @Test
  fun clearReleasesTheLatch() {
    val latch = ExhaustionLatch()
    latch.mark(7L, 2)
    latch.clear()

    assertFalse(latch.isLatchedAt(7L, 2))
  }

  @Test
  fun remarkingMovesTheLatchToTheNewCoordinate() {
    val latch = ExhaustionLatch()
    latch.mark(7L, 2)
    latch.mark(9L, 4)

    assertFalse("旧坐标已失效", latch.isLatchedAt(7L, 2))
    assertTrue(latch.isLatchedAt(9L, 4))
  }

  @Test
  fun tailLatchSurvivesOnlyUntilTheQueueMovesOn() {
    val store = QueueStore().apply {
      load(
        listOf("c", "a", "b").map {
          TrackRecord(it, "song-$it", "https://example.invalid/$it.mp3", 0L, emptyMap(), it, null, null, null, 1_000L, false, "test")
        },
        0
      )
      moveTo(2)
    }
    val latch = ExhaustionLatch()

    assertTrue("窗口尾零新增 → 置闩", WindowSettlement.shouldLatch(SettleOutcome.DEDUPED, false, store.size(), store.currentIndex()))
    latch.mark(store.currentRevision(), store.currentIndex())
    assertTrue(latch.isLatchedAt(store.currentRevision(), store.currentIndex()))

    store.patch(store.currentRevision(), listOf(store.all()[0]), null, null)
    assertTrue("去重补丁不推进 revision → 闩仍在", latch.isLatchedAt(store.currentRevision(), store.currentIndex()))

    store.moveTo(0)
    assertFalse("真正的切歌让旧闩失效 → LOW_WATER 重新要歌", latch.isLatchedAt(store.currentRevision(), store.currentIndex()))
  }
}
