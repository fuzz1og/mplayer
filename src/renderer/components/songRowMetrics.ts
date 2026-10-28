/**
 * 歌曲行密度协议（#699）：行高 / 封面的唯一事实源。普通/分组/可排序/拖拽预览/骨架/虚拟测量都取这里；
 * 组件只经 --song-row-* 下发，songlist.css 不再写 46 / 30 的 magic。
 * 行高就是布局：本仓没有 measureElement，estimateSize 与实际高度不符会静默压叠。
 */
export type SongListDensity = 'standard' | 'library';

/** 两种密度的行高（px）。 */
export const SONG_ROW_HEIGHTS: Record<SongListDensity, number> = {
  standard: 64,
  library: 46,
};

/** 两种密度的行封面边长（px）。 */
export const SONG_ROW_COVER_SIZES: Record<SongListDensity, number> = {
  standard: 44,
  library: 30,
};

/** 兼容旧调用点：standard 行高。 */
export const SONG_ROW_HEIGHT = SONG_ROW_HEIGHTS.standard;
/** 兼容旧调用点：资料库行高。 */
export const LIBRARY_ROW_HEIGHT = SONG_ROW_HEIGHTS.library;

/** 按密度取行高（虚拟测量与 CSS 变量共用）。 */
export const songRowHeight = (density: SongListDensity): number => SONG_ROW_HEIGHTS[density];

/** 按密度取封面边长。 */
export const songRowCoverSize = (density: SongListDensity): number => SONG_ROW_COVER_SIZES[density];
