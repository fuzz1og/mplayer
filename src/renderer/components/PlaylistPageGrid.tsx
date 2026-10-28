import React from 'react';
import { ListMusic } from 'lucide-react';
import { formatPlayCount } from '@mplayer/core';
import type { DiscoverPlaylist } from '@mplayer/core';
import CoverCard from '@/renderer/components/CoverCard';
import '@/renderer/styles/songlist.css';

interface PlaylistPageGridProps {
  playlists: DiscoverPlaylist[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPlaylistSelect?: (playlist: DiscoverPlaylist) => void;
  /**
   * 空态文案（#415）。发现页一级「歌单」= 广场分类列表、搜索结果页二级「歌单」=
   * 关键词搜索，两者语义不同；搜索侧必须换文案，否则用户会以为两者等价。
   */
  emptyText?: string;
}

const SKELETON_COUNT = 6;

const PlaylistPageGrid: React.FC<PlaylistPageGridProps> = ({ playlists, loading, error, onRetry, onPlaylistSelect, emptyText = '暂无歌单' }) => {
  if (loading) {
    return (
      <div className="card-grid card-grid--playlist">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div key={i} className="cover-card cover-card--skeleton">
            <div className="cover-card__media" />
            <div className="cover-card__text">
              <div className="cover-card__sk-line" />
              <div className="cover-card__sk-line cover-card__sk-line--meta" />
            </div>
          </div>
        ))}
      </div>
    );
  }

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

  if (playlists.length === 0) {
    return (
      <div className="card-state">
        <ListMusic size={26} className="card-state__icon" />
        <div>{emptyText}</div>
      </div>
    );
  }

  return (
    <div className="card-grid card-grid--playlist">
      {playlists.map((pl) => (
        <CoverCard
          key={pl.id}
          title={pl.name}
          subtitle={[pl.creator.nickname, pl.trackCount ? `${pl.trackCount} 首` : ''].filter(Boolean).join(' · ') || undefined}
          cover={pl.coverImgUrl}
          badge={pl.playCount ? formatPlayCount(pl.playCount) : undefined}
          onClick={() => onPlaylistSelect?.(pl)}
        />
      ))}
    </div>
  );
};

export default PlaylistPageGrid;
