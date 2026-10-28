import React from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { Disc3 } from 'lucide-react';
import type { Album } from '@mplayer/core';
import '@/renderer/styles/songlist.css';

interface AlbumScrollProps {
  albums: Album[];
  loading: boolean;
  error: string | null;
  area: string;
  onAreaChange: (area: string) => void;
  onRetry: () => void;
  onAlbumClick?: (album: Album) => void;
}

const AREAS = [
  { label: '全部', value: 'ALL' },
  { label: '华语', value: 'ZH' },
  { label: '欧美', value: 'EA' },
  { label: '韩国', value: 'KR' },
  { label: '日本', value: 'JP' },
];

const AlbumScroll: React.FC<AlbumScrollProps> = ({ albums, loading, error, area, onAreaChange, onRetry, onAlbumClick }) => {
  if (error) {
    return (
      <div className="card-state card-state--error">
        <div>{error}</div>
        <button onClick={onRetry} className="card-state__retry">
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="album-scroll">
      {/* Area filter tabs */}
      <div className="album-scroll__areas">
        {AREAS.map((a) => (
          <button
            key={a.value}
            onClick={() => onAreaChange(a.value)}
            className="album-scroll__area"
            data-active={area === a.value || undefined}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Scrollable album cards */}
      <div className="album-scroll__body">
        {loading ? (
          <div className="album-scroll__sk-row">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="album-scroll__sk">
                <div className="skeleton-shimmer album-scroll__sk-cover" />
                <div className="skeleton-shimmer album-scroll__sk-title" />
              </div>
            ))}
          </div>
        ) : albums.length === 0 ? (
          <div className="card-state">
            <Disc3 size={26} className="album-scroll__empty-icon" />
            <div>暂无新碟数据</div>
          </div>
        ) : (
          <div className="album-scroll__grid">
            {albums.map((album) => (
              <div key={album.id} className="album-scroll__item" onClick={() => onAlbumClick?.(album)}>
                <div className="album-scroll__cover">
                  {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
                  <div className="album-scroll__placeholder">
                    <Disc3 size={36} />
                  </div>
                  {album.picUrl && (
                    <img
                      key={album.picUrl}
                      src={coverThumbUrl(album.picUrl, COVER_SIZE.thumb)}
                      alt={album.name}
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      className="album-scroll__img"
                    />
                  )}
                </div>
                <div className="album-scroll__name">{album.name}</div>
                <div className="album-scroll__artist">{album.artist || ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AlbumScroll;
