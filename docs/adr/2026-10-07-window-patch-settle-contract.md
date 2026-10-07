# ADR: 补窗结算契约——`patchQueue` 的 outcome 是显式入参

- 状态：已接受（**决策；本轮未落地实现**）
- 日期：2026-10-07
- 关联：**#591**（本决策票）· #563（原生窗口末项 + 补窗零新增）· #574（tail lowwater latch）· #518（基准稳定性）· #519（稳定随机序）· 上游 ADR `2026-09-29-native-playback-ownership.md`（原生持队列 + 原生推进；I1/I2 事件只当通知、I6 推进不依赖 JS 定时器）· 术语见 `GLOSSARY.md`（初始化窗口）

## 背景

「补窗（`feedWindow` → `patchQueue({append})`）跑完之后，这一轮**算不算终局**」没有显式契约。两端各自从**同一轮补丁的旁证**里推断，且两边的推断对象不同：

- 原生 Kotlin 从 `addedCount`、`pendingUserNext`、`refillEmpty` 推断「还有没有可推进项」；
- JS 从 `append.length === 0`、`reason`、`plannedInFlight` 推断「这一轮的零候选算不算真的没有下一首」。

**证据是成本本身**：同一语义不明已经花掉两次真机修复。#563 与 #574 各修自己那端（取证见下），正说明缺的不是补丁而是契约。

### 两端现状取证：谁在什么条件下推断终局

下表的行号是本文写作时的`origin/master`（`1436066`）状态。

| # | 端 | 推断条件 | 位置 |
|---|---|---|---|
| 1 | 原生 | 由 `addedCount = newItems.size`（补丁后**真正新增**的条数）推断「零新增」——队首同步算一次，同时被 `main.post` 的结算分支异步复用 | `packages/mobile/modules/native-player/android/src/main/java/expo/modules/mplayerplayer/PlayerService.kt:347-352`（`newItems` 收集 + `addedCount`） |
| 2 | 原生 | 有未决的用户 `next`（`pendingUserNext`）：队尾还有格 → 推进；**零新增**且 append 首项已在 store 别处 → 绕回；否则 `finishAtTail()` 诚实结束 | `PlayerService.kt:397-421` |
| 3 | 原生 | `refillEmpty`（JS 的显式回执）且已在窗口末项 → `finishAtTail()` | `PlayerService.kt:422-426` |
| 4 | 原生 | **稳态水位**的终止条件（#574）：`append` 非空但 `addedCount == 0` 且停在窗口末项 → 只 `markExhausted()`，**不暂停、不发 `QUEUE_ENDED`** | `PlayerService.kt:427-441` |
| 5 | 原生 | 终局闩按 `(revision, index)` 失效——revision/index 一变旧闩自然解 | `PlayerService.kt:499-500`（`isExhaustedAtCurrent`）· 置闩 `502-505` · 清闩 `507-510` |
| 6 | 原生 | 清闩散落在 5 处：`play()` `621`、`next()` `646`、`prev()` `667`、`onMediaItemTransition()` `726`、`loadQueue()` `306` | 同上各行 |
| 7 | 原生 | `LOW_WATER` 被闩挡住 → 不再每 ~2s 重问 | `PlayerService.kt:876-884`（`maybeRequestTracks`；闩检查在 `880`） |
| 8 | 原生 | `finishAtTail` 的后置条件：清播放意图、停 hole 截止、`pause()`、置闩、`QUEUE_ENDED(EXHAUSTED)` | `PlayerService.kt:472-492` |
| 9 | 原生 | 「`refillEmpty` 的零候选**不算补窗到位**」——不得借它触发 T8 续播 | `PlayerService.kt:444-449` |
| 10 | 原生 | `LOW_WATER` 的来源是 1s 一次的 `progressTick`；每次曲目切换也补一次 | `PlayerService.kt:102-109`（`progressTick`）· `755`（`onMediaItemTransition` 尾部） |
| 11 | JS | `feedWindow` 计划完候选后，用 `plannedInFlight` 推断「本轮零新增是不是并发去重的空轮」 | `packages/mobile/services/nativePlayer.ts:556-561` |
| 12 | JS | `append.length === 0` → **只有** `reason === 'hole'` 且 `!plannedInFlight` 才回执 `refillEmpty`；LOW_WATER 的空轮「不打扰原生」 | `nativePlayer.ts:603-611` |
| 13 | JS | 回执函数自己再发一次 `patchQueue({refillEmpty: true})`（**本轮不带 append**） | `nativePlayer.ts:635-649`（`acknowledgeEmptyRefill`） |
| 14 | JS | `reason` 由事件**语义名**映射而来：`queueEnded.windowHole → 'hole'`、其余非 `exhausted` → `undefined`、`needTracks.reason` 原样透传、headless `data.reason` 原样透传 | `NativePlayerEvents` 绑定 `nativePlayer.ts:187-198` · headless 注册 `684-701`（`690` 透传） |
| 15 | JS | `append.length > 0` 的轮**全部**发 `patchQueue({baseRevision, append})`，不看本轮 candidate 是否去重后会归零 | `nativePlayer.ts:613-632`（`620` 是调用点） |
| 16 | JS | `reason` 的取值域与原生 `EndReason`/`NeedReason` **不同名**：JS `'lowWater' \| 'hole'`、原生 `'windowHole' \| 'stopped' \| 'exhausted'` | `packages/mobile/modules/native-player/index.ts:105-108` vs `.../mplayerplayer/Events.kt:35-45` |

**两条容易漏的事实**（下一个实施者会踩）：

- 判定其实**跨线程裂开**：`addedCount` 在 `patchQueue` 头部**同步**算好（`352`），用它的判定在 `main.post` 里异步跑（`354` 起）；`store.patch` 本身在调用线程（ExoPlayer 只在 application looper 上访问，见 `PlayerService.kt:334-338` 的注释）。
- JS 侧 `'hole'` 会走**两次** `patchQueue`：有候选时是有 `append` 的常规轮（`620`）；零候选时才走回执轮（`645`，无 `append`）。

**#563 与 #574 的取证（`git log --oneline --all`）**：

| 提交 | 票 | 两端分别改了什么 |
|---|---|---|
| `664a0aff` | #563 | **Kotlin**：`patchQueue` 新增 `refillEmpty` 入参；引入 `addedCount`、`firstExistingAppendIndex`（绕回）、`finishAtTail`、终局闩 `exhaustedAt*` + 5 处清闩；`maybeRequestTracks` 的闩检查。**TypeScript**：`feedWindow` 新增 `reason` 形参并在事件映射里透传；新增 `acknowledgeEmptyRefill()` 发 `refillEmpty: true`；`nativePlayer.ts:192` 的 `windowHole → 'hole'` 映射 |
| `7d95147c` | #574 | **只改 Kotlin**（+测试）：在**稳态水位**这条路补上终止条件——`!append.isNullOrEmpty() && addedCount == 0 && 窗口末项` → `markExhausted()`。`services/nativePlayer.ts` 零改动 |

所以准确的切分是：**#563 的「何时承认这是终局」判定有一半长在 JS（`reason` + `plannedInFlight` → 要不要发 `refillEmpty`），#574 则整条留在原生**。两票各修自己那端，正是缺契约的直接后果。

### 证据链里被本文推翻的一处注释（需要下一个实施者注意）

`PlayerService.kt:422-426` 的注释说「没有未决意图（**已被别处清掉**）但 JS 明确回报零候选 → 同样在队尾诚实结束」。这条注解与我们读到的 JS 不符：JS 恰恰是**为了保住** `pendingUserNext` 才发回执的（`nativePlayer.ts:606-609`），它不假设意图已被清掉。于是**两条分支会同时为真**——`pendingUserNext == true` 时先命中 `400-421`（真的无可推进项 → `finishAtTail`），`422` 的 `else if` 根本轮不到。`422-426` 实际只在「意图被`pause()` 清掉后回执迟到」这类竞态里生效。**这不是行为缺陷，但它是当前契约（`refillEmpty` 太薄）留下的语义空洞**：同一份入参在两条分支里含义不同，说明这个入参需要更强的表达力，而不是再加一个布尔。

## 决策

**把「补窗结果」的判定 outcome 提为 `patchQueue` 的显式入参：JS 每轮如实上报 outcome，原生只读 outcome 结算。** 三值域，互斥，纯入参，不改返回值形状。

### 字段与取值域

```ts
// packages/mobile/modules/native-player/index.ts —— patchQueue input 新增
export type PatchOutcome =
  /** 本轮投出的候选里**至少一条**在原生 store 里是新项（addedCount > 0） */
  | 'grown'
  /** 本轮投出的候选**全部**已存在于原生 store（store.patch 去重后 addedCount == 0）；只在 append/upsert 非空时合法 */
  | 'deduped'
  /** 本轮**一个候选都没投出**（解析失败 / 全在冷却 / 全在飞且**不是**本轮在飞的那批）；append/upsert 必须为空 */
  | 'empty';

patchQueue(input: { baseRevision: number; append?: Track[]; upsert?: Track[]; removeKeys?: string[];
  /** 本轮补窗的结算结论；缺失 = 调用方没做结算（仅 removeKeys 的清理轮） */
  outcome?: PatchOutcome;
  insertAfterCurrent?: Track; }): Promise<PatchQueueResult>;
```

删掉 `refillEmpty?: boolean`（`index.ts:194-198`）：它是三值域里 `'empty'` 的一个布尔投影，且丢掉了「`'deduped'` 是无候选还是在飞」这个原生真正需要的区分。**不把 `stale` 并入 outcome**：那个判定已经有权威落点——`store.patch(baseRevision, …)` 的 `outcome.stale`，以及 `PatchQueueResult.stale`（`index.ts:57-68`）/ JS 在 `nativePlayer.ts:621-624` 的丢弃。本轮加的是「入参」，不是把已有的「回执」搬进来。

### 每个取值的语义

| outcome | 谁在什么情况下产生 | 原生该怎么做 | JS 该怎么做 |
|---|---|---|---|
| `'grown'` | JS：`append.length > 0` 且**确信**本轮投出的候选里至少一条是新项。判定方式不变：把 `append` 的 key 与**投喂前**的原生快照比（JS 已有等价物 `nativeAheadKeys(state)`，`nativePlayer.ts:303-311`）——**只是把结论说出来，不再让原生自己数** | append 落地后**不做终局判定**（有新增 = 稳态推进），只在「窗口末项」这类几何条件上维持既有行为 | 不需要额外分支（与今天 `613-632` 同形，只是多带 `outcome`） |
| `'deduped'` | JS：`append.length > 0` 但投喂前快照比对证明候选**全已在原生手里**（含列表循环/随机的绕回）。**这是本轮唯一的终局信号来源**；「在飞」的轮照投，不因此改判 `'empty'` | `addedCount == 0` 的既有结算（`PlayerService.kt:408-421` 的绕回、`427-441` 的 `markExhausted`）**全部收拢到这一条**：`pendingUserNext` → 绕回或 `finishAtTail`；无未决意图 → 只 `markExhausted()`（不暂停、不发 `QUEUE_ENDED`） | 不得把「本地产不出候选」伪装成 `'deduped'`；`'deduped'` 必须**真的投了** append |
| `'empty'` | JS：本轮零候选。**并发闸门**：若本轮计划里的候选正被**别的**补窗轮解析（`plannedInFlight`，`nativePlayer.ts:556-561`），JS **不得**上报 `'empty'`——那一轮会自己给出 `'grown'`/`'deduped'`（或它自己也报 `'empty'`）。这条闸门是**契约的一部分**，不是 JS 的实现细节 | 无候选 = 终局**只对「用户踩空」有意义**：`pendingUserNext == true` → `finishAtTail()`（诚实结束）；无未决意图且在窗口末项 → 只 `markExhausted()`。**不再让 `reason` 决定走哪条** | `reason` 退化回**诊断标签**：仍透传给原生（日志/事件用），但**不再参与结算分支** |

**结算的入参前置条件（原生须拒绝的非法组合）**：`'deduped'` 时 `append`/`upsert` 非空；`'empty'` 时两者皆空；`removeKeys` 轮可无 outcome。这三条让「`refillEmpty` 太薄」留下的语义空洞（`PlayerService.kt:422` 那条注释）无处可藏——两条分支不再可能同时为真，因为「意图还在不在」不再是原生要猜的东西。

**outcome 与既有硬闸门的关系**：outcome **不越过** `windowHole`、`stale` 这两道既有语义闸门。`patchQueue` 消费完 outcome 后，`clearExhausted()` 这类状态清理由原生按 outcome 的语义决定（`'grown'` 解闩；`'deduped'` 置闩；`'empty'` 见上表），不新增第三种闩。

### 两端因此可以删掉的推断

- **原生**：#1 的 `addedCount` 用于结算的那半边（`347-352` 仍要算，但**判定权**收归 outcome）；#2/#3/#4 三条分支收拢成 outcome 两条（`'deduped'` / `'empty'`）；`PlayerService.kt:422-426` 的「已被别处清掉」注释与分支语义一起消失。
- **JS**：#12 里 `reason === 'hole' && !plannedInFlight` 的**判定用途**（保留 `plannedInFlight` 作 outcome 闸门，删掉「要不要回执」这层）；#13 `acknowledgeEmptyRefill` 整段（零候选轮直接带 `outcome: 'empty'` 发一次 `patchQueue`，不再有「第二次、不带 append 的回执轮」）；#16 的 `EndReason → NeedReason` 事件名映射**不再承载语义**（只作诊断标签）。
- **注意**：这不等于「原生不再数数」。`addedCount` 仍是 store 去重后的权威事实，只是**不再单独充当终局判据**。

## 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| **维持双端推断，只补测试/文档**（把 #563/#574 的模式继续用） | 这本就是两票各自做过的事；#591 的存在理由就是这模式已经付过两次真机成本。补丁打在**推断**上，契约仍缺席——下一张场景票（随机绕回、历史裁剪后回跳、`dropped` 与末项重合）会再各修一次 |
| **原生自行推断终局**（JS 只发 `append` + `reason`，由原生比对 `addedCount`） | 正是今天的实现。致命处：原生**看不到 JS 视野里的区分**——「稳态零新增（`append` 非空、全被去重）」与「并发的零候选（本轮压根没投）」在原生侧都长成 `addedCount == 0`，但语义相反（前者是终局、后者只是等一轮）。#574 就是在原生侧补这个区分的第一个特例；继续走只会再长特例。此外它要求原生理解 JS 的候选生成语义（`planNextIndexes` 的绕回/随机序），违反 ADR `2026-09-29-native-playback-ownership.md`「策略语义单一来源在 core、原生只做最小兜底」的分工 |
| **把结算状态机整个搬到 JS**（原生只播 + 报事件；JS 维护 `pendingUserNext` 等镜像并下发） | 队列权威在原生（ADR `2026-09-29-native-playback-ownership.md` 决策 1/3：原生是唯一权威，JS 单向对账）。搬过去要新增反向命令通道与镜像不变量，并把「锁屏 next」这条原生入口拖进 JS 可达性依赖；且 I6（推进不得依赖 JS 定时器）会在后台把结算延迟成事件时序问题。为一个纯推送语义的边界付整套双向协议，不划算 |
| **把 `stale` 也并进 outcome，做成完整的「结算枚举」** | 否决：`stale` 的权威判定已经在 `store.patch(baseRevision)`（写侧）与 `PatchQueueResult.stale`（回执侧），落点单一且已被 #518 验证。把它塞进入参等于让调用方自证「我过期了」，是自相矛盾的输入 |

**为什么选这个切法（不是别种入参）**：契约的**唯一不可替代信息**是「本轮有没有投出候选」——这是原生无论怎么数 `addedCount` 都看不见的（备选 2 的致命处）。而「新增了几条」是原生已经拥有的事实，不该再过网一次。所以入参宁可**窄**（三值、互斥、只描述 JS 视野），原生保有全部事实与全部处置权。

## 后果

### 未落地（如实记录——本轮**没有**改任何代码）

本 ADR 只交付决策与取证；下列全部**待实现**，按依赖顺序：

1. **类型与原生入参**：`index.ts` 加 `PatchOutcome`，`patchQueue` input 加 `outcome` 并删 `refillEmpty`；`PlayerModule.kt` 的 `PatchQueueInput` 加同名字段（`refillEmpty` 同步退场）；`nativePlayer.ts:645` 的 `acknowledgeEmptyRefill` 改为带 outcome 的一次投喂。**这是跨端类型改动**，需同步 `__tests__` 里的假原生桥。
2. **原生结算收拢**：`PlayerService.kt:397-442` 的三条分支按 outcome 重写为「`'deduped'` / `'empty'`」两条；`422-426` 的注释与分支语义一并修正；`maybeRequestTracks` 的闩检查（`876-884`）保持不变（outcome 是上游，闩是下游）。
3. **用例**：#563 与 #574 的场景各一条**修前会红**的行为用例（尾项 + 零新增；稳态水位末项绕回）。注意既有测试的形状是「JS 假原生桥 + Kotlin 源码文本守卫」（`packages/mobile/__tests__/nativePlayNext.test.ts`），**源码文本守卫不等于行为验收**——Kotlin 侧的 outcome 分支必须有用例（真机或 Robolectric 级），否则只是把守卫换成新字符串。
4. **真机复现**：窗口末项 / 补窗零新增时行为明确且不重复补窗（#591 验收第 3 条）。属原生改动：**PR / push 不编译原生**（ADR `2026-09-29-ci-verification-boundary.md`），本机 `./gradlew assembleDebug` 与设备实测见 `mobile-device-debugging` skill 与 `docs/agents/testing.md`。
5. **实现期需重新确认的一处**：删掉「第二次回执轮」后，零候选的 `patchQueue` 轮会**同时**携带 `outcome: 'empty'` 与空 `append`——须确认 store 的 revision 不会因空 append 而推进（否则原生 revision 会无谓地变，导致别的在飞轮被判 `stale`）。门禁线索：`QueueStore.kt:115`（`patch`）与 `212`（`currentRevision`）。
6. **文档同步**（下一步的独立提交）：`GLOSSARY.md` 增加「补窗结算 outcome」词条；`docs/agents/architecture.md` 的原生模块节指向本 ADR；本索引的状态从「已接受」按落地进度更新。

### 得到与代价

- **得到**：「这一轮算不算终局」只有一个落点（JS 上报、原生结算），两端不再各自推断；`refillEmpty` 这类布尔投影不再随场景增加而增殖；#563/#574 的场景从「两个特例」变成「一个契约的两个取值」。
- **代价**：`patchQueue` 的入参域从「纯数据」变成「数据 + 结算结论」，调用方（`feedWindow`）须为每轮负责地标注 outcome——标注错的代价比今天更直接（原生不再二次校验）。真机验收不可省略：Kotlin 分支改动无法被 JS 单测覆盖。

## 参考

- 票：**#591**（本决策）· #563 `664a0aff` · #574 `7d95147c` · #518 · #519
- 上游契约：`docs/adr/2026-09-29-native-playback-ownership.md`（原生所有权、I1/I2、I3、I6）
- 相关：`docs/adr/2026-09-29-ci-verification-boundary.md`（原生留发版期）· `docs/adr/2026-09-27-playback-budget-layers.md`（补窗与解析时限）
- 实施入口：`packages/mobile/services/nativePlayer.ts`（`feedWindow`）· `packages/mobile/modules/native-player/index.ts`（类型）· `PlayerService.kt`（`patchQueue`）
