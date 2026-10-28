import React from 'react';
import { Disc3 } from 'lucide-react';
import type { Album } from '@mplayer/core';
import CoverCard from '@/renderer/components/CoverCard';
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

/** 新碟上架：与歌单 / 歌手同处一张内容卡，只保留地区筛选这条页内上下文。 */
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

      <div className="album-scroll__body">
        {loading ? (
          <div className="card-grid">
            {Array.from({ length: 12 }).map((_, index) => (
              <div key={index} className="cover-card cover-card--skeleton">
                <div className="cover-card__media" />
                <div className="cover-card__text">
                  <div className="cover-card__sk-line" />
                  <div className="cover-card__sk-line cover-card__sk-line--meta" />
                </div>
              </div>
            ))}
          </div>
        ) : albums.length === 0 ? (
          <div className="card-state">
            <Disc3 size={26} className="album-scroll__empty-icon" />
            <div>暂无新碟数据</div>
          </div>
        ) : (
          <div className="card-grid">
            {albums.map((album) => (
              <CoverCard
                key={album.id}
                title={album.name}
                subtitle={album.artist || undefined}
                cover={album.picUrl}
                onClick={() => onAlbumClick?.(album)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AlbumScroll;
