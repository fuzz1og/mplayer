import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Volume1,
  VolumeX,
  ListMusic,
  Heart,
} from 'lucide-react';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import PlayModeButton from './PlayModeButton';

const formatTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

interface PlayerBarProps {
  className?: string;
  onCoverClick?: () => void;
}

const PlayerBar: React.FC<PlayerBarProps> = ({ className, onCoverClick }) => {
  const {
    currentSong,
    isPlaying,
    volume,
    position,
    duration,
    playMode,
    pause,
    resume,
    seek,
    setVolume,
    setPlayMode,
    playNext,
    playPrevious
  } = usePlayerStore();

  const { isFavorite, toggleFavorite } = useFavoriteStore();

  const handlePlayPause = () => {
    if (!currentSong) return;
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(e.target.value));
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    seek(Number(e.target.value));
  };

  const getVolumeIcon = () => {
    if (volume === 0) return <VolumeX size={20} />;
    if (volume < 50) return <Volume1 size={20} />;
    return <Volume2 size={20} />;
  };

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
              src={currentSong.cover}
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
                background: 'linear-gradient(135deg, #E8E8E8 0%, #F0F0F0 100%)',
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
        {/* 控制按钮 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          {/* 播放模式 */}
          <PlayModeButton
            mode={playMode}
            onModeChange={setPlayMode}
            size={18}
          />

          {/* 上一首 */}
          <button
            onClick={playPrevious}
            disabled={!currentSong}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: currentSong ? 'pointer' : 'not-allowed',
              padding: '8px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: currentSong ? 'var(--text-primary)' : 'var(--text-tertiary)',
              transition: 'all 0.15s ease',
              opacity: currentSong ? 1 : 0.5,
            }}
            onMouseEnter={(e) => {
              if (currentSong) {
                e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <SkipBack size={22} fill="currentColor" />
          </button>

          {/* 播放/暂停 */}
          <button
            onClick={handlePlayPause}
            disabled={!currentSong}
            style={{
              border: 'none',
              background: 'var(--primary-color)',
              cursor: currentSong ? 'pointer' : 'not-allowed',
              padding: '12px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              transition: 'all 0.15s ease',
              boxShadow: '0 2px 8px rgba(45, 52, 54, 0.3)',
              opacity: currentSong ? 1 : 0.5,
            }}
            onMouseEnter={(e) => {
              if (currentSong) {
                e.currentTarget.style.transform = 'scale(1.05)';
                e.currentTarget.style.background = 'var(--primary-hover)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.background = 'var(--primary-color)';
            }}
          >
            {isPlaying ? (
              <Pause size={24} fill="white" />
            ) : (
              <Play size={24} fill="white" style={{ marginLeft: '2px' }} />
            )}
          </button>

          {/* 下一首 */}
          <button
            onClick={playNext}
            disabled={!currentSong}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: currentSong ? 'pointer' : 'not-allowed',
              padding: '8px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: currentSong ? 'var(--text-primary)' : 'var(--text-tertiary)',
              transition: 'all 0.15s ease',
              opacity: currentSong ? 1 : 0.5,
            }}
            onMouseEnter={(e) => {
              if (currentSong) {
                e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <SkipForward size={22} fill="currentColor" />
          </button>
        </div>

        {/* 进度条 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              minWidth: '36px',
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatTime(position)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={position}
            onChange={handleProgressChange}
            disabled={!currentSong}
            style={{
              flex: 1,
              height: '4px',
              WebkitAppearance: 'none',
              appearance: 'none',
              background: `linear-gradient(to right, var(--accent-color) ${(position / (duration || 1)) * 100}%, var(--border-color) ${(position / (duration || 1)) * 100}%)`,
              borderRadius: '2px',
              outline: 'none',
              cursor: currentSong ? 'pointer' : 'not-allowed',
            }}
          />
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              minWidth: '36px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* 右侧 - 音量控制 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          width: '140px',
          minWidth: '140px',
          justifyContent: 'flex-end',
        }}
      >
        <button
          onClick={() => setVolume(volume === 0 ? 80 : 0)}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          {getVolumeIcon()}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={handleVolumeChange}
          style={{
            width: '80px',
            height: '4px',
            WebkitAppearance: 'none',
            appearance: 'none',
            background: `linear-gradient(to right, var(--text-secondary) ${volume}%, var(--border-color) ${volume}%)`,
            borderRadius: '2px',
            outline: 'none',
            cursor: 'pointer',
          }}
        />
      </div>
    </div>
  );
};

export default PlayerBar;
