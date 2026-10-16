import type { Song } from '../types/index.js';
import { outermostSourceIdPrefix, stripSourceIdPrefix } from './sourceIdPrefix.js';

/**
 * 歌曲身份（ADR-0012）：音乐源 + 去源前缀的真实 ID 的规范化键。
 * 缓存键、可播性标记与去重一律走本模块的派生键；`Song.id` 字段与持久化存量不动。
 */
export function identityKeyFrom(
  sourceType: string | null | undefined,
  id: string | null | undefined,
): string {
  const raw = id ?? '';
  const prefix = outermostSourceIdPrefix(raw);
  const source = prefix ?? sourceType ?? '';
  return `${source}:${stripSourceIdPrefix(raw)}`;
}

/** 歌曲身份键（缓存键/可播性标记/去重的通用形态）。 */
export function identityKey(song: Pick<Song, 'id' | 'sourceType'>): string {
  return identityKeyFrom(song.sourceType, song.id);
}

/** 去源前缀的真实 ID（多层嵌套前缀循环剥离）。 */
export function rawSongId(id: string | null | undefined): string {
  return stripSourceIdPrefix(id ?? '');
}
