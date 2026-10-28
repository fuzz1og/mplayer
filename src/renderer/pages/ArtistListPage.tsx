import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mic2 } from 'lucide-react';
import type { Artist } from '@mplayer/core';
import '@/renderer/styles/songlist.css';
import { cacheArtistMeta } from '@/renderer/services/artistMetaCache';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { resolvePlayableVersionForDesktop } from '@/renderer/services/playableVersionAdapter';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { toast } from '@/renderer/services/toastStore';
import ArtistCard from '@/renderer/components/ArtistCard';

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

const ArtistListPage: React.FC = () => {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
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
      const data = await callMusicApi('getArtists', 'netease', 0, currentOffset, PAGE_SIZE);
      const nextArtists = data?.artists ?? [];
      setArtists(prev => reset ? nextArtists : [...prev, ...nextArtists]);
      setHasMore(data?.more ?? false);
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
      const data = await callMusicApi('getArtists', 'netease', catId, 0, 100);
      setArtists(data?.artists ?? []);
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

  /** 卡片角落播放：取该歌手热门歌曲建队列（点播契约 D2 由页面落地，列表不自写 playerStore）。 */
  const handlePlayArtist = useCallback(async (artist: Artist) => {
    try {
      const data = await callMusicApi('getArtistSongs', 'netease', artist.id, 0, 50, 'hot');
      if (!data.songs.length) {
        toast.error('该歌手暂无可播放歌曲');
        return;
      }
      setCurrentPlaylist(data.songs, 0);
      await play(await resolvePlayableVersionForDesktop(data.songs[0]));
    } catch (error) {
      console.error('播放歌手热门歌曲失败:', error);
      toast.error('播放失败，请稍后重试');
    }
  }, [play, setCurrentPlaylist]);

  const openArtist = useCallback((artist: Artist) => {
    cacheArtistMeta(artist.id, { name: artist.name, pic: artist.picUrl });
    navigate(`/artist/${artist.id}`, { state: { name: artist.name, pic: artist.picUrl } });
  }, [navigate]);

  const displayed = artists;

  return (
    <div className="artists">
      <div className="artists__cats">
        {CATEGORIES.map((cat, idx) => (
          <button
            key={cat.id}
            onClick={() => setCategory(idx)}
            className="artists__cat"
            data-active={category === idx || undefined}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="artists__scroll">
        {loading ? (
          <div className="artists__grid">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="cover-card cover-card--skeleton">
                <div className="cover-card__media" />
                <div className="cover-card__text">
                  <div className="cover-card__sk-line" />
                  <div className="cover-card__sk-line cover-card__sk-line--meta" />
                </div>
              </div>
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="artists__empty">
            <Mic2 size={26} className="artists__empty-icon" />
            <div className="artists__empty-title">没有匹配的歌手</div>
          </div>
        ) : (
          <>
            <div className="artists__grid">
              {displayed.map((artist) => (
                <ArtistCard
                  key={artist.id}
                  artist={artist}
                  meta={artist.musicSize > 0 ? `${artist.musicSize} 首` : undefined}
                  onClick={() => openArtist(artist)}
                  onPlay={() => { void handlePlayArtist(artist); }}
                />
              ))}
            </div>
            {loadingMore && (
              <div className="artists__more-loading">
                <Loader2 size={20} className="artists__spin" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ArtistListPage;
