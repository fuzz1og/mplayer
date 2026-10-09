package expo.modules.mplayerplayer

/**
 * 终局闩（#563）：在当前 (revision, index) 上已判定「补窗也推进不了」。
 *
 * ## 它挡的是什么
 * 窗口尾部零新增的补窗若只是把「用户想下一首」的意图丢掉，用户既没推进也没结束，
 * 而每 1s 的 LOW_WATER tick 会永远重复要歌（真机实测 25s / 13 次 headless）。闩把
 * 「这一格没得推」钉在当前 (revision, index) 上，让 `maybeRequestTracks(LOW_WATER)` 直接返回。
 *
 * ## 为什么是 (revision, index) 两个坐标
 * 补窗只是把一个预取窗口喂给原生，「当前曲之后还有没有可推进项」只由这两个量决定。
 * 任一变（切歌 / 新队列 / 显式跳曲）旧判定就失效 —— [isLatchedAt] 用坐标比较代替显式清理，
 * [clear] 只在「坐标没变但意图变了」（play/next/prev）的场合兜底。
 *
 * ## 为什么收成一个类型（#609）
 * 此前坐标是 `PlayerService` 里两个并列的 `@Volatile` 字段（`exhaustedAtRevision` /
 * `exhaustedAtIndex`）+ 三个私有方法 + 7 处各自 clear。只要有一处只写其中一个坐标，
 * 判定就退化成永假/永真，**且不会有任何编译错误**。坐标现在 private，服务只能经
 * [mark] / [clear] / [isLatchedAt] 读写；单一 `latched` 引用也顺带消掉了
 * 「两个 volatile 字段读到撕裂组合」的可能。
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
