import React, { useState, useEffect } from 'react';
import { ipcRenderer } from 'electron';
import { ArrowLeft } from 'lucide-react';
import { message } from 'antd';
import { useSearchStore } from '@/renderer/store/searchStore';
import { searchService } from '@/renderer/services/searchService';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownloadStore, type DownloadTask } from '@/renderer/store/downloadStore';
import { useLazyLoad } from '@/renderer/hooks/useLazyLoad';
import Sidebar from '@/renderer/components/Sidebar';
import TopBar from '@/renderer/components/TopBar';
import PlayerBar from '@/renderer/components/PlayerBar';
import SongList from '@/renderer/components/SongList';
import DownloadProgressModal from '@/renderer/components/DownloadProgressModal';
import DiscoverPage from '@/renderer/pages/DiscoverPage';
import FavoritesPage from '@/renderer/pages/FavoritesPage';
import HistoryPage from '@/renderer/pages/HistoryPage';
import PlaylistsPage from '@/renderer/pages/PlaylistsPage';
import SettingsPage from '@/renderer/pages/SettingsPage';
import LyricsPage from '@/renderer/pages/LyricsPage';
import PlaylistDetailPage from '@/renderer/pages/PlaylistDetailPage';
import HotlistDetailPage from '@/renderer/pages/HotlistDetailPage';
import type { Song } from '@/shared/types/song';

import './styles/global.css';

type PageType = 'discover' | 'local' | 'download' | 'favorites' | 'history' | 'playlists' | 'settings' | 'playlist-detail' | 'hotlist-detail';
type DiscoverRoute = 'discover' | `hotlist-detail-${'netease' | 'qq'}` | 'search-result';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageType>('discover');
  const [showLyrics, setShowLyrics] = useState(false);
  const [currentPlaylistId, setCurrentPlaylistId] = useState<number | undefined>();
  const [routeStack, setRouteStack] = useState<DiscoverRoute[]>(['discover']);
  const [currentRouteIndex, setCurrentRouteIndex] = useState(0);
  const [searchKeywordHistory, setSearchKeywordHistory] = useState<string | null>(null);
  const [currentHotlistType, setCurrentHotlistType] = useState<'netease' | 'qq'>('netease');

  const {
    songs,
    loading,
    hasMore,
    error,
    currentKeyword,
    sourceType,
    setSourceType
  } = useSearchStore();

  const { play, currentSong, isPlaying } = usePlayerStore();
  const { favoriteIds, toggleFavorite, loadFavorites } = useFavoriteStore();
  const { notifications, addSingleDownload, addBatchDownload, updateTask, closeNotification } = useDownloadStore();

  // 组件挂载时加载收藏列表
  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  // 监听下载进度事件
  useEffect(() => {
    const handleProgress = (_event: any, task: DownloadTask) => {
      updateTask(task.id, { progress: task.progress, status: task.status });
    };

    const handleComplete = (_event: any, task: DownloadTask) => {
      updateTask(task.id, { progress: 100, status: 'completed', filePath: task.filePath });
    };

    const handleError = (_event: any, { task, error }: { task: DownloadTask; error: string }) => {
      updateTask(task.id, { status: 'error', error });
    };

    ipcRenderer.on('download:progress', handleProgress);
    ipcRenderer.on('download:complete', handleComplete);
    ipcRenderer.on('download:error', handleError);

    return () => {
      ipcRenderer.removeListener('download:progress', handleProgress);
      ipcRenderer.removeListener('download:complete', handleComplete);
      ipcRenderer.removeListener('download:error', handleError);
    };
  }, [updateTask]);

  const handleSearch = (value: string) => {
    console.log('[App] 搜索开始，关键词:', value);
    console.log('[App] 当前页面:', currentPage);
    searchService.search(value);

    // 如果当前不在发现页，先跳转到发现页
    if (currentPage !== 'discover' && currentPage !== 'hotlist-detail') {
      console.log('[App] 从其他选项卡搜索，跳转到发现页');
      setCurrentPage('discover');
      // 重置路由栈
      setRouteStack(['discover', 'search-result']);
      setCurrentRouteIndex(1);
    } else {
      // 在发现页或热榜详情页内搜索，添加到路由栈
      console.log('[App] 在发现相关页面内搜索，添加到路由栈');
      // 保存当前路由状态
      const newStack = routeStack.slice(0, currentRouteIndex + 1);
      newStack.push('search-result');
      setRouteStack(newStack);
      setCurrentRouteIndex(newStack.length - 1);
    }
    console.log('[App] 路由栈:', routeStack);
  };

  const handleSourceTypeChange = (newType: 'netease' | 'qq') => {
    setSourceType(newType);
    // 如果有当前搜索关键词，使用新的音乐源重新搜索
    if (currentKeyword) {
      searchService.search(currentKeyword);
    }
  };

  const handleLoadMore = () => {
    searchService.loadMore();
  };

  // 懒加载钩子
  const { triggerRef } = useLazyLoad({
    onLoadMore: handleLoadMore,
    hasMore,
    loading,
  });

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

  const handleBatchDownload = async (selectedSongs: Song[]) => {
    try {
      const tasks = await ipcRenderer.invoke('download:startBatch', selectedSongs);
      console.log('[App] 批量下载任务已创建:', tasks);
      if (tasks && Array.isArray(tasks)) {
        addBatchDownload(tasks);
      }
    } catch (error) {
      console.error('批量下载失败:', error);
      message.error('批量下载失败，请重试');
    }
  };

  const handleDownload = async (song: Song) => {
    console.log('[App] handleDownload 被调用, song:', song);
    try {
      const task = await ipcRenderer.invoke('download:start', song);
      console.log('[App] 下载任务已创建:', task);
      if (task) {
        addSingleDownload(task);
      }
    } catch (error) {
      console.error('[App] 下载失败:', error);
      message.error('下载失败，请重试');
    }
  };

  const handleNavigateToPlaylistDetail = (playlistId?: number) => {
    setCurrentPlaylistId(playlistId);
    setCurrentPage('playlist-detail');
  };

  const handleBackFromPlaylistDetail = () => {
    setCurrentPlaylistId(undefined);
    setCurrentPage('playlists');
  };

  const handleNavigateToHotlistDetail = (type: 'netease' | 'qq' = 'netease') => {
    console.log('[App] 导航到热榜详情页，类型:', type);
    // 添加到路由栈
    const newStack = routeStack.slice(0, currentRouteIndex + 1);
    newStack.push(`hotlist-detail-${type}`);
    setRouteStack(newStack);
    setCurrentRouteIndex(newStack.length - 1);
    setCurrentPage('hotlist-detail');
    // 保存当前热榜类型
    setCurrentHotlistType(type);
    console.log('[App] 路由栈:', routeStack);
  };

  const handleBackFromHotlistDetail = () => {
    console.log('[App] 从热榜详情页返回');
    // 返回到上一个路由
    if (currentRouteIndex > 0) {
      const newIndex = currentRouteIndex - 1;
      const previousRoute = routeStack[newIndex];
      setCurrentRouteIndex(newIndex);
      // 根据路由类型设置页面
      if (previousRoute === 'discover') {
        setCurrentPage('discover');
      } else if (previousRoute === 'search-result') {
        // 搜索结果页不需要特殊处理，因为renderContent会根据currentKeyword显示
      }
    }
    console.log('[App] 路由栈:', routeStack);
  };

  const handleAddToPlaylist = (song: Song) => {
    message.success(`已成功将 "${song.name}" 加入歌单！`);
  };

  const handleBatchAddToPlaylist = (selectedSongs: Song[]) => {
    message.success(`已成功将 ${selectedSongs.length} 首歌曲加入歌单！`);
  };

  const handleBackFromSearch = () => {
    console.log('[App] 从搜索结果页返回');
    console.log('[App] 当前路由栈:', routeStack);
    console.log('[App] 当前路由索引:', currentRouteIndex);

    // 保存搜索关键词到历史记录
    setSearchKeywordHistory(currentKeyword);

    // 清除搜索关键词
    searchService.reset();

    // 返回到上一个路由
    if (currentRouteIndex > 0) {
      const newIndex = currentRouteIndex - 1;
      const previousRoute = routeStack[newIndex];
      setCurrentRouteIndex(newIndex);
      // 根据路由类型设置页面
      if (previousRoute === 'discover') {
        setCurrentPage('discover');
      } else if (previousRoute.startsWith('hotlist-detail-')) {
        setCurrentPage('hotlist-detail');
      }
    }
    console.log('[App] 路由栈:', routeStack);
  };

  // 处理前进按钮点击
  const handleForward = () => {
    console.log('[App] 前进按钮被点击');
    if (currentRouteIndex < routeStack.length - 1) {
      const newIndex = currentRouteIndex + 1;
      const nextRoute = routeStack[newIndex];
      setCurrentRouteIndex(newIndex);
      // 根据路由类型设置页面
      if (nextRoute === 'discover') {
        setCurrentPage('discover');
      } else if (nextRoute.startsWith('hotlist-detail-')) {
        setCurrentPage('hotlist-detail');
      } else if (nextRoute === 'search-result') {
        // 如果有保存的搜索关键词，重新搜索
        if (searchKeywordHistory) {
          searchService.search(searchKeywordHistory);
        }
      }
    }
  };

  // 处理后退按钮点击
  const handleBack = () => {
    console.log('[App] 统一后退按钮被点击');
    if (currentKeyword && songs.length > 0) {
      handleBackFromSearch();
    } else if (currentPage === 'hotlist-detail') {
      handleBackFromHotlistDetail();
    }
  };

  // 渲染统一导航栏
  const renderNavigationBar = (title: string) => {
    const canGoBack = currentRouteIndex > 0;
    const canGoForward = currentRouteIndex < routeStack.length - 1;

    return (
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
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleBack}
            disabled={!canGoBack}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: canGoBack ? 'pointer' : 'not-allowed',
              padding: '10px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: canGoBack ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              transition: 'all 0.2s ease',
              fontSize: '14px',
              fontWeight: 500,
            }}
            onMouseEnter={(e) => {
              if (canGoBack) {
                e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.transform = 'translateX(-2px)';
              }
            }}
            onMouseLeave={(e) => {
              if (canGoBack) {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.transform = 'translateX(0)';
              }
            }}
          >
            <ArrowLeft size={16} />
            <span>返回</span>
          </button>
          <button
            onClick={handleForward}
            disabled={!canGoForward}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: canGoForward ? 'pointer' : 'not-allowed',
              padding: '10px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: canGoForward ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              transition: 'all 0.2s ease',
              fontSize: '14px',
              fontWeight: 500,
            }}
            onMouseEnter={(e) => {
              if (canGoForward) {
                e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.transform = 'translateX(2px)';
              }
            }}
            onMouseLeave={(e) => {
              if (canGoForward) {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.transform = 'translateX(0)';
              }
            }}
          >
            <ArrowLeft size={16} style={{ transform: 'rotate(180deg)' }} />
            <span>前进</span>
          </button>
        </div>
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
          {title}
        </h1>
        <div style={{ width: '140px' }} />
      </div>
    );
  };

  const renderContent = () => {
    if (showLyrics) {
      return <LyricsPage onBack={() => setShowLyrics(false)} />;
    }

    // 只有在发现页或热榜详情页时才显示搜索结果
    if (currentKeyword && songs.length > 0 && (currentPage === 'discover' || currentPage === 'hotlist-detail')) {
      return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {renderNavigationBar(`搜索结果: ${currentKeyword}`)}
          <div style={{ padding: '24px', flex: 1, overflow: 'auto' }}>
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
              onBatchDownload={handleBatchDownload}
              onDownload={handleDownload}
              enableBatchAddToPlaylist={true}
              onBatchAddToPlaylist={handleBatchAddToPlaylist}
              onAddToPlaylist={handleAddToPlaylist}
            />

            {/* 懒加载触发器和加载状态 */}
            {hasMore && (
              <div
                ref={triggerRef}
                style={{
                  height: '60px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: '16px',
                }}
              >
                {loading && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      color: 'var(--text-tertiary)',
                      fontSize: '13px',
                    }}
                  >
                    <div
                      style={{
                        width: '16px',
                        height: '16px',
                        border: '2px solid var(--divider-color)',
                        borderTopColor: 'var(--primary-color)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }}
                    />
                    正在加载更多...
                  </div>
                )}
              </div>
            )}

            <style>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>

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

    switch (currentPage) {
      case 'discover':
        return (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {renderNavigationBar('发现音乐')}
            <DiscoverPage onPlay={handlePlaySong} onNavigateToHotlistDetail={handleNavigateToHotlistDetail} />
          </div>
        );

      case 'favorites':
        return <FavoritesPage onPlay={handlePlaySong} onAddToPlaylist={handleAddToPlaylist} />;

      case 'history':
        return <HistoryPage onPlay={handlePlaySong} onAddToPlaylist={handleAddToPlaylist} />;

      case 'playlists':
        return <PlaylistsPage onNavigateToPlaylistDetail={handleNavigateToPlaylistDetail} />;

      case 'playlist-detail':
        return (
          <PlaylistDetailPage
            playlistId={currentPlaylistId}
            onPlay={handlePlaySong}
            onBack={handleBackFromPlaylistDetail}
            onDownload={handleDownload}
            onBatchDownload={handleBatchDownload}
            onAddToPlaylist={handleAddToPlaylist}
          />
        );

      case 'hotlist-detail':
        return (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {renderNavigationBar(currentHotlistType === 'netease' ? '网易云音乐热歌榜' : 'QQ音乐热歌榜')}
            <HotlistDetailPage
              onBack={handleBackFromHotlistDetail}
              onPlay={handlePlaySong}
              hotlistType={currentHotlistType}
              onDownload={handleDownload}
              onBatchDownload={handleBatchDownload}
              onAddToPlaylist={handleAddToPlaylist}
              onBatchAddToPlaylist={handleBatchAddToPlaylist}
            />
          </div>
        );

      case 'settings':
        return <SettingsPage />;

      case 'local':
      case 'download':
        return (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-tertiary)',
            }}
          >
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>🚧</div>
            <div style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              功能开发中
            </div>
            <div style={{ fontSize: '14px' }}>该功能即将上线，敬请期待</div>
          </div>
        );

      default:
        return <DiscoverPage onPlay={handlePlaySong} onNavigateToHotlistDetail={handleNavigateToHotlistDetail} />;
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        backgroundColor: 'var(--bg-color)',
      }}
    >
      {/* 左侧导航栏 */}
      <Sidebar
        currentPage={currentPage === 'playlist-detail' ? 'playlists' : currentPage}
        onPageChange={(page) => {
          const newPage = page as PageType;
          setCurrentPage(newPage);

          // 当切换到非发现页的选项卡时，保存当前的路由栈和搜索状态
          if (newPage !== 'discover' && newPage !== 'hotlist-detail') {
            // 不重置搜索状态和路由栈，保留它们以便返回时恢复
          }
        }}
      />

      {/* 主内容区域 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 顶部导航栏 */}
        <TopBar
          onSearch={handleSearch}
          searchLoading={loading}
          sourceType={sourceType}
          onSourceTypeChange={handleSourceTypeChange}
        />

        {/* 页面内容 */}
        <main
          style={{
            flex: 1,
            overflow: 'hidden',
            backgroundColor: 'var(--bg-color)',
          }}
        >
          {renderContent()}
        </main>

        {/* 底部播放控制栏 */}
        <PlayerBar onCoverClick={() => setShowLyrics(true)} />
      </div>

      {/* 下载进度弹窗 */}
      {notifications.map((notification) =>
        notification.isVisible ? (
          <DownloadProgressModal
            key={notification.id}
            notification={notification}
            onClose={() => closeNotification(notification.id)}
          />
        ) : null
      )}
    </div>
  );
};

export default App;
