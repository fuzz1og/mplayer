/**
 * 播放链路的「超时 / 墙 / 预算」单点常量表（#399）。
 *
 * 五个层次别混着叫「超时」——这是本文件存在的全部理由：
 *
 * 1. **单请求超时**（传输层 / 源自己声明）：一次 HTTP 尝试的上限。各源 8–30s 不等、
 *    到处显式传；transport 的 `TRANSPORT_DEFAULT_TIMEOUT_MS` 只兜「没显式传」的调用点。
 * 2. **墙 wall**（调度层，腿的调用方持有）：该腿的硬上界，**到点 = 放弃 + abort**
 *    （#408 起墙的持有者持有 AbortController，不再是「放弃等待但底层继续压上游」）。
 * 3. **预算 budget**（编排层）：整条腿共享的池子，多个源/多次尝试分食；耗尽按
 *    「迟到命中丢弃」结算（例：tier3 解析腿 6s）。
 * 4. **闸门排队 gate**（transport 接缝，见 `api/outboundGate.ts`，#408/#413）：
 *    **不是超时**，是并发节流（全局 6 / 每 host 2）。但它**消耗墙与预算**——排队期间
 *    墙照走。这条口径由 #399 记录，闸门自身不感知墙钟。
 * 5. **解析链总预算 resolution budget**（#424，编排层之上）：**一次解析链**的总 deadline，
 *    各腿取 `min(本腿墙, 剩余)`，耗尽即 abort 在飞请求并停止遍历。解析链尾巴上的
 *    **严格搜索腿墙**（`SEARCH_LEG_WALL_MS`，#556）同样取 `min(本腿墙, 剩余)`——
 *    它是第 2 层「墙」在尾腿上的一个实例，不是新的一层。
 *    ⚠️ 与第 3 层里 tier3 的「整链 6s 预算」（`TIER3_CHAIN_BUDGET_MS`，既有文档与
 *    ADR-0014 决策 2 的用词）**不是同一层**：那个「链」指 tier3 的源遍历链，是**腿**预算；
 *    为免一词两义，本文件与其消费方一律称本层为「解析链总预算」。
 *
 * 只收「跨模块共享的墙 / 预算 / 传输默认值」；某个源自己的一次性请求超时留在该源文件里
 * （那些值大多被上层的墙盖住，见 #399 的死值清单）。
 *
 * 面向用户的旋钮**只有一个**：tier3 订阅清单里每个源的 `timeoutMs`——而且只能**收紧**
 * 到 kind 硬墙以下（`effectiveSourceTimeout`），不能放大。
 */

/** 直连解析腿墙钟上限（#389）。
 *
 * 直连此前**完全裸露**在源自己的 `timeoutMs`（最长 30s）× transport 3 次重试下，
 * 最坏 20–30s 无声无反馈，而这段时间 tier3 兜底腿还没开始。取 3s 与 tier3 单源墙同
 * 量级——直连是单请求腿，且已有预取缓存兜低延迟路径（直连解析 P50 ~66ms，余量充足）。
 *
 * ⚠️ 它是**「拿到 URL」那一段**的墙。拿到之后的播放期时长取证
 * （`DIRECT_VALIDATION_TIMEOUT_MS`，只对无权威时长的源）在墙**之外**追加，
 * 所以直连腿成功路径的实际上界 = 3s + 1.5s = **4.5s**（失败路径仍是 3s）。
 * 因此「直连腿 ≤3s」是错的读法；`#335` 的 P95 ≤3s 口径是「URL 就绪」不含取证。 */
export const DIRECT_WALL_MS = 3_000;

/** 直连腿播放期时长取证超时（#392）：**在 3s 直连墙之外**的独立小额。
 *  一次 Range 头请求；不继承任何源 timeoutMs（「首字节该多快」与「解析允许多慢」是两件事）。 */
export const DIRECT_VALIDATION_TIMEOUT_MS = 1_500;

/** 直链活性闸超时（在解析链之外）：移动端缓存命中的 URL 交给播放器前的快检。 */
export const URL_ALIVE_PROBE_TIMEOUT_MS = 1_500;

/** tier3 解析腿预算（ADR-0014 决策 2「整链 6s 软顶」——该「链」指 **tier3 的源遍历链**，
 *  即本常量是**腿**预算，与下面的「解析链总预算」不是同一层；术语消歧见文件头第 5 条）。
 *  预算耗尽 = 放弃等待、迟到命中丢弃（记「丢弃」而非「交付」）。 */
export const TIER3_CHAIN_BUDGET_MS = 6_000;

/** tier3 搜索兜底腿预算（与解析腿独立，ADR 2026-09-25 决策 9）。
 *  与解析腿不同：搜索是「尽量找全」，预算耗尽**返回已收集的部分结果**而不是丢弃。 */
export const TIER3_SEARCH_BUDGET_MS = 6_000;

/** **解析链总预算**（#424）：一次 `resolvePlayableSongRouted` / `resolvePlayableUrlRouted`
 *  从入口到出结果（或失败）的**活跃时间**总上界 = 直连腿墙 + 一条 tier3 腿预算。
 *
 *  它是 2026-09-27-playback-budget-layers 四层时限之外新补的第五层：整条链的 deadline。
 *  此前「一首歌最多等多久」只能把常量相加推出来（3s + 6s + 第二条 tier3 腿 6s = 最坏 15s）。
 *  取 9s 而不是更小值，是为了**不缩任何一条腿的局部墙**：直连腿仍拿满 3s、第一条 tier3 腿
 *  仍拿满 6s，被压缩的只有「试听换完整版」的第二条 tier3 腿——它只吃剩余额度，
 *  这也是 15s 那条路径的成因。
 *
 *  **它是墙钟、不暂停**：K=3 槽位排队时间照走（否则三个槽位被占满时整链无界等待）。
 *  ADR 2026-09-25 决策 8 的「排队不计入预算」只约束 **tier3 腿预算**（腿预算从槽位到手起计）。
 *
 *  **失败链口径**：一次播放失败 = 1 次链预算（宿主的 fresh 重试是**再一次**链预算）；
 *  `skipGuard` 连续 `SKIP_LIMIT` 首才停。详见 `shared/skipGuard.ts` 的
 *  `WORST_CASE_SILENT_MS`——把「最坏无声多久」也变成一个可断言的值。
 *
 *  ⚠️ 别与 `TIER3_CHAIN_BUDGET_MS` 的「整链 6s 预算」混称：那是 tier3 **腿**预算。 */
export const RESOLUTION_CHAIN_BUDGET_MS = DIRECT_WALL_MS + TIER3_CHAIN_BUDGET_MS;

/** tier3 **单源硬墙**按 kind 分档（ADR 2026-09-25 决策 7；取代 ADR-0014 决策 2 的扁平 2s）。
 *
 *  两步源的三段网络（搜索 + 解析 + 嗅探）在同一个墙内，扁平 2s 结构性偏紧：#388 实测
 *  一次 2047ms 的**成功路径**被切掉；一步源 2s 余量充足（实测 max 1264ms）。
 *  ADR 记的 3s 是**安全余量（上界）**，不是目标值，故这里取 2s / 2.5s。
 *  清单里的 `timeoutMs` 只能收紧到它以下，不能放大（`effectiveSourceTimeout`）。 */
export const TIER3_SOURCE_WALL_MS_BY_KIND = {
  'url-resolver': 2_000,
  'search-then-resolve': 2_500,
} as const;

/** kind 未知时的单源兜底墙（清单给了本模块表里没有的 kind 时用）。 */
export const TIER3_SOURCE_WALL_FALLBACK_MS = 2_000;

/** tier3 候选嗅探超时（ADR-0014 决策 3）：独立常量、不继承源 timeoutMs。
 *
 *  实测依据：首字节 ~0.39s（含 TLS 握手 ~0.19s），复用连接 ~0.19s；且 1KB 与 1MB 的
 *  Range 延迟无差别（成本在连接而非字节数）。
 *
 *  ADR-0014 决策 3 给它的定位是「独立 1s」：与源 `timeoutMs` 无关，也不随清单变化。
 *
 *  **不占单源墙**（#399）：嗅探期间单源墙暂停计时（`tier3Api` 的 `SourceClock`），
 *  它自己按本值计时；但它**计入 tier3 腿预算** `TIER3_CHAIN_BUDGET_MS`——所以单源上界
 *  变成「墙 + 1s」之后，tier3 腿的上界仍是 6s，不会膨胀成「6s + N×1s」。 */
export const TIER3_SNIFF_TIMEOUT_MS = 1_000;

/** 订阅清单拉取超时（管理面请求，与解析腿无关：订阅 URL 没有 kind、没有 kind 墙可依）。
 *  值沿用旧 `DEFAULT_TIMEOUT_MS`——#399 只把它与源超时解耦，未改值。 */
export const TIER3_MANIFEST_FETCH_TIMEOUT_MS = 2_000;

/** **严格搜索腿墙**（#544 / #556）：解析链尾巴那次搜索的硬上界。
 *
 *  这条腿与直连解析腿的形态不同——它是**一跳搜索**（可能再叠一跳 tier3 搜索兜底，
 *  见 `searchSongsRouted`），语义是「拿候选然后精确匹配」，不是「一定要拿到 URL」。
 *
 *  依据 research 2026-09-24 §3.4 / §3.5：直连搜索正常 P50 88–867ms；离群是 qianqian
 *  的 5% 双峰（4.07–4.17s，一把 2s 墙即可压到 ~200ms 且不损失命中）；tier3 搜索腿
 *  P50 ~487ms。取 2.5s = 一跳一档的直连搜索墙（同 TIER3_SOURCE_WALL_MS_BY_KIND 的
 *  `search-then-resolve` 档），覆盖「直连搜索 + 一跳 tier3 搜索兜底」的正常路径，
 *  同时把 qianqian 那类离群截在链总预算之内。
 *
 *  ⚠️ 与既有口径的关系：`searchSongsRouted` 的**直连搜索腿**历来不套墙（#389 决策：
 *  搜索是「尽量找全」，套墙会静默截断列表结果）。本墙只约束**解析链尾巴这一次搜索**
 *  （那里要的是「有没有精确匹配」而不是「找全」），不改变搜索页/列表页的搜索行为。 */
export const SEARCH_LEG_WALL_MS = 2_500;

/** transport 重试：首次尝试之外的额外次数（#155）。
 *  ⚠️ 它是**墙上限的乘数**而非被掩盖者：「源 timeout × 4 + 退避」是墙内可能耗时。 */
export const TRANSPORT_MAX_RETRIES = 3;

/** transport 重试指数退避基数（ms）：第 n 次重试前等待 base * 2^(n-1)。 */
export const TRANSPORT_RETRY_BASE_DELAY_MS = 100;

/** transport 默认单请求超时：只兜「没显式传 timeoutMs」的调用点。
 *  解析腿触达不到它（那些调用点都显式传值），故它不参与墙的口径。 */
export const TRANSPORT_DEFAULT_TIMEOUT_MS = 12_000;
