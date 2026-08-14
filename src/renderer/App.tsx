import React, { useState, useEffect, useCallback, useRef } from 'react';
const { ipcRenderer } = window.require('electron');
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useSearchStore } from '@/renderer/store/searchStore';
import { searchService } from '@/renderer/services/searchService';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownloadStore, type DownloadTask } from '@/renderer/store/downloadStore';
import { useGlobalShortcuts } from '@/renderer/hooks/useGlobalShortcuts';
import Sidebar from '@/renderer/components/Sidebar';
import TitleBar from '@/renderer/components/TitleBar';
import TopBar from '@/renderer/components/TopBar';
import type { SourceKey } from '@/renderer/store/searchStore';
import PlayerBar from '@/renderer/components/PlayerBar';
import DownloadProgressModal from '@/renderer/components/DownloadProgressModal';
import LyricsPage from '@/renderer/pages/LyricsPage';

import './styles/global.css';

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showLyrics, setShowLyrics] = useState(false);

  // History navigation management
  const historyStack = useRef<string[]>([location.pathname]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const isNavigating = useRef(false);

  useEffect(() => {
    if (isNavigating.current) {
      isNavigating.current = false;
      return;
    }
    const path = location.pathname;
    if (historyStack.current[historyIndex] !== path) {
      historyStack.current = historyStack.current.slice(0, historyIndex + 1);
      historyStack.current.push(path);
      setHistoryIndex(historyStack.current.length - 1);
    }
  }, [location.pathname, historyIndex]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < historyStack.current.length - 1;

  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      isNavigating.current = true;
      setHistoryIndex(newIndex);
      navigate(historyStack.current[newIndex]);
    }
  }, [navigate, historyIndex]);

  const handleForward = useCallback(() => {
    if (historyIndex < historyStack.current.length - 1) {
      const newIndex = historyIndex + 1;
      isNavigating.current = true;
      setHistoryIndex(newIndex);
      navigate(historyStack.current[newIndex]);
    }
  }, [navigate, historyIndex]);

  const handleRefresh = useCallback(() => {
    navigate(0);
  }, [navigate]);

  const {
    currentKeyword,
    sourceType,
    setSourceType,
  } = useSearchStore();

  const { loadFavorites } = useFavoriteStore();
  const { notifications, updateTask, closeNotification } = useDownloadStore();

  // 组件挂载时加载收藏列表
  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  // Tray action handler
  useEffect(() => {
    const handleTrayAction = (_event: any, payload: { type: string }) => {
      const store = usePlayerStore.getState();
      switch (payload.type) {
        case 'playPause': store.togglePlay(); break;
        case 'next': store.playNext(); break;
        case 'prev': store.playPrevious(); break;
      }
    };

    ipcRenderer.on('tray:action', handleTrayAction);
    return () => {
      ipcRenderer.removeListener('tray:action', handleTrayAction);
    };
  }, []);

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

  useGlobalShortcuts();

  const dispatchSearch = (keyword: string) => {
    const { sourceType } = useSearchStore.getState();
    if (sourceType === 'all') {
      searchService.searchAll(keyword);
    } else {
      searchService.search(keyword);
    }
  };

  const handleSearch = (value: string) => {
    dispatchSearch(value);
    if (location.pathname !== '/discover') {
      navigate('/discover');
    }
  };

  const handleSourceTypeChange = (newType: SourceKey) => {
    useSearchStore.getState().reset();
    setSourceType(newType);
    if (currentKeyword) {
      dispatchSearch(currentKeyword);
    }
  };

  // 根据路径获取当前活跃的侧边栏项
  const getActiveSidebarKey = () => {
    const path = location.pathname;
    if (path.startsWith('/recommend')) return 'recommend';
    if (path.startsWith('/discover') || path.startsWith('/hotlist') || path.startsWith('/discover-playlist')) return 'discover';
    if (path.startsWith('/artists') || path.startsWith('/artist/')) return 'artists';
    if (path.startsWith('/local')) return 'local';
    if (path.startsWith('/favorites')) return 'favorites';
    if (path.startsWith('/history')) return 'history';
    if (path.startsWith('/playlists') || path.startsWith('/playlist/')) return 'playlists';
    if (path.startsWith('/queue')) return 'queue';
    if (path.startsWith('/download')) return 'download';
    if (path.startsWith('/settings')) return 'settings';
    return 'discover';
  };

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-base)',
        overflow: 'hidden',
      }}
    >
      <TitleBar />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* 左侧导航栏 */}
        <Sidebar
          currentPage={getActiveSidebarKey()}
          onPageChange={(page) => {
            // 切换页面时清除搜索状态
            useSearchStore.getState().reset();
            navigate(`/${page}`);
          }}
        />

        {/* 主内容区域 */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0,
          }}
        >
          {/* 顶部导航栏 */}
          <TopBar
            onSearch={handleSearch}
            sourceType={sourceType}
            onSourceTypeChange={handleSourceTypeChange}
            onBack={handleBack}
            onForward={handleForward}
            onRefresh={handleRefresh}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
          />

          {/* 页面内容 - 由React Router渲染 */}
          <main
            style={{
              flex: 1,
              overflow: 'hidden',
              backgroundColor: 'var(--bg-base)',
            }}
          >
            {showLyrics ? (
              <LyricsPage onBack={() => setShowLyrics(false)} />
            ) : (
              <Outlet />
            )}
          </main>

          {/* 底部播放控制栏 */}
          <PlayerBar onCoverClick={() => setShowLyrics(true)} />
        </div>
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
