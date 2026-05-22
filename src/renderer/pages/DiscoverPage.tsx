import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, TrendingUp, Disc, Radio, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSearchStore } from '@/renderer/store/searchStore';
import { searchService } from '@/renderer/services/searchService';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useLazyLoad } from '@/renderer/hooks/useLazyLoad';
import { useDownload } from '@/renderer/hooks/useDownload';
import SongList from '@/renderer/components/SongList';
import type { Song } from '@/shared/types/song';
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

const DiscoverPage: React.FC = () => {
  const navigate = useNavigate();
  const [hotlist, setHotlist] = useState<HotlistSong[]>([]);
  const [hotlistLoading, setHotlistLoading] = useState(true);
  const [qqHotlist, setQQHotlist] = useState<HotlistSong[]>([]);
  const [qqHotlistLoading, setQQHotlistLoading] = useState(true);

  const { songs, loading, currentKeyword, hasMore, error } = useSearchStore();
  const { currentSong, isPlaying, play } = usePlayerStore();

  const handleLoadMore = useCallback(() => {
    searchService.loadMore();
  }, []);

  const { triggerRef } = useLazyLoad({
    onLoadMore: handleLoadMore,
    hasMore,
    loading,
  });
  const { favoriteIds, toggleFavorite } = useFavoriteStore();
  const { download, downloadBatch } = useDownload();

  // 加载网易热榜数据
  useEffect(() => {
    const loadHotlist = async () => {
      try {
        setHotlistLoading(true);
        const result = await ipcRenderer.invoke('musicApi:getNeteaseHotlist');
        const data = result.success ? result.data : [];
        setHotlist(data.slice(0, 20));
      } catch (error) {
        console.error('加载网易热榜失败:', error);
      } finally {
        setHotlistLoading(false);
      }
    };
    loadHotlist();
  }, []);

  // 加载QQ音乐热榜数据
  useEffect(() => {
    const loadQQHotlist = async () => {
      try {
        setQQHotlistLoading(true);
        const result = await ipcRenderer.invoke('musicApi:getQQHotlist');
        const data = result.success ? result.data : [];
        setQQHotlist(data.slice(0, 20));
      } catch (error) {
        console.error('加载QQ音乐热榜失败:', error);
      } finally {
        setQQHotlistLoading(false);
      }
    };
    loadQQHotlist();
  }, []);

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
  };

  // 如果有搜索关键词，显示搜索结果
  if (currentKeyword && songs.length > 0) {
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

        {/* 搜索结果内容 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
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

          <SongList
            songs={songs}
            currentSongId={currentSong?.id}
            isPlaying={isPlaying}
            favoriteIds={favoriteIds}
            onPlay={handlePlaySong}
            onToggleFavorite={handleToggleFavorite}
            showCheckbox={true}
            enableBatchDownload={true}
            onBatchDownload={downloadBatch}
            onDownload={download}
            enableBatchAddToPlaylist={true}
            onBatchAddToPlaylist={handleBatchAddToPlaylist}
            onAddToPlaylist={handleAddToPlaylist}
          />

          {/* 滚动加载触发器 */}
          {hasMore && (
            <div ref={triggerRef} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
              {loading ? '加载中...' : '上滑加载更多'}
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
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
              <div>未找到相关歌曲</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 默认显示发现页内容
  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      {/* Banner 区域 */}
      <div
        style={{
          height: '200px',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '32px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.08\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
          }}
        />
        <div style={{ textAlign: 'center', color: 'white', zIndex: 1 }}>
          <h1 style={{ fontSize: '32px', fontWeight: 700, marginBottom: '8px' }}>
            发现好音乐
          </h1>
          <p style={{ fontSize: '16px', opacity: 0.9 }}>
            探索无限可能，聆听世界声音
          </p>
        </div>
      </div>

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
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '20px',
          }}
        >
          {/* 网易热榜卡片 */}
          <div
            style={{
              backgroundColor: 'var(--content-bg)',
              borderRadius: '8px',
              padding: '16px',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '6px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 600,
                }}
              >
                热榜
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  网易热榜
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  实时更新，最热门的50首歌曲
                </div>
              </div>
            </div>
            <div>
              {hotlistLoading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={`placeholder-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 0',
                      borderBottom: index < 4 ? '1px solid var(--divider-color)' : 'none',
                    }}
                  >
                    <span
                      style={{
                        width: '20px',
                        height: '14px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        height: '13px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.1s',
                      }}
                    />
                    <span
                      style={{
                        width: '80px',
                        height: '12px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.2s',
                      }}
                    />
                  </div>
                ))
              ) : (
                hotlist.slice(0, 5).map((song) => (
                  <div
                    key={song.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 0',
                      borderBottom: song.rank < 5 ? '1px solid var(--divider-color)' : 'none',
                    }}
                  >
                    <span
                      style={{
                        width: '20px',
                        fontSize: '14px',
                        fontWeight: 600,
                        color: song.rank <= 3 ? '#FF4D4F' : 'var(--text-tertiary)',
                      }}
                    >
                      {song.rank}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: '13px',
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
                        fontSize: '12px',
                        color: 'var(--text-tertiary)',
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
              backgroundColor: 'var(--content-bg)',
              borderRadius: '8px',
              padding: '16px',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '6px',
                  background: 'linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 600,
                }}
              >
                热榜
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  QQ音乐热榜
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  实时更新，最热门的20首歌曲
                </div>
              </div>
            </div>
            <div>
              {qqHotlistLoading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={`qq-placeholder-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 0',
                      borderBottom: index < 4 ? '1px solid var(--divider-color)' : 'none',
                    }}
                  >
                    <span
                      style={{
                        width: '20px',
                        height: '14px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        height: '13px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.1s',
                      }}
                    />
                    <span
                      style={{
                        width: '80px',
                        height: '12px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.2s',
                      }}
                    />
                  </div>
                ))
              ) : (
                qqHotlist.slice(0, 5).map((song) => (
                  <div
                    key={song.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 0',
                      borderBottom: song.rank < 5 ? '1px solid var(--divider-color)' : 'none',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                    onClick={() => handleHotlistSongClick(song, 'qq')}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <span
                      style={{
                        width: '20px',
                        fontSize: '14px',
                        fontWeight: 600,
                        color: song.rank <= 3 ? '#FF4D4F' : 'var(--text-tertiary)',
                      }}
                    >
                      {song.rank}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: '13px',
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
                        fontSize: '12px',
                        color: 'var(--text-tertiary)',
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

      {/* 推荐歌单 - 功能开发中 */}
      <section style={{ marginBottom: '40px' }}>
        <SectionHeader
          icon={<Sparkles size={22} />}
          title="推荐歌单"
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '120px',
            backgroundColor: 'var(--content-bg)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>推荐歌单功能开发中...</span>
        </div>
      </section>

      {/* 新碟上架 - 功能开发中 */}
      <section style={{ marginBottom: '40px' }}>
        <SectionHeader
          icon={<Disc size={22} />}
          title="新碟上架"
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '120px',
            backgroundColor: 'var(--content-bg)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>新碟上架功能开发中...</span>
        </div>
      </section>

      {/* 电台推荐 - 功能开发中 */}
      <section>
        <SectionHeader
          icon={<Radio size={22} />}
          title="热门电台"
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '120px',
            backgroundColor: 'var(--content-bg)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>热门电台功能开发中...</span>
        </div>
      </section>
    </div>
  );
};

export default DiscoverPage;
