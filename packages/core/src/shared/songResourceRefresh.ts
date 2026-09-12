import type { PlayableResource, Song } from '../types/index.js';
import { isLegacyDeadUrl } from '../utils/legacyUrl.js';
import { findExactMatch } from '../utils/songMatcher.js';

/**
 * 「取缓存 → 旧签名死链判定 → 精确匹配搜索 → 写缓存」纯编排（ADR-0012 决策 3）。
 *
 * 平台各自注入端口（照 shared/sourceSwap 的接缝风格）：
 * 桌面 = IPC 缓存/DB，移动端 = 进程内 cacheService；core 只保留规则本身，
 * 规则不再散落到每个列表页。
 *
 * 规则：
 * a. 缓存命中且 url 非旧签名死链 → 直接返回，不搜索；
 * b. 未命中/死链 → 调搜索，只有 findExactMatch 判定的精确匹配才采用；
 * c. 采用结果写缓存：url 非 http、旧签名死链、candidate.audioTag === 'invalid'
 *    一律不写；nonFull（audioTag=preview 或 candidate.nonFull）必须保留；
 * d. 没有精确匹配 / 无可用 url → 返回 null；
 * e. 失败打开：搜索抛错时返回 null，不抛给调用方。
 *
 * **接口不变量（调用方约定）**：返回 null 只表示"本轮没拿到可采用的新资源"，
 * 调用方**不得用 null 覆盖本地已有的有效 url**——搜索失败/未命中时保留旧值，
 * 下次刷新再试。写缓存/写回端口抛错只记日志，不影响已采用的结果返回
 * （缓存是加速器，不是事实源）。
 */
export interface SongResourceRefreshDeps {
  /** 读缓存端口（TTL 由各端缓存自身管控；未命中/无有效 url 返回 null）。 */
  readCache: (song: Song) => Promise<PlayableResource | null>;
  /** 写缓存端口：只有编排判定可采用的资源才会调用。 */
  writeCache: (song: Song, resource: PlayableResource) => Promise<void>;
  /** 严格搜索端口：返回候选（平台注入直连/tier3 路由搜索），精确匹配守卫在编排内。 */
  search: (song: Song) => Promise<Song[]>;
  /** 可选写回端口：匹配成功后把候选的其它字段（封面/歌词等）写回平台存储。 */
  writeBack?: (song: Song, matched: Song) => void | Promise<void>;
  /** 可选死链判定，默认 core isLegacyDeadUrl（已退役签名端点）。 */
  isDeadUrl?: (url: string) => boolean;
  /** 可选时钟（测试注入）。 */
  now?: () => number;
  /** 可选诊断钩子。 */
  log?: (level: 'info' | 'warn', message: string) => void;
}

/** 编排入口：返回可采用的资源值；null 的语义见上方接口不变量。 */
export async function refreshSongResource(
  song: Song,
  deps: SongResourceRefreshDeps,
): Promise<PlayableResource | null> {
  const isDead = deps.isDeadUrl ?? isLegacyDeadUrl;
  const now = deps.now ?? (() => Date.now());

  // a. 缓存命中且非死链 → 直接返回，不搜索
  const cached = await deps.readCache(song);
  if (cached?.url && !isDead(cached.url)) return cached;

  // b. 未命中/死链 → 严格搜索，仅采用精确匹配
  const target = { name: song.name, artist: song.artist };
  let candidates: Song[];
  try {
    candidates = await deps.search(song);
  } catch (e: any) {
    // e. 失败打开：搜索异常不抛给调用方（与移动端现状一致）
    deps.log?.('warn', `资源刷新搜索失败: 《${song.name}》${e?.message || e}`);
    return null;
  }
  const matched = findExactMatch(target, candidates) as Song | null;
  if (!matched) {
    deps.log?.('warn', `资源刷新未精确匹配: 《${song.name}》${song.artist}（候选${candidates.length}首）`);
    return null;
  }

  // c. 采用结果写缓存：非 http / 旧签名死链 / invalid 不写；nonFull 保留
  const url = matched.url || '';
  if (!url.startsWith('http') || isDead(url) || matched.audioTag === 'invalid') {
    deps.log?.('warn', `资源刷新候选不可用: 《${matched.name}》${matched.audioTag || 'no-url'}`);
    return null;
  }
  const resource: PlayableResource = {
    url,
    nonFull: matched.audioTag === 'preview' || matched.nonFull === true,
    ts: now(),
  };

  try {
    await deps.writeCache(song, resource);
  } catch (e: any) {
    deps.log?.('warn', `资源写缓存失败: 《${song.name}》${e?.message || e}`);
  }
  try {
    await deps.writeBack?.(song, matched);
  } catch (e: any) {
    deps.log?.('warn', `资源写回失败: 《${song.name}》${e?.message || e}`);
  }
  return resource;
}
