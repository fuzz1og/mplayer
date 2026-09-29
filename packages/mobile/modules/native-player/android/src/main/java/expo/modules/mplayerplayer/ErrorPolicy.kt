@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import androidx.media3.common.PlaybackException
import androidx.media3.datasource.HttpDataSource
import java.io.FileNotFoundException

internal class ErrorClassification(
  val kind: String,
  val httpStatus: Int?,
  val retryable: Boolean,
  val message: String
)

/**
 * HTTP 码 / 异常分级（规格 §6.2，抄粒度不抄对象传递）。
 *
 * 只做分级、陈旧守卫、计数上限、无网等待；**不做文案、不做坏歌记忆、不决定「离线直连还是 tier3」**。
 */
internal object ErrorPolicy {

  fun httpStatus(error: Throwable?): Int? {
    var cursor: Throwable? = error
    var depth = 0
    while (cursor != null && depth < 12) {
      if (cursor is HttpDataSource.InvalidResponseCodeException) {
        return cursor.responseCode
      }
      cursor = cursor.cause
      depth += 1
    }
    return null
  }

  fun classify(error: PlaybackException): ErrorClassification {
    val status = httpStatus(error)
    if (status != null) {
      return when {
        status == 403 || status == 410 -> ErrorClassification(
          ErrorKind.EXPIRED, status, true, "http $status (expired url)"
        )
        status == 416 -> ErrorClassification(
          ErrorKind.RANGE, status, true, "http 416 (range not satisfiable)"
        )
        status >= 500 -> ErrorClassification(
          ErrorKind.NETWORK, status, true, "http $status (server)"
        )
        status == 408 || status == 429 -> ErrorClassification(
          ErrorKind.NETWORK, status, true, "http $status (transient)"
        )
        else -> ErrorClassification(
          ErrorKind.OTHER, status, false, "http $status"
        )
      }
    }

    if (hasCause(error, ExpiredUrlException::class.java)) {
      return ErrorClassification(ErrorKind.EXPIRED, null, true, "expiry guard: known expired")
    }
    if (hasCause(error, FileNotFoundException::class.java)) {
      return ErrorClassification(ErrorKind.NOT_FOUND, null, false, "local file missing")
    }

    return when (error.errorCode) {
      PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
      PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
      PlaybackException.ERROR_CODE_TIMEOUT ->
        ErrorClassification(ErrorKind.NETWORK, null, true, "network unavailable")

      PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND ->
        ErrorClassification(ErrorKind.NOT_FOUND, null, false, "file not found")

      PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
      PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED ->
        ErrorClassification(ErrorKind.AUDIO_SINK, null, true, "audio sink failure")

      PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS ->
        ErrorClassification(ErrorKind.OTHER, null, false, "bad http status")

      else -> ErrorClassification(
        ErrorKind.OTHER, null, false, "player error ${error.errorCode}"
      )
    }
  }

  private fun hasCause(error: Throwable?, type: Class<out Throwable>): Boolean {
    var cursor: Throwable? = error
    var depth = 0
    while (cursor != null && depth < 12) {
      if (type.isInstance(cursor)) return true
      cursor = cursor.cause
      depth += 1
    }
    return false
  }
}
