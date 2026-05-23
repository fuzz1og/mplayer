import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useLazyLoad } from '@/renderer/hooks/useLazyLoad';
import DiscoverPlaylistCard from '@/renderer/components/DiscoverPlaylistCard';
import type { DiscoverPlaylist } from '@/shared/types/song';
const { ipcRenderer } = window.require('electron');

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
          alignItems: 'center',
          gap: '16px',
          padding: '12px 24px',
          borderBottom: '1px solid var(--divider-color)',
          backgroundColor: 'var(--content-bg)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
          height: '60px',
        }}
      >
        <button
          onClick={() => navigate('/discover')}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            padding: '10px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--text-secondary)',
            transition: 'all 0.2s ease',
            fontSize: '14px',
            fontWeight: 500,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <ArrowLeft size={16} />
          <span>返回</span>
        </button>
        <h1
          style={{
            fontSize: '20px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            flex: 1,
            margin: 0,
            textAlign: 'center',
          }}
        >
          热门歌单
        </h1>
        <div style={{ width: '140px' }} />
      </div>

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
              borderRadius: '16px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              transition: 'all 0.2s ease',
              backgroundColor: currentCat === cat ? 'var(--accent-color)' : 'var(--hover-bg)',
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
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎵</div>
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
