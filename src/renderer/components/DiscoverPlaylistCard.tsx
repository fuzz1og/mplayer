import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { DiscoverPlaylist } from '@/shared/types/song';
import { formatPlayCount } from '@/renderer/utils/format';

interface DiscoverPlaylistCardProps {
  playlist: DiscoverPlaylist;
}

const DiscoverPlaylistCard: React.FC<DiscoverPlaylistCardProps> = ({ playlist }) => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        cursor: 'pointer',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-surface)',
        transition: 'all var(--duration-normal) var(--ease-out)',
      }}
      onClick={() => navigate(`/discover-playlist/${playlist.id}`)}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--shadow-xs)';
      }}
    >
      <div style={{ position: 'relative', paddingTop: '100%', backgroundColor: 'var(--skeleton-base)' }}>
        <img
          src={playlist.coverImgUrl}
          alt={playlist.name}
          loading="lazy"
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute',
            top: 'var(--space-2)',
            right: 'var(--space-2)',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(4px)',
            color: 'white',
            fontSize: 'var(--text-2xs)',
            padding: '2px 6px',
            borderRadius: 'var(--radius-xs)',
          }}
        >
          ▶ {formatPlayCount(playlist.playCount)}
        </div>
      </div>
      <div style={{ padding: 'var(--space-3) var(--space-3)' }}>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-medium)',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            lineHeight: 'var(--leading-normal)',
            minHeight: '36px',
          }}
        >
          {playlist.name}
        </div>
      </div>
    </div>
  );
};

export default React.memo(DiscoverPlaylistCard);
