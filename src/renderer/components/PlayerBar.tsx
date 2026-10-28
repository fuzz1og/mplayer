import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, Download, ListMusic, MoreHorizontal, ListEnd } from 'lucide-react';
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
 * 播放栏（1.9.0 收口）：三列 grid（左右 1fr、中间 auto），播放键对准窗口中心。
 * 左 封面/标题/艺术家/收藏；中 控件 + 进度；右 队列/更多/音量（歌词入口由封面承担，已删重复按钮）。
 * 「加入歌单」与「下载」收进更多菜单；菜单支持 ESC / 方向键 / 焦点归还。
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
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
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

  const closeMore = useCallback((returnFocus = false) => {
    setMoreOpen(false);
    if (returnFocus) moreTriggerRef.current?.focus();
  }, []);

  // 更多菜单：ESC / 点击外部关闭；打开时焦点进第一项，ESC 关闭后归还触发按钮。
  useEffect(() => {
    if (!moreOpen) return;
    moreMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMore(true);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen, closeMore]);

  const handleMoreMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // 禁用项不参与方向键导航（ARIA 菜单惯例）
    const items = Array.from(moreMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

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
              <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div className="player-bar__artist">
            {currentSong ? currentSong.artist : '—'}
          </div>
        </div>
      </div>

      {/* 中 - 控件 + 进度（网格 auto 列居中，播放键即窗口中心） */}
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

      {/* 右 - 队列 / 更多 / 音量 */}
      <div className="player-bar__actions">
        <button onClick={handleQueue} aria-label="队列" className="player-btn">
          <ListEnd size={16} />
        </button>
        <div className="player-bar__more" ref={moreRef}>
          <button
            ref={moreTriggerRef}
            onClick={() => setMoreOpen((open) => !open)}
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            className="player-btn"
          >
            <MoreHorizontal size={16} />
          </button>
          {moreOpen && (
            <div ref={moreMenuRef} className="player-bar__more-menu" role="menu" aria-label="更多操作" onKeyDown={handleMoreMenuKeyDown}>
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
                onClick={() => { setMoreOpen(false); handleDownload(); moreTriggerRef.current?.focus(); }}
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
