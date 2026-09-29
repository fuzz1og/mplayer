@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import android.content.Context
import android.net.Uri
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

/**
 * ExoPlayer 装配 + Player.Listener → 内部状态（规格 §2.2）。
 *
 * 队列由原生持有（QueueStore），推进是 ExoPlayer 播放列表的原生行为（#405 的正解）。
 */
internal class PlaybackController(
  context: Context,
  private val store: QueueStore,
  guard: ExpiryGuard,
  private val callbacks: Callbacks
) {
  interface Callbacks {
    fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int)
    fun onPlaybackStateChanged(playbackState: Int)
    fun onIsPlayingChanged(isPlaying: Boolean)
    fun onPlayerError(error: PlaybackException)
    fun onPositionDiscontinuity(reason: Int)
  }

  private val httpFactory = DefaultHttpDataSource.Factory()
    .setConnectTimeoutMs(15_000)
    .setReadTimeoutMs(30_000)
    .setAllowCrossProtocolRedirects(true)

  private val dataSourceFactory = ResolvingDataSource.Factory(httpFactory, guard.resolver)

  val player: ExoPlayer = ExoPlayer.Builder(context)
    .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
    .build()

  init {
    val attributes = AudioAttributes.Builder()
      .setUsage(C.USAGE_MEDIA)
      .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
      .build()
    player.setAudioAttributes(attributes, /* handleAudioFocus = */ true)
    player.setHandleAudioBecomingNoisy(true)
    player.setWakeMode(C.WAKE_MODE_NETWORK)

    player.addListener(object : Player.Listener {
      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        callbacks.onMediaItemTransition(mediaItem, reason)
      }

      override fun onPlaybackStateChanged(playbackState: Int) {
        callbacks.onPlaybackStateChanged(playbackState)
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) {
        callbacks.onIsPlayingChanged(isPlaying)
      }

      override fun onPlayerError(error: PlaybackException) {
        callbacks.onPlayerError(error)
      }

      override fun onPositionDiscontinuity(reason: Int) {
        callbacks.onPositionDiscontinuity(reason)
      }
    })
  }

  fun toMediaItem(record: TrackRecord): MediaItem {
    val metadata = MediaMetadata.Builder()
      .setTitle(record.title ?: record.key)
      .setArtist(record.artist)
      .setAlbumTitle(record.album)
      .setIsBrowsable(false)
      .setIsPlayable(true)

    if (record.durationMs > 0L) metadata.setDurationMs(record.durationMs)
    if (!record.artworkUrl.isNullOrEmpty()) metadata.setArtworkUri(Uri.parse(record.artworkUrl))

    return MediaItem.Builder()
      .setMediaId(record.key)
      .setUri(record.url)
      .setMediaMetadata(metadata.build())
      .build()
  }

  fun replaceQueue(records: List<TrackRecord>, startIndex: Int, positionMs: Long, playWhenReady: Boolean) {
    val items = records.map(::toMediaItem)
    player.setMediaItems(items, startIndex.coerceIn(0, maxOf(0, items.size - 1)), positionMs)
    player.prepare()
    player.playWhenReady = playWhenReady
  }

  fun appendItems(records: List<TrackRecord>) {
    if (records.isEmpty()) return
    player.addMediaItems(records.map(::toMediaItem))
  }

  fun replaceItemAt(index: Int, record: TrackRecord) {
    if (index < 0 || index >= player.mediaItemCount) return
    player.replaceMediaItem(index, toMediaItem(record))
  }

  fun removeItemAt(index: Int) {
    if (index < 0 || index >= player.mediaItemCount) return
    player.removeMediaItem(index)
  }

  fun currentIndex(): Int = player.currentMediaItemIndex

  fun currentKey(): String? = player.currentMediaItem?.mediaId

  fun isPlaying(): Boolean = player.isPlaying

  fun playWhenReady(): Boolean = player.playWhenReady

  fun positionMs(): Long = maxOf(0L, player.currentPosition)

  fun durationMs(): Long = player.duration.let { if (it == C.TIME_UNSET) 0L else maxOf(0L, it) }

  fun bufferedAheadMs(): Long {
    val buffered = player.bufferedPosition
    return maxOf(0L, buffered - positionMs())
  }

  fun repeatMode(mode: Int) {
    player.repeatMode = mode
  }

  fun rate(value: Float) {
    player.setPlaybackParameters(androidx.media3.common.PlaybackParameters(value))
  }

  fun release() {
    try {
      player.release()
    } catch (_: Throwable) {
      // ignore
    }
  }
}
