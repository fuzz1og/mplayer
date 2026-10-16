import type { musicApi, DirectSourceClient, SourceKey, ContentMethod } from '@mplayer/core';
import { CONTENT_METHODS } from '@mplayer/core';

/**
 * music 域 IPC 单通道分发契约（ADR-0001）。
 * 桌面渲染↔主进程的 music 域收成一条 `musicApi:call`（方法名 + 参数）通道。
 * 本文件只供类型与名字使用，不依赖 main / renderer。
 */

/**
 * 基础方法清单（core `musicApi` 门面上的活方法，#279 收缩后全集）。
 */
export const BASE_METHODS = [
  'prefetchPlayableSong',
  'forgetPrefetchedSong',
  'getLyrics',
  'getQqPlaylistSongs',
  'getSodaAudioUrl',
  'getSodaLyrics',
  'getNeteaseLyrics',
  'parseSodaShareLink',
  'searchSongsRouted',
  'resolvePlayableUrlRouted',
  'resolvePlayableSongRouted',
  'explainPlaybackFailure',
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
 * - `getSodaPlayableUrl`：下载汽水音频到磁盘缓存并回放 file:// 直链（main.ts 扩展）
 * - `resolvePlaylistLink`：歌单分享短链跟随 302 返回落地 URL（playlistLinkResolver）
 */
export interface MainOnlyMethods {
  getSodaPlayableUrl(trackId: string): Promise<string>;
  resolvePlaylistLink(url: string): Promise<string>;
}

/**
 * 完整 method → 签名映射（ADR-0001）。
 * 基础方法 `Pick<typeof musicApi, ...>` 保证 core 加方法时 IPC 一个签名不用碰；
 * 内容方法自客户端接口派生（ContentMethodMap）。
 */
export type MusicApiMethodMap = Pick<typeof musicApi, BaseMethod> & ContentMethodMap & MainOnlyMethods;
