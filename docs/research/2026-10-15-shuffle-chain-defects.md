# 随机播放链路缺陷盘点（2026-10-15）

> 存档类调研。三路并行走查（移动 JS / 移动原生 / 桌面 + core）的结果汇总，共 20 条，
> 归类为 **4 个根因**。后续 issue 的共同依据；重查成本高，故留档。
>
> 与既有决策的关系：本盘点**不推翻** ADR `2026-09-30-stable-shuffle-order`（稳定随机序列）
> 与 `2026-09-29-native-playback-ownership`（原生持队列 + 原生推进）。恰恰相反——
> 多数缺陷是这两份决策**未被贯彻**的结果（见 R1「已裁决未贯彻」）。

## 一句话结论

队列状态是**一份**东西（成员 + 下标 + 随机序 + 游标），但它被存在 **2 个地方**
（JS store、原生窗口）、从 **~20 个位置**改，**没有任何模块拥有这条不变量**。
每一类缺陷都是「两份数据里只动了一份」，或「同一份语义有两套进入口径」。

## 坏消息里的好消息

core 的**纯函数层质量很高**。逐条探针验证过、**未发现缺陷**的部分：

- `stepShuffle` 回绕 / 游标越界按 `-1` 处理 / 单元素归位
- `insertNextInShuffle` 幂等，以及「摘除源后锚点左移」的重算
- `alignShuffleOrder` 的 `authoritative` vs `window` 两种作用域
- `parseShuffleState` 的形状校验 + `syncShuffleCursor` 兜底（cursor 非整数 / 越界 / order 残缺 / 含幽灵 id 的自愈）
- 桌面 `QueuePage` 的显示序与 `reorderShuffle` 归一后的 `order` **长度恒等**（无重复 id 时），
  「拖最后几行被静默拒绝」在无重复 id 时不成立
- 模式切换（进随机现洗且游标落当前曲、切回列表序列保留不参与、再进随机沿用同序）

**缺陷不在数学，在接线。**

---

## R1 · 作用域隐含前提（8 条，最重 · 不可逆）

**问题**：`setQueue` / `ensureShuffle` / `advance` 的现洗分支把「手里的 queue 是**权威成员集**
还是**原生预取窗口**」当成隐含前提。而 `#543` 的结论恰恰是「**作用域必须是显式参数**」。

这条决策的原文就在 core 里（`shuffleOrder.ts` 的 `ShuffleScope` 注释）：

> 这个区别此前只活在移动端的注释里（`services/shuffleMode.ts` 文件头），两端各写一份对齐函数，
> 且规则**已经分叉**。

所以 R1 是**已裁决未贯彻**，不是新设计——core 早已把 scope 参数化，是四个调用点没遵守。

| # | 位置 | 症状 | 强度 |
|---|---|---|---|
| R1.1 | 移动 `stores/playerStore.ts:200-205`（`setQueue` 判据），入口 `QueueListModal.tsx:91`、`SongRow.tsx:131` | 窗口被按 authoritative 裁剪 → 随机序**永久截断**并立刻落盘，窗口外的歌永不再现、重启也回不来 | CONFIRMED（探针 12→5） |
| R1.2 | 移动 `stores/playerStore.ts:292`（`shuffleScope:'window'`）→ core `shuffleOrder.ts:153-155` | 序列里窗口外 id 挡路 → `advance` 返回 `effect:'none'`，「点下一首没反应」；iOS 回落引擎下退化成重播当前曲 | CONFIRMED |
| R1.3 | 移动 `stores/playerStore.ts:244-251, 285`、`shuffleMode.ts:78-89`，入口 `nativePlayer.ts:561` | 无序列时拿**窗口**现洗一份并落盘 → 截断的第二个入口，不需用户点队列页 | CONFIRMED |
| R1.4 | 移动 `shuffleMode.ts:41-44` + `stores/playerStore.ts:200-205` | 截断后对同一批歌全量 `setQueue` → 判成「整批换歌单」→ **不该重洗却重洗** | CONFIRMED |
| R1.5 | 移动 `stores/playerStore.ts:306-312` + `songActionEffects.ts:30-40` | 截断后原位换源失效（`replaceShuffleSongId` 前置条件不满足）→ 触发整批重洗 | CONFIRMED |
| R1.6 | 移动 `stores/playerStore.ts:151-164`（`insertNext` 的 started 分支） | 队列非空 + `currentIndex < 0` 时把 `currentSong` 换成队列外的歌、`currentIndex` 仍 -1 → **next/prev 永久失效** | CONFIRMED |
| R1.7 | 移动 `SongRow.tsx:131` + `stores/playerStore.ts:200-205` | 单曲点播（无队列上下文）把随机序**压成 1 首**并落盘 | CONFIRMED |
| R1.8 | 桌面 `playerStore.ts:1003-1005`（`reorderShuffle` 首行 `if (!shuffle) return`）、`QueuePage.tsx:73` | 随机模式 + `shuffle===null`（存量存档）→ 队列页显示成员序、**拖拽静默失效**，首次 next 时顺序当场跳变 | CONFIRMED |

**为什么最重**：R1.1/R1.3/R1.7 的落盘是 fire-and-forget 且**无版本守卫**，
窗口态算出的短序列会**立刻覆盖**盘上那份完整序列 —— **不可逆**（重启也回不来）。

**同类隐患（另一套口径）**：`advance` 传 `'window'`，而 `audioPlayer.ts:456` 的 `prefetchNextSong`
与 core `pickNextSongAfterFailure`（内部走 `syncShuffleCursor` = authoritative）**不传** ——
同一份序列两套对齐口径，预取的那首与实际播的那首会分叉。

---

## R2 · 身份口径（2 条，重）

**问题**：随机序以裸 `Song.id` 为身份，而本仓身份口径是 `identityKey`（GLOSSARY「歌曲身份」
= 源 + 去源前缀 rawId）。

| # | 位置 | 症状 | 强度 |
|---|---|---|---|
| R2.1 | core `shuffleOrder.ts:210-223`（`applyShuffleOrder`），store 侧 `playerStore.ts:649/844/904`、`QueuePage.tsx:85` 全按裸 `s.id` | 队列出现同 id 字符串的两条成员（同歌双 id 形态 `456` vs `netease:456`，或跨源同 rawId `netease:123` / `kuwo:123`）时：队列页**少行**（某首歌永远看不到、拖不到）、行尾删除命中第一条同 id 成员 → **删错歌** | CONFIRMED（探针：返回 2 条 vs 队列 3 条） |
| R2.2 | core `shuffleOrder.ts:205-224`，消费方 `queuePrefetch.ts:100-103` | `applyShuffleOrder` 在重复 id 队列下**不等长**（违反自身注释承诺）→ 补窗计划漏投（窗口塌陷、踩空暂停）。移动端展示序已用 FIFO 版本 `shuffleDisplayIndexes` 绕开，但补窗/切片仍在用 `applyShuffleOrder` | CONFIRMED（core 契约违反）／真机可达性 PLAUSIBLE |

**附注**：`replaceShuffleSongId`（`shuffleOrder.ts:195-199`）在 `toId` 已存在于 order 时
会产生重复 id（探针：`{order:['A','B','C'],cursor:0}` + `replace(B→C)` → `["A","C","C"]`），
仅靠下游 `syncShuffleCursor` 的归一兜住。

---

## R3 · 落点同步遗漏（4 条，中）

**问题**：成员或播放曲变了，游标没跟（或反过来）。

| # | 位置 | 症状 | 强度 |
|---|---|---|---|
| R3.1 | 桌面 `playerStore.ts:863-877`（`insertNext` 列表分支缺「点的是当前曲 → no-op」守卫；随机分支 `:850` 有、core `insertNextInShuffle` 也有） | 列表/单曲模式下对**正在播放那行**点「下一首播放」→ 指针与当前曲脱节，再按「下一首」**重播当前曲** | CONFIRMED（探针实测 `load("2")`） |
| R3.2 | 桌面 `playerStore.ts:942-955`（删当前曲的续播落点用成员下标邻居） | 随机模式删掉正在播的那首 → 按**成员序**推进，与队列页显示的随机序不符（看到下一行是 D，播出来是 C） | CONFIRMED 行为 |
| R3.3 | 桌面 `playerStore.ts:510-520`（离线快速失败早退只换 `currentSong`） | 断网点另一首 → index/游标仍指上一首，恢复网络后「下一首」从旧位置推进 | PLAUSIBLE（读码确认无同步） |
| R3.4 | 移动 `stores/playerStore.ts:151-164`（同 R1.6，落点侧表述） | 见 R1.6 | CONFIRMED |

**附注**：`playerStore.shuffle.test.ts:407-458` 那条回归用例**正是依赖 R3.3 这条早退**
来隔离跳歌路径的游标写入 —— 说明作者知道这条路径跳过了队列同步，只是没当成缺陷。

---

## R4 · JS↔原生双份状态（7 条，最重 · 用户必现）

**问题**：模式 / 队列 / 落点存在**两份**（JS store 与原生），只有「加载歌曲」这一条路径做同步。

| # | 位置 | 症状 | 强度 |
|---|---|---|---|
| R4.1 | `PlayerService.kt:849-882`（`handleEnded`）+ `AdvancePolicy.kt:37-40`（`repeatMode()`）+ `nativePlayer.ts:77`（`toLoopMode`） | `repeatMode()` 把 `LOOP_ALL` 归到 `REPEAT_MODE_OFF`，但 `handleEnded` 又按「ExoPlayer 已接管 'all'」早退 —— **同一份 `loopMode` 在两处语义相反**。于是「向 JS 要歌」整条路径（`WINDOW_HOLE` → `requestTracks` → 60s 兜底）在真实取值域内是**死代码**。随机模式曲末 `seekTo(0)` 播**窗口第一项**（长歌单裁剪后是序列中段的歌）→「跳回一首已播过的歌」，且 `syncShuffleCursorToCurrent()` 把**游标倒退** | CONFIRMED（代码级矛盾） |
| R4.2 | `PlayerOverlay.tsx:248-256`（全仓唯一 `setPlayMode` 调用点）+ `nativePlayer.ts:561` | 切到随机播放**既不重喂窗口也不通知原生** → 锁屏/耳机 next 走原生相邻格 = 成员序下一首，UI next 走 `planAdvance` = 随机序下一首，**概率 (n-1)/n 下不同**。UI next 那条还会落到 `nativePlaySong` 拆队列重载 | CONFIRMED |
| R4.3 | `nativePlayer.ts:527-530`（`nativeSyncLoopMode` 只在 `nativePlaySongFlow` 内调用）+ `PlayerService.kt:685-705` | 单曲循环切换不下发原生 → 曲末仍顺进下一首（「单曲循环直到下一首歌才生效」）；锁屏 next 在单曲循环下播下一首，与 core `restart-current` 矛盾 | CONFIRMED |
| R4.4 | `nativePlayer.ts:737-742`（`reconcileFromNative` 只在插队回退分支被调）+ `PlayerModule.kt:151-153`（`OnDestroy → clear()`） | 缺 `AppState → 'active'` 对账触发点 —— ADR `2026-09-29-native-playback-ownership` 决策 3 写的「回前台用 `getState()` 单向对账」**没实现**（`serviceState` 监听器是空实现）。后台推进若干首后回前台，UI 显示旧歌、按「下一首」用过期的当前曲算落点 | PLAUSIBLE |
| R4.5 | `nativePlayer.ts:638-646` | 零候选轮用**旧 revision** 上报 `outcome:'empty'` → 被判 stale 丢弃（`PlayerService.kt:341-344` 早退，`outcome` 未消费）→ 原生 `pendingUserNext` 悬空到 `WINDOW_HOLE_TIMEOUT_MS = 60_000` | PLAUSIBLE |
| R4.6 | `nativePlayer.ts:305-313` | 原生 idle（`idleState()` 无 `tracks` 字段）时 `nativeAheadKeys` 退回「位置无关的全集」→ #495 的老 bug 在快照缺失时原样恢复 | PLAUSIBLE |
| R4.7 | `android/src/` 下**只有 `main/`**，无 `test/`、`androidTest/` | 上面这一族的**根因**：`#563` / `#574` / `#591` / 本报告 R4.1 一路靠真机发现。ADR `2026-10-07-window-patch-settle-contract` 第 3 项已写明「源码文本守卫不等于行为验收」 | CONFIRMED |

**为什么最重**：R4.1 与 R4.2/R4.3 是「随机模式下锁屏切歌与 App 内切歌结果不同 / 曲末跳回已播歌」
的**全部可复现路径**，用户直接感知。但 R4.7 说明**先修代码不先搭测试基建，就是第四次**。

---

## 历史地图：这条链路的修复几乎全是「某条路径漏同步」

```
#511 评审  e2d1c67  失败跳歌同步随机游标，随机序同步收敛单一入口
#511 评审  176afe0  声明随机序同步边界
#518       57c07f8  「下一首播放」插队后补窗基准被原生窗口换掉
#520       9dc2336  随机序对齐分窗口/权威两态，原地换源补 replaceShuffleSongId
#541       ——      shuffle 必传（此前移动端漏传 → 决策 5 语义从未生效）
#543       1fa7d0b  随机序对齐的作用域做成 core 显式参数
#555       60231c4  原生 next/prev 落点收敛到 core planAdvance
#563/#574  ——      补窗尾部零新增给确定结局
```

`#541` 尤其说明问题：**移动端漏传一个参数，语义就静默失效了整整一个版本** ——
因为可选参数缺省成「另一条路」而不是报错。

## 处置建议

| 顺序 | 内容 | 理由 |
|---|---|---|
| 1 | R1 + R2 + R3 + R4 的决策上提 | 最不可逆；设计已在 core，修的是接线层少数调用点 |
| 2 | 桌面 C1 `planQueueState`（吸收 R3 桌面三条）+ C2 + C3 | 结构预防 |
| 3 | R4 原生测试基建（单开） | R4 根治的前提，独立工作量 |

**R4 的处置要点**：把「曲末怎么走」的决策（`handleEnded` 那段）从 Kotlin 上提到 core，
原生只执行 —— 与 ADR `2026-09-29-native-playback-ownership` 明说的「原生只消费 policy」
一致（`AdvancePolicy` 的注释已自认「语义源仍是 core `skipGuard`」）。这样 `repeatMode()`
与 `handleEnded` 的矛盾在结构上不可能存在，且能用现有 JS 测试网覆盖。

## 环境提示

本机 `packages/core/dist/index.js`（10-08）比 `packages/core/src/utils/*.ts`（10-04）新，
移动端 Metro 吃 dist —— 核对 core 行为以 src 为准，真机排查时注意 dist/src 可能不同步。
