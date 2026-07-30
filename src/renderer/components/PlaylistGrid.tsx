import React from 'react';
import type { DiscoverPlaylist } from '@mplayer/core';

interface PlaylistGridProps {
  playlists: DiscoverPlaylist[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPlaylistSelect?: (playlist: DiscoverPlaylist) => void;
}

const SKELETON_COUNT = 6;

const PlaylistGrid: React.FC<PlaylistGridProps> = ({ playlists, loading, error, onRetry, onPlaylistSelect }) => {
  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-5)', overflow: 'auto', alignContent: 'start' }}>
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div key={i} style={{ borderRadius: '12px', overflow: 'hidden', backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)' }}>
            <div className="skeleton-shimmer" style={{ width: '100%', paddingTop: '100%' }} />
            <div style={{ padding: '10px' }}>
              <div className="skeleton-shimmer" style={{ width: '80%', height: '14px', borderRadius: '2px', marginBottom: '6px' }} />
              <div className="skeleton-shimmer" style={{ width: '40%', height: '12px', borderRadius: '2px' }} />
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
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
        <div>暂无推荐歌单</div>
      </div>
    );
  }

  const handleClick = (pl: DiscoverPlaylist) => {
    onPlaylistSelect?.(pl);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-5)', overflow: 'auto', alignContent: 'start' }}>
      {playlists.map((pl) => (
        <div
          key={pl.id}
          onClick={() => handleClick(pl)}
          style={{ cursor: 'pointer', borderRadius: '12px', overflow: 'hidden', backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)', transition: 'transform 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
        >
          <div style={{ width: '100%', paddingTop: '100%', backgroundColor: 'var(--hover-bg)', position: 'relative' }}>
            {pl.coverImgUrl ? (
              <img src={pl.coverImgUrl} alt={pl.name} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
            ) : (
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px' }}>🎵</div>
            )}
          </div>
          <div style={{ padding: '10px' }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
              {pl.name}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              {pl.trackCount} 首
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default PlaylistGrid;
