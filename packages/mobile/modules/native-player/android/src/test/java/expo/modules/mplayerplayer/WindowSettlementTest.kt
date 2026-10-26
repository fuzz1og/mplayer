package expo.modules.mplayerplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

  @Test
  fun resumeHappensAtBufferBoundaryWhenUserStillWantsPlay() {
    assertTrue(WindowSettlement.shouldResumeAfterPatch(true, SettleOutcome.GROWN, true, 3))
    assertTrue(WindowSettlement.shouldResumeAfterPatch(true, SettleOutcome.DEDUPED, true, 3))
    assertTrue("清理轮（未结算）也算补窗到位", WindowSettlement.shouldResumeAfterPatch(true, null, true, 3))
  }

  @Test
  fun resumeNeverHappensOnEmptyOutcomeOrWithoutIntent() {
    assertFalse("'empty' 不算补窗到位", WindowSettlement.shouldResumeAfterPatch(true, SettleOutcome.EMPTY, true, 3))
    assertFalse("用户没想播", WindowSettlement.shouldResumeAfterPatch(false, SettleOutcome.GROWN, true, 3))
    assertFalse("没停在缓冲边界", WindowSettlement.shouldResumeAfterPatch(true, SettleOutcome.GROWN, false, 3))
    assertFalse("空窗口", WindowSettlement.shouldResumeAfterPatch(true, SettleOutcome.GROWN, true, 0))
  }
}
