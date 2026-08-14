import type { Song, SourceKey } from '../types/index.js';

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

export interface DirectSourceClient {
  key: SourceKey;
  /** 源站搜索（直连）。未实现则不提供。 */
  search?: (keyword: string, page: number) => Promise<Song[]>;
  /** 播放 URL 直连解析；无版权/VIP 返回 ''（交给换元层）。 */
  resolvePlayableUrl?: (song: Song) => Promise<string>;
  /** 权威完整时长验证字段（T12 预检使用；按源覆盖，可不提供）。 */
  resolveUrlInfo?: (song: Song) => Promise<{
    url: string;
    br: number;
    size: number;
    playTime: number;
    fee: number;
    payed: number;
  } | null>;
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
  const mode = getSourceMode(source);
  const client = getDirectClient(source);

  if (mode === 'api' || !client?.search) {
    if (mode === 'direct' && !client?.search) {
      throw new Error('该源暂无直连实现');
    }
    return api.searchSongs(query, page, source);
  }

  try {
    return await client.search(query, page);
  } catch (err) {
    if (mode === 'direct') throw err;
    return api.searchSongs(query, page, source);
  }
}

/**
 * 模式感知播放 URL 解析（请求层回退链的 URL 腿）。
 * 直连返回空串（无版权/VIP）= 原样上抛，由换元层处理，不静默回退 api。
 */
export async function resolvePlayableUrlRouted(song: Song): Promise<string> {
  const api = requireLegs();
  const mode = getSourceMode(song.sourceType);
  const client = getDirectClient(song.sourceType);

  if (mode === 'api' || !client?.resolvePlayableUrl) {
    if (mode === 'direct' && !client?.resolvePlayableUrl) {
      throw new Error('该源暂无直连实现');
    }
    return api.getAudioUrl(song.url);
  }

  try {
    return await client.resolvePlayableUrl(song);
  } catch (err) {
    if (mode === 'direct') throw err;
    return api.getAudioUrl(song.url);
  }
}
