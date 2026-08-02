import React, { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import { Flame, Disc3, ListMusic, Mic2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useSearchStore } from '@/renderer/store/searchStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { usePageTitleStore } from '@/renderer/store/pageTitleStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { searchService } from '@/renderer/services/searchService';
import ChartPanel from '@/renderer/components/ChartPanel';
import GroupedSongList from '@/renderer/components/GroupedSongList';
import SongList from '@/renderer/components/SongList';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import AlbumScroll from '@/renderer/components/AlbumScroll';
import PlaylistPageGrid from '@/renderer/components/PlaylistPageGrid';
import ArtistListPage from '@/renderer/pages/ArtistListPage';
import type { AggregatedSongGroup } from '@/main/services/chartAggregator';
import type { Album, Song, DiscoverPlaylist } from '@mplayer/core';
import type { ApiResponse } from '@/shared/types/ipc';
import { CHART_CACHE_TTL as CHART_TTL } from '../../shared/chart';

const { ipcRenderer } = window.require('electron');

type TabKey = 'charts' | 'albums' | 'playlists' | 'artists';
type AreaKey = 'ALL' | 'ZH' | 'EA' | 'KR' | 'JP';

interface TabDef {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  { key: 'charts', label: '排行榜', icon: <Flame size={16} /> },
  { key: 'albums', label: '新碟上架', icon: <Disc3 size={16} /> },
  { key: 'playlists', label: '歌单', icon: <ListMusic size={16} /> },
  { key: 'artists', label: '歌手', icon: <Mic2 size={16} /> },
];

const SOURCES = ['netease', 'qq', 'kugou'];

const PLAYLIST_CATEGORIES = [
  '全部', '流行', '摇滚', '民谣', '电子', '说唱',
  '轻音乐', '爵士', '古典', 'R&B', '乡村', '小清新',
  '影视原声', '动漫', '怀旧', '治愈'
];

const PLAYLIST_PAGE_SIZE = 30;

interface ChartCache {
  hot: AggregatedSongGroup[] | null;
  new: AggregatedSongGroup[] | null;
  hotTimestamp: number;
  newTimestamp: number;
}

interface TabCache {
  albums: { data: Album[] | null; timestamp: number };
  playlists: { data: DiscoverPlaylist[] | null; timestamp: number };
}

const DiscoverPageV2: React.FC = () => {
  const { currentSong, isPlaying, play } = usePlayerStore();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabKey>('charts');
  const [hotGroups, setHotGroups] = useState<AggregatedSongGroup[]>([]);
  const [newGroups, setNewGroups] = useState<AggregatedSongGroup[]>([]);
  const [hotLoading, setHotLoading] = useState(true);
  const [newLoading, setNewLoading] = useState(true);
  const [hotError, setHotError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);

  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumsArea, setAlbumsArea] = useState<AreaKey>('ALL');
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsError, setAlbumsError] = useState<string | null>(null);

  const [playlistList, setPlaylistList] = useState<DiscoverPlaylist[]>([]);
  const [playlistListLoading, setPlaylistListLoading] = useState(false);
  const [playlistListLoadingMore, setPlaylistListLoadingMore] = useState(false);
  const [playlistListHasMore, setPlaylistListHasMore] = useState(true);
  const [playlistListOffset, setPlaylistListOffset] = useState(0);
  void playlistListOffset;
  const [playlistListError, setPlaylistListError] = useState<string | null>(null);
  const [playlistCategory, setPlaylistCategory] = useState('全部');

  const cacheRef = useRef<ChartCache>({ hot: null, new: null, hotTimestamp: 0, newTimestamp: 0 });
  const tabCacheRef = useRef<TabCache>({
    albums: { data: null, timestamp: 0 },
    playlists: { data: null, timestamp: 0 },
  });
  const mountedRef = useRef(true);
  const playedChartIdRef = useRef<string | null>(null);
  const albumsFetchIdRef = useRef(0);
  const playlistsFetchIdRef = useRef(0);
  const chartsFetchIdRef = useRef({ hot: 0, new: 0 });
  const playlistListOffsetRef = useRef(0);
  const playlistListHasMoreRef = useRef(true);
  const playlistListLoadingMoreRef = useRef(false);

  const fetchChart = useCallback(async (type: 'hot' | 'new') => {
    const fetchId = type === 'hot' ? ++chartsFetchIdRef.current.hot : ++chartsFetchIdRef.current.new;
    const cache = cacheRef.current;
    const cached = type === 'hot' ? cache.hot : cache.new;

    // SWR: cached data stays visible while the background refresh runs
    if (cached) {
      if (type === 'hot') { setHotGroups(cached); setHotLoading(false); }
      else { setNewGroups(cached); setNewLoading(false); }
    } else {
      if (type === 'hot') { setHotLoading(true); setHotError(null); }
      else { setNewLoading(true); setNewError(null); }
    }

    const isCurrentFetch = () => fetchId === (type === 'hot' ? chartsFetchIdRef.current.hot : chartsFetchIdRef.current.new);

    try {
      const result = await ipcRenderer.invoke('musicApi:getAggregatedChart', type, SOURCES) as ApiResponse<{ songs: AggregatedSongGroup[] }>;
      if (!mountedRef.current || !isCurrentFetch()) return;

      if (!result.success) {
        if (!cached) {
          const errorMsg = result.error || '加载失败';
          if (type === 'hot') setHotError(errorMsg);
          else setNewError(errorMsg);
        }
        return;
      }

      const groups = result.data?.songs || [];
      if (type === 'hot') {
        setHotGroups(groups);
        cacheRef.current.hot = groups;
        cacheRef.current.hotTimestamp = Date.now();
      } else {
        setNewGroups(groups);
        cacheRef.current.new = groups;
        cacheRef.current.newTimestamp = Date.now();
      }
    } catch (err: any) {
      if (!mountedRef.current || !isCurrentFetch()) return;
      if (!cached) {
        const errorMsg = err?.message || '加载失败';
        if (type === 'hot') setHotError(errorMsg);
        else setNewError(errorMsg);
      }
    } finally {
      if (!mountedRef.current || !isCurrentFetch()) return;
      if (type === 'hot') setHotLoading(false);
      else setNewLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, [fetchChart]);

  const fetchAlbums = useCallback(async (area: AreaKey) => {
    const fetchId = ++albumsFetchIdRef.current;
    const cache = tabCacheRef.current.albums;

    // SWR: show cached data immediately if available
    if (cache.data) {
      setAlbums(cache.data);
      setAlbumsLoading(false);
    } else {
      setAlbumsLoading(true);
    }
    setAlbumsError(null);

    try {
      const result = await ipcRenderer.invoke('musicApi:getNewAlbums', area, 0, 30) as ApiResponse<Album[]>;
      if (!mountedRef.current || fetchId !== albumsFetchIdRef.current) return;

      if (!result.success) {
        if (!cache.data) setAlbumsError(result.error || '加载新碟失败');
        return;
      }

      const albumData = result.data || [];
      setAlbums(albumData);
      tabCacheRef.current.albums = { data: albumData, timestamp: Date.now() };
    } catch (err: any) {
      if (!mountedRef.current || fetchId !== albumsFetchIdRef.current) return;
      if (!cache.data) setAlbumsError(err?.message || '加载新碟失败');
    } finally {
      if (mountedRef.current && fetchId === albumsFetchIdRef.current) setAlbumsLoading(false);
    }
  }, []);

  const fetchPlaylistList = useCallback(async (reset: boolean) => {
    const fetchId = ++playlistsFetchIdRef.current;

    if (reset) {
      playlistListOffsetRef.current = 0;
      playlistListHasMoreRef.current = true;
      playlistListLoadingMoreRef.current = false;
      setPlaylistListLoading(true);
      setPlaylistList([]);
      setPlaylistListHasMore(true);
      setPlaylistListOffset(0);
    } else {
      if (playlistListLoadingMoreRef.current || !playlistListHasMoreRef.current) return;
      playlistListLoadingMoreRef.current = true;
      setPlaylistListLoadingMore(true);
    }
    setPlaylistListError(null);

    const offset = reset ? 0 : playlistListOffsetRef.current;
    try {
      const result = await ipcRenderer.invoke(
        'musicApi:getNeteasePlaylists',
        playlistCategory,
        'hot',
        offset,
        PLAYLIST_PAGE_SIZE
      ) as ApiResponse<{ playlists: DiscoverPlaylist[]; more: boolean }>;
      if (!mountedRef.current || fetchId !== playlistsFetchIdRef.current) return;

      if (!result.success) {
        if (reset) setPlaylistListError(result.error || '加载歌单失败');
        return;
      }

      const data = result.data || { playlists: [], more: false };
      setPlaylistList(prev => reset ? data.playlists : [...prev, ...data.playlists]);
      playlistListOffsetRef.current = offset + PLAYLIST_PAGE_SIZE;
      playlistListHasMoreRef.current = data.more;
      setPlaylistListOffset(playlistListOffsetRef.current);
      setPlaylistListHasMore(data.more);
    } catch (err: any) {
      if (!mountedRef.current || fetchId !== playlistsFetchIdRef.current) return;
      if (reset) setPlaylistListError(err?.message || '加载歌单失败');
    } finally {
      if (mountedRef.current && fetchId === playlistsFetchIdRef.current) {
        playlistListLoadingMoreRef.current = false;
        setPlaylistListLoading(false);
        setPlaylistListLoadingMore(false);
      }
    }
  }, [playlistCategory]);

  useEffect(() => {
    if (activeTab === 'charts') {
      const now = Date.now();
      if (!cacheRef.current.hot || now - cacheRef.current.hotTimestamp > CHART_TTL) fetchChart('hot');
      if (!cacheRef.current.new || now - cacheRef.current.newTimestamp > CHART_TTL) fetchChart('new');
    } else if (activeTab === 'albums') {
      setAlbumsError(null);
      fetchAlbums(albumsArea);
    } else if (activeTab === 'playlists') {
      setPlaylistListError(null);
      fetchPlaylistList(true);
    }
  }, [activeTab, albumsArea, fetchChart, fetchAlbums, fetchPlaylistList]);

  const handleAlbumsAreaChange = (area: string) => {
    setAlbumsArea(area as AreaKey);
  };

  const handleRetryAlbums = () => {
    tabCacheRef.current.albums = { data: null, timestamp: 0 };
    fetchAlbums(albumsArea);
  };

  const handleAlbumClick = (album: Album) => {
    searchService.searchAll(`${album.name} ${album.artist}`);
  };

  const handleRetryPlaylists = () => {
    tabCacheRef.current.playlists = { data: null, timestamp: 0 };
    fetchPlaylistList(true);
  };

  const handlePlaylistCategoryChange = (cat: string) => {
    setPlaylistCategory(cat);
  };

  const handlePlaylistScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (activeTab !== 'playlists' || playlistListLoadingMoreRef.current || !playlistListHasMoreRef.current) return;
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
      fetchPlaylistList(false);
    }
  };

  const handlePlaylistSelect = (pl: DiscoverPlaylist) => {
    navigate(`/discover-playlist/${pl.id}`);
  };

  const handlePlaySong = async (song: Song, chartId?: string) => {
    if (chartId) playedChartIdRef.current = chartId;
    try {
      if (!song.url && song.name) {
        const keyword = `${song.name} ${song.artist}`;
        const result = await ipcRenderer.invoke('musicApi:searchSongs', keyword, 1, song.sourceType) as any;
        if (result?.success && result.data?.length > 0) {
          await play(result.data[0]);
          return;
        }
        // Search returned no results — try direct play
        message.warning('未找到可播放版本，尝试直接播放');
      }
      await play(song);
    } catch (error) {
      console.error('播放失败:', error);
      message.error('播放失败，请检查 API 服务是否运行');
    }
  };

  const isCurrentSong = (songId: string, sourceType?: string, chartId?: string) =>
    currentSong?.id === songId
    && (!sourceType || currentSong?.sourceType === sourceType)
    && playedChartIdRef.current === chartId;

  const handleRetryHot = () => {
    cacheRef.current.hot = null;
    cacheRef.current.hotTimestamp = 0;
    fetchChart('hot');
  };

  const handleRetryNew = () => {
    cacheRef.current.new = null;
    cacheRef.current.newTimestamp = 0;
    fetchChart('new');
  };

  const { groups, loading: searchLoading, loadingMore: searchLoadingMore, currentKeyword, songs: searchSongs, hasMore, sourceType } = useSearchStore();
  const { toggleFavorite, favoriteIds } = useFavoriteStore();
  const { download } = useDownload();
  const singleSourceScrollRef = useRef<HTMLDivElement>(null);
  useInfiniteScroll(singleSourceScrollRef, {
    onLoadMore: () => searchService.loadMore(),
    loading: searchLoading || searchLoadingMore,
    hasMore,
  });

  // 搜索结果标题上报到 TopBar 右侧,卸载时清空
  useEffect(() => {
    if (currentKeyword) usePageTitleStore.getState().setTitle(`搜索结果: ${currentKeyword}`);
  }, [currentKeyword]);
  useEffect(() => () => usePageTitleStore.getState().setTitle(''), []);

  if (currentKeyword && (searchSongs.length > 0 || groups.length > 0 || searchLoading)) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {sourceType === 'all' ? (
            <GroupedSongList
              onPlay={handlePlaySong}
              onAddToPlaylist={() => message.info('添加到歌单功能')}
              onToggleFavorite={toggleFavorite}
              onDownload={download}
              selectedIds={[]}
              onSelectionChange={() => {}}
              loading={searchLoading || searchLoadingMore}
              hasMore={hasMore}
              onLoadMore={() => searchService.loadMore()}
            />
          ) : (
            <div ref={singleSourceScrollRef} style={{ height: '100%', overflowY: 'auto' }}>
              <SongList
                songs={searchSongs}
                currentSongId={currentSong?.id}
                isPlaying={isPlaying}
                favoriteIds={favoriteIds}
                onPlay={handlePlaySong}
                onToggleFavorite={toggleFavorite}
                onDownload={download}
                onAddToPlaylist={() => message.info('添加到歌单功能')}
                showCheckbox={false}
                loading={searchLoading || searchLoadingMore}
              />
              {hasMore && (searchLoading || searchLoadingMore) && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>加载中...</div>
              )}
              {!hasMore && searchSongs.length > 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>没有更多歌曲了</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        '--accent-color': '#2F5FD0',
        '--accent': '#2F5FD0',
        '--accent-hover': '#264FB8',
        '--accent-active': '#1F4399',
        '--accent-subtle': '#E7EDFB',
      } as React.CSSProperties}
    >
      <div style={{
        display: 'flex', flexDirection: 'column',
        padding: '16px 28px 0',
        borderBottom: '1px solid var(--divider-color)',
        backgroundColor: 'var(--content-bg)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
          <span style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            今天听什么
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
            网易云 · QQ · 酷狗
          </span>
        </div>
        <div style={{ display: 'flex', gap: '18px', marginTop: '12px', overflowX: 'auto' }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 2px 14px',
                border: 'none',
                background: 'transparent',
                color: activeTab === tab.key ? 'var(--accent-color)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                fontWeight: activeTab === tab.key ? 600 : 400,
                whiteSpace: 'nowrap',
                transition: 'color 0.15s ease',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {activeTab === tab.key && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', left: '50%', bottom: '4px', transform: 'translateX(-50%)',
                    display: 'flex', alignItems: 'flex-end', gap: '2px', height: '10px',
                    animation: 'fadeIn 0.2s ease-out',
                  }}
                >
                  <span style={{ width: '2px', height: '6px', borderRadius: '1px', backgroundColor: 'var(--accent-color)' }} />
                  <span style={{ width: '2px', height: '10px', borderRadius: '1px', backgroundColor: 'var(--accent-color)' }} />
                  <span style={{ width: '2px', height: '7px', borderRadius: '1px', backgroundColor: 'var(--accent-color)' }} />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{ flex: 1, overflow: 'hidden', padding: activeTab === 'artists' ? 0 : 'var(--space-5) var(--space-6)' }}
      >
        {activeTab === 'charts' && (
          <div style={{ height: '100%', display: 'flex', gap: 'var(--space-6)' }}>
            <ChartPanel
              title="热歌榜"
              chartId="hot"
              groups={hotGroups}
              loading={hotLoading}
              error={hotError}
              onPlay={handlePlaySong}
              isCurrentSong={isCurrentSong}
              onRetry={handleRetryHot}
            />
            <ChartPanel
              title="新歌榜"
              chartId="new"
              groups={newGroups}
              loading={newLoading}
              error={newError}
              onPlay={handlePlaySong}
              isCurrentSong={isCurrentSong}
              onRetry={handleRetryNew}
            />
          </div>
        )}

        {activeTab === 'albums' && (
          <AlbumScroll
            albums={albums}
            loading={albumsLoading}
            error={albumsError}
            area={albumsArea}
            onAreaChange={handleAlbumsAreaChange}
            onRetry={handleRetryAlbums}
            onAlbumClick={handleAlbumClick}
          />
        )}

        {activeTab === 'playlists' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-5)', flexShrink: 0 }}>
              {PLAYLIST_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => handlePlaylistCategoryChange(cat)}
                  style={{
                    padding: '6px 16px',
                    borderRadius: '20px',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    fontWeight: playlistCategory === cat ? 600 : 400,
                    color: playlistCategory === cat ? 'white' : 'var(--text-secondary)',
                    background: playlistCategory === cat ? 'var(--accent-color)' : 'transparent',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div onScroll={handlePlaylistScroll} style={{ flex: 1, overflow: 'auto' }}>
              <PlaylistPageGrid
                playlists={playlistList}
                loading={playlistListLoading}
                error={playlistListError}
                onRetry={handleRetryPlaylists}
                onPlaylistSelect={handlePlaylistSelect}
              />
              {playlistListLoadingMore && (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>加载中...</div>
              )}
              {!playlistListHasMore && playlistList.length > 0 && (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>没有更多歌单了</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'artists' && <ArtistListPage />}
      </div>
    </div>
  );
};

export default DiscoverPageV2;
