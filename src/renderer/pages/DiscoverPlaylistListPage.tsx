import React, { useState, useEffect, useCallback } from 'react';
import '../styles/page-discover.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ListMusic } from 'lucide-react';
import { useLazyLoad } from '@/renderer/hooks/useLazyLoad';
import DiscoverPlaylistCard from '@/renderer/components/DiscoverPlaylistCard';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import type { DiscoverPlaylist } from '@mplayer/core';

const CATEGORIES = [
  '全部', '流行', '摇滚', '民谣', '电子', '说唱',
  '轻音乐', '爵士', '古典', 'R&B', '乡村', '小清新',
  '影视原声', '动漫', '怀旧', '治愈'
];

const PAGE_SIZE = 35;

const DiscoverPlaylistListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentCat = searchParams.get('cat') || '全部';
  const [playlists, setPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const loadPlaylists = useCallback(async (cat: string, newOffset: number, append: boolean) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const data = await callMusicApi('getPlaylists', 'netease', cat, 'hot', newOffset, PAGE_SIZE);

      if (append) {
        setPlaylists(prev => [...prev, ...data.playlists]);
      } else {
        setPlaylists(data.playlists);
      }

      setHasMore(data.more);
      setOffset(newOffset + PAGE_SIZE);
    } catch (error) {
      console.error('加载歌单列表失败:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setPlaylists([]);
    setOffset(0);
    setHasMore(true);
    loadPlaylists(currentCat, 0, false);
  }, [currentCat, loadPlaylists]);

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      loadPlaylists(currentCat, offset, true);
    }
  }, [currentCat, offset, loadingMore, hasMore, loadPlaylists]);

  const { triggerRef } = useLazyLoad({
    onLoadMore: handleLoadMore,
    hasMore,
    loading: loadingMore,
  });

  const handleCategoryChange = (cat: string) => {
    setSearchParams({ cat });
  };

  return (
    <div className="discover-page">
      <div className="discover-topbar discover-topbar--shadow">
        <button
          onClick={() => navigate('/discover')}
          className="discover-back discover-back--action"
        >
          <ArrowLeft size={16} />
          <span>返回</span>
        </button>
        <h1 className="discover-topbar__title">
          热门歌单
        </h1>
        <div className="discover-topbar__spacer" />
      </div>

      <div className="discover-cats">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => handleCategoryChange(cat)}
            className={`discover-chip discover-chip--medium${currentCat === cat ? ' discover-chip--active' : ''}`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="discover-scroll-area">
        {loading ? (
          <div className="discover-grid">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={`skeleton-${i}`}>
                <div className="discover-sk-cover" />
                <div className="discover-sk-line" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="discover-grid">
              {playlists.map(playlist => (
                <DiscoverPlaylistCard key={playlist.id} playlist={playlist} />
              ))}
            </div>

            {hasMore && (
              <div ref={triggerRef} className="discover-note">
                {loadingMore ? '加载中...' : ''}
              </div>
            )}
            {!hasMore && playlists.length > 0 && (
              <div className="discover-note">
                没有更多歌单了
              </div>
            )}
            {!loading && playlists.length === 0 && (
              <div className="discover-empty">
                <ListMusic size={26} className="discover-empty__icon" />
                <div>暂无歌单数据</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DiscoverPlaylistListPage;
