@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/**
 * 原生 → JS 的「补窗」触发（规格 §5）。
 *
 * - 用 in-process `HeadlessJsTaskContext.startTask()`，**不用 startService**
 *   （Android 12+ 会撞 `BackgroundServiceStartNotAllowedException`）。
 * - RN 0.86 的 `HeadlessJsTaskContext` 自身不持 wakelock → 我们自己持。
 * - 任务返回值不是回传通道：回传走同一模块的 `patchQueue`。
 * - 失败降级顺序：headless 不可用 → 「预取窗口即缓冲边界」，绝不让原生去发网络请求。
 */
internal object PrefetchBridge {
  private const val TAG = "MPlayerPrefetch"
  private const val TASK_KEY = "MPlayerPrefetch"

  /** 必须装得下 core 的「直连 3s 墙 + 整链 9s 预算」（#424 / ADR 2026-09-28-resolution-chain-deadline）。 */
  private const val TIMEOUT_MS = 12_000L

  /** 每个水位事件最多 2 次尝试（首次 + 1 次重试）。 */
  private const val MAX_ATTEMPTS = 2
  private const val BACKOFF_MS = 3_000L
  private const val WAKELOCK_TIMEOUT_MS = 30_000L

  private val handler = Handler(Looper.getMainLooper())

  private var wakeLock: PowerManager.WakeLock? = null
  private var pendingData: WritableMap? = null
  private var attempts = 0
  private var activeTaskId = -1
  private var taskListener: HeadlessJsTaskEventListener? = null
  private var hardTimeout: Runnable? = null

  /** 起一次补窗任务；返回 false 表示 headless 通道不可用（调用方按 §5.3 降级）。 */
  fun requestTracks(context: Context, data: WritableMap): Boolean {
    val taskContext = PlayerBridge.headlessContext ?: run {
      Log.w(TAG, "headless unavailable: no HeadlessJsTaskContext (degrade to window-as-boundary)")
      return false
    }

    val appContext = context.applicationContext
    acquireWakeLock(appContext)
    pendingData = data
    attempts = 0
    activeTaskId = -1

    if (taskListener == null) {
      taskListener = object : HeadlessJsTaskEventListener {
        override fun onHeadlessJsTaskStart(taskId: Int) {
          Log.i(TAG, "task start id=$taskId")
        }

        override fun onHeadlessJsTaskFinish(taskId: Int) {
          Log.i(TAG, "task finish id=$taskId")
          if (taskId == activeTaskId) {
            // 任务结束但可能还欠第二次尝试 → 交给 scheduleRetry 决定
            activeTaskId = -1
          }
        }
      }.also { taskContext.addTaskEventListener(it) }
    }

    scheduleHardTimeout()

    handler.post {
      try {
        attempts += 1
        val config = HeadlessJsTaskConfig(TASK_KEY, data, TIMEOUT_MS, /* isAllowedInForeground = */ true)
        val taskId = taskContext.startTask(config)
        activeTaskId = taskId
        if (taskId < 0) {
          Log.w(TAG, "startTask returned -1 (already running?)")
        }
        if (!taskContext.hasActiveTasks()) {
          Log.w(TAG, "no active headless task after startTask")
        }
      } catch (error: Throwable) {
        Log.w(TAG, "startTask failed", error)
        scheduleRetryOrFinish()
      }
    }

    return true
  }

  /** 收到 `patchQueue` 就认为这一轮补窗有结果了 → 释放 wakelock/计时器。 */
  fun onTracksPatched() {
    Log.i(TAG, "patchQueue received → release prefetch window")
    releaseAll()
  }

  fun releaseAll() {
    hardTimeout?.let { handler.removeCallbacks(it) }
    hardTimeout = null
    activeTaskId = -1
    attempts = 0
    pendingData = null
    releaseWakeLock()
  }

  private fun scheduleRetryOrFinish() {
    if (attempts < MAX_ATTEMPTS) {
      Log.i(TAG, "retry prefetch in ${BACKOFF_MS}ms (attempt ${attempts + 1}/$MAX_ATTEMPTS)")
      handler.postDelayed({
        val taskContext = PlayerBridge.headlessContext
        if (taskContext == null) {
          releaseAll()
          return@postDelayed
        }
        try {
          attempts += 1
          val retryData = pendingData ?: Arguments.createMap()
          val config = HeadlessJsTaskConfig(TASK_KEY, retryData, TIMEOUT_MS, true)
          activeTaskId = taskContext.startTask(config)
        } catch (error: Throwable) {
          Log.w(TAG, "retry startTask failed", error)
        }
      }, BACKOFF_MS)
    } else {
      Log.w(TAG, "prefetch window exhausted after $attempts attempts")
      releaseAll()
      PlayerBridge.service?.onPrefetchWindowExhausted()
    }
  }

  private fun scheduleHardTimeout() {
    hardTimeout?.let { handler.removeCallbacks(it) }
    val runnable = Runnable {
      Log.w(TAG, "hard timeout after ${TIMEOUT_MS}ms")
      releaseAll()
      PlayerBridge.service?.onPrefetchWindowExhausted()
    }
    hardTimeout = runnable
    handler.postDelayed(runnable, TIMEOUT_MS + BACKOFF_MS + TIMEOUT_MS + 2_000L)
  }

  @Suppress("DEPRECATION")
  private fun acquireWakeLock(context: Context) {
    try {
      val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
      val lock = wakeLock ?: power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mplayer:prefetch").also {
        it.setReferenceCounted(false)
        wakeLock = it
      }
      if (!lock.isHeld) {
        lock.acquire(WAKELOCK_TIMEOUT_MS)
      }
    } catch (error: Throwable) {
      Log.w(TAG, "acquireWakeLock failed", error)
    }
  }

  private fun releaseWakeLock() {
    try {
      val lock = wakeLock ?: return
      if (lock.isHeld) lock.release()
    } catch (_: Throwable) {
      // ignore
    }
  }
}
