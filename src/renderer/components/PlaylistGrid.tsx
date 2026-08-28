import React from 'react';
import { ListMusic } from 'lucide-react';
import { formatPlayCount } from '@mplayer/core';
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 'var(--space-4)', alignContent: 'start' }}>
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 'var(--space-4)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', padding: '14px' }}>
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
        <button onClick={onRetry} style={{ marginTop: '12px', padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          重试
        </button>
      </div>
    );
  }

  if (playlists.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
        <ListMusic size={26} style={{ marginBottom: '12px', color: 'var(--text-tertiary)' }} />
        <div>暂无推荐歌单</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 'var(--space-4)', alignContent: 'start' }}>
      {playlists.map((pl) => (
        <div
          key={pl.id}
          onClick={() => onPlaylistSelect?.(pl)}
          style={{ cursor: 'pointer', display: 'flex', gap: 'var(--space-4)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', padding: '14px', transition: 'background-color 0.15s ease, box-shadow 0.15s ease' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface)'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          <div style={{ position: 'relative', width: '144px', height: '144px', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0 }}>
            {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ListMusic size={34} style={{ color: 'var(--text-tertiary)' }} />
            </div>
            {pl.coverImgUrl && (
              <img
                key={pl.coverImgUrl}
                src={pl.coverImgUrl}
                alt={pl.name}
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
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
                  <span key={tag} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', backgroundColor: 'var(--border-default)', color: 'var(--text-tertiary)' }}>
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

export default PlaylistGrid;
