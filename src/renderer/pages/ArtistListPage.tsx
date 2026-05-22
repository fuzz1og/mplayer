import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import type { Artist } from '@/shared/types/song';
const { ipcRenderer } = window.require('electron');

const CATEGORIES = [
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
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState(0);
  const [initialFilter, setInitialFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Artist[] | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const currentCat = CATEGORIES[category];

  const loadArtists = useCallback(async (catId: number) => {
    setLoading(true);
    setSearchResults(null);
    setSearchText('');
    try {
      const r = await ipcRenderer.invoke('musicApi:getNeteaseArtists', catId);
      const data = r.success ? r.data : { artists: [], more: false };
      setArtists(data.artists);
    } catch (err) {
      console.error('加载歌手失败:', err);
      setArtists([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentCat) loadArtists(currentCat.id);
  }, [category]);

  const getPinyinInitial = (name: string): string => {
    const first = name.charAt(0);
    if (/[a-zA-Z]/.test(first)) return first.toLowerCase();
    if (/[0-9]/.test(first)) return '#';
    const py = pinyin(first, { pattern: 'first', toneType: 'none' });
    const ch = py.charAt(0);
    if (ch >= 'a' && ch <= 'z') return ch;
    return '#';
  };

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const r = await ipcRenderer.invoke('musicApi:searchArtists', q.trim(), 30);
      const data = r.success ? r.data : [];
      setSearchResults(data);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchText(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.trim()) {
      setSearching(true);
      searchTimerRef.current = setTimeout(() => doSearch(value), 400);
    } else {
      setSearchResults(null);
      setSearching(false);
    }
  };

  const displayed = useMemo(() => {
    if (searchResults !== null) return searchResults;
    if (!initialFilter) return artists;
    return artists.filter((a) => {
      const init = getPinyinInitial(a.name);
      if (initialFilter === '#') return init === '#';
      return init === initialFilter;
    });
  }, [artists, initialFilter, searchResults]);

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
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', flex: 1, maxWidth: '320px',
            backgroundColor: 'var(--bg-color)', borderRadius: '20px', padding: '6px 14px',
            border: '1px solid var(--border-color)',
          }}
        >
          <Search size={16} color="var(--text-tertiary)" />
          <input
            type="text"
            placeholder="搜索歌手..."
            value={searchText}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: '13px', color: 'var(--text-primary)',
            }}
          />
          {searching && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} />}
        </div>
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
            onClick={() => { setInitialFilter(init.value); setSearchText(''); setSearchResults(null); }}
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

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
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
              {searchResults !== null ? '未找到相关歌手' : '没有匹配的歌手'}
            </div>
            <div style={{ fontSize: '13px' }}>
              {searchResults !== null ? '尝试换个关键词搜索' : '切换分类或选择其他字母'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '16px' }}>
            {displayed.map((artist) => (
              <ArtistCard
                key={artist.id}
                artist={artist}
                onClick={() => navigate(`/artist/${artist.id}`, { state: { name: artist.name, pic: artist.picUrl } })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ArtistListPage;
