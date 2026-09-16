import React from 'react';
import { Music2, AlertCircle, Play } from 'lucide-react';
import SongListSkeleton from '@/renderer/components/SongListSkeleton';
import AudioTagBadge from '@/renderer/components/AudioTagBadge';
import type { ChartKind, Song } from '@mplayer/core';

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
 *
 * 由「聚合 + 折叠展开」改为「一个源的一个榜」：名次即数组索引，
 * 不再有 `sourceRanks`/`score`/`bestSong`。
 *
 * **可选列**：榜单元数据在各源之间并不齐备（实测：三源公共只有「名次」，
 * 「上期名次/在榜周数」只有 QQ 提供）。因此不去做「按源各写一个组件」——
 * 那是 N 个组件服务 1 个字段；而是**一个通用组件 + 可选列**：
 * 有值就渲染，没值就不占位。稀疏的是数据，不是组件。
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
  const heading = (
    <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>
      {title}
    </h3>
  );

  if (loading) {
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        {heading}
        <SongListSkeleton rowCount={15} showIndex />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        {heading}
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--danger)' }}>
          <AlertCircle size={22} style={{ marginBottom: '8px' }} />
          <div style={{ fontSize: 'var(--text-base)', marginBottom: '16px' }}>{error}</div>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--accent)',
                color: 'var(--text-inverse)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
              }}
            >
              重试
            </button>
          )}
        </div>
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        {heading}
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
          <Music2 size={24} style={{ marginBottom: '12px', color: 'var(--text-tertiary)' }} />
          <div>暂无排行榜数据</div>
        </div>
      </div>
    );
  }

  /** 该榜单是否提供「上期名次」（只有 QQ 有：old_count）。任一曲目有即显示该列。 */
  const hasPrevRank = songs.some((s) => s.rankMeta?.prevRank !== undefined);
  /** 是否提供「在榜周数」（只有 QQ 有：in_count）。 */
  const hasWeeks = songs.some((s) => s.rankMeta?.weeks !== undefined);

  const renderRow = (song: Song, index: number) => {
    // 名次 = 数组索引（#332 决策 3：名次不落结构）
    const rank = index + 1;
    const weeks = song.rankMeta?.weeks;
    const current = isCurrentSong(song.id, song.sourceType, chartId);
    const delta = rankDelta(song.rankMeta?.prevRank, rank);

    return (
      <div
        key={`${chartId}:${song.sourceType}:${song.id}`}
        onClick={() => onPlay(song, chartId)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '6px 8px',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          backgroundColor: current ? 'rgba(47, 95, 208, 0.10)' : 'transparent',
          transition: 'background-color 0.15s ease',
        }}
        onMouseEnter={(e) => { if (!current) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { if (!current) e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <div style={{
          width: '28px', textAlign: 'center', fontSize: 'var(--text-sm)',
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
          color: current ? 'var(--accent)' : 'var(--text-tertiary)',
          fontWeight: current ? 600 : 400,
        }}>
          {rank}
        </div>

        {hasPrevRank && (
          <div style={{
            width: '34px', textAlign: 'center', fontSize: 'var(--text-xs)',
            fontVariantNumeric: 'tabular-nums', flexShrink: 0,
            color: delta.color,
          }}>
            {delta.label}
          </div>
        )}

        <div style={{ position: 'relative', width: '36px', height: '36px', borderRadius: 'var(--radius-xs)', overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0 }}>
          {song.cover ? (
            <img
              src={song.cover}
              alt=""
              loading="lazy"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : null}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <span style={{ fontSize: 'var(--text-base)', color: current ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {song.name}
            </span>
            {/* AudioTagBadge 只认 preview/invalid（valid 无需标记） */}
            {(song.audioTag === 'preview' || song.audioTag === 'invalid') && <AudioTagBadge tag={song.audioTag} />}
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {song.artist}
            {hasWeeks && weeks ? ` · 在榜 ${weeks} 周` : ''}
          </div>
        </div>

        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, opacity: current ? 0 : 1 }}>
          {current ? <Play size={14} fill="currentColor" style={{ color: 'var(--accent)', opacity: 1 }} /> : null}
        </div>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {heading}
      {/* 榜长可达 50（QQ 实测 song_num=100 也只回 50）/ 100+（网易整张歌单）→ 必须保留滚动容器 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '4px' }}>
        {songs.map(renderRow)}
      </div>
    </div>
  );
};

export default ChartPanel;
