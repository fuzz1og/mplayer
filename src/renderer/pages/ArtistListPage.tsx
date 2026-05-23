import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import type { Artist } from '@/shared/types/song';
const { ipcRenderer } = window.require('electron');

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

const INITIALS = [
  { label: '全部', value: '' },
  { label: 'A', value: 'a' }, { label: 'B', value: 'b' }, { label: 'C', value: 'c' },
  { label: 'D', value: 'd' }, { label: 'E', value: 'e' }, { label: 'F', value: 'f' },
  { label: 'G', value: 'g' }, { label: 'H', value: 'h' }, { label: 'I', value: 'i' },
  { label: 'J', value: 'j' }, { label: 'K', value: 'k' }, { label: 'L', value: 'l' },
  { label: 'M', value: 'm' }, { label: 'N', value: 'n' }, { label: 'O', value: 'o' },
  { label: 'P', value: 'p' }, { label: 'Q', value: 'q' }, { label: 'R', value: 'r' },
  { label: 'S', value: 's' }, { label: 'T', value: 't' }, { label: 'U', value: 'u' },
  { label: 'V', value: 'v' }, { label: 'W', value: 'w' }, { label: 'X', value: 'x' },
  { label: 'Y', value: 'y' }, { label: 'Z', value: 'z' },
  { label: '#', value: '#' },
];

const PAGE_SIZE = 100;

function letterToInitial(letter: string): number {
  if (!letter) return -1;
  if (letter === '#') return 37;
  return letter.charCodeAt(0) - 'a'.charCodeAt(0);
}

const ArtistCard: React.FC<{ artist: Artist; onClick: () => void }> = ({ artist, onClick }) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
      padding: '16px 12px', borderRadius: '12px', cursor: 'pointer',
      transition: 'all 0.2s ease', backgroundColor: 'var(--content-bg)',
      border: '1px solid var(--border-color)',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-4px)';
      e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
      e.currentTarget.style.borderColor = 'var(--accent-color)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = 'none';
      e.currentTarget.style.borderColor = 'var(--border-color)';
    }}
  >
    <div
      style={{
        width: '80px', height: '80px', borderRadius: '50%',
        overflow: 'hidden', backgroundColor: 'var(--hover-bg)', flexShrink: 0,
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
  const [category, setCategory] = useState(0);
  const [initialFilter, setInitialFilter] = useState('');
  const loadingMoreRef = useRef(false);

  const currentCat = CATEGORIES[category];
  const isAllMode = currentCat.id === 0;

  // "全部" tab: 使用 API 分页加载
  const loadAllArtists = useCallback(async (initial: string, reset: boolean) => {
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
      const apiInitial = letterToInitial(initial);
      const r = await ipcRenderer.invoke('musicApi:getNeteaseArtists', 0, currentOffset, PAGE_SIZE, apiInitial);
      const data = r.success ? r.data : { artists: [], more: false };
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
      const r = await ipcRenderer.invoke('musicApi:getNeteaseArtists', catId);
      const data = r.success ? r.data : { artists: [], more: false };
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
    setInitialFilter('');
    if (isAllMode) {
      loadAllArtists('', true);
    } else {
      loadCategoryArtists(currentCat.id);
    }
  }, [category]);

  // "全部" tab: 切换字母筛选时重新加载
  useEffect(() => {
    if (isAllMode) {
      loadAllArtists(initialFilter, true);
    }
  }, [initialFilter]);

  // "全部" tab: 滚动到底加载更多
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !isAllMode) return;

    const handleScroll = () => {
      if (loading || loadingMore || !hasMore) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        loadAllArtists(initialFilter, false);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isAllMode, loading, loadingMore, hasMore, initialFilter, loadAllArtists]);

  const getPinyinInitial = (name: string): string => {
    const first = name.charAt(0);
    if (/[a-zA-Z]/.test(first)) return first.toLowerCase();
    if (/[0-9]/.test(first)) return '#';
    const py = pinyin(first, { pattern: 'first', toneType: 'none' });
    const ch = py.charAt(0);
    if (ch >= 'a' && ch <= 'z') return ch;
    return '#';
  };

  const handleInitialClick = (value: string) => {
    setInitialFilter(value);
  };

  // 分类 tab 的客户端字母筛选
  const displayed = useMemo(() => {
    if (isAllMode) return artists;
    if (!initialFilter) return artists;
    return artists.filter((a) => {
      const init = getPinyinInitial(a.name);
      if (initialFilter === '#') return init === '#';
      return init === initialFilter;
    });
  }, [artists, initialFilter, isAllMode]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '16px',
          padding: '12px 24px', borderBottom: '1px solid var(--divider-color)',
          backgroundColor: 'var(--content-bg)', height: '60px',
        }}
      >
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0, whiteSpace: 'nowrap' }}>
          歌手
        </h1>
      </div>

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '10px 24px', borderBottom: '1px solid var(--divider-color)',
          backgroundColor: 'var(--content-bg)', flexWrap: 'wrap',
        }}
      >
        {CATEGORIES.map((cat, idx) => (
          <button
            key={cat.id}
            onClick={() => setCategory(idx)}
            style={{
              padding: '4px 14px', borderRadius: '14px', border: 'none',
              cursor: 'pointer', fontSize: '12px',
              fontWeight: category === idx ? 600 : 400,
              color: category === idx ? 'white' : 'var(--text-secondary)',
              backgroundColor: category === idx ? 'var(--accent-color)' : 'var(--hover-bg)',
              transition: 'all 0.15s ease',
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {!isAllMode && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '6px 24px', borderBottom: '1px solid var(--divider-color)',
            backgroundColor: 'var(--content-bg)', flexWrap: 'wrap',
          }}
        >
          {INITIALS.map((init) => (
            <button
              key={init.value}
              onClick={() => handleInitialClick(init.value)}
              style={{
                padding: '2px 8px', borderRadius: '4px', border: 'none',
                cursor: 'pointer', fontSize: '12px',
                fontWeight: initialFilter === init.value ? 600 : 400,
                color: initialFilter === init.value ? 'var(--accent-color)' : 'var(--text-tertiary)',
                backgroundColor: initialFilter === init.value ? 'rgba(116,185,255,0.12)' : 'transparent',
                transition: 'all 0.15s ease',
                fontFamily: init.label === '全部' ? 'inherit' : 'monospace',
              }}
              onMouseEnter={(e) => {
                if (initialFilter !== init.value) e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
              }}
              onMouseLeave={(e) => {
                if (initialFilter !== init.value) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {init.label}
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '16px' }}>
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                padding: '16px 12px', borderRadius: '12px',
                backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)',
              }}>
                <div style={{
                  width: '80px', height: '80px', borderRadius: '50%',
                  backgroundColor: 'var(--hover-bg)', animation: 'pulse 1.5s ease-in-out infinite',
                }} />
                <div style={{
                  width: '60%', height: '14px', borderRadius: '4px',
                  backgroundColor: 'var(--hover-bg)', animation: 'pulse 1.5s ease-in-out infinite',
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
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎤</div>
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
                  onClick={() => navigate(`/artist/${artist.id}`, { state: { name: artist.name, pic: artist.picUrl } })}
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
