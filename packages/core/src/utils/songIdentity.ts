import type { Song } from '../types/index.js';
import { outermostSourceIdPrefix, stripSourceIdPrefix } from './sourceIdPrefix.js';

/**
 * 歌曲身份（ADR-0012）：音乐源 + 去源前缀的真实 ID 的规范化键。
 *
 * 仓库里同一首歌有两种 id 形态：直连搜索产出裸 ID（`123`），单曲换源后写成
 * `${sourceType}:${rawId}`（`kuwo:456`，旧数据可能多层嵌套 `kuwo:kugou:123`）。
 * 缓存键、可播性标记与去重一律走本模块的派生键；`Song.id` 字段与持久化存量不动。
 *
 * 键 = `${source}:${rawId}`：
 * - `rawId` = stripSourceIdPrefix(id)：多层前缀循环剥离（`kuwo:kugou:123` → `123`）；
 * - `source` = id 的**最外层源前缀**优先（`kuwo:kugou:123` → `kuwo`）——换源写入时
 *   id 前缀才是当前源的事实来源；id 无前缀时退回入参 sourceType；
 * - sourceType 也缺失时退回空串命名空间（`identityKeyFrom(undefined, '123')` →
 *   `':123'`）："无源"自成一类，不与任何带源的同一 rawId 相等。
 *
 * 不变量：同一 rawId 不同源必不相等（`netease:123` ≠ `qq:123`）；等价 id 收敛为
 * 同一键（sourceType=netease 的裸 `123` 与 `netease:123` 同为 `netease:123`）。
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
