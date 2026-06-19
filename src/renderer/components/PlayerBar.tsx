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
  // 使用选择器拆分订阅，避免 position 每 250ms 变化导致整个 PlayerBar 重渲染
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

  const handlePlayPause = useCallback(() => {
    if (!currentSong) return;
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  }, [currentSong, isPlaying, pause, resume]);

  const handleVolumeChange = useCallback((vol: number) => {
    setVolume(vol);
  }, [setVolume]);

  return (
    <div
      className={className}
      style={{
        height: '80px',
        backgroundColor: 'var(--player-bar-bg)',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: '24px',
      }}
    >
      {/* 左侧 - 歌曲信息 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          width: '240px',
          minWidth: '240px',
        }}
      >
        {/* 封面 */}
        <div
          onClick={onCoverClick}
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '6px',
            overflow: 'hidden',
            backgroundColor: 'var(--hover-bg)',
            flexShrink: 0,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            cursor: onCoverClick ? 'pointer' : 'default',
          }}
        >
          {currentSong?.cover ? (
            <img
              src={coverSrc}
              alt={currentSong.name}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, var(--border-color) 0%, var(--divider-color) 100%)',
              }}
            >
              <ListMusic size={24} color="var(--text-tertiary)" />
            </div>
          )}
        </div>

        {/* 歌曲信息 */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: '14px',
              fontWeight: 500,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentSong?.name || '未播放'}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: '2px',
            }}
          >
            {currentSong?.artist || '-'}
          </div>
        </div>

        {/* 收藏按钮 */}
        <button
          onClick={() => currentSong && toggleFavorite(currentSong)}
          disabled={!currentSong}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: currentSong ? 'pointer' : 'not-allowed',
            padding: '6px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: currentSong && isFavorite(currentSong.id) ? 'var(--accent-color)' : 'var(--text-tertiary)',
            transition: 'all 0.15s ease',
            opacity: currentSong ? 1 : 0.5,
          }}
          onMouseEnter={(e) => {
            if (currentSong) {
              e.currentTarget.style.color = 'var(--accent-color)';
              e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = currentSong && isFavorite(currentSong.id) ? 'var(--accent-color)' : 'var(--text-tertiary)';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <Heart size={18} fill={currentSong && isFavorite(currentSong.id) ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* 中间 - 播放控制 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
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
