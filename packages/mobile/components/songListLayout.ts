import { spacing, textVariants } from '../theme/tokens';
import type { Song } from '@mplayer/core';

/**
 * 歌曲列表的**布局算术**（#411）—— 与渲染分离，不依赖 react-native。
 *
 * 分开的理由：`getItemLayout` 的算术出错在真机上的表现是「滚动位置错乱」，
 * 比渲染断言难查得多；而 `components/SongList.tsx` 一 import 就会把 react-native
 * 拖进单测环境。这里只做数字。
 */

/**
 * 行内容高度 = 纵向内距 ×2 + 封面高（与 `SongRow` 的样式逐项对应）。
 *
 * **不含**底部发丝线分隔线：它的宽度按屏幕密度是 0.33–0.5px，N 行累计误差只在
 * `scrollToIndex` 这类精确跳转上体现，而本模块不提供该能力（所有迁移过来的列表
 * 都是自由滚动）。省略它换来的是「这段算术可以被单测直接覆盖」。
 */
export const SONG_ROW_LAYOUT_HEIGHT = 10 * 2 + 44;
/** 分区头（iOS inset grouped：paddingVertical 12×2 + sectionHeader 行高）。 */
export const SECTION_HEADER_HEIGHT = 12 * 2 + textVariants.sectionHeader.lineHeight;
/** 搜索页组头（paddingTop 12 + paddingBottom 4 + subhead 行高）。 */
export const GROUP_HEADER_HEIGHT = spacing[3] + 4 + textVariants.subhead.lineHeight;
/** 搜索页静默组头（单源视图：源名用 footnote 档）。 */
export const GROUP_HEADER_QUIET_HEIGHT = spacing[3] + 4 + textVariants.footnote.lineHeight;

export type SongListRow =
  | {
      kind: 'sectionHeader';
      key: string;
      title: string;
      /** 右侧动作（播放历史的「清空」）。 */
      action?: { label: string; onPress: () => void; danger?: boolean };
    }
  | { kind: 'groupHeader'; key: string; title: string; subtitle?: string; note?: string; quiet?: boolean }
  | { kind: 'song'; key: string; song: Song; rank?: number; showSource?: boolean; queueSongs?: Song[] };

export function songListRowHeight(row: SongListRow): number {
  switch (row.kind) {
    case 'sectionHeader':
      return SECTION_HEADER_HEIGHT;
    case 'groupHeader':
      return row.quiet ? GROUP_HEADER_QUIET_HEIGHT : GROUP_HEADER_HEIGHT;
    case 'song':
      return SONG_ROW_LAYOUT_HEIGHT;
  }
}

/** 每行的偏移与高度 —— `getItemLayout` 的两组输入。 */
export function computeSongListLayout(rows: SongListRow[]): { offsets: number[]; lengths: number[] } {
  const offsets = new Array<number>(rows.length);
  const lengths = new Array<number>(rows.length);
  let acc = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const height = songListRowHeight(rows[i]);
    offsets[i] = acc;
    lengths[i] = height;
    acc += height;
  }
  return { offsets, lengths };
}
