import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, Download, Heart, ListMusic, MoreHorizontal } from 'lucide-react';
import { SOURCE_DISPLAY_NAMES, applyShuffleOrder, type PlayMode } from '@mplayer/core';
import LyricsDisplay from '@/renderer/components/LyricsDisplay';
import PlayerControls from '@/renderer/components/PlayerControls';
import PlayerVolume from '@/renderer/components/PlayerVolume';
import AddToPlaylistModal from '@/renderer/components/AddToPlaylistModal';
import SongCover from '@/renderer/components/SongCover';
import { Button, Segmented } from '@/renderer/ui';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { usePlaybackDuration, usePlaybackPosition } from '@/renderer/services/playbackClock';
import '@/renderer/styles/player.css';

interface LyricsPageProps {
  onBack: () => void;
}

type StageView = 'lyrics' | 'queue' | 'detail';

/** 底栏分段控件的文案 → 视图（顺序即原型：歌词 / 队列 / 详情）。 */
const VIEW_OPTIONS = ['歌词', '队列', '详情'] as const;
const VIEW_BY_LABEL: Record<string, StageView> = {
  歌词: 'lyrics',
  队列: 'queue',
  详情: 'detail',
};
const LABEL_BY_VIEW: Record<StageView, string> = {
  lyrics: '歌词',
  queue: '队列',
  detail: '详情',
};

/** 原型的时间写法是 1:42 / 4:29：分钟不补零、秒补零（播放栏的 00:30 制式不适用于本页）。 */
function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 正在播放（1.9.0 签名帧，对齐 .proto/now-playing.png）：整窗 fixed overlay 盖住标题栏/侧栏/播放栏。
 * 顶栏收起+标题+「…」菜单 / 左列封面·信息·控件·进度 / 右列歌词（可切队列、详情）/ 底栏音质+分段+音量。
 */
const LyricsPage: React.FC<LyricsPageProps> = ({ onBack }) => {
  const lyrics = usePlayerStore((s) => s.lyrics);
  const lyricsLoading = usePlayerStore((s) => s.lyricsLoading);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const volume = usePlayerStore((s) => s.volume);
  const playMode = usePlayerStore((s) => s.playMode);
  const currentPlaylist = usePlayerStore((s) => s.currentPlaylist);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const seek = usePlayerStore((s) => s.seek);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setPlayMode = usePlayerStore((s) => s.setPlayMode);
  const play = usePlayerStore((s) => s.play);

  // 收藏态选**数据**（原生布尔）：选方法拿到的是稳定引用，favoriteIds 变化不触发重渲染（#620 同源）。
  const fav = useFavoriteStore((s) => (currentSong ? s.favoriteIds.includes(currentSong.id) : false));
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download } = useDownload();

  const [view, setView] = useState<StageView>('lyrics');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const position = usePlaybackPosition();
  const duration = usePlaybackDuration();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 菜单开着时 ESC 先收菜单，不把整层关掉
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      onBack();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack, menuOpen]);

  // 「…」菜单：点到外面就收起
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [menuOpen]);

  const handleLyricClick = useCallback((time: number) => seek(time), [seek]);

  // 封面加载失败 → 按 ID 重识别换新封面（上游签名过期后同一 URL 永远失败）
  const handleCoverError = useCallback(() => {
    if (!currentSong) return;
    void refreshSongCover(currentSong).then((cover) => {
      if (!cover) return;
      usePlayerStore.setState((state) =>
        state.currentSong?.id === currentSong.id ? { currentSong: { ...state.currentSong, cover } } : state
      );
    });
  }, [currentSong]);

  const handlePlayPause = useCallback(() => {
    if (!currentSong) return;
    if (isPlaying) pause();
    else resume();
  }, [currentSong, isPlaying, pause, resume]);

  const handleToggleMute = useCallback(() => {
    setVolume(volume === 0 ? 80 : 0);
  }, [setVolume, volume]);

  const handleMenuAction = useCallback((action: () => void) => {
    setMenuOpen(false);
    action();
  }, []);

  /**
   * 环境光取色：从封面 URL 的哈希推两种色相（不引 canvas、不碰跨域）。
   * 无封面时不设变量 → CSS 回退 transparent，视觉上就是纯色底。
   */
  const ambientStyle = useMemo<CSSProperties>(() => {
    const cover = currentSong?.cover;
    if (!cover) return {};
    let hash = 0;
    for (let i = 0; i < cover.length; i += 1) hash = (hash * 31 + cover.charCodeAt(i)) % 360;
    // 原型的环境光是封面取色的蓝紫：色相收在 200–290 之间，亮度压到适合暗舞台
    const hueA = 205 + (hash % 45);
    const hueB = 250 + ((hash * 7) % 35);
    return {
      '--np-glow-a': `hsl(${hueA} 55% 28% / 0.85)`,
      '--np-glow-b': `hsl(${hueB} 45% 22% / 0.7)`,
    } as CSSProperties;
  }, [currentSong?.cover]);

  /** 队列显示顺序与队列页一致：随机模式下就是随机序（#511）。 */
  const displayQueue = useMemo(
    () => (playMode === '随机播放' ? applyShuffleOrder(currentPlaylist, shuffle) : currentPlaylist),
    [playMode, currentPlaylist, shuffle],
  );

  if (!currentSong) {
    return (
      <div className="lyrics-page">
        <div className="lyrics-page__empty">
          <span className="lyrics-page__empty-text">暂无播放中的歌曲</span>
          <Button variant="primary" onClick={onBack}>
            返回
          </Button>
        </div>
      </div>
    );
  }

  const totalDuration = duration > 0 ? duration : currentSong.duration;
  const artistLine = currentSong.album
    ? `${currentSong.artist} · ${currentSong.album}`
    : currentSong.artist;

  const detailRows: Array<{ label: string; value: string }> = [
    { label: '歌名', value: currentSong.name },
    { label: '歌手', value: currentSong.artist || '—' },
    { label: '专辑', value: currentSong.album || '—' },
    { label: '来源', value: SOURCE_DISPLAY_NAMES[currentSong.sourceType] ?? currentSong.sourceType },
    { label: '时长', value: formatClock(totalDuration) },
    { label: '音质', value: currentSong.audioTag === 'preview' ? '试听版' : '无损' },
  ];

  return (
    <div className="lyrics-page" data-view={view}>
      <div className="lyrics-page__ambient" style={ambientStyle} aria-hidden="true" />

      {/* 顶栏 56：整条可拖窗（遮住房间按钮时仍能移动窗口），按钮自己 no-drag */}
      <header className="lyrics-page__topbar">
        <div className="lyrics-page__topbar-start">
          <button type="button" onClick={onBack} aria-label="收起播放器" className="lyrics-page__icon-btn">
            <ChevronDown size={18} />
          </button>
        </div>
        <div className="lyrics-page__topbar-title">正在播放</div>
        <div className="lyrics-page__topbar-end">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="更多操作"
            aria-expanded={menuOpen}
            className="lyrics-page__icon-btn"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

        {menuOpen && (
          <div ref={menuRef} className="lyrics-page__menu" role="menu">
            <button
              type="button"
              role="menuitem"
              aria-pressed={fav}
              className="lyrics-page__menu-item"
              onClick={() => handleMenuAction(() => void toggleFavorite(currentSong))}
            >
              <Heart size={14} fill={fav ? 'currentColor' : 'none'} />
              {fav ? '取消收藏' : '收藏'}
            </button>
            <button
              type="button"
              role="menuitem"
              className="lyrics-page__menu-item"
              onClick={() => handleMenuAction(() => setShowAddToPlaylist(true))}
            >
              <ListMusic size={14} />
              加入歌单
            </button>
            <button
              type="button"
              role="menuitem"
              className="lyrics-page__menu-item"
              onClick={() => handleMenuAction(() => void download(currentSong))}
            >
              <Download size={14} />
              下载
            </button>
          </div>
        )}
      </header>

      <div className="lyrics-page__body">
        <section className="lyrics-page__left">
          <div className="lyrics-page__cover">
            <SongCover
              src={currentSong.cover}
              alt={currentSong.name}
              variant="icon"
              iconSize={48}
              onError={handleCoverError}
            />
          </div>

          <h1 className="lyrics-page__title">{currentSong.name}</h1>
          <p className="lyrics-page__artist">{artistLine}</p>

          {/* 控件行复用播放栏那套（随机/上一/播放/下一/单曲循环），只在本页把它放大 */}
          <div className="lyrics-page__controls">
            <PlayerControls
              isPlaying={isPlaying}
              loading={isLoading}
              hasCurrentSong
              playMode={playMode}
              onPlayPause={handlePlayPause}
              onPrev={playPrevious}
              onNext={playNext}
              onModeChange={(mode: PlayMode) => setPlayMode(mode)}
            />
          </div>

          <ProgressBar position={position} duration={totalDuration} onSeek={seek} />
        </section>

        <section className="lyrics-page__panel">
          {view === 'lyrics' && (
            <div className="lyrics-page__lyrics">
              {lyricsLoading ? (
                <div className="lyrics-page__hint">歌词加载中…</div>
              ) : (
                /* 当前行由 LyricsDisplay 自己订阅 playbackClock：页面不随采样 tick 重渲染 */
                <LyricsDisplay lrcContent={lyrics || ''} onLyricClick={handleLyricClick} />
              )}
            </div>
          )}

          {view === 'queue' && (
            <div className="np-queue">
              {displayQueue.length === 0 ? (
                <div className="np-queue__empty">队列为空</div>
              ) : (
                <>
                  <div className="np-queue__head" aria-hidden="true">
                    <span>#</span>
                    <span />
                    <span>标题</span>
                    <span>时长</span>
                  </div>
                  {displayQueue.map((song, index) => {
                    const isCurrent = song.id === currentSong.id && song.sourceType === currentSong.sourceType;
                    return (
                      <button
                        key={`${song.sourceType}:${song.id}:${index}`}
                        type="button"
                        className="np-queue__row"
                        aria-current={isCurrent ? 'true' : undefined}
                        onClick={() => void play(song)}
                      >
                        <span className="np-queue__index">{index + 1}</span>
                        <span className="np-queue__cover">
                          <SongCover src={song.cover} variant="icon" iconSize={16} />
                        </span>
                        <span className="np-queue__main">
                          <span className="np-queue__name">{song.name}</span>
                          <span className="np-queue__artist">{song.artist}</span>
                        </span>
                        <span className="np-queue__time">{formatClock(song.duration)}</span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {view === 'detail' && (
            <div className="np-detail">
              {detailRows.map((row) => (
                <div key={row.label} className="np-detail__row">
                  <span className="np-detail__label">{row.label}</span>
                  <span className="np-detail__value">{row.value}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="lyrics-page__footer">
        <span className="lyrics-page__quality">自动混音 · 无损</span>
        <div className="lyrics-page__footer-end">
          <Segmented
            ariaLabel="播放视图"
            options={VIEW_OPTIONS}
            value={LABEL_BY_VIEW[view]}
            onChange={(label) => {
              const next = VIEW_BY_LABEL[label];
              if (next) setView(next);
            }}
          />
          <PlayerVolume volume={volume} onVolumeChange={setVolume} onToggleMute={handleToggleMute} />
        </div>
      </footer>

      {showAddToPlaylist && (
        <AddToPlaylistModal
          song={currentSong}
          isVisible
          onClose={() => setShowAddToPlaylist(false)}
        />
      )}
    </div>
  );
};

/**
 * 进度行：1:42 ──●──── 4:29 + 可拖动滑轨（指针捕获、点击定位、键盘 ±5s/Home/End）。
 * 位置的唯一消费者在这个叶子组件上——250ms 采样只重渲染它，不重渲染整页。
 */
const ProgressBar: React.FC<{
  position: number;
  duration: number;
  onSeek: (position: number) => void;
}> = React.memo(({ position, duration, onSeek }) => {
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);

  const shown = dragPosition ?? position;
  const percent = duration > 0 ? Math.min(100, Math.max(0, (shown / duration) * 100)) : 0;

  /** 视口 X → 目标位置（秒）；轨道未挂载或宽度为 0 时返回 null */
  const targetFromClientX = useCallback((clientX: number): number | null => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }, [duration]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || duration <= 0) return;
    e.preventDefault(); // 拖动时不要顺带选中文本
    suppressClickRef.current = false;
    // preventDefault 吞掉 mousedown 的默认聚焦，点击后键盘 seek 会失效 → 显式聚焦
    e.currentTarget.focus({ preventScroll: true });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom / 内核不支持：退化为只在轨道内拖动 */
    }
    draggingRef.current = true;
    setDragPosition(targetFromClientX(e.clientX) ?? 0);
  }, [duration, targetFromClientX]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const target = targetFromClientX(e.clientX);
    if (target === null) return;
    setDragPosition(target);
  }, [targetFromClientX]);

  const endDrag = useCallback((commit: boolean, clientX?: number) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const target = clientX === undefined ? null : targetFromClientX(clientX);
    setDragPosition(null);
    if (commit && target !== null) {
      suppressClickRef.current = true; // pointerup 之后浏览器补发的 click 不再重复 seek
      onSeek(target);
    }
  }, [onSeek, targetFromClientX]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    try {
      if (typeof el.hasPointerCapture === 'function' && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* 未成功捕获过 */
    }
    endDrag(true, e.clientX);
  }, [endDrag]);

  const handlePointerCancel = useCallback(() => endDrag(false), [endDrag]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (duration <= 0) return;
    const target = targetFromClientX(e.clientX);
    if (target !== null) onSeek(target);
  }, [duration, onSeek, targetFromClientX]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        onSeek(Math.min(position + 5, duration));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        onSeek(Math.max(position - 5, 0));
        break;
      case 'Home':
        e.preventDefault();
        onSeek(0);
        break;
      case 'End':
        e.preventDefault();
        onSeek(Math.max(0, duration - 1));
        break;
    }
  }, [duration, onSeek, position]);

  const classes = ['np-progress__track'];
  if (dragPosition !== null) classes.push('np-progress__track--dragging');

  return (
    <div className="np-progress">
      <span className="np-progress__time">{formatClock(shown)}</span>
      <div
        ref={trackRef}
        className={classes.join(' ')}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={duration || 100}
        aria-valuenow={Math.round(shown)}
        aria-disabled={duration <= 0 || undefined}
        tabIndex={duration > 0 ? 0 : -1}
        /* 自定义属性传填充比：除此之外本页不写内联样式 */
        style={{ '--np-progress': `${percent}%` } as CSSProperties}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
      >
        <div className="np-progress__rail">
          <div className="np-progress__fill" />
        </div>
        <div className="np-progress__thumb" />
      </div>
      <span className="np-progress__time">{formatClock(duration)}</span>
    </div>
  );
});

export default LyricsPage;
