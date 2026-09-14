# T3 · tier3 机制盘查：我们这套「订阅源执行器」到底哪里能改、哪里改不动

- **日期**：2026-09-14
- **仓库基线**：`f664a1745937be6bfa92bf4e466ebc44c3330c2f`（2026-09-13，master，工作区另有未提交的 t1/t2 文档）
- **调研问题**：用户抱怨自配 tier3 订阅源「会过期、有并发问题、源太少」。t1 已证明「源太少」是生态固有属性；本报告只盘**我们自己的机制**——订阅/清单、并发、超时预算、失败隔离、统计口径、排序选择、快照语义——把**能控的**与**控制不了的**分开。
- **证据纪律**：只采 primary source——仓库源码（`file:line`）、core 单测、**我在本机跑的一次性实测**。代码里读到的与实测得到的分开标注：**〔代码〕**=读源码/既有测试得出；**〔实测〕**=本次新写一次性 vitest 用例跑出来的数字（用例已删除，不在仓库留痕；方法与原始输出在下文各节给出）。找不到的写「未找到」。
- **前置研究**：`t1-tier3-external-sources.md`（生态：tier3 吃不下 JS 插件、源站限流/移除的客观事实）、`r5-unofficial-sites.md`（A/B/C 类源与合规结论）、`docs/agents/mobile-parity-gap-list.md`（移动端对齐历史）。**t1 §1 的契约字段级说明本报告直接引用、不重复**，只做「执行期行为」维度的补充。

---

## 0. 一句话结论

**我们这套机制不是"没有机制"，而是"四处缺环"：串行 × 无并发上限 × 只有解析腿有总预算 × 统计只覆盖解析腿。** 具体地：

1. **解析腿**（播放 URL 兜底）有 6 秒总预算（`sourceRouter.ts:314`），但**源之间是严格串行**（`tier3Api.ts:834-835`）。慢源会吃光预算，排在后面的好源**一次都不会被请求**——这是**机制缺陷**，不是源站问题。〔实测〕3 个各挂 3s 的坏源放在前面，第 4 个好源最终**没被请求过**，用户拿到的总延迟正好 6005ms。
2. **搜索腿**（直连搜索失败兜底）**完全没有总预算**，且同样串行。〔实测〕5 个各 2s 的源 = 10.0s 才返回，而解析腿的预算是 6s。两条腿的预算不对称，是**不对称的实现遗漏**。
3. **没有任何并发上限**：20 首歌同时解析 → 上游并发峰值 20。〔实测〕
4. **没有熔断/退避/自动停用**：同一个 404 的源被连续调用 3 次，3 次都真发请求。〔实测〕也没有"最近失败时间/连续失败次数"字段，因为 `Tier3SourceStats` 只有 `{hits, misses}` 两个累计数。
5. **统计只记录"解析"腿**：`hits++ / misses++` 只在 `resolveTier3` 的循环里（`tier3Api.ts:841-861`），**搜索腿走的 `searchTier3SourceItems` 全程不碰 `tier3Stats`**（〔实测〕跑完 `searchTier3Songs` 后 stats 快照一字未变）。
6. 一个**代码/注释口径不一致**需要修：`tier3Api.ts:445` 注释宣称字节嗅探超时"默认 8000"，实现是 `source.timeoutMs || SNIFF_TIMEOUT_MS`——**用户一旦配了 `timeoutMs`，嗅探也吃同一个值**，代码里的 `SNIFF_TIMEOUT_MS = 8_000` 实际只在"用户没配 timeoutMs"时生效（且那时它是默认 15000，永远轮不到 8000）。

---

## 1. 订阅与清单：三形态怎么解析、校验、加载、持久化

> 契约**字段**逐条说明见 `t1-tier3-external-sources.md` §1.2–1.4（`Tier3Source` / `Tier3RequestSpec` / `Tier3SearchSpec`），本节只补 t1 没写的**执行侧语义**与**校验缺口**。

### 1.1 三形态的入口与真实差异

| 形态 | 入口 | 落盘物 | 刷新语义 |
|---|---|---|---|
| `url` | `addTier3SubscriptionFromUrl`（`tier3Api.ts:729-743`）→ `fetchTier3ManifestFromUrl`（`694-716`） | **拉回来的 manifest 原文**（`manifest` 字段），URL 也存（`source`） | `refreshTier3Subscription`（`766-777`）只对 `kind === 'url'` 重新拉取；`text`/`file` 直接 `return existing`（`769-772`） |
| `text` | `addTier3SubscriptionFromText`（`745-760`），`kind` 缺省即 `'text'`（`753`） | 同上（就地解析后的 manifest） | 不刷新（无远端可刷） |
| `file` | **core 无专门入口**：桌面 `dialog:openTier3File` 读文件后调 `settings:addTier3Text` 并带 `kind: 'file'`（`src/main/ipc/appSettingsUpdate.ts:38-47`、`src/renderer/components/Tier3Section.tsx:83-91`） | 同上 | 不刷新 |

**关键点（t1 未展开）**：URL 订阅**不在启动时拉取**。订阅一旦添加成功，清单就**冻结在本地**，只有用户点刷新才更新。→ 远端清单更新后，用户不手动刷新就永远是旧清单；这既是"源会过期"的一个**可控**成因（我们没做自动 TTL 刷新），也是**故意**的（避免每次启动打源站）。刷新按钮**只在桌面有能力**：`Tier3Section.tsx:225-231` 有刷新按钮，移动端 `packages/mobile/app/settings.tsx:318-322` 也有（`sub.kind === 'url'` 才显示）——**两端都有**，但**都只有手动**。全仓无 `setInterval`/`cron`/`schedule` 触发的清单刷新（〔代码〕grep 无命中）。

### 1.2 校验：只在"加入"时做一次，水合时不校验

- `parseTier3Manifest`（`tier3Api.ts:285-304`）：`JSON.parse` 失败 → `订阅清单不是合法 JSON`；`version !== 1` → 拒绝；`sources` 非数组 → 拒绝；逐源 `parseSource`（`250-279`，含 `id` 非空、`kind` 白名单、`allowedDomains` 非空、`timeoutMs` 为正数、`search-then-resolve` 必带 `search`）；最后查 `source.id` 重复（`298-302`）。
- **但只在 add 路径调用**。`loadTier3State(saved)`（`172-178`）是**纯赋值**：`enabled: !!saved?.enabled` + `subscriptions: Array.isArray(...) ? ... : []`，**完全不校验 subscription 结构**。〔实测〕喂一行垃圾 `{"manifest":{"version":1,"sources":[{"id":1}]}}`，`getTier3State()` 原样返回该对象，没有报错。
  - 实际危害有限：`resolveTier3` 后续读 `source.id`（`841`）当作 map key 能跑（数字被当 key），`tier3SourceSource` 解构 `source.source` → `undefined`。所以"不校验"是**不崩但脏**，不是安全洞。**列为可改项**：水合时对每个 subscription 跑一遍 `parseTier3Manifest` 等价校验，坏订阅丢弃并打日志。
- **持久化格式无版本号**：`Tier3Subscription` 有 `updatedAt`（`94`）但**存的是订阅操作时间，且没有任何 UI 显示它**（〔代码〕三处赋值 `739/756/774`，全仓无读取点）。→ 用户无法知道"我这份清单是什么时候的"。

### 1.3 状态水合图（谁调谁）

```
桌面: src/main/main.ts:327-335   db.getSetting('tier3State') → loadTier3State(saved)
      src/main/ipc/appSettingsUpdate.ts:121-124  setTier3Persister(next => db.setSetting('tier3State', next))
移动: packages/mobile/stores/settingsStore.ts:80-89  persist 重水合 → loadCoreTier3State(...)
      packages/mobile/stores/settingsStore.ts:99-101 setCoreTier3Persister(next => setState(...))
core: tier3Api.ts:140-145 syncRouter() —— enabled 同时**让解析器与搜索兜底一起翻转**
```

**一个语义交底**：`window.tier3.enabled = false` 时 `syncRouter()` 做三件事（`140-145`）：`setRouterTier3Enabled(false)`、`setRouterTier3Resolver(createTier3Resolver())`（**仍注入 resolver**，只是开关关了）、`setRouterTier3SearchResolver(null)`（真清空）。所以"关掉 tier3"不影响 `resolveTier3` 内部第一行的 `if (!state.enabled) return ''`（`825-828`）——双保险，行为正确，但**代码形态不对称**，读起来容易误判。

---

## 2. 并发模型：串行 + 无上限

### 2.1 源之间：严格串行，无并发

`resolveTier3`（`tier3Api.ts:824-866`）与 `searchTier3Songs`（`641-690`）都是**嵌套 `for` + `await`**，一处 `Promise.all` 都没有：

- 解析腿：`for (const subscription of state.subscriptions) for (const source of manifest.sources) { ... await ... }`（`834-835`，`await` 在 `845/847`）
- 搜索腿：`for (const subscription ...) for (const source ...) { ... await searchTier3SourceItems(...) }`（`646-651`）

〔实测〕4 个源各 60ms 延迟，请求**发起时刻** `[0, 60, 121, 181]ms`，总耗时 241ms——完全串行，一个接一个。

### 2.2 单源内部：两跳也是串行，且"先嗅探后解析"的次序被写死

- `url-resolver`：1 次取链 `request`（`493`）→ 1 次嗅探 `request`（`437`），串行。
- `search-then-resolve`：`searchTier3SourceItems`/`resolveSearchThenResolve` 内部是 **for 循环逐条候选**（`544`），每条候选又是"先 `urlPath` 直链嗅探、再 `idPath` → resolve"（`560-577`）。→ **最坏情况一个源可以对上游发 N 条候选 × 2 类请求**，全程串行，全部计入那 6 秒。
- 〔实测〕白名单外的 URL **不触发嗅探**：返回 `https://evil.example.net/a.mp3`（不在 `allowedDomains`）时，只有 1 次请求（取链），统计记 1 次 miss。（`510` 的短路发生在嗅探之前。）

### 2.3 有没有并发上限？没有

〔代码〕全仓 grep `queue|semaphore|limiter|p-limit|maxConcurrent` 在 `transport.ts`/`musicApi.ts`/`sourceRouter.ts` 中**零命中**；`tier3Inflight`（`sourceRouter.ts:325`）只是**同歌去重**，不是限流器。

〔实测〕20 首歌同时解析，上游并发峰值 = **20**（每首歌各自独立跑完整条串行链）。唯一"天然的"相似键收敛发生在 `sourceRouter` 层：`tier3Inflight` 按 `sourceType|id` 去重（`326-332`）——**同一首歌的并发调用只打上游一次**（`sourceRouter.test.ts:353-372`），但**不同歌不共享任何配额**。〔实测〕直接调 `createTier3Resolver()` 三次同一首歌 → 上游 3 次请求，说明去重只在 `sourceRouter` 这条路径上，**任何新入口（如未来的批量解析）都绕开它**。

### 2.4 两条腿共享并发池吗？不共享，甚至不共享"预算"

| | 解析腿 | 搜索兜底腿 |
|---|---|---|
| 入口 | `sourceRouter.tryTier3` → `resolveTier3` | `sourceRouter.tryTier3Search` → `searchTier3Songs` |
| 总预算 | **6s**（`sourceRouter.ts:314`，`Promise.race` `366-369`） | **无** |
| 同歌/同词去重 | 有（`tier3Inflight`，按歌曲身份） | **无**（每次都全量重跑） |
| 统计 | 有 | **无** |
| 并发 | 串行 | 串行 |

搜索腿**唯一的天然并发**来自 `searchOrchestrator`：`'all'` 路由下按 `concurrency`（两端都是 3，`src/renderer/services/searchService.ts:22`、`packages/mobile/stores/searchStore.ts:30`）逐源搜索，**上限 3 个源同时**——但这是**源级**并发，不是 tier3 内部的；且因为 7 个源里多数直连会成功，tier3 搜索腿实际只在少数源上被触发。

〔实测〕搜索兜底 5 个源 × 2s = **10008ms**，是解析腿 6000ms 预算的 1.67 倍。

---

## 3. 超时预算：单源的可以配，整链的只有一个半

### 3.1 三个层次的超时

| 层次 | 值 | 位置 | 可配 |
|---|---|---|---|
| 单源请求（取链/搜索） | `source.timeoutMs || 15000` | `tier3Api.ts:113`、`385` | ✅ 清单字段 |
| 单源字节嗅探 | **同一个 `source.timeoutMs`**，无 `timeoutMs` 时才落 `SNIFF_TIMEOUT_MS=8000` | `114`、`445` | ⚠️ 见下 |
| 整链（解析腿） | `TIER3_BUDGET_MS = 6000`，`Promise.race` | `sourceRouter.ts:314`、`366-369` | ❌ 硬编码常量 |
| 整链（搜索腿） | **不存在** | — | ❌ |

**⚠️ `SNIFF_TIMEOUT_MS` 是死参数（代码/注释不一致）**：`445` 写的是 `timeoutMs: source.timeoutMs || SNIFF_TIMEOUT_MS`。当 `source.timeoutMs` 已配（校验默认建议 15000），嗅探也用这个值——注释（`428-433` 区块与 `t1` §1.5 转述）说"8s"是**不成立**的。只有当用户**没配** `timeoutMs` 时 `SNIFF_TIMEOUT_MS` 才生效，而那时期望值是 15000，永远轮不到 8000。→ **`SNIFF_TIMEOUT_MS` 在当前实现里不可达**，是一个误导性常量。

### 3.2 超时被 transport 放大：单源超时的真实成本是 (maxRetries+1) 倍

`request()` 有全局重试层（`transport.ts:166-190`，`DEFAULT_RETRY_OPTIONS = { maxRetries: 3, baseDelayMs: 100 }`，`105`）：

- 5xx：退避重试（`174-177`）
- 抛错的网络错误：按 `NETWORK_ERROR_CODE_RE` 重试（`143-144`），该正则**包含 `ECONNABORTED`/超时且明确包含 `ETIMEDOUT`**（`144`）
- 4xx / `sessionInvalid` 不重试（`174`）

〔实测〕本机起一个永不响应的 HTTP server，用默认 transport 发 `{ timeoutMs: 300 }`：**耗时 1917ms，服务端收到 4 个请求，最终抛 `ECONNABORTED`**。→ 单源 300ms 超时的真实墙钟成本 ≈ **1.9s**（4 × 300ms + 退避 100+200+400ms）。

**推论（重要）**：`source.timeoutMs` **不是墙钟预算**，而是"每次尝试的超时"。一个挂起的源的实际开销 ≈ `(1 + maxRetries) × timeoutMs + 退避`。默认 15000 的源 = 单源最坏 ~61.5s；即使有 6s 总预算截断，**这 6 秒里最多也只能跑完 1 个源**（见 §4 实测）。若把 `timeoutMs` 调到 60000（§4 提到的 mgmp3 类源），单源最坏 ~246s，但整链仍 6s 截断 → **超时预算形同虚设，实际只有"整链截断"在起作用**。

### 3.3 超时后：降级下一个源，但整链只降级到"预算耗尽"为止

- 单源超时（`request` 抛错）→ 被 `resolveTier3` 的 `catch`（`856-859`）吞掉 → `stats.misses++` → **继续下一个源**（注释明说 `858`）。
- 整链超预算：`Promise.race`（`366-369`）返回 `''` → `tryTier3` 返回 `''` → 调用方（`resolvePlayableUrlRouted`/`resolvePlayableSongRouted`）**继续上抛直连错误**，由换元层/store 处理。**底层请求不被取消**（`sourceRouter.ts:358` 注释与 `sourceRouter.test.ts:398-429` 测试都明确"慢源请求自然结束，结果丢弃"），迟到命中会被 `tier3Inflight` 的 `finally` 清键后丢弃（`349-351`）。

---

## 4. 失败隔离：一源一 `catch`，但**没有**熔断/退避/自动停用

### 4.1 四类坏源的表现

| 坏法 | 表现 | 位置 |
|---|---|---|
| 404 / 5xx | `res.status >= 400` → 立即返回 `''`，**不嗅探**，记 miss，下一个源 | `494` / `540` / `605` |
| 返回 HTML / 非 JSON | `JSON.parse` 抛 → `catch` 返回 `''`（取链腿 `496-500`）；搜索腿更脆：`JSON.parse(bodyToText(...))` **没有 try/catch**（`541`、`606`），靠外层 `resolveTier3` 的 `catch`（`856`）/ `searchTier3Songs` 的 `catch`（`684-686`）兜 | 见左 |
| 长期挂起 | 由 `timeoutMs` × 重试放大（§3.2）拖住整条链，直到 6s 预算截断 | — |
| 返回白名单外 URL | `isAllowedUrl` 短路 → `''`（不嗅探） | `510` |
| 返回试听片段 | 嗅探通过但 `totalBytes < 1MB` → 记 info 日志、跳过 | `475-482`、阈值 `118` |
| 返回 HTTP 200 + 业务错误封套 | `code !== 0` 且有 `message` → warn 日志返回 `''` | `503-508` |

**一条源失败不会中断链路**：`catch` 在单源粒度（`856-859`），注释写死"单源失败继续下一条"。〔实测〕HTML 源在前、正常源在后：请求序列 `[a.example.com, b.example.com, cdn.example.com]`（第三个是嗅探），最终**成功命中**——坏源没有污染好源。

### 4.2 但坏源会**饿死**后面的好源（这是真缺陷）

〔实测〕订阅 4 个源：`slow1/slow2/slow3`（各挂 3s 再 500）+ `good`（本可立即命中）；直连返回空串触发 tier3：

```
[EXP3] elapsed=6005ms url= 请求过的 host=["slow1.example.com","slow2.example.com"]
[EXP3] stats={"slow1":{"hits":0,"misses":1}}
```

**`good` 源从头到尾没被请求过**。原因是串行（§2.1）+ 6s 总预算（`sourceRouter.ts:314`）：两个慢源吃掉 6s 后 race 判负，第三个源刚发起就被放弃，第四个源永远排不上。→ **"源越多越糟"是可证的**：只要前面存在一个会挂的源，后面配多少好源都白搭。这与 t1 的"多源串行遍历——订阅里源越多，慢源越容易吃光预算"结论一致，但本报告用实测把代价量化了。

### 4.3 没有熔断 / 退避 / 自动停用 / 降权

〔代码〕`packages/core/src/tier3/` + `sourceRouter.ts` 中 grep `circuit|breaker|熔断|退避|autoDisable|disableUntil|cooldown|consecutive` → **除注释外零命中**。全仓无"坏源跳过 N 分钟""连续失败 N 次停用"逻辑。

〔实测〕同一个 404 的坏源被连续调用 3 次 → **上游收到 3 次请求**（`stats={dead:{hits:0,misses:3}}`），每次都完整重试链路（含 transport 层的 5xx/网络重试不适用 404，所以是 3 次干净请求）。

→ **坏源既不会被记住，也不会被降权，每次播放都重新试一遍**。这是"会过期"体验的第二大成因：用户必须先手动删源，才能止损。

### 4.4 `tryTier3` / `tryTier3Full` / `preferTier3WhenBad` 的触发矩阵

三者都在 `sourceRouter.ts`，都**静默吞掉失败**（返回 `''`/`null`），失败信息只进 `console`：

| 函数 | 触发时机（调用点） | 失败后 |
|---|---|---|
| `tryTier3`（`360-375`） | ① `resolvePlayableUrlRouted`：直连返空串（`458`）、直连抛错且 `mode==='auto'`（`464`）；② `resolvePlayableSongRouted`：UrlInfo 无 url（`522`）、直连返空串（`540`）、直连抛错且 auto（`546`）；③ `preferTier3WhenBad`（`393`）；④ `tryTier3Full`（`381`） | 返回 `''`；**调用方继续按原直连结果/错误处理**（上抛由调用方决定）。tier3 未启用/未注入时**零成本早退**（`361-364`） |
| `tryTier3Full`（`380-383`） | 仅"直连结果是试听版"：预取缓存 nonFull（`491`）、`isTrialUrlInfo`（`513`）、`audioTag === 'preview'`（`534`） | 返回 `null` → 退回直连试听并标 `nonFull=true` |
| `preferTier3WhenBad`（`390-395`） | **仅当 `song.audioTag === 'invalid'`**（探测已标死链）：直连返回了 URL 也优先换 tier3（`455`、`508`、`530`） | 返回原直连 URL，**不阻断**——由上层继续弹窗/换元 |

**注意**：`resolvePlayableSongDirect`（`558-575`，探测用）**完全不碰 tier3**，注释写死"探测语义 = 直连可播性"（`552-556`）。所以 tier3 只影响播放，不影响列表探测的徽标。

### 4.5 `mode === 'direct'` 的语义不对称（一个可能的真 bug）

- `resolvePlayableUrlRouted`（`461-467`）与 `resolvePlayableSongRouted`（`543-549`）：`direct` 模式下直连**抛错**会 `throw`，**但直连返回空串（无版权/VIP）仍会走 `tryTier3`**（`458`、`540` 在 try 块内，不受 `mode` 保护）。
- 对照 `searchSongsRouted`（`417-441`）：`direct` 模式下**搜索失败也走 tier3 搜索兜底**（`searchOrchestrator` 侧测试 `sourceRouter.test.ts:198-208`「direct + 客户端失败 → tier3 搜索兜底返回候选，不回退」明证）。

→ **"仅直连"开关在当前实现里并不"仅"**：它只挡"直连抛错"这一种情况，挡不住"直连返空"。这是**代码可读出的语义**（call-path 明确），本报告未做端到端真机验证，但从源码路径看是确定的。**列为待确认项**：需要确认产品语义到底是"仅直连 = 直连抛错不回退"还是"直连返空也不回退"。

---

## 5. 统计口径：只覆盖解析腿，记忆只活在本次会话

### 5.1 自增点（全部在 `resolveTier3` 内）

```
tier3Api.ts:841   const stats = tier3Stats.get(source.id) ?? { hits: 0, misses: 0 }
tier3Api.ts:850-851  if (url) { stats.hits++; tier3Stats.set(source.id, stats); return url }
tier3Api.ts:860-861  stats.misses++; tier3Stats.set(source.id, stats)   // 循环末尾，未命中或抛错都走到
```

**唯一的两处自增都在 `resolveTier3` 的源循环里**。三个重要推论：

1. **搜索兜底腿完全不统计**。`searchTier3SourceItems`（`593-630`）与 `searchTier3Songs`（`641-690`）从头到尾不读写 `tier3Stats`。〔实测〕跑完 5 源搜索兜底后 `getTier3Stats()` **与跑之前一模一样**（对比 `[EXP-SEARCH] stats` 与 `[EXP4]` 前后的快照：只有解析腿的计数在变）。→ **用户看到"命中 0 / 未命中 0"，但搜索其实一直在用这个源**，这正是"移动端设置页盲调订阅"的另一半原因（`docs/agents/mobile-parity-gap-list.md:87-89` 只记录了"无展示"，没说"统计口径不含搜索"）。
2. **`source mismatch` 跳过的源不计数**。`836-840` 的 `continue` 在 `841` 取 stats **之前**，所以"该源不适合这首歌的 sourceType"既不算 hit 也不算 miss。→ 一个 `source: 'qq'` 的源对网易歌永远不出现在统计里，用户会以为它没被加载。
3. **只有"整链未命中"的汇总 warn**（`864`），没有每源耗时的任何记录——统计里看不到"哪个源慢"。

### 5.2 存在哪、什么时候消失

`const tier3Stats = new Map<string, Tier3SourceStats>()`（`124`，模块级内存）。**不落盘**（`persist()` 只序列化 `state`，`136-138`；`Tier3State` 类型里没有 stats，`97-100`）。→ **重启进程（桌面退出 / 移动端杀后台）即全部清零**。桌面切页 / 移动端进设置页刷新靠的是"重新读一遍这个 Map"，不是重新统计。

### 5.3 用户在哪看

| 端 | 展示 | 位置 | 刷新时机 |
|---|---|---|---|
| 桌面 | 「每源累计解析统计（本次会话）」+ 命中/失败 | `src/renderer/components/Tier3Section.tsx:274-303`；IPC `settings:getTier3Stats`（`appSettingsUpdate.ts:143`） | **只在组件挂载时 `load()` 一次**（`Tier3Section.tsx:39-41`），无刷新按钮、无轮询 → **长期开着的设置页永远显示第一次的快照** |
| 移动端 | 「每源解析统计（本次会话）」+ 命中/未命中 + 手动刷新 + 清零 | `packages/mobile/app/settings.tsx:332-360`；读 core `getTier3Stats()`（`105-113`） | `useEffect` 依赖 `[tier3Enabled, tier3Subscriptions.length]`（`107-109`）→ **只在开关/订阅数变化时刷新**，另有手动刷新按钮 |

→ 两端**展示口径不一致**（桌面无手动刷新、移动端有清零按钮），且桌面无清零入口（`clearTier3Stats` 桌面侧只导出未接 UI）。

---

## 6. 排序与选择：谁先配谁赢

### 6.1 胜出规则 = **配置顺序 + 第一个成功**

`resolveTier3` 按 `state.subscriptions` 数组顺序（= 添加顺序，`741/758` 追加）+ 每个订阅内 `manifest.sources` 数组顺序遍历，**第一个返回非空 URL 的源 `return`**（`849-854`）。没有按历史成功率、延迟、命中率排序的任何逻辑（〔代码〕统计 map 只写不读，`tier3Stats` 在全仓**只有 `getTier3Stats`/`clearTier3Stats` 两个读取点**，均不在选择路径上）。

**用户可见后果**：把慢源放在前面 → 后面的源全废（§4.2 实测）。这解释了"并发问题"的用户体感——同一份清单，顺序不同结果完全不同，但**UI 里没有任何提示**。

### 6.2 `allowedDomains` 的三处作用（都不是"选源"，都是"否决"）

1. **解析结果否决**：`resolveFromRequestSpec` 里 `isAllowedUrl(candidate, source.allowedDomains)` 不过 → 直接 `''`（`510`）。
2. **搜索候选直链否决**：`urlPath` 提供的直链同样要过白名单（`564`）。
3. **列表展示/统计无关**：`searchTier3SourceItems` 返回的 `item.url` **不做白名单检查**（`624` 只做 `toUrlCandidate`）——这个 url 会作为 `Song.url` 端到搜索结果里。**播放时**若走了路由链会重新被白色名单约束；**但这些候选的 url 是"可见但未必可播"的**，属于信息面而非安全面的口径差异（该 url 从未被本模块直接返回给播放器）。

**另一个不在白名单体系里的东西**：`source.resolve.url` 本身的域名**不受任何限制**（校验只要求 http(s)，`199-205`）。→ 用户订阅的清单可以让 App 请求任意域名；这是 tier3 的固有信任模型（用户自配源），不是漏洞，但**值得在文档里写死**。

### 6.3 同名多源去重只发生在搜索腿

`searchTier3Songs` 用 `${item.name|item.artist}` 小写键去重（`667-670`），**跨订阅、跨源**生效；解析腿没有对应逻辑（因为解析腿只返回第一条命中的 URL，天然唯一）。过滤条件（`656-666`）比 t1 §1.5 描述的更严：多词查询要求**每个词**都命中歌名或歌手。

---

## 7. 快照语义：`Tier3SourceStats` 缺的字段（做坏源降级需要什么）

当前类型全文就是两行（`tier3Api.ts:102-106`）：

```ts
/** 每源累计解析统计（设置页展示；内存计数，本次会话有效）。 */
export interface Tier3SourceStats { hits: number; misses: number; }
```

**没有时间维度**：没有最近成功/失败时间、没有连续失败次数、没有"最后 N 次的滑动窗口"、没有平均/最近耗时。`updatedAt` 是**订阅级**的（清单何时加入/刷新），不是**源级**的，且无处展示。

### 要做"坏源自动降级"，缺的字段（最小集）

| 字段 | 为什么必须要 | 数据现在有没有 |
|---|---|---|
| `lastFailureAt: number` | 熔断的解锁条件（"再等 5 分钟试一次"） | ❌ 无 |
| `consecutiveFailures: number` | 触发熔断的阈值判断；一次网络抖动不该停源 | ❌ 无（只有累计 misses，分不清"连续 5 次挂"和"100 次里挂 5 次"） |
| `lastSuccessAt: number` | 恢复条件；避免永久停用已经恢复的源 | ❌ 无 |
| `disabledUntil: number \| null` | 熔断状态本身（决定 `resolveTier3` 是否 `continue`） | ❌ 无 |
| `avgLatencyMs` / `lastLatencyMs` | 排序依据（把快源提前，天然缓解 §4.2 饿死） | ❌ 无（**当前连"这个源花了多久"都不记录**） |
| 每源	extbf{搜索腿}的 hit/miss | 让统计覆盖两条腿（§5.1） | ❌ 无 |

**一个结构性前提**：这些字段要跨"重启"有效才有意义（否则每次冷启动都从 0 开始，熔断形同虚设），当前 `tier3Stats` 是**纯内存 Map**（`124`）——要落盘就得扩展 `Tier3State`（`97-100`）与两端 persister 的序列化格式，涉及桌面 `db.setSetting('tier3State')` 与移动端 AsyncStorage 的迁移。

**另有两条与统计无关但同属"降级"的缺口**：
- **超时是有下限保证的（好消息）**：`request` 的 retry 循环里，`ECONNABORTED`/超时被当作可重试网络错误（`143-144`），axios 保证超时一定抛错，因此**不存在"单源永久挂起、永不返回"的情况**——最终一定在 `(1+maxRetries) × timeoutMs` 附近返回。所以"挂起"不需要单独的看门狗，只需要尊重 §3.2 的放大系数。
- **整链预算不做 per-source 分摊**：6s 是"整条链"的，不是"每个源"的。改成"每个源 N 秒、总预算 M 秒"的两级预算，才能根治 §4.2。

---

## 8. 结论：两张清单

### 8.1 我们能控制的（机制缺陷，改代码即可）

| # | 问题 | 证据 | 改动面 |
|---|---|---|---|
| C1 | **源间串行 + 6s 总预算 → 慢源饿死后面的好源**（实测：第 4 个好源零请求） | `tier3Api.ts:834-835`、`sourceRouter.ts:314`/§4.2 实测 | 中：改并发或加 per-source 预算上限 |
| C2 | **搜索兜底腿无总预算**（实测 10.0s vs 解析腿 6s） | `tier3Api.ts:646-651`、`sourceRouter.ts:296-310` | 小：加同款 `Promise.race` |
| C3 | **无并发上限**（实测 20 首并发 = 上游峰值 20） | 全仓无 limiter | 中：加全局并发池 |
| C4 | **无熔断/退避/自动停用**（实测坏源连打 3 次） | `tier3Api.ts:124/841-861` 无时间字段 | 中：`Tier3SourceStats` 扩字段 + 落盘 |
| C5 | **统计不含搜索腿、不含 source mismatch、不含耗时** | `tier3Api.ts:841-861`；§5.1 实测 | 小-中 |
| C6 | **`SNIFF_TIMEOUT_MS` 不可达 / 注释与代码不一致** | `tier3Api.ts:445` vs `114` | 极小 |
| C7 | **单源 `timeoutMs` 被 transport 重试放大 (1+maxRetries) 倍**（实测 300ms → 1917ms/4 请求） | `transport.ts:105/143-144/184-186`；§3.2 实测 | 小：给 tier3 请求关重试或按墙钟设值 |
| C8 | **水合不校验清单**（实测垃圾 `sources:[{id:1}]` 被原样接受） | `tier3Api.ts:172-178` | 小 |
| C9 | **URL 订阅只在手动刷新时更新，无 TTL 自动刷新**；`updatedAt` 不展示 | `tier3Api.ts:766-777`；§1.1 | 中（涉及策略选择） |
| C10 | **"仅直连"挡不住"直连返空"** | `sourceRouter.ts:458/540` vs `461-467`；§4.5 | 小（先确认语义） |
| C11 | **桌面统计面板无刷新、无清零；两端展示口径不一致** | `Tier3Section.tsx:39-41` vs `settings.tsx:107-113/332-360` | 小 |
| C12 | **源顺序无提示、无按成功率/延迟排序** | `tier3Api.ts:834-835`；`tier3Stats` 无读取方 | 中 |
| C13 | **`source.resolve.url` 自身域名无约束**（信任模型需在文档写死） | `tier3Api.ts:199-205` | 文档级 |

### 8.2 我们控制不了的（生态/上游，t1 已证）

| # | 事实 | 出处 |
|---|---|---|
| X1 | **源站消失**：lx-music 2023-10-18 因腾讯投诉移除全部内置源；MusicFree 因告知函不再提供国内源 | t1 §0.3 / §2.1 |
| X2 | **源站限流**：GD Studio 自述 5 分钟 50 次；Huibq 源 README 自述"反复请求会被封禁 IP" | t1 §0.3 |
| X3 | **源站改契约/降级**：vkeys V3 自述"v2 接口因腾讯调整，无法获取会员歌曲及高音质" | t1 §0.5 |
| X4 | **JS 插件生态 tier3 吃不下**（无执行字段） | t1 §0.1 / §1.5.9 |
| X5 | **上游返回空/错误封套的语义不可知**：源站"没这首歌"与"源站挂了"在 HTTP 层无法区分，我们只能靠 `code/message` 封套猜（`tier3Api.ts:501-508`） | t1 §1.5.2 |
| X6 | **清单文件的托管方**（GitHub raw / 个人站）随时可下线——订阅 URL 本身也是"会过期"的一层 | 推论（t1 记录了大量个人仓库源，均属此列） |
| X7 | **生态规模本身在衰减**，接入更多源只是"从一个失效面挪到另一个失效面" | t1 §0.4 |

**关键区分**：用户报的三个症状里，「源太少」= X 类（t1 已结）；「会过期」= X1/X3/X6 **叠加** C9/C4（我们不做自动刷新、不记坏源 → 过期后无法自愈）；「有并发问题」= **主要是 C1/C2/C3/C7**（我们的机制把慢源的代价放大到了整条链上），X2 只贡献了"上游为什么要限流"。

---

## 附：本报告实测的方法与原始输出

**方法**：在 `packages/core` 里临时新增一次性 vitest 用例（`src/tier3/__tests__/t3exp*.test.ts`、`src/api/__tests__/t3exp-transport.test.ts`），通过 `setTier3Deps({ request })` 注入**可控延迟/可控响应的假 transport**，对 `createTier3Resolver()` / `searchTier3Songs()` / `resolvePlayableSongRouted()` / `request()` 计时与计数。**用例已全部删除**（`git status` 确认工作区无新增测试文件）。core 既有测试套件跑通作为基线：**41 files / 446 tests 全绿**（`npx vitest run --coverage=false`）。

| 实验 | 输入 | 原始输出 |
|---|---|---|
| EXP1 串行 | 4 源 × 60ms，全 500 | `elapsed=241ms 请求发起时刻=[0,60,121,181]` |
| EXP2 搜索串行 | 3 源 × 60ms | `elapsed=182ms 请求时刻=[0,61,121]` |
| EXP3 饿死 | 3 慢源(3s) + 1 好源 | `elapsed=6005ms url= 请求过的 host=["slow1","slow2"]`（`good` 未请求） |
| EXP4 搜索无预算 | 5 源 × 2s | `搜索兜底耗时=10008ms` |
| EXP5 白名单短路 | 白名单外 URL | `result="" 请求=[api.example.com] stats={wl:{hits:0,misses:1}}`（不嗅探） |
| EXP6 HTML 隔离 | HTML 源 + 好源 | `请求=[a,b,cdn] result="https://cdn.example.com/a.mp3"`（坏源不污染好源） |
| EXP7 无熔断 | 同坏源 × 3 次 | `上游请求总数=3 stats={dead:{hits:0,misses:3}}` |
| EXP8 无并发上限 | 20 首并发 | `上游并发峰值=20` |
| EXP9 去重不覆盖 core 入口 | 同一首歌直调 resolver × 3 | `上游请求数=3` |
| EXP10 搜索候选回灌 | 搜索命中 `id: tier3:mitu:777` | 解析请求 URL `.../r?id=777&n=晴天`（前缀被 `stripSourceIdPrefix` 剥净，无 `tier3:` 泄漏） |
| EXP11 水合不校验 | 垃圾 subscription | `sources[0]={"id":1}`（原样接受，无报错） |
| EXP12 transport 放大 | 永不响应的本地 server，`timeoutMs:300` | `elapsed=1917ms 服务端请求数=4 err=ECONNABORTED` |

## 明确「未验证 / 不知道」

- **未做真机/真源端到端验证**：本报告全部数字来自**注入假 transport 的一次性 vitest**，不是真机、不是真实第三方源。§4.2 的"饿死"在真机上的复现概率取决于用户订阅里慢源的实际位置与超时设置——**未验证**。
- **§4.5「仅直连挡不住直连返空」只做了代码路径阅读**（`sourceRouter.ts:458/540`），未写端到端测试、未真机验证。产品语义到底该是哪种**未确认**。
- **`SNIFF_TIMEOUT_MS` 在真实网络下的实际影响未测**：§3.1 只证明"当用户配了 timeoutMs 时 8000 不可达"（读代码即可判定）；用户**没配** timeoutMs 时是否有人依赖 8s 这个值——**未在仓库里找到任何依据**（清单里 `timeoutMs` 未声明，且 t1 未记录任何真实清单样本）。
- **`history` 与 `tier3Stats` 是否被其他子系统消费**：只在 core/mobile/renderer 三处 grep 过 `getTier3Stats|Tier3SourceStats`，**未**穷举动态引用 / 序列化路径（如日志上报、崩溃上报）；判断"仅设置页消费"基于 grep 而非人工通读全仓。
- **移动端 AsyncStorage 里 `tier3State` 的实际存量形态未实测**：§1.2 的"水合不校验"在移动端会走 `settingsStore` 的重水合分支（`settingsStore.ts:80-89`），是否真有脏数据——**未验证**。
- **t1 提到的 mgmp3 类 20s 超时源的清单原文**：本报告 §3.2 的 61.5s/246s 推算是按 `maxRetries=3` + 指数退避算的**理论上界**，未拿到真实清单里 `timeoutMs` 的实际取值分布——**不知道**（t1 未记录，仓库里零端点）。
- **并发（C3）到底该不该加、加多少**：本报告只证明"现在无上限"，**没有做用户量/源站容忍度的量化**，因此不给具体数值建议。
- **桌面 `tier3State` 的 db 存储介质与并发写安全性**（`db.setSetting` 是否原子）：未读 `src/main/storage/` 实现，**未验证**。
