import type { CSSProperties } from 'react';

/**
 * 歌曲列表的**列宽契约**：表头、行、骨架屏三处渲染同一组列宽时的唯一事实来源。
 *
 * 以前这三处各自用内联样式写死同一组数字——五份渲染器 × 四列 = 20 处字面量，
 * 彼此只靠「抄同一份」保持一致。改一处漏一处就是静默错位：队列页表头曾写 60px
 * 而行的操作区是 90px，错 30px 且不报错。
 *
 * 行高早就有了具名常量（SONG_ROW_HEIGHT），列宽却没有——这个不对称正是 bug 面。
 * 这里不是「工具函数」，而是一份**契约**：换列宽改这里，加一列也改这里。
 */

/** 勾选列宽（表头 / 行 / 骨架屏共用） */
export const COL_CHECKBOX = 40;

/** 序号列宽；行在只挂拖拽句柄、不显示序号时收窄到 COL_INDEX_COMPACT */
export const COL_INDEX = 50;
export const COL_INDEX_COMPACT = 30;

/** 专辑列宽；行默认取此值，调用方可用 albumWidth 覆盖（如队列页 120） */
export const COL_ALBUM = 180;

/** 操作列宽；行尾操作区必须同为这个值，否则表头与行会错开半个列 */
export const COL_ACTIONS = 140;

/**
 * 列宽 → 固定宽度样式。表头 / 骨架屏 / 行共用，保证同一列在三处拿到同一个数字，
 * 而不是三份各写一次的数字。
 */
export function colStyle(px: number): CSSProperties {
  return { width: px + 'px', flexShrink: 0 };
}
