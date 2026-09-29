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

/** playbackError 的 disposition 取值。 */
internal object Disposition {
  const val RETRYING = "retrying"
  const val SKIPPED = "skipped"
  const val STOPPED = "stopped"
}
