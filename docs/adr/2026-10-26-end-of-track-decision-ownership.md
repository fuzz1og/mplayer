# ADR: 曲末决策上提 core——core 出决策表，原生只执行

- 状态：**提议（待拍板）**——待定的是**实现方式**（采纳 (c) 与四步切分），**不是 `shuffleEndPolicy` 的取值**：那个已定为 `'stop'`（见决策第 4 条）。本 ADR 只定取舍与建议，**代码未动**；实施另开票（#650 只修 T8 守卫）
- 日期：2026-10-26
- 关联：**#650**（本决策的触发票，T8 伪推进已修）· #639 R4（本决策的来源）· #591 / ADR `2026-10-07-window-patch-settle-contract.md`（补窗结算契约）· 上游 ADR `2026-09-29-native-playback-ownership.md`（原生持队列 / 原生推进 / I5 / I6）· `2026-09-30-stable-shuffle-order.md`（随机序的单一来源在 core）

## 背景

「一首歌自然播完之后走哪一步」这个决策，**今天完全长在 Kotlin**：

| 落点 | 决策内容 |
|---|---|
| `WindowSettlement.endedAction(loopMode, remainingAfterCurrent)` | 单曲循环重播自己 / 窗口内还有项就顺序推进 / 到窗口尾就向 JS 要歌（`RESTART_CURRENT` / `ADVANCE_NEXT` / `ASK_JS`） |
| `AdvancePolicy.repeatMode()` | `loopMode` → `REPEAT_MODE_ONE` / 恒 `REPEAT_MODE_OFF`（绝不用 `REPEAT_MODE_ALL`：原生列表只是 JS 队列的一个窗口） |
| `PlayerService.handleEnded()` | 按上面两条执行副作用（`seekTo(0)` / `seekToNextMediaItem()` / 置 `holePending` + 要歌 + 60s 截止） |

JS 侧**没有**对应物：core 里 grep 不到任何「曲末」语义（无 `EndReason` / `onEnded` / `planEnd` 这类导出），
`services/nativePlayer.ts` 只在原生**已经**要歌时被动补窗（`needTracks` / `queueEnded` → `feedWindow`）。

这与 ADR `2026-09-29-native-playback-ownership` 决策 5（**策略语义单一来源在 core，原生只做最小兜底**）是冲突的：
core 有 `planAdvance` / `stepShuffle` / `getNextSongIndex` 三套「下一首是谁」的语义，Kotlin 又自己长了一套
「曲末是谁」的语义。**两套语义的分叉已经付过账**：#639 R4.1（`repeatMode` 与 `handleEnded` 对同一份 `loopMode`
语义相反 → 「向 JS 要歌」整条路径是死代码）、R4.4（回前台不对账）、R4.5（stale 丢弃结算结论），
以及本票的 #650（T8 把「没有推进」伪装成「续播成功」）。四次的形状相同：**同一份语义有两个作者**。

## 决策

**推荐 (c) 中间态：core 出「曲末决策表」，原生查表执行。**

具体形状：

1. core 新增一个纯函数（暂定 `planEndOfTrack`，与 `planAdvance` 同族、同 `AdvanceInput` 风格）：
   入参 = `{ playMode, shuffle, shuffleScope, hasNextInWindow, windowSaturated, shuffleEndPolicy }`，
   出参 = `{ action: 'restart-current' | 'advance-next' | 'ask-js' | 'hold', shuffle? }`。
2. 该函数的结论**在 JS 仍然在场时**（`loadQueue` / `patchQueue` / `setPolicy` 的常规投喂轮）算好，
   作为 policy 快照的一部分下发原生（例如 `endOfTrack: { restartOnSingle, advanceWithinWindow, atWindowTail, shuffleEndPolicy }`），
   与现有 `loopMode` / `autoSkip` / `prefetchAhead` 同一条通道、同一份 revision。
3. Kotlin 侧 `WindowSettlement.endedAction` **退化为查表**（吃下发来的表 + 原生已知的几何事实
   `remainingAfterCurrent`），`handleEnded()` 仍只做副作用。**没有表时**保留今天这份内联兜底
   （冷启 / `MediaLibraryService` 重启 / JS 从未投喂过的极端路径），并用 JUnit 钉住兜底与查表两条路径同形。
4. 随机模式「播到头」从「猜 `deduped`」变成一个**显式 policy 字段** `shuffleEndPolicy`——这正是 #650 里
   `deduped` 分不清「真到头」与「本轮没新候选」的病根：那个区分不是原生能看见的事实，必须由握着完整队列与随机序的 core 明确表态。

   **取值已定 = `'stop'`**（2026-10-26 拍板：随机播到头就停，不绕回）。本 ADR 待定的**不是取值，而是实现方式**——
   怎么让 core 把「真到头」这个事实明确表态给原生，而不是让原生从 `deduped` 反推。字段保留 `'wrap'` 这个可能值
   只是为将来的产品变更留位置，**当前唯一实现是 `'stop'`**。

**为什么是 (c) 而不是 (b)（曲末发事件给 JS、JS 算完回喂）**：见下方权衡表——(b) 在后台与重启两条路径上
直接违反 I6，且事件往返会在曲末制造可听见的空档。

**为什么不选 (a)（保持 Kotlin 决策，只靠测试与 core 对齐）**：测试只能钉住「Kotlin 与它自己一致」，
钉不住「Kotlin 与 core 一致」——core 改 `stepShuffle` 的绕回语义时，Kotlin 侧用例照绿，分叉照样发生。
R4.1/R4.4/R4.5/#650 四次都是这么来的。

## 备选与否决

| 备选 | 描述 | 否决 / 保留理由 |
|---|---|---|
| **(a) 保持 Kotlin 决策** | 判定留在 `WindowSettlement`，把语义写进文档 + JUnit 对齐 core | **不采纳为主方案，但作为兜底保留**：判定位置不动、成本最低，且 #640 之后它已经可被 JVM 单测钉住。致命处是它**只钉一致性、不产生单一来源**——core 漂移时 Kotlin 测试不会红。R4 的原话就是「决策仍全部在 Kotlin」，(a) 等于把 R4 判成 wontfix |
| **(b) 曲末发事件给 JS，JS 用 core 纯函数算完回喂** | 原生只发 `trackEnded`，等 JS 回一条 `advanceTo(...)` | **否决**。三条硬约束各撞一次：① **后台 JS 可能不在场**——ADR `2026-09-29-native-playback-ownership` 的根因（#405）就是后台 `playbackStatusUpdate` 不投递，RN 的 `JavaTimerManager` 在 `onHostPause` 后不派发定时器；② **`MediaLibraryService` 重启后 JS 未起**——`onPlaybackResumption` 能在纯原生路径上恢复队列与进度（锁屏点播放即可续），此时没有任何 JS 可问；③ **I6（推进不得依赖 JS 定时器）** 会被直接违反。附带的代价：事件往返 + 解析窗口会在每首歌之间制造可听见的空档，还要新增反向命令通道与「等 JS 超时」的第二套语义 |
| **(c) core 出决策表、原生执行**（**推荐**） | 决策在 core 算好，以 policy 数据下推，原生查表 + 兜底 | **采纳**。语义单一来源回到 core（可被 core 的单测与双端复用），执行仍留在原生（I6 不受影响，后台与重启路径不变），下推发生在 JS 必然在场的投喂轮，不在曲末临界点上赌 JS 活着 |

### 权衡明细（为什么「下推表」比「曲末问 JS」便宜）

| 约束 | (b) 曲末问 JS | (c) 下推表 |
|---|---|---|
| **1s 进度粒度** | 曲末判定不能靠 `progress` 事件（1s 一次，误差最大 1s），只能靠 `STATE_ENDED` 回调——那本身就是原生事件，绕一圈只为回到原生 | 判定在补窗轮算好（秒级预算内），与进度粒度无关 |
| **后台 JS 可能不在场** | 直接失效：后台没有定时器派发，headless 任务也只在原生显式 `startTask` 时存在 | 不受影响：表早在进后台之前就下推过 |
| **`MediaLibraryService` 重启后 JS 未起** | 无解：没有 JS 进程可问 | 有解：表随 policy 一起持久化（与 `loopMode` 同落点），恢复后直接查表；缺表走内联兜底 |
| **事件往返延迟** | 曲末多一次「暂停 → 等 JS → 起播」，最坏落到 60s hole 截止；用户听到的是歌与歌之间的空档 | 零往返：曲末是本地查表 + 一次 player 调用 |
| **语义漂移风险** | 无（唯一来源） | 无（唯一来源），且漂移会被 core 单测当场抓住 |
| **实现成本** | 高：反向命令通道 + 超时语义 + 后台降级路径 | 中：一个 core 纯函数 + 一个 policy 字段 + Kotlin 查表（`WindowSettlement` 已存在，#640 已可测） |

## 后果

### 得到

- 「曲末怎么走」只有一个作者（core），Kotlin 退化为查表 + 副作用，与 ADR `2026-09-29-native-playback-ownership`
  决策 5（策略语义单一来源在 core）重新对齐；R4 从「判定仍在 Kotlin」变成可验收。
- 随机模式「播到头」从**猜信号**（`deduped`）变成**显式策略**（`shuffleEndPolicy`，取值已定 `'stop'`），
  #650 那条「分不清真到头还是本轮没新候选」的注释可以整段删掉。
- 决策表可被 core 的单测覆盖（双端同一份），不再依赖真机摆场景。

### 代价与残余风险

- **多一个跨端字段**：policy 快照要扩，原生 `PatchQueueInput` / `loadQueue` 入参要同步，JS 假桥测试要跟着改
  （与 #591 的 `outcome` 同型，成本已量过一次）。
- **兜底路径必须继续存在且被测**：表缺失（冷启、快照损坏、老版本 JS 与新原生混跑）时原生仍要能正确曲末推进，
  否则会把「跨端契约」变成「跨端耦合」。这条兜底的存在意味着**语义仍有两份实现**——只是其中一份被降级为
  「仅在表缺席时生效」，且两边的同形性由 JUnit 钉住。
- **实施不是零行为变化**：`repeatMode()` 与 `endedAction()` 的耦合要在同一次改动里拆开，属于原生行为变更，
  按 ADR `2026-09-29-ci-verification-boundary` 需要真机验收（本机无真机/无 AVD，验收成本落在人工）。
- **不解决**：`deduped` 信号本身的表达力（它仍然只是「本轮没新候选」），本 ADR 只是**不再让它承担终局语义**。

### 建议的实施切分（另开票，本 ADR 不动代码）

1. core：`planEndOfTrack` + 单测（三种 `playMode` × 窗口内有/无下一项 × 饱和/不饱和 × `shuffleEndPolicy` 当前唯一取值 `'stop'`；
   绕回不实现，测试只需覆盖 `'stop'`）。
2. 契约：policy 快照加 `endOfTrack` 字段；原生入参同步；JS 假桥测试跟着改。
3. Kotlin：`WindowSettlement.endedAction` 改为「查表优先、缺表兜底」，并补 JUnit（两条路径同形）。
4. 真机：曲末三模式 + 后台 + 锁屏 next + 服务重启后恢复，逐条取证（本机做不了，交人工）。

## 参考

- 票：**#650**（本 ADR 的触发票）· #639 R4（「把曲末怎么走的决策从 Kotlin 上提 core，原生只执行」）
- 上游契约：`docs/adr/2026-09-29-native-playback-ownership.md`（I5 策略单一来源 / I6 不依赖 JS 定时器 / 决策 1 原生持队列）
  · `docs/adr/2026-10-07-window-patch-settle-contract.md`（补窗结算 outcome 是显式入参——本 ADR 的同型先例）
  · `docs/adr/2026-09-30-stable-shuffle-order.md`（随机序在 core）
- 落点：`packages/mobile/modules/native-player/android/src/main/java/expo/modules/mplayerplayer/WindowSettlement.kt`（`endedAction` / `resumeAfterPatch`）
  · `AdvancePolicy.kt`（`repeatMode`）· `PlayerService.kt`（`handleEnded`）· `packages/core/src/utils/queue.ts`（`planAdvance`）· `shuffleOrder.ts`（`stepShuffle`）
