import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { DiscoverPlaylist } from '@mplayer/core';
import { formatPlayCount } from '@mplayer/core';
import CoverCard from '@/renderer/components/CoverCard';

interface DiscoverPlaylistCardProps {
  playlist: DiscoverPlaylist;
}

/** 发现页歌单卡：与歌单广场、推荐歌单共用同一张内容卡，点击进入歌单详情。 */
const DiscoverPlaylistCard: React.FC<DiscoverPlaylistCardProps> = ({ playlist }) => {
  const navigate = useNavigate();

  return (
    <CoverCard
      title={playlist.name}
      subtitle={playlist.creator.nickname || undefined}
      cover={playlist.coverImgUrl}
      badge={playlist.playCount ? formatPlayCount(playlist.playCount) : undefined}
      onClick={() => navigate(`/discover-playlist/${playlist.id}`)}
    />
  );
};

export default React.memo(DiscoverPlaylistCard);
