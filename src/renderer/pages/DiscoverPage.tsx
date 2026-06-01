import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, TrendingUp, ArrowLeft, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSearchStore } from '@/renderer/store/searchStore';
import { searchService } from '@/renderer/services/searchService';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import SongList from '@/renderer/components/SongList';
import GroupedSongList from '@/renderer/components/GroupedSongList';
import DiscoverPlaylistCard from '@/renderer/components/DiscoverPlaylistCard';
import type { Song, Artist, DiscoverPlaylist } from '@/shared/types/song';
const { ipcRenderer } = window.require('electron');

// 热榜歌曲类型
interface HotlistSong {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; action?: string; onClickAction?: () => void }> = ({
  icon,
  title,
  action,
  onClickAction
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '20px',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span style={{ color: 'var(--accent-color)' }}>{icon}</span>
      <h2
        style={{
          fontSize: '20px',
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}
      >
        {title}
      </h2>
    </div>
    {action && (
      <button
        style={{
          fontSize: '13px',
          color: 'var(--text-secondary)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: '4px',
          transition: 'all 0.15s ease',
        }}
        onClick={onClickAction}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--accent-color)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-secondary)';
        }}
      >
        {action} →
      </button>
    )}
  </div>
);

// 缓存发现页数据，避免重复加载
const discoverCache = {
  hotlist: null as HotlistSong[] | null,
  neteaseNewSongList: null as HotlistSong[] | null,
  qqHotlist: null as HotlistSong[] | null,
  qqNewSongList: null as HotlistSong[] | null,
  playlists: null as DiscoverPlaylist[] | null,
};

const DiscoverPage: React.FC = () => {
  const navigate = useNavigate();
  const [hotlist, setHotlist] = useState<HotlistSong[]>(discoverCache.hotlist || []);
  const [hotlistLoading, setHotlistLoading] = useState(!discoverCache.hotlist);
  const [neteaseNewSongList, setNeteaseNewSongList] = useState<HotlistSong[]>(discoverCache.neteaseNewSongList || []);
  const [neteaseNewSongListLoading, setNeteaseNewSongListLoading] = useState(!discoverCache.neteaseNewSongList);
  const [qqHotlist, setQQHotlist] = useState<HotlistSong[]>(discoverCache.qqHotlist || []);
  const [qqHotlistLoading, setQQHotlistLoading] = useState(!discoverCache.qqHotlist);
  const [qqNewSongList, setQqNewSongList] = useState<HotlistSong[]>(discoverCache.qqNewSongList || []);
  const [qqNewSongListLoading, setQqNewSongListLoading] = useState(!discoverCache.qqNewSongList);
  const [playlists, setPlaylists] = useState<DiscoverPlaylist[]>(discoverCache.playlists || []);
  const [playlistsLoading, setPlaylistsLoading] = useState(!discoverCache.playlists);

  const [activeTab, setActiveTab] = useState<'songs' | 'artists'>('songs');
  const [artistResults, setArtistResults] = useState<Artist[]>([]);
  const [artistLoading, setArtistLoading] = useState(false);

  const { songs, groups, loading, currentKeyword, hasMore, error, sourceMode } = useSearchStore();
  const { currentSong, isPlaying, play } = usePlayerStore();

  const handleLoadMore = useCallback(() => {
    searchService.loadMore();
  }, []);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 滚动到底部时加载更多
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (loading || !hasMore) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        handleLoadMore();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loading, hasMore, handleLoadMore]);

  const { favoriteIds, toggleFavorite } = useFavoriteStore();
  const { download, downloadBatch } = useDownload();

  // 加载网易热榜数据
  useEffect(() => {
    if (discoverCache.hotlist) return; // 已有缓存，跳过加载
    const loadHotlist = async () => {
      try {
        setHotlistLoading(true);
        const result = await ipcRenderer.invoke('musicApi:getNeteaseHotlist');
        const data = result.success ? result.data : [];
        setHotlist(data.slice(0, 20));
        discoverCache.hotlist = data.slice(0, 20);
      } catch (error) {
        console.error('加载网易热榜失败:', error);
      } finally {
        setHotlistLoading(false);
      }
    };
    loadHotlist();
  }, []);

  // 加载网易新歌榜数据
  useEffect(() => {
    if (discoverCache.neteaseNewSongList) return; // 已有缓存，跳过加载
    const loadNeteaseNewSongList = async () => {
      try {
        setNeteaseNewSongListLoading(true);
        const result = await ipcRenderer.invoke('musicApi:getNeteaseNewSongList');
        const data = result.success ? result.data : [];
        setNeteaseNewSongList(data.slice(0, 20));
        discoverCache.neteaseNewSongList = data.slice(0, 20);
      } catch (error) {
        console.error('加载网易新歌榜失败:', error);
      } finally {
        setNeteaseNewSongListLoading(false);
      }
    };
    loadNeteaseNewSongList();
  }, []);

  // 加载QQ音乐热榜数据
  useEffect(() => {
    if (discoverCache.qqHotlist) return; // 已有缓存，跳过加载
    const loadQQHotlist = async () => {
      try {
        setQQHotlistLoading(true);
        const result = await ipcRenderer.invoke('musicApi:getQQHotlist');
        const data = result.success ? result.data : [];
        setQQHotlist(data.slice(0, 20));
        discoverCache.qqHotlist = data.slice(0, 20);
      } catch (error) {
        console.error('加载QQ音乐热榜失败:', error);
      } finally {
        setQQHotlistLoading(false);
      }
    };
    loadQQHotlist();
  }, []);

  // 加载QQ音乐新歌榜数据
  useEffect(() => {
    if (discoverCache.qqNewSongList) return; // 已有缓存，跳过加载
    const loadQQNewSongList = async () => {
      try {
        setQqNewSongListLoading(true);
        const result = await ipcRenderer.invoke('musicApi:getQQNewSongList');
        const data = result.success ? result.data : [];
        setQqNewSongList(data.slice(0, 20));
        discoverCache.qqNewSongList = data.slice(0, 20);
      } catch (error) {
        console.error('加载QQ音乐新歌榜失败:', error);
      } finally {
        setQqNewSongListLoading(false);
      }
    };
    loadQQNewSongList();
  }, []);

  // 加载热门歌单数据
  useEffect(() => {
    if (discoverCache.playlists) return; // 已有缓存，跳过加载
    const loadPlaylists = async () => {
      try {
        setPlaylistsLoading(true);
        const result = await ipcRenderer.invoke('musicApi:getNeteasePlaylists', '全部', 'hot', 0, 10);
        const data = result.success ? result.data : { playlists: [] };
        setPlaylists(data.playlists || []);
        discoverCache.playlists = data.playlists || [];
      } catch (error) {
        console.error('加载热门歌单失败', error);
      } finally {
        setPlaylistsLoading(false);
      }
    };
    loadPlaylists();
  }, []);

  // 切换到歌手 tab 或关键词变化时搜索歌手
  useEffect(() => {
    if (!currentKeyword || activeTab !== 'artists') return;
    let cancelled = false;
    const searchArtists = async () => {
      setArtistLoading(true);
      try {
        const result = await ipcRenderer.invoke('musicApi:searchArtists', currentKeyword, 30);
        if (!cancelled) {
          setArtistResults(result.success ? result.data : []);
        }
      } catch {
        if (!cancelled) setArtistResults([]);
      } finally {
        if (!cancelled) setArtistLoading(false);
      }
    };
    searchArtists();
    return () => { cancelled = true; };
  }, [currentKeyword, activeTab]);

  // 处理热榜歌曲点击
  const handleHotlistSongClick = async (song: HotlistSong, sourceType: 'netease' | 'qq' = 'netease') => {
    try {
      const keyword = `${song.name} ${song.artists}`;
      const result = await ipcRenderer.invoke('musicApi:searchSongs', keyword, 1, sourceType);
      const searchResults = result.success ? result.data : [];
      if (searchResults.length > 0) {
        await play(searchResults[0]);
      }
    } catch (error) {
      console.error('搜索歌曲失败:', error);
    }
  };

  const handlePlaySong = async (song: Song) => {
    await play(song);
  };

  const handleToggleFavorite = async (song: Song) => {
    try {
      await toggleFavorite(song);
    } catch (error) {
      console.error('收藏操作失败:', error);
    }
  };

  const handleAddToPlaylist = (song: Song) => {
    console.log('添加到歌单:', song.name);
  };

  const handleBatchAddToPlaylist = (selectedSongs: Song[]) => {
    console.log('批量添加到歌单:', selectedSongs.length);
  };

  const handleBackFromSearch = () => {
    useSearchStore.getState().reset();
    setArtistResults([]);
    setActiveTab('songs');
  };

  // 如果有搜索关键词，显示搜索结果
  if (currentKeyword && (songs.length > 0 || groups.length > 0 || artistResults.length > 0 || loading || error)) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 搜索结果导航栏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '12px 24px',
            borderBottom: '1px solid var(--divider-color)',
            backgroundColor: 'var(--content-bg)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
            height: '60px',
          }}
        >
          <button
            onClick={handleBackFromSearch}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '10px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--text-secondary)',
              transition: 'all 0.2s ease',
              fontSize: '14px',
              fontWeight: 500,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.transform = 'translateX(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.transform = 'translateX(0)';
            }}
          >
            <ArrowLeft size={16} />
            <span>返回</span>
          </button>
          <h1
            style={{
              fontSize: '20px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              flex: 1,
              margin: 0,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            搜索结果: {currentKeyword}
          </h1>
          <div style={{ width: '140px' }} />
        </div>

        {/* Tab 栏 */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            padding: '0 24px',
            borderBottom: '1px solid var(--divider-color)',
            backgroundColor: 'var(--content-bg)',
          }}
        >
          {[
            { key: 'songs' as const, label: '单曲', count: songs.length },
            { key: 'artists' as const, label: '歌手', count: artistResults.length },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 20px',
                border: 'none',
                borderBottom: activeTab === tab.key ? '2px solid var(--accent-color)' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? 'var(--accent-color)' : 'var(--text-secondary)',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{
                  marginLeft: '6px',
                  fontSize: '11px',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  backgroundColor: activeTab === tab.key ? 'var(--accent-color)' : 'var(--hover-bg)',
                  color: activeTab === tab.key ? 'white' : 'var(--text-tertiary)',
                }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 搜索结果内容 */}
        <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          {error && (
            <div
              style={{
                padding: '12px 16px',
                backgroundColor: '#FF6B6B20',
                borderRadius: '8px',
                color: '#FF6B6B',
                marginBottom: '16px',
                fontSize: '14px',
              }}
            >
              {error}
            </div>
          )}

          {activeTab === 'songs' && (
            sourceMode === 'all' ? (
              <>
                <GroupedSongList
                  onPlay={handlePlaySong}
                  onAddToPlaylist={handleAddToPlaylist}
                  onToggleFavorite={handleToggleFavorite}
                  selectedIds={[]}
                  onSelectionChange={() => {}}
                  loading={loading}
                />
              </>
            ) : (
              <>
                <SongList
                  songs={songs}
                  currentSongId={currentSong?.id}
                  isPlaying={isPlaying}
                  favoriteIds={favoriteIds}
                  onPlay={handlePlaySong}
                  onToggleFavorite={handleToggleFavorite}
                  showCheckbox={true}
                  loading={loading}
                  enableBatchDownload={true}
                  onBatchDownload={downloadBatch}
                  onDownload={download}
                  enableBatchAddToPlaylist={true}
                  onBatchAddToPlaylist={handleBatchAddToPlaylist}
                  onAddToPlaylist={handleAddToPlaylist}
                />

                {/* 滚动加载提示 */}
                {hasMore && loading && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                    加载中...
                  </div>
                )}
                {!hasMore && songs.length > 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                    没有更多歌曲了
                  </div>
                )}

                {!loading && songs.length === 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '60px 20px',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#128269;</div>
                    <div>未找到相关歌曲</div>
                  </div>
                )}
              </>
            )
          )}

          {activeTab === 'artists' && (
            <>
              {artistLoading ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                      padding: '16px 12px', borderRadius: '12px',
                      backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)',
                    }}>
                      <div style={{
                        width: '80px', height: '80px', borderRadius: '50%',
                        background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                        backgroundSize: '200% 200%',
                        animation: 'shimmer 1.5s ease-in-out infinite',
                      }} />
                      <div style={{
                        width: '60px', height: '14px', borderRadius: '2px',
                        background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                        backgroundSize: '200% 200%',
                        animation: 'shimmer 1.5s ease-in-out infinite',
                      }} />
                    </div>
                  ))}
                  <style>{`
                    @keyframes shimmer {
                      0% { background-position: 200% 0; }
                      100% { background-position: -200% 0; }
                    }
                  `}</style>
                </div>
              ) : artistResults.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
                  {artistResults.map((artist) => (
                    <div
                      key={artist.id}
                      onClick={() => navigate(`/artist/${artist.id}`, { state: { name: artist.name, pic: artist.picUrl } })}
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
                      <div style={{
                        width: '80px', height: '80px', borderRadius: '50%',
                        overflow: 'hidden', backgroundColor: 'var(--hover-bg)', flexShrink: 0,
                      }}>
                        {artist.picUrl ? (
                          <img
                            src={artist.picUrl}
                            alt={artist.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            loading="lazy"
                          />
                        ) : (
                          <div style={{
                            width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: '28px', color: 'var(--text-tertiary)',
                          }}>
                            {artist.name.charAt(0)}
                          </div>
                        )}
                      </div>
                      <div style={{
                        fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
                        textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', width: '100%',
                      }}>
                        {artist.name}
                      </div>
                      <div style={{
                        fontSize: '11px', color: 'var(--text-tertiary)',
                        display: 'flex', gap: '8px',
                      }}>
                        {artist.musicSize > 0 && <span>{artist.musicSize}首单曲</span>}
                        {artist.albumSize > 0 && <span>{artist.albumSize}张专辑</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', padding: '60px 20px', color: 'var(--text-tertiary)',
                }}>
                  <User size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
                  <div>未找到相关歌手</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // 默认显示发现页内容
  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      {/* 热门歌单 */}
      <section style={{ marginBottom: '40px' }}>
        <SectionHeader
          icon={<Sparkles size={22} />}
          title="热门歌单"
          action="更多"
          onClickAction={() => navigate('/playlists/discover')}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '16px',
          }}
        >
          {playlistsLoading ? (
            Array.from({ length: 10 }).map((_, index) => (
              <div key={`playlist-skeleton-${index}`}>
                <div
                  style={{
                    paddingTop: '100%',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                    backgroundSize: '200% 200%',
                    animation: 'skeletonLoading 1.5s ease-in-out infinite',
                  }}
                />
                <div
                  style={{
                    height: '14px',
                    marginTop: '8px',
                    borderRadius: '2px',
                    background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                    backgroundSize: '200% 200%',
                    animation: 'skeletonLoading 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            ))
          ) : (
            playlists.slice(0, 10).map(playlist => (
              <DiscoverPlaylistCard key={playlist.id} playlist={playlist} />
            ))
          )}
        </div>
      </section>

      {/* 排行榜 */}
      <section style={{ marginBottom: '40px' }}>
        <SectionHeader
          icon={<TrendingUp size={22} />}
          title="排行榜"
          action="查看全部"
          onClickAction={() => navigate('/hotlist/netease')}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
            gap: '20px',
          }}
        >
          {/* 网易热榜卡片 */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--content-bg)',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              height: '150px',
            }}
            onClick={() => navigate('/hotlist/netease')}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {/* 左侧封面图 */}
            <div
              style={{
                width: '150px',
                height: '150px',
                flexShrink: 0,
                background: 'linear-gradient(135deg, #2d1b4e 0%, #1a1a2e 50%, #16213e 100%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* 背景装饰 */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'radial-gradient(circle at 30% 30%, rgba(102, 126, 234, 0.3) 0%, transparent 60%)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  fontSize: '24px',
                  opacity: 0.6,
                  color: 'white',
                }}
              >
                ♪♪♪
              </div>
              <div
                style={{
                  fontSize: '36px',
                  fontWeight: 800,
                  color: 'white',
                  textShadow: '2px 2px 8px rgba(0,0,0,0.5)',
                  zIndex: 1,
                  letterSpacing: '4px',
                }}
              >
                热歌
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: '11px',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  padding: '3px 8px',
                  borderRadius: '12px',
                }}
              >
                <span>🎧</span>
                <span>{hotlist.length > 0 ? '50首' : '加载中'}</span>
              </div>
            </div>

            {/* 右侧歌曲列表 */}
            <div style={{ flex: 1, padding: '12px 16px', overflow: 'hidden' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px' }}>
                网易热歌榜
              </div>
              {hotlistLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`placeholder-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 0',
                    }}
                  >
                    <span
                      style={{
                        width: '16px',
                        height: '14px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        height: '12px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.1s',
                      }}
                    />
                  </div>
                ))
              ) : (
                hotlist.slice(0, 3).map((song, index) => (
                  <div
                    key={song.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '5px 0',
                      borderBottom: index < 2 ? '1px solid var(--divider-color)' : 'none',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleHotlistSongClick(song, 'netease');
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <span
                      style={{
                        width: '16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: song.rank <= 3 ? '#FF4D4F' : 'var(--text-tertiary)',
                        textAlign: 'center',
                      }}
                    >
                      {song.rank}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: '12px',
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {song.name}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-tertiary)',
                        flexShrink: 0,
                      }}
                    >
                      {song.artists}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* QQ音乐热榜卡片 */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--content-bg)',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              height: '150px',
            }}
            onClick={() => navigate('/hotlist/qq')}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {/* 左侧封面图 */}
            <div
              style={{
                width: '150px',
                height: '150px',
                flexShrink: 0,
                background: 'linear-gradient(135deg, #1a3a2e 0%, #0f2027 50%, #203a43 100%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* 背景装饰 */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'radial-gradient(circle at 70% 30%, rgba(78, 205, 196, 0.3) 0%, transparent 60%)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  fontSize: '24px',
                  opacity: 0.6,
                  color: 'white',
                }}
              >
                ♪♪♪
              </div>
              <div
                style={{
                  fontSize: '36px',
                  fontWeight: 800,
                  color: 'white',
                  textShadow: '2px 2px 8px rgba(0,0,0,0.5)',
                  zIndex: 1,
                  letterSpacing: '4px',
                }}
              >
                热歌
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: '11px',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  padding: '3px 8px',
                  borderRadius: '12px',
                }}
              >
                <span>🎧</span>
                <span>{qqHotlist.length > 0 ? '100首' : '加载中'}</span>
              </div>
            </div>

            {/* 右侧歌曲列表 */}
            <div style={{ flex: 1, padding: '12px 16px', overflow: 'hidden' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px' }}>
                QQ音乐热歌榜
              </div>
              {qqHotlistLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`qq-placeholder-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 0',
                    }}
                  >
                    <span
                      style={{
                        width: '16px',
                        height: '14px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        height: '12px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.1s',
                      }}
                    />
                  </div>
                ))
              ) : (
                qqHotlist.slice(0, 3).map((song, index) => (
                  <div
                    key={song.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '5px 0',
                      borderBottom: index < 2 ? '1px solid var(--divider-color)' : 'none',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleHotlistSongClick(song, 'qq');
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <span
                      style={{
                        width: '16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: song.rank <= 3 ? '#FF4D4F' : 'var(--text-tertiary)',
                        textAlign: 'center',
                      }}
                    >
                      {song.rank}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: '12px',
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {song.name}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-tertiary)',
                        flexShrink: 0,
                      }}
                    >
                      {song.artists}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 网易新歌榜卡片 */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--content-bg)',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              height: '150px',
            }}
            onClick={() => navigate('/hotlist/netease_new')}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {/* 左侧封面图 */}
            <div
              style={{
                width: '150px',
                height: '150px',
                flexShrink: 0,
                background: 'linear-gradient(135deg, #4a1942 0%, #2d1b4e 50%, #1a1a2e 100%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'radial-gradient(circle at 50% 50%, rgba(156, 39, 176, 0.3) 0%, transparent 60%)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  fontSize: '24px',
                  opacity: 0.6,
                  color: 'white',
                }}
              >
                ♪♪♪
              </div>
              <div
                style={{
                  fontSize: '36px',
                  fontWeight: 800,
                  color: 'white',
                  textShadow: '2px 2px 8px rgba(0,0,0,0.5)',
                  zIndex: 1,
                  letterSpacing: '4px',
                }}
              >
                新歌
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: '11px',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  padding: '3px 8px',
                  borderRadius: '12px',
                }}
              >
                <span>🎧</span>
                <span>{neteaseNewSongList.length > 0 ? '100首' : '加载中'}</span>
              </div>
            </div>

            {/* 右侧歌曲列表 */}
            <div style={{ flex: 1, padding: '12px 16px', overflow: 'hidden' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px' }}>
                网易新歌榜
              </div>
              {neteaseNewSongListLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`placeholder-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 0',
                    }}
                  >
                    <span
                      style={{
                        width: '16px',
                        height: '14px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        height: '12px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.1s',
                      }}
                    />
                  </div>
                ))
              ) : (
                neteaseNewSongList.slice(0, 3).map((song, index) => (
                  <div
                    key={song.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '5px 0',
                      borderBottom: index < 2 ? '1px solid var(--divider-color)' : 'none',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleHotlistSongClick(song, 'netease');
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <span
                      style={{
                        width: '16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: song.rank <= 3 ? '#FF4D4F' : 'var(--text-tertiary)',
                        textAlign: 'center',
                      }}
                    >
                      {song.rank}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: '12px',
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {song.name}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-tertiary)',
                        flexShrink: 0,
                      }}
                    >
                      {song.artists}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* QQ音乐新歌榜卡片 */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--content-bg)',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              height: '150px',
            }}
            onClick={() => navigate('/hotlist/qq_new')}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {/* 左侧封面图 */}
            <div
              style={{
                width: '150px',
                height: '150px',
                flexShrink: 0,
                background: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 50%, #1e3c72 100%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'radial-gradient(circle at 50% 50%, rgba(33, 150, 243, 0.3) 0%, transparent 60%)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  fontSize: '24px',
                  opacity: 0.6,
                  color: 'white',
                }}
              >
                ♪♪♪
              </div>
              <div
                style={{
                  fontSize: '36px',
                  fontWeight: 800,
                  color: 'white',
                  textShadow: '2px 2px 8px rgba(0,0,0,0.5)',
                  zIndex: 1,
                  letterSpacing: '4px',
                }}
              >
                新歌
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: '11px',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  padding: '3px 8px',
                  borderRadius: '12px',
                }}
              >
                <span>🎧</span>
                <span>{qqNewSongList.length > 0 ? '100首' : '加载中'}</span>
              </div>
            </div>

            {/* 右侧歌曲列表 */}
            <div style={{ flex: 1, padding: '12px 16px', overflow: 'hidden' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px' }}>
                QQ音乐新歌榜
              </div>
              {qqNewSongListLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`qq-placeholder-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 0',
                    }}
                  >
                    <span
                      style={{
                        width: '16px',
                        height: '14px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        height: '12px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.1s',
                      }}
                    />
                  </div>
                ))
              ) : (
                qqNewSongList.slice(0, 3).map((song, index) => (
                  <div
                    key={song.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '5px 0',
                      borderBottom: index < 2 ? '1px solid var(--divider-color)' : 'none',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleHotlistSongClick(song, 'qq');
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <span
                      style={{
                        width: '16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: song.rank <= 3 ? '#FF4D4F' : 'var(--text-tertiary)',
                        textAlign: 'center',
                      }}
                    >
                      {song.rank}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: '12px',
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {song.name}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-tertiary)',
                        flexShrink: 0,
                      }}
                    >
                      {song.artists}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          <style>{`
            @keyframes pulse {
              0%, 100% {
                opacity: 0.6;
              }
              50% {
                opacity: 1;
              }
            }
          `}</style>
        </div>
      </section>
    </div>
  );
};

export default DiscoverPage;
