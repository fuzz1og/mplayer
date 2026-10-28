import React from 'react';
import type { Artist } from '@mplayer/core';
import CoverCard from '@/renderer/components/CoverCard';

interface ArtistCardProps {
  artist: Artist;
  onClick?: () => void;
}

/** 歌手卡：歌手列表、搜索结果与内容库「歌手」视角共用同一张内容卡（圆形头像）。 */
const ArtistCard: React.FC<ArtistCardProps> = ({ artist, onClick }) => {
  const meta = [
    artist.albumSize ? `专辑 ${artist.albumSize}` : '',
    artist.musicSize ? `歌曲 ${artist.musicSize}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <CoverCard
      shape="circle"
      title={artist.name}
      subtitle={meta || undefined}
      cover={artist.picUrl}
      onClick={onClick}
      ariaLabel={'歌手 ' + artist.name}
    />
  );
};

export default ArtistCard;
