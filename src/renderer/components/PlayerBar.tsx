import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, Download, Mic, ListMusic, MoreHorizontal, ListEnd } from 'lucide-react';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import AddToPlaylistModal from '@/renderer/components/AddToPlaylistModal';
import SongCover from '@/renderer/components/SongCover';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { useDownload } from '@/renderer/hooks/useDownload';
import PlayerControls from './PlayerControls';
import PlayerProgress from './PlayerProgress';
import PlayerVolume from './PlayerVolume';

interface PlayerBarProps {
  className?: string;
  onCoverClick?: () => void;
  /** 队列入口；缺省用 hash 跳转（不依赖 Router，便于单测） */
  onQueueClick?: () => void;
}

/**
 * 播放栏（原型）：左 封面/标题/艺术家/红心；中 控件 + 进度；右 歌词/队列/更多/音量。
 * 「加入歌单」与「下载」收进更多菜单，保持原型右区只有一枚更多按钮。
 */
const PlayerBar: React.FC<PlayerBarProps> = ({ className, onCoverClick, onQueueClick }) => {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const volume = usePlayerStore((s) => s.volume);
  const playMode = usePlayerStore((s) => s.playMode);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setPlayMode = usePlayerStore((s) => s.setPlayMode);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);

  const fav = useFavoriteStore((s) => (currentSong ? s.favoriteIds.includes(currentSong.id) : false));
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const { download } = useDownload();

  const handlePlayPause = useCallback(() => {
    if (!currentSong) return;
    if (isPlaying) pause();
    else resume();
  }, [currentSong, isPlaying, pause, resume]);

  const handleVolumeChange = useCallback((vol: number) => setVolume(vol), [setVolume]);

  const handleDownload = useCallback(() => {
    if (currentSong) download(currentSong);
  }, [currentSong, download]);

  const handleQueue = useCallback(() => {
    if (onQueueClick) onQueueClick();
    else window.location.hash = '#/queue';
  }, [onQueueClick]);

  const handleCoverError = useCallback(() => {
    if (!currentSong) return;
    void refreshSongCover(currentSong).then((cover) => {
      if (!cover) return;
      usePlayerStore.setState((state) =>
        state.currentSong?.id === currentSong.id ? { currentSong: { ...state.currentSong, cover } } : state
      );
    });
  }, [currentSong]);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [moreOpen]);

  return (
    <div className={className ? `player-bar ${className}` : 'player-bar'}>
      {/* 左 - 封面 / 标题 / 艺术家 / 收藏 */}
      <div className="player-bar__now-playing">
        <button
          onClick={onCoverClick}
          aria-label="查看歌词"
          className={onCoverClick ? 'player-bar__cover player-bar__cover--clickable' : 'player-bar__cover'}
        >
          <SongCover
            src={currentSong?.cover}
            alt={currentSong?.name || ''}
            variant="icon"
            iconSize={20}
            onError={handleCoverError}
          />
        </button>

        <div className="player-bar__meta">
          <div className="player-bar__title-row">
            {isPlaying && currentSong && (
              <span className="player-bar__equalizer" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            )}
            <span className="player-bar__title">{currentSong?.name || '未播放'}</span>
            <button
              onClick={() => currentSong && toggleFavorite(currentSong)}
              disabled={!currentSong}
              aria-label={fav ? '取消收藏' : '收藏'}
              aria-pressed={fav}
              className="player-btn player-bar__favorite"
            >
              <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div className="player-bar__artist">
            {currentSong ? currentSong.artist : '—'}
          </div>
        </div>
      </div>

      {/* 中 - 控件 + 进度 */}
      <div className="player-bar__center">
        <PlayerControls
          isPlaying={isPlaying}
          loading={isLoading}
          hasCurrentSong={!!currentSong}
          playMode={playMode}
          onPlayPause={handlePlayPause}
          onPrev={playPrevious}
          onNext={playNext}
          onModeChange={setPlayMode}
        />
        <PlayerProgress hasCurrentSong={!!currentSong} onSeek={seek} />
      </div>

      {/* 右 - 歌词 / 队列 / 更多 / 音量 */}
      <div className="player-bar__actions">
        <button onClick={onCoverClick} disabled={!currentSong} aria-label="歌词" className="player-btn">
          <Mic size={16} />
        </button>
        <button onClick={handleQueue} aria-label="队列" className="player-btn">
          <ListEnd size={16} />
        </button>
        <div className="player-bar__more" ref={moreRef}>
          <button
            onClick={() => setMoreOpen((open) => !open)}
            aria-label="更多操作"
            aria-expanded={moreOpen}
            className="player-btn"
          >
            <MoreHorizontal size={16} />
          </button>
          {moreOpen && (
            <div className="player-bar__more-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="player-bar__more-item"
                onClick={() => { setMoreOpen(false); setShowAddToPlaylist(true); }}
              >
                <ListMusic size={14} />
                加入歌单
              </button>
              <button
                type="button"
                role="menuitem"
                className="player-bar__more-item"
                disabled={!currentSong}
                onClick={() => { setMoreOpen(false); handleDownload(); }}
              >
                <Download size={14} />
                下载
              </button>
            </div>
          )}
        </div>

        <PlayerVolume volume={volume} onVolumeChange={handleVolumeChange} onToggleMute={() => setVolume(volume === 0 ? 80 : 0)} />
      </div>

      {currentSong && (
        <AddToPlaylistModal
          song={currentSong}
          isVisible={showAddToPlaylist}
          onClose={() => setShowAddToPlaylist(false)}
        />
      )}
    </div>
  );
};

export default PlayerBar;
