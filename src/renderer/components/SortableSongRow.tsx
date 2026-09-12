import React, { useCallback, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SongRow from '@/renderer/components/SongRow';

/** SongRow 的能力全透传；菜单开关、拖拽句柄与位移动画由本组件接管 */
export type SortableSongRowProps = Omit<
  React.ComponentProps<typeof SongRow>,
  'moreOpen' | 'onToggleDropdown' | 'onCloseDropdown' | 'rowRef' | 'dragHandle' | 'style'
>;

/**
 * 可拖拽排序的歌曲行 = 唯一行实现（SongRow）的薄包装：
 * 用 @dnd-kit 的 useSortable 接上拖拽句柄与位移样式，菜单开合收在本行内部，
 * 于是队列页 / 本地歌单页不再各自维护一份行布局。
 */
const SortableSongRow: React.FC<SortableSongRowProps> = ({ song, ...rowProps }) => {
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

  // 拖拽中的位移/半透明覆盖在行根节点上；拖拽背景只在拖拽时覆盖，避免抹掉「正在播放」高亮
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || undefined,
    opacity: isDragging ? 0.7 : 1,
    ...(isDragging ? { backgroundColor: 'var(--bg-hover)' } : {}),
  };

  return (
    <SongRow
      {...rowProps}
      song={song}
      rowRef={setNodeRef}
      dragHandle={dragHandle}
      moreOpen={moreOpen}
      onToggleDropdown={handleToggleDropdown}
      onCloseDropdown={handleCloseDropdown}
      style={dragStyle}
    />
  );
};

export default React.memo(SortableSongRow);
