@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.media3.session.MediaController
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Module ↔ Service 的唯一通道。
 *
 * - Service 由系统实例化（Module 不持强引用它），所以两边都放在这个 object 里对接。
 * - 事件出口在 JS 对象丢失时必须静默 return（I1）：后台/无 JS 上下文时原生推进照常。
 */
internal object PlayerBridge {
  @Volatile
  var service: PlayerService? = null

  @Volatile
  var reactContext: ReactContext? = null

  /**
   * 我们自己持有的 media3 `MediaController`（**必须**有）。
   *
   * media3 的 `MediaSessionService` 只在「有 controller 连上来」时才把 session 注册进
   * 内部 stub（`onGetSession` → `getSessions()`），而媒体通知/FGS 提升完全依赖
   * `getSessions()` 非空（1.9.0 字节码实测：`triggerNotificationUpdate()` 遍历
   * `getSessions()`，空则静默什么都不做）。
   *
   * 我们的 JS 走自写 bridge 而不是 MediaController，所以必须在这里自己保持一个连接，
   * 否则：没有媒体通知 → 没有前台服务 → App 空闲被系统 `Stopping service due to app idle`
   * → 后台播放直接断掉（真机上表现为「连播 4 首后 PAUSED」）。
   */
  @Volatile
  var controller: MediaController? = null

  /** RN 0.86 的 in-process headless 任务上下文；供 PrefetchBridge 起补窗任务（规格 §5.2）。 */
  @Volatile
  var headlessContext: HeadlessJsTaskContext? = null

  @Volatile
  private var sink: ((String, Map<String, Any?>) -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())

  /** 服务实例还没起来时挂起的命令（`next`/`play` 这类同步命令不能阻塞 JS 线程）。 */
  private val pendingActions = ConcurrentLinkedQueue<(PlayerService) -> Unit>()

  @Volatile
  private var serviceLatch = CountDownLatch(1)

  /** Service.onCreate 调用：注册实例 + 放行等待者 + 补跑挂起命令。 */
  fun onServiceReady(next: PlayerService) {
    service = next
    serviceLatch.countDown()
    while (true) {
      val action = pendingActions.poll() ?: break
      try {
        action(next)
      } catch (_: Throwable) {
        // 命令失败不影响服务生命周期
      }
    }
  }

  /** Service.onDestroy 调用。 */
  fun onServiceGone() {
    service = null
    // CountDownLatch 不可重置 → 换一个新的，下一次启动重新等
    serviceLatch = CountDownLatch(1)
  }

  /** 等 Service 起来（只在后台线程调用，例如 AsyncFunction 的协程）。 */
  fun awaitService(timeoutMs: Long): PlayerService? {
    service?.let { return it }
    try {
      serviceLatch.await(timeoutMs, TimeUnit.MILLISECONDS)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    }
    return service
  }

  /** 同步命令入口：服务已在就直接跑，否则挂起 + 拉起服务。 */
  fun runWhenReady(context: Context, action: (PlayerService) -> Unit) {
    val current = service
    if (current != null) {
      action(current)
      return
    }
    pendingActions.add(action)
    ServiceLauncher.ensure(context)
  }

  fun setEventSink(next: ((String, Map<String, Any?>) -> Unit)?) {
    sink = next
  }

  /** I1：事件只当通知；JS 侧对象没了就丢掉，绝不因此改变原生行为。 */
  fun emit(name: String, payload: Map<String, Any?>) {
    if (Looper.myLooper() !== Looper.getMainLooper()) {
      // expo 的事件发射器要求（或至少强烈偏好）在 JS/主线程上调用；这里统一 marshal，保持顺序。
      main.post { dispatch(name, payload) }
      return
    }
    dispatch(name, payload)
  }

  private fun dispatch(name: String, payload: Map<String, Any?>) {
    val current = sink ?: return
    try {
      current(name, payload)
    } catch (_: Throwable) {
      // 静默：SharedObject.kt / KModuleEventEmitterWrapper 在 JS 对象丢失时同样静默 return
    }
  }

  fun registerReactContext(context: ReactContext) {
    reactContext = context
    if (headlessContext == null) {
      headlessContext = try {
        HeadlessJsTaskContext.getInstance(context)
      } catch (_: Throwable) {
        null
      }
    }
  }

  fun clear() {
    sink = null
  }
}
