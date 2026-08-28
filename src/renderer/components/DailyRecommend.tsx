import React from 'react';
import { Play, RefreshCw, Music2 } from 'lucide-react';
import type { Song } from '@mplayer/core';
import SongCover from './SongCover';

interface DailyRecommendProps {
  songs: Song[];
  loading: boolean;
  onPlay: (song: Song) => void;
  onRefresh: () => void;
}

interface SongRowMiniProps {
  song: Song;
  onPlay: (song: Song) => void;
}

const SongRowMini: React.FC<SongRowMiniProps> = ({ song, onPlay }) => {
  return (
    <div
      onDoubleClick={() => onPlay(song)}
      style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 14px', cursor: 'pointer', transition: 'background-color 0.12s ease' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      <div style={{ width: '44px', height: '44px', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0 }}>
        <SongCover src={song.cover} alt={song.name} variant="icon" iconSize={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {song.name}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
          {song.artist}
        </div>
      </div>
      <button
        onClick={() => onPlay(song)}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent)'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '50%', border: 'none', backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s ease' }}
        aria-label="播放"
      >
        <Play size={13} fill="currentColor" />
      </button>
    </div>
  );
};

const DailyRecommend: React.FC<DailyRecommendProps> = ({ songs, loading, onPlay, onRefresh }) => {
  const featured = songs[0];
  const listSongs = songs.slice(0, 5);

  if (loading && songs.length === 0) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 400px) 1fr', gap: 'var(--space-5)', minHeight: '360px' }}>
        <div className="skeleton-shimmer" style={{ borderRadius: '8px', minHeight: '360px' }} />
        <div style={{ borderRadius: '8px', border: '1px solid var(--border-default)', overflow: 'hidden', backgroundColor: 'var(--bg-surface)' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="skeleton-shimmer" style={{ width: '44px', height: '44px', borderRadius: '8px', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton-shimmer" style={{ width: '60%', height: '14px', borderRadius: '2px', marginBottom: '6px' }} />
                <div className="skeleton-shimmer" style={{ width: '40%', height: '12px', borderRadius: '2px' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '360px', borderRadius: '8px', border: '1px solid var(--border-default)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
        <Music2 size={20} style={{ marginRight: '8px' }} />
        暂无推荐歌曲
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 400px) 1fr', gap: 'var(--space-5)', minHeight: '360px' }}>
      <div
        onClick={() => featured && onPlay(featured)}
        style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', minHeight: '360px', cursor: 'pointer', backgroundColor: 'var(--bg-hover)', border: '1px solid var(--border-default)' }}
      >
        <SongCover
          src={featured?.cover}
          alt={featured?.name ?? ''}
          variant="gradient"
          style={{ position: 'absolute', inset: 0 }}
          placeholderStyle={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, var(--gray-300) 0%, var(--gray-100) 100%)' }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.68) 82%)' }} />
        <div style={{ position: 'absolute', left: '20px', right: '20px', bottom: '18px', color: '#fff' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--warning)', marginBottom: '10px', display: 'inline-flex', padding: '4px 10px', borderRadius: '999px', backgroundColor: 'var(--warning-subtle)' }}>
            今日主打
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, lineHeight: 1.25, marginBottom: '6px', letterSpacing: 0 }}>
            {featured.name}
          </div>
          <div style={{ fontSize: '13px', opacity: 0.88, marginBottom: '12px' }}>
            {featured.artist}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(featured); }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '34px', borderRadius: '50%', border: 'none', backgroundColor: 'rgba(255,255,255,0.92)', color: '#111', cursor: 'pointer' }}
            aria-label="播放"
          >
            <Play size={16} fill="currentColor" />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', borderRadius: '8px', border: '1px solid var(--border-default)', backgroundColor: 'var(--bg-surface)', overflow: 'hidden', minHeight: '360px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>为你推荐</span>
          <button
            onClick={onRefresh}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', border: 'none', borderRadius: '6px', backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px' }}
            title="换一批"
          >
            <RefreshCw size={14} />
            换一批
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {listSongs.map((song, index) => (
            <SongRowMini key={`${song.id}-${index}`} song={song} onPlay={onPlay} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default DailyRecommend;
