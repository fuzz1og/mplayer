import React from 'react';
import { Heart, Download, MoreHorizontal } from 'lucide-react';
import type { Song } from '@mplayer/core';
import RowActionMenu, { type RowActionItem } from '@/renderer/components/RowActionMenu';

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

const iconBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: '6px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-tertiary)',
  transition: 'all 0.15s ease',
};

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
  <div style={{ width: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flexShrink: 0 }}>
    {onDownload && (
      <button
        onClick={(e) => { e.stopPropagation(); onDownload(song); }}
        aria-label={`下载: ${song.name}`}
        style={iconBtn}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--hover-bg)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <Download size={16} />
      </button>
    )}
    {onToggleFavorite && (
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(song); }}
        aria-label={isFavorite ? `取消收藏: ${song.name}` : `收藏: ${song.name}`}
        style={{ ...iconBtn, color: isFavorite ? 'var(--accent-color)' : 'var(--text-tertiary)' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--hover-bg)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
    )}
    <div style={{ position: 'relative' }}>
      <button
        ref={moreTriggerRef}
        onClick={(e) => { e.stopPropagation(); onToggleMore(e); }}
        aria-label={`更多操作: ${song.name}`}
        style={{ ...iconBtn, color: moreOpen ? 'var(--text-secondary)' : 'var(--text-tertiary)', backgroundColor: moreOpen ? 'var(--hover-bg)' : 'transparent' }}
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
