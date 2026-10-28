import React from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { Music2, AlertCircle, Play } from 'lucide-react';
import SongListSkeleton from '@/renderer/components/SongListSkeleton';
import AudioTagBadge from '@/renderer/components/AudioTagBadge';
import { usePlayerStore } from '@/renderer/store/playerStore';
import type { ChartKind, Song } from '@mplayer/core';
import '@/renderer/styles/songlist.css';

interface ChartPanelProps {
  title: string;
  chartId: ChartKind;
  /** 单源榜单曲目（ADR/decision #332：回归单元榜 + 源切换，不再有跨源聚合与折叠分组）。 */
  songs: Song[];
  loading: boolean;
  error: string | null;
  onPlay: (song: Song, chartId?: ChartKind) => void;
  isCurrentSong: (songId: string, sourceType?: string, chartId?: ChartKind) => boolean;
  onRetry?: () => void;
}

/**
 * 名次变化列（只有 QQ 提供 `old_count`）：
 * 文案 = `''`（该源不提供）/ `NEW`（新进榜）/ `—`（持平）/ `↑n` / `↓n`；
 * 配色沿用国内榜单惯例（红 = 名次前进，绿 = 后退）。`prevRank === null` = 新进榜。
 */
function rankDelta(prevRank: number | null | undefined, rank: number): { label: string; color: string } {
  if (prevRank === undefined) return { label: '', color: 'var(--text-tertiary)' };
  if (prevRank === null) return { label: 'NEW', color: 'var(--accent)' };
  const delta = prevRank - rank;
  if (delta === 0) return { label: '—', color: 'var(--text-tertiary)' };
  return delta > 0
    ? { label: `↑${delta}`, color: 'var(--danger)' }
    : { label: `↓${-delta}`, color: 'var(--success)' };
}

/**
 * 单源榜单面板（#332 选项 A）。
 * **可选列**：榜单元数据在各源之间并不齐备（实测：三源公共只有「名次」，「上期名次/在榜周数」只有 
 * QQ 提供）。
 */
const ChartPanel: React.FC<ChartPanelProps> = ({
  title,
  chartId,
  songs,
  loading,
  error,
  onPlay,
  isCurrentSong,
  onRetry,
}) => {
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const heading = (
    <h3 className="chart__title">{title}</h3>
  );

  if (loading) {
    return (
      <div className="chart__body">
        {heading}
        <SongListSkeleton rowCount={15} showIndex />
      </div>
    );
  }

  if (error) {
    return (
      <div className="chart__body">
        {heading}
        <div className="chart__state chart__state--error">
          <AlertCircle size={22} className="chart__state-icon" />
          <div className="chart__state-text">{error}</div>
          {onRetry && (
            <button onClick={onRetry} className="chart__retry">
              重试
            </button>
          )}
        </div>
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="chart__body">
        {heading}
        <div className="chart__state">
          <Music2 size={24} className="chart__state-icon" />
          <div>暂无排行榜数据</div>
        </div>
      </div>
    );
  }

  /** 该榜单是否提供「上期名次」（只有 QQ 有：old_count）。任一曲目有即显示该列。 */
  const hasPrevRank = songs.some((s) => s.rankMeta?.prevRank !== undefined);
  /** 是否提供「在榜周数」（只有 QQ 有：in_count）。 */
  const hasWeeks = songs.some((s) => s.rankMeta?.weeks !== undefined);

  /**
   * 只调 onPlay(song) 会让 playerStore.play 的「不在队列就 append 单曲」把队列压成 1 首，于是 
   * getNextSongIndex 只能算出当前歌自己、prefetchNextUrl 的自我预取守卫直接吃掉预取——下一首（尤其
   * QQ/酷狗）要等现场解析，换歌明显变慢。
   */
  const handlePlayRow = (song: Song, index: number): void => {
    setCurrentPlaylist(songs, index);
    onPlay(song, chartId);
  };

  const renderRow = (song: Song, index: number) => {
    // 名次 = 数组索引（#332 决策 3：名次不落结构）
    const rank = index + 1;
    const weeks = song.rankMeta?.weeks;
    const current = isCurrentSong(song.id, song.sourceType, chartId);
    const delta = rankDelta(song.rankMeta?.prevRank, rank);

    return (
      <div
        key={`${chartId}:${song.sourceType}:${song.id}`}
        onClick={() => handlePlayRow(song, index)}
        className="chart__row"
        data-current={current || undefined}
      >
        <div className="chart__rank" data-current={current || undefined}>
          {rank}
        </div>

        {hasPrevRank && (
          <div className="chart__delta" style={{ '--delta-color': delta.color } as React.CSSProperties}>
            {delta.label}
          </div>
        )}

        <div className="chart__cover">
          {song.cover ? (
            <img
              src={coverThumbUrl(song.cover, COVER_SIZE.row)}
              alt=""
              loading="lazy"
              className="chart__cover-img"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : null}
        </div>

        <div className="chart__text">
          <div className="chart__name-row">
            <span className="chart__name" data-current={current || undefined}>
              {song.name}
            </span>
            {/* AudioTagBadge 只认 preview/invalid（valid 无需标记） */}
            {(song.audioTag === 'preview' || song.audioTag === 'invalid') && <AudioTagBadge tag={song.audioTag} />}
          </div>
          <div className="chart__artist">
            {song.artist}
            {hasWeeks && weeks ? ` · 在榜 ${weeks} 周` : ''}
          </div>
        </div>

        <div className="chart__current-icon" data-visible={current || undefined}>
          {current ? <Play size={14} fill="currentColor" /> : null}
        </div>
      </div>
    );
  };

  return (
    <div className="chart">
      {heading}
      {/* 榜长可达 50（QQ 实测 song_num=100 也只回 50）/ 100+（网易整张歌单）→ 必须保留滚动容器 */}
      <div className="chart__scroll">
        {songs.map(renderRow)}
      </div>
    </div>
  );
};

export default ChartPanel;
