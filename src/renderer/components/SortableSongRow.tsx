import React, { useCallback, useMemo, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SongRow from '@/renderer/components/SongRow';
import type { Song } from '@mplayer/core';

/** SongRow 的能力全透传；菜单开关、拖拽句柄与位移动画由本组件接管 */
export type SortableSongRowProps = Omit<
  React.ComponentProps<typeof SongRow>,
  'moreOpen' | 'onToggleDropdown' | 'onCloseDropdown' | 'rowRef' | 'dragHandle' | 'style' | 'actions'
> & {
  /**
   * 行尾操作**用渲染函数而不是现成的元素**（#412）。
   *
   * `actions={<QueueRowActions song={song} .../>}` 这种写法每次父组件渲染都会新建一个
   * React 元素，`React.memo` 的浅比较永远不相等——于是「滚动/播放状态变化 → 整个队列
   * 每一行都重渲染」。换成渲染函数后引用稳定，元素只在本行自己重渲染时才建。
   */
  renderActions?: (song: Song, index: number) => React.ReactNode;
};

/**
 * 可拖拽排序的歌曲行 = 唯一行实现（SongRow）的薄包装：
 * 用 @dnd-kit 的 useSortable 接上拖拽句柄与位移样式，菜单开合收在本行内部，
 * 于是队列页 / 本地歌单页不再各自维护一份行布局。
 */
const SortableSongRow: React.FC<SortableSongRowProps> = ({ song, renderActions, ...rowProps }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id });
  const [moreOpen, setMoreOpen] = useState(false);

  const handleToggleDropdown = useCallback(() => setMoreOpen(v => !v), []);
  const handleCloseDropdown = useCallback(() => setMoreOpen(false), []);

  const dragHandle = (
    <span
      {...attributes}
      {...listeners}
      aria-label={`拖拽排序: ${song.name}`}
      title="拖拽排序"
      style={{ cursor: 'grab', display: 'flex', alignItems: 'center', color: 'var(--text-tertiary)' }}
    >
      <GripVertical size={14} />
    </span>
  );

  // 拖拽中的位移/半透明覆盖在行根节点上；拖拽背景只在拖拽时覆盖，避免抹掉「正在播放」高亮。
  // useMemo（#412）：这个对象是 SongRow 的 prop，每帧新建同样会把它的 memo 白白击穿。
  const dragStyle = useMemo<React.CSSProperties>(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition: transition || undefined,
      opacity: isDragging ? 0.7 : 1,
      ...(isDragging ? { backgroundColor: 'var(--bg-hover)' } : {}),
    }),
    [transform, transition, isDragging],
  );

  return (
    <SongRow
      {...rowProps}
      song={song}
      rowRef={setNodeRef}
      dragHandle={dragHandle}
      moreOpen={moreOpen}
      onToggleDropdown={handleToggleDropdown}
      onCloseDropdown={handleCloseDropdown}
      actions={renderActions?.(song, rowProps.index)}
      style={dragStyle}
    />
  );
};

export default React.memo(SortableSongRow);
