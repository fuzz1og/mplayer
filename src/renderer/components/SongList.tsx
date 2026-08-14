import React, { useState, useCallback } from 'react';
import { Download, Trash2, ListMusic, Music2 } from 'lucide-react';
import type { Song } from '@mplayer/core';
import AddToPlaylistModal from './AddToPlaylistModal';
import { usePlayerStore } from '@/renderer/store/playerStore';
import BatchAddToPlaylistModal from './BatchAddToPlaylistModal';

const batchBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 16px',
  color: 'white',
  border: 'none',
  borderRadius: '20px',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};
import SongRow from './SongRow';
import SongListSkeleton from './SongListSkeleton';

interface SongListProps {
  songs: Song[];
  currentSongId?: string;
  isPlaying?: boolean;
  favoriteIds?: string[];
  onPlay: (song: Song) => void;
  onToggleFavorite?: (song: Song) => void;
  showHeader?: boolean;
  showIndex?: boolean;
  showCheckbox?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  emptyText?: string;
  loading?: boolean;
  enableBatchDownload?: boolean;
  onBatchDownload?: (songs: Song[]) => void;
  onDownload?: (song: Song) => void;
  enableBatchDelete?: boolean;
  onBatchDelete?: (songs: Song[]) => void;
  onAddToPlaylist?: (song: Song) => void;
  enableBatchAddToPlaylist?: boolean;
  onBatchAddToPlaylist?: (songs: Song[]) => void;
  showRemoveFromPlaylist?: boolean;
  onRemoveFromPlaylist?: (song: Song) => void;
  /** 换源成功回调：父组件用它更新自己的列表 state（收藏/歌单页同时持久化） */
  onSwap?: (original: Song, swapped: Song) => void;
  /** 封面加载失败时回调，由持有歌曲列表的层按 ID 重识别换新封面 */
  onCoverError?: (song: Song) => void;
}

const SongList: React.FC<SongListProps> = ({
  songs,
  currentSongId,
  isPlaying,
  favoriteIds = [],
  onPlay,
  onToggleFavorite,
  showHeader = true,
  showIndex = true,
  showCheckbox = false,
  selectedIds: externalSelectedIds,
  onSelectionChange: externalOnSelectionChange,
  emptyText = '暂无歌曲',
  loading = false,
  enableBatchDownload = false,
  onBatchDownload,
  onDownload,
  enableBatchDelete = false,
  onBatchDelete,
  onAddToPlaylist,
  enableBatchAddToPlaylist = false,
  onBatchAddToPlaylist,
  showRemoveFromPlaylist = false,
  onRemoveFromPlaylist,
  onSwap,
  onCoverError,
}) => {
  // 内部状态管理（当外部没有提供时）
  const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>([]);
  // 换源后的行替换覆盖：key 为旧 id，组件生命周期内生效，
  // 页面重新从存储加载（路由重挂载）后自然失效，避免旧行复活
  const [swapOverrides, setSwapOverrides] = useState<Map<string, Song>>(new Map());
  // 下拉菜单状态
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  // 加入歌单弹窗状态
  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState(false);
  const [selectedSongForPlaylist, setSelectedSongForPlaylist] = useState<Song | null>(null);
  // 批量加入歌单弹窗状态
  const [showBatchAddToPlaylistModal, setShowBatchAddToPlaylistModal] = useState(false);
  const [selectedSongsForPlaylist, setSelectedSongsForPlaylist] = useState<Song[]>([]);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);

  const displaySongs = songs.map(song => swapOverrides.get(song.id) ?? song);
  // 专辑列整列按需塌缩：列表内没有任何歌曲有专辑时不显示专辑列
  const hasAlbum = displaySongs.some(song => song.album);
  // 使用外部或内部状态
  const selectedIds = externalSelectedIds !== undefined ? externalSelectedIds : internalSelectedIds;
  const onSelectionChange = externalOnSelectionChange || setInternalSelectedIds;

  const handlePlaySong = (song: Song) => {
    const index = displaySongs.findIndex(s => s.id === song.id && s.sourceType === song.sourceType);
    setCurrentPlaylist(displaySongs, index >= 0 ? index : 0);
    onPlay(song);
  };

  const handleSwap = useCallback((original: Song, swapped: Song) => {
    setSwapOverrides(prev => {
      const next = new Map(prev);
      next.set(original.id, swapped);
      return next;
    });
    onSwap?.(original, swapped);
  }, [onSwap]);

  const handleToggleDropdown = useCallback((songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown(prev => prev === songId ? null : songId);
  }, []);

  const handleCloseDropdown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown(null);
  }, []);

  const handleAddToPlaylistClick = useCallback((song: Song, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedSongForPlaylist(song);
    setShowAddToPlaylistModal(true);
    setActiveDropdown(null);
  }, []);

  const handleToggleSelect = useCallback((songId: string) => {
    const current = selectedIds;
    if (current.includes(songId)) {
      onSelectionChange(current.filter(id => id !== songId));
    } else {
      onSelectionChange([...current, songId]);
    }
  }, [selectedIds, onSelectionChange]);

  const handleAddToPlaylistSuccess = useCallback(() => {
    if (onAddToPlaylist && selectedSongForPlaylist) {
      onAddToPlaylist(selectedSongForPlaylist);
    }
  }, [onAddToPlaylist, selectedSongForPlaylist]);

  const handleToggleSelectAll = () => {
    if (selectedIds.length === displaySongs.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(displaySongs.map(song => song.id));
    }
  };

  const handleBatchDownload = () => {
    if (!onBatchDownload || selectedIds.length === 0) return;
    const selectedSongs = displaySongs.filter(song => selectedIds.includes(song.id));
    onBatchDownload(selectedSongs);
    // 清空选择
    onSelectionChange([]);
  };

  const handleBatchDelete = () => {
    if (!onBatchDelete || selectedIds.length === 0) return;
    const selectedSongs = songs.filter(song => selectedIds.includes(song.id));
    onBatchDelete(selectedSongs);
    // 清空选择
    onSelectionChange([]);
  };

  const handleBatchAddToPlaylist = () => {
    if (!onBatchAddToPlaylist || selectedIds.length === 0) return;
    const selectedSongs = displaySongs.filter(song => selectedIds.includes(song.id));
    setSelectedSongsForPlaylist(selectedSongs);
    setShowBatchAddToPlaylistModal(true);
  };

  // 是否显示批量操作按钮栏
  const showBatchActionBar = (enableBatchDownload || enableBatchDelete || enableBatchAddToPlaylist) && selectedIds.length > 0;

  if (displaySongs.length === 0) {
    if (loading) {
      return <SongListSkeleton showCheckbox={showCheckbox} showIndex={showIndex} />;
    }
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 20px',
          color: 'var(--text-tertiary)',
        }}
      >
        <Music2 size={26} style={{ marginBottom: '12px', color: 'var(--text-tertiary)' }} />
        <div style={{ fontSize: 'var(--text-base)' }}>{emptyText}</div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      {/* 批量操作按钮栏 */}
      {(enableBatchDownload || enableBatchDelete || enableBatchAddToPlaylist) && (
        <div
          style={{
            height: showBatchActionBar ? '56px' : '0px',
            opacity: showBatchActionBar ? 1 : 0,
            overflow: 'hidden',
            marginBottom: showBatchActionBar ? '16px' : '0px',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              backgroundColor: 'var(--hover-bg)',
              borderRadius: 'var(--radius-md)',
              transform: showBatchActionBar ? 'translateY(0)' : 'translateY(-10px)',
              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>
              已选择 {selectedIds.length} 首歌曲
            </span>
            <div style={{ display: 'flex', gap: '12px' }}>
              {enableBatchDownload && (
                <button
                  onClick={handleBatchDownload}
                  style={{ ...batchBtnStyle, backgroundColor: 'var(--primary-color)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--primary-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--primary-color)'; }}
                >
                  <Download size={16} />
                  批量下载
                </button>
              )}
              {enableBatchAddToPlaylist && (
                <button
                  onClick={handleBatchAddToPlaylist}
                  style={{ ...batchBtnStyle, backgroundColor: 'var(--accent-color)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-color)'; }}
                >
                  <ListMusic size={16} />
                  批量加入歌单
                </button>
              )}
              {enableBatchDelete && (
                <button
                  onClick={handleBatchDelete}
                  style={{ ...batchBtnStyle, backgroundColor: 'var(--danger-color)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#EE5A6F'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FF6B6B'; }}
                >
                  <Trash2 size={16} />
                  批量删除
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 表头 */}
      {showHeader && (
        <div
          style={{
            position: 'sticky', top: 0, zIndex: 3,
            backgroundColor: 'var(--bg-base)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--divider-color)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-tertiary)',
            fontWeight: 500,
          }}
        >
          {showCheckbox && (
            <div style={{ width: '40px', textAlign: 'center' }}>
              <input
                type="checkbox"
                checked={displaySongs.length > 0 && selectedIds.length === displaySongs.length}
                onChange={handleToggleSelectAll}
                style={{
                  cursor: 'pointer',
                  width: '16px',
                  height: '16px',
                  accentColor: 'var(--accent-color)'
                }}
              />
            </div>
          )}
          {showIndex && (
            <div style={{ width: '50px', textAlign: 'center' }}>#</div>
          )}
          <div style={{ flex: 1 }}>标题</div>
          {hasAlbum && <div style={{ width: '180px' }}>专辑</div>}
          <div style={{ width: '140px', textAlign: 'center' }}>操作</div>
        </div>
      )}

      {/* 歌曲列表 */}
      <div>
        {displaySongs.map((song, index) => {
          const isCurrentSong = currentSongId === song.id;
          const isFavorite = favoriteIds.includes(song.id);

          return (
            <SongRow
              key={song.id}
              song={song}
              index={index}
              isCurrentSong={isCurrentSong}
              isPlaying={isPlaying ?? false}
              isFavorite={isFavorite}
              showIndex={showIndex}
              showCheckbox={showCheckbox}
              isSelected={selectedIds.includes(song.id)}
              showRemoveFromPlaylist={showRemoveFromPlaylist}
              showAlbum={hasAlbum}
              activeDropdown={activeDropdown}
              onPlay={handlePlaySong}
              onToggleFavorite={onToggleFavorite}
              onDownload={onDownload}
              onAddToPlaylist={handleAddToPlaylistClick}
              onRemoveFromPlaylist={onRemoveFromPlaylist}
              onSwap={handleSwap}
              onCoverError={onCoverError}
              onToggleSelect={handleToggleSelect}
              onToggleDropdown={handleToggleDropdown}
              onCloseDropdown={handleCloseDropdown}
            />
          );
        })}
      </div>

      {/* 加入歌单弹窗 */}
      {selectedSongForPlaylist && (
        <AddToPlaylistModal
          song={selectedSongForPlaylist}
          isVisible={showAddToPlaylistModal}
          onClose={() => {
            setShowAddToPlaylistModal(false);
            setSelectedSongForPlaylist(null);
          }}
          onSuccess={handleAddToPlaylistSuccess}
        />
      )}

      {/* 批量加入歌单弹窗 */}
      {selectedSongsForPlaylist.length > 0 && (
        <BatchAddToPlaylistModal
          songs={selectedSongsForPlaylist}
          isVisible={showBatchAddToPlaylistModal}
          onClose={() => {
            setShowBatchAddToPlaylistModal(false);
            setSelectedSongsForPlaylist([]);
            // 清空选择
            onSelectionChange([]);
          }}
          onSuccess={() => {
            if (onBatchAddToPlaylist) {
              onBatchAddToPlaylist(selectedSongsForPlaylist);
            }
          }}
        />
      )}
    </div>
  );
};

export default SongList;
