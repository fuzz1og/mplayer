import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ListMusic } from 'lucide-react';
import { usePageTitleStore } from '@/renderer/store/pageTitleStore';
import { useLazyLoad } from '@/renderer/hooks/useLazyLoad';
import DiscoverPlaylistCard from '@/renderer/components/DiscoverPlaylistCard';
import type { DiscoverPlaylist } from '@mplayer/core';
const { ipcRenderer } = window.require('electron');

const CATEGORIES = [
  '全部', '流行', '摇滚', '民谣', '电子', '说唱',
  '轻音乐', '爵士', '古典', 'R&B', '乡村', '小清新',
  '影视原声', '动漫', '怀旧', '治愈'
];

const PAGE_SIZE = 35;

const DiscoverPlaylistListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const currentCat = searchParams.get('cat') || '全部';
  const [playlists, setPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // 标题上报到 TopBar 右侧,卸载时清空
  useEffect(() => {
    usePageTitleStore.getState().setTitle(`热门歌单 · ${currentCat}`);
    return () => usePageTitleStore.getState().setTitle('');
  }, [currentCat]);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const loadPlaylists = useCallback(async (cat: string, newOffset: number, append: boolean) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const result = await ipcRenderer.invoke(
        'musicApi:getNeteasePlaylists',
        cat,
        'hot',
        newOffset,
        PAGE_SIZE
      );

      const data = result.success ? result.data : { playlists: [], total: 0, more: false };

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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          gap: '8px',
          padding: '12px 24px',
          borderBottom: '1px solid var(--divider-color)',
          overflowX: 'auto',
          backgroundColor: 'var(--content-bg)',
          flexShrink: 0,
        }}
      >
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => handleCategoryChange(cat)}
            style={{
              padding: '6px 16px',
              borderRadius: '20px',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              transition: 'all 0.2s ease',
              background: currentCat === cat ? 'var(--accent-color)' : 'transparent',
              color: currentCat === cat ? 'white' : 'var(--text-secondary)',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {loading ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '20px',
            }}
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={`skeleton-${i}`}>
                <div
                  style={{
                    paddingTop: '100%',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                    backgroundSize: '200% 200%',
                    animation: 'skeletonLoading 1.5s ease-in-out infinite',
                  }}
                />
                <div
                  style={{
                    height: '14px',
                    marginTop: '8px',
                    borderRadius: '2px',
                    background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                    backgroundSize: '200% 200%',
                    animation: 'skeletonLoading 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            ))}
            <style>{`
              @keyframes skeletonLoading {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
              }
            `}</style>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '20px',
              }}
            >
              {playlists.map(playlist => (
                <DiscoverPlaylistCard key={playlist.id} playlist={playlist} />
              ))}
            </div>

            {hasMore && (
              <div ref={triggerRef} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                {loadingMore ? '加载中...' : '上滑加载更多'}
              </div>
            )}
            {!hasMore && playlists.length > 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                没有更多歌单了
              </div>
            )}
            {!loading && playlists.length === 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '60px 20px',
                  color: 'var(--text-tertiary)',
                }}
              >
                <ListMusic size={26} style={{ marginBottom: '12px', color: 'var(--text-tertiary)' }} />
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
