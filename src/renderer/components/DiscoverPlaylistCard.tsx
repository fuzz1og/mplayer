import React from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { useNavigate } from 'react-router-dom';
import type { DiscoverPlaylist } from '@mplayer/core';
import { formatPlayCount } from '@mplayer/core';
import '@/renderer/styles/songlist.css';

interface DiscoverPlaylistCardProps {
  playlist: DiscoverPlaylist;
}

const DiscoverPlaylistCard: React.FC<DiscoverPlaylistCardProps> = ({ playlist }) => {
  const navigate = useNavigate();

  return (
    <div className="dpcard" onClick={() => navigate(`/discover-playlist/${playlist.id}`)}>
      <div className="dpcard__cover">
        <img
          src={coverThumbUrl(playlist.coverImgUrl, COVER_SIZE.thumb)}
          alt={playlist.name}
          loading="lazy"
          className="dpcard__img"
        />
        <div className="dpcard__count">
          ▶ {formatPlayCount(playlist.playCount)}
        </div>
      </div>
      <div className="dpcard__body">
        <div className="dpcard__name">
          {playlist.name}
        </div>
      </div>
    </div>
  );
};

export default React.memo(DiscoverPlaylistCard);
