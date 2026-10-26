package expo.modules.mplayerplayer

/**
 * 补窗结算与曲末推进的**纯判定**（#640）：PlayerService 只负责副作用（player 调用 / 事件 / 闩的读写），
 * 判定全在这里，因此能被 JVM 单测直接钉住。契约见 ADR `2026-10-07-window-patch-settle-contract`。
 * 本文件**不得**引入任何 Android / media3 类型——纯函数只吃原始类型与枚举。
 */
internal object WindowSettlement {

  /** 曲末（STATE_ENDED）该做什么：查表优先、缺表兜底，两条路径必须同形（#666 / #639 R4.1）。 */
  enum class EndedAction {
    /** 单曲循环：重播当前曲。REPEAT_MODE_ONE 下 ExoPlayer 正常不会走到 ENDED，这里是防御分支。 */
    RESTART_CURRENT,

    /** 窗口里还有下一项：强制 seek 到下一项。 */
    ADVANCE_NEXT,

    /** 窗口尾：向 JS 要歌——随机 / 列表循环唯一能续上的路径。 */
    ASK_JS,

    /** 随机播到头（表里 atWindowTail=hold）：停在这里，不向 JS 要歌、不绕回。 */
    HOLD
  }

  /** 「用户按了下一首但踩空」之后，补窗落地时该怎么推进。 */
  enum class PendingNextAction {
    /** 队尾还有格（补进来的新项就在当前项之后）→ 顺序推进。 */
    ADVANCE_NEXT,

    /** 本轮候选全已在 store 里（'deduped'）→ 绕回到那个已存在项（列表循环 / 随机序）。 */
    WRAP_TO_EXISTING,

    /** 真的没有可推进项 → 诚实结束。 */
    FINISH_AT_TAIL
  }

  /**
   * 结算入参的前置条件校验：`'deduped'` 必须真投了候选，`'empty'` 必须一个都没投，
   * `'grown'` 不额外约束。返回 null = 调用方没做结算，或组合非法（不结算）。
   */
  fun settledOutcome(outcome: String?, hasCandidates: Boolean): String? {
    if (outcome == null) return null
    val legal = when (outcome) {
      SettleOutcome.DEDUPED -> hasCandidates
      SettleOutcome.EMPTY -> !hasCandidates
      SettleOutcome.GROWN -> true
      else -> false
    }
    return if (legal) outcome else null
  }

  /** 本轮 append 里**已经在 store 中**的第一项下标（#563 的列表循环 / 随机序绕回）；-1 = 无可绕回项。 */
  fun wrapTargetIndex(appendKeys: List<String>, indexOfKey: (String) -> Int): Int {
    for (key in appendKeys) {
      val at = indexOfKey(key)
      if (at >= 0) return at
    }
    return -1
  }

  /** 有未决的用户 next 时：顺序推进 / 绕回已存在项 / 诚实结束。 */
  fun pendingNextAction(settled: String?, atTail: Boolean, wrapTarget: Int): PendingNextAction = when {
    !atTail -> PendingNextAction.ADVANCE_NEXT
    settled == SettleOutcome.DEDUPED && wrapTarget >= 0 -> PendingNextAction.WRAP_TO_EXISTING
    else -> PendingNextAction.FINISH_AT_TAIL
  }

  /**
   * 窗口尾零新增（`'deduped'` / `'empty'`）且未闩、且当前就在末项 → 置终局闩。
   * 只上闩：不暂停、不发 QUEUE_ENDED——曲末仍由原生 repeatMode 处置（#574）。
   */
  fun shouldLatch(
    settled: String?,
    latchedAtCurrent: Boolean,
    mediaItemCount: Int,
    currentIndex: Int
  ): Boolean =
    (settled == SettleOutcome.DEDUPED || settled == SettleOutcome.EMPTY) &&
      !latchedAtCurrent &&
      mediaItemCount > 0 &&
      currentIndex >= mediaItemCount - 1

  /** 补窗落地后对「停在缓冲边界」的那次处置（T8）。 */
  enum class ResumeAfterPatch {
    /** 补窗到位 → 续播（seek 回当前项并 play）。 */
    RESUME,

    /** 窗口饱和到队尾：**不续播**，保持 STATE_ENDED + 通知（#650，语义与 [PendingNextAction.FINISH_AT_TAIL] 一致）。 */
    HOLD_AT_END,

    /** 续播前提不成立（用户没想播 / 没停在缓冲边界 / `'empty'` / 空窗口）→ 什么都不做。 */
    NOTHING
  }

  /**
   * 窗口饱和到队尾（#650）：续播只会把末首从头再播一遍，index/revision 都不动。
   * 只用来**拒绝**伪推进、不驱动绕回——`'deduped'` 分不清「真到头」与「本轮没新候选」。
   */
  fun saturatedAtTail(settled: String?, mediaItemCount: Int, currentIndex: Int): Boolean =
    settled == SettleOutcome.DEDUPED && mediaItemCount > 0 && currentIndex >= mediaItemCount - 1

  /**
   * 补窗到位 + 停在缓冲边界 + 用户仍想播 → 续播（T8）；#650 插入饱和守卫。
   * 三值而非布尔：「前提不成立」与「饱和到队尾要诚实结束」是两种不同的不续播，调用方必须分开。
   */
  fun resumeAfterPatch(
    userWantsPlay: Boolean,
    settled: String?,
    playbackStateEnded: Boolean,
    mediaItemCount: Int,
    currentIndex: Int
  ): ResumeAfterPatch = when {
    !userWantsPlay -> ResumeAfterPatch.NOTHING
    settled == SettleOutcome.EMPTY -> ResumeAfterPatch.NOTHING
    !playbackStateEnded -> ResumeAfterPatch.NOTHING
    mediaItemCount <= 0 -> ResumeAfterPatch.NOTHING
    saturatedAtTail(settled, mediaItemCount, currentIndex) -> ResumeAfterPatch.HOLD_AT_END
    else -> ResumeAfterPatch.RESUME
  }

  /** stale 轮次的结算消费（#639 R4.5）：补丁数据被丢弃，但`'empty'`/`'deduped'`的结论必须落地。 */
  fun shouldConsumeStaleSettlement(
    settled: String?,
    pendingUserNext: Boolean,
    mediaItemCount: Int
  ): Boolean =
    (settled == SettleOutcome.DEDUPED || settled == SettleOutcome.EMPTY) &&
      pendingUserNext &&
      mediaItemCount > 0

  /** LOW_WATER 水位下要不要真的向 JS 要歌：已闩则不再重问（#563/#574 的 ~2s 重问循环）。 */
  fun shouldRequestOnLowWater(
    latchedAtCurrent: Boolean,
    isLowWater: Boolean,
    aheadCount: Int,
    prefetchAhead: Int
  ): Boolean = !latchedAtCurrent && isLowWater && aheadCount <= prefetchAhead

  /**
   * 曲末处置：表里有答案就查表（core 算好的），缺表才走 [fallbackEndedAction]。
   * 原生只贡献几何事实 [hasNextInWindow]，不再自己解释 loopMode。
   */
  fun endedAction(policy: EndOfTrackPolicy?, loopMode: String, hasNextInWindow: Boolean): EndedAction =
    when {
      policy == null -> fallbackEndedAction(loopMode, hasNextInWindow)
      policy.restartOnSingle -> EndedAction.RESTART_CURRENT
      hasNextInWindow -> EndedAction.ADVANCE_NEXT
      policy.atWindowTail == EndOfTrackPolicy.AT_WINDOW_TAIL_HOLD -> EndedAction.HOLD
      else -> EndedAction.ASK_JS
    }

  /** 缺表兜底：与 #640 的内联语义**逐字等价**（单曲循环重播 / 有项推进 / 否则问 JS）。 */
  fun fallbackEndedAction(loopMode: String, hasNextInWindow: Boolean): EndedAction = when {
    loopMode == AdvancePolicy.LOOP_SINGLE -> EndedAction.RESTART_CURRENT
    hasNextInWindow -> EndedAction.ADVANCE_NEXT
    else -> EndedAction.ASK_JS
  }
}
