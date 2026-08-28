import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Music2, AlertCircle, Play } from 'lucide-react';
import SongListSkeleton from '@/renderer/components/SongListSkeleton';
import SourceBadge from '@/renderer/components/SourceBadge';
import AudioTagBadge from '@/renderer/components/AudioTagBadge';
import type { AggregatedSongGroup } from '@/main/services/chartAggregator';
import type { Song } from '@mplayer/core';

interface ChartPanelProps {
  title: string;
  chartId: string;
  groups: AggregatedSongGroup[];
  loading: boolean;
  error: string | null;
  onPlay: (song: Song, chartId?: string) => void;
  isCurrentSong: (songId: string, sourceType?: string, chartId?: string) => boolean;
  onRetry?: () => void;
}

const ChartPanel: React.FC<ChartPanelProps> = ({
  title,
  chartId,
  groups,
  loading,
  error,
  onPlay,
  isCurrentSong,
  onRetry,
}) => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>
          {title}
        </h3>
        <SongListSkeleton rowCount={15} showIndex />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
        <div style={{ textAlign: 'center', color: 'var(--danger)', backgroundColor: 'var(--danger-subtle)', padding: '24px', borderRadius: 'var(--radius-md)', maxWidth: '320px' }}>
          <AlertCircle size={22} style={{ marginBottom: '8px', color: 'var(--danger)' }} />
          <div style={{ fontSize: 'var(--text-base)', marginBottom: '16px' }}>{error}</div>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--accent)',
                color: 'white',
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

  if (groups.length === 0) {
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>
          {title}
        </h3>
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
          <Music2 size={24} style={{ marginBottom: '12px', color: 'var(--text-tertiary)' }} />
          <div>暂无排行榜数据</div>
        </div>
      </div>
    );
  }

  const renderGroup = (group: AggregatedSongGroup, rank: number) => {
    const isExpanded = expandedKeys.has(group.key);
    const bestSong = group.bestSong;

    return (
      <div key={group.key} style={{ marginBottom: 'var(--space-1)' }}>
        {/* Group row — click plays the best song; chevron click expands */}
        <div
          onClick={() => onPlay(bestSong, chartId)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: '6px 8px',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            backgroundColor: isCurrentSong(bestSong.id, bestSong.sourceType, chartId) ? 'rgba(47, 95, 208, 0.10)' : 'transparent',
            transition: 'background-color 0.15s ease',
          }}
          onMouseEnter={(e) => { if (!isCurrentSong(bestSong.id, bestSong.sourceType, chartId)) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { if (!isCurrentSong(bestSong.id, bestSong.sourceType, chartId)) e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          {/* Expand/collapse icon */}
          <div
            onClick={(e) => { e.stopPropagation(); toggleGroup(group.key); }}
            style={{ width: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', flexShrink: 0, cursor: 'pointer' }}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
          {/* Rank */}
          <div style={{
            width: '28px', textAlign: 'center', fontSize: 'var(--text-sm)',
            fontVariantNumeric: 'tabular-nums',
            color: isCurrentSong(bestSong.id, bestSong.sourceType, chartId) ? 'var(--accent)' : 'var(--text-tertiary)',
            fontWeight: isCurrentSong(bestSong.id, bestSong.sourceType, chartId) ? 600 : 400, flexShrink: 0,
          }}>
            {rank}
          </div>
          {/* Song info via SongRow-like layout */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div style={{ position: 'relative', width: '36px', height: '36px', borderRadius: 'var(--radius-xs)', overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0 }}>
              {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, var(--border-default) 0%, var(--border-subtle) 100%)' }} />
              {bestSong.cover && (
                <img
                  key={bestSong.cover}
                  src={bestSong.cover}
                  alt={bestSong.name}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 'var(--text-sm)', color: isCurrentSong(bestSong.id, bestSong.sourceType, chartId) ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bestSong.name}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{bestSong.artist}</span>
                <SourceBadge sourceType={bestSong.sourceType} />
                {bestSong.audioTag === 'preview' && <AudioTagBadge tag="preview" />}
                {bestSong.audioTag === 'invalid' && <AudioTagBadge tag="invalid" />}
              </div>
            </div>
          </div>
        </div>

        {/* Expanded: show all songs in group with source ranks */}
        {isExpanded && (
          <div style={{ paddingLeft: '42px', paddingTop: '4px', paddingBottom: '4px' }}>
            {group.songs.map((song) => {
              const sourceRank = group.sourceRanks[song.sourceType as keyof typeof group.sourceRanks];
              return (
                <div
                  key={`${group.key}-${song.id}`}
                  onDoubleClick={() => onPlay(song, chartId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-xs)',
                    cursor: 'pointer',
                    backgroundColor: isCurrentSong(song.id, song.sourceType, chartId) ? 'rgba(47, 95, 208, 0.08)' : 'transparent',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => { if (!isCurrentSong(song.id, song.sourceType, chartId)) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { if (!isCurrentSong(song.id, song.sourceType, chartId)) e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <div style={{ position: 'relative', width: '36px', height: '36px', borderRadius: 'var(--radius-xs)', overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0 }}>
                    {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, var(--border-default) 0%, var(--border-subtle) 100%)' }} />
                    {song.cover && (
                      <img
                        key={song.cover}
                        src={song.cover}
                        alt={song.name}
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    )}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 'var(--text-sm)', color: isCurrentSong(song.id, song.sourceType, chartId) ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {song.name}
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.artist}</span>
                      <SourceBadge sourceType={song.sourceType} />
                      {song.audioTag === 'preview' && <AudioTagBadge tag="preview" />}
                      {song.audioTag === 'invalid' && <AudioTagBadge tag="invalid" />}
                    </div>
                  </div>
                  {/* Source rank badge */}
                  {sourceRank && (
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)', flexShrink: 0, padding: '2px 6px', borderRadius: 'var(--radius-xs)', backgroundColor: 'var(--bg-hover)' }}>
                      #{sourceRank}
                    </div>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onPlay(song); }}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', borderRadius: '50%', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderFeatured = (group: AggregatedSongGroup, rank: number) => {
    const bestSong = group.bestSong;
    const isCurrent = isCurrentSong(bestSong.id, bestSong.sourceType, chartId);
    return (
      <div
        key={group.key}
        onClick={() => onPlay(bestSong, chartId)}
        style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px',
          borderRadius: '8px', cursor: 'pointer', border: '1px solid var(--border-default)',
          backgroundColor: isCurrent ? 'rgba(47, 95, 208, 0.10)' : 'var(--bg-surface)',
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
        }}
        onMouseEnter={(e) => { if (!isCurrent) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; } }}
        onMouseLeave={(e) => { if (!isCurrent) { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.backgroundColor = 'var(--bg-surface)'; } }}
      >
        <div style={{ width: '36px', textAlign: 'center', fontSize: '20px', fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {rank}
        </div>
        <div style={{ position: 'relative', width: '56px', height: '56px', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0 }}>
          {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Music2 size={20} style={{ color: 'var(--text-tertiary)' }} />
          </div>
          {bestSong.cover && (
            <img
              key={bestSong.cover}
              src={bestSong.cover}
              alt={bestSong.name}
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: isCurrent ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bestSong.name}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{bestSong.artist}</span>
            <SourceBadge sourceType={bestSong.sourceType} />
            {bestSong.audioTag === 'preview' && <AudioTagBadge tag="preview" />}
            {bestSong.audioTag === 'invalid' && <AudioTagBadge tag="invalid" />}
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onPlay(bestSong, chartId); }} aria-label="播放" style={{ border: 'none', background: 'var(--accent)', color: 'white', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          <Play size={14} fill="currentColor" />
        </button>
      </div>
    );
  };

  const topGroups = groups.slice(0, 3);
  const restGroups = groups.slice(3, 50);

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{title}</h3>
        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{groups.length} 首</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
          {topGroups.map((group, index) => renderFeatured(group, index + 1))}
        </div>
        {restGroups.map((group, index) => renderGroup(group, index + 4))}
      </div>
    </div>
  );
};

export default ChartPanel;
