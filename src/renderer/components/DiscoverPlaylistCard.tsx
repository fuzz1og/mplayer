import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { DiscoverPlaylist } from '@/shared/types/song';

interface DiscoverPlaylistCardProps {
  playlist: DiscoverPlaylist;
}

const formatPlayCount = (count: number): string => {
  if (count >= 100000000) {
    return `${(count / 100000000).toFixed(1)}亿`;
  }
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`;
  }
  return count.toString();
};

const DiscoverPlaylistCard: React.FC<DiscoverPlaylistCardProps> = ({ playlist }) => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        cursor: 'pointer',
        borderRadius: '8px',
        overflow: 'hidden',
        backgroundColor: 'var(--content-bg)',
        border: '1px solid var(--border-color)',
        transition: 'all 0.2s ease',
      }}
      onClick={() => navigate(`/discover-playlist/${playlist.id}`)}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div
        style={{
          position: 'relative',
          paddingTop: '100%',
          backgroundColor: '#f0f0f0',
        }}
      >
        <img
          src={playlist.coverImgUrl}
          alt={playlist.name}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            color: 'white',
            fontSize: '11px',
            padding: '2px 6px',
            borderRadius: '4px',
          }}
        >
          ▶ {formatPlayCount(playlist.playCount)}
        </div>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            lineHeight: '1.4',
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
