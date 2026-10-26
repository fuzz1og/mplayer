package expo.modules.mplayerplayer

import org.json.JSONObject

/**
 * #666 下推的曲末策略表（core `buildEndOfTrackPolicy` 的产物）：两格全是查表值，原生不再解释 loopMode。
 * null = 缺表 → 走 [WindowSettlement.fallbackEndedAction]。纯数据 + org.json，不引入 Android 类型。
 * **只有两格**：core 恒为常数、或原生没有读点的字段不许进来——死格子迟早被读成反向语义。
 */
data class EndOfTrackPolicy(
  /** 单曲循环 → 曲末重播当前曲（repeatMode 与曲末都读它）。 */
  val restartOnSingle: Boolean = false,

  /** 窗口尾动作：只认 [AT_WINDOW_TAIL_HOLD]，其余一律 ask-js（缺键也必须落到 ask-js）。 */
  val atWindowTail: String = AT_WINDOW_TAIL_ASK_JS
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put(KEY_RESTART_ON_SINGLE, restartOnSingle)
    put(KEY_AT_WINDOW_TAIL, atWindowTail)
  }

  companion object {
    const val AT_WINDOW_TAIL_ASK_JS = "ask-js"
    const val AT_WINDOW_TAIL_HOLD = "hold"

    private const val KEY_RESTART_ON_SINGLE = "restartOnSingle"
    private const val KEY_AT_WINDOW_TAIL = "atWindowTail"

    /** 快照读回：缺键 / JSON null → 缺表或 ask-js 尾，**绝不**凭空造出 HOLD。 */
    fun fromJson(json: JSONObject?): EndOfTrackPolicy? {
      if (json == null) return null
      return EndOfTrackPolicy(
        restartOnSingle = json.optBoolean(KEY_RESTART_ON_SINGLE, false),
        atWindowTail = json.optString(KEY_AT_WINDOW_TAIL, AT_WINDOW_TAIL_ASK_JS)
      )
    }
  }
}
