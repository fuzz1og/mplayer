import React from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { Play } from 'lucide-react';
import type { Artist } from '@mplayer/core';
import '@/renderer/styles/songlist.css';

interface ArtistCardProps {
  artist: Artist;
  /** 进入歌手详情：卡片整体可聚焦，Enter / Space 与点击同义。 */
  onClick?: () => void;
  /** 卡片角落的快捷播放：没有播放能力时不传，按钮不渲染（不摆死入口）。 */
  onPlay?: () => void;
  /** 副行（如「N 首」）；拿不到就不渲染整行。 */
  meta?: string;
}

/** 歌手卡（圆形媒体 + 名字 + 可选副行）：发现 › 歌手与内容库「歌手」视角共用。 */
const ArtistCard: React.FC<ArtistCardProps> = ({ artist, onClick, onPlay, meta }) => (
  <div
    onClick={onClick}
    className="artist-card"
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    aria-label={onClick ? '歌手 ' + artist.name : undefined}
    onKeyDown={onClick ? (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick();
      }
    } : undefined}
  >
    <div className="artist-card__media">
      {artist.picUrl ? (
        <img
          src={coverThumbUrl(artist.picUrl, COVER_SIZE.thumb)}
          alt={artist.name}
          className="artist-card__img"
          loading="lazy"
        />
      ) : (
        <div className="artist-card__fallback">{artist.name.charAt(0)}</div>
      )}
      {onPlay && (
        <button
          type="button"
          aria-label={`播放歌手 ${artist.name} 的热门歌曲`}
          title="播放热门歌曲"
          className="artist-card__play"
          onClick={(event) => {
            event.stopPropagation();
            onPlay();
          }}
        >
          <Play size={16} aria-hidden="true" />
        </button>
      )}
    </div>
    <div className="artist-card__name">{artist.name}</div>
    {meta ? <div className="artist-card__meta">{meta}</div> : null}
  </div>
);

export default React.memo(ArtistCard);
