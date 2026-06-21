import React, { useCallback } from 'react';
import { ListMusic, Heart } from 'lucide-react';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useCachedCover } from '@/renderer/services/coverCacheService';
import PlayerControls from './PlayerControls';
import PlayerProgress from './PlayerProgress';
import PlayerVolume from './PlayerVolume';

interface PlayerBarProps {
  className?: string;
  onCoverClick?: () => void;
}

const PlayerBar: React.FC<PlayerBarProps> = ({ className, onCoverClick }) => {
  const currentSong = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const volume = usePlayerStore(s => s.volume);
  const position = usePlayerStore(s => s.position);
  const duration = usePlayerStore(s => s.duration);
  const playMode = usePlayerStore(s => s.playMode);
  const pause = usePlayerStore(s => s.pause);
  const resume = usePlayerStore(s => s.resume);
  const seek = usePlayerStore(s => s.seek);
  const setVolume = usePlayerStore(s => s.setVolume);
  const setPlayMode = usePlayerStore(s => s.setPlayMode);
  const playNext = usePlayerStore(s => s.playNext);
  const playPrevious = usePlayerStore(s => s.playPrevious);

  const { isFavorite, toggleFavorite } = useFavoriteStore();
  const coverSrc = useCachedCover(currentSong?.cover ?? '');
  const fav = currentSong ? isFavorite(currentSong.id) : false;

  const handlePlayPause = useCallback(() => {
    if (!currentSong) return;
    isPlaying ? pause() : resume();
  }, [currentSong, isPlaying, pause, resume]);

  const handleVolumeChange = useCallback((vol: number) => {
    setVolume(vol);
  }, [setVolume]);

  return (
    <div
      className={className}
      style={{
        height: 'var(--player-height)',
        backgroundColor: 'var(--bg-player)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-6)',
        gap: 'var(--space-6)',
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* 左侧 - 歌曲信息 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          width: '240px',
          minWidth: '240px',
        }}
      >
        {/* 封面 */}
        <button
          onClick={onCoverClick}
          aria-label="查看歌词"
          style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
            backgroundColor: 'var(--skeleton-base)',
            flexShrink: 0,
            boxShadow: 'var(--shadow-md)',
            cursor: onCoverClick ? 'pointer' : 'default',
            border: 'none',
            padding: 0,
            position: 'relative',
          }}
        >
          {currentSong?.cover ? (
            <img
              src={coverSrc}
              alt={currentSong.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, var(--gray-100) 0%, var(--gray-200) 100%)',
              }}
            >
              <ListMusic size={20} color="var(--text-tertiary)" />
            </div>
          )}
        </button>

        {/* 歌曲信息 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-medium)',
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 'var(--leading-tight)',
            }}
          >
            {currentSong?.name || '未播放'}
          </div>
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: '2px',
            }}
          >
            {currentSong?.artist || '—'}
          </div>
        </div>

        {/* 收藏按钮 */}
        <button
          onClick={() => currentSong && toggleFavorite(currentSong)}
          disabled={!currentSong}
          aria-label={fav ? '取消收藏' : '收藏'}
          aria-pressed={fav}
          className="player-btn"
          style={{
            color: fav ? 'var(--accent)' : 'var(--text-tertiary)',
            opacity: currentSong ? 1 : 0.3,
          }}
        >
          <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* 中间 - 播放控制 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-1)',
          maxWidth: '500px',
        }}
      >
        <PlayerControls
          isPlaying={isPlaying}
          hasCurrentSong={!!currentSong}
          playMode={playMode}
          onPlayPause={handlePlayPause}
          onPrev={playPrevious}
          onNext={playNext}
          onModeChange={setPlayMode}
        />
        <PlayerProgress
          position={position}
          duration={duration}
          hasCurrentSong={!!currentSong}
          onSeek={seek}
        />
      </div>

      <PlayerVolume
        volume={volume}
        onVolumeChange={handleVolumeChange}
        onToggleMute={() => setVolume(volume === 0 ? 80 : 0)}
      />
    </div>
  );
};

export default PlayerBar;
