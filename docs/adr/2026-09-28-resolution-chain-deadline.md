# 解析的链级 deadline（解析链总预算）：一次解析一个预算、各腿取小、耗尽即 abort（#424）

- 状态：已接受
- 日期：2026-09-28
- 相关：#424（本票）、#399 / `2026-09-27-playback-budget-layers.md`（四层时限词汇）、
  #408 / #413（AbortSignal 贯通）、#389（直连 3s 墙）、#392（播放期时长取证）、
  #398 / `2026-09-25-tier3-source-scheduling.md`（K=3 排队不计入预算）、
  #385 / `2026-09-25-playback-skip-guard.md`（失败处置）、#335（播放体验目标）
- 补充而非取代：`2026-09-27-playback-budget-layers.md` 的**四层词汇与各腿墙值全部保留**，
  本 ADR 只在其上补第五层「整条解析链的总上界」。

## 术语消歧（先读这一段）

「**整链**」在本仓既有文档里已被占用：ADR-0014 决策 2 的「**整链 6s 软顶**」
（= `TIER3_CHAIN_BUDGET_MS`）指的是 **tier3 的源遍历链**，它是一个**腿**预算；
`2026-09-27` 决策 3 也写「整链上界仍是 6s」。

本 ADR 说的是**另一层**——「一次 `resolvePlayableSongRouted` 从入口到出结果」的总上界。
为免一词两义，本文与代码注释一律称它为「**解析链总预算**」（英文标识沿用票面给的
`ResolutionBudget` / `RESOLUTION_CHAIN_BUDGET_MS`），而既有那一层一律称
「**tier3 腿预算**」。`shared/playbackBudgets.ts` 文件头第 3 / 第 5 条同步登记了这个区分。

## 背景

`2026-09-27-playback-budget-layers.md` 把「超时」拆成四层（单请求超时 / 墙 / 预算 / 闸门排队）
并把常量收到一处，但**「一首歌最多让用户等多久」仍然不存在于任何一处**：它只能把常量相加推出来——

| 腿 | 墙钟 | 位置 |
|---|---|---|
| 直连解析 | 3s | `DIRECT_WALL_MS` |
| tier3 腿预算 | 6s | `TIER3_CHAIN_BUDGET_MS` |
| 第二条 tier3 腿（试听换完整版） | 6s | 又一次 `TIER3_CHAIN_BUDGET_MS` |

最坏 **3 + 6 + 6 = 15s** 才看到第一句失败反馈；失败后 `skipGuard` 还会 fresh 重试一次、
再自动跳最多 3 首，用户视角是数十秒到两分钟的连续无声期——**且这个数字既算不出也测不了**。

触发条件是真实存在的：`audioTag = invalid / preview` 的路径先走一条 tier3 腿换 URL
（`preferTier3WhenBad`），判定为试听版后再走一条 tier3 腿换完整版（`tryTier3Full`）；
第一条腿的底层 promise 结束后 `tier3Inflight` 条目已删，第二条腿是**独立的一次 6s**。

同时，各腿到点只是**放弃等待**（`Promise.race`）：调用方走了，底层请求继续跑完并继续重试。
#408 已把 `AbortSignal` 贯通到 transport（单源墙、直连墙都持有 AbortController），
依赖已就绪——本票把它扩展到「整条解析链」。

## 决策

1. **一次解析链一个预算，作为参数贯穿。** `resolvePlayableSongRouted` / `resolvePlayableUrlRouted`
   每次调用创建**一个** `ResolutionBudget`（`shared/resolutionBudget.ts`），作为参数下传：
   直连腿 → 直连腿取证 → tier3 腿 → 第二条 tier3 腿。
   **不是模块级全局态**——并发解析多首歌时各自计时、互不干扰（测试与宿主可用可选参数覆盖）。

2. **口径与取值：墙钟 9s，不缩任何一条局部墙。**
   `RESOLUTION_CHAIN_BUDGET_MS = DIRECT_WALL_MS + TIER3_CHAIN_BUDGET_MS = 9s`。
   每条腿保留自己的局部墙，实际用 `min(本腿墙, 剩余)`；因此直连腿仍拿满 3s、
   **第一条 tier3 腿仍拿满 6s**（这一步是刻意的：4s/6s 之类的更小值会把
   `2026-09-25` 决策 7 按 kind 分档刚挣来的余量再压回去）。被压缩的只有「多出来的腿」——
   「试听换完整版」的第二条 tier3 腿只吃剩余额度，这正是 15s 那条路径的成因。

3. **链总预算是墙钟，不暂停；「排队不走表」只属于 tier3 腿预算。**
   - `ResolutionBudget` 从创建那一刻起计墙钟，**K=3 槽位排队时间照走**。理由：若把排队也排除，
     三个槽位被永不落定的解析占满时整链会**无界等待**——「链总在 T 毫秒内结算」直接不成立
     （该洞由本 ADR 的 Spec 轴评审发现）。
   - `2026-09-25-tier3-source-scheduling.md` 决策 8 的「被排在后面的调用方不该在没打过任何上游
     的情况下先超时」仍然成立，但**只约束 tier3 腿预算**：腿预算依旧从**槽位到手**起计、
     再取 `min(6s, 链总预算的剩余)`。两条口径各管一层：腿预算管「这一段网络给多久」，
     链总预算管「用户最多等多久」。
   - 与 `2026-09-27` 决策 5「transport 闸门排队**消耗**墙与预算」同取向：排队消耗上层时限。
     区别只在「闸门」是出网接缝的并发节流（请求已发出），而这里是「这次解析还没轮到」。

4. **耗尽即 abort，而不是放弃等待。**
   - 直连腿：`budget.onExpire` → `controller.abort()`——与 #408 给 3s 墙建的链路同一条；
   - tier3 腿：把预算的 `AbortSignal` 交给 resolver 的 `control.signal`；`tier3Api` 用它
     （a）`withSourceDeadline` 中止**在飞源**请求、`runSourceAttempt` 按既有「放弃观测」记账，
     （b）停止遍历后续源，剩余源记「放弃观测」（不进健康度，决策 6 口径不变）；
   - 直连腿取证：按剩余夹小，并同样可被 abort（总预算已尽则跳过，fail-open）；
   - 严格搜索腿（#556 补记，本条此前**未落地**）：解析链尾巴那一次搜索取
     `min(SEARCH_LEG_WALL_MS, 剩余预算)`，到点即 abort；预算已尽则**连上游都不打**
     （与 `tryTier3` 同口径）。`signal` 经 `searchSongsRouted` 透传到直连客户端的
     `searchSongs`，也交给 tier3 搜索 resolver 的中止链。
   - 链本身以 `ResolutionBudgetExhaustedError` reject；**返回契约与抛错语义不变**
     （`2026-09-23-tier3-failure-attribution.md` 的约束继续成立），宿主仍走既有失败路径。

5. **「最坏无声窗口」也成为可断言的值。** `skipGuard` 导出
   `WORST_CASE_SILENT_MS = SKIP_LIMIT × 2 × RESOLUTION_CHAIN_BUDGET_MS`（= 54s）：
   每首歌的失败处置 = 原始尝试 + fresh 重试 = 2 条链，连续 `SKIP_LIMIT` 首才停。
   这是**口径上界**（不是实测值），目的是让 #335 的目标与护栏上限可以用同一个量纲对话。

## 备选与否决

- **把预算做成模块级全局态**（`setResolutionBudgetMs()` 之类）：否决。并发解析多首歌会互相
  污染（某一首把预算改小，别的歌跟着被切），测试也无法隔离——这正是票面写明「作为参数」的理由。
- **链预算取 6s / 8s**（把第一条 tier3 腿也夹小）：否决。会作废 `2026-09-25` 决策 7 的
  按 kind 分档（两步源 2.5s）与实测依据（2047ms 的成功路径），把「多配源是负收益」的
  既有结论再恶化一档。
- **只给第二条 tier3 腿设墙**：否决。用户可见最坏值仍不可读、链路仍可能被 5 个常量之和支配。
- **排队不计入链总预算（即让链预算在排队时暂停走表）**：否决。初版实现过这个形态，
  评审指出它的洞：K=3 三个槽位被永不落定的解析占满时整链**无界等待**。改成
  「链预算照走、腿预算从槽位到手起计」后，决策 8 的诉求（腿预算不因排队而缩水）仍被满足。
- **到点只放弃等待、不 abort**：否决。#408 已确立「墙的持有者持有 AbortController」的口径，
  新加一层再退回去等于两套语义。
- **试听版不再走第二条 tier3 腿**：否决。那是「试听无意义，兜底可能拿完整版」的产品决策
  （#361 评论），本票只给它一个上界，不改它的存在。
- **把取证并入 3s 直连墙**：否决。沿用 `2026-09-27` 的既有否决（被砍掉就走 fail-open，
  30 秒试听会被当完整版播出去）。

## 后果

- **最坏路径从 15s 收敛到 9s（墙钟，含 K=3 排队）**；`RESOLUTION_CHAIN_BUDGET_MS` 与
  `WORST_CASE_SILENT_MS` 让「最坏等多久」成为可读、可断言的单一值（各有单测钉住）。
- **各腿局部墙语义不变**：直连 3s、单源硬墙按 kind 2s/2.5s、tier3 腿 6s、嗅探独立 1s 全部保留；
  新增的只是「谁都不得超过解析链总预算的剩余」这一条。
- **底层工作真的会停**：总预算耗尽会 abort 在飞请求（直连腿 / tier3 源尝试），
  tier3 K=3 槽位随解析收尾归还，「in-flight 归零」有入口级测试钉住。
- 新文件/新常量：`shared/resolutionBudget.ts`、`playbackBudgets.RESOLUTION_CHAIN_BUDGET_MS`、
  `skipGuard.WORST_CASE_SILENT_MS`；`DirectValidator` 接缝与 `fetchAudioHead` 各加一个可选参数
  （向后兼容）。
- **未落地（如实记录）**：
  1. transport **闸门排队**中的请求不受总预算 abort 影响——abort 只作用于已开始的源尝试，
     沿用 `2026-09-27` 决策 5（闸门自身不感知墙钟）。**但排队时间照走链总预算**（见决策 3）：
  2. tier3 的探测缓存（`probeCandidate`）与清单拉取不在总预算内（前者计入单源墙，后者是管理面）；
  3. 移动端缓存命中的 URL 交给播放器前的活性闸（`URL_ALIVE_PROBE_TIMEOUT_MS`）在解析链之外。
  4. 严格搜索腿的 abort 分两截（#556 落地时如实记录）：**tier3 搜索 resolver** 那截
     真正停止在飞请求；**直连客户端的 `searchSongs`** 那截只做到「链不再等它」——
     各源实现（netease / qq / kugou / kuwo / migu / qianqian）的 `searchSongs` 目前
     不接受 `TransportCallOptions`，传进去的 `signal` 无人读取，底层搜索会跑完。
     让它真正可中止需要逐源把 `opts.signal` 接进 transport，属于各源文件的改动，
     不在 #556 的写入范围；链的**可见等待**上界不因此变化（墙照走照返回）。
- **越界归因不是单一错误类型**：9s 与第一条 tier3 腿的 6s 在「直连用满 3s」这条最坏路径上
  恰好贴齐，两个计时器同刻到期，链可能以 `ResolutionBudgetExhaustedError` 收口、
  也可能以该腿自己的失败（如直连墙错误）上抛——两者都是「到点失败」，对用户等价。
  既有 `sourceRouter.test.ts` 的「仅直连（direct 模式）→ 墙超时上抛」钉住后者，
  新测试钉住前者（断言错误类而非文案）；**不声称两条归因都已穷尽覆盖**。
