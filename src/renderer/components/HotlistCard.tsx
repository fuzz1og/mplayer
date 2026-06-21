import React from 'react';
import { useNavigate } from 'react-router-dom';

interface HotlistSong {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

interface HotlistCardProps {
  title: string;
  coverTitle: string;
  coverGradient: string;
  radialGradient: string;
  badgeText: string;
  route: string;
  songs: HotlistSong[];
  loading: boolean;
  sourceType: 'netease' | 'qq';
  onSongClick: (song: HotlistSong, sourceType: 'netease' | 'qq') => void;
}

const HotlistCard: React.FC<HotlistCardProps> = ({
  title,
  coverTitle,
  coverGradient,
  radialGradient,
  badgeText,
  route,
  songs,
  loading,
  sourceType,
  onSongClick,
}) => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        transition: 'all var(--duration-normal) var(--ease-out)',
        height: '150px',
      }}
      onClick={() => navigate(route)}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* 左侧封面图 */}
      <div
        style={{
          width: '150px',
          height: '150px',
          flexShrink: 0,
          background: coverGradient,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, background: radialGradient }} />
        <div
          style={{
            position: 'absolute',
            top: 'var(--space-3)',
            left: 'var(--space-3)',
            fontSize: '20px',
            opacity: 0.5,
            color: 'white',
          }}
        >
          ♪♪♪
        </div>
        <div
          style={{
            fontSize: '32px',
            fontWeight: 'var(--weight-bold)',
            color: 'white',
            textShadow: '2px 2px 8px rgba(0,0,0,0.4)',
            zIndex: 1,
            letterSpacing: '3px',
          }}
        >
          {coverTitle}
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 'var(--space-3)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: 'rgba(255,255,255,0.8)',
            fontSize: 'var(--text-2xs)',
            backgroundColor: 'rgba(0,0,0,0.3)',
            backdropFilter: 'blur(4px)',
            padding: '3px 8px',
            borderRadius: 'var(--radius-full)',
          }}
        >
          <span>🎧</span>
          <span>{songs.length > 0 ? badgeText : '加载中'}</span>
        </div>
      </div>

      {/* 右侧歌曲列表 */}
      <div style={{ flex: 1, padding: 'var(--space-3) var(--space-4)', overflow: 'hidden' }}>
        <div
          style={{
            fontSize: 'var(--text-base)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--text-primary)',
            marginBottom: 'var(--space-3)',
          }}
        >
          {title}
        </div>
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`skeleton-${index}`}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '5px 0' }}
            >
              <div className="skeleton-shimmer" style={{ width: '16px', height: '12px' }} />
              <div className="skeleton-shimmer" style={{ flex: 1, height: '12px' }} />
            </div>
          ))
        ) : (
          songs.slice(0, 3).map((song, index) => (
            <div
              key={song.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: '5px var(--space-1)',
                borderBottom: index < 2 ? '1px solid var(--border-subtle)' : 'none',
                cursor: 'pointer',
                borderRadius: 'var(--radius-xs)',
                transition: 'background var(--duration-fast)',
              }}
              onClick={(e) => { e.stopPropagation(); onSongClick(song, sourceType); }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span
                style={{
                  width: '16px',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  color: song.rank <= 3 ? 'var(--danger)' : 'var(--text-tertiary)',
                  textAlign: 'center',
                }}
              >
                {song.rank}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {song.name}
              </span>
              <span
                style={{
                  fontSize: 'var(--text-2xs)',
                  color: 'var(--text-tertiary)',
                  flexShrink: 0,
                }}
              >
                {song.artists}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default React.memo(HotlistCard);
