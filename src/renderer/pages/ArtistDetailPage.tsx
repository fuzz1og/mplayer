import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Play, Download, Search, CirclePlus } from 'lucide-react';
import SongList from '@/renderer/components/SongList';
import DetailToolbar from '@/renderer/components/DetailToolbar';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import AlbumGrid from '@/renderer/components/AlbumGrid';
import '@/renderer/styles/songlist.css';
import '@/renderer/styles/detail-page.css';
import { Button, PageHero, Segmented } from '@/renderer/ui';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { useDetailSelection } from '@/renderer/hooks/useDetailSelection';
import { searchService } from '@/renderer/services/searchService';
import { getCachedArtistMeta } from '@/renderer/services/artistMetaCache';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { resolvePlayableVersionForDesktop } from '@/renderer/services/playableVersionAdapter';
import type { Song, Album } from '@mplayer/core';

const ALBUM_PAGE_SIZE = 30;

type TabKey = 'hot' | 'time' | 'albums';

/** 三段是同一页面的次级视图（#694）：hero 内用 Segmented 切，不做压在列表上的第二道横条。 */
const TABS: { key: TabKey; label: string }[] = [
  { key: 'hot', label: '热门歌曲' },
  { key: 'time', label: '最新歌曲' },
  { key: 'albums', label: '专辑' },
];
const TAB_LABELS = TABS.map((tab) => tab.label);
const labelOf = (key: TabKey) => TABS.find((tab) => tab.key === key)?.label ?? TABS[0].label;
const keyOf = (label: string) => TABS.find((tab) => tab.label === label)?.key ?? 'hot';

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
  const [songsError, setSongsError] = useState<string | null>(null);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  const [total, setTotal] = useState(0);
  const [order, setOrder] = useState<'hot' | 'time'>('hot');
  const [activeTab, setActiveTab] = useState<TabKey>('hot');

  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();
  const selection = useDetailSelection(songs, artistId);
  const { visibleSongs, batchMode, selectedIds, setSelectedIds, selectedSongs, visibleSelectedCount } = selection;

  useEffect(() => {
    const loadSongs = async () => {
      if (!artistId) return;
      setLoading(true);
      setSongsError(null);
      try {
        const data = await callMusicApi('getArtistSongs', 'netease', artistId, 0, 50, order);
        setSongs(data.songs);
        setTotal(data.total);
      } catch (error) {
        console.error('获取歌手歌曲失败:', error);
        setSongsError('加载歌手歌曲失败，请稍后重试');
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

  const handlePlay = useCallback(async (song: Song, queue: Song[], index: number) => {
    // #697：队列与索引由列表回传，页面统一负责 setQueue + 播放
    setCurrentPlaylist(queue, index);
    // #639 C3：补一个**精确匹配**的可播版本（判据在 core），不再无条件取搜索首条顶替
    await play(await resolvePlayableVersionForDesktop(song));
  }, [play, setCurrentPlaylist]);

  const handlePlayAll = useCallback(async () => {
    if (songs.length === 0) return;
    setCurrentPlaylist(songs, 0);
    await play(await resolvePlayableVersionForDesktop(songs[0]));
  }, [songs, play, setCurrentPlaylist]);

  const handleDownloadAll = useCallback(() => {
    if (songs.length === 0) return;
    void downloadBatch(songs);
  }, [songs, downloadBatch]);

  const handleSwapMore = useCallback(async () => {
    if (!displayName) return;
    await searchService.search(displayName);
    navigate('/discover');
  }, [displayName, navigate]);

  const handleToggleFavorite = useCallback(async (song: Song) => {
    try {
      await toggleFavorite(song);
    } catch (error) {
      console.error('收藏操作失败:', error);
    }
  }, [toggleFavorite]);

  const handleBatchDownload = useCallback(() => {
    if (selectedSongs.length === 0) return;
    void downloadBatch(selectedSongs);
  }, [selectedSongs, downloadBatch]);

  const handleBatchAddToPlaylist = useCallback(() => {
    if (selectedSongs.length > 0) setAddToPlaylistOpen(true);
  }, [selectedSongs]);

  const handleAlbumClick = useCallback((album: Album) => {
    navigate(`/album/${album.id}`, { state: { name: album.name, picUrl: album.picUrl, artist: album.artist } });
  }, [navigate]);

  const handleTabChange = useCallback((label: string) => {
    const key = keyOf(label);
    setActiveTab(key);
    if (key !== 'albums') setOrder(key);
  }, []);

  const batchActions = useMemo(() => [
    { key: 'download', label: '批量下载', icon: <Download size={12} />, onClick: handleBatchDownload },
    { key: 'playlist', label: '加入歌单', icon: <CirclePlus size={12} />, onClick: handleBatchAddToPlaylist },
  ], [handleBatchDownload, handleBatchAddToPlaylist]);

  const onAlbumsTab = activeTab === 'albums';
  const meta = onAlbumsTab
    ? (albumsTotal !== null ? `共 ${albumsTotal} 张专辑` : `已加载 ${albums.length} 张专辑`)
    : `共 ${total || '--'} 首歌曲`;

  return (
    <div className="detail-page">
      <div ref={scrollRef} className="detail-page__scroll" data-scroll-container>
        <PageHero
          className="detail-page__hero"
          media={
            <div className="detail-page__cover detail-page__cover--round">
              {displayPic ? (
                <img
                  src={coverThumbUrl(displayPic, COVER_SIZE.thumb)}
                  alt={displayName || ''}
                  className="detail-page__cover-img"
                />
              ) : (
                <div className="detail-page__cover-placeholder">{displayName?.charAt(0) || '?'}</div>
              )}
            </div>
          }
          title={displayName || `歌手 (ID: ${artistId})`}
          meta={meta}
          actions={
            <>
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={15} aria-hidden="true" />}
                onClick={() => { void handlePlayAll(); }}
                disabled={songs.length === 0 || loading || onAlbumsTab}
              >
                播放全部
              </Button>
              <Button
                size="sm"
                icon={<Download size={15} aria-hidden="true" />}
                onClick={handleDownloadAll}
                disabled={songs.length === 0 || loading || onAlbumsTab}
              >
                下载全部
              </Button>
              <Button
                size="sm"
                icon={<Search size={15} aria-hidden="true" />}
                onClick={() => { void handleSwapMore(); }}
                disabled={!displayName}
              >
                换源获取更多歌曲
              </Button>
              <Segmented
                className="detail-page__hero-segmented"
                options={TAB_LABELS}
                value={labelOf(activeTab)}
                onChange={handleTabChange}
                ariaLabel="歌手内容视图"
              />
            </>
          }
        />

        <div className="detail-page__list">
          {onAlbumsTab ? (
            <>
              <AlbumGrid
                albums={albums}
                loading={albumsLoading}
                error={albumsError}
                onRetry={() => fetchAlbums(true)}
                onAlbumClick={handleAlbumClick}
                showYear={false}
                groupByYear={true}
              />
              {albumsLoadingMore && <div className="detail-page__note">加载中...</div>}
              {!albumsHasMore && albums.length > 0 && (
                <div className="detail-page__note">已加载全部 {albums.length} 张专辑</div>
              )}
            </>
          ) : (
            <>
              {songsError && songs.length === 0 && <div className="detail-page__error">{songsError}</div>}
              <DetailToolbar
                filterValue={selection.filterQuery}
                onFilterChange={selection.setFilterQuery}
                matchedCount={visibleSongs.length}
                totalCount={songs.length}
                selecting={batchMode}
                onToggleSelecting={selection.toggleBatchMode}
                onSelectAll={selection.selectAllVisible}
                allSelected={selection.allVisibleSelected}
                selectedCount={visibleSelectedCount}
                batchActions={batchActions}
              />
              <SongList
                songs={visibleSongs}
                currentSongId={currentSong?.id}
                isPlaying={isPlaying}
                favoriteIds={favoriteIds}
                onPlay={handlePlay}
                onSwap={(original, swapped) => setSongs(prev => prev.map(s => s.id === original.id ? swapped : s))}
                onToggleFavorite={handleToggleFavorite}
                onDownload={download}
                density="library"
                showDuration
                showAlbum={false}
                showCheckbox={batchMode}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                loading={loading && songs.length === 0}
                emptyText={selection.isFiltering ? `没有匹配「${selection.filterQuery.trim()}」的歌曲` : '暂无歌曲数据'}
              />
            </>
          )}
        </div>
      </div>
      {/* 批量加入歌单：只在有可见已选项时挂载，弹窗按需加载歌单列表 */}
      {batchMode && selectedSongs.length > 0 && (
        <BatchAddToPlaylistModal
          songs={selectedSongs}
          isVisible={addToPlaylistOpen}
          onClose={() => setAddToPlaylistOpen(false)}
        />
      )}
    </div>
  );
};

export default ArtistDetailPage;
