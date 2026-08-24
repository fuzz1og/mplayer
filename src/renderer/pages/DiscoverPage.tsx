import React, { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import { Sparkles, TrendingUp, ArrowLeft, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSearchStore } from '@/renderer/store/searchStore';
import { searchService } from '@/renderer/services/searchService';
import { cacheArtistMeta } from '@/renderer/services/artistMetaCache';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import { useDiscoverData } from '@/renderer/hooks/useDiscoverData';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import SongList from '@/renderer/components/SongList';
import GroupedSongList from '@/renderer/components/GroupedSongList';
import HotlistCard from '@/renderer/components/HotlistCard';
import DiscoverPlaylistCard from '@/renderer/components/DiscoverPlaylistCard';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import type { Song, Artist } from '@mplayer/core';

interface HotlistSong {
  id: string; name: string; artists: string; rank: number; cover: string; album: string;
}

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; action?: string; onClickAction?: () => void }> = ({
  icon, title, action, onClickAction
}) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
      <span style={{ color: 'var(--accent)' }}>{icon}</span>
      <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h2>
    </div>
    {action && (
      <button
        style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 'var(--radius-xs)', transition: 'all 0.15s ease' }}
        onClick={onClickAction}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
      >
        {action} →
      </button>
    )}
  </div>
);

const DiscoverPage: React.FC = () => {
  const navigate = useNavigate();
  const songs = useSearchStore((s) => s.songs);
  const groups = useSearchStore((s) => s.groups);
  const loading = useSearchStore((s) => s.loading);
  const currentKeyword = useSearchStore((s) => s.currentKeyword);
  const hasMore = useSearchStore((s) => s.hasMore);
  const error = useSearchStore((s) => s.error);
  const sourceType = useSearchStore((s) => s.sourceType);
  const isAllMode = sourceType === 'all';
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();

  const hotlist = useDiscoverData('getNeteaseHotlist');
  const newSongs = useDiscoverData('getNeteaseNewSongList');
  const qqHotlist = useDiscoverData('getQQHotlist');
  const qqNewSongs = useDiscoverData('getQQNewSongList');
  const playlists = useDiscoverData('getNeteasePlaylists', '全部', 'hot', 0, 10);

  const [activeTab, setActiveTab] = useState<'songs' | 'artists'>('songs');
  const [artistResults, setArtistResults] = useState<Artist[]>([]);
  const [artistLoading, setArtistLoading] = useState(false);
  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [selectedSongsForPlaylist, setSelectedSongsForPlaylist] = useState<Song[]>([]);

  const handleLoadMore = useCallback(() => { searchService.loadMore(); }, []);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useInfiniteScroll(scrollContainerRef, { onLoadMore: handleLoadMore, loading, hasMore });

  // 切换到歌手 tab 或关键词变化时搜索歌手
  useEffect(() => {
    if (!currentKeyword || activeTab !== 'artists') return;
    let cancelled = false;
    setArtistLoading(true);
    callMusicApi('searchNeteaseArtists', currentKeyword, 30)
      .then((result) => { if (!cancelled) setArtistResults(result); })
      .catch(() => { if (!cancelled) setArtistResults([]); })
      .finally(() => { if (!cancelled) setArtistLoading(false); });
    return () => { cancelled = true; };
  }, [currentKeyword, activeTab]);

  const handleHotlistSongClick = async (song: HotlistSong, sourceType: 'netease' | 'qq' = 'netease') => {
    try {
      const keyword = `${song.name} ${song.artists}`;
      const searchResults = await callMusicApi('searchSongsRouted', keyword, 1, sourceType);
      if (searchResults.length > 0) {
        await play(searchResults[0]);
      } else {
        message.warning('未找到可播放的音源');
      }
    } catch (error) {
      console.error('搜索歌曲失败:', error);
      message.error('播放失败，请检查网络连接或稍后重试');
    }
  };

  const handlePlaySong = async (song: Song) => { await play(song); };

  const handleToggleFavorite = async (song: Song) => {
    try { await toggleFavorite(song); } catch (error) { console.error('收藏操作失败:', error); }
  };

  // SongList 行内「加入歌单」由组件内部单曲弹窗闭环，此 prop 仅作成功通知（勿在此开弹窗）
  const handleAddToPlaylist = (_song: Song) => {};
  const handleBatchAddToPlaylist = (selectedSongs: Song[]) => { setSelectedSongsForPlaylist(selectedSongs); setBatchModalVisible(true); };

  const handleBackFromSearch = () => {
    useSearchStore.getState().reset();
    setArtistResults([]);
    setActiveTab('songs');
  };

  useEffect(() => {
    if (currentKeyword && groups.length > 0 && useSearchStore.getState().expandedKeys.length === 0) {
      useSearchStore.getState().expandAll();
    }
  }, [currentKeyword, groups.length]);

  const hotlistData = (hotlist.data || []).slice(0, 20);
  const newSongsData = (newSongs.data || []).slice(0, 20);
  const qqHotlistData = (qqHotlist.data || []).slice(0, 20);
  const qqNewSongsData = (qqNewSongs.data || []).slice(0, 20);
  const playlistsData = playlists.data?.playlists?.slice(0, 10) || [];
  const anyError = hotlist.error || newSongs.error || qqHotlist.error || qqNewSongs.error || playlists.error;

  // 如果有搜索关键词，显示搜索结果
  if (currentKeyword && (songs.length > 0 || groups.length > 0 || artistResults.length > 0 || loading || error)) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 搜索结果导航栏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
            padding: 'var(--space-3) var(--space-6)',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface)',
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
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              color: 'var(--text-secondary)',
              transition: 'all 0.2s ease',
              fontSize: 'var(--text-base)',
              fontWeight: 500,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
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
              fontSize: 'var(--text-xl)',
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
            gap: 'var(--space-1)',
            padding: '0 var(--space-6)',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface)',
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
                padding: 'var(--space-3) var(--space-5)',
                border: 'none',
                borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 'var(--text-base)',
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{
                  marginLeft: 'var(--space-2)',
                  fontSize: '11px',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  backgroundColor: activeTab === tab.key ? 'var(--accent)' : 'var(--bg-hover)',
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
                backgroundColor: 'var(--danger-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--danger)',
                marginBottom: '16px',
                fontSize: 'var(--text-base)',
              }}
            >
              {error}
            </div>
          )}

          {activeTab === 'songs' && (
            isAllMode ? (
              <>
                <GroupedSongList
                  onPlay={handlePlaySong}
                  onAddToPlaylist={handleAddToPlaylist}
                  onToggleFavorite={handleToggleFavorite}
                  onDownload={download}
                  selectedIds={[]}
                  onSelectionChange={() => {}}
                  loading={loading}
                  hasMore={hasMore}
                  onLoadMore={handleLoadMore}
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
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                    加载中...
                  </div>
                )}
                {!hasMore && songs.length > 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)',
                      padding: '16px 12px', borderRadius: '12px',
                      backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                    }}>
                      <div className="skeleton-shimmer" style={{
                        width: '80px', height: '80px', borderRadius: '50%',
                      }} />
                      <div className="skeleton-shimmer" style={{
                        width: '60px', height: '14px', borderRadius: '2px',
                      }} />
                    </div>
                  ))}
                </div>
              ) : artistResults.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
                  {artistResults.map((artist) => (
                    <div
                      key={artist.id}
                      onClick={() => {
                        cacheArtistMeta(artist.id, { name: artist.name, pic: artist.picUrl });
                        navigate(`/artist/${artist.id}`, { state: { name: artist.name, pic: artist.picUrl } });
                      }}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)',
                        padding: '16px 12px', borderRadius: '12px', cursor: 'pointer',
                        transition: 'all 0.2s ease', backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-default)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-4px)';
                        e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
                        e.currentTarget.style.borderColor = 'var(--accent)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                        e.currentTarget.style.borderColor = 'var(--border-default)';
                      }}
                    >
                      <div style={{
                        width: '80px', height: '80px', borderRadius: '50%',
                        overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0,
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
                        fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)',
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
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {playlists.loading ? (
            Array.from({ length: 10 }).map((_, index) => (
              <div key={`playlist-skeleton-${index}`}>
                <div
                  style={{
                    paddingTop: '100%',
                    borderRadius: 'var(--radius-md)',
                    background: 'linear-gradient(135deg, var(--skeleton-shine) 0%, var(--skeleton-base) 50%, var(--skeleton-shine) 100%)',
                    backgroundSize: '200% 200%',
                    animation: 'skeletonLoading 1.5s ease-in-out infinite',
                  }}
                />
                <div
                  style={{
                    height: '14px',
                    marginTop: '8px',
                    borderRadius: '2px',
                    background: 'linear-gradient(135deg, var(--skeleton-shine) 0%, var(--skeleton-base) 50%, var(--skeleton-shine) 100%)',
                    backgroundSize: '200% 200%',
                    animation: 'skeletonLoading 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            ))
          ) : playlists.error ? (
            <div style={{ gridColumn: '1 / -1', padding: '20px', textAlign: 'center', color: 'var(--danger)', backgroundColor: 'var(--danger-subtle)', borderRadius: 'var(--radius-md)' }}>
              {playlists.error}
            </div>
          ) : (
            playlistsData.map(playlist => (
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
          <HotlistCard
            title="网易热歌榜"
            coverTitle="热歌"
            coverGradient="linear-gradient(135deg, #2d1b4e 0%, #1a1a2e 50%, #16213e 100%)"
            radialGradient="radial-gradient(circle at 30% 30%, rgba(102, 126, 234, 0.3) 0%, transparent 60%)"
            badgeText="50首"
            route="/hotlist/netease"
            songs={hotlistData}
            loading={hotlist.loading}
            sourceType="netease"
            onSongClick={handleHotlistSongClick}
          />

          <HotlistCard
            title="QQ音乐热歌榜"
            coverTitle="热歌"
            coverGradient="linear-gradient(135deg, #1a3a2e 0%, #0f2027 50%, #203a43 100%)"
            radialGradient="radial-gradient(circle at 70% 30%, rgba(78, 205, 196, 0.3) 0%, transparent 60%)"
            badgeText="100首"
            route="/hotlist/qq"
            songs={qqHotlistData}
            loading={qqHotlist.loading}
            sourceType="qq"
            onSongClick={handleHotlistSongClick}
          />

          <HotlistCard
            title="网易新歌榜"
            coverTitle="新歌"
            coverGradient="linear-gradient(135deg, #4a1942 0%, #2d1b4e 50%, #1a1a2e 100%)"
            radialGradient="radial-gradient(circle at 50% 50%, rgba(156, 39, 176, 0.3) 0%, transparent 60%)"
            badgeText="100首"
            route="/hotlist/netease_new"
            songs={newSongsData}
            loading={newSongs.loading}
            sourceType="netease"
            onSongClick={handleHotlistSongClick}
          />

          <HotlistCard
            title="QQ音乐新歌榜"
            coverTitle="新歌"
            coverGradient="linear-gradient(135deg, #1e3c72 0%, #2a5298 50%, #1e3c72 100%)"
            radialGradient="radial-gradient(circle at 50% 50%, rgba(33, 150, 243, 0.3) 0%, transparent 60%)"
            badgeText="100首"
            route="/hotlist/qq_new"
            songs={qqNewSongsData}
            loading={qqNewSongs.loading}
            sourceType="qq"
            onSongClick={handleHotlistSongClick}
          />
          {(anyError) && (
            <div style={{ gridColumn: '1 / -1', padding: '16px', textAlign: 'center', color: 'var(--danger)', backgroundColor: 'var(--danger-subtle)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-base)' }}>
              {anyError}
            </div>
          )}
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

      {/* 批量加入歌单弹窗 */}
      <BatchAddToPlaylistModal
        isVisible={batchModalVisible}
        songs={selectedSongsForPlaylist}
        onClose={() => {
          setBatchModalVisible(false);
          setSelectedSongsForPlaylist([]);
        }}
      />
    </div>
  );
};

export default DiscoverPage;
