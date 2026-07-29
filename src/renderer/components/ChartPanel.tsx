import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import SongListSkeleton from '@/renderer/components/SongListSkeleton';
import SourceBadge from '@/renderer/components/SourceBadge';
import type { AggregatedSongGroup } from '@/main/services/chartAggregator';
import type { Song } from '@/shared/types/song';

interface ChartPanelProps {
  title: string;
  groups: AggregatedSongGroup[];
  loading: boolean;
  error: string | null;
  onPlay: (song: Song) => void;
  isCurrentSong: (songId: string) => boolean;
  onRetry?: () => void;
}

const ChartPanel: React.FC<ChartPanelProps> = ({
  title,
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
        <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>
          {title}
        </h3>
        <SongListSkeleton rowCount={15} showIndex />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
        <div style={{ textAlign: 'center', color: 'var(--danger-color)', backgroundColor: 'var(--danger-bg)', padding: '24px', borderRadius: 'var(--radius-md)', maxWidth: '320px' }}>
          <div style={{ fontSize: 'var(--text-lg)', marginBottom: '8px' }}>⚠️</div>
          <div style={{ fontSize: 'var(--text-base)', marginBottom: '16px' }}>{error}</div>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--accent-color)',
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
        <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>
          {title}
        </h3>
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
          <div>暂无排行榜数据</div>
        </div>
      </div>
    );
  }

  const renderGroup = (group: AggregatedSongGroup, rank: number) => {
    const isExpanded = expandedKeys.has(group.key);
    const bestSong = group.songs[0];

    return (
      <div key={group.key} style={{ marginBottom: 'var(--space-1)' }}>
        {/* Group row — collapsed shows best song, click to expand */}
        <div
          onClick={() => toggleGroup(group.key)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: '6px 8px',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            backgroundColor: isCurrentSong(bestSong.id) ? 'rgba(116, 185, 255, 0.1)' : 'transparent',
            transition: 'background-color 0.15s ease',
          }}
          onMouseEnter={(e) => { if (!isCurrentSong(bestSong.id)) e.currentTarget.style.backgroundColor = 'var(--hover-bg)'; }}
          onMouseLeave={(e) => { if (!isCurrentSong(bestSong.id)) e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          {/* Expand/collapse icon */}
          <div style={{ width: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', flexShrink: 0 }}>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
          {/* Rank */}
          <div style={{
            width: '28px', textAlign: 'center', fontSize: 'var(--text-sm)',
            color: isCurrentSong(bestSong.id) ? 'var(--accent-color)' : 'var(--text-tertiary)',
            fontWeight: isCurrentSong(bestSong.id) ? 600 : 400, flexShrink: 0,
          }}>
            {rank}
          </div>
          {/* Song info via SongRow-like layout */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-xs)', overflow: 'hidden', backgroundColor: 'var(--hover-bg)', flexShrink: 0 }}>
              {bestSong.cover ? (
                <img src={bestSong.cover} alt={bestSong.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, var(--border-color) 0%, var(--divider-color) 100%)' }} />
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 'var(--text-sm)', color: isCurrentSong(bestSong.id) ? 'var(--accent-color)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bestSong.name}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{bestSong.artist}</span>
                <SourceBadge sourceType={bestSong.sourceType} />
                {bestSong.audioTag === 'preview' && <span style={{ fontSize: 'var(--text-2xs)', padding: '1px 5px', borderRadius: 'var(--radius-xs)', backgroundColor: '#e67e2214', color: '#e67e22' }}>片段</span>}
                {bestSong.audioTag === 'invalid' && <span style={{ fontSize: 'var(--text-2xs)', padding: '1px 5px', borderRadius: 'var(--radius-xs)', backgroundColor: '#e74c3c14', color: '#e74c3c' }}>无效</span>}
              </div>
            </div>
          </div>
          {/* Play button */}
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(bestSong); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '50%', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Expanded: show all songs in group with source ranks */}
        {isExpanded && (
          <div style={{ paddingLeft: '42px', paddingTop: '4px', paddingBottom: '4px' }}>
            {group.songs.map((song) => {
              const sourceRank = group.sourceRanks[song.sourceType as keyof typeof group.sourceRanks];
              return (
                <div
                  key={`${group.key}-${song.id}`}
                  onDoubleClick={() => onPlay(song)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-xs)',
                    cursor: 'pointer',
                    backgroundColor: isCurrentSong(song.id) ? 'rgba(116, 185, 255, 0.08)' : 'transparent',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => { if (!isCurrentSong(song.id)) e.currentTarget.style.backgroundColor = 'var(--hover-bg)'; }}
                  onMouseLeave={(e) => { if (!isCurrentSong(song.id)) e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <div style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-xs)', overflow: 'hidden', backgroundColor: 'var(--hover-bg)', flexShrink: 0 }}>
                    {song.cover ? (
                      <img src={song.cover} alt={song.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, var(--border-color) 0%, var(--divider-color) 100%)' }} />
                    )}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 'var(--text-sm)', color: isCurrentSong(song.id) ? 'var(--accent-color)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {song.name}
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.artist}</span>
                      <SourceBadge sourceType={song.sourceType} />
                      {song.audioTag === 'preview' && <span style={{ fontSize: 'var(--text-2xs)', padding: '1px 5px', borderRadius: 'var(--radius-xs)', backgroundColor: '#e67e2214', color: '#e67e22' }}>片段</span>}
                      {song.audioTag === 'invalid' && <span style={{ fontSize: 'var(--text-2xs)', padding: '1px 5px', borderRadius: 'var(--radius-xs)', backgroundColor: '#e74c3c14', color: '#e74c3c' }}>无效</span>}
                    </div>
                  </div>
                  {/* Source rank badge */}
                  {sourceRank && (
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)', flexShrink: 0, padding: '2px 6px', borderRadius: 'var(--radius-xs)', backgroundColor: 'var(--hover-bg)' }}>
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

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>
        {title}
      </h3>
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
        {groups.slice(0, 50).map((group, index) => renderGroup(group, index + 1))}
      </div>
    </div>
  );
};

export default ChartPanel;