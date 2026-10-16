/**
 * 播放链路的「超时 / 墙 / 预算」单点常量表（#399）。
 * 只收「跨模块共享的墙 / 预算 / 传输默认值」；某个源自己的一次性请求超时留在该源文件里（那些值大多
 * 被上层的墙盖住，见 #399 的死值清单）。
 */

/**
 * 直连此前**完全裸露**在源自己的 `timeoutMs`（最长 30s）× transport 3 次重试下，最坏 20–30s 无声无
 * 反馈，而这段时间 tier3 兜底腿还没开始。
 * ⚠️ 它是**「拿到 URL」那一段**的墙。
 */
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

/**
 * 此前「一首歌最多等多久」只能把常量相加推出来（3s + 6s + 第二条 tier3 腿 6s = 最坏 15s）。
 * **它是墙钟、不暂停**：K=3 槽位排队时间照走（否则三个槽位被占满时整链无界等待）。
 * ADR 2026-09-25 决策 8 的「排队不计入预算」只约束 **tier3 腿预算**（腿预算从槽位到手起计）。
 */
export const RESOLUTION_CHAIN_BUDGET_MS = DIRECT_WALL_MS + TIER3_CHAIN_BUDGET_MS;

/**
 * tier3 **单源硬墙**按 kind 分档（ADR 2026-09-25 决策 7；取代 ADR-0014 决策 2 的扁平 2s）。
 * ADR 记的 3s 是**安全余量（上界）**，不是目标值，故这里取 2s / 2.5s。
 * 清单里的 `timeoutMs` 只能收紧到它以下，不能放大（`effectiveSourceTimeout`）。
 */
export const TIER3_SOURCE_WALL_MS_BY_KIND = {
  'url-resolver': 2_000,
  'search-then-resolve': 2_500,
} as const;

/** kind 未知时的单源兜底墙（清单给了本模块表里没有的 kind 时用）。 */
export const TIER3_SOURCE_WALL_FALLBACK_MS = 2_000;

/**
 * tier3 候选嗅探超时（ADR-0014 决策 3）：独立常量、不继承源 timeoutMs。
 * 实测依据：首字节 ~0.39s（含 TLS 握手 ~0.19s），复用连接 ~0.19s；且 1KB 与 1MB 的 Range 延迟无差别
 * （成本在连接而非字节数）。
 */
export const TIER3_SNIFF_TIMEOUT_MS = 1_000;

/** 订阅清单拉取超时（管理面请求，与解析腿无关：订阅 URL 没有 kind、没有 kind 墙可依）。
 *  值沿用旧 `DEFAULT_TIMEOUT_MS`——#399 只把它与源超时解耦，未改值。 */
export const TIER3_MANIFEST_FETCH_TIMEOUT_MS = 2_000;

/**
 * **严格搜索腿墙**（#544 / #556）：解析链尾巴那次搜索的硬上界。
 * 这条腿与直连解析腿的形态不同——它是**一跳搜索**（可能再叠一跳 tier3 搜索兜底，见 
 * `searchSongsRouted`），语义是「拿候选然后精确匹配」，不是「一定要拿到 URL」。
 */
export const SEARCH_LEG_WALL_MS = 2_500;

/** transport 重试：首次尝试之外的额外次数（#155）。
 *  ⚠️ 它是**墙上限的乘数**而非被掩盖者：「源 timeout × 4 + 退避」是墙内可能耗时。 */
export const TRANSPORT_MAX_RETRIES = 3;

/** transport 重试指数退避基数（ms）：第 n 次重试前等待 base * 2^(n-1)。 */
export const TRANSPORT_RETRY_BASE_DELAY_MS = 100;

/** transport 默认单请求超时：只兜「没显式传 timeoutMs」的调用点。
 *  解析腿触达不到它（那些调用点都显式传值），故它不参与墙的口径。 */
export const TRANSPORT_DEFAULT_TIMEOUT_MS = 12_000;
