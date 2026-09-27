import type { Album } from '@mplayer/core';

/**
 * 专辑时间线（#417 P0.1「查看全部专辑」入口的目标页）。
 *
 * 纯函数，不依赖 react-native —— 分组与展平是本页唯一有分支的逻辑，
 * 放在这里才能被 node 环境的 `packages/mobile/__tests__` 直接测（本仓 mobile 无 RN 渲染测试设施）。
 */

/** 网格列数：与页面 `numColumns` 和 `gridCardWidth({ cols })` 必须同源（#416 的纪律）。 */
export const ALBUM_TIMELINE_COLS = 3;

/** 没有可解析发行时间的专辑统一进这一组，且**恒定排在最后**。 */
export const UNKNOWN_YEAR = '未知年份';

export interface AlbumYearGroup {
  /** '2025' 或 {@link UNKNOWN_YEAR} */
  year: string;
  albums: Album[];
}

/** 专辑发行年份（`publishTime` 是 epoch ms 字符串，见 core `utils/publishTime`）；取不到给空串。 */
export function albumYear(album: Album): string {
  const t = Number(album.publishTime || 0);
  if (!Number.isFinite(t) || t <= 0) return '';
  const year = new Date(t).getFullYear();
  return Number.isFinite(year) && year > 1900 ? String(year) : '';
}

function timeOf(album: Album): number {
  const t = Number(album.publishTime || 0);
  return Number.isFinite(t) ? t : 0;
}

/**
 * 按发行年份分组：年份**降序**（新专辑在前），`未知年份` 恒在最后；组内按发行时间降序。
 * 同一首歌的年份口径与页面显示一致（都走 {@link albumYear}），不会出现「头写 2025、卡片写 2024」。
 */
export function groupAlbumsByYear(albums: Album[]): AlbumYearGroup[] {
  const buckets = new Map<string, Album[]>();
  for (const album of albums) {
    const key = albumYear(album) || UNKNOWN_YEAR;
    const list = buckets.get(key);
    if (list) list.push(album);
    else buckets.set(key, [album]);
  }
  return [...buckets.entries()]
    .map(([year, list]) => ({ year, albums: [...list].sort((a, b) => timeOf(b) - timeOf(a)) }))
    .sort((a, b) => {
      if (a.year === UNKNOWN_YEAR) return 1;
      if (b.year === UNKNOWN_YEAR) return -1;
      return Number(b.year) - Number(a.year);
    });
}

/** 时间线的一行：年份头，或一行 N 张专辑（供 FlatList 直接渲染，避免 SectionList 的分组跳版）。 */
export type AlbumTimelineItem =
  | { kind: 'year'; key: string; year: string; count: number }
  | { kind: 'row'; key: string; albums: Album[] };

/** 分组结果展平成 FlatList 数据：每年一个年份头 + 每 {@link ALBUM_TIMELINE_COLS} 张一行。 */
export function buildAlbumTimeline(albums: Album[], cols: number = ALBUM_TIMELINE_COLS): AlbumTimelineItem[] {
  const safeCols = Math.max(1, Math.floor(cols) || 1);
  const items: AlbumTimelineItem[] = [];
  for (const group of groupAlbumsByYear(albums)) {
    items.push({ kind: 'year', key: `year:${group.year}`, year: group.year, count: group.albums.length });
    for (let i = 0; i < group.albums.length; i += safeCols) {
      items.push({ kind: 'row', key: `row:${group.year}:${i}`, albums: group.albums.slice(i, i + safeCols) });
    }
  }
  return items;
}
