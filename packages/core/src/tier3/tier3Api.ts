import type { Song, SourceKey } from '../types/index.js';
import { request, bodyToText, type TransportRequest } from '../api/transport.js';
import { BROWSER_UA } from '../utils/sourceReferer.js';
import { isExactMatch, normalize } from '../utils/songMatcher.js';
import { stripSourceIdPrefix } from '../utils/sourceIdPrefix.js';
import { evaluatePlaybackGuard } from '../shared/playbackGuard.js';
import type { PlaybackEvidence, PlaybackGuard } from '../shared/playbackGuard.js';
import { extractAudioDuration } from '../shared/audioDuration.js';
import type { AudioDurationEvidence } from '../shared/audioDuration.js';
import { classifyTraceError, traceNow } from '../shared/playbackTrace.js';
import type { PlaybackTraceErrorClass, PlaybackTraceSourceLeg } from '../shared/playbackTrace.js';
import {
  beginInit,
  clearSourceSchedule,
  getSourceScheduleSnapshot,
  noteSample,
  orderSources,
  scoreOf,
  SCHEDULE_HEDGE_MS,
  SCHEDULE_INIT_INFLIGHT,
  type SourceSampleKind,
} from '../shared/sourceSchedule.js';
import { fetchAudioHead } from '../shared/audioHead.js';
import {
  TIER3_BUDGET_MS,
  SOURCE_DISPLAY_NAMES,
  getSourceMode,
  releaseTier3SourceSlot,
  setTier3Enabled as setRouterTier3Enabled,
  setTier3Resolver as setRouterTier3Resolver,
  setTier3SearchEnabled as setRouterTier3SearchEnabled,
  setTier3SearchResolver as setRouterTier3SearchResolver,
  tryAcquireTier3SourceSlot,
  type Tier3LegCollector,
  type Tier3Resolution,
  type Tier3Resolver,
  type Tier3RunControl,
} from '../shared/sourceRouter.js';

/**
 * tier3Api —— 第三方解析源订阅执行器（#144）。
 *
 * 设计目标（spec #144）：
 * - 用户通过订阅 JSON 音源清单，为官方直连失败的歌曲提供可播 URL 兜底；
 * - 默认关闭、失败自动降级、公开仓库零端点（本文件不含任何第三方端点）；
 * - 仅执行「可纯声明描述的源」：url-resolver（按 id 直取）与
 *   search-then-resolve（先搜再解）；
 * - 安全：schema 校验 + 版本化 + 域名白名单 + 返回 URL 字节嗅探。
 *
 * 核心零 I/O：订阅拉取走统一 transport 接缝；本地文件由桌面宿主读文件后
 * 以文本形式交给本模块；移动端手动粘贴同理。
 */

// ── 类型 ─────────────────────────────────────────────────────────────

export type Tier3SourceKind = 'url-resolver' | 'search-then-resolve';

/** 一次声明式请求：url 为模板，支持 {id} {source} {name} {artist} {keyword}。 */
export interface Tier3RequestSpec {
  method?: 'GET' | 'POST';
  url: string;
  /** POST 请求体模板（原始填充，不 URL 编码）。 */
  body?: string;
  /** 响应取值方式（默认 `json`）：`json` 走 responseJsonPath；`redirect` 取重定向终点 URL。
   *  `redirect` 用于 302 直跳音频的端点——响应体是音频字节，无法 JSON.parse。 */
  responseKind?: 'json' | 'redirect';
  /** JSON 响应取值路径，如 `data.url` / `data.list`；`responseKind:"redirect"` 时可省略。 */
  responseJsonPath?: string;
}

export interface Tier3SearchSpec extends Tier3RequestSpec {
  /** 搜索结果数组路径，如 `data.list`。 */
  itemsPath: string;
  /** 条目内歌名字段路径。 */
  namePath: string;
  /** 条目内歌手段路径（可选，缺省不校验歌手）。 */
  artistPath?: string;
  /** 条目内歌曲 id 字段路径（用于后续 resolve 步骤）。 */
  idPath?: string;
  /** 条目内直链字段路径（可选；命中则直接使用）。 */
  urlPath?: string;
  /** 条目内封面字段路径（可选；缺省尝试常见字段 pic/cover/img/albumPic）。 */
  coverPath?: string;
  /** 条目内专辑字段路径（可选；缺省尝试常见字段 album/albumName/albumTitle）。 */
  albumPath?: string;
}

export interface Tier3Source {
  /** 源代号（如 vkeys / gdstudio），仅用于日志与 UI 展示。 */
  id: string;
  name?: string;
  /** 该源适用的原始音源（如 qq/netease/kuwo）。url-resolver 建议必填，
   *  防止跨源时把 A 源的 id 当成 B 源的 id，解析出完全不同的歌。 */
  source?: string;
  kind: Tier3SourceKind;
  /** 返回音频 URL 的域名白名单；支持 `*.example.com` 通配子域。 */
  allowedDomains: string[];
  /** 单源超时（毫秒），默认 15000。 */
  timeoutMs?: number;
  /** 单源请求头（会合并到 API 请求与字节嗅探请求）。 */
  headers?: Record<string, string>;
  /** 按源归一化模板变量 `{id}`：逐条剥离前缀（如酷我 MUSICRID 的 `MUSIC_`）。
   *  只影响 tier3 模板填充，不改 `Song.id` / 身份键 / 已持久化数据。 */
  idNormalize?: { stripPrefixes: string[] };
  /** url-resolver 与 search-then-resolve 的取链步骤。 */
  resolve: Tier3RequestSpec;
  /** search-then-resolve 专用：搜索步骤。 */
  search?: Tier3SearchSpec;
}

export interface Tier3Manifest {
  version: 1;
  sources: Tier3Source[];
}

export type Tier3SubscriptionKind = 'url' | 'text' | 'file';

export interface Tier3Subscription {
  id: string;
  name: string;
  kind: Tier3SubscriptionKind;
  /** URL 订阅的地址 / 本地文件路径 / 手动粘贴的说明。 */
  source: string;
  manifest: Tier3Manifest;
  updatedAt: number;
}

export interface Tier3State {
  enabled: boolean;
  subscriptions: Tier3Subscription[];
}

/** 每源累计解析统计（设置页展示；内存计数，本次会话有效、不持久化）。
 *  - hits：**真正交付**给调用方的命中数——只有路由层在整链预算内采纳该候选才计
 *    （#362：原先在 resolver 内部自增，预算超时被丢弃的迟到命中也被记成「命中」，
 *    实测一个源 hits=17 而同一批歌 21/21 全部超时失败，设置页与体验相反）；
 *  - resolved：resolver 产出的、过护栏的候选数（含迟到被丢弃的）；
 *  - discarded：预算超时被丢弃的迟到命中数（= resolved - hits，读取时派生）；
 *  - misses：解析腿未命中；
 *  - skipped：因 source 归属不匹配被跳过（ADR-0014：显式声明才过滤）；
 *  - searches：搜索兜底腿参与的关键词搜索次数（此前完全未统计）；
 *  - lastError：最近一次失败原因（排障用，非累计）；
 *  - guards / guardRejected：护栏（#361）按证据等级的命中与拒绝计数——与 resolved/misses
 *    一样记 resolver 内部决策，**含预算超时后仍在后台跑完的迟到工作**；只有 hits 是交付口径；
 *  - sizeBitrateDeclared / sizeBitrateMeasured：L3 两条码率分支分别计数
 *    （ADR：帧实测码率在 ±2s 下会误判，必须与自称码率分开归因）。
 *  仅会话内有效是有意为之：源健康度是时变的，昨日状态不应污染今日判断
 *  （ADR-0014「坏源只做统计」，不做熔断/降权/持久化）。 */
export interface Tier3SourceStats {
  hits: number;
  /** resolver 产出（过护栏）的候选数；`hits` ≤ `resolved`。 */
  resolved: number;
  /** 预算超时被丢弃的迟到命中数（读取时按 resolved - hits 派生）。 */
  discarded: number;
  misses: number;
  skipped: number;
  searches: number;
  lastError?: string;
  /** 护栏命中次数（按证据等级；#361）。 */
  guards?: Partial<Record<PlaybackGuard, number>>;
  /** 护栏拒绝次数（候选被换掉；#361）。 */
  guardRejected?: number;
  /** L3 用**源自称码率**估算的次数（含命中与误拒；#361）。 */
  sizeBitrateDeclared?: number;
  /** L3 用**帧实测码率**估算的次数（含命中与误拒；#361——该分支在 ±2s 下会误判，需可归因）。 */
  sizeBitrateMeasured?: number;
  /** 会话内健康度（#398）：EWMA 分（0–1），读取时由 `shared/sourceSchedule` 派生。
   *  只用于**调整遍历顺序**，不做熔断、不禁用、不删源、不持久化。 */
  healthScore?: number;
  /** 计入健康度的样本数（截尾算 1 条、放弃观测不算、护栏拒绝与跳过不算）。 */
  healthSamples?: number;
  /** 是否已降级（连续失败 N=2）——只排到队尾，成功一次即回归（决策 3）。 */
  demoted?: boolean;
}

export interface Tier3Deps {
  /** 测试/自定义请求入口；缺省走 core transport 默认实现。 */
  request?: (req: TransportRequest) => Promise<import('../api/transport.js').TransportResponse>;
}

/** 单源解析请求超时（ADR-0014 超时阶梯：单源 2s 硬墙）。
 *  原为 15_000，远超整链 6s 预算（sourceRouter 的 TIER3_BUDGET_MS），
 *  使预算失去约束力——单源挂起即可吃光全链预算、饿死后续好源。
 *  且 transport 的 maxRetries=3 会对超时类错误重试，实际耗时再被放大。 */
const DEFAULT_TIMEOUT_MS = 2_000;

/** 单源硬墙**按 kind 分档**（ADR 2026-09-25 决策 7；清单里的 `timeoutMs` 只能**收紧**到它
 *  以下，不能放大）。原为扁平 2s（ADR-0014 决策 2）——但那对两步源结构性偏紧：
 *  `search-then-resolve` 的三段网络串行在**同一个墙**内（`withSourceDeadline` 包住
 *  `resolveTier3Candidate`，内含搜索 + 解析 + 嗅探），#388 实测一次 **2047ms 的成功路径**
 *  与一次 2081ms 被 2s 墙切掉；一步源 2s 余量充足（实测 max 1264ms / 1267ms）。
 *  3s 是 ADR 记的**安全余量（上界）**，不是目标值；本实现取 2s / 2.5s，均在该余量之内。 */
const MAX_SOURCE_TIMEOUT_MS_BY_KIND: Record<Tier3SourceKind, number> = {
  'url-resolver': 2_000,
  'search-then-resolve': 2_500,
};

/**
 * 单源超时的**默认值**：不写 `timeoutMs` 时取该 kind 的硬墙本身（ADR 2026-09-25 决策 7 补记）。
 *
 * 决策 7 给两步源分档 2.5s 的理由是「2s 会切掉实测 2047ms 的成功路径」——若默认值仍是扁平的
 * 2s，那条理由对**任何没显式写 2500 的清单**都依然成立，分档等于白设（#394 验收时发现：
 * 用户清单的通用兜底条目写 2000，2.5s 的墙从未被碰到）。
 * 显式写 `timeoutMs` 仍然只能收紧：`effectiveSourceTimeout` 会把它夹到硬墙以下。
 */
function defaultSourceTimeout(kind: Tier3SourceKind): number {
  return MAX_SOURCE_TIMEOUT_MS_BY_KIND[kind] ?? DEFAULT_TIMEOUT_MS;
}

/** 单源墙钟哨兵：与「源未命中返回 null」区分开，日志/统计口径不同。 */
const SOURCE_TIMED_OUT = Symbol('tier3-source-timed-out');

/** 单源有效超时 = `min(清单 timeoutMs ?? 该 kind 默认值, 该 kind 硬墙, 整链剩余预算)`。 */
function effectiveSourceTimeout(source: Tier3Source, remainingBudgetMs: number): number {
  const configured = source.timeoutMs ?? defaultSourceTimeout(source.kind);
  const wall = MAX_SOURCE_TIMEOUT_MS_BY_KIND[source.kind] ?? DEFAULT_TIMEOUT_MS;
  return Math.max(1, Math.min(configured, wall, remainingBudgetMs));
}

/** 单源墙钟上限：把 transport 的重试（maxRetries=3，超时/TLS 类错误可重试）也算在内，
 *  到点即换下一个源；底层请求自然结束、结果丢弃——与整链预算同一语义。 */
async function withSourceDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof SOURCE_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof SOURCE_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(SOURCE_TIMED_OUT), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 嗅探超时（ADR-0014 决策 3）：独立常量、不继承源 timeoutMs。
 *  实测依据：首字节 ~0.39s（含 TLS 握手 ~0.19s），复用连接 ~0.19s；
 *  且 1KB 与 1MB 的 Range 延迟无差别（成本在连接而非字节数）。 */
const SNIFF_TIMEOUT_MS = 1_000;

/** 搜索兜底腿整链预算（ADR-0014 决策 2「搜索腿补同款预算」）。
 *  此前该腿**完全没有预算**（直接串行 await），实测 5 源各 2s = 10s 无上限。
 *  与解析腿不同：搜索是「尽量找全」，故预算耗尽时**返回已收集的部分结果**
 *  而不是丢弃——部分候选对用户仍有用，总比空列表好。 */
const TIER3_SEARCH_BUDGET_MS = 6_000;

/** 试听片段大小阈值：<1MB 视为片段（30s 128kbps ≈ 480KB）。
 *  tier3 解析到片段时宁可跳过，也不把试听版当完整版播。 */
const TRIAL_BYTES_THRESHOLD = 1_048_576;

// ── 状态（core 零 I/O，宿主注册 persister 落盘）──────────────────────

let state: Tier3State = { enabled: false, subscriptions: [] };
let persister: ((next: Tier3State) => void) | null = null;
const tier3Stats = new Map<string, Tier3SourceStats>();

/** 零值统计（新增字段都在此初始化，避免各处 `?? {...}` 漏字段）。 */
function emptyStats(): Tier3SourceStats {
  return { hits: 0, resolved: 0, discarded: 0, misses: 0, skipped: 0, searches: 0 };
}

/** 取（或初始化）某源的可变统计对象。 */
function statsFor(id: string): Tier3SourceStats {
  let s = tier3Stats.get(id);
  if (!s) {
    s = emptyStats();
    tier3Stats.set(id, s);
  }
  return s;
}

/** 每源累计统计（key = source.id）。
 *  `discarded` 在读取时按 `resolved - hits` 派生：迟到命中与「路由层是否采纳」
 *  的时序无法在写入侧无竞态地判定（同歌去重下多个调用方共享一条解析），
 *  交付（hits）只由采纳方 commit，未交付的产出就是被丢弃的。 */
export function getTier3Stats(): Record<string, Tier3SourceStats> {
  // #398：健康度与会话内调度状态同源（shared/sourceSchedule），读取时派生——
  // 统计本身仍只记计数，避免两处各存一份分数而漂移。
  const health = getSourceScheduleSnapshot();
  return Object.fromEntries(
    [...tier3Stats].map(([id, s]) => {
      const h = health[id];
      return [
        id,
        {
          ...s,
          discarded: Math.max(0, (s.resolved ?? 0) - s.hits),
          ...(h && h.samples > 0
            ? { healthScore: h.score, healthSamples: h.samples, demoted: h.demoted }
            : {}),
        },
      ];
    }),
  );
}

/** 测试/重置用：清空统计。 */
export function clearTier3Stats(): void {
  tier3Stats.clear();
}

function persist(): void {
  persister?.({ ...state });
}

function syncRouter(): void {
  setRouterTier3Enabled(state.enabled);
  setRouterTier3Resolver(createTier3Resolver());
  setRouterTier3SearchEnabled(state.enabled);
  setRouterTier3SearchResolver(state.enabled ? searchTier3Songs : null);
}

export function setTier3Enabled(enabled: boolean): void {
  state = { ...state, enabled };
  syncRouter();
  persist();
}

export function getTier3Enabled(): boolean {
  return state.enabled;
}

export function setTier3Subscriptions(subscriptions: Tier3Subscription[]): void {
  state = { ...state, subscriptions };
  // 订阅变更 = 源集合变了（#398 / ADR 决策 2 的重置时机）：清空会话内健康度，
  // 免得用旧清单的样本给新清单的源定序。add / remove / refresh 全部经此处，单一收口。
  clearSourceSchedule();
  syncRouter();
  persist();
}

export function getTier3Subscriptions(): Tier3Subscription[] {
  return state.subscriptions;
}

export function getTier3State(): Tier3State {
  return { ...state, subscriptions: state.subscriptions.map((s) => ({ ...s })) };
}

/** 启动/测试重水合：不触发持久化，但同步路由插槽。 */
export function loadTier3State(saved: Partial<Tier3State> | undefined): void {
  state = {
    enabled: !!saved?.enabled,
    subscriptions: Array.isArray(saved?.subscriptions) ? saved.subscriptions : [],
  };
  syncRouter();
}

export function setTier3Persister(persist: ((next: Tier3State) => void) | null): void {
  persister = persist;
}

// ── 清单解析与校验 ───────────────────────────────────────────────────

const SOURCE_KINDS: ReadonlySet<string> = new Set(['url-resolver', 'search-then-resolve']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`清单校验失败：${label} 必须是非空字符串`);
  }
  return value.trim();
}

function assertHttpUrlTemplate(value: unknown, label: string): string {
  const url = assertString(value, label);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`清单校验失败：${label} 必须是 http(s) 模板`);
  }
  return url;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`清单校验失败：${label} 必须是非空数组`);
  }
  return value.map((v, i) => assertString(v, `${label}[${i}]`));
}

function assertOptionalHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('清单校验失败：headers 必须是对象');
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val !== 'string') throw new Error(`清单校验失败：headers.${key} 必须是字符串`);
    out[key] = val;
  }
  return out;
}

function parseRequestSpec(value: unknown, label: string): Tier3RequestSpec {
  if (!isRecord(value)) throw new Error(`清单校验失败：${label} 必须是对象`);
  const method = value.method === undefined ? 'GET' : value.method;
  if (method !== 'GET' && method !== 'POST') {
    throw new Error(`清单校验失败：${label}.method 只能是 GET 或 POST`);
  }
  const url = assertHttpUrlTemplate(value.url, `${label}.url`);
  const body = value.body === undefined ? undefined : assertString(value.body, `${label}.body`);
  const responseKind = value.responseKind === undefined ? 'json' : value.responseKind;
  if (responseKind !== 'json' && responseKind !== 'redirect') {
    throw new Error(`清单校验失败：${label}.responseKind 只能是 json 或 redirect`);
  }
  const responseJsonPath = value.responseJsonPath === undefined
    ? responseKind === 'redirect'
      ? undefined
      : assertString(value.responseJsonPath, `${label}.responseJsonPath`)
    : assertString(value.responseJsonPath, `${label}.responseJsonPath`);
  return { method, url, body, responseKind, responseJsonPath };
}

function parseSearchSpec(value: unknown, label: string): Tier3SearchSpec {
  const base = parseRequestSpec(value, label);
  if (!isRecord(value)) throw new Error(`清单校验失败：${label} 必须是对象`);
  const itemsPath = assertString(value.itemsPath, `${label}.itemsPath`);
  const namePath = assertString(value.namePath, `${label}.namePath`);
  const artistPath = value.artistPath === undefined ? undefined : assertString(value.artistPath, `${label}.artistPath`);
  const idPath = value.idPath === undefined ? undefined : assertString(value.idPath, `${label}.idPath`);
  const urlPath = value.urlPath === undefined ? undefined : assertString(value.urlPath, `${label}.urlPath`);
  const coverPath = value.coverPath === undefined ? undefined : assertString(value.coverPath, `${label}.coverPath`);
  const albumPath = value.albumPath === undefined ? undefined : assertString(value.albumPath, `${label}.albumPath`);
  return { ...base, itemsPath, namePath, artistPath, idPath, urlPath, coverPath, albumPath };
}

function parseSource(value: unknown): Tier3Source {
  if (!isRecord(value)) throw new Error('清单校验失败：source 必须是对象');
  const id = assertString(value.id, 'source.id');
  const source = value.source === undefined ? undefined : assertString(value.source, `source(${id}).source`);
  const kind = assertString(value.kind, 'source.kind');
  if (!SOURCE_KINDS.has(kind)) {
    throw new Error(`清单校验失败：source.kind 不支持 ${kind}`);
  }
  const allowedDomains = assertStringArray(value.allowedDomains, `source(${id}).allowedDomains`);
  const timeoutMs = value.timeoutMs === undefined ? undefined : value.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error(`清单校验失败：source(${id}).timeoutMs 必须是正数`);
  }
  const headers = assertOptionalHeaders(value.headers);
  let idNormalize: { stripPrefixes: string[] } | undefined;
  if (value.idNormalize !== undefined) {
    if (!isRecord(value.idNormalize)) {
      throw new Error(`清单校验失败：source(${id}).idNormalize 必须是对象`);
    }
    idNormalize = {
      stripPrefixes: assertStringArray(value.idNormalize.stripPrefixes, `source(${id}).idNormalize.stripPrefixes`),
    };
  }
  const resolve = parseRequestSpec(value.resolve, `source(${id}).resolve`);
  const search = kind === 'search-then-resolve'
    ? parseSearchSpec(value.search, `source(${id}).search`)
    : undefined;
  return {
    id,
    name: value.name === undefined ? undefined : assertString(value.name, `source(${id}).name`),
    source,
    kind: kind as Tier3SourceKind,
    allowedDomains,
    timeoutMs,
    headers,
    idNormalize,
    resolve,
    search,
  };
}

/**
 * 解析并校验订阅清单文本。
 * 版本化：当前仅接受 version=1；后续字段演进时在 parse 层做迁移/兼容。
 */
export function parseTier3Manifest(text: string): Tier3Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('订阅清单不是合法 JSON');
  }
  if (!isRecord(raw)) throw new Error('订阅清单必须是 JSON 对象');
  if (raw.version !== 1) {
    throw new Error(`订阅清单版本不支持：${String(raw.version)}（当前仅支持 1）`);
  }
  if (!Array.isArray(raw.sources)) throw new Error('订阅清单缺少 sources 数组');
  const sources = raw.sources.map(parseSource);
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.id)) throw new Error(`订阅清单 source.id 重复：${source.id}`);
    seen.add(source.id);
  }
  return { version: 1, sources };
}

// ── JSON 路径取值 ────────────────────────────────────────────────────

function getByPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split('.')) {
    if (!part) continue;
    if (cur == null) return undefined;
    if (/^\d+$/.test(part)) {
      cur = Array.isArray(cur) ? cur[Number(part)] : undefined;
    } else if (isRecord(cur)) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function toUrlCandidate(value: unknown): string | null {
  if (typeof value === 'string') {
    const url = value.trim();
    return /^https?:\/\//i.test(url) ? url : null;
  }
  if (isRecord(value)) {
    for (const key of ['url', 'src', 'audioUrl']) {
      const v = value[key];
      if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return v.trim();
    }
  }
  return null;
}

function asString(value: unknown): string {
  return value == null ? '' : String(value);
}

// ── 模板填充 ─────────────────────────────────────────────────────────

interface TemplateVars {
  id: string;
  source: string;
  name: string;
  artist: string;
  keyword: string;
}

function songVars(song: Song): TemplateVars {
  return {
    id: song.id ? stripSourceIdPrefix(song.id) : '',
    source: song.sourceType || '',
    name: song.name || '',
    artist: song.artist || '',
    keyword: `${song.name || ''} ${song.artist || ''}`.trim(),
  };
}

/** 按源剥离模板变量 `{id}` 的前缀（`idNormalize.stripPrefixes`）。
 *  只影响 tier3 模板填充，不动 `Song.id` 与身份键——酷我搜索产出 `MUSIC_<rid>`，
 *  而第三方酷我接口只认裸数字（#376 E1）。 */
function normalizeSourceId(id: string, source: Tier3Source): string {
  for (const prefix of source.idNormalize?.stripPrefixes || []) {
    if (prefix && id.startsWith(prefix)) return id.slice(prefix.length);
  }
  return id;
}

function fillTemplate(template: string, vars: TemplateVars, encode: boolean): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const raw = vars[key as keyof TemplateVars] ?? '';
    return encode ? encodeURIComponent(raw) : raw;
  });
}

function buildRequest(
  spec: Tier3RequestSpec,
  vars: TemplateVars,
  source: Tier3Source,
  responseType: 'text' | 'arraybuffer' = 'text',
  timeoutMs?: number,
): TransportRequest {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json',
    ...(source.headers || {}),
  };
  return {
    method: spec.method || 'GET',
    url: fillTemplate(spec.url, vars, true),
    headers,
    body: spec.body ? fillTemplate(spec.body, vars, false) : undefined,
    timeoutMs: timeoutMs ?? source.timeoutMs ?? defaultSourceTimeout(source.kind),
    responseType,
  };
}

// ── 域名白名单 ───────────────────────────────────────────────────────

function normalizeDomain(entry: string): string {
  let d = entry.trim().toLowerCase().replace(/\.$/, '');
  if (d.startsWith('https://')) d = d.slice(8);
  else if (d.startsWith('http://')) d = d.slice(7);
  const slash = d.indexOf('/');
  if (slash >= 0) d = d.slice(0, slash);
  const at = d.lastIndexOf('@');
  if (at >= 0) d = d.slice(at + 1);
  const colon = d.lastIndexOf(':');
  if (colon >= 0 && /^\d+$/.test(d.slice(colon + 1))) d = d.slice(0, colon);
  return d.replace(/^\*\./, '');
}

function isAllowedHost(hostname: string, allowedDomains: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allowedDomains.some((raw) => {
    const entry = normalizeDomain(raw);
    if (!entry) return false;
    // 显式 `*.example.com` 才放行子域；普通 `example.com` 只允许该域名本身。
    const wildcard = raw.trim().toLowerCase().startsWith('*.');
    if (wildcard) return host === entry || host.endsWith(`.${entry}`);
    return host === entry;
  });
}

function isAllowedUrl(url: string, allowedDomains: string[]): boolean {
  try {
    const host = new URL(url).hostname;
    return isAllowedHost(host, allowedDomains);
  } catch {
    return false;
  }
}

// ── 候选探测（#361：一次 64KB Range 同时做字节嗅探 + L2 头取证）──────

/** 候选探测结果（字节嗅探 + 头时长取证）；按稳定 URL 缓存复用。 */
interface CandidateProbe {
  ok: boolean;
  /** 完整大小（content-range / content-length 总量）；L3 体积。 */
  totalBytes: number | null;
  /** L2 头取证（解析失败为 null）。 */
  header: AudioDurationEvidence | null;
}


/** 探测结果缓存（#361 实现决策「探测结果按稳定 URL 缓存」）：复用 audioProbe
 *  的键归一化思路（去时间戳/token 参数，同一条链每次签名不同也命中同一键），
 *  避免同一 URL 反复付 64KB Range + 头解析成本。只缓存**成功**探测：失败多为
 *  瞬时网络/风控，缓存会把一次抖动放大成 30min 的死源。 */
const PROBE_CACHE_TTL_MS = 30 * 60 * 1000;
const PROBE_CACHE_MAX = 500;
const probeCache = new Map<string, { probe: CandidateProbe; expires: number }>();

/** 稳定缓存键：去掉每次解析都会变的时间戳/令牌参数。 */
function stableUrlKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete('t');
    u.searchParams.delete('timestamp');
    u.searchParams.delete('play_auth');
    return u.href;
  } catch {
    return rawUrl;
  }
}

/** 测试/重置用：清空探测缓存。 */
export function clearTier3ProbeCache(): void {
  probeCache.clear();
}

/** 取头部字节：判定是否真音频（拒 text/html 错误页），并读完整大小。
 *  超时独立（ADR-0014 决策 3），**不继承** source.timeoutMs——
 *  「解析允许多慢」与「首字节该多快」是两件事。 */
/** 候选探测（带稳定 URL 缓存）：取头部字节 + 解析头时长，成功结果入缓存。 */
async function probeCandidate(url: string, source: Tier3Source, deps: Tier3Deps): Promise<CandidateProbe> {
  const key = stableUrlKey(url);
  const cached = probeCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.probe;
  const head = await fetchAudioHead(url, {
    headers: { 'User-Agent': BROWSER_UA, ...(source.headers || {}) },
    timeoutMs: SNIFF_TIMEOUT_MS,
    request: deps.request,
  });
  const probe: CandidateProbe = head.ok
    ? { ok: true, totalBytes: head.totalBytes, header: await extractAudioDuration(head.bytes, head.totalBytes) }
    : { ok: false, totalBytes: null, header: null };
  if (probe.ok) {
    if (probeCache.size >= PROBE_CACHE_MAX) probeCache.clear();
    probeCache.set(key, { probe, expires: Date.now() + PROBE_CACHE_TTL_MS });
  }
  return probe;
}

/** 试听片段闸：完整大小 <1MB 视为片段（拿不到大小时不臆断，与旧行为一致）。 */
function isTrialSized(totalBytes: number | null, source: Tier3Source, url: string): boolean {
  if (totalBytes !== null && totalBytes < TRIAL_BYTES_THRESHOLD) {
    console.info(`[tier3] source=${source.id} 候选疑似试听片段（${totalBytes}B < 1MB），跳过: ${url}`);
    return true;
  }
  return false;
}

// ── 候选证据（#361）──────────────────────────────────────────────────

/** 单源候选：URL + 探测结果 + 候选自带护栏证据（L2 由探测的头取证补上）。 */
interface Tier3Candidate {
  url: string;
  probe: CandidateProbe;
  /** L1（源自带时长）/ L3（码率、体积）/ L4（文本）证据。 */
  evidence: PlaybackEvidence;
}

/** 常见元数据字段名（源能力异构：kugou 搜索自带 Duration、hk0cc 解析响应回
 *  song_play_time、gdstudio 只回 url/br/size）。ADR 决策 4 **不把 durationPath
 *  设成契约必需**，这里按常见名自动探测：探到多一级证据，探不到就降级。 */
// 只收语义明确的字段名：`time`/`length`/`rate` 这类在解析响应里可能是时间戳、
// 数组长度或采样率，误当证据会**误拒**一首正常的歌（比「少一级证据」糟得多）。
const SOURCE_DURATION_PATHS = ['duration', 'Duration', 'song_play_time', 'play_time', 'playTime', 'interval'];
const SOURCE_BITRATE_PATHS = ['br', 'bitrate', 'bitRate', 'bit_rate'];
const SOURCE_NAME_PATHS = ['name', 'song', 'songname', 'songName', 'song_name', 'title'];
// `ar_name`（kangqiovo/网易系）与 `singer_name`（s01s 系）是实测中「能出链但被判
// 歌手缺失」的两个字段名；不加会把好源整条拒掉（#376 E0）。
const SOURCE_ARTIST_PATHS = ['artist', 'singer', 'author', 'artists', 'singerName', 'ar_name', 'singer_name'];

function pickNumber(root: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const raw = getByPath(root, path);
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function pickText(root: unknown, paths: string[]): string {
  for (const path of paths) {
    const raw = getByPath(root, path);
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return '';
}

/** 时长疑似毫秒的阈值：>10000 按毫秒解读（网易 playTime/interval 是 ms，kugou/hk0cc 是秒）。 */
const DURATION_MS_THRESHOLD = 10_000;

/** 时长归一化到秒（见 DURATION_MS_THRESHOLD；真正的 ms 值 ≤10s 会被读成秒，极罕见）。 */
function durationToSeconds(value: number | null): number | null {
  if (!value || value <= 0) return null;
  return value > DURATION_MS_THRESHOLD ? value / 1000 : value;
}

/** 组装候选：探测结果 + 自动探测到的源自带证据（L1/L3/L4）。 */
function buildCandidate(
  url: string,
  probe: CandidateProbe,
  meta: unknown,
  name: string,
  artist: string,
): Tier3Candidate {
  return {
    url,
    probe,
    evidence: {
      sourceDuration: durationToSeconds(pickNumber(meta, SOURCE_DURATION_PATHS)),
      bitrateKbps: pickNumber(meta, SOURCE_BITRATE_PATHS),
      totalBytes: probe.totalBytes,
      name,
      artist,
    },
  };
}

// ── 单源执行 ─────────────────────────────────────────────────────────

async function resolveFromRequestSpec(
  spec: Tier3RequestSpec,
  vars: TemplateVars,
  source: Tier3Source,
  deps: Tier3Deps,
  timeoutMs: number,
): Promise<Tier3Candidate | null> {
  const req = deps.request || request;
  const requestSpec = buildRequest(spec, vars, source, 'text', timeoutMs);
  const res = await req(requestSpec);
  if (res.status >= 400) return null;
  if (spec.responseKind === 'redirect') {
    // 302 直跳型：响应体是音频字节，没有 JSON 可解析，候选 = 重定向终点。
    // 白名单 / 字节嗅探 / 护栏对最终 URL 照常执行；文本证据为空（只剩音频头
    // 时长），与「解析响应不带 name/artist」的 url-resolver 同档。
    const finalUrl = res.finalUrl && res.finalUrl !== requestSpec.url ? res.finalUrl : '';
    if (!finalUrl || !isAllowedUrl(finalUrl, source.allowedDomains)) return null;
    const probe = await probeCandidate(finalUrl, source, deps);
    if (!probe.ok || isTrialSized(probe.totalBytes, source, finalUrl)) return null;
    return buildCandidate(finalUrl, probe, null, '', '');
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyToText(res.body));
  } catch {
    return null;
  }
  const jsonPath = spec.responseJsonPath || '';
  const url = toUrlCandidate(getByPath(body, jsonPath));
  // 先取值、后判封套：取到合法候选 URL 时不让封套否决。
  // 部分上游用 `{code:200,message:"成功",url:"…"}` 表达成功（HTTP 风格 code），
  // 先判封套会把带合法直链的响应整条拒掉——此时「响应里有没有直链」才该说了算。
  // 只有**取不到可用 URL** 时才把业务错误封套当失败原因上报（如 vkeys 的
  // `{code:110000,message:"…"}`），用于区分「上游挂了」与「无此歌」，
  // 避免日志里只有空洞的“未命中”。
  if (!url || !isAllowedUrl(url, source.allowedDomains)) {
    warnOnBusinessError(body, source);
    return null;
  }
  const probe = await probeCandidate(url, source, deps);
  if (!probe.ok || isTrialSized(probe.totalBytes, source, url)) return null;
  // 元数据自动探测的根：URL 字段所在的对象（如 `data.url` → `data`），
  // 源普遍把 duration/br/name 与 url 平铺在同一层；取不到则退回整个响应体。
  const meta = metadataRoot(body, jsonPath);
  return buildCandidate(url, probe, meta, pickText(meta, SOURCE_NAME_PATHS), pickText(meta, SOURCE_ARTIST_PATHS));
}

/** HTTP 200 但业务错误封套（顶层 `code` 为非 0 数字 + 非空 `message` 字符串）→ 记 warn。
 *  仅在**取不到可用候选 URL** 时调用：响应里已经有合法直链的源不该被封套判据否决。 */
function warnOnBusinessError(body: unknown, source: Tier3Source): void {
  const code = getByPath(body, 'code');
  const message = getByPath(body, 'message');
  if (typeof code === 'number' && code !== 0 && typeof message === 'string' && message) {
    console.warn(`[tier3] source=${source.id} 上游返回错误: code=${code} message=${message}`);
  }
}

/** URL 取值路径的父容器（`data.url` → `data`；单段路径 → 整个响应体）。 */
function metadataRoot(body: unknown, responseJsonPath: string): unknown {
  const dot = responseJsonPath.lastIndexOf('.');
  if (dot <= 0) return body;
  const parent = getByPath(body, responseJsonPath.slice(0, dot));
  return parent == null ? body : parent;
}

async function resolveSourceUrl(
  song: Song,
  source: Tier3Source,
  timeoutMs: number,
  idOverride?: string,
  itemMeta?: { name?: string; artist?: string },
): Promise<Tier3Candidate | null> {
  const deps = currentDeps;
  const base = songVars(song);
  const name = itemMeta?.name || base.name;
  const artist = itemMeta?.artist || base.artist;
  const vars: TemplateVars = {
    ...base,
    id: normalizeSourceId(idOverride || base.id, source),
    name,
    artist,
    keyword: `${name} ${artist}`.trim(),
  };
  const candidate = await resolveFromRequestSpec(source.resolve, vars, source, deps, timeoutMs);
  if (!candidate) return null;
  // 搜索条目自带的歌名/歌手比解析响应更可靠（解析响应常只有 URL）→ 覆盖文本证据。
  return {
    ...candidate,
    evidence: {
      ...candidate.evidence,
      name: itemMeta?.name || candidate.evidence.name,
      artist: itemMeta?.artist || candidate.evidence.artist,
    },
  };
}

async function resolveSearchThenResolve(
  song: Song,
  source: Tier3Source,
  timeoutMs: number,
): Promise<Tier3Candidate | null> {
  const deps = currentDeps;
  if (!source.search) return null;
  const vars = songVars(song);
  const req = deps.request || request;
  const res = await req(buildRequest(source.search, vars, source, 'text', timeoutMs));
  if (res.status >= 400) return null;
  const items = getByPath(JSON.parse(bodyToText(res.body)), source.search.itemsPath);
  if (!Array.isArray(items)) return null;

  for (const item of items) {
    if (!isRecord(item)) continue;
    const itemName = asString(getByPath(item, source.search.namePath));
    const itemArtist = source.search.artistPath ? asString(getByPath(item, source.search.artistPath)) : '';
    // 严格匹配优先（拒绝翻唱/Live/remix/同名不同歌手）。降级仅当**目标歌手也为空**
    // （如 tier3 搜索兜底候选本身无歌手信息）时允许歌名精确匹配；目标歌手非空时，
    // 无歌手字段的候选一律拒绝——上游目录同名歌多（李荣浩/李寒/孟庭苇都有《恋人》），
    // 同名不同歌手的错播比「不播」更糟。
    const target = { name: song.name || '', artist: song.artist || '' };
    const candidate = { name: itemName, artist: itemArtist };
    const nameExact = !!target.name && normalize(target.name) === normalize(itemName);
    const matched =
      isExactMatch(target, candidate) ||
      (!normalize(itemArtist) && !normalize(target.artist) && nameExact);
    if (!matched) continue;

    if (source.search.urlPath) {
      const directUrl = toUrlCandidate(getByPath(item, source.search.urlPath));
      if (directUrl && isAllowedUrl(directUrl, source.allowedDomains)) {
        const probe = await probeCandidate(directUrl, source, deps);
        if (probe.ok && !isTrialSized(probe.totalBytes, source, directUrl)) {
          return buildCandidate(directUrl, probe, item, itemName, itemArtist);
        }
      }
    }

    if (source.resolve && source.search.idPath) {
      const itemId = asString(getByPath(item, source.search.idPath));
      if (itemId) {
        const resolved = await resolveSourceUrl(song, source, timeoutMs, itemId, { name: itemName, artist: itemArtist });
        if (resolved) return resolved;
      }
    }
  }
  return null;
}

// ── 第三方搜索兜底（官方直连搜索失败时返回候选歌曲）──────────────────

interface Tier3SearchItem {
  id: string;
  name: string;
  artist: string;
  url: string;
  album: string;
  cover: string;
}

async function searchTier3SourceItems(
  source: Tier3Source,
  keyword: string,
  timeoutMs: number,
): Promise<Tier3SearchItem[]> {
  if (source.kind !== 'search-then-resolve' || !source.search) return [];
  const deps = currentDeps;
  const vars: TemplateVars = {
    id: '',
    source: '',
    name: keyword,
    artist: '',
    keyword,
  };
  const req = deps.request || request;
  const res = await req(buildRequest(source.search, vars, source, 'text', timeoutMs));
  if (res.status >= 400) return [];
  const items = getByPath(JSON.parse(bodyToText(res.body)), source.search.itemsPath);
  if (!Array.isArray(items)) return [];
  const out: Tier3SearchItem[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const name = asString(getByPath(item, source.search.namePath));
    if (!name) continue;
    const album =
      (source.search.albumPath ? asString(getByPath(item, source.search.albumPath)) : '') ||
      asString(getByPath(item, 'album') || getByPath(item, 'albumName') || getByPath(item, 'albumTitle'));
    const coverRaw =
      (source.search.coverPath ? asString(getByPath(item, source.search.coverPath)) : '') ||
      asString(getByPath(item, 'pic') || getByPath(item, 'cover') || getByPath(item, 'img') || getByPath(item, 'albumPic') || getByPath(item, 'image'));
    const cover = /^https?:\/\//i.test(coverRaw) ? coverRaw.replace(/^http:/, 'https:') : '';
    out.push({
      id: source.search.idPath ? asString(getByPath(item, source.search.idPath)) : '',
      name,
      artist: source.search.artistPath ? asString(getByPath(item, source.search.artistPath)) : '',
      url: source.search.urlPath ? (toUrlCandidate(getByPath(item, source.search.urlPath)) || '') : '',
      album,
      cover,
    });
  }
  return out;
}

/**
 * 第三方订阅搜索兜底：直连搜索失败时，用订阅清单里的 search-then-resolve 源
 * 按关键词返回候选歌曲。歌曲 url 可能为空，播放时仍可走 tier3 解析链。
 *
 * 注意：搜索兜底是「关键词候选」，不存在把 A 源 id 塞给 B 源解析器的错配风险
 * （source 防护只作用于播放解析 resolveTier3），因此**不按 source 过滤搜索源**；
 * 候选的 sourceType 标记为其真实来源（tier3SourceSource 推断，如 mitu→kuwo），
 * 让点击播放时解析链的 source 防护与候选一致，而不是伪装成查询源。
 */
export async function searchTier3Songs(keyword: string, _page: number, sourceKey: SourceKey): Promise<Song[]> {
  if (!state.enabled || state.subscriptions.length === 0) return [];
  console.info(`[tier3] 第三方搜索开始: ${keyword} (${sourceKey})`);
  const out: Song[] = [];
  const seen = new Set<string>();
  const deadline = Date.now() + TIER3_SEARCH_BUDGET_MS;
  // 单条预算 Promise 供所有源共用（而非每源起一个 setTimeout——那样未命中的
  // 定时器会各自挂到 deadline，徒增事件循环负担，且测试里会拖住退出）。
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const budgetHit = new Promise<Tier3SearchItem[]>((resolve) => {
    budgetTimer = setTimeout(() => resolve([]), TIER3_SEARCH_BUDGET_MS);
  });
  for (const subscription of state.subscriptions) {
    for (const source of subscription.manifest.sources) {
      if (source.kind !== 'search-then-resolve' || !source.search) continue;
      // 预算耗尽：返回已收集的部分候选（搜索语义是「尽量找全」，
      // 已找到的对用户仍有用），并说明提前收尾。
      if (Date.now() >= deadline) {
        console.info(`[tier3] 搜索预算 ${TIER3_SEARCH_BUDGET_MS}ms 用尽，返回已收集的 ${out.length} 条候选`);
        clearTimeout(budgetTimer);
        return out;
      }
      // 搜索腿**不按 source 过滤**（ADR-0014 决策 6 只要求 url-resolver 的归属约束）：
      // 搜索是「关键词候选」，不存在把 A 源 id 塞给 B 源解析器的错配风险，
      // 且候选自带歌名/歌手匹配过滤。多留一个源 = 多一份兜底（用户抱怨「源不够用」）。
      // 归属只用于给候选打正确的 sourceType（经别名归一化，见 :候选构造）。
      console.info(`[tier3] 源 ${source.id} 搜索请求: ${keyword}`);
      statsFor(source.id).searches++;
      // 搜索腿同款单源硬墙（ADR-0014 决策 2「搜索腿补同款预算」）：
      // 一个挂起的源不再能吃掉整条搜索腿的 6s（各源自己的重试也算在内）。
      const searchTimeoutMs = effectiveSourceTimeout(source, deadline - Date.now());
      try {
        const items = await Promise.race([searchTier3SourceItems(source, keyword, searchTimeoutMs), budgetHit]);
        // 只保留歌名与查询词强相关的候选：归一化后歌名必须等于查询词、或为查询词
        // 的一部分（查询词更具体，如「恋人 李荣浩」可匹配「恋人」）；反向
        // （「恋人」匹配「恋人未满」）会端上完全不同的歌，一律丢弃。
        // 多词查询的每个词都要出现在歌名或歌手里（「恋人 李荣浩」要求歌手含李荣浩）。
        const tokens = keyword
          .trim()
          .split(/[\s,，、;；&|/]+/)
          .map((t) => normalize(t))
          .filter(Boolean);
        const qName = tokens.join('');
        for (const item of items) {
          const itemName = normalize(item.name);
          if (!itemName || (itemName !== qName && !qName.includes(itemName))) continue;
          const itemArtist = normalize(item.artist);
          if (tokens.some((t) => !itemName.includes(t) && !itemArtist.includes(t))) continue;
          // 多个订阅/源可能指向同一上游，按“歌名+歌手”去重，避免结果重复。
          const dedupeKey = `${item.name.trim().toLowerCase()}|${item.artist.trim().toLowerCase()}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          out.push({
            id: item.id ? `tier3:${source.id}:${item.id}` : `tier3:${source.id}:${out.length}`,
            name: item.name,
            artist: item.artist,
            album: item.album,
            url: item.url,
            cover: item.cover,
            lrc: '',
            duration: 0,
            sourceType: tier3SourceSource(source) || sourceKey,
          });
        }
        console.info(`[tier3] 源 ${source.id} 返回 ${items.length} 条候选`);
      } catch (e) {
        console.warn(`[tier3] 源 ${source.id} 搜索失败: ${(e as Error)?.message || e}`);
      }
    }
  }
  clearTimeout(budgetTimer);
  return out;
}

// ── 订阅源拉取 ───────────────────────────────────────────────────────

export async function fetchTier3ManifestFromUrl(url: string): Promise<Tier3Manifest> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('订阅 URL 不合法');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('订阅 URL 必须是 http(s)');
  }
  const req = currentDeps.request || request;
  const res = await req({
    method: 'GET',
    url,
    headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    responseType: 'text',
  });
  if (res.status >= 400) {
    throw new Error(`订阅清单拉取失败：HTTP ${res.status}`);
  }
  return parseTier3Manifest(bodyToText(res.body));
}

// ── 订阅管理 ─────────────────────────────────────────────────────────

function subscriptionId(source: string): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${source.length}`;
}

function manifestDisplayName(manifest: Tier3Manifest): string {
  const first = manifest.sources[0];
  return first?.name || first?.id || '第三方音源';
}

export async function addTier3SubscriptionFromUrl(
  input: { name?: string; url: string },
): Promise<Tier3Subscription> {
  const manifest = await fetchTier3ManifestFromUrl(input.url);
  const subscription: Tier3Subscription = {
    id: subscriptionId(input.url),
    name: input.name?.trim() || manifestDisplayName(manifest),
    kind: 'url',
    source: input.url,
    manifest,
    updatedAt: Date.now(),
  };
  setTier3Subscriptions([...state.subscriptions, subscription]);
  return subscription;
}

export function addTier3SubscriptionFromText(
  input: { name?: string; text: string; kind?: Tier3SubscriptionKind; source?: string },
): Tier3Subscription {
  const manifest = parseTier3Manifest(input.text);
  const sourceLabel = input.source?.trim() || input.name?.trim() || '手动粘贴清单';
  const subscription: Tier3Subscription = {
    id: subscriptionId(sourceLabel),
    name: input.name?.trim() || manifestDisplayName(manifest),
    kind: input.kind || 'text',
    source: sourceLabel,
    manifest,
    updatedAt: Date.now(),
  };
  setTier3Subscriptions([...state.subscriptions, subscription]);
  return subscription;
}

export function removeTier3Subscription(id: string): void {
  setTier3Subscriptions(state.subscriptions.filter((s) => s.id !== id));
}

export async function refreshTier3Subscription(id: string): Promise<Tier3Subscription> {
  const existing = state.subscriptions.find((s) => s.id === id);
  if (!existing) throw new Error('订阅不存在');
  if (existing.kind !== 'url') {
    // text/file 订阅的清单已持久化在本地，无需重新拉取；直接返回当前值。
    return existing;
  }
  const manifest = await fetchTier3ManifestFromUrl(existing.source);
  const next: Tier3Subscription = { ...existing, manifest, updatedAt: Date.now() };
  setTier3Subscriptions(state.subscriptions.map((s) => (s.id === id ? next : s)));
  return next;
}

// ── 顶层解析入口 ─────────────────────────────────────────────────────

let currentDeps: Tier3Deps = {};

/** 注入默认执行依赖（主要供测试替换 transport；生产可不调用，走 core 默认 request）。 */
export function setTier3Deps(deps: Tier3Deps): void {
  currentDeps = deps;
}

/** source 字段常见写法 → MPlayer 规范源键（ADR-0014 决策 6）。
 *  生态里没有统一词汇表：同一平台在不同 API 里叫法不同（GD Studio 用 tencent、
 *  lx 用 tx、MPlayer 用 qq）。不归一化则这些值会通过校验但永不匹配，
 *  静默变成死源；更糟的是搜索候选的 sourceType 被污染成该值，播放时
 *  decideRoute 找不到客户端 → 用户看到「可能为 VIP/无版权」的错误提示。 */
const SOURCE_ALIASES: Record<string, SourceKey> = {
  tencent: 'qq',
  tx: 'qq',
  qqmusic: 'qq',
  '163': 'netease',
  neteasecloud: 'netease',
  'netease-cloud-music': 'netease',
  '126': 'netease',
  netease: 'netease',
  qq: 'qq',
  kugou: 'kugou',
  kg: 'kugou',
  kuwo: 'kuwo',
  kw: 'kuwo',
  migu: 'migu',
  mg: 'migu',
  qianqian: 'qianqian',
  '91q': 'qianqian',
  baidu: 'qianqian',
  soda: 'soda',
  qishui: 'soda',
  douyin: 'soda',
};

/** MPlayer 规范音乐源键（不含 local——本地文件不是第三方源可解析的对象）。 */
const TIER3_MUSIC_SOURCES: ReadonlySet<string> = new Set([
  'netease',
  'qq',
  'kugou',
  'kuwo',
  'migu',
  'qianqian',
  'soda',
]);

/** 合法 source 值清单（报错/文档用）。 */
const TIER3_SOURCE_VALUES = [...TIER3_MUSIC_SOURCES].join('/');

/** 规范化 source 值：去空白/小写后查别名表，再校验是否落在规范集内。
 *  **不认识的值返回 undefined（等同未声明）**——只归一化不校验时，`tidal`/拼写错误这类
 *  值会通过清单校验但永不匹配：解析腿静默变死源，搜索腿还会把候选的 `sourceType`
 *  污染成该值 → 播放时 `decideRoute` 找不到客户端 → 用户看到「可能为 VIP/无版权」的
 *  错误提示（t6 §4.2②）。合法值见 TIER3_SOURCE_VALUES（含 `tencent`/`tx` 等别名）。 */
export function normalizeTier3Source(value: string): SourceKey | undefined {
  const key = value.trim().toLowerCase();
  const canonical = SOURCE_ALIASES[key] ?? key;
  return TIER3_MUSIC_SOURCES.has(canonical) ? (canonical as SourceKey) : undefined;
}

/**
 * 该源是否可用于解析「来源为 songSource 的歌」（ADR-0014 决策 6）。
 *
 * - 显式声明且与歌曲来源一致 → 可用；
 * - 显式声明但不一致 → 不可用（原样，防跨源错配）；
 * - **未声明**：search-then-resolve 可用（它自带 isExactMatch 歌名/歌手校验，
 *   即便源不对也由内容匹配兜住）；**url-resolver 不可用**——该腿没有任何内容级
 *   校验，放行一个不声明归属的 id 型解析器，就等于把 A 源的 id 塞给 B 源的接口，
 *   可能返回完全不同的歌（这正是 source 字段原本要防的事）。
 */
function isSourceUsableFor(source: Tier3Source, songSource: SourceKey): boolean {
  return classifySourceOwnership(source, songSource) === 'usable';
}

/** 单源归属分类（ADR-0014 决策 6 的单一事实源；供过滤与失败归因共用，避免两处规则漂移）。
 *  - `usable`：显式声明与歌曲来源一致；或**未声明/值不认识**的 search-then-resolve
 *    （它自带歌名/歌手校验，即便源不对也由内容匹配兜住）；
 *  - `mismatch`：显式声明了另一个音乐源；
 *  - `undeclared`：未声明 source 的 url-resolver（拒绝，防跨源错配）；
 *  - `unknown`：source 值不在规范集/别名表里的 url-resolver（等同未声明，拒绝）。 */
type SourceOwnership = 'usable' | 'mismatch' | 'undeclared' | 'unknown';

function classifySourceOwnership(source: Tier3Source, songSource: SourceKey): SourceOwnership {
  if (!source.source) return source.kind === 'url-resolver' ? 'undeclared' : 'usable';
  const declared = tier3SourceSource(source);
  if (!declared) return source.kind === 'url-resolver' ? 'unknown' : 'usable';
  return declared === songSource ? 'usable' : 'mismatch';
}

/** 源适用的原始音源：**只认显式声明的 source**（ADR-0014 决策 6，含别名归一化）。
 *
 *  原实现会在 source 缺省时按 URL host/路径推断（越权猜测），猜不出则返回
 *  undefined 让该源参与**任意源**的歌解析——而 url-resolver 这条腿没有任何
 *  内容级校验（search-then-resolve 有 isExactMatch，url-resolver 只有域名白名单
 *  + 字节嗅探），于是「猜不出」等于打开跨源错播通道：A 源的 id 被塞给 B 源的
 *  解析接口，可能返回完全不同的歌。本函数原先的注释正是声称要防这件事。
 *
 *  现在：未声明即 undefined，由调用方决定是否拒绝（见 isSourceUsableFor）。 */
export function tier3SourceSource(source: Tier3Source): SourceKey | undefined {
  if (!source.source) return undefined;
  return normalizeTier3Source(source.source);
}

// ── 播放失败归因（#357）──────────────────────────────────────────────

/**
 * 播放失败归因（#357）：把「直连没拿到 URL + tier3 兜底情况」压成可操作的一类。
 *
 * 现状是一句「无法获取音频 URL：可能为 VIP/无版权或直连暂不可用」，把四种完全
 * 不同的原因混在一起，还把用户引向「VIP/无版权」的错误方向（t6 §4.2② 实测：
 * 清单写了不认识的 source 值 → 搜索候选 sourceType 被污染 → decideRoute 抛
 * 「该源暂无直连实现」→ 用户最终看到的就是这句 VIP 提示）。
 */
export type PlaybackFailureKind =
  /** 该源被设为「仅直连」，tier3 兜底被主动关掉（可操作：改回「自动」）。 */
  | 'direct-only'
  /** tier3 未开启（可操作：设置里开启）。 */
  | 'tier3-disabled'
  /** 已开启但没有订阅清单（可操作：添加订阅）。 */
  | 'no-subscription'
  /** 有订阅，但没有源声明服务于该歌来源（可操作：补 source 匹配条目 / 通用 search-then-resolve 源）。 */
  | 'no-declared-source'
  /** 有源但全部因 source 归属被跳过（未声明 source 的 url-resolver / 值不认识）。 */
  | 'all-skipped'
  /** 适用该来源的源都试过，未命中或超时（可操作：稍后重试 / 更换订阅）。 */
  | 'sources-missed';

/** 播放失败诊断结果（#357）：归因 + 计数 + 双端共享的可操作文案。 */
export interface PlaybackFailureAdvice {
  kind: PlaybackFailureKind;
  /** 订阅清单声明的源总数。 */
  declared: number;
  /** 适用于本歌来源的源数（显式 source 匹配，或未声明的 search-then-resolve）。 */
  usable: number;
  /** 因 source 归属被跳过的源数。 */
  skipped: number;
  /** 用户可读、可操作的失败说明（双端共用同一份，避免文案漂移）。 */
  message: string;
}

/**
 * 播放失败归因（#357）：调用方在「直连 + tier3 都没拿到 URL」后调用，得到归因与
 * 可操作文案。按**当前配置**推导（订阅清单 + 来源开关 + tier3 开关），不依赖
 * 会话累计统计——那些是全局计数，不是「本次为什么失败」（ADR-0014 决策 5）。
 *
 * 纯读，无副作用；跨端（桌面经 IPC / 移动端直调）共用同一份文案。
 */
export function explainPlaybackFailure(song: Song): PlaybackFailureAdvice {
  const key = song.sourceType as string;
  const label = SOURCE_DISPLAY_NAMES[key] || key;
  const sources = state.subscriptions.flatMap((sub) => sub.manifest.sources);
  const declared = sources.length;

  // 顺序有讲究：tier3 全局未开启时，「改为自动」并不能启用兜底——先报可真正解除
  // 的开关（tier3 未开启），再报来源开关（仅直连），否则文案会把用户引向无效操作。
  if (!state.enabled) {
    return {
      kind: 'tier3-disabled', declared, usable: 0, skipped: 0,
      message: '直连没取到可播链接，第三方解析源（tier3）也未开启。可在设置中开启后重试',
    };
  }
  if (getSourceMode(song.sourceType) === 'direct') {
    return {
      kind: 'direct-only', declared, usable: 0, skipped: 0,
      message: `该源已设为「仅直连」，直连没取到可播链接。可在设置里把「${label}」的来源开关改为「自动」，启用第三方解析源兜底`,
    };
  }
  if (declared === 0) {
    return {
      kind: 'no-subscription', declared, usable: 0, skipped: 0,
      message: '已开启第三方解析源，但还没有订阅清单。添加一份 JSON 音源清单后即可自动兜底',
    };
  }

  // 归属分类与解析腿共用同一个 classifier（避免两处规则漂移）。
  const ownership = sources.map((s) => classifySourceOwnership(s, song.sourceType));
  const countOf = (kind: SourceOwnership): number => ownership.filter((o) => o === kind).length;
  const usable = countOf('usable');
  const skipped = declared - usable;
  if (usable > 0) {
    return {
      kind: 'sources-missed', declared, usable, skipped,
      message: `适用「${label}」的 ${usable} 个订阅源都试过了，未命中或超时。源可能临时失效/限流，可稍后重试或更换订阅`,
    };
  }

  // usable === 0：区分「没有源声明服务于该来源」与「有源但被归属过滤」。
  const mismatch = countOf('mismatch');
  if (mismatch > 0) {
    return {
      kind: 'no-declared-source', declared, usable, skipped,
      message: `没有订阅源声明服务于「${label}」（有 ${mismatch} 个源声明的是其他平台）。可补一条 source: ${key} 的 url-resolver 条目，或一条通用的 search-then-resolve 源`,
    };
  }
  const undeclared = countOf('undeclared');
  const unknown = countOf('unknown');
  const detail = [
    undeclared > 0 ? `${undeclared} 个 url-resolver 未声明 source 被拒` : '',
    unknown > 0 ? `${unknown} 个 source 值不是已知音乐源` : '',
  ].filter(Boolean).join('、');
  return {
    kind: 'all-skipped', declared, usable, skipped,
    message: `订阅里的源都不能兜底「${label}」：${detail}。可补一条声明 source: ${key} 的条目，或一条 search-then-resolve 源`,
  };
}

// ── 护栏应用（#361）──────────────────────────────────────────────────

/** 单源候选取证 + 护栏决策：不过护栏返回 null，由调用方换下一个源。
 *  取证顺序 = 护栏降级链 L1→L5（见 shared/playbackGuard.ts）：
 *  L1 源自带时长（解析响应/搜索条目自动探测）→ L2 音频头解析（已取的头部字节）
 *  → L3 体积 × 8 ÷ 码率（优先源自称 br，缺失才用帧实测）→ L4 歌名 + 歌手精确匹配
 *  → L5 仅 source 声明。 */
type Tier3CandidateOutcome =
  | { kind: 'hit'; resolution: Tier3Resolution }
  | { kind: 'rejected'; guard: PlaybackGuard }
  | null;

async function resolveTier3Candidate(
  song: Song,
  source: Tier3Source,
  timeoutMs: number,
): Promise<Tier3CandidateOutcome> {
  const candidate =
    source.kind === 'url-resolver'
      ? await resolveSourceUrl(song, source, timeoutMs)
      : await resolveSearchThenResolve(song, source, timeoutMs);
  if (!candidate) return null;

  // 候选自带证据（L1/L3/L4）+ 探测得到的 L2 头证据；码率优先源自称，缺失才用帧实测。
  const sourceBitrate = candidate.evidence.bitrateKbps ?? null;
  const decision = evaluatePlaybackGuard(song, {
    ...candidate.evidence,
    headerDuration: candidate.probe.header?.duration ?? null,
    headerTrusted: candidate.probe.header?.trusted ?? false,
    bitrateKbps: sourceBitrate ?? candidate.probe.header?.bitrateKbps ?? null,
    bitrateDeclared: sourceBitrate != null,
  });

  const stats = statsFor(source.id);
  // L3 两条码率分支分开计数（ADR：帧实测码率在 ±2s 下会误判，必须可归因）。
  // 在判定**之前**计数：误判表现为「measured 分支 + guardRejected」，只记命中会漏掉它。
  if (decision.bitrateBranch === 'declared') stats.sizeBitrateDeclared = (stats.sizeBitrateDeclared ?? 0) + 1;
  if (decision.bitrateBranch === 'measured') stats.sizeBitrateMeasured = (stats.sizeBitrateMeasured ?? 0) + 1;
  if (!decision.accepted) {
    stats.guardRejected = (stats.guardRejected ?? 0) + 1;
    console.info(`[tier3] 源 ${source.id} 候选未过护栏（guard=${decision.guard}）: ${decision.reason} — 换下一个源`);
    return { kind: 'rejected', guard: decision.guard };
  }
  stats.guards = { ...(stats.guards ?? {}), [decision.guard]: (stats.guards?.[decision.guard] ?? 0) + 1 };
  console.info(`[tier3] 源 ${source.id} 候选通过护栏（guard=${decision.guard}）: ${decision.reason}`);
  return { kind: 'hit', resolution: { url: candidate.url, guard: decision.guard } };
}

// ── 会话内源调度（#398 / ADR 2026-09-25-tier3-source-scheduling 决策 1–6）──

/** 单源一次尝试的结果（交付回调由调用方在采纳时补上）。 */
type SourceAttempt =
  | { kind: 'hit'; source: Tier3Source; ms: number; resolution: Tier3Resolution }
  | { kind: 'rejected'; source: Tier3Source; ms: number; guard: PlaybackGuard }
  | { kind: 'timeout'; source: Tier3Source; ms: number; timeoutMs: number }
  | { kind: 'error'; source: Tier3Source; ms: number; errorClass: PlaybackTraceErrorClass }
  | { kind: 'miss'; source: Tier3Source; ms: number };

/** 一轮源遍历的收尾形态：命中 / 试完全部可用源仍未命中 / 预算或窗口提前结束。 */
type Tier3LoopResult =
  | { kind: 'hit'; attempt: Extract<SourceAttempt, { kind: 'hit' }> }
  | { kind: 'missed' }
  | { kind: 'exhausted' };

/** 未启动的源（预算用尽 / 窗口收尾）：记「放弃观测」——只写 trace 与 lastKind，**不进健康度**
 *  （决策 6：它反映的是预算不够，与源本身无关）。 */
function markSourcesAbandoned(sources: readonly Tier3Source[], collect?: Tier3LegCollector): void {
  for (const source of sources) {
    noteSample(source.id, { kind: 'abandoned', hit: false, ms: 0 });
    collect?.({ sourceId: source.id, ms: 0, outcome: 'abandoned', sampleKind: 'abandoned' });
  }
}

/** 单源一次尝试：单源墙 → 统计 → 健康度采样 → trace leg。
 *  `isCancelled` 标记「命中即交付时被放弃的在飞尝试」——其观测已在放弃处记为 abandoned，
 *  这里不再重复记账（迟到落定的上游工作仍照旧写统计）。 */
async function runSourceAttempt(
  song: Song,
  source: Tier3Source,
  timeoutMs: number,
  collect: Tier3LegCollector | undefined,
  control: Tier3RunControl | undefined,
  isCancelled?: () => boolean,
): Promise<SourceAttempt> {
  const t0 = traceNow();
  let attempt: SourceAttempt;
  try {
    const outcome = await withSourceDeadline(resolveTier3Candidate(song, source, timeoutMs), timeoutMs);
    const ms = traceNow() - t0;
    if (outcome === SOURCE_TIMED_OUT) {
      console.info(`[tier3] 源 ${source.id} 超时（单源硬墙 ${timeoutMs}ms），换下一个源`);
      statsFor(source.id).lastError = `单源硬墙 ${timeoutMs}ms 超时`;
      attempt = { kind: 'timeout', source, ms, timeoutMs };
    } else if (outcome?.kind === 'rejected') {
      attempt = { kind: 'rejected', source, ms, guard: outcome.guard };
    } else if (outcome) {
      // #362：resolver 只记「产出」；「交付」由路由层在预算内采纳时 commit。
      // 预算超时被丢弃的迟到命中仍会增加 resolved，但 hits 不动 →
      // getTier3Stats 的 discarded = resolved - hits 即为丢弃数。
      statsFor(source.id).resolved++;
      console.info(`[tier3] 产出候选 source=${source.id}（guard=${outcome.resolution.guard}）: ${outcome.resolution.url}`);
      attempt = { kind: 'hit', source, ms, resolution: outcome.resolution };
    } else {
      console.info(`[tier3] source=${source.id} 未命中`);
      attempt = { kind: 'miss', source, ms };
    }
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.warn(`[tier3] source=${source.id} 失败: ${msg}`);
    statsFor(source.id).lastError = msg;
    // 单源失败继续下一条；全失败返回 null 由 sourceRouter 回退。
    attempt = { kind: 'error', source, ms: traceNow() - t0, errorClass: classifyTraceError(e) };
  }
  if (attempt.kind !== 'hit') statsFor(source.id).misses++;
  if (isCancelled?.()) return attempt;

  // 决策 6 三类分流。健康度**独立于 trace sink**（collect 只在 sink 打开时注入），故无条件记账；
  // 护栏拒绝不记分（内容与这首歌不匹配，不是该源的健康信号），source gate 跳过在更外层就已 continue。
  const sampleKind: SourceSampleKind | null = control?.isAbandoned()
    ? 'abandoned'
    : attempt.kind === 'rejected'
      ? null
      : attempt.kind === 'timeout'
        ? 'censored'
        : 'complete';
  if (sampleKind) {
    noteSample(source.id, {
      kind: sampleKind,
      hit: attempt.kind === 'hit',
      ms: attempt.kind === 'timeout' ? timeoutMs : attempt.ms,
    });
  }
  const leg: PlaybackTraceSourceLeg =
    attempt.kind === 'hit'
      ? { sourceId: source.id, ms: attempt.ms, outcome: 'hit', guard: attempt.resolution.guard }
      : attempt.kind === 'rejected'
        ? { sourceId: source.id, ms: attempt.ms, outcome: 'rejected', guard: attempt.guard }
        : attempt.kind === 'timeout'
          ? { sourceId: source.id, ms: attempt.ms, outcome: 'error', errorClass: 'timeout' }
          : attempt.kind === 'error'
            ? { sourceId: source.id, ms: attempt.ms, outcome: 'error', errorClass: attempt.errorClass }
            : { sourceId: source.id, ms: attempt.ms, outcome: 'miss' };
  if (sampleKind) {
    leg.sampleKind = sampleKind;
    if (sampleKind !== 'abandoned') leg.healthScore = scoreOf(source.id) ?? undefined;
  }
  collect?.(leg);
  return attempt;
}

/** 常态遍历（决策 1：**不并行**，源内维持串行，只调整遍历顺序）。 */
async function runSerialSources(
  song: Song,
  ordered: readonly Tier3Source[],
  deadline: number,
  collect?: Tier3LegCollector,
  control?: Tier3RunControl,
): Promise<Tier3LoopResult> {
  for (let i = 0; i < ordered.length; i += 1) {
    const source = ordered[i];
    // 单源硬墙：清单 timeoutMs 只能收紧，且不超过整链剩余预算（ADR-0014 决策 2）。
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      console.info(`[tier3] 整链预算 ${TIER3_BUDGET_MS}ms 用尽，停止尝试后续源: 《${song.name}》`);
      markSourcesAbandoned(ordered.slice(i), collect);
      return { kind: 'exhausted' };
    }
    const attempt = await runSourceAttempt(song, source, effectiveSourceTimeout(source, remaining), collect, control);
    if (attempt.kind === 'hit') return { kind: 'hit', attempt };
  }
  return { kind: 'missed' };
}

/**
 * 初始化窗口（决策 4/5）：**第一首进 tier3 的歌本来那次解析**，零额外探测请求。
 * 交错起手 H=600ms、在飞 ≤2、**不引入任何窗口级墙值**（单源墙沿用决策 7 的按 kind 常态墙，
 * 被墙切掉的样本按决策 6 的截尾档降权）。任一命中即交付，不等在飞的另一条（其观测记「放弃」）。
 *
 * 并发上界（ADR 决策 5 修订）：窗口内的在飞**计入 K=3**，故第二条并行在飞要额外借一个槽位；
 * 借不到就不交错起手，按单条继续——全局上游在飞上限因此恒为 3（不是「2 + K = 5」）。
 */
async function runInitWindow(
  song: Song,
  ordered: readonly Tier3Source[],
  deadline: number,
  collect?: Tier3LegCollector,
  control?: Tier3RunControl,
): Promise<Tier3LoopResult> {
  interface InitEntry {
    source: Tier3Source;
    startedAt: number;
    cancelled: { value: boolean };
  }
  const entries = new Map<number, InitEntry>();
  let cursor = 0;
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let finish!: (result: Tier3LoopResult) => void;
  const done = new Promise<Tier3LoopResult>((resolve) => { finish = resolve; });

  const stopHedge = (): void => {
    if (hedgeTimer) {
      clearTimeout(hedgeTimer);
      hedgeTimer = undefined;
    }
  };

  /** 在飞的都落定、且没有更多源可起时收尾。 */
  const settleIfIdle = (): void => {
    if (finished || entries.size > 0) return;
    finished = true;
    stopHedge();
    if (cursor < ordered.length) {
      // 预算用尽 / 无可用 K 槽位：剩余源记「放弃观测」（不进健康度）。
      markSourcesAbandoned(ordered.slice(cursor), collect);
      finish({ kind: 'exhausted' });
      return;
    }
    finish({ kind: 'missed' });
  };

  const onSettled = (key: number, attempt: SourceAttempt): void => {
    entries.delete(key);
    if (finished) return;
    if (attempt.kind === 'hit') {
      // 任一命中 → 立即交付，不等待在飞的另一条（决策 4）；其观测记「放弃」（决策 6）。
      finished = true;
      stopHedge();
      for (const entry of entries.values()) {
        entry.cancelled.value = true;
        const ms = Date.now() - entry.startedAt;
        noteSample(entry.source.id, { kind: 'abandoned', hit: false, ms });
        collect?.({ sourceId: entry.source.id, ms, outcome: 'abandoned', sampleKind: 'abandoned' });
      }
      finish({ kind: 'hit', attempt });
      return;
    }
    // 未命中即补下一个源（受在飞上限、剩余预算与 K 槽位约束）。
    startNext();
    settleIfIdle();
  };

  const startNext = (): boolean => {
    if (finished || entries.size >= SCHEDULE_INIT_INFLIGHT || cursor >= ordered.length) return false;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    const source = ordered[cursor];
    const needExtraSlot = entries.size > 0;
    if (needExtraSlot && !tryAcquireTier3SourceSlot()) return false;
    const key = cursor;
    cursor += 1;
    const cancelled = { value: false };
    const entry: InitEntry = { source, startedAt: Date.now(), cancelled };
    entries.set(key, entry);
    void (async () => {
      let attempt: SourceAttempt;
      try {
        attempt = await runSourceAttempt(
          song,
          source,
          effectiveSourceTimeout(source, remaining),
          collect,
          control,
          () => cancelled.value,
        );
      } catch (e) {
        // runSourceAttempt 自带兜底；这里是防御性的——窗口发起的是悬空 Promise，
        // 未捕获的 reject 会变成 unhandled rejection 且窗口永不收尾。
        const msg = (e as Error)?.message || String(e);
        console.warn(`[tier3] source=${source.id} 调度异常: ${msg}`);
        attempt = { kind: 'error', source, ms: 0, errorClass: classifyTraceError(e) };
      } finally {
        if (needExtraSlot) releaseTier3SourceSlot();
      }
      onSettled(key, attempt);
    })();
    return true;
  };

  startNext();
  if (entries.size > 0 && cursor < ordered.length) {
    hedgeTimer = setTimeout(() => {
      if (!finished && entries.size === 1) startNext();
    }, SCHEDULE_HEDGE_MS);
  }
  settleIfIdle();
  return done;
}

async function resolveTier3(
  song: Song,
  collect?: Tier3LegCollector,
  control?: Tier3RunControl,
): Promise<Tier3Resolution | null> {
  if (!state.enabled) {
    console.info(`[tier3] 未启用，跳过: 《${song.name}》${song.artist}`);
    return null;
  }
  if (state.subscriptions.length === 0) {
    console.info(`[tier3] 已启用但无订阅，跳过: 《${song.name}》${song.artist}`);
    return null;
  }
  console.info(`[tier3] 开始解析: 《${song.name}》${song.artist} (${song.sourceType}, id=${song.id})`);
  // 链内自持 deadline（ADR-0014 决策 2「整链 6s 软顶」）：不再只靠调用方的
  // Promise.race——否则本腿会继续打上游、白耗配额，日志也看不出「预算已尽」。
  const deadline = Date.now() + TIER3_BUDGET_MS;

  // ① 按清单顺序展平 + 归属分类（ADR-0014 决策 6）：显式声明须一致；未声明的 url-resolver 拒绝。
  //    归属过滤**先于**排序，且逐源照旧触发（计数在跳过之前取）——否则 explainPlaybackFailure 的
  //    all-skipped / no-declared-source 归因会失真。
  const usable: Tier3Source[] = [];
  for (const subscription of state.subscriptions) {
    for (const source of subscription.manifest.sources) {
      if (!isSourceUsableFor(source, song.sourceType)) {
        const declared = tier3SourceSource(source);
        statsFor(source.id).skipped++;
        console.info(
          `[tier3] 源 ${source.id} 跳过（${declared
            ? `source mismatch: ${declared} != ${song.sourceType}`
            : source.source
              ? `source 值 '${source.source}' 不是已知音乐源（合法值：${TIER3_SOURCE_VALUES} 及其别名）`
              : `未声明 source 的 url-resolver，拒绝以防跨源错配`
            }）`,
        );
        collect?.({ sourceId: source.id, ms: 0, outcome: 'skipped' });
        continue;
      }
      usable.push(source);
    }
  }
  if (usable.length === 0) {
    console.warn(`[tier3] 无可用源（全部因 source 归属被跳过）: 《${song.name}》${song.artist}`);
    return null;
  }

  // ② 会话内健康度定序（决策 2/3）：**只改顺序，绝不缩减候选集**——usable 全部保留、仍会被尝试。
  const ordered = orderSources(usable);
  // ③ 单飞初始化窗口（决策 4/5）：整会话只有第一个够格的调用拿到 true（空清单不消耗窗口）。
  const initMode = beginInit();
  const sourceOrder = ordered.map((source) => source.id);
  console.info(`[tier3] 源顺序: ${sourceOrder.join(',')}${initMode ? '（初始化窗口）' : ''}`);
  control?.reportSchedule?.({ sourceOrder, initWindow: initMode });

  const result = initMode
    ? await runInitWindow(song, ordered, deadline, collect, control)
    : await runSerialSources(song, ordered, deadline, collect, control);
  if (result.kind !== 'hit') {
    if (result.kind === 'missed') {
      console.warn(`[tier3] 全部订阅源未命中，回退下一链路: 《${song.name}》${song.artist}`);
    }
    return null;
  }

  const sourceId = result.attempt.source.id;
  let committed = false;
  return {
    ...result.attempt.resolution,
    commit: () => {
      // 同歌去重下多个调用方共享同一条解析：交付只计一次（幂等）。
      if (committed) return;
      committed = true;
      statsFor(sourceId).hits++;
    },
  };
}

/** 供 sourceRouter 注入的 resolver（读取实时订阅状态）。 */
export function createTier3Resolver(): Tier3Resolver {
  return resolveTier3;
}
