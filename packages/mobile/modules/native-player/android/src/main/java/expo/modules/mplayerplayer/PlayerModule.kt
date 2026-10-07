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

  /**
   * 「下一首播放」（#494）：把这一首放到**当前曲之后**（已在队列则移动，不在则插入）。
   * 与既有三个字段同构，透传给 [PlayerService.patchQueue]。
   */
  @Field
  var insertAfterCurrent: TrackInput? = null

  /**
   * #591：本轮补窗的**结算结论**（`"grown"` / `"deduped"` / `"empty"`，见 [SettleOutcome]）。
   *
   * 原生只读它结算终局（原先的 `refillEmpty` 布尔已退场：它是三值域里 `"empty"` 的一个
   * 投影，丢掉了「去重后的零新增」与「压根没投」的区分）。null = 调用方没做结算。
   */
  @Field
  var outcome: String? = null
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
      (appContext.reactContext as? ReactContext)?.let {
        PlayerBridge.registerReactContext(it)
        // App 启动即拉起 PlayerService：第一次点播时 media3 会话已就绪
        ServiceLauncher.ensure(it)
      }
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
        removeKeys = input.removeKeys,
        outcome = input.outcome,
        insertAfterCurrent = input.insertAfterCurrent?.toRecord()
      )
    }

    // 同步命令不能阻塞 JS 线程 → 服务未就绪时挂起（PlayerBridge 会在 onCreate 后补跑）
    Function("play") { withService { it.play() } }

    Function("pause") { withService { it.pause() } }

    Function("next") { withService { it.next() } }

    Function("prev") { withService { it.prev() } }

    Function("seek") { seconds: Double -> withService { it.seek(seconds) } }

    Function("setLoop") { mode: String -> withService { it.setLoop(mode) } }

    Function("setRate") { rate: Double -> withService { it.setRate(rate) } }

    Function("setPolicy") { policy: PolicyInput -> withService { it.setPolicy(policy.toSnapshot()) } }

    Function("stop") { withService { it.stop() } }
  }

  /** AsyncFunction（后台线程）可用：拉起服务并等它就绪。 */
  private fun requireService(): PlayerService {
    PlayerBridge.service?.let { return it }
    appContext.reactContext?.let { ServiceLauncher.ensure(it) }
    return PlayerBridge.awaitService(3_000L) ?: throw ServiceUnavailableException()
  }

  /** 同步 Function（JS 线程）用：服务未就绪则挂起，绝不阻塞。 */
  private fun withService(action: (PlayerService) -> Unit) {
    val context = appContext.reactContext ?: return
    PlayerBridge.runWhenReady(context) { service ->
      try {
        action(service)
      } catch (_: Throwable) {
        // 命令失败不影响 JS 侧后续调用
      }
    }
  }

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
