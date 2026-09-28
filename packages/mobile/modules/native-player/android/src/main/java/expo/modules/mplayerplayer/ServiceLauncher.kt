@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.media3.session.MediaSessionService

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

  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
      bound = true
    }

    override fun onServiceDisconnected(name: ComponentName?) {
      bound = false
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
    return started || bound
  }
}
