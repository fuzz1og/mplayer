import type { Song, SourceKey } from '../types/index.js';
import { isTrialUrlInfo } from './playability.js';
import type { UrlInfo } from './playability.js';

/**
 * 来源开关 + 直连客户端注册表 + 路由（T01 切片 2，spec #146 决策 1/2/3）。
 *
 * 单一回退链（请求层）：官方直连 → 自建 API（auto 链末位兜底）→ 换元/明确不可播
 * （换元在调用方/store 层，本模块不实现；直连返回空串 = 无版权/VIP，原样上抛）。
 *
 * - 每源来源开关 `auto | direct | api`，默认 auto；
 * - 直连客户端由 T02+ 各源 ticket 注册（纯 JS，双端共用）；
 * - 路由函数（searchSongsRouted / resolvePlayableUrlRouted）供 SearchOrchestrator
 *   的 searchOneSource 注入（ADR-0003）与播放 URL 解析使用；
 * - 持久化钩子：宿主（桌面主进程/移动端设置存储）注册 persister，core 内零 I/O。
 */

export type SourceMode = 'auto' | 'direct' | 'api';

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

/** 来源开关三态选项（桌面/移动端设置 UI 共用）。 */
export const SOURCE_MODE_OPTIONS: { value: SourceMode; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'direct', label: '仅直连' },
  { value: 'api', label: '仅自建 API' },
];

export interface DirectSourceClient {
  key: SourceKey;
  /** 源站搜索（直连）。未实现则不提供。 */
  search?: (keyword: string, page: number) => Promise<Song[]>;
  /** 播放 URL 直连解析；无版权/VIP 返回 ''（交给换元层）。 */
  resolvePlayableUrl?: (song: Song) => Promise<string>;
  /** 权威完整时长验证字段（T12 预检使用；按源覆盖，可不提供）。 */
  resolveUrlInfo?: (song: Song) => Promise<UrlInfo | null>;
}

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

// ── 路由（单一回退链） ───────────────────────────────────────────────

/** api 腿 = 自建 API 现状语义（搜索 POST / 播放直链解析）。 */
export interface SourceRouterLegs {
  searchSongs: (query: string, page: number, source: SourceKey) => Promise<Song[]>;
  getAudioUrl: (url: string) => Promise<string>;
}

let legs: SourceRouterLegs | null = null;

/** 宿主在 core 初始化时注入 api 腿（musicApi.searchSongs / getAudioUrl）。 */
export function configureSourceRouter(routerLegs: SourceRouterLegs): void {
  legs = routerLegs;
}

function requireLegs(): SourceRouterLegs {
  if (!legs) throw new Error('sourceRouter 未配置 api 腿（configureSourceRouter 未调用）');
  return legs;
}

// ── tier3 插槽（spec #146 决策 2：预留，不实现；#144 独立立项实施）────────
//
// tier3 第三方解析源（订阅执行器）在「官方直连失败」与「换元」之间插槽，
// 默认关闭。本 spec 只预留开关位与插槽 hook，不实现解析逻辑；#144 落地时
// 注入 resolver 并开启开关即可，回退链无需再改。

/** tier3 解析器插槽：输入 song，返回解析到的可播 URL；未注入/关闭 = 不生效。 */
export type Tier3Resolver = (song: Song) => Promise<string>;

let tier3Enabled = false;
let tier3Resolver: Tier3Resolver | null = null;

export function setTier3Enabled(enabled: boolean): void {
  tier3Enabled = enabled;
}

export function getTier3Enabled(): boolean {
  return tier3Enabled;
}

/** 注入 tier3 解析器（#144 实施时调用）；null 清除插槽。 */
export function setTier3Resolver(resolver: Tier3Resolver | null): void {
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

/** 直连搜索失败后、api 腿前的 tier3 搜索兜底（默认关闭，未注入直接跳过）。 */
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

/** 直连失败后、api 腿前的 tier3 尝试（默认关闭，未注入直接跳过）。 */
async function tryTier3(song: Song): Promise<string> {
  if (!tier3Enabled || !tier3Resolver) {
    console.info(`[tier3] 直连未取得可播 URL，但 tier3 未启用/未注入，直接回退: 《${song.name}》${song.artist}`);
    return '';
  }
  console.info(`[tier3] 直连未取得可播 URL，进入第三方解析源: 《${song.name}》${song.artist}`);
  try {
    const url = await tier3Resolver(song);
    return url?.startsWith('http') ? url : '';
  } catch (e) {
    console.warn(`[tier3] resolver 抛错: ${(e as Error)?.message || e}`);
    return '';
  }
}

/** 模式分派：api 一律走 api 腿；direct 无能力/失败明确上抛；auto 直连优先、失败回退 api。 */
type RouteDecision =
  | { kind: 'direct'; client: DirectSourceClient; mode: SourceMode }
  | { kind: 'api' }
  | { kind: 'direct-unavailable' };

function decideRoute(source: SourceKey, hasCapability: (c: DirectSourceClient) => boolean): RouteDecision {
  const mode = getSourceMode(source);
  const client = getDirectClient(source);
  if (mode === 'api' || !client || !hasCapability(client)) {
    return mode === 'direct' ? { kind: 'direct-unavailable' } : { kind: 'api' };
  }
  return { kind: 'direct', client, mode };
}

/**
 * 模式感知搜索（供 SearchOrchestrator 的 searchOneSource 注入）。
 * - api：一律自建 API（现状）；
 * - direct：仅直连（无客户端/失败 → 明确报错，不回退）；
 * - auto：直连优先，失败回退自建 API；无客户端则直接自建 API（现状等价）。
 */
export async function searchSongsRouted(
  query: string,
  page: number,
  source: SourceKey,
): Promise<Song[]> {
  const api = requireLegs();
  const route = decideRoute(source, (c) => !!c.search);
  if (route.kind === 'api') return api.searchSongs(query, page, source);
  if (route.kind === 'direct-unavailable') {
    const tier3Songs = await tryTier3Search(query, page, source);
    if (tier3Songs.length > 0) return tier3Songs;
    throw new Error('该源暂无直连实现');
  }
  try {
    return await route.client.search!(query, page);
  } catch (err) {
    // 直连搜索失败 → 第三方订阅搜索兜底（若启用）；再按模式决定是否回退自建 API。
    const tier3Songs = await tryTier3Search(query, page, source);
    if (tier3Songs.length > 0) return tier3Songs;
    if (route.mode === 'direct') throw err;
    return api.searchSongs(query, page, source);
  }
}

/**
 * 模式感知播放 URL 解析（请求层回退链的 URL 腿）。
 * 直连返回空串（无版权/VIP）= 原样上抛，由换元层处理，不静默回退 api。
 */
export async function resolvePlayableUrlRouted(song: Song): Promise<string> {
  const api = requireLegs();
  const route = decideRoute(song.sourceType, (c) => !!c.resolvePlayableUrl);
  if (route.kind === 'api') return api.getAudioUrl(song.url);
  if (route.kind === 'direct-unavailable') throw new Error('该源暂无直连实现');
  try {
    const url = await route.client.resolvePlayableUrl!(song);
    if (url) return url;
    // 直连返回空串（无版权/VIP）也进 tier3 兜底（默认关）；失败保持空串交换元层。
    const tier3Url = await tryTier3(song);
    if (tier3Url) return tier3Url;
    return url;
  } catch (err) {
    if (route.mode === 'direct') throw err;
    // tier3 插槽：直连失败后、api 腿前（默认关；#144 落地后启用）
    const tier3Url = await tryTier3(song);
    if (tier3Url) return tier3Url;
    return api.getAudioUrl(song.url);
  }
}

/** 路由解析结果：可播 URL + 试听版标记（T12，non-full 驱动换元触发）。 */
export interface RoutedPlayable {
  url: string;
  nonFull: boolean;
}

/**
 * 模式感知播放解析（带完整时长校验，T12 #158）：
 * 直连客户端若有 resolveUrlInfo（权威 playTime/size/br/fee/payed），用它做
 * 试听版判定（时长比 <0.5 → nonFull）；否则退回 resolvePlayableUrl。
 * 空 URL（无版权/VIP）原样上抛（nonFull=false），由换元层处理；
 * 直连失败按模式回退 api（auto）或上抛（direct）。
 */
export async function resolvePlayableSongRouted(song: Song): Promise<RoutedPlayable> {
  const api = requireLegs();
  // 能力门含 resolveUrlInfo（UrlInfo 自带 url，仅有 UrlInfo 也可直连解析）
  const route = decideRoute(song.sourceType, (c) => !!c.resolvePlayableUrl || !!c.resolveUrlInfo);
  if (route.kind === 'api') return { url: await api.getAudioUrl(song.url), nonFull: false };
  if (route.kind === 'direct-unavailable') throw new Error('该源暂无直连实现');
  try {
    const client = route.client;
    if (client.resolveUrlInfo) {
      const info = await client.resolveUrlInfo(song);
      if (info) {
        if (info.url) {
          return { url: info.url, nonFull: isTrialUrlInfo(info, song.duration) };
        }
        // UrlInfo 存在但 url 为空（无版权/VIP）→ tier3 兜底（默认关）。
        const tier3Url = await tryTier3(song);
        if (tier3Url) return { url: tier3Url, nonFull: false };
        return { url: '', nonFull: false };
      }
    }
    const url = await client.resolvePlayableUrl!(song);
    if (url) return { url, nonFull: false };
    // 直连返回空串（无版权/VIP）→ tier3 兜底（默认关）；失败保持空串交换元层。
    const tier3Url = await tryTier3(song);
    if (tier3Url) return { url: tier3Url, nonFull: false };
    return { url: '', nonFull: false };
  } catch (err) {
    if (route.mode === 'direct') throw err;
    // tier3 插槽：直连失败后、api 腿前（默认关；#144 落地后启用）
    const tier3Url = await tryTier3(song);
    if (tier3Url) return { url: tier3Url, nonFull: false };
    return { url: await api.getAudioUrl(song.url), nonFull: false };
  }
}
