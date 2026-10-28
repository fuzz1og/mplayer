import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Download, Heart, ListMusic, MoreHorizontal } from 'lucide-react';
import { SOURCE_DISPLAY_NAMES, applyShuffleOrder, type PlayMode } from '@mplayer/core';
import LyricsDisplay from '@/renderer/components/LyricsDisplay';
import PlayerControls from '@/renderer/components/PlayerControls';
import PlayerVolume from '@/renderer/components/PlayerVolume';
import AddToPlaylistModal from '@/renderer/components/AddToPlaylistModal';
import SongCover from '@/renderer/components/SongCover';
import { IpcClient } from '@/renderer/services/IpcClient';
import { Button, Menu, Segmented } from '@/renderer/ui';
import type { MenuItem } from '@/renderer/ui';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useThemeMode } from '@/renderer/theme/ThemeManager';
import { useDownload } from '@/renderer/hooks/useDownload';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { usePlaybackDuration, usePlaybackPosition } from '@/renderer/services/playbackClock';
import '@/renderer/styles/player.css';

interface LyricsPageProps {
  onBack: () => void;
}

type StageView = 'lyrics' | 'queue' | 'detail';

/** 主进程 cover:getAccent 返回的主色（HSL，hue 0-359、saturation/lightness 0-1）。 */
interface CoverAccent {
  hue: number;
  saturation: number;
  lightness: number;
}

/** IPC 返回不可信：只接受形状完整且数值有限的 HSL 三件套，否则当作取色失败。 */
function isCoverAccent(value: unknown): value is CoverAccent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CoverAccent>;
  return (
    typeof candidate.hue === 'number' &&
    Number.isFinite(candidate.hue) &&
    typeof candidate.saturation === 'number' &&
    Number.isFinite(candidate.saturation) &&
    typeof candidate.lightness === 'number' &&
    Number.isFinite(candidate.lightness)
  );
}

/**
 * 封面主色 → 主题约束后的环境光变量（原型评审 §9）：色相取封面，
 * 浅色主题压到 L62 / A0.18，暗色保持 L26 / A0.55，避免暗色发灰或浅色过艳。
 */
export function ambientGlowStyle(accent: CoverAccent | null, isDark: boolean): CSSProperties {
  if (!accent) return {};
  const hue = Math.round(accent.hue);
  const lightness = isDark ? 26 : 62;
  const alpha = isDark ? 0.55 : 0.18;
  return {
    '--np-glow-a': `hsl(${hue} 42% ${lightness}% / ${alpha})`,
    '--np-glow-b': `hsl(${hue} 42% ${lightness + (isDark ? 4 : 3)}% / ${Number((alpha - 0.04).toFixed(2))})`,
  } as CSSProperties;
}

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

  const { isDark } = useThemeMode();
  const [view, setView] = useState<StageView>('lyrics');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [coverAccent, setCoverAccent] = useState<CoverAccent | null>(null);
  const coverAccentRef = useRef<CoverAccent | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

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

  // 环境光取色（#688）：封面变化时让主进程读真实像素算主色；失败/无封面保持空样式，
  // CSS 的 var(--np-glow-*, transparent) 会让环境光自然退回纯色底。
  useEffect(() => {
    const cover = currentSong?.cover;
    if (!cover) {
      if (coverAccentRef.current !== null) {
        coverAccentRef.current = null;
        setCoverAccent(null);
      }
      return;
    }
    // 换歌先撤掉上一首的颜色，避免新封面取色期间还挂着旧主色。
    if (coverAccentRef.current !== null) {
      coverAccentRef.current = null;
      setCoverAccent(null);
    }
    let cancelled = false;
    void (async () => {
      try {
        const accent = await IpcClient.invoke<CoverAccent | null>('cover:getAccent', cover);
        if (cancelled) return;
        const next = isCoverAccent(accent) ? accent : null;
        // 取色失败/结果非法时若本来就是空样式，不触发无意义的重渲染。
        if (next === null && coverAccentRef.current === null) return;
        coverAccentRef.current = next;
        setCoverAccent(next);
      } catch {
        // 无 preload/桥不可用/主进程异常：静默回落纯色底。
        if (cancelled || coverAccentRef.current === null) return;
        coverAccentRef.current = null;
        setCoverAccent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentSong?.cover]);

  const ambientStyle = useMemo(() => ambientGlowStyle(coverAccent, isDark), [coverAccent, isDark]);

  /** 队列显示顺序与队列页一致：随机模式下就是随机序（#511）。 */
  const displayQueue = useMemo(
    () => (playMode === '随机播放' ? applyShuffleOrder(currentPlaylist, shuffle) : currentPlaylist),
    [playMode, currentPlaylist, shuffle],
  );

  if (!currentSong) {
    return (
      <div className="lyrics-page" data-now-playing>
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
  // 音质只认 playback 回写的 audioTag：无标记（普通）不冒充「无损」(#688 评审)。
  const qualityLabel = currentSong.audioTag === 'preview'
    ? '试听版'
    : currentSong.audioTag === 'invalid'
      ? '不可播'
      : '标准';

  const detailRows: Array<{ label: string; value: string }> = [
    { label: '歌名', value: currentSong.name },
    { label: '歌手', value: currentSong.artist || '—' },
    { label: '专辑', value: currentSong.album || '—' },
    { label: '来源', value: SOURCE_DISPLAY_NAMES[currentSong.sourceType] ?? currentSong.sourceType },
    { label: '时长', value: formatClock(totalDuration) },
    { label: '音质', value: qualityLabel },
  ];

  const lyricsMenuItems: MenuItem[] = [
    {
      key: 'favorite',
      label: fav ? '取消收藏' : '收藏',
      icon: <Heart size={14} fill={fav ? 'currentColor' : 'none'} />,
      pressed: fav,
      onSelect: () => void toggleFavorite(currentSong),
    },
    {
      key: 'playlist',
      label: '加入歌单',
      icon: <ListMusic size={14} />,
      onSelect: () => setShowAddToPlaylist(true),
    },
    {
      key: 'download',
      label: '下载',
      icon: <Download size={14} />,
      onSelect: () => void download(currentSong),
    },
  ];

  return (
    <div className="lyrics-page" data-now-playing data-view={view}>
      <div className="lyrics-page__ambient" style={ambientStyle} aria-hidden="true" />

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

          <div className="lyrics-page__title-row">
            <h1 className="lyrics-page__title">{currentSong.name}</h1>
            <div className="lyrics-page__more">
              <button
                ref={menuTriggerRef}
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="更多操作"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="lyrics-page__icon-btn"
              >
                <MoreHorizontal size={18} />
              </button>
              <Menu
                open={menuOpen}
                anchorRef={menuTriggerRef}
                items={lyricsMenuItems}
                onClose={() => setMenuOpen(false)}
                ariaLabel="更多操作"
                placement="bottom-end"
                minWidth={160}
              />
            </div>
          </div>
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
        <span className="lyrics-page__quality">自动混音 · {qualityLabel}</span>
        <div className="lyrics-page__footer-view">
          <Segmented
            ariaLabel="播放视图"
            options={VIEW_OPTIONS}
            value={LABEL_BY_VIEW[view]}
            onChange={(label) => {
              const next = VIEW_BY_LABEL[label];
              if (next) setView(next);
            }}
          />
        </div>
        <div className="lyrics-page__footer-end">
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
