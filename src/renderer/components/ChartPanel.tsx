import React, { useCallback, useMemo, useState } from 'react';
import { AlertCircle, Music2 } from 'lucide-react';
import SongRow from '@/renderer/components/SongRow';
import SongListSkeleton from '@/renderer/components/SongListSkeleton';
import { COL_INDEX_CHART } from '@/renderer/components/songTableColumns';
import type { ChartKind, Song } from '@mplayer/core';
import '@/renderer/styles/songlist.css';

/**
 * 列对齐上限：10 行 × 46px ≈ 一屏，两列等高的预览优先；
 * 超出的曲目走列底「查看全部 N 首」进榜单详情，不在本页铺 100 行。
 */
export const CHART_PREVIEW_ROWS = 10;

interface ChartPanelProps {
  /** 榜单名（core ToplistGroup.name 或通用兜底名）；不带来源前缀——来源已由页面级 segmented 选过 */
  title: string;
  chartId: ChartKind;
  /** 单源榜单曲目（#332：回归单元榜 + 源切换，不再有跨源聚合与折叠分组） */
  songs: Song[];
  loading: boolean;
  error: string | null;
  /** 数据落库时间（本地时戳），渲染「更新于 HH:mm」 */
  updatedAt?: number | null;
  /** 两列对齐后的渲染行数；缺省 = min(曲目数, CHART_PREVIEW_ROWS) */
  rows?: number;
  isPlaying?: boolean;
  favoriteIds?: string[];
  /** 点播契约（D2）：列表只回传歌曲、整榜队列与行下标，建队列与播放在调用方 */
  onPlay: (song: Song, queue: Song[], index: number, chartId: ChartKind) => void;
  isCurrentSong: (songId: string, sourceType?: string, chartId?: ChartKind) => boolean;
  onToggleFavorite?: (song: Song) => void;
  onDownload?: (song: Song) => void;
  onRetry?: () => void;
  /** 列底「查看全部 N 首」：跳对应榜单详情，不新增页面 */
  onViewAll?: () => void;
}

/** 「更新于 14:32」：榜单按小时级刷新，日期在这页没有信息量。 */
function formatUpdatedAt(ts?: number | null): string | null {
  if (!ts) return null;
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `更新于 ${hh}:${mm}`;
}

/**
 * 单源榜单面板（#332 选项 A / #694 双列预览）。
 * 行复用 SongRow 的资料库密度（46px、30px 封面、hover 才出现播放与「更多」），
 * 列本身不滚动——两列与页面共用一个外层 [data-scroll-container]。
 */
const ChartPanel: React.FC<ChartPanelProps> = ({
  title,
  chartId,
  songs,
  loading,
  error,
  updatedAt,
  rows,
  isPlaying = false,
  favoriteIds = [],
  onPlay,
  isCurrentSong,
  onToggleFavorite,
  onDownload,
  onRetry,
  onViewAll,
}) => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  // 无数据（加载/空榜）时按预览上限铺骨架，与最终形态等高
  const rowCount = rows ?? Math.min(songs.length || CHART_PREVIEW_ROWS, CHART_PREVIEW_ROWS);
  const visibleSongs = useMemo(() => songs.slice(0, rowCount), [songs, rowCount]);
  const hasHiddenSongs = songs.length > rowCount;
  const updatedLabel = formatUpdatedAt(updatedAt);

  const handleToggleDropdown = useCallback((songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown((prev) => (prev === songId ? null : songId));
  }, []);
  const handleCloseDropdown = useCallback(() => setActiveDropdown(null), []);
  /** 整榜入队：只有单曲会让「下一首」预取无曲可取（#332 实测换歌变慢） */
  const handlePlayRow = useCallback((song: Song, queue: Song[], index: number) => {
    onPlay(song, queue, index, chartId);
  }, [onPlay, chartId]);

  const heading = (
    <header className="chart__head">
      <h3 className="chart__title" id={`chart-${chartId}-title`}>{title}</h3>
      {updatedLabel && <span className="chart__updated">{updatedLabel}</span>}
    </header>
  );

  const panel = (body: React.ReactNode) => (
    <section className="chart" aria-labelledby={`chart-${chartId}-title`}>
      {heading}
      {body}
    </section>
  );

  if (loading) {
    // 骨架与最终形态等高：同一行数、同一密度（46px），不另写像素
    return panel(<SongListSkeleton rowCount={rowCount} density="library" indexWidth={COL_INDEX_CHART} />);
  }

  if (error) {
    return panel(
      <div className="chart__state chart__state--error">
        <AlertCircle size={22} className="chart__state-icon" />
        <div className="chart__state-text">{error}</div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="chart__retry">
            重试
          </button>
        )}
      </div>,
    );
  }

  if (songs.length === 0) {
    return panel(
      <div className="chart__state">
        <Music2 size={24} className="chart__state-icon" />
        <div>暂无排行榜数据</div>
      </div>,
    );
  }

  return panel(
    <div className="chart__list">
      {visibleSongs.map((song, index) => {
        const current = isCurrentSong(song.id, song.sourceType, chartId);
        return (
          <SongRow
            key={`${chartId}:${song.sourceType}:${song.id}`}
            song={song}
            index={index}
            showIndex
            variant="library"
            fillTitle
            showAlbum={false}
            indexWidth={COL_INDEX_CHART}
            isCurrentSong={current}
            isPlaying={isPlaying}
            isFavorite={favoriteSet.has(song.id)}
            moreOpen={activeDropdown === song.id}
            queue={songs}
            onPlay={handlePlayRow}
            onToggleFavorite={onToggleFavorite}
            onDownload={onDownload}
            onToggleDropdown={handleToggleDropdown}
            onCloseDropdown={handleCloseDropdown}
          />
        );
      })}
      {hasHiddenSongs && onViewAll && (
        <button type="button" className="chart__view-all" onClick={onViewAll}>
          查看全部 {songs.length} 首
        </button>
      )}
    </div>,
  );
};

export default ChartPanel;
