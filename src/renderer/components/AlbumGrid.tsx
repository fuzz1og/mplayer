import React from 'react';
import { Disc3, Play } from 'lucide-react';
import CoverImage from '@/renderer/components/CoverImage';
import type { Album } from '@mplayer/core';

interface AlbumGridProps {
  albums: Album[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onAlbumClick?: (album: Album) => void;
  /** 卡片副标题显示发行年份(默认 true) */
  showYear?: boolean;
  /** 按发行年份分组展示(发行年表)——歌手的专辑序列是真实时间线,年份即信息 */
  groupByYear?: boolean;
}

function albumYear(album: Album): string {
  const t = Number(album.publishTime);
  return t > 0 ? String(new Date(t).getFullYear()) : '';
}

const AlbumGrid: React.FC<AlbumGridProps> = ({
  albums,
  loading = false,
  error = null,
  onRetry,
  onAlbumClick,
  showYear = true,
  groupByYear = false,
}) => {
  if (loading && albums.length === 0) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-5)' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            <div className="skeleton-shimmer" style={{ width: '100%', aspectRatio: '1', borderRadius: '8px', marginBottom: '8px' }} />
            <div className="skeleton-shimmer" style={{ width: '80%', height: '14px', borderRadius: '2px', marginBottom: '6px' }} />
            <div className="skeleton-shimmer" style={{ width: '50%', height: '12px', borderRadius: '2px' }} />
          </div>
        ))}
      </div>
    );
  }

  if (error && albums.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
        <div>{error}</div>
        {onRetry && (
          <button onClick={onRetry} style={{ marginTop: '12px', padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            重试
          </button>
        )}
      </div>
    );
  }

  if (albums.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
        <Disc3 size={26} style={{ marginBottom: '12px', color: 'var(--text-tertiary)' }} />
        <div>暂无专辑</div>
      </div>
    );
  }

  // 发行年表分组:按发行时间倒序,年份倒序渲染(未知年份沉底)
  const groups = (() => {
    if (!groupByYear) return [{ year: null as string | null, albums }];
    const sorted = [...albums].sort((a, b) => Number(b.publishTime) - Number(a.publishTime));
    const map = new Map<string, Album[]>();
    for (const a of sorted) {
      const year = albumYear(a) || '未知年份';
      const list = map.get(year);
      if (list) list.push(a);
      else map.set(year, [a]);
    }
    const years = Array.from(map.keys()).sort((x, y) => {
      if (x === '未知年份') return 1;
      if (y === '未知年份') return -1;
      return Number(y) - Number(x);
    });
    return years.map(year => ({ year, albums: map.get(year)! }));
  })();

  return (
    <div>
      {groups.map((group) => (
        <div key={group.year ?? 'all'} style={{ marginBottom: group.year ? '32px' : 0 }}>
          {group.year && (
            <div style={{ marginBottom: '16px' }}>
              <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {group.year}
              </span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-5)' }}>
            {group.albums.map((album) => {
              const year = showYear ? albumYear(album) : '';
              return (
                <div
                  key={album.id}
                  onClick={() => onAlbumClick?.(album)}
                  style={{ cursor: 'pointer', minWidth: 0 }}
                >
                  <div
                    className="card-interactive"
                    style={{
                      position: 'relative',
                      aspectRatio: '1',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      backgroundColor: 'var(--hover-bg)',
                      marginBottom: '8px',
                      transition: 'box-shadow 0.15s ease, transform 0.15s ease',
                    }}
                  >
                    {album.picUrl ? (
                      <CoverImage src={album.picUrl} alt={album.name} variant="playlist" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--hover-bg)' }}>
                        <Disc3 size={36} style={{ color: 'var(--text-tertiary)' }} />
                      </div>
                    )}
                    <div className="play-overlay">
                      <Play size={20} color="white" fill="white" />
                    </div>
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {album.name}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {year || album.artist || ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AlbumGrid;
