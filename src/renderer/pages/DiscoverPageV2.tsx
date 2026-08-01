import React, { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useSearchStore } from '@/renderer/store/searchStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { searchService } from '@/renderer/services/searchService';
import ChartPanel from '@/renderer/components/ChartPanel';
import GroupedSongList from '@/renderer/components/GroupedSongList';
import SongList from '@/renderer/components/SongList';
import AlbumScroll from '@/renderer/components/AlbumScroll';
import PlaylistGrid from '@/renderer/components/PlaylistGrid';
import PlaylistPageGrid from '@/renderer/components/PlaylistPageGrid';
import type { AggregatedSongGroup } from '@/main/services/chartAggregator';
import type { Album, Song, DiscoverPlaylist } from '@mplayer/core';
import type { ApiResponse } from '@/shared/types/ipc';
import { CHART_CACHE_TTL as CHART_TTL } from '../../shared/chart';

const { ipcRenderer } = window.require('electron');

type TabKey = 'charts' | 'albums' | 'recommend' | 'playlists';
type AreaKey = 'ALL' | 'ZH' | 'EA' | 'KR' | 'JP';

interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'charts', label: '排行榜' },
  { key: 'albums', label: '新碟上架' },
  { key: 'recommend', label: '猜你喜欢' },
  { key: 'playlists', label: '歌单' },
];

const SOURCES = ['netease', 'qq', 'kugou'];

interface ChartCache {
  hot: AggregatedSongGroup[] | null;
  new: AggregatedSongGroup[] | null;
  hotTimestamp: number;
  newTimestamp: number;
}

interface TabCache {
  albums: { data: Album[] | null; timestamp: number };
  recommendedPlaylists: { data: DiscoverPlaylist[] | null; timestamp: number };
  recommendedSongs: { data: Song[] | null; timestamp: number };
  playlists: { data: DiscoverPlaylist[] | null; timestamp: number };
}


const DiscoverPageV2: React.FC = () => {
  const { currentSong, play } = usePlayerStore();
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

  const [recommendedPlaylists, setRecommendedPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [recommendedLoading, setRecommendedLoading] = useState(false);
  const [recommendedError, setRecommendedError] = useState<string | null>(null);
  const [recommendedSongs, setRecommendedSongs] = useState<Song[]>([]);

  const [playlistList, setPlaylistList] = useState<DiscoverPlaylist[]>([]);
  const [playlistListLoading, setPlaylistListLoading] = useState(false);
  const [playlistListError, setPlaylistListError] = useState<string | null>(null);

  const cacheRef = useRef<ChartCache>({ hot: null, new: null, hotTimestamp: 0, newTimestamp: 0 });
  const tabCacheRef = useRef<TabCache>({
    albums: { data: null, timestamp: 0 },
    recommendedPlaylists: { data: null, timestamp: 0 },
    recommendedSongs: { data: null, timestamp: 0 },
    playlists: { data: null, timestamp: 0 },
  });
  const mountedRef = useRef(true);
  const playedChartIdRef = useRef<string | null>(null);
  const albumsFetchIdRef = useRef(0);
  const recommendFetchIdRef = useRef(0);
  const playlistsFetchIdRef = useRef(0);
  const chartsFetchIdRef = useRef({ hot: 0, new: 0 });

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

  const fetchRecommended = useCallback(async () => {
    const fetchId = ++recommendFetchIdRef.current;
    const cache = tabCacheRef.current.recommendedPlaylists;
    const songsCache = tabCacheRef.current.recommendedSongs;

    if (cache.data) {
      setRecommendedPlaylists(cache.data);
      setRecommendedLoading(false);
    } else {
      setRecommendedLoading(true);
    }
    if (songsCache.data) setRecommendedSongs(songsCache.data);

    setRecommendedError(null);

    try {
      const [playlistResult, songsResult] = await Promise.all([
        ipcRenderer.invoke('musicApi:getRecommendedPlaylists', 30) as Promise<ApiResponse<DiscoverPlaylist[]>>,
        ipcRenderer.invoke('musicApi:getRecommendedSongs', 30) as Promise<ApiResponse<Song[]>>,
      ]);
      if (!mountedRef.current || fetchId !== recommendFetchIdRef.current) return;

      if (playlistResult.success) {
        const plData = playlistResult.data || [];
        setRecommendedPlaylists(plData);
        tabCacheRef.current.recommendedPlaylists = { data: plData, timestamp: Date.now() };
      } else if (!cache.data) {
        setRecommendedError(playlistResult.error || '加载推荐失败');
      }

      if (songsResult.success) {
        const songData = songsResult.data || [];
        setRecommendedSongs(songData);
        tabCacheRef.current.recommendedSongs = { data: songData, timestamp: Date.now() };
      } else if (!songsCache.data) {
        setRecommendedError(songsResult.error || '加载推荐歌曲失败');
      }
    } catch (err: any) {
      if (!mountedRef.current || fetchId !== recommendFetchIdRef.current) return;
      if (!cache.data && !songsCache.data) setRecommendedError(err?.message || '加载推荐失败');
    } finally {
      if (mountedRef.current && fetchId === recommendFetchIdRef.current) setRecommendedLoading(false);
    }
  }, []);

  const fetchPlaylistList = useCallback(async () => {
    const fetchId = ++playlistsFetchIdRef.current;
    const cache = tabCacheRef.current.playlists;

    if (cache.data) {
      setPlaylistList(cache.data);
      setPlaylistListLoading(false);
    } else {
      setPlaylistListLoading(true);
    }
    setPlaylistListError(null);

    try {
      const result = await ipcRenderer.invoke('musicApi:getPlaylists', '全部', 'hot', 0, 30) as ApiResponse<DiscoverPlaylist[]>;
      if (!mountedRef.current || fetchId !== playlistsFetchIdRef.current) return;

      if (!result.success) {
        if (!cache.data) setPlaylistListError(result.error || '加载歌单失败');
        return;
      }

      const plData = result.data || [];
      setPlaylistList(plData);
      tabCacheRef.current.playlists = { data: plData, timestamp: Date.now() };
    } catch (err: any) {
      if (!mountedRef.current || fetchId !== playlistsFetchIdRef.current) return;
      if (!cache.data) setPlaylistListError(err?.message || '加载歌单失败');
    } finally {
      if (mountedRef.current && fetchId === playlistsFetchIdRef.current) setPlaylistListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'charts') {
      const now = Date.now();
      if (!cacheRef.current.hot || now - cacheRef.current.hotTimestamp > CHART_TTL) fetchChart('hot');
      if (!cacheRef.current.new || now - cacheRef.current.newTimestamp > CHART_TTL) fetchChart('new');
    } else if (activeTab === 'albums') {
      setAlbumsError(null);
      fetchAlbums(albumsArea);
    } else if (activeTab === 'recommend') {
      setRecommendedError(null);
      fetchRecommended();
    } else if (activeTab === 'playlists') {
      setPlaylistListError(null);
      fetchPlaylistList();
    }
  }, [activeTab, albumsArea, fetchChart, fetchAlbums, fetchRecommended, fetchPlaylistList]);

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

  const handleRetryRecommended = () => {
    tabCacheRef.current.recommendedPlaylists = { data: null, timestamp: 0 };
    tabCacheRef.current.recommendedSongs = { data: null, timestamp: 0 };
    fetchRecommended();
  };

  const handleRetryPlaylists = () => {
    tabCacheRef.current.playlists = { data: null, timestamp: 0 };
    fetchPlaylistList();
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

  const { groups, loading: searchLoading, currentKeyword, songs: searchSongs } = useSearchStore();
  const { toggleFavorite } = useFavoriteStore();
  const { download } = useDownload();

  const handleBackFromSearch = () => {
    useSearchStore.getState().reset();
  };

  if (currentKeyword && (searchSongs.length > 0 || groups.length > 0 || searchLoading)) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
          padding: 'var(--space-3) var(--space-6)',
          borderBottom: '1px solid var(--divider-color)',
          backgroundColor: 'var(--content-bg)', height: '60px', flexShrink: 0,
        }}>
          <button onClick={handleBackFromSearch} style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            color: 'var(--text-secondary)', fontSize: 'var(--text-base)', fontWeight: 500,
          }}>
            <ArrowLeft size={16} />
            <span>返回</span>
          </button>
          <h1 style={{
            fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)',
            flex: 1, margin: 0, textAlign: 'center',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            搜索结果: {currentKeyword}
          </h1>
          <div style={{ width: '140px' }} />
        </div>

        <div style={{ flex: 1, overflow: 'hidden' }}>
          <GroupedSongList
            onPlay={handlePlaySong}
            onAddToPlaylist={() => message.info('添加到歌单功能')}
            onToggleFavorite={toggleFavorite}
            onDownload={download}
            selectedIds={[]}
            onSelectionChange={() => {}}
            loading={searchLoading}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-1)',
          padding: '0 var(--space-6)',
          borderBottom: '1px solid var(--divider-color)',
          backgroundColor: 'var(--content-bg)',
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: 'var(--space-3) var(--space-5)',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent-color)' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 'var(--text-base)',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? 'var(--accent-color)' : 'var(--text-secondary)',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', padding: 'var(--space-5) var(--space-6)' }}>
        {activeTab === 'charts' && (
          <div style={{ height: '100%', display: 'flex', gap: 'var(--space-6)' }}>
            <ChartPanel
              title="🔥 热歌榜"
              chartId="hot"
              groups={hotGroups}
              loading={hotLoading}
              error={hotError}
              onPlay={handlePlaySong}
              isCurrentSong={isCurrentSong}
              onRetry={handleRetryHot}
            />
            <ChartPanel
              title="🎵 新歌榜"
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

        {activeTab === 'recommend' && (
          <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div>
              <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>推荐歌曲</h3>
              <SongList
                songs={recommendedSongs}
                loading={recommendedLoading && recommendedSongs.length === 0}
                onPlay={handlePlaySong}
                onToggleFavorite={toggleFavorite}
                onDownload={download}
                showHeader={false}
                emptyText="暂无推荐歌曲"
              />
            </div>
            <div>
              <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>推荐歌单</h3>
              <PlaylistGrid
                playlists={recommendedPlaylists}
                loading={recommendedLoading && recommendedPlaylists.length === 0}
                error={recommendedError}
                onRetry={handleRetryRecommended}
                onPlaylistSelect={handlePlaylistSelect}
              />
            </div>
          </div>
        )}

        {activeTab === 'playlists' && (
          <PlaylistPageGrid
            playlists={playlistList}
            loading={playlistListLoading}
            error={playlistListError}
            onRetry={handleRetryPlaylists}
            onPlaylistSelect={handlePlaylistSelect}
          />
        )}
      </div>
    </div>
  );
};

export default DiscoverPageV2;
