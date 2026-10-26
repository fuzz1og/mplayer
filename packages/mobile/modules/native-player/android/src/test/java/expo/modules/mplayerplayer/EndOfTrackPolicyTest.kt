package expo.modules.mplayerplayer

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #666 表随 policy 落盘 / 读回：快照缺键必须回到「缺表」（兜底），不能凭空造出 hold。
 * 纯 org.json，不碰 Android。
 */
class EndOfTrackPolicyTest {

  private val holdTable = EndOfTrackPolicy(
    restartOnSingle = false,
    atWindowTail = EndOfTrackPolicy.AT_WINDOW_TAIL_HOLD
  )

  @Test
  fun jsonRoundTripKeepsEveryField() {
    val restored = EndOfTrackPolicy.fromJson(JSONObject(holdTable.toJson().toString()))
    assertEquals("表必须逐字段往返，掉一行就退回兜底语义", holdTable, restored)
    assertEquals(EndOfTrackPolicy.AT_WINDOW_TAIL_HOLD, restored?.atWindowTail)
  }

  @Test
  fun restartOnSingleSurvivesTheRoundTripOnItsOwn() {
    val single = holdTable.copy(restartOnSingle = true, atWindowTail = EndOfTrackPolicy.AT_WINDOW_TAIL_ASK_JS)
    val restored = EndOfTrackPolicy.fromJson(JSONObject(single.toJson().toString()))
    assertTrue("restartOnSingle 丢了 → 单曲循环曲末会变成问 JS", restored?.restartOnSingle == true)
    assertEquals(EndOfTrackPolicy.AT_WINDOW_TAIL_ASK_JS, restored?.atWindowTail)
  }

  @Test
  fun missingKeyReadsBackAsNoTableInsteadOfAnInventedOne() {
    // 快照里根本没有 endOfTrack 键 → optJSONObject 返回 null → 缺表 → 走兜底。
    val snapshot = JSONObject("""{"loopMode":"all"}""")
    assertNull("快照里没这张表 → 缺表 → 兜底", EndOfTrackPolicy.fromJson(snapshot.optJSONObject("endOfTrack")))
  }

  @Test
  fun partialTableDefaultsToTheNonTerminalTail() {
    // 旧快照 / 手写脏数据：缺 atWindowTail 时**只能**落到 ask-js；落到 hold 会把队列永久停住。
    val partial = EndOfTrackPolicy.fromJson(JSONObject("""{"restartOnSingle":true}"""))
    assertEquals(EndOfTrackPolicy.AT_WINDOW_TAIL_ASK_JS, partial?.atWindowTail)
    assertTrue(partial?.restartOnSingle == true)
  }

  @Test
  fun defaultTableIsTheInnocuousOne() {
    val default = EndOfTrackPolicy()
    assertFalse("默认不重播（重播由 loopMode 兜底决定，不靠表）", default.restartOnSingle)
    assertEquals(EndOfTrackPolicy.AT_WINDOW_TAIL_ASK_JS, default.atWindowTail)
  }

  @Test
  fun storedTableStaysRecognisableThroughTheSnapshotShape() {
    // 落盘用的就是 toJson 的形状：readBack 之后仍必须被判成 hold，否则重启后曲末会改问 JS。
    val snapshot = JSONObject().apply { put("endOfTrack", holdTable.toJson()) }
    val restored = EndOfTrackPolicy.fromJson(snapshot.optJSONObject("endOfTrack"))
    assertEquals(EndOfTrackPolicy.AT_WINDOW_TAIL_HOLD, restored?.atWindowTail)
    assertEquals(
      WindowSettlement.EndedAction.HOLD,
      WindowSettlement.endedAction(restored, AdvancePolicy.LOOP_ALL, hasNextInWindow = false)
    )
  }
}
