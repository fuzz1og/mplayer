import React, { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import { ArrowLeft, Flame, Disc3, ListMusic, Mic2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useSearchStore } from '@/renderer/store/searchStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { searchService } from '@/renderer/services/searchService';
import { cacheArtistMeta } from '@/renderer/services/artistMetaCache';
import ChartPanel from '@/renderer/components/ChartPanel';
import GroupedSongList from '@/renderer/components/GroupedSongList';
import SongList from '@/renderer/components/SongList';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import AlbumScroll from '@/renderer/components/AlbumScroll';
import PlaylistPageGrid from '@/renderer/components/PlaylistPageGrid';
import ArtistListPage from '@/renderer/pages/ArtistListPage';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import type { AggregatedSongGroup } from '@/main/services/chartAggregator';
import type { Album, Song, DiscoverPlaylist, Artist } from '@mplayer/core';
import { CHART_CACHE_TTL as CHART_TTL } from '../../shared/chart';

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

// 发现页 tab 持久化:返回导航会让组件重新挂载,用 sessionStorage 恢复离开时的激活 tab
const TAB_STORAGE_KEY = 'discover_active_tab';
const VALID_TABS: TabKey[] = ['charts', 'albums', 'playlists', 'artists'];

function loadSavedTab(): TabKey {
  const saved = sessionStorage.getItem(TAB_STORAGE_KEY);
  return (VALID_TABS as string[]).includes(saved as string) ? (saved as TabKey) : 'charts';
}

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
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabKey>(loadSavedTab);
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
      const result = await callMusicApi('getAggregatedChart', type, SOURCES);
      if (!mountedRef.current || !isCurrentFetch()) return;

      const groups = result?.songs || [];
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

  // 记录激活 tab,返回导航重挂载后恢复
  useEffect(() => {
    sessionStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

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
      const albumData = await callMusicApi('getNewAlbums', area, 0, 30);
      if (!mountedRef.current || fetchId !== albumsFetchIdRef.current) return;

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
      const data = await callMusicApi('getNeteasePlaylists', playlistCategory, 'hot', offset, PLAYLIST_PAGE_SIZE);
      if (!mountedRef.current || fetchId !== playlistsFetchIdRef.current) return;

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
    navigate(`/album/${album.id}`, { state: { name: album.name, picUrl: album.picUrl, artist: album.artist } });
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
        const results = await callMusicApi('searchSongs', keyword, 1, song.sourceType);
        if (results?.length > 0) {
          await play(results[0]);
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

  const searchLoading = useSearchStore((s) => s.loading);
  const searchLoadingMore = useSearchStore((s) => s.loadingMore);
  const currentKeyword = useSearchStore((s) => s.currentKeyword);
  const searchSongs = useSearchStore((s) => s.songs);
  const hasMore = useSearchStore((s) => s.hasMore);
  const sourceType = useSearchStore((s) => s.sourceType);
  const searchError = useSearchStore((s) => s.error);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const { download } = useDownload();
  const singleSourceScrollRef = useRef<HTMLDivElement>(null);
  useInfiniteScroll(singleSourceScrollRef, {
    onLoadMore: () => searchService.loadMore(),
    loading: searchLoading || searchLoadingMore,
    hasMore,
  });

  // 搜索结果二级 tab：单曲 / 歌手。「查看歌手」入口通过 preferredTab 落在歌手 tab
  const [activeSearchTab, setActiveSearchTab] = useState<'songs' | 'artists'>(() => useSearchStore.getState().preferredTab);
  const [artistResults, setArtistResults] = useState<Artist[]>([]);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistError, setArtistError] = useState(false);
  const artistSearchSeqRef = useRef(0);
  // 「查看歌手」偏好：订阅变化以覆盖「同关键词再次进入」的边界（关键词未变时 effect 不触发）
  const preferredTab = useSearchStore(s => s.preferredTab);

  // 关键词变化：应用并消费「查看歌手」的偏好 tab；歌手搜索带序号守卫，慢响应不覆盖新关键词
  useEffect(() => {
    const preferred = useSearchStore.getState().preferredTab;
    setActiveSearchTab(preferred);
    useSearchStore.getState().setPreferredTab('songs');
    setArtistResults([]);
    setArtistError(false);
    if (!currentKeyword) return;
    const seq = ++artistSearchSeqRef.current;
    setArtistLoading(true);
    searchService.searchArtists(currentKeyword)
      .then((artists) => {
        if (seq === artistSearchSeqRef.current) setArtistResults(artists ?? []);
      })
      .catch(() => {
        if (seq === artistSearchSeqRef.current) setArtistError(true);
      })
      .finally(() => {
        if (seq === artistSearchSeqRef.current) setArtistLoading(false);
      });
  }, [currentKeyword]);

  // 同关键词下再次点「查看歌手」：关键词未变时也能切到歌手 tab（消费后立即复位）
  useEffect(() => {
    if (preferredTab !== 'artists') return;
    setActiveSearchTab('artists');
    useSearchStore.getState().setPreferredTab('songs');
  }, [preferredTab]);

  const handleBackFromSearch = () => {
    useSearchStore.getState().reset();
  };

  // currentKeyword 仅在用户提交搜索时被设置（TopBar 回车/搜索按钮），
  // 因此只要有关键词就渲染搜索视图；loading/空/错误由各 tab 内部处理，
  // 否则搜索失败或全空时整个视图不渲染、静默落回首页（story 20 空/错误态不可达）。
  if (currentKeyword) {
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

        {/* 单曲 / 歌手二级 tab */}
        <div style={{ display: 'flex', gap: '8px', padding: '10px 24px', borderBottom: '1px solid var(--divider-color)', backgroundColor: 'var(--content-bg)', flexShrink: 0 }}>
          {([
            { key: 'songs' as const, label: '单曲', count: searchSongs.length },
            { key: 'artists' as const, label: '歌手', count: artistResults.length },
          ]).map((tab) => (
            <button
              key={tab.key}
              aria-pressed={activeSearchTab === tab.key}
              onClick={() => setActiveSearchTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 16px', borderRadius: 'var(--radius-full)', border: 'none', cursor: 'pointer',
                fontSize: 'var(--text-sm)', fontWeight: activeSearchTab === tab.key ? 600 : 400,
                color: activeSearchTab === tab.key ? '#fff' : 'var(--text-secondary)',
                backgroundColor: activeSearchTab === tab.key ? 'var(--accent-color)' : 'var(--hover-bg)',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{
                  fontSize: 'var(--text-2xs)', padding: '1px 6px', borderRadius: 'var(--radius-full)',
                  backgroundColor: activeSearchTab === tab.key ? 'rgba(255,255,255,0.25)' : 'var(--bg-active)',
                  color: activeSearchTab === tab.key ? '#fff' : 'var(--text-tertiary)',
                }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeSearchTab === 'songs' ? (
            searchError && searchSongs.length === 0 && !searchLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--red-500)' }}>{searchError}</div>
            ) : sourceType === 'all' ? (
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
                  emptyText="未找到相关歌曲"
                />
                {hasMore && (searchLoading || searchLoadingMore) && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>加载中...</div>
                )}
                {!hasMore && searchSongs.length > 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>没有更多歌曲了</div>
                )}
              </div>
            )
          ) : artistLoading && artistResults.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>正在搜索歌手…</div>
          ) : artistError ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--red-500)' }}>歌手搜索失败</div>
          ) : artistResults.length > 0 ? (
            <div style={{ height: '100%', overflowY: 'auto', padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-5)' }}>
                {artistResults.map((a) => (
                  <button
                    key={a.id}
                    aria-label={`查看歌手: ${a.name}`}
                    onClick={() => {
                      cacheArtistMeta(a.id, { name: a.name, pic: a.picUrl });
                      navigate(`/artist/${a.id}`, { state: { name: a.name, pic: a.picUrl } });
                    }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                      padding: '16px 8px', border: 'none', background: 'transparent', cursor: 'pointer', minWidth: 0,
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <span
                      style={{
                        width: '72px', height: '72px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                        backgroundColor: 'var(--hover-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '28px', color: 'var(--text-tertiary)', border: '1px solid var(--border-color)',
                      }}
                    >
                      {a.picUrl ? (
                        <img src={a.picUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        a.name.charAt(0)
                      )}
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                      {a.name}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                      专辑 {a.albumSize} · 歌曲 {a.musicSize}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>未找到相关歌手</div>
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
