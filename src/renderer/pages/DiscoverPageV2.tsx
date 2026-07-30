import React, { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useSearchStore } from '@/renderer/store/searchStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import ChartPanel from '@/renderer/components/ChartPanel';
import GroupedSongList from '@/renderer/components/GroupedSongList';
import AlbumScroll from '@/renderer/components/AlbumScroll';
import PlaylistGrid from '@/renderer/components/PlaylistGrid';
import SongList from '@/renderer/components/SongList';
import type { AggregatedSongGroup } from '@/main/services/chartAggregator';
import type { Song, DiscoverPlaylist } from '@mplayer/core';
import type { Album } from '@/main/services/discoveryService';
import type { ApiResponse } from '@/shared/types/ipc';

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
}

const CACHE_TTL = 30 * 60 * 1000;
const ALBUMS_CACHE_TTL = 60 * 60 * 1000;
const RECOMMENDED_CACHE_TTL = 15 * 60 * 1000;

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
  const [recommendedSongsLoading, setRecommendedSongsLoading] = useState(false);

  const cacheRef = useRef<ChartCache>({ hot: null, new: null, hotTimestamp: 0, newTimestamp: 0 });
  const tabCacheRef = useRef<TabCache>({
    albums: { data: null, timestamp: 0 },
    recommendedPlaylists: { data: null, timestamp: 0 },
    recommendedSongs: { data: null, timestamp: 0 },
  });
  const mountedRef = useRef(true);
  const albumsFetchIdRef = useRef(0);
  const recommendFetchIdRef = useRef(0);

  const fetchChart = useCallback(async (type: 'hot' | 'new') => {
    const cache = cacheRef.current;
    const cached = type === 'hot' ? cache.hot : cache.new;
    const timestamp = type === 'hot' ? cache.hotTimestamp : cache.newTimestamp;

    // SWR: show cached data immediately, always background refresh
    if (cached) {
      if (type === 'hot') setHotGroups(cached);
      else setNewGroups(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        // Fresh cache: show, don't show loading, but still refresh in background
        if (type === 'hot') setHotLoading(false);
        else setNewLoading(false);
      } else {
        // Stale cache: show but keep loading indicator
        if (type === 'hot') setHotLoading(true);
        else setNewLoading(true);
      }
    } else {
      if (type === 'hot') { setHotLoading(true); setHotError(null); }
      else { setNewLoading(true); setNewError(null); }
    }

    try {
      const result = await ipcRenderer.invoke('musicApi:getAggregatedChart', type, SOURCES) as ApiResponse<{ songs: AggregatedSongGroup[] }>;
      if (!mountedRef.current) return;

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
      if (!mountedRef.current) return;
      if (!cached) {
        const errorMsg = err?.message || '加载失败';
        if (type === 'hot') setHotError(errorMsg);
        else setNewError(errorMsg);
      }
    } finally {
      if (!mountedRef.current) return;
      if (type === 'hot') setHotLoading(false);
      else setNewLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchChart('hot');
    fetchChart('new');
    return () => { mountedRef.current = false; };
  }, [fetchChart]);

  const fetchAlbums = useCallback(async (area: AreaKey) => {
    const fetchId = ++albumsFetchIdRef.current;
    const cache = tabCacheRef.current.albums;

    // SWR: show cached data immediately if available
    if (cache.data) {
      setAlbums(cache.data);
      if (Date.now() - cache.timestamp >= ALBUMS_CACHE_TTL) {
        setAlbumsLoading(true); // stale — show skeleton too
      }
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
    const playlistCache = tabCacheRef.current.recommendedPlaylists;
    const songCache = tabCacheRef.current.recommendedSongs;

    const hasPlaylistCache = !!playlistCache.data;
    const hasSongCache = !!songCache.data;

    if (hasPlaylistCache) {
      setRecommendedPlaylists(playlistCache.data || []);
      if (Date.now() - playlistCache.timestamp >= RECOMMENDED_CACHE_TTL) {
        setRecommendedLoading(true);
      }
    } else {
      setRecommendedLoading(true);
    }

    if (hasSongCache) {
      setRecommendedSongs(songCache.data || []);
      if (Date.now() - songCache.timestamp >= RECOMMENDED_CACHE_TTL) {
        setRecommendedSongsLoading(true);
      }
    } else {
      setRecommendedSongsLoading(true);
    }

    setRecommendedError(null);

    try {
      const [plResult, sgResult] = await Promise.all([
        ipcRenderer.invoke('musicApi:getRecommendedPlaylists', 30) as Promise<ApiResponse<DiscoverPlaylist[]>>,
        ipcRenderer.invoke('musicApi:getRecommendedSongs', 30) as Promise<ApiResponse<Song[]>>,
      ]);

      if (!mountedRef.current || fetchId !== recommendFetchIdRef.current) return;

      if (plResult.success) {
        const plData = plResult.data || [];
        setRecommendedPlaylists(plData);
        tabCacheRef.current.recommendedPlaylists = { data: plData, timestamp: Date.now() };
      } else if (!hasPlaylistCache) {
        setRecommendedError(plResult.error || '加载推荐失败');
      }

      if (sgResult.success) {
        const sgData = sgResult.data || [];
        setRecommendedSongs(sgData);
        tabCacheRef.current.recommendedSongs = { data: sgData, timestamp: Date.now() };
      }
    } catch (err: any) {
      if (!mountedRef.current || fetchId !== recommendFetchIdRef.current) return;
      if (!hasPlaylistCache) setRecommendedError(err?.message || '加载推荐失败');
    } finally {
      if (mountedRef.current && fetchId === recommendFetchIdRef.current) {
        setRecommendedLoading(false);
        setRecommendedSongsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'albums') {
      setAlbumsError(null);
      fetchAlbums(albumsArea);
    } else if (activeTab === 'recommend') {
      setRecommendedError(null);
      fetchRecommended();
    }
  }, [activeTab, albumsArea, fetchAlbums, fetchRecommended]);

  const handleAlbumsAreaChange = (area: string) => {
    setAlbumsArea(area as AreaKey);
  };

  const handleRetryAlbums = () => {
    tabCacheRef.current.albums = { data: null, timestamp: 0 };
    fetchAlbums(albumsArea);
  };

  const handleRetryRecommended = () => {
    tabCacheRef.current.recommendedPlaylists = { data: null, timestamp: 0 };
    tabCacheRef.current.recommendedSongs = { data: null, timestamp: 0 };
    fetchRecommended();
  };

  const handlePlaylistSelect = (pl: DiscoverPlaylist) => {
    navigate(`/discover-playlist/${pl.id}`);
  };

  const handlePlaySong = async (song: Song) => {
    try {
      if (!song.url && song.name) {
        const keyword = `${song.name} ${song.artist}`;
        const result = await ipcRenderer.invoke('musicApi:searchSongs', keyword, 1, song.sourceType) as any;
        if (result?.success && result.data?.length > 0) {
          await play(result.data[0]);
          return;
        }
      }
      await play(song);
    } catch (error) {
      console.error('播放失败:', error);
      message.error('播放失败，请检查网络连接和 API 设置');
    }
  };

  const isCurrentSong = (songId: string) => currentSong?.id === songId;

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
  const { toggleFavorite, favoriteIds } = useFavoriteStore();
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
              title="热歌榜"
              groups={hotGroups}
              loading={hotLoading}
              error={hotError}
              onPlay={handlePlaySong}
              isCurrentSong={isCurrentSong}
              onRetry={handleRetryHot}
            />
            <ChartPanel
              title="新歌榜"
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
          />
        )}

        {activeTab === 'recommend' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', overflow: 'auto' }}>
            <div>
              <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
                推荐歌曲
              </h3>
              <SongList
                songs={recommendedSongs}
                currentSongId={currentSong?.id}
                favoriteIds={favoriteIds}
                onPlay={handlePlaySong}
                onToggleFavorite={toggleFavorite}
                onDownload={download}
                loading={recommendedSongsLoading}
                showHeader={false}
                showIndex={false}
              />
            </div>
            <div>
              <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
                推荐歌单
              </h3>
              <PlaylistGrid
                playlists={recommendedPlaylists}
                loading={recommendedLoading}
                error={recommendedError}
                onRetry={handleRetryRecommended}
                onPlaylistSelect={handlePlaylistSelect}
              />
            </div>
          </div>
        )}

        {activeTab === 'playlists' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: '14px' }}>歌单功能开发中，敬请期待</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DiscoverPageV2;
