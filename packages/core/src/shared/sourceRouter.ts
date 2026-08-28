import type { Song, SourceKey } from '../types/index.js';
import { isTrialUrlInfo } from './playability.js';
import type { UrlInfo } from './playability.js';
import { getPrefetchedUrl } from '../api/prefetchCache.js';

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
const TIER3_BUDGET_MS = 6_000;

// ── tier3 同歌去重（#172 评论：同歌并行重复解析）──────────────────────
//
// 前台播放解析与后台预取（prefetchNextSong）会并行解析同一首歌，各自独立
// 等满预算：后台 3s 已命中，前台还在等自己那条 6s 预算且中途不查缓存，
// 实测《我好想你》白等 ~10s。以歌曲身份为键共享同一条底层 resolver
// Promise：先到先得、后来者直接 join，第三方上游只被打一次。
//
// 键在**底层 Promise 结束**（含失败）后才移除——预算超时的调用方放弃等待
// 后，迟到的命中仍能被同键后续调用方（如 fresh 重试的 tier3 腿）接住。
const tier3Inflight = new Map<string, Promise<string>>();

/** 歌曲身份键：id 优先；无 id 的歌（热榜旧数据等）退回 名字+歌手。 */
function tier3InflightKey(song: Song): string {
  return song.id
    ? `${song.sourceType}|${song.id}`
    : `${song.sourceType}|name:${song.name}|${song.artist}`;
}

/** 共享的 tier3 解析：已有同键 in-flight 直接复用；否则调用 resolver 并登记。 */
function tier3ResolveShared(song: Song, reason: string): Promise<string> {
  const key = tier3InflightKey(song);
  const existing = tier3Inflight.get(key);
  if (existing) {
    console.info(`[tier3] 同歌解析进行中，复用同一条解析（${reason}）: 《${song.name}》${song.artist}`);
    return existing;
  }
  console.info(`[tier3] ${reason}，进入第三方解析源: 《${song.name}》${song.artist}`);
  const inflight = (async () => {
    try {
      return await tier3Resolver!(song);
    } catch (e) {
      console.warn(`[tier3] resolver 抛错: ${(e as Error)?.message || e}`);
      return '';
    } finally {
      tier3Inflight.delete(key);
    }
  })();
  tier3Inflight.set(key, inflight);
  return inflight;
}

/** 直连失败后的 tier3 尝试（默认关闭，未注入直接跳过）。reason 用于日志区分触发原因。
 *  带总预算：慢源（mgmp3 20s 超时）不阻塞播放——预算内未命中按未命中处理。
 *  同歌并发调用共享同一条底层解析（见 tier3ResolveShared），预算仍按各调用方独立计时。 */
async function tryTier3(song: Song, reason: string): Promise<string> {
  if (!tier3Enabled || !tier3Resolver) {
    console.info(`[tier3] ${reason}，但 tier3 未启用/未注入，直接回退: 《${song.name}》${song.artist}`);
    return '';
  }
  try {
    const url = await Promise.race([
      tier3ResolveShared(song, reason),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), TIER3_BUDGET_MS)),
    ]);
    return url?.startsWith('http') ? url : '';
  } catch (e) {
    console.warn(`[tier3] resolver 抛错: ${(e as Error)?.message || e}`);
    return '';
  }
}

/** 试听版也先试 tier3 拿完整版（用户决策：试听无意义，兜底可能拿完整）：
 *  命中返回完整版可播对象（nonFull=false）；未命中/未配置返回 null，
 *  调用方退回直连试听并标 nonFull。tier3 未配置时 tryTier3 零成本返回。 */
async function tryTier3Full(song: Song, reason: string): Promise<RoutedPlayable | null> {
  const tier3Url = await tryTier3(song, reason);
  return tier3Url ? { url: tier3Url, nonFull: false } : null;
}

/** 搜索结果被探测标记为 invalid 时，即使直连返回了 URL 也优先换 tier3；
 *  tier3 未命中（未启用/未注入/全源失败）则保留直连结果，由上层按现状处理。
 *  试听版（preview/试听段）的完整版 tier3 兜底不在此函数——调用方
 *  resolvePlayableSongRouted 判定试听后统一走 tryTier3Full（命中换完整版、
 *  未命中退回直连试听并标 nonFull）。 */
async function preferTier3WhenBad(song: Song, directUrl: string): Promise<string> {
  if (song.audioTag !== 'invalid') return directUrl;
  const reason = '直连 URL 已被探测标记为无效（audioTag=invalid）';
  const tier3Url = await tryTier3(song, reason);
  return tier3Url || directUrl;
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
  const route = decideRoute(source, (c) => !!c.search);
  if (route.kind === 'direct-unavailable') {
    const tier3Songs = await tryTier3Search(query, page, source);
    if (tier3Songs.length > 0) return tier3Songs;
    throw new Error('该源暂无直连实现');
  }
  try {
    const directSongs = await route.client.search!(query, page);
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
    const url = await route.client.resolvePlayableUrl!(song);
    if (url) {
      // 搜索结果已被探测标记为无效时，即使直连返回了 URL 也先试 tier3；
      // 没有配置 tier3 则保持原直连结果，由上层继续按现状报错/换元。
      return await preferTier3WhenBad(song, url);
    }
    // 直连返回空串（无版权/VIP）也进 tier3 兜底（默认关）；失败保持空串交换元层。
    const tier3Url = await tryTier3(song, '直连返回空串（无版权/VIP）');
    if (tier3Url) return tier3Url;
    return url;
  } catch (err) {
    if (route.mode === 'direct') throw err;
    // tier3 插槽：直连失败后的兜底（默认关；#144 落地后启用）；未命中 = 上抛（D2）。
    const tier3Url = await tryTier3(song, '直连解析失败');
    if (tier3Url) return tier3Url;
    throw err;
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
 * 直连失败且 tier3 未命中 = 上抛（D2 语义）。
 */
export async function resolvePlayableSongRouted(song: Song): Promise<RoutedPlayable> {
  // 预取缓存命中（探测阶段已解析并验证过的直链，30min TTL）→ 0 等待直接播，
  // 绝不等待预取队列；未命中才实时走完整解析链。
  // 命中且 nonFull（试听版）→ 也走 tier3 兜底尝试拿完整版（用户决策：试听无意义，
  // 兜底可能拿完整；tier3 未配置/未命中则退回缓存直连试听）。
  const prefetched = getPrefetchedUrl(song);
  if (prefetched) {
    if (prefetched.nonFull) {
      const full = await tryTier3Full(song, `预取缓存命中但为试听版（nonFull），尝试 tier3 拿完整版`);
      if (full) return full;
    }
    return prefetched;
  }

  // 能力门含 resolveUrlInfo（UrlInfo 自带 url，仅有 UrlInfo 也可直连解析）
  const route = decideRoute(song.sourceType, (c) => !!c.resolvePlayableUrl || !!c.resolveUrlInfo);
  if (route.kind === 'direct-unavailable') throw new Error('该源暂无直连实现');
  try {
    const client = route.client;
    if (client.resolveUrlInfo) {
      const info = await client.resolveUrlInfo(song);
      if (info) {
        if (info.url) {
          // 搜索结果已被探测标记为无效时，优先用 tier3 换一个可播 URL；
          // tier3 未命中则保留直连结果并按其权威字段判定试听版。
          const url = await preferTier3WhenBad(song, info.url);
          const trial = isTrialUrlInfo(info, song.duration) || song.audioTag === 'preview';
          // 试听版也走 tier3 兜底尝试拿完整版（用户决策：试听无意义，兜底可能
          // 拿到完整版；tier3 未命中才退回直连试听）——tier3 拿到则 nonFull=false。
          if (trial && url === info.url) {
            const full = await tryTier3Full(song, `直连为试听版（nonFull），尝试 tier3 拿完整版`);
            if (full) return full;
          }
          return {
            url,
            nonFull: trial && url === info.url,
          };
        }
        // UrlInfo 存在但 url 为空（无版权/VIP）→ tier3 兜底（默认关）。
        const tier3Url = await tryTier3(song, '直连 UrlInfo 无 url（无版权/VIP）');
        if (tier3Url) return { url: tier3Url, nonFull: false };
        return { url: '', nonFull: false };
      }
    }
    const url = await client.resolvePlayableUrl!(song);
    if (url) {
      // 搜索结果已被探测标记为无效时，优先用 tier3 换一个可播 URL。
      const u = await preferTier3WhenBad(song, url);
      // 搜索结果已被探测标为试听版（audioTag=preview，如酷我 VIP 歌的 M500 试听）：
      // 试听也走 tier3 兜底尝试拿完整版（tier3 未命中才退回直连试听）。
      if (song.audioTag === 'preview' && u === url) {
        const full = await tryTier3Full(song, `直连为试听版（audioTag=preview），尝试 tier3 拿完整版`);
        if (full) return full;
      }
      return { url: u, nonFull: u === url && song.audioTag === 'preview' };
    }
    // 直连返回空串（无版权/VIP）→ tier3 兜底（默认关）；失败保持空串交换元层。
    const tier3Url = await tryTier3(song, '直连返回空串（无版权/VIP）');
    if (tier3Url) return { url: tier3Url, nonFull: false };
    return { url: '', nonFull: false };
  } catch (err) {
    if (route.mode === 'direct') throw err;
    // tier3 插槽：直连失败后的兜底（默认关；#144 落地后启用）；未命中 = 上抛（D2）。
    const tier3Url = await tryTier3(song, '直连解析失败');
    if (tier3Url) return { url: tier3Url, nonFull: false };
    throw err;
  }
}

/**
 * 直连-only 播放解析（搜索结果探测用，T12 预检）：
 * 只走直连客户端（resolveUrlInfo/resolvePlayableUrl），**无 tier3、无兜底**——
 * 探测语义 = 「直连可播性」：快（单请求）、不占用 tier3 上游配额、不被 mgmp3 等
 * 慢源（20s 超时）拖死整批探测。播放仍走 resolvePlayableSongRouted（含 tier3 兜底）。
 */
export async function resolvePlayableSongDirect(song: Song): Promise<RoutedPlayable> {
  const route = decideRoute(song.sourceType, (c) => !!c.resolvePlayableUrl || !!c.resolveUrlInfo);
  if (route.kind !== 'direct') return { url: '', nonFull: false };
  try {
    const client = route.client;
    if (client.resolveUrlInfo) {
      const info = await client.resolveUrlInfo(song);
      if (info?.url) {
        return { url: info.url, nonFull: isTrialUrlInfo(info, song.duration) || song.audioTag === 'preview' };
      }
      return { url: '', nonFull: false };
    }
    const url = await client.resolvePlayableUrl!(song);
    return { url: url || '', nonFull: !!url && song.audioTag === 'preview' };
  } catch {
    return { url: '', nonFull: false };
  }
}

