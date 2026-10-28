import type { CSSProperties } from 'react';

/**
 * 歌曲列表的**列宽 / 行高契约**：表头、行、骨架屏三处渲染同一组布局数值时的唯一事实来源。
 * 改一处漏一处就是静默错位：队列页表头曾写 60px 而行的操作区是 90px，错 30px 且不报错。
 * 这里不是「工具函数」，而是一份**契约**：换列宽 / 行高改这里，加一列也改这里。
 */

/** 勾选列宽（表头 / 行 / 骨架屏共用） */
export const COL_CHECKBOX = 40;

/** 序号列宽；行在只挂拖拽句柄、不显示序号时收窄到 COL_INDEX_COMPACT */
export const COL_INDEX = 50;
export const COL_INDEX_COMPACT = 30;
/** 资料库密度的序号列宽（原型：28px、右对齐）。 */
export const COL_INDEX_LIBRARY = 28;

/** 专辑列宽；行默认取此值，调用方可用 albumWidth 覆盖（如队列页 120） */
export const COL_ALBUM = 180;

/** 时长列宽；`showDuration` 打开时行与表头共用 */
export const COL_DURATION = 50;
/** 资料库密度的时长列宽（原型：44px）。 */
export const COL_DURATION_LIBRARY = 44;

/** 操作列宽；行尾操作区必须同为这个值，否则表头与行会错开半个列 */
export const COL_ACTIONS = 140;

/** 紧凑操作列宽：`compactActions` 只留单个 28px 圆形「更多」按钮（保留 56px 悬停位） */
export const COL_ACTIONS_COMPACT = 56;

/** 行高常量已收口到 songRowMetrics（#699）：这里只做兼容再导出，避免三处各写一份 magic。 */
export { SONG_ROW_HEIGHT, LIBRARY_ROW_HEIGHT, SONG_ROW_HEIGHTS, SONG_ROW_COVER_SIZES } from './songRowMetrics';
export type { SongListDensity } from './songRowMetrics';

/** 旧契约：固定宽度 + 禁止收缩。新代码用 colWidth() + CSS 变量（1.9.0）。 */
export function colStyle(px: number): CSSProperties {
  return { width: px + 'px', flexShrink: 0 };
}

/**
 * 列宽 → CSS 自定义属性。配合 CSS 的 width: var(--col-width) 使用：
 * 组件里只传一个变量，实际宽度仍由本文件的常量决定。
 */
export function colWidth(px: number): CSSProperties {
  return { '--col-width': px + 'px' } as CSSProperties;
}
