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
import androidx.media3.common.ForwardingPlayer
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

  /** 正在等 JS 用 patchQueue({upsert}) 灌新 URL 的 key（过期重试用，§6.2）。 */
  @Volatile
  private var awaitingRefreshKey: String? = null

  /**
   * 用户在窗口边界按了「下一首」但在原生列表里已经没有下一项。
   *
   * 此时 `next()` 会走「踩空」分支向 JS 要歌，但**播放器是 PLAYING 而不是 ENDED**，
   * 所以补窗落地时不会触发续播逻辑 —— 新补进来的歌只会躺在列表里，锁屏/UI 的
   * 「下一首」表现为静默失灵（真机 T2 实测）。用这个标志记住「这一跳是用户要的」，
   * 等新项到了再真正切过去。
   */
  @Volatile
  private var pendingUserNext = false

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

    val builder = MediaLibrarySession.Builder(this, SessionPlayer(ctrl.player), SessionCallback())
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
    // FGS 诊断（真机 T6/T7 的关键取证）：media3 只有在 startPlaying 为真时才会调
    // startForeground；这里把「它认为要不要前台」和播放器真实状态一起打出来。
    Log.i(
      TAG,
      "onUpdateNotification startFG=$startInForegroundRequired " +
        "playing=${controller?.isPlaying()} playWhenReady=${controller?.playWhenReady()} " +
        "state=${controller?.player?.playbackState}"
    )
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
      // 队列快照（§4.3 冷启对账）：JS 的 playerStore 不持久化，进程重启后
      // 只能靠原生把「权威队列」还给 JS —— 否则 JS 反查不到 Song，
      // 既画不出 UI，也无法对过期项重解析（§6.2）。
      "tracks" to store.all().map { record ->
        mapOf(
          "key" to record.key,
          "songId" to record.songId,
          "title" to record.title,
          "artist" to record.artist,
          "album" to record.album,
          "artworkUrl" to record.artworkUrl,
          "durationMs" to record.durationMs,
          "nonFull" to record.nonFull,
          "sourceType" to record.sourceType
        )
      },
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
    removeKeys: List<String>?,
    insertAfterCurrent: TrackRecord? = null
  ): Map<String, Any?> {
    val ctrl = controller ?: return mapOf("accepted" to false, "revision" to 0L, "stale" to false)

    // 「下一首播放」（#494）：单独一条语义路径，不与 append/upsert/removeKeys 混用。
    // 必须放在这里**同步**返回结果——Android 侧 AsyncFunction 是后台线程，而
    // ExoPlayer 只能在 application looper（主线程）上访问，所以把主线程那段包成 Future 等回来。
    if (insertAfterCurrent != null) {
      return applyInsertAfterCurrent(ctrl, baseRevision, insertAfterCurrent)
    }

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

      // 长会话防膨胀：原生播放列表只保留「当前项前 KEEP_BEFORE 项」起的内容。
      // patchQueue 是 append-only，跑几小时会像 T4 那样攒到 89+ 项（MediaItem 很轻，
      // 但不该无界增长；JS 侧在 trackChanged 时用 getState().tracks 重新同步 mirror）。
      val currentIdx = ctrl.currentIndex()
      if (currentIdx > KEEP_BEFORE && ctrl.player.mediaItemCount > MAX_NATIVE_ITEMS) {
        val dropped = store.dropLeading(currentIdx - KEEP_BEFORE)
        if (dropped > 0) {
          repeat(minOf(dropped, ctrl.player.mediaItemCount - 1)) { ctrl.removeItemAt(0) }
          Log.i(TAG, "trimmed $dropped leading items (listNow=${ctrl.player.mediaItemCount})")
        }
      }

      holePending = false
      cancelWindowHoleDeadline()

      // 过期重试：JS 刚把新 URL 灌进来（replaceItemAt 已换掉 MediaItem）→ 立刻重播，
      // 不等 10s 兜底（这就是「1s 内重试一次」的真实语义：尽快离开坏源）。
      val pendingKey = awaitingRefreshKey
      val refreshed = if (pendingKey == null) null else upsert.orEmpty().firstOrNull { it.key == pendingKey }
      if (refreshed != null) {
        awaitingRefreshKey = null
        cancelErrorRetry()
        Log.i(TAG, "fresh url arrived for key=${refreshed.key} → re-prepare & resume")
        ctrl.player.prepare()
        ctrl.player.playWhenReady = userWantsPlay
      }

      // 用户在窗口边界按的「下一首」：新项到了才真正切过去（T2）
      if (pendingUserNext && ctrl.player.mediaItemCount > 0) {
        pendingUserNext = false
        val at = ctrl.currentIndex()
        if (at < ctrl.player.mediaItemCount - 1) {
          ctrl.player.seekToNextMediaItem()
          ctrl.player.playWhenReady = userWantsPlay
          Log.i(TAG, "pendingUserNext → advanced to index=${at + 1}/${ctrl.player.mediaItemCount}")
        }
      }

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

  /**
   * 「下一首播放」（#494）：已入队 → 移动到 index+1；未入队 → 插入 index+1；当前 index 不动。
   *
   * 三步：① 主线程**先问一次** COMMAND_CHANGE_MEDIA_ITEMS（不可用时 media3 是裸 return，
   * 插入会被静默丢弃）→ 变成可观测的失败；② QueueStore 同步落语义；③ 主线程落到 player。
   *
   * 时序：只在**已 in-flight 的队列**上增删（store 已经非空），不在 `replaceQueue` 之后紧跟
   * add —— 那是 androidx/media#3272 的窗口。
   */
  private fun applyInsertAfterCurrent(
    ctrl: PlaybackController,
    baseRevision: Long,
    record: TrackRecord
  ): Map<String, Any?> {
    val available = try {
      postAndAwait(ctrl) { it.canChangeMediaItems() } == true
    } catch (error: Throwable) {
      Log.w(TAG, "playNext: availableCommands probe failed", error)
      false
    }
    if (!available) {
      Log.w(TAG, "playNext rejected: player does not expose COMMAND_CHANGE_MEDIA_ITEMS")
      return mapOf(
        "accepted" to false,
        "revision" to store.currentRevision(),
        "stale" to false,
        "error" to PlayNextError.UNSUPPORTED
      )
    }

    // store 的语义是同步的：拿到 queued/moved 之后才知道要不要动 player
    val outcome = store.insertAfterCurrent(baseRevision, record)
    if (!outcome.accepted) {
      return mapOf("accepted" to false, "revision" to outcome.revision, "stale" to outcome.stale)
    }

    if (outcome.changed) {
      val target = store.currentIndex() + 1
      try {
        postAndAwait(ctrl) { service ->
          val count = service.player.mediaItemCount
          if (outcome.moved) {
            // 直接问 player 要 source index（不靠 worker 线程读 player）：
            // 取的是**移动前**的位置，与 target 同一坐标系。
            val from = (0 until count).firstOrNull { service.player.getMediaItemAt(it).mediaId == record.key }
            if (from == null) {
              Log.w(TAG, "playNext: source item vanished from player, inserting instead")
              service.insertItemsAt(target, listOf(record))
            } else {
              // 先摘后插两条调用，而不是 moveMediaItem：语义等价且下标解释无歧义
              // （moveMediaItem 的 destinationIndex 是「移动后」的下标）。两条调用发生在
              // 同一个主线程任务里 → 中间不会插入别的队列改动。
              service.player.removeMediaItem(from)
              val dest = if (from < target) target - 1 else target
              service.insertItemsAt(dest, listOf(record))
            }
          } else {
            service.insertItemsAt(target, listOf(record))
          }
          true
        }
      } catch (error: Throwable) {
        Log.w(TAG, "playNext: player mutation failed", error)
        return mapOf(
          "accepted" to false,
          "revision" to store.currentRevision(),
          "stale" to false,
          "error" to PlayNextError.FAILED
        )
      }
    }

    Log.i(
      TAG,
      "playNext key=${record.key} queued=${outcome.queued} moved=${outcome.moved} " +
        "changed=${outcome.changed} revision=${outcome.revision}"
    )
    PrefetchBridge.onTracksPatched()
    persist()
    refreshState()

    val result = HashMap<String, Any?>()
    result["accepted"] = true
    result["revision"] = outcome.revision
    result["stale"] = false
    result["changed"] = outcome.changed
    result["queued"] = outcome.queued
    result["moved"] = outcome.moved
    return result
  }

  /**
   * 在 [ctrl] 自己的 application looper（主线程）上跑一段 player 访问并等结果。
   * 5s 是防呆上限（这段逻辑本身是纯内存操作）：超时/中断一律抛，由调用方降级成可观测失败。
   */
  private fun <T> postAndAwait(ctrl: PlaybackController, block: (PlaybackController) -> T): T {
    val future = java.util.concurrent.CompletableFuture<T>()
    main.post {
      try {
        future.complete(block(ctrl))
      } catch (error: Throwable) {
        future.completeExceptionally(error)
      }
    }
    return future.get(5, java.util.concurrent.TimeUnit.SECONDS)
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
    pendingUserNext = false
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
        pendingUserNext = true
        requestTracks(NeedReason.HOLE)
      } else if (ctrl.currentIndex() >= ctrl.player.mediaItemCount - 1) {
        // 用户主动 next 踩空 → 立即 queueEnded，不重试（§4.1）
        pendingUserNext = true
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
    pendingUserNext = false
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
    // media3 在「没有 controller 连接」的场景下不会自己触发通知更新：
    // `onUpdateNotification`/`onUpdateNotificationInternal` 只由 public 的
    // `triggerNotificationUpdate()` 驱动（1.9.0 字节码实测：jar 内无任何调用点）。
    // 我们的 JS 走自写 bridge 而不是 MediaController，所以必须自己叫一次
    // —— 否则会话没有媒体通知，也就没有 FGS 提升（会被系统 idle 停掉）。
    triggerNotificationUpdate()
    if (isPlaying) {
      Log.i(TAG, "onIsPlayingChanged(true) → triggerNotificationUpdate")
    }
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
        // §6.2：标记失效 → 发 playbackError{retrying} → **等 JS 用 patchQueue({upsert}) 灌新 URL**。
        // 原生只发 1s 就盲重试是错的：core 解析链要 3~9s（#424），必然来不及，
        // 真机上表现为「恢复出来的旧直链过期 → 3 次重试全失败 → 直接跳过」。
        // 这里把 1s 当**下限**，真正等到 upsert 到达就立刻换源重播；10s 兜底再盲试一次。
        record?.invalidated = true
        awaitingRefreshKey = key
        Log.i(TAG, "awaiting fresh url for key=$key (up to ${REFRESH_WAIT_MS}ms)")
        scheduleRetry(key, index, position, playWhenReady, REFRESH_WAIT_MS)
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
    if (awaitingRefreshKey == key) awaitingRefreshKey = null
    Log.w(
      TAG,
      "skip failed item key=$key kind=${classification.kind} retries=${record?.retryCount} " +
        "skippedThisSession=$skippedThisSession/${policy.skipLimit}"
    )

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

  /**
   * 交给 [MediaLibrarySession] 的 Player 包装（#561）。
   *
   * 会话的「上一首/下一首」命令由 media3 经 Player 下推（`MediaSessionStub` →
   * `PlayerWrapper : ForwardingPlayer` → 本包装），默认会直接调 ExoPlayer 的
   * `seekToNext[MediaItem]()`，绕过 `next()`/`prev()` 承载的窗口边界策略
   * （踩空 → `pendingUserNext` + 暂停 + `QUEUE_ENDED(WINDOW_HOLE)` + 补窗）。
   * 这里把**用户发起的**会话跳曲改道到 `next()`/`prev()`，与 UI 入口走同一条路。
   *
   * 双跳防护：覆写后**不调 super**——被接管的命令不会再落到播放器默认路径；
   * 内部代码一律持原始 `ctrl.player`（见 `next()`/`prev()`/`handleEnded()`），
   * 所以服务自己发起的 `seekToNextMediaItem()` 不会再经过本包装。
   * 曲末 AUTO 推进是 ExoPlayer 的内部行为，不经过 `Player.seekTo*`，不会被误当用户 next。
   */
  private inner class SessionPlayer(player: Player) : ForwardingPlayer(player) {
    override fun seekToNext() { next() }

    override fun seekToNextMediaItem() { next() }

    override fun seekToPrevious() { prev() }

    override fun seekToPreviousMediaItem() { prev() }

    /**
     * media3 的命令可用性**前置检查**（#561 真机 FAIL 的根因）。
     *
     * 下推链不只看我们覆写的 seek 方法：MediaSessionStub 在跑 SessionTask **之前**先经
     * ConnectedControllersManager.isPlayerCommandAvailable(...) 判命令是否可用
     * （反编译 1.9.0：不可用即回 SessionResult(-4) 直接返回，**不进 SessionTask**），
     * 而该判定取的是 PlayerWrapper.getAvailableCommands() 是否含该命令。
     * 底层 ExoPlayer 在原生窗口最后一项（列表循环/随机恒 REPEAT_MODE_OFF）把
     * COMMAND_SEEK_TO_NEXT 报为不可用 —— 于是上面四个覆写根本不会被调用，表现为空操作。
     * 这里显式声明这四个命令可用（getAvailableCommands 同步包含，通知栏/锁屏按钮才显示）；
     * **只放开这四个**，其余一律沿用底层 ExoPlayer 的判定。
     */
    override fun isCommandAvailable(command: Int): Boolean {
      return when (command) {
        Player.COMMAND_SEEK_TO_NEXT,
        Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
        Player.COMMAND_SEEK_TO_PREVIOUS,
        Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> true
        else -> super.isCommandAvailable(command)
      }
    }

    override fun getAvailableCommands(): Player.Commands {
      return Player.Commands.Builder()
        .addAll(super.getAvailableCommands())
        .add(Player.COMMAND_SEEK_TO_NEXT)
        .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
        .add(Player.COMMAND_SEEK_TO_PREVIOUS)
        .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
        .build()
    }
  }

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

    /** 过期后等 JS 灌新 URL 的上限（core 解析链 3~9s，#424）。 */
    private const val REFRESH_WAIT_MS = 10_000L

    /** 长会话裁剪阈值：播放列表超过这个条数才回收历史（保留当前项前 KEEP_BEFORE 项）。 */
    private const val MAX_NATIVE_ITEMS = 60
    private const val KEEP_BEFORE = 10
  }
}

/** 「下一首播放」的可观测失败码（#494 第 5 条：绝不静默丢弃）。 */
internal object PlayNextError {
  /** player 没暴露 COMMAND_CHANGE_MEDIA_ITEMS（media3 会静默丢弃，必须显式报错）。 */
  const val UNSUPPORTED = "unsupported"
  /** 主线程落 player 时抛错/超时。 */
  const val FAILED = "failed"
}

/** policy 的不可变快照（Module → Service 传参）。 */
class PolicySnapshot(
  val autoSkip: Boolean,
  val skipLimit: Int,
  val stopWhenOffline: Boolean,
  val prefetchAhead: Int
)
