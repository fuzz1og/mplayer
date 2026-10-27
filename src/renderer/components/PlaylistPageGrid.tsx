import React from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { ListMusic } from 'lucide-react';
import { formatPlayCount } from '@mplayer/core';
import type { DiscoverPlaylist } from '@mplayer/core';
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
          <div key={i} className="card-skeleton card-skeleton--row">
            <div className="skeleton-shimmer card-skeleton__cover--row" />
            <div className="card-skeleton__lines">
              <div className="skeleton-shimmer card-skeleton__line card-skeleton__line--title" />
              <div className="skeleton-shimmer card-skeleton__line card-skeleton__line--desc" />
              <div className="skeleton-shimmer card-skeleton__line card-skeleton__line--meta" />
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
        <div key={pl.id} onClick={() => onPlaylistSelect?.(pl)} className="pl-card">
          <div className="pl-card__cover">
            {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
            <div className="pl-card__placeholder">
              <ListMusic size={34} />
            </div>
            {pl.coverImgUrl && (
              <img
                key={pl.coverImgUrl}
                src={coverThumbUrl(pl.coverImgUrl, COVER_SIZE.thumb)}
                alt={pl.name}
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                className="pl-card__img"
              />
            )}
          </div>
          <div className="pl-card__body">
            <div className="pl-card__name">{pl.name}</div>
            <div className="pl-card__meta">
              {pl.creator.nickname} · {formatPlayCount(pl.playCount)} 次播放 · {pl.trackCount} 首
            </div>
            {pl.description && <div className="pl-card__desc">{pl.description}</div>}
            {pl.tags.length > 0 && (
              <div className="pl-card__tags">
                {pl.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="pl-card__tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default PlaylistPageGrid;
