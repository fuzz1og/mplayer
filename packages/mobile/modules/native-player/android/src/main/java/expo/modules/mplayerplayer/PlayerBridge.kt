@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskContext

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

  /** RN 0.86 的 in-process headless 任务上下文；供 PrefetchBridge 起补窗任务（规格 §5.2）。 */
  @Volatile
  var headlessContext: HeadlessJsTaskContext? = null

  @Volatile
  private var sink: ((String, Map<String, Any?>) -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())

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
