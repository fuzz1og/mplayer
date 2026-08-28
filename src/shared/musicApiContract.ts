import type { musicApi, DirectSourceClient, SourceKey, ContentMethod } from '@mplayer/core';
import { CONTENT_METHODS } from '@mplayer/core';
import type { AggregatedChartResult } from '@/shared/chart';

/**
 * music 域 IPC 单通道分发契约（ADR-0001）。
 *
 * 桌面渲染↔主进程的 music 域收成一条 `musicApi:call`（方法名 + 参数）通道。
 * 方法集 = **基础方法集 ∪ 内容方法集 ∪ 主进程独有**（#240 契约派生）：
 * - 基础方法：仍由 core `musicApi` 门面提供，`Pick<typeof musicApi, ...>` 零重复；
 * - 内容方法：自 core `DirectSourceClient` 接口派生（CONTENT_METHODS 清单），
 *   每方法 IPC 签名带 `source: SourceKey` 首参，主进程分发表按清单循环泛型分派到
 *   `getDirectClient(source)`（未实现源抛错）——双端签名零重复，加方法 =
 *   core 客户端加方法 + CONTENT_METHODS 加名字，其余自动。
 *
 * 本文件只供类型与名字使用，不依赖 main / renderer。
 */

/**
 * 基础方法清单（core `musicApi` 门面上的活方法，#279 收缩后全集）。
 * - QQ 榜单已迁 `qqDirectClient.getToplists`（#279，走内容方法集）；
 * 基础方法清单（core `musicApi` 门面上的活方法，#275 收缩后全集）。
 * - QQ 榜单两方法暂留门面（QQ 内容迁移在后续票，#278 仅迁网易/酷狗）；
 * - `getQqPlaylistSongs`（#280 歌单导入原生化，musicApi 层方法不进能力面）；
 * - `getLyricsBySongId` 已随歌词内聚删除（#242）。
 */
export const BASE_METHODS = [
  'probeSongsBatch',
  'getLyrics',
  'getQqPlaylistSongs',
  'getSodaAudioUrl',
  'getSodaLyrics',
  'parseSodaShareLink',
  'searchSongsRouted',
  'resolvePlayableUrlRouted',
  'resolvePlayableSongRouted',
] as const;

export type BaseMethod = (typeof BASE_METHODS)[number];

/**
 * 全量方法名清单（唯一手写物 = BASE_METHODS + core 的 CONTENT_METHODS）。
 */
export const MUSIC_API_METHODS = [...BASE_METHODS, ...CONTENT_METHODS] as const;

export type MusicApiMethod = (typeof MUSIC_API_METHODS)[number];

/**
 * 内容方法契约映射：自 `DirectSourceClient` 接口派生，source 首参。
 * `callMusicApi('getToplists', 'netease')` 类型安全，签名与客户端实现零重复。
 */
export type ContentMethodMap = {
  [M in ContentMethod]: (
    source: SourceKey,
    ...args: Parameters<NonNullable<DirectSourceClient[M]>>
  ) => ReturnType<NonNullable<DirectSourceClient[M]>>;
};

/**
 * 主进程独有组合方法（不在 core `musicApi` 对象上）。
 * - `getAggregatedChart`：多源排行榜聚合（chartAggregator）
 * - `getSodaPlayableUrl`：下载汽水音频到磁盘缓存并回放 file:// 直链（main.ts 扩展）
 * - `resolvePlaylistLink`：歌单分享短链跟随 302 返回落地 URL（playlistLinkResolver）
 */
export interface MainOnlyMethods {
  getAggregatedChart(type: 'hot' | 'new', sources: string[]): Promise<AggregatedChartResult>;
  getSodaPlayableUrl(trackId: string): Promise<string>;
  resolvePlaylistLink(url: string): Promise<string>;
}

/**
 * 完整 method → 签名映射（ADR-0001）。
 * 基础方法 `Pick<typeof musicApi, ...>` 保证 core 加方法时 IPC 一个签名不用碰；
 * 内容方法自客户端接口派生（ContentMethodMap）。
 */
export type MusicApiMethodMap = Pick<typeof musicApi, BaseMethod> & ContentMethodMap & MainOnlyMethods;
