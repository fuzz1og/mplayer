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
        backgroundColor: 'var(--content-bg)',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid var(--border-color)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        height: '150px',
      }}
      onClick={() => navigate(route)}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent-color)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-color)';
        e.currentTarget.style.transform = 'translateY(0)';
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
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: radialGradient,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            fontSize: '24px',
            opacity: 0.6,
            color: 'white',
          }}
        >
          ♪♪♪
        </div>
        <div
          style={{
            fontSize: '36px',
            fontWeight: 800,
            color: 'white',
            textShadow: '2px 2px 8px rgba(0,0,0,0.5)',
            zIndex: 1,
            letterSpacing: '4px',
          }}
        >
          {coverTitle}
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: 'rgba(255,255,255,0.8)',
            fontSize: '11px',
            backgroundColor: 'rgba(0,0,0,0.3)',
            padding: '3px 8px',
            borderRadius: '12px',
          }}
        >
          <span>🎧</span>
          <span>{songs.length > 0 ? badgeText : '加载中'}</span>
        </div>
      </div>

      {/* 右侧歌曲列表 */}
      <div style={{ flex: 1, padding: '12px 16px', overflow: 'hidden' }}>
        <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px' }}>
          {title}
        </div>
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`skeleton-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 0',
              }}
            >
              <span
                style={{
                  width: '16px',
                  height: '14px',
                  backgroundColor: 'var(--divider-color)',
                  borderRadius: '2px',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <span
                style={{
                  flex: 1,
                  height: '12px',
                  backgroundColor: 'var(--divider-color)',
                  borderRadius: '2px',
                  animation: 'pulse 1.5s ease-in-out infinite',
                  animationDelay: '0.1s',
                }}
              />
            </div>
          ))
        ) : (
          songs.slice(0, 3).map((song, index) => (
            <div
              key={song.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 0',
                borderBottom: index < 2 ? '1px solid var(--divider-color)' : 'none',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSongClick(song, sourceType);
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span
                style={{
                  width: '16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: song.rank <= 3 ? 'var(--danger-color)' : 'var(--text-tertiary)',
                  textAlign: 'center',
                }}
              >
                {song.rank}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: '12px',
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
                  fontSize: '11px',
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
