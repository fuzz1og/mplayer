import React, { Suspense, lazy } from 'react';
import { createHashRouter, Navigate } from 'react-router-dom';
import App from '@/renderer/App';
import SettingsShell from '@/renderer/components/SettingsShell';
import '@/renderer/styles/songlist.css';

// 懒加载页面组件
const DiscoverPageV2 = lazy(() => import('@/renderer/pages/DiscoverPageV2'));
const RecommendPage = lazy(() => import('@/renderer/pages/RecommendPage'));
const HotlistDetailPage = lazy(() => import('@/renderer/pages/HotlistDetailPage'));
const FavoritesPage = lazy(() => import('@/renderer/pages/FavoritesPage'));
const HistoryPage = lazy(() => import('@/renderer/pages/HistoryPage'));
const PlaylistsPage = lazy(() => import('@/renderer/pages/PlaylistsPage'));
const PlaylistDetailPage = lazy(() => import('@/renderer/pages/PlaylistDetailPage'));
const SettingsPage = lazy(() => import('@/renderer/pages/SettingsPage'));
const QueuePage = lazy(() => import('@/renderer/pages/QueuePage'));
const LocalMusicPage = lazy(() => import('@/renderer/pages/LocalMusicPage'));
const ArtistListPage = lazy(() => import('@/renderer/pages/ArtistListPage'));
const ArtistDetailPage = lazy(() => import('@/renderer/pages/ArtistDetailPage'));
const AlbumDetailPage = lazy(() => import('@/renderer/pages/AlbumDetailPage'));
const DiscoverPlaylistListPage = lazy(() => import('@/renderer/pages/DiscoverPlaylistListPage'));
const DiscoverPlaylistDetailPage = lazy(() => import('@/renderer/pages/DiscoverPlaylistDetailPage'));
const UiLabPage = lazy(() => import('@/renderer/pages/UiLabPage'));
const LibraryPage = lazy(() => import('@/renderer/pages/LibraryPage'));

// 加载状态组件
const Loading = () => (
  <div className="route-loading">
    <div className="route-loading__spinner" />
    加载中...
  </div>
);

// 功能开发中页面
const ComingSoon: React.FC = () => (
  <div className="route-soon">
    <div className="route-soon__icon">🚧</div>
    <div className="route-soon__title">功能开发中</div>
    <div>该功能即将上线，敬请期待</div>
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
            <DiscoverPageV2 />
          </Suspense>
        ),
      },
      {
        path: 'recommend',
        element: (
          <Suspense fallback={<Loading />}>
            <RecommendPage />
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
            <SettingsShell>
              <SettingsPage />
            </SettingsShell>
          </Suspense>
        ),
      },
      {
        // 深链：#/settings/cache 这类入口（ADR 要求设置可深链）
        path: 'settings/:section',
        element: (
          <Suspense fallback={<Loading />}>
            <SettingsShell>
              <SettingsPage />
            </SettingsShell>
          </Suspense>
        ),
      },
      {
        path: 'library',
        element: (
          <Suspense fallback={<Loading />}>
            <LibraryPage />
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
        path: 'artists',
        element: (
          <Suspense fallback={<Loading />}>
            <ArtistListPage />
          </Suspense>
        ),
      },
      {
        path: 'artist/:id',
        element: (
          <Suspense fallback={<Loading />}>
            <ArtistDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'album/:id',
        element: (
          <Suspense fallback={<Loading />}>
            <AlbumDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'playlists/discover',
        element: (
          <Suspense fallback={<Loading />}>
            <DiscoverPlaylistListPage />
          </Suspense>
        ),
      },
      {
        path: 'discover-playlist/:id',
        element: (
          <Suspense fallback={<Loading />}>
            <DiscoverPlaylistDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'ui-lab',
        element: (
          <Suspense fallback={<Loading />}>
            <UiLabPage />
          </Suspense>
        ),
      },
      {
        path: 'download',
        element: <ComingSoon />,
      },
      {
        path: '',
        element: <Navigate to="/recommend" replace />,
      },
    ],
  },
]);

export default router;
