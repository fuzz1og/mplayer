import type { Album, Artist, DiscoverPlaylist, Song, SourceKey } from '../types/index.js';
import { isTrialUrlInfo } from './playability.js';
import type { UrlInfo } from './playability.js';
import { getPrefetchedUrl } from '../api/prefetchCache.js';
import type { PlaybackGuard, PlaybackVia } from './playbackGuard.js';
import { validateDirectUrlNonFull, type DirectValidationResult } from './directValidation.js';
import {
  emitPlaybackTrace,
  isPlaybackTraceEnabled,
  traceNow,
  type PlaybackTrace,
  type PlaybackTraceSourceLeg,
} from './playbackTrace.js';

/**
 * 来源开关 + 直连客户端注册表 + 路由（T01 切片 2，spec #146 决策 1/2/3）。
 *
 * 单一回退链（请求层）：官方直连 → tier3 订阅源兜底 → 上抛
 * （换元在调用方/store 层，本模块不实现；直连返回空串 = 无版权/VIP，原样上抛）。
 * 自建 API 已退役：路由不再有 api 腿，直连失败且 tier3 未命中 = 上抛（D2 语义）。
 *
 * - 每源来源开关 `auto | direct`（#277 收窄，legacy `'api'` 已出类型），默认 auto；
 *   存量持久化 'api' 值由 sanitizeSourceModes 洗白为 auto（双端加载处调用）；
 * - 直连客户端由 T02+ 各源 ticket 注册（纯 JS，双端共用）；
 * - 路由函数（searchSongsRouted / resolvePlayableUrlRouted）供 SearchOrchestrator
 *   的 searchOneSource 注入（ADR-0003）与播放 URL 解析使用；
 * - 持久化钩子：宿主（桌面主进程/移动端设置存储）注册 persister，core 内零 I/O。
 */

export type SourceMode = 'auto' | 'direct';

/** 来源中文名（设置页/状态展示共用，桌面/移动端同一份，避免双端漂移）。 */
export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ',
  kugou: '酷狗',
  kuwo: '酷我',
  migu: '咪咕',
  qianqian: '千千',
  soda: '汽水',
};

/** 来源开关选项（桌面/移动端设置 UI 共用；自建 API 已退役，仅剩两态）。 */
export const SOURCE_MODE_OPTIONS: { value: SourceMode; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'direct', label: '仅直连' },
];

/**
 * 榜单分组（#239 内容能力统一榜单结构）。
 * id 全局唯一：`${source}:${sourceId}`（如 `netease:3778678`）；
 * rank 不落结构——消费方按 songs 数组索引推导。
 */
export interface ToplistGroup {
  id: string;
  name: string;
  songs: Song[];
}

// ── 榜单取组 helper（#286：榜单 id 单一来源，双端消费）────────────────

/** 榜单型：热歌榜 / 新歌榜。 */
export type ChartKind = 'hot' | 'new';

/**
 * 各源榜单 sourceId 契约（#279 定值；ToplistGroup.id = `${source}:${sourceId}`）。
 * QQ 26/27 自 v8 topid；酷狗为 rankid 字符串。按源保持字面精度：
 * `TOPLIST_SOURCE_IDS.netease.hot` 类型即 number，kugou 两条为字符串模板的真实 rankid。
 */
export const TOPLIST_SOURCE_IDS = {
  netease: { hot: 3778678, new: 3779629 },
  qq: { hot: 26, new: 27 },
  kugou: { hot: '8888', new: '74534' },
} as const;

/** 已实现 getToplists 能力的源（榜单 id 契约的键域；其余四源无该能力）。 */
export type ToplistSourceKey = keyof typeof TOPLIST_SOURCE_IDS;

/** 从 getToplists 全组结果中按 `${source}:${sourceId}` 取歌组本体（含榜单名等元信息）；无匹配 = undefined。 */
export function pickToplistGroup(
  groups: ToplistGroup[],
  source: SourceKey,
  sourceId: number | string,
): ToplistGroup | undefined {
  return groups.find((g) => g.id === `${source}:${sourceId}`);
}

/** 从 getToplists 全组结果中按 `${source}:${sourceId}` 取歌组（无匹配 = 空数组）。 */
export function pickToplistSongs(groups: ToplistGroup[], source: SourceKey, sourceId: number | string): Song[] {
  return pickToplistGroup(groups, source, sourceId)?.songs ?? [];
}

/** 单源榜单腿：经能力面 getToplists 取全组后按 id 取歌；无客户端/未实现能力抛错（双端统一错误风格）。 */
export async function getToplistSongs(source: SourceKey, sourceId: number | string): Promise<Song[]> {
  const client = getDirectClient(source);
  if (!client?.getToplists) {
    throw new Error(`源 ${source} 未实现内容能力 getToplists`);
  }
  return pickToplistSongs(await client.getToplists(), source, sourceId);
}

/**
 * 内容缓存抽象（D6 #239）：直连客户端经构造注入访问宿主缓存，
 * core 默认实现包一层 cacheManager（同语义：get 命中返回数据 / 未命中 null，
 * set 由后端决定空值是否入缓存）。仅网易内容实现先行，接口先定型。
 */
export interface ContentCache {
  get<T>(key: string): T | null;
  set<T>(key: string, data: T, ttlMs: number): void;
}

/**
 * 单源直连客户端能力面（#239/#240）：
 * - 基础三能力（searchSongs / resolvePlayableUrl / resolveUrlInfo）；
 * - 内容能力平铺进客户端，**不设 content 子对象**（search 本身也是内容能力）；
 *   能力探测 = 方法存在性（`client.getToplists?`），与 hasCapability 同构；
 * - 命名规则：搜索 `search<实体>s` / 列表 `get<实体>s` / 详情 `get<实体>Detail` /
 *   播放 `resolve*`（批量加复数）；
 * - 内容方法统一返回 `Song`（rank 由消费方按索引推导，HotlistSong 已废）。
 * 全部可选：各源按自身能力实现子集。
 */
export interface DirectSourceClient {
  key: SourceKey;
  // ── 基础能力 ─────────────────────────────────────────────────────
  /** 源站搜索（直连）。未实现则不提供。 */
  searchSongs?: (keyword: string, page: number) => Promise<Song[]>;
  /** 播放 URL 直连解析；无版权/VIP 返回 ''（交给换元层）。 */
  resolvePlayableUrl?: (song: Song) => Promise<string>;
  /** 权威完整时长验证字段（T12 预检使用；按源覆盖，可不提供）。 */
  resolveUrlInfo?: (song: Song) => Promise<UrlInfo | null>;
  // ── 内容能力（#239 接口形态）────────────────────────────────────
  /** 歌手搜索（searchNeteaseArtists 迁入）。 */
  searchArtists?: (keyword: string, limit: number) => Promise<Artist[]>;
  /** 榜单全集（热榜/新歌榜…，id=`${source}:${sourceId}`）。 */
  getToplists?: () => Promise<ToplistGroup[]>;
  /** 每日推荐歌曲。 */
  getRecommendedSongs?: (limit: number) => Promise<Song[]>;
  /** 推荐歌单。 */
  getRecommendedPlaylists?: (limit: number) => Promise<DiscoverPlaylist[]>;
  /** 新碟上架（area 分类 + 分页）。 */
  getNewAlbums?: (area: string, offset: number, limit: number) => Promise<Album[]>;
  /** 专辑详情 + 专辑歌曲。 */
  getAlbumDetail?: (albumId: string) => Promise<{ album: Album; songs: Song[] } | null>;
  /** 歌手分类列表（cat 透传，offset/limit 分页）。 */
  getArtists?: (cat: number, offset: number, limit: number) => Promise<{ artists: Artist[]; total: number; more: boolean }>;
  /** 歌手详情合并（hotSongs + albums，一次调用渲染歌手页首屏）。 */
  getArtistDetail?: (artistId: string) => Promise<{ artist: Artist | null; hotSongs: Song[]; albums: Album[] }>;
  /** 歌手歌曲（分页；order: hot|time）。 */
  getArtistSongs?: (artistId: string, offset: number, limit: number, order?: string) => Promise<{ songs: Song[]; total: number }>;
  /** 歌手专辑（分页；#278 保留独立方法：桌面歌手页专辑年表需无限滚动）。 */
  getArtistAlbums?: (artistId: string, offset: number, limit: number) => Promise<{ albums: Album[]; total: number; more: boolean }>;
  /** 歌单列表（cat + order + 分页）。 */
  getPlaylists?: (cat: string, order: string, offset: number, limit: number) => Promise<{ playlists: DiscoverPlaylist[]; total: number; more: boolean }>;
  /** 歌单详情。 */
  getPlaylistDetail?: (id: number) => Promise<DiscoverPlaylist | null>;
  /** 歌单歌曲（分页；limit <= 0 = 全量，供导入/播放全部场景）。 */
  getPlaylistSongs?: (id: number, offset: number, limit: number) => Promise<{ songs: Song[]; total: number }>;
  /** 批量补齐歌曲可播放 URL（原 fillSongUrls/resolveNeteaseSongUrls 并入）。 */
  resolvePlayableUrls?: (songs: Song[]) => Promise<void>;
}

/**
 * IPC 暴露的内容方法清单（#240：契约从客户端接口派生的唯一手写物）。
 * 每方法在 IPC 层带 `source: SourceKey` 首参（`musicApi:call('getToplists', 'netease')`），
 * 主进程分发表按清单循环泛型分派到 `getDirectClient(source)`（未实现源抛错）。
 * `satisfies` 钉死清单 ⊆ 客户端接口方法名（加方法漏登记 → 编译期必报错）。
 */
export const CONTENT_METHODS = [
  'searchSongs',
  'searchArtists',
  'getToplists',
  'getRecommendedSongs',
  'getRecommendedPlaylists',
  'getNewAlbums',
  'getAlbumDetail',
  'getArtists',
  'getArtistDetail',
  'getArtistSongs',
  'getArtistAlbums',
  'getPlaylists',
  'getPlaylistDetail',
  'getPlaylistSongs',
  'resolvePlayableUrls',
] as const satisfies readonly (keyof DirectSourceClient)[];

export type ContentMethod = (typeof CONTENT_METHODS)[number];

// ── 直连客户端注册表 ────────────────────────────────────────────────

const clients = new Map<SourceKey, DirectSourceClient>();

export function registerDirectClient(client: DirectSourceClient): void {
  clients.set(client.key, client);
}

export function getDirectClient(key: SourceKey): DirectSourceClient | undefined {
  return clients.get(key);
}

export function hasDirectClient(key: SourceKey): boolean {
  return clients.has(key);
}

/** 测试/热替换用：清空全部注册。 */
export function clearDirectClients(): void {
  clients.clear();
}

// ── 来源开关 ─────────────────────────────────────────────────────────

const DEFAULT_MODE: SourceMode = 'auto';
let modes: Partial<Record<SourceKey, SourceMode>> = {};
let persister: ((modes: Partial<Record<SourceKey, SourceMode>>) => void) | null = null;

/** 宿主注册持久化回调（桌面 db / 移动端 AsyncStorage），core 内零 I/O。 */
export function setSourceModePersister(
  persist: ((modes: Partial<Record<SourceKey, SourceMode>>) => void) | null,
): void {
  persister = persist;
}

export function getSourceMode(key: SourceKey): SourceMode {
  return modes[key] ?? DEFAULT_MODE;
}

/** 单源设置（触发持久化）。 */
export function setSourceMode(key: SourceKey, mode: SourceMode): void {
  setSourceModes({ [key]: mode });
}

/** 批量替换全部开关（触发持久化一次）。 */
export function setSourceModes(next: Partial<Record<SourceKey, SourceMode>>): void {
  modes = { ...next };
  persister?.({ ...modes });
}

/** 初始加载（如启动时从存储读取），不触发持久化。 */
export function loadSourceModes(saved: Partial<Record<SourceKey, SourceMode>>): void {
  modes = { ...saved };
}

export function getAllSourceModes(): Partial<Record<SourceKey, SourceMode>> {
  return { ...modes };
}

/**
 * 存量来源开关洗白（#277）：SourceMode 已收窄为 auto|direct，双端加载持久化
 * 设置时统一调用——legacy 'api'（api 腿已拆，#275）映射为语义最接近的 'auto'
 * （直连优先），其余非法值过滤。桌面 main.ts 加载 / 移动端 settingsStore 重水合共用。
 */
export function sanitizeSourceModes(
  saved: Partial<Record<string, unknown>> | null | undefined,
): Partial<Record<SourceKey, SourceMode>> {
  const clean: Partial<Record<SourceKey, SourceMode>> = {};
  if (!saved) return clean;
  for (const [key, value] of Object.entries(saved)) {
    if (value === 'auto' || value === 'direct') {
      clean[key as SourceKey] = value;
    } else if (value === 'api') {
      clean[key as SourceKey] = 'auto';
    }
  }
  return clean;
}

// ── 路由（单一回退链） ───────────────────────────────────────────────

// ── tier3 插槽（spec #146 决策 2：预留，不实现；#144 独立立项实施）────────
//
// tier3 第三方解析源（订阅执行器）在「官方直连失败」与「换元」之间插槽，
// 默认关闭。本 spec 只预留开关位与插槽 hook，不实现解析逻辑；#144 落地时
// 注入 resolver 并开启开关即可，回退链无需再改。

/**
 * tier3 解析产物（#361）：URL + 护栏**证据等级**。
 * 护栏决策在 tier3 执行器内按源逐条应用（不过就换下一个源），路由层只记录
 * 结果等级用于诊断 / 后续 UI 决策，不重复判定。
 *
 * `commit`（#362）：交付回调——路由层在整链预算内真正采纳该候选时调用一次。
 * resolver 内部不再直接自增「命中」：预算超时被丢弃的迟到命中只有产出、没有交付，
 * 否则设置页会出现「命中数 > 实际交付数」（实测 hits=17 / 实际 0）。
 * 自定义 resolver（测试/宿主）可省略。
 */
export interface Tier3Resolution {
  url: string;
  guard: PlaybackGuard;
  /** 交付回调（幂等）；由路由层在采纳时调用，用于「真正交付」统计。 */
  commit?: () => void;
}

/** 每源 outcome 收集器（#363）：tier3 执行器逐源回调，路由层汇总进 trace。 */
export type Tier3LegCollector = (leg: PlaybackTraceSourceLeg) => void;

/** tier3 解析器插槽：输入 song，返回解析到的可播 URL + 护栏等级；未命中返回 null。
 *  未注入/关闭 = 不生效。可选 collect 用于把每源 outcome 交给调用方的 trace。 */
export type Tier3Resolver = (
  song: Song,
  collect?: Tier3LegCollector,
) => Promise<Tier3Resolution | null>;

/** 一次路由解析的 trace 累加器（#363）。关闭 sink 时为 null，热路径零构造。 */
interface TraceCtx {
  prefetchHit: boolean;
  prefetchedUrl: string | null;
  reason: string;
  directMs: number | null;
  directMethod: string | null;
  directSource: string | null;
  /** 直连腿被 3s 墙钟截断（#389）。 */
  directTimedOut: boolean;
  /** 直连腿播放时时长取证耗时（#392）。 */
  validateMs: number | null;
  tier3Engaged: boolean;
  tier3Ms: number | null;
  tier3TimedOut: boolean;
  legs: PlaybackTraceSourceLeg[];
}

function newTraceCtx(): TraceCtx {
  return {
    prefetchHit: false, prefetchedUrl: null, reason: '', directMs: null, directMethod: null,
    directSource: null, directTimedOut: false, validateMs: null, tier3Engaged: false, tier3Ms: null,
    tier3TimedOut: false, legs: [],
  };
}

/** 直连腿墙钟上限（#389）：tier3 有 2s/6s 墙，直连此前**完全裸露**在源自己的
 *  `timeoutMs`（最长 30s）× transport 3 次重试下，最坏 20–30s 无声无反馈，
 *  而这段时间 tier3 兜底腿还没开始。取 3s 与 tier3 单源墙同量级——直连是单请求腿，
 *  且已有预取缓存兜低延迟路径（直连解析 P50 ~66ms，3s 余量充足）。 */
const DIRECT_WALL_MS = 3_000;

const DIRECT_TIMED_OUT = Symbol('direct-timed-out');

/** 直连腿计时 + 墙钟包装：到点即视为该腿失败（进 tier3 兜底），底层请求自然结束、
 *  结果丢弃——与 tier3 单源超时同一语义（`withSourceDeadline`）。ctx 为 null 时
 *  仍施加墙（护栏不能因关闭 trace 而消失），只是不做计时。 */
async function timedDirectCall<T>(
  ctx: TraceCtx | null,
  client: DirectSourceClient,
  method: string,
  call: () => Promise<T>,
): Promise<T | typeof DIRECT_TIMED_OUT> {
  const t0 = ctx ? traceNow() : 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(),
      new Promise<typeof DIRECT_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(DIRECT_TIMED_OUT), DIRECT_WALL_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (ctx) {
      ctx.directMs = traceNow() - t0;
      ctx.directMethod = method;
      ctx.directSource = client.key;
    }
  }
}

/** 直连墙超时错误：区分「源返回失败」与「我们没等它」——归因文案与日志口径不同。 */
class DirectWallTimeoutError extends Error {
  constructor(method: string) {
    super(`直连 ${method} 超过 ${DIRECT_WALL_MS}ms 墙钟上限`);
    this.name = 'DirectWallTimeoutError';
  }
}

/** 直连调用：施加墙并计时；超时记 trace 后抛错，由既有 catch 走 tier3 兜底
 *  （`direct` 模式则上抛——仅直连语义下墙超时就是失败）。 */
async function directCall<T>(
  ctx: TraceCtx | null,
  client: DirectSourceClient,
  method: string,
  call: () => Promise<T>,
): Promise<T> {
  const outcome = await timedDirectCall(ctx, client, method, call);
  if (outcome === DIRECT_TIMED_OUT) {
    if (ctx) ctx.directTimedOut = true;
    throw new DirectWallTimeoutError(method);
  }
  return outcome as T;
}

let tier3Enabled = false;
let tier3Resolver: Tier3Resolver | null = null;

export function setTier3Enabled(enabled: boolean): void {
  tier3Enabled = enabled;
}

export function getTier3Enabled(): boolean {
  return tier3Enabled;
}

/** 注入 tier3 解析器（#144 实施时调用）；null 清除插槽。
 *  换 resolver 时同步清空同歌去重表——旧 resolver 的 in-flight 结果不再可信。 */
export function setTier3Resolver(resolver: Tier3Resolver | null): void {
  tier3Inflight.clear();
  tier3Resolver = resolver;
}

/** tier3 搜索兜底插槽：官方直连搜索失败时返回第三方候选歌曲；未注入/关闭 = 不生效。 */
export type Tier3SearchResolver = (keyword: string, page: number, source: SourceKey) => Promise<Song[]>;

let tier3SearchEnabled = false;
let tier3SearchResolver: Tier3SearchResolver | null = null;

export function setTier3SearchEnabled(enabled: boolean): void {
  tier3SearchEnabled = enabled;
}

export function getTier3SearchEnabled(): boolean {
  return tier3SearchEnabled;
}

export function setTier3SearchResolver(resolver: Tier3SearchResolver | null): void {
  tier3SearchResolver = resolver;
}

/** 直连搜索失败后的 tier3 搜索兜底（默认关闭，未注入直接跳过）。 */
async function tryTier3Search(keyword: string, page: number, source: SourceKey): Promise<Song[]> {
  if (!tier3SearchEnabled || !tier3SearchResolver) {
    console.info(`[tier3] 直连搜索失败，但 tier3 搜索未启用/未注入，跳过: ${keyword} (${source})`);
    return [];
  }
  console.info(`[tier3] 直连搜索失败，进入第三方搜索兜底: ${keyword} (${source})`);
  try {
    const songs = await tier3SearchResolver(keyword, page, source);
    console.info(`[tier3] 第三方搜索返回 ${songs.length} 首: ${keyword} (${source})`);
    return songs;
  } catch (e) {
    console.warn(`[tier3] 第三方搜索抛错: ${(e as Error)?.message || e}`);
    return [];
  }
}

/** tier3 解析总预算：mitu/vkeys 类源命中通常 2-5s，mgmp3 类源超时 20s——
 *  预算截断避免播放被慢源拖死（超时按未命中处理，慢源请求自然结束，结果丢弃）。 */
export const TIER3_BUDGET_MS = 6_000;

// ── tier3 同歌去重（#172 评论：同歌并行重复解析）──────────────────────
//
// 前台播放解析与后台预取（prefetchNextSong）会并行解析同一首歌，各自独立
// 等满预算：后台 3s 已命中，前台还在等自己那条 6s 预算且中途不查缓存，
// 实测《我好想你》白等 ~10s。以歌曲身份为键共享同一条底层 resolver
// Promise：先到先得、后来者直接 join，第三方上游只被打一次。
//
// 键在**底层 Promise 结束**（含失败）后才移除——预算超时的调用方放弃等待
// 后，迟到的命中仍能被同键后续调用方（如 fresh 重试的 tier3 腿）接住。
interface Tier3InflightRun {
  /** 槽位到手（排队结束）时 resolve；调用方的 6s 预算从这里开始计（ADR 决策 8）。 */
  started: Promise<void>;
  /** 底层解析结果（同键调用方共享）。 */
  result: Promise<Tier3Resolution | null>;
}

const tier3Inflight = new Map<string, Tier3InflightRun>();

// ── 跨歌全局在飞上限 K=3（ADR 2026-09-25 决策 8）────────────────────
//
// 并发会放大「多首并发解析」这个既有乘数：串行下上游在飞数 = 在飞歌曲数。
// 批量下载（并发 3）、快速连续切歌、失败跳歌链都能同时压多条解析，而此前
// **跨歌上界不存在**（只有 `tier3Inflight` 的同歌去重）。#388 实测 qq 搜索在
// 200ms 间隔下 12 次里 10 次撞 `code=2001` 速率墙——单源速率上限是真实约束。
// 取 3 与既有下载并发 `DEFAULT_MAX_CONCURRENT` 同量级（第三方主机通常 2–3 台，
// 「每台一条在飞」即可）。
const MAX_TIER3_IN_FLIGHT = 3;
let tier3InFlightCount = 0;
const tier3Queue: (() => void)[] = [];

/** 取槽位：有空位直接进；否则 FIFO 排队（ADR 决策 8）。 */
function acquireTier3Slot(): Promise<void> {
  if (tier3InFlightCount < MAX_TIER3_IN_FLIGHT) {
    tier3InFlightCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => tier3Queue.push(resolve));
}

/** 让出槽位：队首等待者**直接接管**该槽位（计数不变），无人等待才递减。 */
function releaseTier3Slot(): void {
  const next = tier3Queue.shift();
  if (next) next();
  else tier3InFlightCount = Math.max(0, tier3InFlightCount - 1);
}

/** 测试/重置用：清空排队、在飞去重表与在飞计数（与 clearTier3ProbeCache 同取向）。
 *  排队者会被唤醒——否则它们的 `started` 永不 resolve，预算计时器不启动、promise 悬空。 */
export function clearTier3Scheduling(): void {
  tier3Inflight.clear();
  const waiters = tier3Queue.splice(0);
  tier3InFlightCount = 0;
  for (const wake of waiters) wake();
}

/** 观测用：当前 tier3 在飞解析数（测试断言上限 K=3）。 */
export function getTier3InFlightCount(): number {
  return tier3InFlightCount;
}

/** 歌曲身份键：id 优先；无 id 的歌（热榜旧数据等）退回 名字+歌手。 */
function tier3InflightKey(song: Song): string {
  return song.id
    ? `${song.sourceType}|${song.id}`
    : `${song.sourceType}|name:${song.name}|${song.artist}`;
}

/** 共享的 tier3 解析：已有同键 in-flight 直接复用；否则取 K=3 槽位、调用 resolver 并登记。
 *  `started` 让调用方的预算从**槽位到手**起计——排队时间不算预算（ADR 决策 8）。 */
function tier3ResolveShared(song: Song, reason: string, ctx?: TraceCtx | null): Tier3InflightRun {
  const key = tier3InflightKey(song);
  const existing = tier3Inflight.get(key);
  if (existing) {
    // 同歌并发共享同一条解析：每源 leg 只回给发起者（首个调用方）的 ctx，
    // 后来者 join 时不重复收——与「同歌只打一次上游」的既有语义一致。
    console.info(`[tier3] 同歌解析进行中，复用同一条解析（${reason}）: 《${song.name}》${song.artist}`);
    return existing;
  }
  console.info(`[tier3] ${reason}，进入第三方解析源: 《${song.name}》${song.artist}`);
  const collect = ctx ? (leg: PlaybackTraceSourceLeg) => { ctx.legs.push(leg); } : undefined;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const result = (async () => {
    await acquireTier3Slot();
    markStarted();
    try {
      return await tier3Resolver!(song, collect);
    } catch (e) {
      console.warn(`[tier3] resolver 抛错: ${(e as Error)?.message || e}`);
      return null;
    } finally {
      tier3Inflight.delete(key);
      releaseTier3Slot();
    }
  })();
  const run: Tier3InflightRun = { started, result };
  tier3Inflight.set(key, run);
  return run;
}

/** 直连失败后的 tier3 尝试（默认关闭，未注入直接跳过）。reason 用于日志区分触发原因。
 *  带总预算：慢源（mgmp3 20s 超时）不阻塞播放——预算内未命中按未命中处理。
 *  同歌并发调用共享同一条底层解析（见 tier3ResolveShared），预算仍按各调用方独立计时。 */
async function tryTier3(song: Song, reason: string, ctx?: TraceCtx | null): Promise<Tier3Resolution | null> {
  if (ctx) {
    ctx.tier3Engaged = true;
    ctx.reason = reason;
  }
  if (!tier3Enabled || !tier3Resolver) {
    console.info(`[tier3] ${reason}，但 tier3 未启用/未注入，直接回退: 《${song.name}》${song.artist}`);
    return null;
  }
  const t0 = ctx ? traceNow() : 0;
  /** tier3 腿**活跃**耗时起点（槽位到手）；排队等待不计入——与 6s 预算同口径。 */
  let activeT0 = 0;
  try {
    // 预算哨兵：区分「预算超时」与「resolver 正常返回 null（全源未命中）」——
    // 二者都让 race 得到 null，但只有前者算 timedOut（迟到命中才该记 discarded）。
    const BUDGET_EXHAUSTED = Symbol('tier3-budget-exhausted');
    const run = tier3ResolveShared(song, reason, ctx);
    // ADR 2026-09-25 决策 8：K=3 排队期间**不计入** 6s 预算——否则被排在后面的
    // 调用方会在没打过任何上游的情况下先超时（切歌场景 P50 反而退化）。
    const budgetExhausted = (async (): Promise<typeof BUDGET_EXHAUSTED> => {
      await run.started;
      if (ctx) activeT0 = traceNow();
      return new Promise<typeof BUDGET_EXHAUSTED>((resolve) =>
        setTimeout(() => resolve(BUDGET_EXHAUSTED), TIER3_BUDGET_MS),
      );
    })();
    const winner = await Promise.race([run.result, budgetExhausted]);
    const res = winner === BUDGET_EXHAUSTED ? null : winner;
    if (ctx) {
      // 排队时间单列在 totalMs 里；tier3Ms 记「腿本身跑了多久」（与 6s 预算同口径）。
      ctx.tier3Ms = traceNow() - (activeT0 || t0);
      ctx.tier3TimedOut = winner === BUDGET_EXHAUSTED;
    }
    if (!res || !res.url?.startsWith('http')) return null;
    // #362：只有 race 获胜、真正被调用方采纳的候选才算「交付」。
    // 预算超时丢弃的迟到命中不会走到这里，其 commit 永不触发。
    res.commit?.();
    return res;
  } catch (e) {
    if (ctx) {
      ctx.tier3Ms = traceNow() - (activeT0 || t0);
      ctx.tier3TimedOut = false;
    }
    console.warn(`[tier3] resolver 抛错: ${(e as Error)?.message || e}`);
    return null;
  }
}

/** 试听版也先试 tier3 拿完整版（用户决策：试听无意义，兜底可能拿完整）：
 *  命中返回完整版可播对象（nonFull=false）；未命中/未配置返回 null，
 *  调用方退回直连试听并标 nonFull。tier3 未配置时 tryTier3 零成本返回。 */
async function tryTier3Full(song: Song, reason: string, ctx?: TraceCtx | null): Promise<RoutedPlayable | null> {
  const resolution = await tryTier3(song, reason, ctx);
  return resolution ? tier3Playable(resolution) : null;
}

/** 搜索结果被探测标记为 invalid 时，即使直连返回了 URL 也优先换 tier3；
 *  tier3 未命中（未启用/未注入/全源失败）则保留直连结果，由上层按现状处理。
 *  试听版（preview/试听段）的完整版 tier3 兜底不在此函数——调用方
 *  resolvePlayableSongRouted 判定试听后统一走 tryTier3Full（命中换完整版、
 *  未命中退回直连试听并标 nonFull）。 */
interface PreferredDirectUrl {
  url: string;
  /** 非空 = 该 URL 来自 tier3（护栏已过）；null = 保留直连结果。 */
  resolution: Tier3Resolution | null;
}

async function preferTier3WhenBad(song: Song, directUrl: string, ctx?: TraceCtx | null): Promise<PreferredDirectUrl> {
  if (song.audioTag !== 'invalid') return { url: directUrl, resolution: null };
  const reason = '直连 URL 已被探测标记为无效（audioTag=invalid）';
  const resolution = await tryTier3(song, reason, ctx);
  return resolution ? { url: resolution.url, resolution } : { url: directUrl, resolution: null };
}

/** 模式分派：无客户端/无能力统一按「直连不可用」处理——
 *  自建 API 已退役，api 腿已拆除（#275），SourceMode 已收窄为 auto|direct（#277）。 */
type RouteDecision =
  | { kind: 'direct'; client: DirectSourceClient; mode: SourceMode }
  | { kind: 'direct-unavailable' };

function decideRoute(source: SourceKey, hasCapability: (c: DirectSourceClient) => boolean): RouteDecision {
  const mode = getSourceMode(source);
  const client = getDirectClient(source);
  if (!client || !hasCapability(client)) {
    return { kind: 'direct-unavailable' };
  }
  return { kind: 'direct', client, mode };
}

/**
 * 模式感知搜索（供 SearchOrchestrator 的 searchOneSource 注入）。
 * - direct：仅直连（无客户端/失败 → 明确报错，不回退）；
 * - auto：直连优先，失败/空结果进 tier3 搜索兜底；tier3 未命中 = 上抛（D2 语义）。
 */
export async function searchSongsRouted(
  query: string,
  page: number,
  source: SourceKey,
): Promise<Song[]> {
  const route = decideRoute(source, (c) => !!c.searchSongs);
  if (route.kind === 'direct-unavailable') {
    const tier3Songs = await tryTier3Search(query, page, source);
    if (tier3Songs.length > 0) return tier3Songs;
    throw new Error('该源暂无直连实现');
  }
  try {
    // #389 评估结论：直连**搜索**腿暂不套墙——搜索腿语义是「尽量找全」，套墙会
    // 静默截断列表结果（与解析腿「要么拿到 URL 要么失败」不同），需独立决策。
    // 本票的墙只覆盖解析腿（resolveUrlInfo / resolvePlayableUrl）。
    const directSongs = await route.client.searchSongs!(query, page);
    if (directSongs.length > 0) return directSongs;
    // 直连返回空也视为“未命中”，进入 tier3 搜索兜底（若启用）。
    const tier3Songs = await tryTier3Search(query, page, source);
    if (tier3Songs.length > 0) return tier3Songs;
    return directSongs;
  } catch (err) {
    // 直连搜索失败 → 第三方订阅搜索兜底（若启用）；tier3 未命中 = 原样上抛（D2）。
    const tier3Songs = await tryTier3Search(query, page, source);
    if (tier3Songs.length > 0) return tier3Songs;
    throw err;
  }
}

/**
 * 模式感知播放 URL 解析（请求层回退链的 URL 腿）。
 * 直连返回空串（无版权/VIP）= 原样上抛，由换元层处理；直连失败且 tier3 未命中 = 上抛。
 */
export async function resolvePlayableUrlRouted(song: Song): Promise<string> {
  const route = decideRoute(song.sourceType, (c) => !!c.resolvePlayableUrl);
  if (route.kind === 'direct-unavailable') throw new Error('该源暂无直连实现');
  try {
    // 与 resolveRoutedInner 同一条腿：同样过 #389 的 3s 墙（本函数经 IPC 暴露，
    // 是另一个「直连解析腿」入口，保证 wall 口径一致）。
    const url = await directCall(null, route.client, 'resolvePlayableUrl', () => route.client.resolvePlayableUrl!(song));
    if (url) {
      // 搜索结果已被探测标记为无效时，即使直连返回了 URL 也先试 tier3；
      // 没有配置 tier3 则保持原直连结果，由上层继续按现状报错/换元。
      return (await preferTier3WhenBad(song, url)).url;
    }
    // 直连返回空串（无版权/VIP）也进 tier3 兜底（默认关）；失败保持空串交换元层。
    const tier3 = await tryTier3(song, '直连返回空串（无版权/VIP）');
    if (tier3) return tier3.url;
    return url;
  } catch (err) {
    if (route.mode === 'direct') throw err;
    // tier3 插槽：直连失败后的兜底（默认关；#144 落地后启用）；未命中 = 上抛（D2）。
    const tier3 = await tryTier3(song, '直连解析失败');
    if (tier3) return tier3.url;
    throw err;
  }
}

// 护栏类型经路由层再导出：消费方（含测试）从播放解析入口同一处取类型。
export type { PlaybackGuard, PlaybackVia };

/** 路由解析结果：可播 URL + 试听版标记（T12）+ 来源腿 / 护栏等级（#361）。 */
export interface RoutedPlayable {
  url: string;
  nonFull: boolean;
  /** 解析来源腿：`direct` 直连 / `tier3` 第三方兜底（#361）。 */
  via: PlaybackVia;
  /** 护栏证据等级；直连腿恒为 `none`（护栏只约束 tier3 替换的 URL）（#361）。 */
  guard: PlaybackGuard;
}

/** 直连腿结果：护栏不作用于直连 URL，恒 `via=direct` / `guard=none`。 */
function directPlayable(url: string, nonFull: boolean): RoutedPlayable {
  return { url, nonFull, via: 'direct', guard: 'none' };
}

/** tier3 腿结果：护栏已过，`nonFull=false`（兜底拿到的就是完整版）。 */
function tier3Playable(resolution: Tier3Resolution): RoutedPlayable {
  return { url: resolution.url, nonFull: false, via: 'tier3', guard: resolution.guard };
}

/** 把一次路由解析收尾成结构化 trace 并交给 sink（#363）。 */
function emitResolveTrace(
  song: Song,
  ctx: TraceCtx,
  t0: number,
  result: RoutedPlayable | null,
  err: unknown,
): void {
  const url = result?.url || '';
  const layer: PlaybackTrace['layer'] = !url
    ? 'fail'
    : ctx.prefetchHit && url === ctx.prefetchedUrl
      ? 'prefetch'
      : result!.via === 'tier3'
        ? 'tier3'
        : 'direct';
  // 迟到命中被整链预算丢弃 → leg 记 discarded，与 tier3Stats.discarded 同口径。
  const sources = ctx.tier3TimedOut
    ? ctx.legs.map((leg) => (leg.outcome === 'hit' ? { ...leg, outcome: 'discarded' as const } : leg))
    : ctx.legs;
  const reason = err
    ? `解析抛错: ${(err as Error)?.message || String(err)}`
    : ctx.reason || (layer === 'fail' ? '全部链路未取得 URL' : '直连解析成功');
  // 失败无来源腿；guard 只在 tier3 腿有意义（直连恒 none，不写进 trace）。
  const via = layer === 'fail' ? null : result?.via ?? null;
  const guard = via === 'tier3' ? result?.guard ?? null : null;
  const now = traceNow();
  emitPlaybackTrace({
    ts: now,
    songId: song.id,
    songName: song.name,
    artist: song.artist,
    sourceType: song.sourceType,
    totalMs: now - t0,
    layer,
    nonFull: result?.nonFull ?? false,
    prefetchHit: ctx.prefetchHit,
    tier3Engaged: ctx.tier3Engaged,
    reason,
    via,
    guard,
    directMs: ctx.directMs,
    directMethod: ctx.directMethod,
    directSource: ctx.directSource,
    directTimedOut: ctx.directTimedOut,
    validateMs: ctx.validateMs,
    tier3Ms: ctx.tier3Ms,
    tier3TimedOut: ctx.tier3TimedOut,
    sources,
  });
}

export async function resolvePlayableSongRouted(song: Song): Promise<RoutedPlayable> {
  // sink 为空：直接走原路径，零构造零计时（#363 开销约束）。
  if (!isPlaybackTraceEnabled()) return resolveRoutedInner(song, null);
  const ctx = newTraceCtx();
  const t0 = traceNow();
  try {
    const result = await resolveRoutedInner(song, ctx);
    emitResolveTrace(song, ctx, t0, result, null);
    return result;
  } catch (err) {
    emitResolveTrace(song, ctx, t0, null, err);
    throw err;
  }
}

/**
 * 直连腿取证插槽（#392）：默认走 core 的 `validateDirectUrlNonFull`（真发一次 Range）。
 * 宿主/测试可注入替换——测试注入 stub 以保持**零 I/O**（与 `setTier3Resolver` 同构的接缝）。
 */
export type DirectValidator = (song: Song, url: string) => Promise<DirectValidationResult>;

let directValidator: DirectValidator | null = (song, url) => validateDirectUrlNonFull(song, url);

/** 注入/清除直连腿取证器；null = 关闭取证（不判定，等价 fail-open）。 */
export function setDirectValidator(fn: DirectValidator | null): void {
  directValidator = fn;
}

/**
 * 直连腿播放时时长取证（#392）：仅当「该源**无权威时长**（未实现 resolveUrlInfo，
 * 即 netease / soda 之外）+ 标称时长已知」时发起**一次** Range。netease / soda
 * 有权威 playTime，走既有 classifyLength 路径，**不增加任何请求**。
 * 结论只用于 nonFull 标记，不改播放路径；证据不足一律 fail-open（见 directValidation）。
 *
 * 成本在 **3s 直连墙之外**（成功路径追加 ≤1.5s Range）：失败路径的上界不变（3s 墙 + tier3 6s）。
 */
async function validateDirectLeg(
  song: Song,
  url: string,
  client: DirectSourceClient,
  ctx: TraceCtx | null,
): Promise<{ nonFull: boolean }> {
  if (!directValidator) return { nonFull: false };
  if (client.resolveUrlInfo) return { nonFull: false };
  if (!(typeof song.duration === 'number' && song.duration > 0)) return { nonFull: false };
  const result = await directValidator(song, url);
  if (ctx) ctx.validateMs = result.validateMs;
  if (result.nonFull) console.info(`[player] 《${song.name}》直连腿取证为试听片段: ${result.reason ?? ''}`);
  return { nonFull: result.nonFull };
}

/**
 * 模式感知播放解析（带完整时长校验，T12 #158）：
 * 直连客户端若有 resolveUrlInfo（权威 playTime/size/br/fee/payed），用它做
 * 试听版判定（时长比 <0.5 → nonFull）；否则退回 resolvePlayableUrl。
 * 空 URL（无版权/VIP）原样上抛（nonFull=false），由换元层处理；
 * 直连失败且 tier3 未命中 = 上抛（D2 语义）。
 */
async function resolveRoutedInner(song: Song, ctx: TraceCtx | null): Promise<RoutedPlayable> {
  // 预取缓存命中（探测阶段已解析并验证过的直链，30min TTL）→ 0 等待直接播，
  // 绝不等待预取队列；未命中才实时走完整解析链。
  // 命中且 nonFull（试听版）→ 也走 tier3 兜底尝试拿完整版（用户决策：试听无意义，
  // 兜底可能拿完整；tier3 未配置/未命中则退回缓存直连试听）。
  const prefetched = getPrefetchedUrl(song);
  if (prefetched) {
    if (ctx) {
      ctx.prefetchHit = true;
      ctx.prefetchedUrl = prefetched.url;
      ctx.reason = '预取缓存命中';
    }
    if (prefetched.nonFull) {
      // #361：预取只存直连结果，但「试听版换完整版」这一跳进 tier3，
      // 同样要过护栏（命中即 0 等待 ≠ 可以绕过验证）。
      const full = await tryTier3Full(song, `预取缓存命中但为试听版（nonFull），尝试 tier3 拿完整版`, ctx);
      if (full) return full;
    }
    return directPlayable(prefetched.url, prefetched.nonFull);
  }

  // 能力门含 resolveUrlInfo（UrlInfo 自带 url，仅有 UrlInfo 也可直连解析）
  const route = decideRoute(song.sourceType, (c) => !!c.resolvePlayableUrl || !!c.resolveUrlInfo);
  if (route.kind === 'direct-unavailable') throw new Error('该源暂无直连实现');
  try {
    const client = route.client;
    if (client.resolveUrlInfo) {
      const info = await directCall(ctx, client, 'resolveUrlInfo', () => client.resolveUrlInfo!(song));
      if (info) {
        if (info.url) {
          // 搜索结果已被探测标记为无效时，优先用 tier3 换一个可播 URL；
          // tier3 未命中则保留直连结果并按其权威字段判定试听版。
          const picked = await preferTier3WhenBad(song, info.url, ctx);
          if (picked.resolution) return tier3Playable(picked.resolution);
          const trial = isTrialUrlInfo(info, song.duration) || song.audioTag === 'preview';
          // 试听版也走 tier3 兜底尝试拿完整版（用户决策：试听无意义，兜底可能
          // 拿到完整版；tier3 未命中才退回直连试听）——tier3 拿到则 nonFull=false。
          if (trial) {
            const full = await tryTier3Full(song, `直连为试听版（nonFull），尝试 tier3 拿完整版`, ctx);
            if (full) return full;
          }
          if (ctx && !ctx.reason) ctx.reason = '直连解析成功';
          return directPlayable(picked.url, trial);
        }
        // UrlInfo 存在但 url 为空（无版权/VIP）→ tier3 兜底（默认关）。
        const tier3 = await tryTier3(song, '直连 UrlInfo 无 url（无版权/VIP）', ctx);
        if (tier3) return tier3Playable(tier3);
        if (ctx && !ctx.tier3Engaged) ctx.reason = '直连 UrlInfo 无 url（无版权/VIP）';
        return directPlayable('', false);
      }
    }
    const url = await directCall(ctx, client, 'resolvePlayableUrl', () => client.resolvePlayableUrl!(song));
    if (url) {
      // 搜索结果已被探测标记为无效时，优先用 tier3 换一个可播 URL。
      const picked = await preferTier3WhenBad(song, url, ctx);
      if (picked.resolution) return tier3Playable(picked.resolution);
      // 搜索结果已被探测标为试听版（audioTag=preview，如酷我 VIP 歌的 M500 试听）：
      // 试听也走 tier3 兜底尝试拿完整版（tier3 未命中才退回直连试听）。
      if (song.audioTag === 'preview') {
        const full = await tryTier3Full(song, `直连为试听版（audioTag=preview），尝试 tier3 拿完整版`, ctx);
        if (full) return full;
      }
      // #392：无权威时长的直连腿（resolveUrlInfo 只有 netease/soda 实现）播放时取证一次。
      const validated = await validateDirectLeg(song, picked.url, client, ctx);
      if (ctx && !ctx.reason) ctx.reason = '直连解析成功';
      return directPlayable(picked.url, song.audioTag === 'preview' || validated.nonFull);
    }
    // 直连返回空串（无版权/VIP）→ tier3 兜底（默认关）；失败保持空串交换元层。
    const tier3 = await tryTier3(song, '直连返回空串（无版权/VIP）', ctx);
    if (tier3) return tier3Playable(tier3);
    if (ctx && !ctx.tier3Engaged) ctx.reason = '直连返回空串（无版权/VIP）';
    return directPlayable('', false);
  } catch (err) {
    if (route.mode === 'direct') throw err;
    // tier3 插槽：直连失败后的兜底（默认关；#144 落地后启用）；未命中 = 上抛（D2）。
    const tier3 = await tryTier3(song, '直连解析失败', ctx);
    if (tier3) return tier3Playable(tier3);
    if (ctx && !ctx.tier3Engaged) ctx.reason = '直连解析失败';
    throw err;
  }
}

