package expo.modules.mplayerplayer

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 模式与曲末处理的一致性（#640 / #639 R4.1）：`repeatMode()` 与曲末「下一首该是谁」必须是同一份语义，
 * 且真实取值域内「向 JS 要歌」这条路径必须可达——否则随机 / 列表循环到窗口尾就再也续不上。
 */
class AdvancePolicyTest {

  /** 与 JS 侧 `LoopMode` 同域（`modules/native-player/index.ts`）。 */
  private val loopModes = listOf(AdvancePolicy.LOOP_OFF, AdvancePolicy.LOOP_ALL, AdvancePolicy.LOOP_SINGLE)

  private fun policyOf(loopMode: String) = AdvancePolicy().apply { this.loopMode = loopMode }

  // ---------------------------------------------------------------- repeatMode 取值域

  @Test
  fun onlySingleLoopAsksTheNativePlayerToRepeat() {
    assertEquals(Player.REPEAT_MODE_ONE, policyOf(AdvancePolicy.LOOP_SINGLE).repeatMode())
    assertEquals(Player.REPEAT_MODE_OFF, policyOf(AdvancePolicy.LOOP_ALL).repeatMode())
    assertEquals(Player.REPEAT_MODE_OFF, policyOf(AdvancePolicy.LOOP_OFF).repeatMode())
  }

  // ---------------------------------------------------------------- 曲末处置 vs repeatMode

  @Test
  fun tailEndBehaviourNeverContradictsRepeatMode() {
    for (loopMode in loopModes) {
      val policy = policyOf(loopMode)
      val atTail = WindowSettlement.endedAction(loopMode, remainingAfterCurrent = 0)
      when (policy.repeatMode()) {
        Player.REPEAT_MODE_ONE ->
          assertEquals("$loopMode: 原生自己循环 → 曲末必须是重播当前曲", WindowSettlement.EndedAction.RESTART_CURRENT, atTail)

        else -> {
          assertNotEquals(
            "$loopMode: REPEAT_MODE_OFF 下重播当前曲会变成「单曲循环」，与 repeatMode 矛盾",
            WindowSettlement.EndedAction.RESTART_CURRENT,
            atTail
          )
          assertEquals("$loopMode: 窗口尾且原生不循环 → 只能向 JS 要歌", WindowSettlement.EndedAction.ASK_JS, atTail)
        }
      }
    }
  }

  @Test
  fun askJsPathIsReachableInTheRealLoopModeDomain() {
    val askJs = loopModes.filter {
      WindowSettlement.endedAction(it, remainingAfterCurrent = 0) == WindowSettlement.EndedAction.ASK_JS
    }
    assertTrue("'all' / 'off' 到窗口尾必须能向 JS 要歌，否则随机与列表循环永远续不上", askJs.contains(AdvancePolicy.LOOP_ALL))
    assertTrue(askJs.contains(AdvancePolicy.LOOP_OFF))
    assertFalse("'single' 由原生 repeat 接管，不应问 JS", askJs.contains(AdvancePolicy.LOOP_SINGLE))
  }

  @Test
  fun loopModeNeverRestartsTheWholeNativeWindowAtTail() {
    // REPEAT_MODE_ALL 会让窗口绕回自己（把早播过的歌当列表循环重播），所以任何模式下都不许用它。
    for (loopMode in loopModes) {
      assertNotEquals(loopMode, Player.REPEAT_MODE_ALL, policyOf(loopMode).repeatMode())
    }
  }

  // ---------------------------------------------------------------- 窗口内还有项时

  @Test
  fun remainingItemsAdvanceToTheNextOneUnlessNativeRepeatsOne() {
    for (loopMode in listOf(AdvancePolicy.LOOP_OFF, AdvancePolicy.LOOP_ALL)) {
      assertEquals(
        "$loopMode: 窗口里还有下一项 → 顺序推进",
        WindowSettlement.EndedAction.ADVANCE_NEXT,
        WindowSettlement.endedAction(loopMode, remainingAfterCurrent = 1)
      )
    }
    assertEquals(
      "'single' 由 REPEAT_MODE_ONE 内部循环，走到 ENDED 只会是防御分支 → 重播当前曲",
      WindowSettlement.EndedAction.RESTART_CURRENT,
      WindowSettlement.endedAction(AdvancePolicy.LOOP_SINGLE, remainingAfterCurrent = 1)
    )
  }

  // ---------------------------------------------------------------- 水位与护栏

  @Test
  fun lowWaterTriggersWhenAtMostOneItemIsAhead() {
    val policy = AdvancePolicy()
    assertTrue(policy.isLowWater(AdvancePolicy.LOW_WATER))
    assertTrue(policy.isLowWater(0))
    assertFalse(policy.isLowWater(AdvancePolicy.LOW_WATER + 1))
  }

  @Test
  fun skipLimitIsSharedBySessionSkipAndPerTrackRetry() {
    val policy = AdvancePolicy().apply { skipLimit = 2 }
    assertTrue(policy.maySkip(0))
    assertTrue(policy.maySkip(1))
    assertFalse("到上限即停", policy.maySkip(2))
    assertFalse(policy.mayRetry(2))
    policy.autoSkip = false
    assertFalse("关掉自动跳歌后任何次数都不跳", policy.maySkip(0))
  }
}
