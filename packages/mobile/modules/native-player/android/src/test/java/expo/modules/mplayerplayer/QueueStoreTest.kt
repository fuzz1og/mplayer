package expo.modules.mplayerplayer

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 窗口绕回与队列补丁的**行为**用例（#640 / #563）：随机序下窗口走到末项、绕回落到 append 项时，
 * 落点必须与 core `planAdvance` 给出的推进落点一致。
 */
class QueueStoreTest {

  private fun track(key: String) = TrackRecord(
    key = key,
    songId = "song-$key",
    url = "https://example.invalid/$key.mp3",
    expiresAtEpochMs = 0L,
    headers = emptyMap(),
    title = key,
    artist = null,
    album = null,
    artworkUrl = null,
    durationMs = 1_000L,
    nonFull = false,
    sourceType = "test"
  )

  private fun storeOf(vararg keys: String): QueueStore =
    QueueStore().apply { load(keys.map(::track), 0) }

  /** 绕回落点：append 里第一个已在 store 的项 → 它在 store 里的下标。 */
  private fun wrapTargetOf(store: QueueStore, appendKeys: List<String>): Int =
    WindowSettlement.wrapTargetIndex(appendKeys, store::indexOfKey)

  // ---------------------------------------------------------------- 随机序绕回

  @Test
  fun wrapLandsOnTheAppendedExistingItemNotOnTheWindowHead() {
    // 随机序下窗口只有 [c, a, b]，当前停在末项 b；JS 按 core 的推进计划把 c 规划成下一首。
    val store = storeOf("c", "a", "b")
    store.moveTo(2)

    assertEquals("落点是 c 在窗口里的真实下标", 0, wrapTargetOf(store, listOf("c")))
    assertEquals("必须与 core 给出的推进落点一致（不是 index+1、也不是窗口首项的想当然）", "c", store.all()[0].key)
  }

  @Test
  fun wrapPicksTheFirstCandidateThatIsAlreadyInTheStore() {
    val store = storeOf("c", "a", "b")
    store.moveTo(2)

    assertEquals("新项跳过，取第一个已存在的", 1, wrapTargetOf(store, listOf("d", "a", "c")))
    assertEquals("第一个就命中", 2, wrapTargetOf(store, listOf("b", "a")))
  }

  @Test
  fun wrapReturnsMinusOneWhenNothingWrapsBack() {
    val store = storeOf("c", "a", "b")
    store.moveTo(2)

    assertEquals("全是新项 → 无可绕回", -1, wrapTargetOf(store, listOf("d", "e")))
    assertEquals("空 append → 无可绕回", -1, wrapTargetOf(store, emptyList()))
  }

  @Test
  fun dedupedPatchAddsNothingSoOnlyWrapCanAdvance() {
    val store = storeOf("c", "a", "b")
    store.moveTo(2)
    val revision = store.currentRevision()

    val patched = store.patch(revision, listOf(track("c"), track("a")), null, null)

    assertTrue(patched.accepted)
    assertFalse(patched.stale)
    assertEquals("去重后零新增 → revision 不动", revision, store.currentRevision())
    assertEquals("队列不膨胀", 3, store.size())
    assertEquals("当前位置不动", 2, store.currentIndex())
    assertEquals("绕回落点仍在 c", 0, wrapTargetOf(store, listOf("c")))
  }

  @Test
  fun dedupedWrapThenMoveToMakesTheTailItemAdvanceToThePlannedSong() {
    val store = storeOf("c", "a", "b")
    store.moveTo(2)
    val revision = store.currentRevision()
    store.patch(revision, listOf(track("c")), null, null)

    val target = wrapTargetOf(store, listOf("c"))
    assertEquals(
      WindowSettlement.PendingNextAction.WRAP_TO_EXISTING,
      WindowSettlement.pendingNextAction(SettleOutcome.DEDUPED, atTail = true, wrapTarget = target)
    )

    assertTrue(store.moveTo(target))
    assertEquals("绕回后当前项是 core 计划的那首", "c", store.current()?.key)
    assertEquals("绕回落在窗口首项", 0, store.currentIndex())
  }

  // ---------------------------------------------------------------- 正常追加

  @Test
  fun grownPatchAppendsNewItemsAndMovesRevision() {
    val store = storeOf("c", "a", "b")
    val revision = store.currentRevision()

    val patched = store.patch(revision, listOf(track("d")), null, null)

    assertTrue(patched.accepted)
    assertEquals(4, store.size())
    assertEquals("新项落在队尾", "d", store.all()[3].key)
    assertEquals("有新增 → revision 前进", revision + 1, store.currentRevision())

    // 新项追加在当前项之后 ⇒ 当前项不再是末项 ⇒ 未决的 next 可以顺序推进
    assertEquals(0, store.currentIndex())
    assertTrue("补进来的新项让窗口尾挪到了后面", store.currentIndex() < store.size() - 1)
    assertEquals(
      WindowSettlement.PendingNextAction.ADVANCE_NEXT,
      WindowSettlement.pendingNextAction(SettleOutcome.GROWN, atTail = false, wrapTarget = -1)
    )
  }

  @Test
  fun stalePatchIsRejectedButLeavesTheQueueUntouched() {
    val store = storeOf("c", "a", "b")

    val patched = store.patch(store.currentRevision() + 99, listOf(track("d")), null, null)

    assertFalse("过期 revision 的补丁数据不能落", patched.accepted)
    assertTrue(patched.stale)
    assertEquals(3, store.size())
    assertNull(store.findByKey("d"))
  }

  // ---------------------------------------------------------------- 窗口几何

  @Test
  fun remainingAfterCurrentCountsWhatTheWindowCanStillPlay() {
    val store = storeOf("c", "a", "b")
    assertEquals(2, store.remainingAfterCurrent())
    assertEquals(3, store.aheadCount())

    store.moveTo(2)
    assertEquals("停在末项 → 窗口里没有下一首", 0, store.remainingAfterCurrent())
    assertEquals(1, store.aheadCount())
  }

  @Test
  fun failedItemsAreNotCountedAsPlayable() {
    val store = storeOf("c", "a", "b")
    store.findByKey("a")?.failed = true
    assertEquals("失败项不算可推进", 1, store.remainingAfterCurrent())
  }

  // ---------------------------------------------------------------- 快照往返（冷启对账）

  @Test
  fun snapshotRoundTripKeepsOrderIndexAndRevision() {
    val store = storeOf("c", "a", "b")
    store.moveTo(1)
    val revision = store.currentRevision()

    val restored = QueueStore().apply { restoreFrom(JSONObject(store.snapshot().toString())) }

    assertEquals(listOf("c", "a", "b"), restored.all().map { it.key })
    assertEquals(1, restored.currentIndex())
    assertEquals(revision, restored.currentRevision())
    assertEquals("https://example.invalid/a.mp3", restored.current()?.url)
  }
}
