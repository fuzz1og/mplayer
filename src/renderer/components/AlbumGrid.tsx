import React from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { Disc3, Play } from 'lucide-react';
import type { Album } from '@mplayer/core';
import '@/renderer/styles/songlist.css';

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
      <div className="card-grid card-grid--album">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            <div className="skeleton-shimmer card-skeleton__cover" />
            <div className="skeleton-shimmer card-skeleton__title" />
            <div className="skeleton-shimmer card-skeleton__sub" />
          </div>
        ))}
      </div>
    );
  }

  if (error && albums.length === 0) {
    return (
      <div className="card-state card-state--error">
        <div>{error}</div>
        {onRetry && (
          <button onClick={onRetry} className="card-state__retry">
            重试
          </button>
        )}
      </div>
    );
  }

  if (albums.length === 0) {
    return (
      <div className="card-state">
        <Disc3 size={26} className="album-grid__empty-icon" />
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
        <div key={group.year ?? 'all'} className={group.year ? 'album-grid__group' : undefined}>
          {group.year && (
            <div className="album-grid__year">
              <span>{group.year}</span>
            </div>
          )}
          <div className="card-grid card-grid--album">
            {group.albums.map((album) => {
              const year = showYear ? albumYear(album) : '';
              return (
                <div key={album.id} onClick={() => onAlbumClick?.(album)} className="album-grid__item">
                  <div className="card-interactive album-grid__cover">
                    {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
                    <div className="album-grid__placeholder">
                      <Disc3 size={36} />
                    </div>
                    {album.picUrl && (
                      <img
                        key={album.picUrl}
                        src={coverThumbUrl(album.picUrl, COVER_SIZE.thumb)}
                        alt={album.name}
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        className="album-grid__img"
                      />
                    )}
                    <div className="play-overlay">
                      <Play size={20} color="white" fill="white" />
                    </div>
                  </div>
                  <div className="album-grid__name">{album.name}</div>
                  <div className="album-grid__sub">{year || album.artist || ''}</div>
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
