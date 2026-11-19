package expo.modules.mplayerplayer

/** 模块事件与 `getLyricOverlayState()` 的共享形状（规格 2026-11-19-lyric-overlay §6.1）。 */
internal data class LyricOverlayState(
  val enabled: Boolean,
  val permission: Boolean,
  val attached: Boolean,
  val touchable: Boolean
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "enabled" to enabled,
    "permission" to permission,
    "attached" to attached,
    "touchable" to touchable
  )
}

/** 权限 / attach / 穿透判定（规格 2026-11-19-lyric-overlay §6.2）。 */
internal object LyricOverlayPolicy {

  fun shouldAttach(
    enabled: Boolean,
    permission: Boolean,
    hasLines: Boolean,
    playing: Boolean,
    hasCurrentLine: Boolean,
    ended: Boolean
  ): Boolean {
    if (!enabled || !permission || !hasLines || ended) return false
    return playing || hasCurrentLine
  }

  fun touchable(attached: Boolean, activityForeground: Boolean): Boolean = attached && activityForeground

  /** 同曲 replaceItem（过期 URL 刷新）也会触发 media transition，key 相同不算切歌。 */
  fun isTrackChange(currentKey: String?, incomingKey: String?): Boolean =
    !(incomingKey != null && incomingKey == currentKey)

  /** `attached` / `touchable` 在对外状态里必须经权限双检（撤销后窗口可能被系统隐藏但不抛异常）。 */
  fun state(
    enabled: Boolean,
    permission: Boolean,
    attached: Boolean,
    activityForeground: Boolean
  ): LyricOverlayState {
    val reallyAttached = attached && permission
    return LyricOverlayState(
      enabled = enabled,
      permission = permission,
      attached = reallyAttached,
      touchable = touchable(reallyAttached, activityForeground)
    )
  }
}
