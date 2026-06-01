import React, { useState, useEffect } from 'react';
const { ipcRenderer } = window.require('electron');
import { message, Modal } from 'antd';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useSearchStore } from '@/renderer/store/searchStore';
import { searchService } from '@/renderer/services/searchService';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownloadStore, type DownloadTask } from '@/renderer/store/downloadStore';
import { useGlobalShortcuts } from '@/renderer/hooks/useGlobalShortcuts';
import Sidebar from '@/renderer/components/Sidebar';
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

  const {
    loading,
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

  // IPC通信机制
  useEffect(() => {
    const handleIPCResponse = (_event: any, { requestId, success, data, error }: any) => {
      console.log('收到IPC响应:', { requestId, success, data, error });
    };

    const handleIPCError = (_event: any, error: string) => {
      console.error('IPC通信错误:', error);
      message.error('通信失败，请重试');
    };

    ipcRenderer.on('ipc:response', handleIPCResponse);
    ipcRenderer.on('ipc:error', handleIPCError);

    return () => {
      ipcRenderer.removeListener('ipc:response', handleIPCResponse);
      ipcRenderer.removeListener('ipc:error', handleIPCError);
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

  // Close-to-tray behavior
  useEffect(() => {
    const handleClose = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      Modal.confirm({
        title: '关闭确认',
        content: '关闭后播放将停止。是否最小化到托盘继续播放？',
        okText: '最小化到托盘',
        cancelText: '取消',
        onOk: () => {
          ipcRenderer.send('tray:action', { type: 'minimize' });
        },
        onCancel: () => {},
        footer: (_, { OkBtn, CancelBtn }) => (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <CancelBtn />
            <button onClick={async () => {
              Modal.destroyAll();
              await ipcRenderer.invoke('app:quit');
            }} style={{ padding: '4px 16px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', color: '#FF6B6B' }}>
              退出
            </button>
            <OkBtn />
          </div>
        ),
      });
    };

    window.addEventListener('beforeunload', handleClose);
    return () => {
      window.removeEventListener('beforeunload', handleClose);
    };
  }, []);

  const handleSearch = (value: string) => {
    console.log('[App] 搜索开始，关键词:', value);
    const { sourceType } = useSearchStore.getState();
    if (sourceType === 'all') {
      searchService.searchAll(value);
    } else {
      searchService.search(value);
    }
    if (location.pathname !== '/discover') {
      navigate('/discover');
    }
  };

  const handleSourceTypeChange = (newType: SourceKey) => {
    const isAll = newType === 'all';
    useSearchStore.getState().reset();
    setSourceType(isAll ? 'all' : newType);
    if (currentKeyword) {
      if (isAll) {
        searchService.searchAll(currentKeyword);
      } else {
        searchService.search(currentKeyword);
      }
    }
  };

  // 根据路径获取当前活跃的侧边栏项
  const getActiveSidebarKey = () => {
    const path = location.pathname;
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
        display: 'flex',
        height: '100vh',
        backgroundColor: 'var(--bg-color)',
      }}
    >
      {/* 左侧导航栏 */}
      <Sidebar
        currentPage={getActiveSidebarKey()}
        onPageChange={(page) => {
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
        }}
      >
        {/* 顶部导航栏 */}
        <TopBar
          onSearch={handleSearch}
          searchLoading={loading}
          sourceType={sourceType}
          onSourceTypeChange={handleSourceTypeChange}
        />

        {/* 页面内容 - 由React Router渲染 */}
        <main
          style={{
            flex: 1,
            overflow: 'hidden',
            backgroundColor: 'var(--bg-color)',
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
