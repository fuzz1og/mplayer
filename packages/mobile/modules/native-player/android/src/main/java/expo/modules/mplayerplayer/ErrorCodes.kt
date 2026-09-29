@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

internal object ErrorCodes {
  const val ERR_LOAD_QUEUE = "ERR_LOAD_QUEUE"
  const val ERR_PATCH_QUEUE = "ERR_PATCH_QUEUE"
  const val ERR_SERVICE_UNAVAILABLE = "ERR_SERVICE_UNAVAILABLE"
}

/** 原生错误分级（只分级，不做文案/坏歌记忆 —— 那些留在 core skipGuard）。 */
internal object ErrorKind {
  const val EXPIRED = "expired"
  const val RANGE = "range"
  const val NOT_FOUND = "notFound"
  const val NETWORK = "network"
  const val AUDIO_SINK = "audioSink"
  const val OTHER = "other"
}
