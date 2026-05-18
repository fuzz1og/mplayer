import React from 'react';
import { Play, Heart, MoreHorizontal, Download, Trash2, ListMusic } from 'lucide-react';
import type { Song } from '@/shared/types/song';
import { useCachedCover } from '@/renderer/services/coverCacheService';

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
  onToggleSelect?: (songId: string) => void;
  onToggleDropdown?: (songId: string, e: React.MouseEvent) => void;
  onCloseDropdown?: (e: React.MouseEvent) => void;
}

const SongRow: React.FC<SongRowProps> = ({
  song, index, isCurrentSong, isPlaying, isFavorite,
  showIndex, showCheckbox, isSelected, showRemoveFromPlaylist,
  activeDropdown, onPlay, onToggleFavorite, onDownload,
  onAddToPlaylist, onRemoveFromPlaylist, onToggleSelect,
  onToggleDropdown, onCloseDropdown,
}) => {
  const coverSrc = useCachedCover(song.cover);

  return (
    <div
      onDoubleClick={() => onPlay(song)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 16px',
        borderRadius: '6px',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        backgroundColor: isCurrentSong ? 'rgba(116, 185, 255, 0.1)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!isCurrentSong) {
          e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
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
            style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent-color)' }}
          />
        </div>
      )}
      {showIndex && (
        <div style={{ width: '50px', textAlign: 'center' }}>
          {isCurrentSong && isPlaying ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
              <span style={{ width: '3px', height: '12px', backgroundColor: 'var(--accent-color)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0s' }} />
              <span style={{ width: '3px', height: '16px', backgroundColor: 'var(--accent-color)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.1s' }} />
              <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--accent-color)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.2s' }} />
            </div>
          ) : (
            <span style={{ fontSize: '14px', color: isCurrentSong ? 'var(--accent-color)' : 'var(--text-tertiary)', fontWeight: isCurrentSong ? 600 : 400 }}>
              {index + 1}
            </span>
          )}
        </div>
      )}
      {/* Song info */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '4px', overflow: 'hidden', backgroundColor: 'var(--hover-bg)', flexShrink: 0, position: 'relative' }}>
          {song.cover ? (
            <img src={coverSrc} alt={song.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #E8E8E8 0%, #F0F0F0 100%)' }} />
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
          <div style={{ fontSize: '14px', fontWeight: isCurrentSong ? 600 : 400, color: isCurrentSong ? 'var(--accent-color)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {song.name}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.artist}</span>
            {song.sourceType === 'netease' && <span style={{ fontSize: '10px', padding: '2px 5px', borderRadius: '3px', backgroundColor: '#FF6B6B', color: 'white', flexShrink: 0 }}>网易云</span>}
            {song.sourceType === 'qq' && <span style={{ fontSize: '10px', padding: '2px 5px', borderRadius: '3px', backgroundColor: '#49B8FF', color: 'white', flexShrink: 0 }}>QQ</span>}
            {song.sourceType === 'kugou' && <span style={{ fontSize: '10px', padding: '2px 5px', borderRadius: '3px', backgroundColor: '#FF8C00', color: 'white', flexShrink: 0 }}>酷狗</span>}
            {song.sourceType === 'local' && <span style={{ fontSize: '10px', padding: '2px 5px', borderRadius: '3px', backgroundColor: '#00B894', color: 'white', flexShrink: 0 }}>本地</span>}
          </div>
        </div>
      </div>
      {/* Album */}
      <div style={{ width: '120px', fontSize: '13px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {song.album}
      </div>
      {/* Actions */}
      <div style={{ width: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
        {onToggleFavorite && (
          <button
            onClick={() => onToggleFavorite(song)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isFavorite ? 'var(--accent-color)' : 'var(--text-tertiary)', transition: 'all 0.15s ease' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--hover-bg)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}
        <div style={{ position: 'relative' }}>
          <button
            onClick={(e) => onToggleDropdown?.(song.id, e)}
            style={{ border: 'none', background: activeDropdown === song.id ? 'var(--hover-bg)' : 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: activeDropdown === song.id ? 'var(--text-secondary)' : 'var(--text-tertiary)', transition: 'all 0.15s ease' }}
          >
            <MoreHorizontal size={16} />
          </button>
          {activeDropdown === song.id && (
            <>
              <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={onCloseDropdown} />
              <div style={{ position: 'absolute', top: '100%', right: '0', marginTop: '4px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--divider-color)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)', zIndex: 100, minWidth: '120px', padding: '4px' }}>
                {showRemoveFromPlaylist && onRemoveFromPlaylist && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); onRemoveFromPlaylist(song); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '4px', fontSize: '13px', color: '#FF6B6B' }}>
                      <Trash2 size={14} /> 从歌单移除
                    </button>
                    <div style={{ height: '1px', backgroundColor: 'var(--divider-color)', margin: '4px 0' }} />
                  </>
                )}
                <button onClick={(e) => { e.stopPropagation(); onAddToPlaylist?.(song); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '4px', fontSize: '13px', color: 'var(--text-primary)' }}>
                  <ListMusic size={14} /> 加入歌单
                </button>
                <button onClick={(e) => { e.stopPropagation(); onDownload?.(song); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '4px', fontSize: '13px', color: 'var(--text-primary)' }}>
                  <Download size={14} /> 下载
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(SongRow, (prev, next) => {
  return (
    prev.song.id === next.song.id &&
    prev.isCurrentSong === next.isCurrentSong &&
    prev.isPlaying === next.isPlaying &&
    prev.isFavorite === next.isFavorite &&
    prev.isSelected === next.isSelected &&
    prev.activeDropdown === next.activeDropdown
  );
});
