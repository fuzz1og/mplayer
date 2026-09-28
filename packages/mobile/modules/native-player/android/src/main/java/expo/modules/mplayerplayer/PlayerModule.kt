@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// ------------------------------------------------------------------ 输入 Record

class TrackMetaInput : Record {
  @Field
  var key: String = ""

  @Field
  var title: String? = null

  @Field
  var artist: String? = null

  @Field
  var album: String? = null

  @Field
  var artworkUrl: String? = null

  @Field
  var durationMs: Double = 0.0

  @Field
  var nonFull: Boolean = false

  @Field
  var sourceType: String? = null
}

class TrackInput : Record {
  @Field
  var songId: String = ""

  @Field
  var url: String = ""

  /** 绝对过期时间（I4）；0 = 未知/不适用。 */
  @Field
  var expiresAtEpochMs: Double = 0.0

  @Field
  var headers: Map<String, String>? = null

  @Field
  var meta: TrackMetaInput = TrackMetaInput()
}

class PolicyInput : Record {
  @Field
  var autoSkip: Boolean = true

  @Field
  var skipLimit: Int = AdvancePolicy.DEFAULT_SKIP_LIMIT

  @Field
  var stopWhenOffline: Boolean = false

  @Field
  var prefetchAhead: Int = AdvancePolicy.DEFAULT_PREFETCH_AHEAD
}

class LoadQueueInput : Record {
  @Field
  var revision: Double = 0.0

  @Field
  var tracks: List<TrackInput> = emptyList()

  @Field
  var startIndex: Int = 0

  @Field
  var playWhenReady: Boolean = false

  @Field
  var loopMode: String = AdvancePolicy.LOOP_OFF

  @Field
  var policy: PolicyInput = PolicyInput()
}

class PatchQueueInput : Record {
  @Field
  var baseRevision: Double = 0.0

  @Field
  var append: List<TrackInput>? = null

  @Field
  var upsert: List<TrackInput>? = null

  @Field
  var removeKeys: List<String>? = null
}

// ------------------------------------------------------------------ 异常

internal class ServiceUnavailableException :
  CodedException("MPlayerNativePlayer: PlayerService is not running")

// ------------------------------------------------------------------ Module

/**
 * Expo Module DSL 入口。所有命令最终落到 [PlayerService]（Service 由系统实例化，
 * Module 只通过 [PlayerBridge] 拿引用）。
 */
class PlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MPlayerNativePlayer")

    Events(*Events.ALL)

    OnCreate {
      // I1：事件出口在 JS 上下文丢失时静默 return（PlayerBridge.emit 内部处理）
      PlayerBridge.setEventSink { name, payload -> sendEvent(name, payload) }
      // expo-modules-core 的 appContext.reactContext 静态类型是 Context，
      // 运行时实例是 ReactApplicationContext（AppContext.kt 的 WeakReference<ReactApplicationContext>）。
      (appContext.reactContext as? ReactContext)?.let { PlayerBridge.registerReactContext(it) }
    }

    OnDestroy {
      PlayerBridge.clear()
    }

    /**
     * 把 HeadlessJsTaskContext 寄存到 PlayerBridge（§5.2 的 spike 点）。
     * JS 侧模块加载时调用一次；返回是否拿到了 headless 通道。
     */
    Function("registerHeadlessHost") {
      val context = appContext.reactContext as? ReactContext
      if (context == null) {
        return@Function false
      }
      PlayerBridge.registerReactContext(context)
      PlayerBridge.headlessContext != null
    }

    Function("getState") {
      PlayerBridge.service?.stateMap() ?: idleState()
    }

    Function("isServiceRunning") {
      PlayerBridge.service != null
    }

    AsyncFunction("loadQueue") { input: LoadQueueInput ->
      val service = requireService()
      service.loadQueue(
        tracks = input.tracks.map { it.toRecord() },
        startIndex = input.startIndex,
        playWhenReady = input.playWhenReady,
        loopMode = input.loopMode,
        policyIn = input.policy.toSnapshot()
      )
    }

    AsyncFunction("patchQueue") { input: PatchQueueInput ->
      val service = requireService()
      service.patchQueue(
        baseRevision = input.baseRevision.toLong(),
        append = input.append?.map { it.toRecord() },
        upsert = input.upsert?.map { it.toRecord() },
        removeKeys = input.removeKeys
      )
    }

    Function("play") { requireService().play() }

    Function("pause") { requireService().pause() }

    Function("next") { requireService().next() }

    Function("prev") { requireService().prev() }

    Function("seek") { seconds: Double -> requireService().seek(seconds) }

    Function("setLoop") { mode: String -> requireService().setLoop(mode) }

    Function("setRate") { rate: Double -> requireService().setRate(rate) }

    Function("setPolicy") { policy: PolicyInput -> requireService().setPolicy(policy.toSnapshot()) }

    Function("stop") { requireService().stop() }
  }

  private fun requireService(): PlayerService =
    PlayerBridge.service ?: throw ServiceUnavailableException()

  private fun idleState(): Map<String, Any?> = mapOf(
    "revision" to 0L,
    "index" to 0,
    "playing" to false,
    "playWhenReady" to false,
    "positionMs" to 0L,
    "durationMs" to 0L,
    "bufferedAheadMs" to 0L,
    "loopMode" to AdvancePolicy.LOOP_OFF,
    "rate" to 1.0f,
    "key" to null,
    "songId" to null,
    "queueSize" to 0,
    "aheadCount" to 0,
    "restoring" to false,
    "foreground" to false,
    "serviceRunning" to false,
    "skippedThisSession" to 0
  )
}

// ------------------------------------------------------------------ 转换

private fun TrackInput.toRecord(): TrackRecord = TrackRecord(
  key = meta.key.ifEmpty { songId },
  songId = songId,
  url = url,
  expiresAtEpochMs = expiresAtEpochMs.toLong(),
  headers = headers ?: emptyMap(),
  title = meta.title,
  artist = meta.artist,
  album = meta.album,
  artworkUrl = meta.artworkUrl,
  durationMs = meta.durationMs.toLong(),
  nonFull = meta.nonFull,
  sourceType = meta.sourceType
)

private fun PolicyInput.toSnapshot(): PolicySnapshot = PolicySnapshot(
  autoSkip = autoSkip,
  skipLimit = skipLimit,
  stopWhenOffline = stopWhenOffline,
  prefetchAhead = prefetchAhead
)
