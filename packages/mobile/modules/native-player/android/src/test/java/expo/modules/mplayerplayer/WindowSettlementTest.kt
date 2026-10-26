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

  // ---------------------------------------------------------------- #666：曲末查表 vs 缺表兜底

  private val loopModes = listOf(AdvancePolicy.LOOP_OFF, AdvancePolicy.LOOP_ALL, AdvancePolicy.LOOP_SINGLE)
  private val hasNextValues = listOf(true, false)

  /** core `buildEndOfTrackPolicy` 的投影：老语义（单曲重播 / 有项推进 / 尾上问 JS）对应的两格表。 */
  private fun legacyShapedTable(loopMode: String) = EndOfTrackPolicy(
    restartOnSingle = loopMode == AdvancePolicy.LOOP_SINGLE,
    atWindowTail = EndOfTrackPolicy.AT_WINDOW_TAIL_ASK_JS
  )

  private fun tableAction(table: EndOfTrackPolicy?, loopMode: String, hasNext: Boolean) =
    WindowSettlement.endedAction(table, loopMode, hasNext)

  @Test
  fun tablePathDecidesEveryBranchWithoutLookingAtLoopMode() {
    val shuffleStop = legacyShapedTable(AdvancePolicy.LOOP_OFF).copy(atWindowTail = EndOfTrackPolicy.AT_WINDOW_TAIL_HOLD)
    assertEquals(
      "窗口尾 + hold → HOLD（随机播到头：不向 JS 要歌、不绕回）",
      WindowSettlement.EndedAction.HOLD,
      tableAction(shuffleStop, AdvancePolicy.LOOP_ALL, hasNext = false)
    )
    assertEquals(
      "窗口内有项 → 一律顺序推进（表里没有否决这一格，与 core「有项就 advance」一致）",
      WindowSettlement.EndedAction.ADVANCE_NEXT,
      tableAction(shuffleStop, AdvancePolicy.LOOP_ALL, hasNext = true)
    )
    assertEquals(
      "窗口尾 + ask-js → ASK_JS",
      WindowSettlement.EndedAction.ASK_JS,
      tableAction(legacyShapedTable(AdvancePolicy.LOOP_ALL), AdvancePolicy.LOOP_ALL, hasNext = false)
    )
    assertEquals(
      "restartOnSingle 优先于 hasNextInWindow（单曲循环即使窗口里有项也重播自己）",
      WindowSettlement.EndedAction.RESTART_CURRENT,
      tableAction(legacyShapedTable(AdvancePolicy.LOOP_SINGLE), AdvancePolicy.LOOP_SINGLE, hasNext = true)
    )
  }

  @Test
  fun tablePathIgnoresLoopModeEntirelyOnceTheTableIsPresent() {
    // 表是唯一语义来源：同一个表在三种 loopMode 下必须给出同一答案，否则 loopMode 又偷偷参战了。
    val holdTable = legacyShapedTable(AdvancePolicy.LOOP_OFF).copy(atWindowTail = EndOfTrackPolicy.AT_WINDOW_TAIL_HOLD)
    for (hasNext in hasNextValues) {
      val actions = loopModes.map { tableAction(holdTable, it, hasNext) }
      assertEquals("hasNext=$hasNext: 表在场时 loopMode 不得影响结果", 1, actions.distinct().size)
    }
  }

  @Test
  fun unknownAtWindowTailOnlyEverAsksJsNeverHolds() {
    for (tail in listOf("ask-js", "", "wrap", "whatever")) {
      assertEquals(
        "只有 'hold' 才 HOLD；取值域外一律 ask-js（HOLD 是最强的终止结论，不能误判出来）",
        WindowSettlement.EndedAction.ASK_JS,
        tableAction(legacyShapedTable(AdvancePolicy.LOOP_OFF).copy(atWindowTail = tail), AdvancePolicy.LOOP_OFF, hasNext = false)
      )
    }
  }

  @Test
  fun fallbackPathKeepsThePreTableSemantics() {
    for (loopMode in loopModes) {
      assertEquals(
        "$loopMode: 缺表 → 与 #640 逐字等价",
        if (loopMode == AdvancePolicy.LOOP_SINGLE) WindowSettlement.EndedAction.RESTART_CURRENT else WindowSettlement.EndedAction.ADVANCE_NEXT,
        tableAction(null, loopMode, hasNext = true)
      )
      assertEquals(
        "$loopMode: 缺表 + 窗口尾 → 重播 / 问 JS，永不 HOLD",
        if (loopMode == AdvancePolicy.LOOP_SINGLE) WindowSettlement.EndedAction.RESTART_CURRENT else WindowSettlement.EndedAction.ASK_JS,
        tableAction(null, loopMode, hasNext = false)
      )
    }
  }

  @Test
  fun fallbackPathNeverHoldsBecauseHoldNeedsAnExplicitTable() {
    // 冷启 / 老版 JS / 快照损坏只剩兜底：此时原生无权断言「随机播到头」，HOLD 一次都不许出现。
    for (loopMode in loopModes) {
      for (hasNext in hasNextValues) {
        assertNotEquals(
          "$loopMode hasNext=$hasNext: 缺表不许 HOLD",
          WindowSettlement.EndedAction.HOLD,
          tableAction(null, loopMode, hasNext)
        )
      }
    }
  }

  @Test
  fun tableAndFallbackAgreeOnTheSameInputWhenTheTableMirrorsLegacySemantics() {
    // AC-3 同形性：core 投影出的「老语义表」在三种模式 × 有/无下一项上都必须与兜底逐格相同。
    // 任一侧被改坏（兜底丢了重播/推进、表丢了 hold/推进）→ 这里当场红。
    for (loopMode in loopModes) {
      val table = legacyShapedTable(loopMode)
      for (hasNext in hasNextValues) {
        assertEquals(
          "$loopMode hasNext=$hasNext: 表与兜底必须同形",
          WindowSettlement.fallbackEndedAction(loopMode, hasNext),
          tableAction(table, loopMode, hasNext)
        )
      }
    }
  }

  @Test
  fun tableAndFallbackDivergeExactlyWhereTheContractSaysTheyDo() {
    // 反证：同形只在「表镜像老语义」时成立。表说 hold 时两者必须不同——否则上面的同形用例是空转的。
    val holdTable = legacyShapedTable(AdvancePolicy.LOOP_OFF).copy(atWindowTail = EndOfTrackPolicy.AT_WINDOW_TAIL_HOLD)
    assertEquals(WindowSettlement.EndedAction.ASK_JS, WindowSettlement.fallbackEndedAction(AdvancePolicy.LOOP_OFF, false))
    assertEquals(WindowSettlement.EndedAction.HOLD, tableAction(holdTable, AdvancePolicy.LOOP_OFF, false))
    assertNotEquals(
      "若这里相等，同形用例就没在区分两条路径",
      WindowSettlement.fallbackEndedAction(AdvancePolicy.LOOP_OFF, false),
      tableAction(holdTable, AdvancePolicy.LOOP_OFF, false)
    )
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
