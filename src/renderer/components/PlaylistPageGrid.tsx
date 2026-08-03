import React from 'react';
import { ListMusic } from 'lucide-react';
import CoverImage from '@/renderer/components/CoverImage';
import { formatPlayCount } from '@mplayer/core';
import type { DiscoverPlaylist } from '@mplayer/core';

interface PlaylistPageGridProps {
  playlists: DiscoverPlaylist[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPlaylistSelect?: (playlist: DiscoverPlaylist) => void;
}

const SKELETON_COUNT = 6;

const PlaylistPageGrid: React.FC<PlaylistPageGridProps> = ({ playlists, loading, error, onRetry, onPlaylistSelect }) => {
  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 'var(--space-4)', alignContent: 'start' }}>
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 'var(--space-4)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)', padding: '14px' }}>
            <div className="skeleton-shimmer" style={{ width: '144px', height: '144px', borderRadius: '8px', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="skeleton-shimmer" style={{ width: '70%', height: '16px', borderRadius: '2px', marginBottom: '10px' }} />
              <div className="skeleton-shimmer" style={{ width: '55%', height: '13px', borderRadius: '2px', marginBottom: '8px' }} />
              <div className="skeleton-shimmer" style={{ width: '90%', height: '13px', borderRadius: '2px' }} />
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
        <ListMusic size={26} style={{ marginBottom: '12px', color: 'var(--text-tertiary)' }} />
        <div>暂无歌单</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 'var(--space-4)', alignContent: 'start' }}>
      {playlists.map((pl) => (
        <div
          key={pl.id}
          onClick={() => onPlaylistSelect?.(pl)}
          style={{ cursor: 'pointer', display: 'flex', gap: 'var(--space-4)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)', padding: '14px', transition: 'background-color 0.15s ease, box-shadow 0.15s ease' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--hover-bg)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--content-bg)'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          <div style={{ width: '144px', height: '144px', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--hover-bg)', flexShrink: 0 }}>
            {pl.coverImgUrl ? (
              <CoverImage src={pl.coverImgUrl} alt={pl.name} variant="playlist" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ListMusic size={34} style={{ color: 'var(--text-tertiary)' }} />
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.35, marginBottom: '6px' }}>
              {pl.name}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5, marginBottom: '6px' }}>
              {pl.creator.nickname} · {formatPlayCount(pl.playCount)} 次播放 · {pl.trackCount} 首
            </div>
            {pl.description && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.5, marginBottom: '8px' }}>
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
