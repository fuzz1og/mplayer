import React, { useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
const ipcRenderer = window.electronAPI;
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useSearchStore } from '@/renderer/store/searchStore';
import { searchService } from '@/renderer/services/searchService';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { usePlayerStore, warmupRestoredSong } from '@/renderer/store/playerStore';
import { useDownloadStore, type DownloadTask } from '@/renderer/store/downloadStore';
import { useUpdateStore, isUpdatePending } from '@/renderer/store/updateStore';
import { useGlobalShortcuts } from '@/renderer/hooks/useGlobalShortcuts';
import { useScrollRestoration } from '@/renderer/hooks/useScrollRestoration';
import Sidebar from '@/renderer/components/Sidebar';
import TitleBar from '@/renderer/components/TitleBar';
import type { SourceKey } from '@/renderer/store/searchStore';
import PlayerBar from '@/renderer/components/PlayerBar';
import QueuePanel, { closeQueuePanel, openQueuePanel } from '@/renderer/components/QueuePanel';
import DownloadNotifications from '@/renderer/components/DownloadNotifications';
import UpdateReadyDialog from '@/renderer/components/UpdateReadyDialog';
import LyricsPage from '@/renderer/pages/LyricsPage';
import ErrorBoundary from '@/renderer/components/ErrorBoundary';
import { initAppearancePrefs } from '@/renderer/theme/appearancePrefs';

import './styles/app-shell.css';

const PLAYER_COVER_TRANSITION_NAME = 'player-cover';

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showLyrics, setShowLyrics] = useState(false);
  const isSettings = location.pathname.startsWith('/settings');

  // #682：设置页返回后恢复原页面滚动位置（进入设置时页面卸载，scrollTop 会被浏览器夹到 0）
  useScrollRestoration(location);

  // #403：歌词是「播放器的层」（与移动端全屏播放器同构），**不是一条路由**——它不占导航栈，任何一
  // 次导航都该把它收起来。信号取 location.key 而非 pathname：点当前页（重复导航到同一路径）也会换 key。
  useEffect(() => {
    setShowLyrics(false);
    // #707：队列面板是当前浏览上下文的一部分；路由一变就收掉，避免跨页残留 / 与 /queue 兼容页叠两套。
    closeQueuePanel();
  }, [location.key]);

  // #688：PlayerBar 封面 → 全屏播放器封面的共享元素展开（Chromium View Transitions）。
  // 两端封面共用一个 view-transition-name；不支持该 API 时（jsdom / 非 Chromium）直接切，行为同旧版。
  const activeViewTransitionRef = useRef<ViewTransition | null>(null);

  const setLyricsVisibility = useCallback((visible: boolean) => {
    const playerCover = document.querySelector<HTMLElement>('.player-bar__cover');

    // 必须保持 document 作为 receiver（不能把方法摘出来裸调，Chromium 会抛 Illegal invocation）。
    if (typeof document.startViewTransition !== 'function' || !playerCover || !usePlayerStore.getState().currentSong) {
      setShowLyrics(visible);
      return;
    }

    // 连点：收掉上一段，避免两段动画同时持有同名元素。
    activeViewTransitionRef.current?.skipTransition();
    activeViewTransitionRef.current = null;
    playerCover.style.viewTransitionName = '';

    // 打开：PlayerBar 封面是旧快照里的共享元素，提交后立即让位给全屏封面；
    // 关闭：提交后 PlayerBar 封面才成为新快照的共享元素（同一快照里绝不能有两个同名元素）。
    if (visible) playerCover.style.viewTransitionName = PLAYER_COVER_TRANSITION_NAME;

    const transition = document.startViewTransition(() => {
      flushSync(() => setShowLyrics(visible));
      playerCover.style.viewTransitionName = visible ? '' : PLAYER_COVER_TRANSITION_NAME;
    });

    activeViewTransitionRef.current = transition;
    const settle = () => {
      if (activeViewTransitionRef.current !== transition) return;
      activeViewTransitionRef.current = null;
      playerCover.style.viewTransitionName = '';
    };
    transition.finished.then(settle, settle);
  }, []);

  const handleCoverClick = useCallback(() => {
    setLyricsVisibility(!showLyrics);
  }, [setLyricsVisibility, showLyrics]);

  // 关闭动画同样走这里：LyricsPage 的 ESC / 收起按钮都调用 onBack，因此不碰它自己的实现。
  const handleCloseLyrics = useCallback(() => {
    setLyricsVisibility(false);
  }, [setLyricsVisibility]);

  // 逐字段订阅：整 store 订阅会让搜索/收藏/下载的任何变化都重渲染 App 及整棵页面树
  const currentKeyword = useSearchStore((s) => s.currentKeyword);
  const sourceType = useSearchStore((s) => s.sourceType);
  const setSourceType = useSearchStore((s) => s.setSourceType);

  const loadFavorites = useFavoriteStore((s) => s.loadFavorites);

  // 组件挂载时加载收藏列表
  // 外观偏好（密度/材质/字号/动效/歌词字号）落 <html data-*>：冷启动就应用，不必进设置页
  useEffect(() => { void initAppearancePrefs(); }, []);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  // 冷启预热（#328）：队列还原了「当前歌」但传输层尚无 Howl，用户点播放需
  // 走全链重解析。启动后台解析一次，让首次点播放命中 core 预取缓存（30min
  // TTL）0 等待出声。只跑一次（空依赖），失败静默——真正播放时仍走正常失败链。
  useEffect(() => {
    warmupRestoredSong();
  }, []);

  // 更新状态桥（#579）：订阅 push + 拉一次快照。启动检查可能早于本组件挂载，
  // 只靠 push 会丢事件，所以必须靠快照兜底（ADR 不变量 I2/I3）。
  const updateAvailable = useUpdateStore((s) => isUpdatePending(s.status));
  useEffect(() => useUpdateStore.getState().initUpdateBridge(), []);

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

  // 监听下载进度事件：只经 store action 写入（订阅面在 DownloadNotifications，
  // App 不订阅下载 store，进度事件不会重渲染页面树）
  useEffect(() => {
    const handleProgress = (_event: any, task: DownloadTask) => {
      useDownloadStore.getState().updateTask(task.id, { progress: task.progress, status: task.status });
    };

    const handleComplete = (_event: any, task: DownloadTask) => {
      useDownloadStore.getState().updateTask(task.id, { progress: 100, status: 'completed', filePath: task.filePath });
    };

    const handleError = (_event: any, { task, error }: { task: DownloadTask; error: string }) => {
      useDownloadStore.getState().updateTask(task.id, { status: 'error', error });
    };

    ipcRenderer.on('download:progress', handleProgress);
    ipcRenderer.on('download:complete', handleComplete);
    ipcRenderer.on('download:error', handleError);

    return () => {
      ipcRenderer.removeListener('download:progress', handleProgress);
      ipcRenderer.removeListener('download:complete', handleComplete);
      ipcRenderer.removeListener('download:error', handleError);
    };
  }, []);

  useGlobalShortcuts();

  const dispatchSearch = (keyword: string) => {
    const { sourceType: current } = useSearchStore.getState();
    if (current === 'all') {
      searchService.searchAll(keyword);
    } else {
      searchService.search(keyword);
    }
  };

  const handleSearch = useCallback((value: string) => {
    dispatchSearch(value);
    if (location.pathname !== '/discover') {
      navigate('/discover');
    }
  }, [location.pathname, navigate]);

  const handleSourceTypeChange = useCallback((newType: SourceKey) => {
    useSearchStore.getState().reset();
    setSourceType(newType);
    if (currentKeyword) {
      dispatchSearch(currentKeyword);
    }
  }, [currentKeyword, setSourceType]);

  // 根据路径获取当前活跃的侧边栏项
  const getActiveSidebarKey = () => {
    const path = location.pathname;
    if (path.startsWith('/recommend')) return 'recommend';
    if (path.startsWith('/discover') || path.startsWith('/hotlist') || path.startsWith('/discover-playlist')) return 'discover';
    if (path.startsWith('/artists') || path.startsWith('/artist/')) return 'artists';
    if (path.startsWith('/library')) return 'library';
    if (path.startsWith('/favorites')) return 'favorites';
    if (path.startsWith('/history')) return 'history';
    if (path.startsWith('/playlists') || path.startsWith('/playlist/')) return 'playlists';
    if (path.startsWith('/queue')) return 'queue';
    if (path.startsWith('/settings')) return 'settings';
    return 'discover';
  };

  return (
    <div className={isSettings ? 'app-shell app-shell--settings' : 'app-shell'}>
      <TitleBar
        title={isSettings ? '设置' : undefined}
        onBack={() => {
          if (window.history.length > 1) navigate(-1);
          else navigate('/recommend');
        }}
        onSearch={handleSearch}
        sourceType={sourceType}
        onSourceTypeChange={handleSourceTypeChange}
        onSettingsClick={() => navigate('/settings')}
        updateAvailable={updateAvailable}
      />

      <div className="app-shell__body">
        <Sidebar
          currentPage={getActiveSidebarKey()}
          onPageChange={(page) => {
            // 切换页面时清除搜索状态
            useSearchStore.getState().reset();
            // #707：队列不是独立页——从侧栏打开右侧面板，保留当前浏览上下文。
            if (page === 'queue') {
              openQueuePanel();
              return;
            }
            navigate(`/${page}`);
          }}
        />

        <main className="app-shell__content">
          {/* 错误边界包住页面内容：桌面窗口没有刷新/返回键，渲染层抛错此前会整窗变白（只能重启）。
              现在一个页面出错 = 一个页面出错，并给「重试」自救。 */}
          <ErrorBoundary>
            {showLyrics ? <LyricsPage onBack={handleCloseLyrics} /> : <Outlet />}
          </ErrorBoundary>
        </main>
      </div>

      {/* 播放栏横跨整窗（原型：从 x=0 起，侧栏在其上方结束） */}
      <PlayerBar
        onCoverClick={handleCoverClick}
        onQueueClick={openQueuePanel}
      />

      {/* #707：右侧非模态队列面板；打开不改变路由，页面滚动与播放状态都不受影响 */}
      <QueuePanel />

      {/* 下载进度弹窗（订阅面在宿主内，App 不随下载进度重渲染） */}
      <DownloadNotifications />

      {/* 更新已下载 → 退出应用安装的确认框（#579；订阅面在宿主内） */}
      <UpdateReadyDialog />
    </div>
  );
};

export default App;
