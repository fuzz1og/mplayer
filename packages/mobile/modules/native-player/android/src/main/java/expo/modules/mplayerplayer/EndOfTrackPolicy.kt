package expo.modules.mplayerplayer

import org.json.JSONObject

/**
 * #666 下推的曲末策略表（core `buildEndOfTrackPolicy` 的产物）：字段全是**查表值**，
 * 原生不得再解释 loopMode。null = 缺表 → 走 [WindowSettlement.fallbackEndedAction]。
 * 纯数据 + org.json，**不引入**任何 Android / media3 类型。
 */
data class EndOfTrackPolicy(
  /** 单曲循环 → 曲末重播当前曲（repeatMode 与曲末都读它）。 */
  val restartOnSingle: Boolean = false,

  /** 窗口里有下一项时是否顺序推进；false 时曲末 HOLD（不向 JS 要歌）。 */
  val advanceWithinWindow: Boolean = true,

  /** 窗口尾动作：只认 [AT_WINDOW_TAIL_HOLD]，其余一律 ask-js。 */
  val atWindowTail: String = AT_WINDOW_TAIL_ASK_JS,

  /** 随机播到头怎么办；目前唯一实现 `stop`（`wrap` 只是类型占位，Kotlin 不解释它）。 */
  val shuffleEndPolicy: String = SHUFFLE_END_STOP
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put(KEY_RESTART_ON_SINGLE, restartOnSingle)
    put(KEY_ADVANCE_WITHIN_WINDOW, advanceWithinWindow)
    put(KEY_AT_WINDOW_TAIL, atWindowTail)
    put(KEY_SHUFFLE_END_POLICY, shuffleEndPolicy)
  }

  companion object {
    const val AT_WINDOW_TAIL_ASK_JS = "ask-js"
    const val AT_WINDOW_TAIL_HOLD = "hold"
    const val SHUFFLE_END_STOP = "stop"

    private const val KEY_RESTART_ON_SINGLE = "restartOnSingle"
    private const val KEY_ADVANCE_WITHIN_WINDOW = "advanceWithinWindow"
    private const val KEY_AT_WINDOW_TAIL = "atWindowTail"
    private const val KEY_SHUFFLE_END_POLICY = "shuffleEndPolicy"

    /** 快照读回：缺键 / JSON null → 缺省表（ask-js 尾），**绝不**凭空造出 HOLD。 */
    fun fromJson(json: JSONObject?): EndOfTrackPolicy? {
      if (json == null) return null
      return EndOfTrackPolicy(
        restartOnSingle = json.optBoolean(KEY_RESTART_ON_SINGLE, false),
        advanceWithinWindow = json.optBoolean(KEY_ADVANCE_WITHIN_WINDOW, true),
        atWindowTail = json.optString(KEY_AT_WINDOW_TAIL, AT_WINDOW_TAIL_ASK_JS),
        shuffleEndPolicy = json.optString(KEY_SHUFFLE_END_POLICY, SHUFFLE_END_STOP)
      )
    }
  }
}
