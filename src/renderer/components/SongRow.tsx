import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Trash2, ListMusic, RefreshCw, User } from 'lucide-react';
import type { Song } from '@mplayer/core';
import SourceBadge from '@/renderer/components/SourceBadge';
import AudioTagBadge from '@/renderer/components/AudioTagBadge';
import SourceSwapModal from '@/renderer/components/SourceSwapModal';
import { type RowActionItem } from '@/renderer/components/RowActionMenu';
import RowActionButtons from '@/renderer/components/RowActionButtons';
import { useSongSwap } from '@/renderer/hooks/useSongSwap';
import { useSearchStore } from '@/renderer/store/searchStore';
import { searchService } from '@/renderer/services/searchService';

interface SongRowProps {
  song: Song;
  index: number;
  isCurrentSong: boolean;
  isPlaying: boolean;
  isFavorite: boolean;
  showIndex: boolean;
  showCheckbox: boolean;
  isSelected: boolean;
  showRemoveFromPlaylist: boolean;
  activeDropdown: string | null;
  onPlay: (song: Song) => void;
  onToggleFavorite?: (song: Song) => void;
  onDownload?: (song: Song) => void;
  onAddToPlaylist?: (song: Song) => void;
  onRemoveFromPlaylist?: (song: Song) => void;
  /** 换源成功回调：父组件用它更新自己的列表 state（收藏/歌单页同时持久化） */
  onSwap?: (original: Song, swapped: Song) => void;
  onToggleSelect?: (songId: string) => void;
  onToggleDropdown?: (songId: string, e: React.MouseEvent) => void;
  onCloseDropdown?: (e: React.MouseEvent) => void;
  /** 封面加载失败时回调，由持有歌曲列表的层按 ID 重识别换新封面 */
  onCoverError?: (song: Song) => void;
  /** 是否显示专辑列（列表层按整列是否有专辑判断，无专辑列表整列塌缩） */
  showAlbum?: boolean;
  compact?: boolean;
  style?: React.CSSProperties;
}

const SongRow: React.FC<SongRowProps> = ({
  song, index, isCurrentSong, isPlaying, isFavorite,
  showIndex, showCheckbox, isSelected, showRemoveFromPlaylist,
  activeDropdown, onPlay, onToggleFavorite, onDownload,
  onAddToPlaylist, onRemoveFromPlaylist, onToggleSelect,
  onToggleDropdown, onCloseDropdown, onCoverError, onSwap, showAlbum = true, compact = false, style,
}) => {
  // 封面直链直渲：加载失败显示占位并走既有搜索式刷新（封面链已删，#273）
  const [coverFailed, setCoverFailed] = useState(false);
  const dropdownTriggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  // 空封面挂载触发一次（StrictMode 下 effect 双跑，用 ref 防重复）
  const coverRefreshFired = useRef(false);

  const swap = useSongSwap(song, onSwap);

  /** 查看歌手：以歌手名为关键词搜索并落在歌手 tab（与移动端一致） */
  const handleViewArtist = () => {
    if (!song.artist) return;
    useSearchStore.getState().setPreferredTab('artists');
    void searchService.search(song.artist);
    navigate('/discover');
  };

  // 操作统一收进「更多」菜单；本地文件不提供换源（spec 范围外）
  const menuItems: RowActionItem[] = [];
  if (showRemoveFromPlaylist && onRemoveFromPlaylist) {
    menuItems.push({ key: 'remove', label: '从歌单移除', icon: <Trash2 size={14} />, danger: true, onClick: () => onRemoveFromPlaylist(song) });
  }
  menuItems.push({ key: 'playlist', label: '加入歌单', icon: <ListMusic size={14} />, onClick: () => onAddToPlaylist?.(song) });
  if (song.sourceType !== 'local') {
    menuItems.push({ key: 'swap', label: '换源完整版', ariaLabel: '换源完整版', icon: <RefreshCw size={14} />, onClick: swap.open });
  }
  if (song.artist) {
    menuItems.push({ key: 'artist', label: '查看歌手', ariaLabel: '查看歌手', icon: <User size={14} />, onClick: handleViewArtist });
  }

  // cover 为空（如收藏/历史里从未存过封面）时挂载即触发一次刷新，显示层不依赖 onError
  useEffect(() => {
    if (!song.cover && !coverRefreshFired.current) {
      coverRefreshFired.current = true;
      onCoverError?.(song);
    }
    // 仅挂载时触发：封面刷新后 song.cover 变化会自然进入正常渲染路径
  }, []);

  // 封面刷新换新 URL 后重置失败态，否则新封面永远不会显示
  useEffect(() => {
    setCoverFailed(false);
  }, [song.cover]);

  return (
    <div
      className="song-row"
      onDoubleClick={() => onPlay(song)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: compact ? '8px 12px' : '10px 16px',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        backgroundColor: isCurrentSong ? 'rgba(47, 95, 208, 0.10)' : 'transparent',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!isCurrentSong) {
          e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isCurrentSong) {
          e.currentTarget.style.backgroundColor = 'transparent';
        }
      }}
    >
      {showCheckbox && (
        <div style={{ width: '40px', textAlign: 'center' }}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect?.(song.id); }}
            style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent)' }}
          />
        </div>
      )}
      {showIndex && (
        <div style={{ width: '50px', textAlign: 'center' }}>
          {isCurrentSong && isPlaying ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
              <span style={{ width: '3px', height: '12px', backgroundColor: 'var(--accent)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0s' }} />
              <span style={{ width: '3px', height: '16px', backgroundColor: 'var(--accent)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.1s' }} />
              <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--accent)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.2s' }} />
            </div>
          ) : (
            <span style={{ fontSize: '14px', color: isCurrentSong ? 'var(--accent)' : 'var(--text-tertiary)', fontWeight: isCurrentSong ? 600 : 400 }}>
              {index + 1}
            </span>
          )}
        </div>
      )}
      {/* Song info */}
      <div style={{ width: '38%', maxWidth: '380px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div style={{ width: '44px', height: '44px', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0, position: 'relative' }}>
          {song.cover && !coverFailed ? (
            <img
              src={song.cover}
              alt={song.name}
              loading="lazy"
              onError={() => { setCoverFailed(true); onCoverError?.(song); }}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--border-default) 0%, var(--border-subtle) 100%)' }} />
          )}
          <div
            style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.15s ease' }}
            onClick={() => onPlay(song)}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
          >
            <Play size={16} color="white" fill="white" />
          </div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '15px', fontWeight: isCurrentSong ? 600 : 400, color: isCurrentSong ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {song.name}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.artist}</span>
            <SourceBadge sourceType={song.sourceType} />
            {song.audioTag === 'preview' && <AudioTagBadge tag="preview" />}
            {song.audioTag === 'invalid' && <AudioTagBadge tag="invalid" />}
          </div>
        </div>
      </div>
      {/* 弹性占位：把专辑列和操作列推到右侧，标题区限宽后剩余空间留白 */}
      <div style={{ flex: 1, minWidth: 0 }} />
      {/* Album */}
      {!compact && showAlbum && (
        <div style={{ width: '180px', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {song.album}
        </div>
      )}
      {/* Actions */}
      <RowActionButtons
        song={song}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        onDownload={onDownload}
        moreOpen={activeDropdown === song.id}
        moreTriggerRef={dropdownTriggerRef}
        onToggleMore={(e) => onToggleDropdown?.(song.id, e)}
        onCloseMore={onCloseDropdown ?? (() => {})}
        menuItems={menuItems}
      />
      <SourceSwapModal
        open={swap.visible}
        songName={song.name}
        currentSource={song.sourceType}
        candidates={swap.candidates}
        loading={swap.loading}
        success={swap.success}
        onSelectSource={swap.onSelectSource}
        onSelectCandidate={swap.onSelectCandidate}
        onBack={swap.onBack}
        onClose={swap.close}
      />
    </div>
  );
};

export default React.memo(SongRow);
