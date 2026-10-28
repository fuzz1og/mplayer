import React from 'react';
import { Heart, Download, MoreHorizontal } from 'lucide-react';
import type { Song } from '@mplayer/core';
import RowActionMenu, { type RowActionItem } from '@/renderer/components/RowActionMenu';
import { COL_ACTIONS, COL_ACTIONS_COMPACT, colWidth } from '@/renderer/components/songTableColumns';
import '@/renderer/styles/songlist.css';

interface RowActionButtonsProps {
  song: Song;
  isFavorite: boolean;
  onToggleFavorite?: (song: Song) => void;
  onDownload?: (song: Song) => void;
  moreOpen: boolean;
  moreTriggerRef: React.RefObject<HTMLButtonElement | null>;
  onToggleMore: (e: React.MouseEvent) => void;
  onCloseMore: () => void;
  menuItems: RowActionItem[];
  /**
   * 紧凑模式（资料库密度）：行尾只渲染一个 28px 圆形「更多」按钮；
   * 下载、收藏收进菜单，顺序为 下载 → 收藏 → 调用方 menuItems。
   */
  compact?: boolean;
}

/**
 * 歌曲行操作区（共享）：standard 为下载 + 收藏 + 更多 三图标常驻，宽度 140px；
 * compact 只有一个「更多」按钮（28px 圆形），低频动作全部进菜单。
 * SongRow 与本地歌单行 SortableSongRow 共用，操作列改动只需改这一处。
 */
const RowActionButtons: React.FC<RowActionButtonsProps> = ({
  song,
  isFavorite,
  onToggleFavorite,
  onDownload,
  moreOpen,
  moreTriggerRef,
  onToggleMore,
  onCloseMore,
  menuItems,
  compact = false,
}) => {
  const compactMenuItems: RowActionItem[] = compact
    ? [
        ...(onDownload
          ? [{
              key: 'download',
              label: '下载',
              ariaLabel: `下载: ${song.name}`,
              icon: <Download size={14} />,
              onClick: () => onDownload(song),
            }]
          : []),
        ...(onToggleFavorite
          ? [{
              key: 'favorite',
              label: isFavorite ? '取消收藏' : '收藏',
              ariaLabel: isFavorite ? `取消收藏: ${song.name}` : `收藏: ${song.name}`,
              icon: <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} />,
              onClick: () => onToggleFavorite(song),
            }]
          : []),
        ...menuItems,
      ]
    : menuItems;

  return (
    <div
      className={compact ? 'row-actions row-actions--compact' : 'row-actions'}
      style={colWidth(compact ? COL_ACTIONS_COMPACT : COL_ACTIONS)}
    >
      {!compact && onDownload && (
        <button
          onClick={(e) => { e.stopPropagation(); onDownload(song); }}
          aria-label={`下载: ${song.name}`}
          className="row-actions__btn"
        >
          <Download size={16} />
        </button>
      )}
      {!compact && onToggleFavorite && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(song); }}
          aria-label={isFavorite ? `取消收藏: ${song.name}` : `收藏: ${song.name}`}
          aria-pressed={isFavorite}
          className="row-actions__btn"
          data-active={isFavorite || undefined}
        >
          <Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      )}
      <div className="row-actions__more">
        <button
          ref={moreTriggerRef}
          onClick={(e) => { e.stopPropagation(); onToggleMore(e); }}
          aria-label={`更多操作: ${song.name}`}
          aria-haspopup="menu"
          aria-expanded={moreOpen ?? false}
          className="row-actions__btn row-actions__btn--more"
          data-open={moreOpen || undefined}
        >
          <MoreHorizontal size={16} />
        </button>
        {moreOpen && (
          <RowActionMenu
            triggerRef={moreTriggerRef}
            items={compactMenuItems}
            onClose={onCloseMore}
          />
        )}
      </div>
    </div>
  );
};

export default RowActionButtons;
