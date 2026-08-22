import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mic2 } from 'lucide-react';
import type { Artist } from '@mplayer/core';
import { cacheArtistMeta } from '@/renderer/services/artistMetaCache';
import { callMusicApi } from '@/renderer/services/callMusicApi';

const CATEGORIES = [
  { label: '全部', id: 0 },
  { label: '华语男', id: 1001 },
  { label: '华语女', id: 1002 },
  { label: '华语组合', id: 1003 },
  { label: '欧美男', id: 2001 },
  { label: '欧美女', id: 2002 },
  { label: '欧美组合', id: 2003 },
  { label: '其他', id: 4001 },
  { label: '日本', id: 6001 },
  { label: '韩国', id: 7001 },
];

const PAGE_SIZE = 100;

// 歌手分类持久化:返回导航重挂载后恢复离开时的分类
const CATEGORY_STORAGE_KEY = 'artist_list_category';

function loadSavedCategory(): number {
  const saved = Number(sessionStorage.getItem(CATEGORY_STORAGE_KEY));
  return Number.isInteger(saved) && saved >= 0 && saved < CATEGORIES.length ? saved : 0;
}

const ArtistCard: React.FC<{ artist: Artist; onClick: () => void }> = ({ artist, onClick }) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
      padding: '16px 12px', borderRadius: '8px', cursor: 'pointer',
      transition: 'background-color 0.15s ease, box-shadow 0.15s ease', backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
      e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
      e.currentTarget.style.boxShadow = 'none';
    }}
  >
    <div
      style={{
        width: '80px', height: '80px', borderRadius: '50%',
        overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0,
      }}
    >
      {artist.picUrl ? (
        <img
          src={artist.picUrl}
          alt={artist.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          loading="lazy"
        />
      ) : (
        <div
          style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '28px', color: 'var(--text-tertiary)',
          }}
        >
          {artist.name.charAt(0)}
        </div>
      )}
    </div>
    <div
      style={{
        fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
        textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', width: '100%',
      }}
    >
      {artist.name}
    </div>
  </div>
);

const ArtistListPage: React.FC = () => {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [category, setCategory] = useState(loadSavedCategory);
  const loadingMoreRef = useRef(false);

  // 记录激活分类,返回导航重挂载后恢复
  useEffect(() => {
    sessionStorage.setItem(CATEGORY_STORAGE_KEY, String(category));
  }, [category]);

  const currentCat = CATEGORIES[category];
  const isAllMode = currentCat.id === 0;

  // "全部" tab: 使用 API 分页加载
  const loadAllArtists = useCallback(async (reset: boolean) => {
    if (reset) {
      setLoading(true);
      setArtists([]);
      setHasMore(false);
    } else {
      if (loadingMoreRef.current) return;
      setLoadingMore(true);
    }
    loadingMoreRef.current = true;
    try {
      const currentOffset = reset ? 0 : artists.length;
      const data = await callMusicApi('getNeteaseArtists', 0, currentOffset, PAGE_SIZE, -1);
      setArtists(prev => reset ? data.artists : [...prev, ...data.artists]);
      setHasMore(data.more);
    } catch (err) {
      console.error('加载歌手失败:', err);
      if (reset) setArtists([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [artists.length]);

  // 分类 tab: 使用 HTML 爬取（一次性加载）
  const loadCategoryArtists = useCallback(async (catId: number) => {
    setLoading(true);
    try {
      const data = await callMusicApi('getNeteaseArtists', catId, 0, 100, -1);
      setArtists(data.artists);
      setHasMore(false);
    } catch (err) {
      console.error('加载歌手失败:', err);
      setArtists([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 切换分类
  useEffect(() => {
    if (isAllMode) {
      loadAllArtists(true);
    } else {
      loadCategoryArtists(currentCat.id);
    }
  }, [category]);

  // "全部" tab: 滚动到底加载更多
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !isAllMode) return;

    const handleScroll = () => {
      if (loading || loadingMore || !hasMore) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        loadAllArtists(false);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isAllMode, loading, loadingMore, hasMore, loadAllArtists]);

  const displayed = artists;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 'var(--space-5) var(--space-6)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-5)', flexShrink: 0 }}>
        {CATEGORIES.map((cat, idx) => (
          <button
            key={cat.id}
            onClick={() => setCategory(idx)}
            style={{
              padding: '6px 16px', borderRadius: '20px',
              border: '1px solid var(--border-default)',
              cursor: 'pointer', fontSize: 'var(--text-sm)',
              fontWeight: category === idx ? 600 : 400,
              color: category === idx ? '#fff' : 'var(--text-secondary)',
              background: category === idx ? 'var(--accent)' : 'transparent',
              transition: 'all 0.15s',
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '16px' }}>
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                padding: '16px 12px', borderRadius: '8px',
                backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)',
              }}>
                <div style={{
                  width: '80px', height: '80px', borderRadius: '50%',
                  backgroundColor: 'var(--bg-hover)', animation: 'pulse 1.5s ease-in-out infinite',
                }} />
                <div style={{
                  width: '60%', height: '14px', borderRadius: '4px',
                  backgroundColor: 'var(--bg-hover)', animation: 'pulse 1.5s ease-in-out infinite',
                  animationDelay: '0.1s',
                }} />
              </div>
            ))}
            <style>{`
              @keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
              @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
          </div>
        ) : displayed.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '60px 20px', color: 'var(--text-tertiary)',
          }}>
            <Mic2 size={26} style={{ marginBottom: '12px', color: 'var(--text-tertiary)' }} />
            <div style={{ fontSize: '16px', fontWeight: 500, marginBottom: '6px' }}>
              没有匹配的歌手
            </div>
            <div style={{ fontSize: '13px' }}>
              切换分类或选择其他字母
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '16px' }}>
              {displayed.map((artist) => (
                <ArtistCard
                  key={artist.id}
                  artist={artist}
                  onClick={() => {
                    cacheArtistMeta(artist.id, { name: artist.name, pic: artist.picUrl });
                    navigate(`/artist/${artist.id}`, { state: { name: artist.name, pic: artist.picUrl } });
                  }}
                />
              ))}
            </div>
            {loadingMore && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ArtistListPage;
