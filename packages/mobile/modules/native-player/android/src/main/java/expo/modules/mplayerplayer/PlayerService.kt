@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import com.facebook.react.bridge.Arguments
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONObject

/**
 * 原生播放服务：ExoPlayer 持队列 + 原生推进 + media3 媒体会话。
 *
 * - `onTaskRemoved` 不重写（继承 media3 默认：播放中保活，未播放时 pauseAllPlayersAndStopSelf）——§9.2
 * - 禁止 `exitProcess`/`Runtime.halt`（I7：RN 宿主同进程）
 * - 事件只当通知（I1/I2），任何 emit 都不作为推进前提
 */
class PlayerService : MediaLibraryService(), PlaybackController.Callbacks {

  private val main = Handler(Looper.getMainLooper())
  private val store = QueueStore()
  private val policy = AdvancePolicy()
  private val guard = ExpiryGuard(store)

  private var controller: PlaybackController? = null
  private var session: MediaLibrarySession? = null
  private var prefs: android.content.SharedPreferences? = null

  @Volatile
  private var stateCache: Map<String, Any?> = emptyMap()

  @Volatile
  private var restoring = false

  @Volatile
  private var foreground = false

  /** 用户意图（与 `player.playWhenReady` 分开：踩空时我们会 pause 但意图仍是「想播」）。 */
  @Volatile
  private var userWantsPlay = false

  @Volatile
  private var holePending = false

  @Volatile
  private var skippedThisSession = 0

  @Volatile
  private var lastKey: String? = null

  @Volatile
  private var lastNeedAtMs = 0L

  private var windowHoleDeadline: Runnable? = null
  private var errorRetry: Runnable? = null
  private var destroyed = false

  private val progressTick = object : Runnable {
    override fun run() {
      if (destroyed) return
      emitProgress()
      maybeRequestTracks(NeedReason.LOW_WATER)
      main.postDelayed(this, 1_000L)
    }
  }

  private val persistTick = object : Runnable {
    override fun run() {
      if (destroyed) return
      persist()
      main.postDelayed(this, 60_000L)
    }
  }

  // ---------------------------------------------------------------- lifecycle

  override fun onCreate() {
    super.onCreate()
    prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    val ctrl = PlaybackController(applicationContext, store, guard, this)
    controller = ctrl

    val builder = MediaLibrarySession.Builder(this, ctrl.player, SessionCallback())
      .setId(SESSION_ID)
    launchIntent()?.let { builder.setSessionActivity(it) }
    session = builder.build()

    setMediaNotificationProvider(
      DefaultMediaNotificationProvider.Builder(this)
        .setChannelId(getString(R.string.mplayer_native_channel_id))
        .setChannelName(R.string.mplayer_native_channel_name)
        .build()
        .also { it.setSmallIcon(R.drawable.ic_stat_mplayer) }
    )

    PlayerBridge.service = this
    restoreSnapshot()

    main.postDelayed(progressTick, 1_000L)
    main.postDelayed(persistTick, 60_000L)

    refreshState()
    emitServiceState()
    Log.i(TAG, "PlayerService created")
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {
    super.onUpdateNotification(session, startInForegroundRequired)
    val nowForeground = startInForegroundRequired
    if (nowForeground != foreground) {
      foreground = nowForeground
      emitServiceState()
    }
  }

  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
    persist()
  }

  override fun onDestroy() {
    destroyed = true
    main.removeCallbacks(progressTick)
    main.removeCallbacks(persistTick)
    cancelWindowHoleDeadline()
    cancelErrorRetry()
    persist()
    PrefetchBridge.releaseAll()
    PlayerBridge.onServiceGone()
    session?.release()
    session = null
    controller?.release()
    controller = null
    Log.i(TAG, "PlayerService destroyed")
    super.onDestroy()
  }

  // ---------------------------------------------------------------- state

  fun stateMap(): Map<String, Any?> {
    val cached = stateCache
    val current = store.current()
    return cached + mapOf(
      "revision" to store.currentRevision(),
      "index" to store.currentIndex(),
      "queueSize" to store.size(),
      "aheadCount" to store.aheadCount(),
      "key" to current?.key,
      "songId" to current?.songId,
      "restoring" to restoring,
      "foreground" to foreground,
      "skippedThisSession" to skippedThisSession
    )
  }

  private fun refreshState() {
    main.post {
      val ctrl = controller ?: return@post
      val current = store.current()
      stateCache = mapOf(
        "revision" to store.currentRevision(),
        "index" to ctrl.currentIndex(),
        "playing" to ctrl.isPlaying(),
        "playWhenReady" to ctrl.playWhenReady(),
        "positionMs" to ctrl.positionMs(),
        "durationMs" to ctrl.durationMs(),
        "bufferedAheadMs" to ctrl.bufferedAheadMs(),
        "loopMode" to policy.loopMode,
        "rate" to 1.0f,
        "key" to (ctrl.currentKey() ?: current?.key),
        "songId" to current?.songId,
        "queueSize" to store.size(),
        "aheadCount" to store.aheadCount(),
        "userWantsPlay" to userWantsPlay,
        "restoring" to restoring,
        "foreground" to foreground
      )
    }
  }

  private fun emitProgress() {
    val ctrl = controller ?: return
    val position = ctrl.positionMs()
    val duration = ctrl.durationMs()
    emit(
      Events.PROGRESS,
      mapOf(
        "revision" to store.currentRevision(),
        "index" to ctrl.currentIndex(),
        "positionMs" to position,
        "durationMs" to duration
      )
    )
    stateCache = stateCache + mapOf(
      "positionMs" to position,
      "durationMs" to duration,
      "playing" to ctrl.isPlaying(),
      "bufferedAheadMs" to ctrl.bufferedAheadMs()
    )
  }

  private fun emitServiceState() {
    emit(Events.SERVICE_STATE, mapOf("foreground" to foreground, "restoring" to restoring))
  }

  private fun emit(name: String, payload: Map<String, Any?>) {
    PlayerBridge.emit(name, payload)
  }

  // ---------------------------------------------------------------- commands

  fun loadQueue(
    tracks: List<TrackRecord>,
    startIndex: Int,
    playWhenReady: Boolean,
    loopMode: String,
    policyIn: PolicySnapshot
  ): Map<String, Any?> {
    val ctrl = controller ?: return mapOf("accepted" to false, "state" to stateMap())

    if (tracks.isEmpty()) {
      main.post { ctrl.player.clearMediaItems() }
      return mapOf("accepted" to false, "state" to stateMap())
    }

    policy.autoSkip = policyIn.autoSkip
    policy.skipLimit = policyIn.skipLimit
    policy.stopWhenOffline = policyIn.stopWhenOffline
    policy.prefetchAhead = policyIn.prefetchAhead
    policy.loopMode = loopMode

    store.load(tracks, startIndex)
    userWantsPlay = playWhenReady
    holePending = false
    skippedThisSession = 0
    lastKey = store.current()?.key
    cancelWindowHoleDeadline()
    PrefetchBridge.releaseAll()

    main.post {
      ctrl.repeatMode(policy.repeatMode())
      ctrl.replaceQueue(store.all(), store.currentIndex(), 0L, playWhenReady)
      refreshState()
    }

    persist()
    return mapOf("accepted" to true, "state" to stateMap())
  }

  fun patchQueue(
    baseRevision: Long,
    append: List<TrackRecord>?,
    upsert: List<TrackRecord>?,
    removeKeys: List<String>?
  ): Map<String, Any?> {
    val ctrl = controller ?: return mapOf("accepted" to false, "revision" to 0L, "stale" to false)

    val beforeKeys = store.all().map { it.key }.toHashSet()
    val outcome = store.patch(baseRevision, append, upsert, removeKeys)
    if (!outcome.accepted) {
      return mapOf("accepted" to false, "revision" to outcome.revision, "stale" to outcome.stale)
    }

    // store 里已经去重过：这里只按「补丁前是否已存在」区分「新增」与「替换」
    val newItems = ArrayList<TrackRecord>()
    append.orEmpty().forEach { if (!beforeKeys.contains(it.key)) newItems.add(it) }
    upsert.orEmpty().forEach { if (!beforeKeys.contains(it.key)) newItems.add(it) }
    val replacedUpserts = upsert.orEmpty().filter { beforeKeys.contains(it.key) }

    main.post {
      if (newItems.isNotEmpty()) ctrl.appendItems(newItems)
      replacedUpserts.forEach { record ->
        val at = store.indexOfKey(record.key)
        if (at >= 0) ctrl.replaceItemAt(at, record)
      }
      removeKeys?.forEach { key ->
        // store 已经移除，player 侧按 mediaId 反查（此时 store 里已无该项 → 用 key 匹配）
        for (i in 0 until ctrl.player.mediaItemCount) {
          if (ctrl.player.getMediaItemAt(i).mediaId == key) {
            ctrl.removeItemAt(i)
            break
          }
        }
      }

      holePending = false
      cancelWindowHoleDeadline()

      // 补窗到位 + 之前停在缓冲边界 + 用户意图仍是「想播」 → 续播（T8）
      if (userWantsPlay && ctrl.player.playbackState == Player.STATE_ENDED && ctrl.player.mediaItemCount > 0) {
        ctrl.player.seekTo(Math.min(store.currentIndex(), ctrl.player.mediaItemCount - 1), 0L)
        ctrl.player.play()
      }
      refreshState()
    }

    PrefetchBridge.onTracksPatched()
    persist()
    return mapOf("accepted" to true, "revision" to outcome.revision, "stale" to false)
  }

  fun play() {
    userWantsPlay = true
    val ctrl = controller ?: return
    main.post {
      if (ctrl.player.mediaItemCount == 0 && store.size() > 0) {
        ctrl.replaceQueue(store.all(), store.currentIndex(), 0L, true)
      } else {
        ctrl.player.play()
      }
      refreshState()
    }
  }

  fun pause() {
    userWantsPlay = false
    val ctrl = controller ?: return
    main.post {
      ctrl.player.pause()
      refreshState()
    }
  }

  fun next() {
    val ctrl = controller ?: return
    userWantsPlay = true
    main.post {
      if (ctrl.player.mediaItemCount == 0) {
        requestTracks(NeedReason.HOLE)
      } else if (ctrl.currentIndex() >= ctrl.player.mediaItemCount - 1) {
        // 用户主动 next 踩空 → 立即 queueEnded，不重试（§4.1）
        ctrl.player.pause()
        emit(Events.QUEUE_ENDED, mapOf("reason" to EndReason.WINDOW_HOLE, "index" to ctrl.currentIndex(), "revision" to store.currentRevision()))
        requestTracks(NeedReason.HOLE)
      } else {
        ctrl.player.seekToNextMediaItem()
        ctrl.player.play()
      }
      refreshState()
    }
  }

  fun prev() {
    val ctrl = controller ?: return
    main.post {
      if (ctrl.player.mediaItemCount > 0) ctrl.player.seekToPreviousMediaItem()
      refreshState()
    }
  }

  fun seek(seconds: Double) {
    val ctrl = controller ?: return
    main.post {
      ctrl.player.seekTo((seconds * 1000.0).toLong().coerceAtLeast(0L))
      refreshState()
    }
  }

  fun setLoop(mode: String) {
    policy.loopMode = mode
    val ctrl = controller ?: return
    main.post {
      ctrl.repeatMode(policy.repeatMode())
      refreshState()
    }
  }

  fun setRate(rate: Double) {
    val ctrl = controller ?: return
    main.post {
      ctrl.rate(rate.toFloat())
      stateCache = stateCache + mapOf("rate" to rate)
    }
  }

  fun setPolicy(policyIn: PolicySnapshot) {
    policy.autoSkip = policyIn.autoSkip
    policy.skipLimit = policyIn.skipLimit
    policy.stopWhenOffline = policyIn.stopWhenOffline
    policy.prefetchAhead = policyIn.prefetchAhead
  }

  fun stop() {
    userWantsPlay = false
    holePending = false
    cancelWindowHoleDeadline()
    PrefetchBridge.releaseAll()
    main.post {
      controller?.player?.pause()
      controller?.player?.stop()
      emit(Events.QUEUE_ENDED, mapOf("reason" to EndReason.STOPPED, "index" to store.currentIndex(), "revision" to store.currentRevision()))
      store.clear()
      persist()
      stopSelf()
    }
  }

  // ---------------------------------------------------------------- callbacks

  override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
    val ctrl = controller ?: return
    if (mediaItem == null) return
    val index = ctrl.currentIndex()
    store.moveTo(index)
    val toKey = mediaItem.mediaId
    val fromKey = lastKey
    lastKey = toKey
    val record = store.current()

    val mapped = when (reason) {
      Player.MEDIA_ITEM_TRANSITION_REASON_AUTO -> ChangeReason.AUTO
      Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> ChangeReason.USER
      else -> ChangeReason.USER
    }

    emit(
      Events.TRACK_CHANGED,
      mapOf(
        "fromKey" to fromKey,
        "toKey" to toKey,
        "songId" to record?.songId,
        "index" to index,
        "reason" to mapped,
        "revision" to store.currentRevision()
      )
    )
    emitStateChanged()
    persist()
    refreshState()
    maybeRequestTracks(NeedReason.LOW_WATER)
  }

  override fun onPlaybackStateChanged(playbackState: Int) {
    emitStateChanged()
    if (playbackState == Player.STATE_ENDED) {
      handleEnded()
    }
    refreshState()
  }

  override fun onIsPlayingChanged(isPlaying: Boolean) {
    emitStateChanged()
    refreshState()
  }

  override fun onPositionDiscontinuity(reason: Int) {
    refreshState()
  }

  override fun onPlayerError(error: PlaybackException) {
    handlePlayerError(error)
  }

  // ---------------------------------------------------------------- advance

  private fun emitStateChanged() {
    val ctrl = controller ?: return
    emit(
      Events.STATE_CHANGED,
      mapOf(
        "revision" to store.currentRevision(),
        "index" to ctrl.currentIndex(),
        "playing" to ctrl.isPlaying(),
        "positionMs" to ctrl.positionMs(),
        "durationMs" to ctrl.durationMs(),
        "bufferedAheadMs" to ctrl.bufferedAheadMs(),
        "loopMode" to policy.loopMode,
        "rate" to 1.0f
      )
    )
  }

  private fun handleEnded() {
    val ctrl = controller ?: return
    if (policy.loopMode == AdvancePolicy.LOOP_ALL || policy.loopMode == AdvancePolicy.LOOP_SINGLE) {
      // ExoPlayer 的 repeatMode 已经接管，正常不会走到 ENDED
      ctrl.player.seekTo(0, 0L)
      if (userWantsPlay) ctrl.player.play()
      return
    }

    val remaining = store.remainingAfterCurrent()
    if (remaining > 0) {
      // 队列里还有，但 player 没推进 → 强制 seek 到下一项
      ctrl.player.seekToNextMediaItem()
      if (userWantsPlay) ctrl.player.play()
      return
    }

    holePending = true
    ctrl.player.pause()
    emit(
      Events.QUEUE_ENDED,
      mapOf("reason" to EndReason.WINDOW_HOLE, "index" to ctrl.currentIndex(), "revision" to store.currentRevision())
    )
    if (!requestTracks(NeedReason.HOLE)) {
      // headless 不可用 → 退化为「预取窗口即缓冲边界」（人可续播，原生不空转）
      emit(
        Events.QUEUE_ENDED,
        mapOf("reason" to EndReason.EXHAUSTED, "index" to ctrl.currentIndex(), "revision" to store.currentRevision())
      )
    } else {
      armWindowHoleDeadline()
    }
    refreshState()
  }

  /** 窗口耗尽（headless 硬超时/重试用尽）→ 保持 session/通知，不 stopSelf（§5.3）。 */
  fun onPrefetchWindowExhausted() {
    main.post {
      if (!holePending) return@post
      Log.w(TAG, "prefetch window exhausted; stopping at buffer boundary")
      controller?.player?.pause()
      emit(
        Events.QUEUE_ENDED,
        mapOf("reason" to EndReason.WINDOW_HOLE, "index" to store.currentIndex(), "revision" to store.currentRevision())
      )
      refreshState()
    }
  }

  private fun armWindowHoleDeadline() {
    cancelWindowHoleDeadline()
    val runnable = Runnable {
      if (!holePending) return@Runnable
      Log.w(TAG, "window hole timeout (${AdvancePolicy.WINDOW_HOLE_TIMEOUT_MS}ms) → stopSelf")
      holePending = false
      emit(Events.QUEUE_ENDED, mapOf("reason" to EndReason.STOPPED, "index" to store.currentIndex(), "revision" to store.currentRevision()))
      stopSelf()
    }
    windowHoleDeadline = runnable
    main.postDelayed(runnable, AdvancePolicy.WINDOW_HOLE_TIMEOUT_MS)
  }

  private fun cancelWindowHoleDeadline() {
    windowHoleDeadline?.let { main.removeCallbacks(it) }
    windowHoleDeadline = null
  }

  // ---------------------------------------------------------------- prefetch

  private fun maybeRequestTracks(reason: String) {
    if (controller == null) return
    if (reason == NeedReason.LOW_WATER && !policy.isLowWater(store.aheadCount())) return
    // 水位事件去重：同一水位只发一次，补进来后由 aheadCount 复位
    if (reason == NeedReason.LOW_WATER && store.aheadCount() > policy.prefetchAhead) return
    requestTracks(reason)
  }

  /** 发 needTracks + 起 headless；返回 headless 通道是否可用。 */
  private fun requestTracks(reason: String): Boolean {
    val ctrl = controller ?: return false
    val now = System.currentTimeMillis()
    if (reason == NeedReason.LOW_WATER && now - lastNeedAtMs < 2_000L) return true
    lastNeedAtMs = now

    val revision = store.currentRevision()
    val index = ctrl.currentIndex()
    emit(
      Events.NEED_TRACKS,
      mapOf(
        "currentIndex" to index,
        "remaining" to store.remainingAfterCurrent(),
        "reason" to reason,
        "revision" to revision
      )
    )

    if (store.aheadCount() > policy.prefetchAhead && reason == NeedReason.LOW_WATER) {
      return true
    }

    val data = Arguments.createMap().apply {
      putDouble("revision", revision.toDouble())
      putString("currentKey", store.current()?.key)
      putInt("currentIndex", index)
      putInt("need", policy.prefetchAhead)
      putString("reason", reason)
    }
    return PrefetchBridge.requestTracks(applicationContext, data)
  }

  // ---------------------------------------------------------------- errors

  private fun handlePlayerError(error: PlaybackException) {
    val ctrl = controller ?: return
    val classification = ErrorPolicy.classify(error)
    val key = ctrl.currentKey() ?: store.current()?.key ?: "unknown"
    val index = ctrl.currentIndex()
    val position = ctrl.positionMs()
    val playWhenReady = ctrl.playWhenReady()
    val record = store.findByKey(key)
    val attempt = (record?.retryCount ?: 0) + 1
    if (record != null) record.retryCount = attempt

    Log.w(TAG, "player error kind=${classification.kind} status=${classification.httpStatus} key=$key attempt=$attempt")

    val mayRetry = policy.mayRetry(attempt)
    emit(
      Events.PLAYBACK_ERROR,
      mapOf(
        "key" to key,
        "songId" to record?.songId,
        "code" to classification.kind,
        "httpStatus" to classification.httpStatus,
        "message" to classification.message,
        "disposition" to if (mayRetry) Disposition.RETRYING else Disposition.SKIPPED,
        "revision" to store.currentRevision(),
        "index" to index
      )
    )

    if (!mayRetry || classification.kind == ErrorKind.NOT_FOUND) {
      skipFailedItem(key, index, classification)
      return
    }

    when (classification.kind) {
      ErrorKind.EXPIRED -> {
        record?.invalidated = true
        scheduleRetry(key, index, position, playWhenReady, 1_000L)
      }

      ErrorKind.AUDIO_SINK -> scheduleRetry(key, index, position, playWhenReady, 3_000L)

      ErrorKind.NETWORK -> {
        if (policy.stopWhenOffline && !isOnline()) {
          userWantsPlay = false
          ctrl.player.pause()
          emit(
            Events.PLAYBACK_ERROR,
            mapOf(
              "key" to key,
              "songId" to record?.songId,
              "code" to classification.kind,
              "httpStatus" to null,
              "message" to "offline: pause (policy.stopWhenOffline)",
              "disposition" to Disposition.STOPPED,
              "revision" to store.currentRevision(),
              "index" to index
            )
          )
          refreshState()
          return
        }
        scheduleRetry(key, index, position, playWhenReady, 3_000L)
      }

      else -> skipFailedItem(key, index, classification)
    }
    refreshState()
  }

  /**
   * 陈旧守卫：`(key, index, position, playWhenReady)` 与错误发生时一致才重试，
   * 否则丢弃（防「解析进行中用户切歌」写回陈旧 URL 的竞态，§6.3）。
   */
  private fun scheduleRetry(
    key: String,
    index: Int,
    position: Long,
    playWhenReady: Boolean,
    delayMs: Long
  ) {
    cancelErrorRetry()
    val runnable = Runnable {
      val ctrl = controller ?: return@Runnable
      val sameKey = ctrl.currentKey() == key
      val sameIndex = ctrl.currentIndex() == index
      val samePosition = Math.abs(ctrl.positionMs() - position) <= 2_000L
      val samePlayWhenReady = ctrl.playWhenReady() == playWhenReady
      if (!(sameKey && sameIndex && samePosition && samePlayWhenReady)) {
        Log.i(TAG, "stale retry dropped for key=$key")
        return@Runnable
      }
      Log.i(TAG, "retrying key=$key after ${delayMs}ms")
      ctrl.player.prepare()
      ctrl.player.playWhenReady = playWhenReady
    }
    errorRetry = runnable
    main.postDelayed(runnable, delayMs)
  }

  private fun cancelErrorRetry() {
    errorRetry?.let { main.removeCallbacks(it) }
    errorRetry = null
  }

  private fun skipFailedItem(key: String, index: Int, classification: ErrorClassification) {
    val ctrl = controller ?: return
    skippedThisSession += 1

    val record = store.findByKey(key)
    record?.failed = true

    emit(
      Events.PLAYBACK_ERROR,
      mapOf(
        "key" to key,
        "songId" to record?.songId,
        "code" to classification.kind,
        "httpStatus" to classification.httpStatus,
        "message" to "skipped: ${classification.message}",
        "disposition" to Disposition.SKIPPED,
        "revision" to store.currentRevision(),
        "index" to index
      )
    )

    val maySkip = policy.maySkip(skippedThisSession)
    if (!maySkip) {
      userWantsPlay = false
      ctrl.player.pause()
      emit(
        Events.PLAYBACK_ERROR,
        mapOf(
          "key" to key,
          "songId" to record?.songId,
          "code" to classification.kind,
          "httpStatus" to classification.httpStatus,
          "message" to "skip limit reached (${policy.skipLimit})",
          "disposition" to Disposition.STOPPED,
          "revision" to store.currentRevision(),
          "index" to index
        )
      )
      refreshState()
      return
    }

    store.moveTo(index)
    if (store.size() <= 1) {
      userWantsPlay = false
      ctrl.player.pause()
      emit(Events.QUEUE_ENDED, mapOf("reason" to EndReason.EXHAUSTED, "index" to index, "revision" to store.currentRevision()))
      refreshState()
      return
    }

    store.removeAt(index)
    ctrl.removeItemAt(index)

    emit(
      Events.TRACK_CHANGED,
      mapOf(
        "fromKey" to key,
        "toKey" to store.current()?.key,
        "songId" to store.current()?.songId,
        "index" to Math.min(index, maxOf(0, ctrl.player.mediaItemCount - 1)),
        "reason" to ChangeReason.ERROR_SKIP,
        "revision" to store.currentRevision()
      )
    )

    if (userWantsPlay) ctrl.player.play()
    persist()
    refreshState()
  }

  private fun isOnline(): Boolean {
    return try {
      val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
      val network = manager.activeNetwork ?: return false
      val caps = manager.getNetworkCapabilities(network) ?: return false
      caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    } catch (_: Throwable) {
      true
    }
  }

  // ---------------------------------------------------------------- session callback

  private inner class SessionCallback : MediaLibrarySession.Callback {
    override fun onPlaybackResumption(
      mediaSession: MediaSession,
      controllerInfo: MediaSession.ControllerInfo,
      isForPlayback: Boolean
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      // §9.4：没有可恢复内容时不能返回会让 media3 崩的东西；能恢复就恢复成「暂停的队列」。
      val ctrl = controller ?: return Futures.immediateFailedFuture(IllegalStateException("player not ready"))
      val records = store.all()
      if (records.isEmpty()) {
        return Futures.immediateFailedFuture(IllegalStateException("nothing to resume"))
      }
      val index = store.currentIndex().coerceIn(0, records.size - 1)
      val snapshot = readSnapshotPosition()
      val items = records.map(ctrl::toMediaItem)
      restoring = true
      emitServiceState()
      main.post {
        ctrl.player.playWhenReady = false
        userWantsPlay = false
        restoring = false
        emit(
          Events.TRACK_CHANGED,
          mapOf(
            "fromKey" to null,
            "toKey" to records[index].key,
            "songId" to records[index].songId,
            "index" to index,
            "reason" to ChangeReason.RESTORE,
            "revision" to store.currentRevision()
          )
        )
        emitServiceState()
        persist()
        refreshState()
      }
      return Futures.immediateFuture(
        MediaSession.MediaItemsWithStartPosition(items, index, snapshot)
      )
    }
  }

  // ---------------------------------------------------------------- persistence

  private fun restoreSnapshot() {
    val ctrl = controller ?: return
    val raw = prefs?.getString(KEY_SNAPSHOT, null) ?: return
    val json = try {
      JSONObject(raw)
    } catch (_: Throwable) {
      null
    } ?: return

    try {
      store.restoreFrom(json)
      if (store.size() == 0) return
      policy.loopMode = json.optString("loopMode", AdvancePolicy.LOOP_OFF)
      val restoredIndex = store.currentIndex()
      val position = json.optLong("positionMs", 0L)
      restoring = true
      lastKey = store.current()?.key
      ctrl.repeatMode(policy.repeatMode())
      // §9.4：恢复后不自动续播（URL 很可能已过期）
      ctrl.replaceQueue(store.all(), restoredIndex, position, false)
      userWantsPlay = false
      emit(
        Events.TRACK_CHANGED,
        mapOf(
          "fromKey" to null,
          "toKey" to store.current()?.key,
          "songId" to store.current()?.songId,
          "index" to restoredIndex,
          "reason" to ChangeReason.RESTORE,
          "revision" to store.currentRevision()
        )
      )
      restoring = false
      Log.i(TAG, "restored ${store.size()} tracks at index=$restoredIndex position=$position")
    } catch (error: Throwable) {
      Log.w(TAG, "restore failed", error)
      restoring = false
    }
  }

  private fun readSnapshotPosition(): Long {
    val raw = prefs?.getString(KEY_SNAPSHOT, null) ?: return 0L
    return try {
      JSONObject(raw).optLong("positionMs", 0L)
    } catch (_: Throwable) {
      0L
    }
  }

/**
   * 落盘（§9.3）。
   *
   * **禁止在这里读 ExoPlayer**：`persist()` 会被 `loadQueue`/`patchQueue`（expo
   * AsyncFunction 的后台线程）直接调用，而 ExoPlayer 只能在其 application looper
   * 上访问 —— 真机实测会打 `Expected thread: 'main'` 警告（
   * `player-accessed-on-wrong-thread`），并可能读到不一致状态。
   * 位置一律取主线程维护的 `stateCache`（progress tick / 各事件里刷新）。
   */
  private fun persist() {
    val json = JSONObject()
    try {
      val queue = store.snapshot()
      val tracks = queue.optJSONArray("tracks") ?: org.json.JSONArray()
      for (i in 0 until tracks.length()) {
        tracks.optJSONObject(i)?.put("headers", JSONObject())
      }
      json.put("tracks", tracks)
      json.put("index", store.currentIndex())
      json.put("revision", store.currentRevision())
      json.put("positionMs", (stateCache["positionMs"] as? Number)?.toLong() ?: 0L)
      json.put("playWhenReady", userWantsPlay)
      json.put("loopMode", policy.loopMode)
      prefs?.edit()?.putString(KEY_SNAPSHOT, json.toString())?.apply()
    } catch (error: Throwable) {
      Log.w(TAG, "persist failed", error)
    }
  }

  /** 点击通知回 App（API ≥ 33 媒体通知直接读该 pending intent）。 */
  private fun launchIntent(): PendingIntent? {
    return try {
      val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
      intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      PendingIntent.getActivity(
        this,
        0,
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
    } catch (_: Throwable) {
      null
    }
  }

  companion object {
    private const val TAG = "MPlayerNativePlayer"
    private const val SESSION_ID = "MPlayerNativePlayer"
    private const val PREFS_NAME = "mplayer_native_player"
    private const val KEY_SNAPSHOT = "snapshot"
  }
}

/** policy 的不可变快照（Module → Service 传参）。 */
class PolicySnapshot(
  val autoSkip: Boolean,
  val skipLimit: Int,
  val stopWhenOffline: Boolean,
  val prefetchAhead: Int
)
