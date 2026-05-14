import React, { Suspense, lazy } from 'react';
import { createHashRouter } from 'react-router-dom';
import App from '@/renderer/App';

// 懒加载页面组件
const DiscoverPage = lazy(() => import('@/renderer/pages/DiscoverPage'));
const HotlistDetailPage = lazy(() => import('@/renderer/pages/HotlistDetailPage'));
const FavoritesPage = lazy(() => import('@/renderer/pages/FavoritesPage'));
const HistoryPage = lazy(() => import('@/renderer/pages/HistoryPage'));
const PlaylistsPage = lazy(() => import('@/renderer/pages/PlaylistsPage'));
const PlaylistDetailPage = lazy(() => import('@/renderer/pages/PlaylistDetailPage'));
const SettingsPage = lazy(() => import('@/renderer/pages/SettingsPage'));
const QueuePage = lazy(() => import('@/renderer/pages/QueuePage'));
const LocalMusicPage = lazy(() => import('@/renderer/pages/LocalMusicPage'));

// 加载状态组件
const Loading = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--text-tertiary)',
  }}>
    <div style={{
      width: '24px',
      height: '24px',
      border: '2px solid var(--divider-color)',
      borderTopColor: 'var(--primary-color)',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
      marginRight: '12px',
    }} />
    加载中...
    <style>{`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

// 功能开发中页面
const ComingSoon: React.FC = () => (
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

// 路由配置
export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        path: 'discover',
        element: (
          <Suspense fallback={<Loading />}>
            <DiscoverPage />
          </Suspense>
        ),
      },
      {
        path: 'hotlist/:type',
        element: (
          <Suspense fallback={<Loading />}>
            <HotlistDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'favorites',
        element: (
          <Suspense fallback={<Loading />}>
            <FavoritesPage />
          </Suspense>
        ),
      },
      {
        path: 'history',
        element: (
          <Suspense fallback={<Loading />}>
            <HistoryPage />
          </Suspense>
        ),
      },
      {
        path: 'playlists',
        element: (
          <Suspense fallback={<Loading />}>
            <PlaylistsPage />
          </Suspense>
        ),
      },
      {
        path: 'playlist/:id',
        element: (
          <Suspense fallback={<Loading />}>
            <PlaylistDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'settings',
        element: (
          <Suspense fallback={<Loading />}>
            <SettingsPage />
          </Suspense>
        ),
      },
      {
        path: 'queue',
        element: (
          <Suspense fallback={<Loading />}>
            <QueuePage />
          </Suspense>
        ),
      },
      {
        path: 'local',
        element: (
          <Suspense fallback={<Loading />}>
            <LocalMusicPage />
          </Suspense>
        ),
      },
      {
        path: 'download',
        element: <ComingSoon />,
      },
      {
        path: '',
        element: (
          <Suspense fallback={<Loading />}>
            <DiscoverPage />
          </Suspense>
        ),
      },
    ],
  },
]);

export default router;
