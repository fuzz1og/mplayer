package expo.modules.mplayerplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 权限 / attach / 穿透状态机（#775 / 规格 2026-11-19-lyric-overlay §6.2）。
 * 纯判定：开关是持久意图，无权限不建窗；暂停有当前行冻结显示，队尾 / 停止隐藏。
 */
class LyricOverlayPolicyTest {

  private fun attach(
    enabled: Boolean = true,
    permission: Boolean = true,
    hasLines: Boolean = true,
    playing: Boolean = false,
    hasCurrentLine: Boolean = true,
    ended: Boolean = false
  ) = LyricOverlayPolicy.shouldAttach(enabled, permission, hasLines, playing, hasCurrentLine, ended)

  @Test
  fun disabledIntentNeverAttaches() {
    assertFalse(attach(enabled = false, playing = true, hasCurrentLine = true))
    assertFalse(attach(enabled = false, playing = true, hasCurrentLine = false))
  }

  @Test
  fun missingPermissionNeverAttachesButIntentAloneIsLegal() {
    assertFalse("无 SAW 权限不得 addView（不抛错）", attach(permission = false, playing = true))
    val state = LyricOverlayPolicy.state(
      enabled = true,
      permission = false,
      attached = false,
      activityForeground = true
    )
    assertEquals("开关保持 on，权限与挂载态如实为 false", true, state.enabled)
    assertFalse(state.permission)
    assertFalse(state.attached)
    assertFalse(state.touchable)
  }

  @Test
  fun noLyricTableNeverAttaches() {
    assertFalse("无词 / 加载中不显示空条", attach(hasLines = false, playing = true))
  }

  @Test
  fun playingDuringPreludeAttachesWithEmptyCurrentLine() {
    assertTrue("前奏当前行留空但第 0 行在下一句位", attach(playing = true, hasCurrentLine = false))
  }

  @Test
  fun pausedPreludeStaysHidden() {
    assertFalse(attach(playing = false, hasCurrentLine = false))
  }

  @Test
  fun pausedOnACurrentLineFreezesVisible() {
    assertTrue("暂停冻结当前行，不变暗", attach(playing = false, hasCurrentLine = true))
  }

  @Test
  fun queueEndedHidesEvenWhenPausedOnALine() {
    assertFalse(attach(playing = false, hasCurrentLine = true, ended = true))
    assertFalse(attach(playing = true, hasCurrentLine = true, ended = true))
  }

  @Test
  fun permissionRevokedCollapsesAttachedStateButKeepsIntent() {
    val before = LyricOverlayPolicy.state(true, true, true, true)
    assertTrue(before.attached)
    assertTrue(before.touchable)

    val after = LyricOverlayPolicy.state(
      enabled = true,
      permission = false,
      attached = false,
      activityForeground = true
    )
    assertTrue("撤销只移除窗口，开关保持 on", after.enabled)
    assertFalse(after.attached)
    assertFalse(after.touchable)
  }

  @Test
  fun touchableOnlyWhileMPlayerIsForeground() {
    assertTrue(LyricOverlayPolicy.touchable(attached = true, activityForeground = true))
    assertFalse(LyricOverlayPolicy.touchable(attached = true, activityForeground = false))
    assertFalse(LyricOverlayPolicy.touchable(attached = false, activityForeground = true))
  }

  @Test
  fun attachedStateRequiresPermission() {
    assertFalse("窗口在但权限撤销 → attached=false（双检兜底）", LyricOverlayPolicy.state(true, false, true, false).attached)
  }

  @Test
  fun sameTrackReplaceIsNotATrackChange() {
    assertFalse("同曲换 URL（replaceItem）不得清表", LyricOverlayPolicy.isTrackChange("A", "A"))
    assertTrue(LyricOverlayPolicy.isTrackChange("A", "B"))
    assertTrue("首表到达前 current 为空不算同曲", LyricOverlayPolicy.isTrackChange(null, "A"))
    assertTrue("transition 到无项也要清表", LyricOverlayPolicy.isTrackChange("A", null))
  }

  @Test
  fun stateMapMatchesSharedContractKeys() {
    val map = LyricOverlayPolicy.state(true, true, true, false).toMap()
    assertEquals(setOf("enabled", "permission", "attached", "touchable"), map.keys)
    assertEquals(true, map["enabled"])
    assertEquals(true, map["permission"])
    assertEquals(true, map["attached"])
    assertEquals(false, map["touchable"])
  }
}
