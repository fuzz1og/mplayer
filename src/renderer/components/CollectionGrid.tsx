import React, { useMemo } from 'react';
import { User } from 'lucide-react';
import type { Song } from '@mplayer/core';
import AlbumGrid from '@/renderer/components/AlbumGrid';
import ArtistCard from '@/renderer/components/ArtistCard';
import { collectAlbums, collectArtists } from '@/renderer/utils/libraryCollections';
import '@/renderer/styles/songlist.css';

interface CollectionGridProps {
  view: 'albums' | 'artists';
  songs: Song[];
  /**
   * 卡片点击即播放该组歌曲：内容库的聚合专辑/歌手没有源 id（Song 不带 albumId/artistId），
   * 无法拼出 /album/:id、/artist/:id 的有效详情，所以网格是「按组播放」而不是详情入口。
   */
  onPlayCollection: (songs: Song[], index: number) => void;
}

/** 内容库的「专辑 / 歌手」视角：从同一批歌曲聚合，网格复用 AlbumGrid 与歌手卡。 */
const CollectionGrid: React.FC<CollectionGridProps> = ({ view, songs, onPlayCollection }) => {
  const albumGroups = useMemo(() => collectAlbums(songs), [songs]);
  const artistGroups = useMemo(() => collectArtists(songs), [songs]);

  if (view === 'albums') {
    if (albumGroups.length === 0) {
      return (
        <div className="card-state">
          <div>还没有可归组的专辑</div>
        </div>
      );
    }
    const byId = new Map(albumGroups.map((group) => [group.id, group]));
    return (
      <AlbumGrid
        albums={albumGroups.map((group) => group.album)}
        showYear={false}
        onAlbumClick={(album) => {
          const group = byId.get(album.id);
          if (group) onPlayCollection(group.songs, 0);
        }}
      />
    );
  }

  if (artistGroups.length === 0) {
    return (
      <div className="card-state">
        <User size={26} className="card-state__icon" aria-hidden="true" />
        <div>还没有可归组的歌手</div>
      </div>
    );
  }
  return (
    <div className="artists__grid">
      {artistGroups.map((group) => (
        <ArtistCard
          key={group.id}
          artist={group.artist}
          meta={`${group.songs.length} 首`}
          onClick={() => onPlayCollection(group.songs, 0)}
        />
      ))}
    </div>
  );
};

export default CollectionGrid;
