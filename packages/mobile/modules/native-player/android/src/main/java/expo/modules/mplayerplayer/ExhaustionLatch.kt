package expo.modules.mplayerplayer

/**
 * 终局闩（#563）：在当前 (revision, index) 上已判定「补窗也推进不了」。
 * ## 它挡的是什么窗口尾部零新增的补窗若只是把「用户想下一首」的意图丢掉，用户既没推进也没结束，而每
 * 1s 的 LOW_WATER tick 会永远重复要歌（真机实测 25s / 13 次 headless）。
 */
internal class ExhaustionLatch {

  /** 已闩坐标；null = 未闩。单一字段使「只置一半 / 只清一半」无法表达。 */
  @Volatile
  private var latched: Coord? = null

  private data class Coord(val revision: Long, val index: Int)

  /** 置位：钉住 (atRevision, atIndex)。 */
  fun mark(atRevision: Long, atIndex: Int) {
    latched = Coord(atRevision, atIndex)
  }

  /** 清除：回到未闩。 */
  fun clear() {
    latched = null
  }

  /** 查询：该坐标是否已被判定「补窗也推进不了」。 */
  fun isLatchedAt(atRevision: Long, atIndex: Int): Boolean {
    val current = latched ?: return false
    return current.revision == atRevision && current.index == atIndex
  }
}
