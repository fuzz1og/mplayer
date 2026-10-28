import React, { useState, useEffect, useCallback, useRef } from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import SongList from '@/renderer/components/SongList';
import '@/renderer/styles/songlist.css';
import AlbumGrid from '@/renderer/components/AlbumGrid';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { searchService } from '@/renderer/services/searchService';
import { getCachedArtistMeta } from '@/renderer/services/artistMetaCache';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { resolvePlayableVersionForDesktop } from '@/renderer/services/playableVersionAdapter';
import type { Song, Album } from '@mplayer/core';
const ipcRenderer = window.electronAPI;

const ALBUM_PAGE_SIZE = 30;

type TabKey = 'hot' | 'time' | 'albums';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'hot', label: '热门歌曲' },
  { key: 'time', label: '最新歌曲' },
  { key: 'albums', label: '专辑' },
];

const ArtistDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const artistId = id || '';
  // 路由 state 只在 push 时携带,返回导航会丢失 → 用入口写入的缓存兜底
  const cachedMeta = getCachedArtistMeta(artistId);
  const stateName = (location.state as any)?.name as string | undefined;
  const statePic = (location.state as any)?.pic as string | undefined;
  const displayName = stateName || cachedMeta?.name;
  const displayPic = statePic || cachedMeta?.pic || '';

  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  const [total, setTotal] = useState(0);
  const [order, setOrder] = useState<'hot' | 'time'>('hot');
  const [activeTab, setActiveTab] = useState<TabKey>('hot');

  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);

  useEffect(() => {
    const loadSongs = async () => {
      if (!artistId) return;
      setLoading(true);
      try {
        const data = await callMusicApi('getArtistSongs', 'netease', artistId, 0, 50, order);
        setSongs(data.songs);
        setTotal(data.total);
      } catch (error) {
        console.error('获取歌手歌曲失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadSongs();
  }, [artistId, order]);

  // ── 专辑 tab:发行年表(分页 + 无限滚动) ──
  const [albums, setAlbums] = useState<Album[]>([]);
  // null = 上游未给可信总数（还有下一页时 total 会被 limit 截断/缺失，见 core #417）
  const [albumsTotal, setAlbumsTotal] = useState<number | null>(null);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsLoadingMore, setAlbumsLoadingMore] = useState(false);
  const [albumsHasMore, setAlbumsHasMore] = useState(false);
  const [albumsError, setAlbumsError] = useState<string | null>(null);
  const albumsOffsetRef = useRef(0);
  const albumsLoadingRef = useRef(false);
  const albumsHasMoreRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchAlbums = useCallback(async (reset: boolean) => {
    if (!artistId || albumsLoadingRef.current) return;
    if (!reset && !albumsHasMoreRef.current) return;
    albumsLoadingRef.current = true;
    if (reset) {
      setAlbumsLoading(true);
      setAlbumsError(null);
      setAlbumsTotal(null);
    } else {
      setAlbumsLoadingMore(true);
    }
    try {
      const offset = reset ? 0 : albumsOffsetRef.current;
      const { albums: page, total: pageTotal, more, ok } = await callMusicApi('getArtistAlbums', 'netease', artistId, offset, ALBUM_PAGE_SIZE);
      // #417：抓取失败与「该歌手确实零专辑」在 core 层已可区分（ok），失败走错误态而不是空态
      if (!ok) throw new Error('加载专辑失败');
      setAlbums(prev => reset ? page : [...prev, ...page]);
      setAlbumsTotal(pageTotal);
      albumsOffsetRef.current = offset + ALBUM_PAGE_SIZE;
      albumsHasMoreRef.current = more;
      setAlbumsHasMore(more);
    } catch (e: any) {
      console.error('获取歌手专辑失败:', e);
      if (reset) setAlbumsError(e?.message || '加载专辑失败');
    } finally {
      albumsLoadingRef.current = false;
      setAlbumsLoading(false);
      setAlbumsLoadingMore(false);
    }
  }, [artistId]);

  // 切到专辑 tab(或换歌手)时从第一页开始
  useEffect(() => {
    if (activeTab === 'albums') fetchAlbums(true);
  }, [activeTab, artistId, fetchAlbums]);

  useInfiniteScroll(scrollRef, {
    onLoadMore: () => fetchAlbums(false),
    loading: albumsLoading || albumsLoadingMore,
    hasMore: activeTab === 'albums' && albumsHasMore,
  });

  const handlePlay = async (song: Song, queue: Song[], index: number) => {
    // #697：队列与索引由列表回传，页面统一负责 setQueue + 播放
    setCurrentPlaylist(queue, index);
    // #639 C3：补一个**精确匹配**的可播版本（判据在 core）。此前把搜索源写死 `'netease'` 并直接取
    // `searchResults[0]`——换源后的歌（本无 url）会被拿去网易搜，是错的；现在用歌曲自身来源 + 精确匹配守卫。
    await play(await resolvePlayableVersionForDesktop(song));
  };

  const handleToggleFavorite = async (song: Song) => {
    try {
      await toggleFavorite(song);
    } catch (error) {
      console.error('收藏操作失败:', error);
    }
  };

  const handleDownload = async (song: Song) => {
    try {
      await ipcRenderer.invoke('download:start', song);
    } catch (error) {
      console.error('下载失败:', error);
    }
  };

  const handleAlbumClick = (album: Album) => {
    navigate(`/album/${album.id}`, { state: { name: album.name, picUrl: album.picUrl, artist: album.artist } });
  };

  return (
    <div className="artist">
      <div ref={scrollRef} className="artist__scroll">
        {loading ? (
          <div>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="detail-skeleton__row">
                <div className="detail-skeleton__index">
                  <div className="skeleton-shimmer detail-skeleton__index-bar" />
                </div>
                <div className="detail-skeleton__main">
                  <div className="skeleton-shimmer detail-skeleton__cover" />
                  <div className="detail-skeleton__lines">
                    <div className="skeleton-shimmer detail-skeleton__title" />
                    <div className="skeleton-shimmer detail-skeleton__sub" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="artist__head">
              <div className="artist__avatar">
                {displayPic ? (
                  <img
                    src={coverThumbUrl(displayPic, COVER_SIZE.thumb)}
                    alt={displayName || ''}
                    className="artist__avatar-img"
                  />
                ) : (
                  <div className="artist__avatar-fallback">{displayName?.charAt(0) || '?'}</div>
                )}
              </div>
              <div className="artist__info">
                <div className="artist__name">{displayName || `歌手 (ID: ${artistId})`}</div>
                <div className="artist__meta">
                  <span>
                    {activeTab === 'albums'
                      ? albumsTotal !== null
                        ? `共 ${albumsTotal} 张专辑`
                        : `已加载 ${albums.length} 张`
                      : `共 ${total || '--'} 首歌曲`}
                  </span>
                  {activeTab !== 'albums' && (
                    <button
                      onClick={async () => {
                        if (displayName) {
                          await searchService.search(displayName);
                          navigate('/discover');
                        }
                      }}
                      className="artist__search-more"
                    >
                      <Search size={12} />
                      换源获取更多歌曲
                    </button>
                  )}
                </div>
              </div>
              <div className="artist__tabs">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setActiveTab(tab.key);
                      if (tab.key !== 'albums') setOrder(tab.key);
                    }}
                    className="artist__tab"
                    data-active={activeTab === tab.key || undefined}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {activeTab === 'albums' ? (
              <div>
                <AlbumGrid
                  albums={albums}
                  loading={albumsLoading}
                  error={albumsError}
                  onRetry={() => fetchAlbums(true)}
                  onAlbumClick={handleAlbumClick}
                  showYear={false}
                  groupByYear={true}
                />
                {albumsLoadingMore && (
                  <div className="artist__more">加载中...</div>
                )}
                {!albumsHasMore && albums.length > 0 && (
                  <div className="artist__more">已加载全部 {albums.length} 张专辑</div>
                )}
              </div>
            ) : (
              <SongList
                songs={songs}
                currentSongId={currentSong?.id}
                isPlaying={isPlaying}
                favoriteIds={favoriteIds}
                onPlay={handlePlay}
                onSwap={(original, swapped) => setSongs(prev => prev.map(s => s.id === original.id ? swapped : s))}
                onToggleFavorite={handleToggleFavorite}
                onDownload={handleDownload}
                showHeader={true}
                showIndex={true}
                emptyText="暂无歌曲数据"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ArtistDetailPage;
