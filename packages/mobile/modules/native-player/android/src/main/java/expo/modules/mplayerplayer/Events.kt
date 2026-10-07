@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

/** 模块级事件名（全部是「通知」性质，I1/I2：不驱动原生推进）。 */
internal object Events {
  const val TRACK_CHANGED = "trackChanged"
  const val STATE_CHANGED = "stateChanged"
  const val PROGRESS = "progress"
  const val QUEUE_ENDED = "queueEnded"
  const val NEED_TRACKS = "needTracks"
  const val PLAYBACK_ERROR = "playbackError"
  const val SERVICE_STATE = "serviceState"

  val ALL = arrayOf(
    TRACK_CHANGED,
    STATE_CHANGED,
    PROGRESS,
    QUEUE_ENDED,
    NEED_TRACKS,
    PLAYBACK_ERROR,
    SERVICE_STATE
  )
}

/** trackChanged 的 reason 取值。 */
internal object ChangeReason {
  const val AUTO = "auto"
  const val USER = "user"
  const val ERROR_SKIP = "errorSkip"
  const val RESTORE = "restore"
}

/** queueEnded 的 reason 取值。 */
internal object EndReason {
  const val EXHAUSTED = "exhausted"
  const val WINDOW_HOLE = "windowHole"
  const val STOPPED = "stopped"
}

/** needTracks 的 reason 取值。 */
internal object NeedReason {
  const val LOW_WATER = "lowWater"
  const val HOLE = "hole"
}

/**
 * 补窗（`patchQueue`）的**结算结论**取值（#591）——JS 的显式入参，三值互斥。
 *
 * 与 QueueStore 的 [PatchOutcome]（store.patch 的回执）不是一回事：那个是 store 的去重结果，
 * 这个是**调用方对「这一轮投了什么」的如实上报**。原生只读它结算终局，不再自己数 `addedCount`。
 * 契约见 ADR `docs/adr/2026-10-07-window-patch-settle-contract.md`。
 */
internal object SettleOutcome {
  /** 本轮投出的候选里至少一条是 store 里的新项 → 稳态推进，不做终局判定。 */
  const val GROWN = "grown"

  /** 本轮投出的候选全已在 store 里（去重后零新增）→ **本轮唯一的终局信号来源**。 */
  const val DEDUPED = "deduped"

  /** 本轮一个候选都没投出 → 终局只对「用户踩空」有意义。 */
  const val EMPTY = "empty"
}

/** playbackError 的 disposition 取值。 */
internal object Disposition {
  const val RETRYING = "retrying"
  const val SKIPPED = "skipped"
  const val STOPPED = "stopped"
}
