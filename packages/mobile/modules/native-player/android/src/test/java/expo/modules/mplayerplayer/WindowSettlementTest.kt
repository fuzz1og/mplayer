package expo.modules.mplayerplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 补窗结算与曲末推进的**行为**用例（#640）。只断言「给定入参 → 产出什么」，
 * 不读源码文本（ADR `2026-10-07-window-patch-settle-contract` 第 3 项已否决源码守卫）。
 */
class WindowSettlementTest {

  private fun settledOf(outcome: String?, candidates: Int) =
    WindowSettlement.settledOutcome(outcome, candidates > 0)

  // ---------------------------------------------------------------- 结算入参前置条件

  @Test
  fun dedupedIsLegalOnlyWhenCandidatesWereActuallyThrown() {
    assertEquals(SettleOutcome.DEDUPED, settledOf(SettleOutcome.DEDUPED, 2))
    assertNull("'deduped' 必须真投了候选", settledOf(SettleOutcome.DEDUPED, 0))
  }

  @Test
  fun emptyIsLegalOnlyWhenNothingWasThrown() {
    assertEquals(SettleOutcome.EMPTY, settledOf(SettleOutcome.EMPTY, 0))
    assertNull("'empty' 必须一个都没投", settledOf(SettleOutcome.EMPTY, 3))
  }

  @Test
  fun grownNeedsNoCandidateConstraintAndUnknownOutcomeNeverSettles() {
    assertEquals(SettleOutcome.GROWN, settledOf(SettleOutcome.GROWN, 1))
    assertEquals(SettleOutcome.GROWN, settledOf(SettleOutcome.GROWN, 0))
    assertNull("未结算", settledOf(null, 2))
    assertNull("取值域外的 outcome 不结算", settledOf("whatever", 2))
  }

  // ---------------------------------------------------------------- 有未决 next 时的推进

  @Test
  fun pendingNextAdvancesWhileTheWindowStillHasRoom() {
    assertEquals(
      WindowSettlement.PendingNextAction.ADVANCE_NEXT,
      WindowSettlement.pendingNextAction(SettleOutcome.GROWN, atTail = false, wrapTarget = -1)
    )
  }

  @Test
  fun pendingNextWrapsToAnExistingCandidateOnlyOnDeduped() {
    assertEquals(
      WindowSettlement.PendingNextAction.WRAP_TO_EXISTING,
      WindowSettlement.pendingNextAction(SettleOutcome.DEDUPED, atTail = true, wrapTarget = 2)
    )
    assertEquals(
      "'empty' 没有候选可绕，必须诚实结束",
      WindowSettlement.PendingNextAction.FINISH_AT_TAIL,
      WindowSettlement.pendingNextAction(SettleOutcome.EMPTY, atTail = true, wrapTarget = -1)
    )
  }

  @Test
  fun pendingNextFinishesAtTailWhenNoCandidateWrapsBack() {
    assertEquals(
      WindowSettlement.PendingNextAction.FINISH_AT_TAIL,
      WindowSettlement.pendingNextAction(SettleOutcome.DEDUPED, atTail = true, wrapTarget = -1)
    )
  }

  // ---------------------------------------------------------------- 终局闩

  @Test
  fun zeroGrowthAtWindowTailLatchesAndStopsAsking() {
    assertTrue(WindowSettlement.shouldLatch(SettleOutcome.DEDUPED, false, 3, 2))
    assertTrue(WindowSettlement.shouldLatch(SettleOutcome.EMPTY, false, 3, 2))
  }

  @Test
  fun latchIsSkippedWhenAlreadyLatchedOrNotAtTail() {
    assertFalse("已闩 → 不重复置位", WindowSettlement.shouldLatch(SettleOutcome.DEDUPED, true, 3, 2))
    assertFalse("窗口中间不闩", WindowSettlement.shouldLatch(SettleOutcome.DEDUPED, false, 3, 1))
    assertFalse("有新增不闩", WindowSettlement.shouldLatch(SettleOutcome.GROWN, false, 3, 2))
    assertFalse("未结算不闩", WindowSettlement.shouldLatch(null, false, 3, 2))
    assertFalse("空窗口不闩", WindowSettlement.shouldLatch(SettleOutcome.EMPTY, false, 0, 0))
  }

  @Test
  fun latchedTailStopsLowWaterRequests() {
    val ahead = 1
    val prefetchAhead = 3
    assertTrue(
      "未闩且低水位 → 要歌",
      WindowSettlement.shouldRequestOnLowWater(false, true, ahead, prefetchAhead)
    )
    assertFalse(
      "已闩 → 不再要歌（#563/#574 的 ~2s 重问循环）",
      WindowSettlement.shouldRequestOnLowWater(true, true, ahead, prefetchAhead)
    )
    assertFalse(
      "水位够 → 不打扰 JS",
      WindowSettlement.shouldRequestOnLowWater(false, false, 5, prefetchAhead)
    )
    assertFalse(
      "超过 prefetchAhead → 不打扰 JS",
      WindowSettlement.shouldRequestOnLowWater(false, true, 5, prefetchAhead)
    )
  }

  // ---------------------------------------------------------------- stale 与结算分离

  @Test
  fun staleSettlementIsStillConsumedWhenUserIsWaitingForNext() {
    assertTrue(WindowSettlement.shouldConsumeStaleSettlement(SettleOutcome.EMPTY, true, 3))
    assertTrue(WindowSettlement.shouldConsumeStaleSettlement(SettleOutcome.DEDUPED, true, 3))
  }

  @Test
  fun staleSettlementIsNotConsumedWithoutPendingNextOrGrown() {
    assertFalse("没有未决 next → 无悬空可收", WindowSettlement.shouldConsumeStaleSettlement(SettleOutcome.EMPTY, false, 3))
    assertFalse("'grown' 不做终局判定", WindowSettlement.shouldConsumeStaleSettlement(SettleOutcome.GROWN, true, 3))
    assertFalse("空窗口无处置", WindowSettlement.shouldConsumeStaleSettlement(SettleOutcome.EMPTY, true, 0))
    assertFalse("未结算", WindowSettlement.shouldConsumeStaleSettlement(null, true, 3))
  }

  // ---------------------------------------------------------------- 续播（T8）

  private fun resumeOf(
    settled: String?,
    mediaItemCount: Int,
    currentIndex: Int,
    userWantsPlay: Boolean = true,
    ended: Boolean = true
  ) = WindowSettlement.resumeAfterPatch(userWantsPlay, settled, ended, mediaItemCount, currentIndex)

  @Test
  fun resumeHappensAtBufferBoundaryWhenUserStillWantsPlay() {
    assertEquals(
      WindowSettlement.ResumeAfterPatch.RESUME,
      resumeOf(SettleOutcome.GROWN, mediaItemCount = 3, currentIndex = 0)
    )
    assertEquals(
      "窗口中间（还有下一项）被去重 → 仍然续播，补窗本身是成功的",
      WindowSettlement.ResumeAfterPatch.RESUME,
      resumeOf(SettleOutcome.DEDUPED, mediaItemCount = 3, currentIndex = 1)
    )
    assertEquals(
      "清理轮（未结算）也算补窗到位",
      WindowSettlement.ResumeAfterPatch.RESUME,
      resumeOf(null, mediaItemCount = 3, currentIndex = 0)
    )
  }

  @Test
  fun resumeNeverHappensOnEmptyOutcomeOrWithoutIntent() {
    assertEquals("'empty' 不算补窗到位", WindowSettlement.ResumeAfterPatch.NOTHING, resumeOf(SettleOutcome.EMPTY, 3, 0))
    assertEquals("用户没想播", WindowSettlement.ResumeAfterPatch.NOTHING, resumeOf(SettleOutcome.GROWN, 3, 0, userWantsPlay = false))
    assertEquals("没停在缓冲边界", WindowSettlement.ResumeAfterPatch.NOTHING, resumeOf(SettleOutcome.GROWN, 3, 0, ended = false))
    assertEquals("空窗口", WindowSettlement.ResumeAfterPatch.NOTHING, resumeOf(SettleOutcome.GROWN, 0, 0))
  }

  // ---------------------------------------------------------------- #650：饱和到队尾不得伪推进

  /**
   * #650 的复现路径：随机播放 → 窗口饱和（JS 队列 == 原生窗口）→ 末项自然播完 → JS 补窗候选
   * 全被去重（`outcome=deduped`）。旧实现此时 seekTo(末项) 把末首从头重播，index/revision 都不动。
   * 契约：不续播，保持 STATE_ENDED + 通知（与 FINISH_AT_TAIL 同一语义）。
   */
  @Test
  fun saturatedTailHoldsAtEndInsteadOfReplayingTheLastTrack() {
    assertEquals(
      "末项 + deduped = 整条队列都在手里 → 不续播",
      WindowSettlement.ResumeAfterPatch.HOLD_AT_END,
      resumeOf(SettleOutcome.DEDUPED, mediaItemCount = 59, currentIndex = 58)
    )
    assertTrue(
      "同一事实在守卫函数上也可直接问",
      WindowSettlement.saturatedAtTail(SettleOutcome.DEDUPED, mediaItemCount = 59, currentIndex = 58)
    )
  }

  @Test
  fun holdAtEndIsDistinctFromNothingSoTheServiceCanFinishHonestly() {
    assertNotEquals(
      "「饱和」与「前提不成立」必须可区分：前者要 finishAtTail，后者什么都不做",
      WindowSettlement.ResumeAfterPatch.NOTHING,
      resumeOf(SettleOutcome.DEDUPED, mediaItemCount = 59, currentIndex = 58)
    )
  }

  @Test
  fun saturationOnlyBlocksResumeOnTheLastItemOfADedupedRound() {
    assertEquals(
      "不是末项 → 仍是正常续播（窗口中间被去重不代表到头）",
      WindowSettlement.ResumeAfterPatch.RESUME,
      resumeOf(SettleOutcome.DEDUPED, mediaItemCount = 59, currentIndex = 57)
    )
    assertEquals(
      "'grown' 在末项 → 有新项落地，照常续播",
      WindowSettlement.ResumeAfterPatch.RESUME,
      resumeOf(SettleOutcome.GROWN, mediaItemCount = 59, currentIndex = 58)
    )
    assertEquals(
      "未结算的清理轮在末项 → 没有终局结论，不拦续播",
      WindowSettlement.ResumeAfterPatch.RESUME,
      resumeOf(null, mediaItemCount = 59, currentIndex = 58)
    )
    assertFalse(WindowSettlement.saturatedAtTail(SettleOutcome.GROWN, 59, 58))
    assertFalse(WindowSettlement.saturatedAtTail(null, 59, 58))
  }

  @Test
  fun saturationAtTailAndTheExhaustionLatchAgreeOnTheSameCoordinate() {
    // 闩按 (revision, index) 失效：末项上闩后，只要用户手动下一首/换歌让 index 动了，旧闩自然解开。
    // 这里钉的是「闩不会把 HOLD_AT_END 变成永久死锁」——同轮重复置位幂等，坐标一变就重新可推进。
    val store = QueueStore().apply {
      load(
        listOf("a", "b", "c").map {
          TrackRecord(it, "song-$it", "https://example.invalid/$it.mp3", 0L, emptyMap(), it, null, null, null, 1_000L, false, "test")
        },
        0
      )
      moveTo(2)
    }
    val latch = ExhaustionLatch()

    // 第一轮：末项 + deduped → 不续播（HOLD_AT_END），PlayerService 会 finishAtTail 置闩
    assertEquals(
      WindowSettlement.ResumeAfterPatch.HOLD_AT_END,
      resumeOf(SettleOutcome.DEDUPED, store.size(), store.currentIndex())
    )
    latch.mark(store.currentRevision(), store.currentIndex())
    assertTrue(latch.isLatchedAt(store.currentRevision(), store.currentIndex()))

    // 同轮重复置位（例如 next 轮再次 deduped）是幂等的，不会把闩钉到别的坐标
    latch.mark(store.currentRevision(), store.currentIndex())
    assertTrue(latch.isLatchedAt(store.currentRevision(), store.currentIndex()))

    // 用户手动 play/next 让 index 动了 → 旧闩失效，补窗重新被允许
    store.moveTo(0)
    assertFalse(
      "index 变了 → 旧闩失效，LOW_WATER 重新要歌",
      latch.isLatchedAt(store.currentRevision(), store.currentIndex())
    )
  }
}
