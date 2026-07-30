import React from 'react';
import type { DiscoverPlaylist } from '@mplayer/core';

interface PlaylistPageGridProps {
  playlists: DiscoverPlaylist[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPlaylistSelect?: (playlist: DiscoverPlaylist) => void;
}

function formatCount(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

const PlaylistPageGrid: React.FC<PlaylistPageGridProps> = ({ playlists, loading, error, onRetry, onPlaylistSelect }) => {
  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-5)', overflow: 'auto', alignContent: 'start' }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ borderRadius: '12px', overflow: 'hidden', backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)' }}>
            <div className="skeleton-shimmer" style={{ width: '100%', paddingTop: '50%' }} />
            <div style={{ padding: '14px' }}>
              <div className="skeleton-shimmer" style={{ width: '70%', height: '16px', borderRadius: '2px', marginBottom: '8px' }} />
              <div className="skeleton-shimmer" style={{ width: '50%', height: '12px', borderRadius: '2px', marginBottom: '6px' }} />
              <div className="skeleton-shimmer" style={{ width: '90%', height: '12px', borderRadius: '2px' }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
        <div>{error}</div>
        <button onClick={onRetry} style={{ marginTop: '12px', padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          重试
        </button>
      </div>
    );
  }

  if (playlists.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📚</div>
        <div>暂无歌单</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-5)', overflow: 'auto', alignContent: 'start' }}>
      {playlists.map((pl) => (
        <div
          key={pl.id}
          onClick={() => onPlaylistSelect?.(pl)}
          style={{ cursor: 'pointer', borderRadius: '12px', overflow: 'hidden', backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)', transition: 'transform 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
        >
          <div style={{ width: '100%', paddingTop: '50%', backgroundColor: 'var(--hover-bg)', position: 'relative' }}>
            {pl.coverImgUrl ? (
              <img src={pl.coverImgUrl} alt={pl.name} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
            ) : (
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px' }}>🎵</div>
            )}
          </div>
          <div style={{ padding: '14px' }}>
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', marginBottom: '4px' }}>
              {pl.name}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
              {pl.creator.nickname} · {formatCount(pl.playCount)} 次播放 · {pl.trackCount} 首
            </div>
            {pl.description && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '6px' }}>
                {pl.description}
              </div>
            )}
            {pl.tags.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {pl.tags.slice(0, 3).map((tag) => (
                  <span key={tag} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', backgroundColor: 'var(--border-color)', color: 'var(--text-tertiary)' }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default PlaylistPageGrid;
