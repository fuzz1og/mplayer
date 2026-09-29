@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.media3.session.MediaController
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture

/**
 * 拉起 [PlayerService]。
 *
 * 参照 expo-audio 已验证的做法（`BaseServiceConnection.startServiceAndBind`）：
 * **先 startService 再 bindService(BIND_AUTO_CREATE)** ——
 * ① startService 让服务处于「started」态，media3 起前台通知时 `startForeground` 才合法；
 * ② bindService 保证服务在无人播放时不被立刻回收，也给了我们 onServiceConnected 的回执。
 *
 * action 必须是 media3 的 `SERVICE_INTERFACE`，否则 `MediaSessionService.onBind` 返回 null。
 */
internal object ServiceLauncher {
  private const val TAG = "MPlayerNativePlayer"

  private var bound = false

  @Volatile
  private var controllerFuture: ListenableFuture<MediaController>? = null

  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
      bound = true
    }

    override fun onServiceDisconnected(name: ComponentName?) {
      bound = false
    }
  }

  @Volatile
  private var lastLoggedState: String? = null

  /**
   * 连一个 media3 `MediaController` 上去。
   *
   * 这一步是**媒体通知与前台服务的前提**：media3 只有在 controller 连接时才把
   * session 注册进内部 stub，而通知/FGS 提升依赖 `getSessions()` 非空。
   * 连不上不影响播放（JS 仍走自写 bridge），只是会退回「没有通知、没有 FGS」的退化态。
   */
  private fun ensureController(context: Context) {
    if (PlayerBridge.controller != null || controllerFuture != null) return
    try {
      val token = SessionToken(context, ComponentName(context, PlayerService::class.java))
      val future = MediaController.Builder(context, token).buildAsync()
      controllerFuture = future
      future.addListener(
        {
          try {
            PlayerBridge.controller = future.get()
            Log.i(TAG, "MediaController connected (session registered → media notification/FGS available)")
          } catch (error: Throwable) {
            controllerFuture = null
            Log.w(TAG, "MediaController failed to connect", error)
          }
        },
        ContextCompat.getMainExecutor(context)
      )
    } catch (error: Throwable) {
      Log.w(TAG, "ensureController failed", error)
    }
  }

  fun ensure(context: Context): Boolean {
    val intent = Intent(context, PlayerService::class.java).apply {
      action = MediaSessionService.SERVICE_INTERFACE
    }
    var started = false
    try {
      context.startService(intent)
      started = true
    } catch (error: Throwable) {
      // Android 12+ 后台启动服务限制：允许失败，退回只 bind（前台场景不会走到这里）
      Log.w(TAG, "startService failed (background restriction?)", error)
    }
    if (!bound) {
      try {
        val flags = if (Build.VERSION.SDK_INT >= 29) {
          Context.BIND_AUTO_CREATE or Context.BIND_INCLUDE_CAPABILITIES
        } else {
          Context.BIND_AUTO_CREATE
        }
        bound = context.bindService(intent, connection, flags)
      } catch (error: Throwable) {
        Log.w(TAG, "bindService failed", error)
        bound = false
      }
    }
    // 只在状态变化时打日志：真机排查「服务是 started 还是只 bound」就看这一行
    // （只 bound 的服务没有 FGS 保护，handleAudioFocus/startForeground 都会退化）
    ensureController(context)

    val state = "start=$started bind=$bound controller=${PlayerBridge.controller != null}"
    if (state != lastLoggedState) {
      lastLoggedState = state
      Log.i(TAG, "ServiceLauncher.ensure: $state")
    }
    return started || bound
  }
}
