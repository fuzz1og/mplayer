import React from 'react';
import { Heart, Download, MoreHorizontal } from 'lucide-react';
import type { Song } from '@mplayer/core';
import RowActionMenu, { type RowActionItem } from '@/renderer/components/RowActionMenu';
import { COL_ACTIONS, colWidth } from '@/renderer/components/songTableColumns';
import '@/renderer/styles/songlist.css';

interface RowActionButtonsProps {
  song: Song;
  isFavorite: boolean;
  onToggleFavorite?: (song: Song) => void;
  onDownload?: (song: Song) => void;
  moreOpen: boolean;
  moreTriggerRef: React.RefObject<HTMLButtonElement | null>;
  onToggleMore: (e: React.MouseEvent) => void;
  onCloseMore: (e: React.MouseEvent) => void;
  menuItems: RowActionItem[];
}

/**
 * 歌曲行操作区（共享）：下载 + 收藏 + 更多 三图标常驻，宽度 140px。
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
}) => (
  <div className="row-actions" style={colWidth(COL_ACTIONS)}>
    {onDownload && (
      <button
        onClick={(e) => { e.stopPropagation(); onDownload(song); }}
        aria-label={`下载: ${song.name}`}
        className="row-actions__btn"
      >
        <Download size={16} />
      </button>
    )}
    {onToggleFavorite && (
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(song); }}
        aria-label={isFavorite ? `取消收藏: ${song.name}` : `收藏: ${song.name}`}
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
        className="row-actions__btn row-actions__btn--more"
        data-open={moreOpen || undefined}
      >
        <MoreHorizontal size={16} />
      </button>
      {moreOpen && (
        <RowActionMenu
          triggerRef={moreTriggerRef}
          items={menuItems}
          onClose={onCloseMore}
        />
      )}
    </div>
  </div>
);

export default RowActionButtons;
