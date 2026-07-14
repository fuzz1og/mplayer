import React, { useCallback } from 'react';
const { ipcRenderer } = window.require('electron');
import { ListMusic, Heart, Download, Mic } from 'lucide-react';
import { message } from 'antd';
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
    if (isPlaying) pause(); else resume();
  }, [currentSong, isPlaying, pause, resume]);

  const handleVolumeChange = useCallback((vol: number) => {
    setVolume(vol);
  }, [setVolume]);

  const handleDownload = useCallback(() => {
    if (currentSong) {
      ipcRenderer.invoke('download:start', currentSong).catch(() => message.error('下载失败'));
    }
  }, [currentSong]);

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
      {/* 左侧 - 封面 + 歌曲信息 */}
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
            {currentSong ? `${currentSong.artist}` : '—'}
          </div>
        </div>
      </div>

      {/* 中间 - 控制按钮 + 进度条 */}
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

      {/* 右侧 - 功能按钮 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}
      >
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

        {/* 歌词按钮 */}
        <button
          onClick={onCoverClick}
          disabled={!currentSong}
          aria-label="歌词"
          className="player-btn"
          style={{ opacity: currentSong ? 1 : 0.3 }}
        >
          <Mic size={16} />
        </button>

        {/* 下载按钮 */}
        <button
          onClick={handleDownload}
          disabled={!currentSong}
          aria-label="下载"
          className="player-btn"
          style={{ opacity: currentSong ? 1 : 0.3 }}
        >
          <Download size={16} />
        </button>

        {/* 音量控制 */}
        <PlayerVolume
          volume={volume}
          onVolumeChange={handleVolumeChange}
          onToggleMute={() => setVolume(volume === 0 ? 80 : 0)}
        />
      </div>
    </div>
  );
};

export default PlayerBar;
