import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import SongList from '@/renderer/components/SongList';
import AlbumGrid from '@/renderer/components/AlbumGrid';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { searchService } from '@/renderer/services/searchService';
import { getCachedArtistMeta } from '@/renderer/services/artistMetaCache';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import type { Song, Album } from '@mplayer/core';
const { ipcRenderer } = window.require('electron');

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
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);

  useEffect(() => {
    const loadSongs = async () => {
      if (!artistId) return;
      setLoading(true);
      try {
        const data = await callMusicApi('getNeteaseArtistSongs', artistId, 0, 50, order);
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
  const [albumsTotal, setAlbumsTotal] = useState(0);
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
    } else {
      setAlbumsLoadingMore(true);
    }
    try {
      const offset = reset ? 0 : albumsOffsetRef.current;
      const { albums: page, total: pageTotal, more } = await callMusicApi('getArtistAlbums', artistId, offset, ALBUM_PAGE_SIZE);
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

  const handlePlay = async (song: Song) => {
    const keyword = `${song.name} ${song.artist}`;
    const searchResults = await callMusicApi('searchSongsRouted', keyword, 1, 'netease');
    if (searchResults.length > 0) {
      await play(searchResults[0]);
    }
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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {loading ? (
          <div>
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 16px',
                  borderRadius: '6px',
                  marginBottom: '8px',
                }}
              >
                <div style={{ width: '50px', textAlign: 'center' }}>
                  <div className="skeleton-shimmer" style={{
                    width: '20px', height: '14px', borderRadius: '2px',
                    margin: '0 auto',
                  }} />
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="skeleton-shimmer" style={{
                    width: '40px', height: '40px', borderRadius: '4px',
                  }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton-shimmer" style={{
                      width: '70%', height: '14px', borderRadius: '2px',
                      marginBottom: '4px',
                    }} />
                    <div className="skeleton-shimmer" style={{
                      width: '50%', height: '12px', borderRadius: '2px',
                      animationDelay: '0.1s',
                    }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
              <div
                style={{
                  width: '100px', height: '100px', borderRadius: '50%',
                  overflow: 'hidden', flexShrink: 0,
                  backgroundColor: 'var(--hover-bg)',
                  border: '2px solid var(--border-color)',
                }}
              >
                {displayPic ? (
                  <img
                    src={displayPic}
                    alt={displayName || ''}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '32px', color: 'var(--text-tertiary)',
                    }}
                  >
                    {displayName?.charAt(0) || '?'}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  {displayName || `歌手 (ID: ${artistId})`}
                </div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span>
                    {activeTab === 'albums'
                      ? `共 ${albumsTotal || '--'} 张专辑`
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
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: '12px',
                        color: 'var(--accent-color)',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                    >
                      <Search size={12} />
                      换源获取更多歌曲
                    </button>
                  )}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setActiveTab(tab.key);
                      if (tab.key !== 'albums') setOrder(tab.key);
                    }}
                    style={{
                      padding: '6px 16px',
                      borderRadius: '16px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: activeTab === tab.key ? 600 : 400,
                      color: activeTab === tab.key ? 'white' : 'var(--text-secondary)',
                      backgroundColor: activeTab === tab.key ? 'var(--accent-color)' : 'var(--hover-bg)',
                      transition: 'all 0.15s ease',
                    }}
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
                  <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-tertiary)', fontSize: '13px' }}>加载中...</div>
                )}
                {!albumsHasMore && albums.length > 0 && (
                  <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                    已加载全部 {albums.length} 张专辑
                  </div>
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
