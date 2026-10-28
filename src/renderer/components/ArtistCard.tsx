import React from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import type { Artist } from '@mplayer/core';
import '@/renderer/styles/songlist.css';

interface ArtistCardProps {
  artist: Artist;
  onClick?: () => void;
}

/** 歌手卡（圆形媒体 + 名称）：歌手列表与内容库「歌手」视角共用。 */
const ArtistCard: React.FC<ArtistCardProps> = ({ artist, onClick }) => (
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
    <div className="artist-card__avatar">
      {artist.picUrl ? (
        <img
          src={coverThumbUrl(artist.picUrl, COVER_SIZE.icon)}
          alt={artist.name}
          className="artist-card__img"
          loading="lazy"
        />
      ) : (
        <div className="artist-card__fallback">{artist.name.charAt(0)}</div>
      )}
    </div>
    <div className="artist-card__name">{artist.name}</div>
  </div>
);

export default ArtistCard;
