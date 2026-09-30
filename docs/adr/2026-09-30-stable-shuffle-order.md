# ADR: 随机播放重建为稳定随机序列

- 状态：已接受
- 日期：2026-09-30
- 关联：**#511**（本决策）· #491 / PR #506（桌面「下一首播放」，随机分支刻意留空等本票）· #494 / #495（移动端原生插队原语 + JS 接缝）· `2026-09-29-native-playback-ownership.md`（移动端「JS 定序、原生顺序推进」的前置决策）

## 背景

#511 已核实：随机播放今天**没有「序列」这个概念**。

- core `utils/queue.ts` 的 `nextRandomIndex` 是 do/while **现抽一个 ≠ currentIndex 的下标**：无记忆、无可持久化状态。
- `getNextSongIndex` 与 `getPrevSongIndex` **共用**它 → 随机模式下「上一首」不是回上一张，而是再抽一次（与随机序同源的在库 bug）。
- 桌面 `currentPlaylist` 就是插入顺序，`QueuePage` 直接渲染它；移动端原生队列是 JS 按 `planNextIndexes` 排的预取窗口（补窗重排后会漂）。两端都没有「随机序」。
- 于是「在随机序列里插到当前曲的下一格」**没有落点**：桌面 #506 的 `insertNext`、移动端 #495 的 `planPlayNext` 都显式把随机的语义留空等本票。（`planPlayNext` 在 **PR #515** 的 `packages/mobile/services/queueInsert.ts`，尚未合入 master；master 上移动端的等价接缝是 `packages/mobile/services/queuePrefetch.ts` 的 `planNextIndexes`。）

用户诉求三条：随机下「下一首播放」插到当前曲下一格；「上一首」回上一张；队列页看得到随机顺序。

## 决策

1. **随机是一等模型**：`ShuffleState = { order: string[]; cursor: number }`，实现收敛到 core `utils/shuffleOrder.ts`（纯函数、零 I/O、零模块级状态，直接可 JSON 序列化）。`order` 存**歌曲 id** 的排列而不是下标——删歌/换源/拖拽后下标会漂，id 才是稳定身份（与本仓队列身份口径一致）。
2. **游标语义**：`cursor` = **当前播放曲在 `order` 中的下标**；`-1` = 尚无当前曲（语义上在序列起点之前）。`next` = `cursor+1`、`prev` = `cursor-1`，两端回绕；游标越界（持久化损坏）一律按 `-1` 处理（next 从序列开头、prev 从末尾）。
3. **洗牌**：Fisher–Yates，`rng` 可注入（测试复现整条顺序）。`createShuffleState(queue, { rng, currentIndex })` 在 `currentIndex` 合法时把游标落在当前曲上，「下一首」从当前曲之后继续、「上一首」回到它在序列里的前一张。
4. **增量对齐，不重洗**：队列成员变化（加歌补在序列末尾、删歌摘除、换源**就地**换 id）只做成员对齐——顺序在会话内稳定。只有**整批换队列**（`setCurrentPlaylist` 且 id 集合变化）才重洗；封面回填这种「同一批歌的新对象」保持既有顺序。
5. **行为变更（reviewer 风险点）**：`getNextSongIndex` / `getPrevSongIndex` 的随机分支在**传入序列**时消费游标；**不传**时保留旧的「防重复现抽」行为（只为不破坏既有调用方，core 测试单独钉住这条兼容路径）。因此随机模式「上一首」从此回序列上一张，不再是新随机曲。`pickNextSongAfterFailure` 也新增可选 shuffle：失败跳歌沿序列找候选，不另开一条现抽路径。
6. **桌面**：playerStore 持有 `shuffle`（`null` = 未建立，进随机时现洗一份）；`mplayer_queue` 落盘带 `shuffle`（重启顺序与游标不变）；`QueuePage` 随机模式下按 `applyShuffleOrder` 显示**随机序**，拖拽改的是序列本身（`reorderShuffle`），移除按 id 映射回成员下标。换回列表循环时序列**保留但不参与**。
7. **双端单一来源**：随机定序语义只有 core 一份；移动端接线由 #495 的 owner 照下面的契约实现，本 PR 不碰 `packages/mobile`。

### 移动端消费契约（#495 接缝）

本 ADR 是双端的唯一契约。移动端（Android 原生队列 + iOS/回落引擎）照此接线：

- **可序列化形态**：`{ order: string[]; cursor: number }` 本身即存储形态，直接 JSON 持久化/恢复；`order` 必须是队列 id 的排列，恢复时用 `syncShuffleCursor(state, queue, currentIndex)` 对齐（丢多余的、补缺的、游标对到当前曲）。
- **取下一首 / 上一首（纯查询，不改 state）**：`getNextSongIndex(queue, currentIndex, playMode, shuffle)` / `getPrevSongIndex(...)`。传入 state 时函数会**先把游标对到 `queue[currentIndex]`** 再前进/后退一格并映射回队列下标——调用方只要给出「当前在哪」即可，不必自己维护游标。预取窗口要同时拿推进后的 state 就用 `stepShuffle(state, queue, ±1) → { index, state }`。
- **「下一首播放」/ 原生 `insertAfterCurrent`**：`insertNextInShuffle(state, queue, songId, currentIndex)`。语义与桌面 #506 逐条对齐，也与移动端 #515 的 `planPlayNext`（`packages/mobile/services/queueInsert.ts`，**随 #515 合入后生效**）对齐：已在序列 → **移动**（不复制，保留队列里那份 Song 对象）；不在 → 插入；已在「当前曲下一格」或点的是当前曲 → **no-op**（连点幂等）。调用方负责把 songId 先加进**队列成员**（追加即可），序列插入由该函数负责。**#515 合入前**，master 上移动端的等价接缝是 `queuePrefetch.ts` 的 `planNextIndexes`——它只定序预取窗口，尚无「插到当前曲下一格」这个动作。#515 的 `planPlayNext` 现在 `void playMode`（随机留空）：落地随机分支时用「当前曲在序列里的下一格」这一份语义，Android 原生只按最终顺序 `append`（沿用 `2026-09-29-native-playback-ownership.md` 的「JS 定序、原生顺序推进」，不用 `setShuffleModeEnabled`）。
- **预取窗口**：`applyShuffleOrder(queue, state)` 返回**按随机序重排的完整队列**（等长、纯展示/取窗），移动端按原生当前位置切片取窗，替代现在按 `planNextIndexes` 现算的窗口。
- **成员编辑**：删歌用 `syncShuffleCursor`（或 `normalizeShuffleOrder`）对齐；原位换源用 `replaceShuffleSongId(state, fromId, toId)`（同格换 id、顺序不动）。

## 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| 方案 B：只加「用户显式指定的下一首」覆盖位（播一次即清） | 不修「上一首」的 bug、队列仍看不到随机序，三条诉求只满足一条（#511 正文已对比） |
| 把 `currentPlaylist` 物理洗成随机序（随机 = 洗一次然后顺序播） | 随机序与成员序塌成一份：换回列表循环拿不回原顺序，拖拽/移除语义混乱；移动端原生队列也需要「成员 + 顺序」两份 |
| 用 media3 `setShuffleModeEnabled(true)` | 置换式且不外露顺序 → 预取窗口算不出下一首、锁屏 next 与 UI next 漂移（`2026-09-29-native-playback-ownership.md` 已否决） |
| 每次都重洗（随机序只活在当次 next） | 就是现状：无记忆 → 上一首回不去、无法持久化、插入位无落点 |

## 后果

- **得到**：随机模式「上一首」回序列上一张；「下一首播放」在随机下插到当前曲下一格（桌面 #506 与移动端 #495 从此有共同落点）；队列页看得到随机序；重启后顺序与游标不变；随机定序双端只有 core 一份实现。
- **代价 / 取舍**：随机序**跨会话稳定**意味着进随机不再每次重洗——切回列表循环再进随机沿用同一序列（要换顺序得重进队列/换歌单）。这是「稳定」与「每次都新」的取舍，#511 的诉求（上一首能回退）要求可回退的序列，故选稳定。
- **残余**：`setCurrentPlaylist` 以「id 集合是否相同」区分「整批换队列」与「原地改」——同一批歌但用户本意是重开队列时不会重洗（顺序仍合法，仅不新）。随机序的**重新洗牌入口**（用户手动「重排随机」）本票未做。
- **未做（out of scope）**：移动端接线（#495 owner 照上表契约）；不改播放解析链与时限层次；不用 ExoPlayer 原生 shuffle。

## 参考

- issue #511 · PR #506（桌面「下一首播放」）· #494 / #495（移动端）
- core `packages/core/src/utils/shuffleOrder.ts`、`packages/core/src/utils/queue.ts`、`packages/core/src/shared/skipGuard.ts`
- 桌面 `src/renderer/store/playerStore.ts`、`src/renderer/utils/queueUtils.ts`、`src/renderer/pages/QueuePage.tsx`
- 移动端接缝：master 上是 `packages/mobile/services/queuePrefetch.ts` 的 `planNextIndexes`；`packages/mobile/services/queueInsert.ts` 的 `planPlayNext` 随 **PR #515**（#495）合入后生效。本 PR 不改 `packages/mobile`。
- `2026-09-29-native-playback-ownership.md`（JS 定序、原生顺序推进）
