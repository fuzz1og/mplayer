package expo.modules.mplayerplayer

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.text.TextUtils
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.max
import kotlin.math.min

/**
 * 系统悬浮窗承载（#775 / ADR 2026-11-19-android-lyric-overlay-service）。
 * 归 PlayerService 所有：窗口寿命 = 服务寿命；不新增 service / FGS。
 */
internal class LyricOverlayController(
  private val context: Context,
  private val prefs: SharedPreferences,
  private val host: Host
) : Application.ActivityLifecycleCallbacks {

  interface Host {
    fun positionMs(): Long
    fun isPlaying(): Boolean
    fun currentTrackKey(): String?
  }

  private val main = Handler(Looper.getMainLooper())
  private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private val root = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER
    setPadding(dp(16), dp(10), dp(16), dp(10))
    background = GradientDrawable().apply {
      cornerRadius = dp(18).toFloat()
      setColor(Color.argb(0x9E, 0x10, 0x10, 0x14))
      setStroke(dp(1), Color.argb(0x33, 0xFF, 0xFF, 0xFF))
    }
    visibility = View.VISIBLE
  }

  private val currentLineView = TextView(context).apply {
    setTextColor(Color.WHITE)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    typeface = Typeface.DEFAULT_BOLD
    gravity = Gravity.CENTER
    maxLines = 2
    ellipsize = TextUtils.TruncateAt.END
  }

  private val nextLineView = TextView(context).apply {
    setTextColor(Color.argb(0xA6, 0xFF, 0xFF, 0xFF))
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
    gravity = Gravity.CENTER
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
  }

  @Volatile private var enabled = prefs.getBoolean(LyricOverlaySettings.KEY_ENABLED, false)
  /** 当前表所属的 mediaId；同曲 replaceItem 也会触发 media transition，不能据此清表。 */
  private var trackKey: String? = null
  private var lines: List<OverlayLyricLine> = emptyList()
  private var ended = false
  @Volatile private var viewAttached = false
  private var lastAppliedIndex = Int.MIN_VALUE
  private var appliedCurrentText = ""
  private var appliedNextText = ""
  private var scheduled = false
  private var scheduledForElapsedMs = 0L
  @Volatile private var activityForeground = false
  private var lastEmitted: LyricOverlayState? = null

  private var dragStartX = 0
  private var dragStartY = 0
  private var downRawX = 0f
  private var downRawY = 0f
  private var dragging = false

  private var windowParams: WindowManager.LayoutParams? = null

  private val boundaryTick = Runnable {
    scheduled = false
    if (!viewAttached) return@Runnable
    applyPosition()
  }

  private val dragListener = View.OnTouchListener { _, event ->
    if (!viewAttached || !activityForeground) return@OnTouchListener false
    val params = windowParams ?: return@OnTouchListener false
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        dragging = true
        downRawX = event.rawX
        downRawY = event.rawY
        dragStartX = params.x
        dragStartY = params.y
        true
      }

      MotionEvent.ACTION_MOVE -> {
        if (dragging) {
          val bounds = usableBounds()
          params.x = (dragStartX + (event.rawX - downRawX).toInt())
            .coerceIn(bounds.left, max(bounds.left, bounds.right - params.width))
          params.y = (dragStartY + (event.rawY - downRawY).toInt())
            .coerceIn(bounds.top, max(bounds.top, bounds.bottom - params.height))
          updateLayout(params)
        }
        true
      }

      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        if (dragging) {
          dragging = false
          prefs.edit().putInt(KEY_X, params.x).putInt(KEY_Y, params.y).apply()
        }
        true
      }

      else -> false
    }
  }

  init {
    root.addView(
      currentLineView,
      LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
    )
    root.addView(
      nextLineView,
      LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
    )
    root.setOnTouchListener(dragListener)
  }

  // ---------------------------------------------------------------- lifecycle

  fun start() {
    activityForeground = isAppInForeground()
    try {
      (context.applicationContext as? Application)?.registerActivityLifecycleCallbacks(this)
    } catch (_: Throwable) {
      // 注册失败只影响前台可拖与回前台双检，不影响播放
    }
  }

  fun destroy() {
    main.removeCallbacks(boundaryTick)
    scheduled = false
    detachWindow()
    try {
      (context.applicationContext as? Application)?.unregisterActivityLifecycleCallbacks(this)
    } catch (_: Throwable) {
      // ignore
    }
  }

  // ---------------------------------------------------------------- commands

  fun setEnabled(value: Boolean) {
    enabled = value
    LyricOverlaySettings.setEnabled(context, value)
    refresh()
  }

  /** trackKey 用于丢弃切歌前的旧表；不受开关门控（规格 §6.2）。 */
  fun setLines(trackKey: String, newLines: List<OverlayLyricLine>) {
    val currentKey = host.currentTrackKey()
    if (currentKey != null && trackKey.isNotEmpty() && trackKey != currentKey) {
      Log.i(TAG, "ignoring lyric table for stale trackKey=$trackKey current=$currentKey")
      return
    }
    // 表已通过校验：记下它所属的 key，后续同曲 media transition 不再清表
    if (trackKey.isNotEmpty()) {
      this.trackKey = trackKey
    } else if (this.trackKey.isNullOrEmpty()) {
      this.trackKey = currentKey
    }
    lines = newLines.sortedBy { it.time }
    lastAppliedIndex = Int.MIN_VALUE
    if (lines.isEmpty()) {
      detachWindow()
      emitState()
      return
    }
    refresh()
  }

  fun state(): LyricOverlayState = LyricOverlayPolicy.state(
    enabled = enabled,
    permission = canDrawOverlays(),
    attached = viewAttached,
    attachedToWindow = root.isAttachedToWindow,
    shown = root.isShown(),
    activityForeground = activityForeground
  )

  // ---------------------------------------------------------------- playback hooks

  fun onTrackChanged(newKey: String?) {
    if (!LyricOverlayPolicy.isTrackChange(trackKey, newKey)) return
    trackKey = newKey
    main.removeCallbacks(boundaryTick)
    scheduled = false
    lines = emptyList()
    lastAppliedIndex = Int.MIN_VALUE
    ended = false
    detachWindow()
    emitState()
  }

  fun onIsPlayingChanged(playing: Boolean) {
    if (playing) ended = false
    if (!playing) {
      main.removeCallbacks(boundaryTick)
      scheduled = false
    }
    refresh()
  }

  fun onSeek() {
    // 暂停中 seek 仍跟随：refresh 会按新位置重算 attach 条件与两行文本
    refresh()
  }

  fun onPlaybackEnded() {
    ended = true
    main.removeCallbacks(boundaryTick)
    scheduled = false
    detachWindow()
    emitState()
  }

  /** 1s progress tick 只作安全重同步（规格 §6.3-4）。 */
  fun onProgressTick() {
    if (!viewAttached || ended || !host.isPlaying()) return
    val positionMs = host.positionMs()
    val index = LyricTiming.findCurrentIndex(lines, positionMs / 1000.0)
    if (index != lastAppliedIndex) {
      applyPosition()
      return
    }
    val now = SystemClock.elapsedRealtime()
    if (scheduled && now > scheduledForElapsedMs + DRIFT_MS) {
      applyPosition()
      return
    }
    if (!scheduled) {
      val delay = LyricTiming.nextBoundaryDelayMs(lines, index, positionMs)
      if (delay in 0..DRIFT_MS) applyPosition() else if (delay >= 0) scheduleBoundary(index)
    }
  }

  fun onConfigurationChanged() {
    if (!viewAttached) return
    val params = windowParams ?: return
    val bounds = usableBounds()
    params.x = params.x.coerceIn(bounds.left, max(bounds.left, bounds.right - params.width))
    params.y = params.y.coerceIn(bounds.top, max(bounds.top, bounds.bottom - params.height))
    updateLayout(params)
  }

  // ---------------------------------------------------------------- activity callbacks

  override fun onActivityResumed(activity: Activity) {
    activityForeground = true
    checkPermissionOnForeground()
    refresh()
    setTouchable(true)
    emitState()
  }

  override fun onActivityPaused(activity: Activity) {
    activityForeground = false
    setTouchable(false)
    emitState()
  }

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
  override fun onActivityStarted(activity: Activity) = Unit
  override fun onActivityStopped(activity: Activity) = Unit
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
  override fun onActivityDestroyed(activity: Activity) {
    // 进程内只有一个 Activity；进程存活时 Activity 被销毁不等于服务失焦，交给 Paused 处理
  }

  // ---------------------------------------------------------------- window

  private fun refresh() {
    val permission = canDrawOverlays()
    // 权限 + 可见性双检：撤销后系统可能只把窗口藏起来而不抛异常（规格 §6.2）
    if (viewAttached && (!permission || !isWindowReallyAttached())) detachWindow()

    val positionMs = host.positionMs()
    val hasCurrentLine = LyricTiming.findCurrentIndex(lines, positionMs / 1000.0) >= 0
    val shouldShow = LyricOverlayPolicy.shouldAttach(
      enabled = enabled,
      permission = permission,
      hasLines = lines.isNotEmpty(),
      playing = host.isPlaying(),
      hasCurrentLine = hasCurrentLine,
      ended = ended
    )
    if (!shouldShow) {
      detachWindow()
      emitState()
      return
    }
    if (!viewAttached) attachWindow()
    if (viewAttached) applyPosition()
    emitState()
  }

  private fun attachWindow() {
    if (viewAttached) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (!canDrawOverlays()) return
    val params = buildParams()
    windowParams = params
    try {
      windowManager.addView(root, params)
      viewAttached = true
    } catch (error: Exception) {
      viewAttached = false
      Log.w(TAG, "overlay addView failed", error)
      return
    }
    // 第二检：addView 不抛异常但系统已把窗口藏起来（权限撤销的常见形态）不算挂载成功
    if (!isWindowReallyAttached()) {
      Log.w(TAG, "overlay addView succeeded but window is not shown")
      detachWindow()
      emitState()
      return
    }
    setTouchable(activityForeground)
  }

  private fun detachWindow() {
    if (!viewAttached) return
    viewAttached = false
    windowParams = null
    try {
      windowManager.removeView(root)
    } catch (_: Throwable) {
      // 权限撤销后系统可能已隐藏窗口；removeView 抛错不影响状态
    }
  }

  private fun buildParams(): WindowManager.LayoutParams {
    val bounds = usableBounds()
    val width = (bounds.width() * WIDTH_RATIO).toInt()
    val height = dp(112)
    val defaultX = bounds.left + (bounds.width() - width) / 2
    val defaultY = bounds.top + (bounds.height() * 0.16f).toInt()
    return WindowManager.LayoutParams(
      width,
      height,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = prefs.getInt(KEY_X, defaultX)
        .coerceIn(bounds.left, max(bounds.left, bounds.right - width))
      y = prefs.getInt(KEY_Y, defaultY)
        .coerceIn(bounds.top, max(bounds.top, bounds.bottom - height))
      alpha = WINDOW_ALPHA
    }
  }

  /** NOT_TOUCHABLE 的唯一写点：attach / 前后台切换 / 权限双检后的修复都走这里。 */
  private fun setTouchable(touchable: Boolean) {
    if (!viewAttached) return
    val params = windowParams ?: return
    val current = params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE == 0
    if (current == touchable) return
    params.flags = if (touchable) {
      params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
    } else {
      params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    }
    updateLayout(params)
  }

  private fun updateLayout(params: WindowManager.LayoutParams) {
    if (!viewAttached) return
    try {
      windowManager.updateViewLayout(root, params)
    } catch (error: Exception) {
      Log.w(TAG, "overlay updateViewLayout failed", error)
    }
  }

  // ---------------------------------------------------------------- timing

  private fun applyPosition() {
    if (!viewAttached) return
    val index = LyricTiming.findCurrentIndex(lines, host.positionMs() / 1000.0)
    val current = LyricTiming.currentText(lines, index) ?: ""
    val next = LyricTiming.nextText(lines, index) ?: ""
    if (index != lastAppliedIndex || current != appliedCurrentText) {
      appliedCurrentText = current
      currentLineView.text = current
    }
    if (index != lastAppliedIndex || next != appliedNextText) {
      appliedNextText = next
      nextLineView.text = next
    }
    lastAppliedIndex = index
    scheduleBoundary(index)
  }

  private fun scheduleBoundary(index: Int) {
    main.removeCallbacks(boundaryTick)
    scheduled = false
    if (ended || !host.isPlaying()) return
    val delay = LyricTiming.nextBoundaryDelayMs(lines, index, host.positionMs())
    if (delay < 0) return
    scheduled = true
    scheduledForElapsedMs = SystemClock.elapsedRealtime() + delay
    main.postDelayed(boundaryTick, min(delay + BOUNDARY_GUARD_MS, MAX_SCHEDULE_MS))
  }

  // ---------------------------------------------------------------- helpers

  private fun checkPermissionOnForeground() {
    if (viewAttached && (!canDrawOverlays() || !isWindowReallyAttached())) {
      detachWindow()
      emitState()
    }
  }

  /** 权限之后第二道：窗口真实挂到 window 且处于显示态。 */
  private fun isWindowReallyAttached(): Boolean =
    LyricOverlayPolicy.reallyAttached(viewAttached, root.isAttachedToWindow, root.isShown())

  private fun emitState() {
    val state = state()
    if (state == lastEmitted) return
    lastEmitted = state
    PlayerBridge.emit(Events.LYRIC_OVERLAY_STATE, state.toMap())
  }

  private fun canDrawOverlays(): Boolean = LyricOverlaySettings.canDrawOverlays(context)

  private fun isAppInForeground(): Boolean = try {
    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    manager.runningAppProcesses?.any {
      it.pid == Process.myPid() && it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    } == true
  } catch (_: Throwable) {
    false
  }

  private fun usableBounds(): Rect {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val metrics = windowManager.currentWindowMetrics
      val bounds = Rect(metrics.bounds)
      val insets = metrics.windowInsets.getInsetsIgnoringVisibility(
        WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout()
      )
      bounds.inset(insets.left, insets.top, insets.right, insets.bottom)
      return bounds
    }
    val metrics = context.resources.displayMetrics
    val statusBar = dimension("status_bar_height")
    val navBar = dimension("navigation_bar_height")
    return Rect(0, statusBar, metrics.widthPixels, max(statusBar, metrics.heightPixels - navBar))
  }

  private fun dimension(name: String): Int {
    val id = context.resources.getIdentifier(name, "dimen", "android")
    return if (id > 0) context.resources.getDimensionPixelSize(id) else 0
  }

  private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()

  companion object {
    private const val TAG = "MPlayerNativePlayer"
    internal const val KEY_X = "floatingLyricsX"
    internal const val KEY_Y = "floatingLyricsY"

    private const val WIDTH_RATIO = 0.62f
    private const val WINDOW_ALPHA = 0.8f

    /** 边界 Runnable 提前量：确保到点时 player 位置已越过边界。 */
    private const val BOUNDARY_GUARD_MS = 15L

    /** 单次调度上限；超长间隔由 1s tick 复核。 */
    private const val MAX_SCHEDULE_MS = 30_000L

    /** 安全重同步阈值（规格 §6.3-4）。 */
    private const val DRIFT_MS = 1_500L
  }
}
