import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  Disc3,
  FolderOpen,
  FolderPlus,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { dedupeSongs } from '@mplayer/core';
import type { Song, SongBase } from '@mplayer/core';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useLocalStore } from '@/renderer/store/localStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { IpcClient } from '@/renderer/services/IpcClient';
import { toast } from '@/renderer/services/toastStore';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import SongList from '@/renderer/components/SongList';
import { Menu, PageHeader, Progress } from '@/renderer/ui';
import type { MenuItem } from '@/renderer/ui';
import '@/renderer/styles/library.css';

/** 资料库（#685）：收藏 / 本地 / 历史去重后的聚合列表，走共享 SongList 的 library 密度（无表头 / 时长列 / 行尾「更多」）。
 * 下载走 settings:getDownloadPath + download:getTasks；本地复用 localStore 的扫描 / 播放 / 删除。 */

type TabKey = 'songs' | 'albums' | 'artists' | 'downloads' | 'local';
type SortKey = 'added' | 'title' | 'artist';

const TAB_ITEMS: { key: TabKey; label: string }[] = [
  { key: 'songs', label: '歌曲' },
  { key: 'albums', label: '专辑' },
  { key: 'artists', label: '歌手' },
  { key: 'downloads', label: '下载' },
  { key: 'local', label: '本地' },
];

const SORT_ITEMS: { key: SortKey; label: string; text: string }[] = [
  { key: 'added', label: '按最近添加', text: '按最近添加排序' },
  { key: 'title', label: '按标题', text: '按标题排序' },
  { key: 'artist', label: '按歌手', text: '按歌手排序' },
];

const collator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base' });

const formatCount = (value: number): string => value.toLocaleString('zh-CN');

interface GroupRow {
  key: string;
  name: string;
  sub: string;
  cover: string;
  count: number;
  firstSong: Song;
  songs: Song[];
}

const buildGroups = (songs: Song[], mode: 'album' | 'artist'): GroupRow[] => {
  const map = new Map<string, GroupRow>();
  for (const song of songs) {
    const name = (mode === 'album' ? song.album : song.artist)?.trim();
    if (!name) continue;
    const existing = map.get(name);
    if (existing) {
      existing.count += 1;
      existing.songs.push(song);
      continue;
    }
    map.set(name, {
      key: mode + ':' + name,
      name,
      sub: mode === 'album' ? song.artist : '',
      cover: song.cover,
      count: 1,
      firstSong: song,
      songs: [song],
    });
  }
  return Array.from(map.values()).sort((a, b) => collator.compare(a.name, b.name));
};

interface DownloadTaskRow {
  id: string;
  song: Song;
  progress: number;
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error';
  error?: string;
}

const TASK_LABELS: Record<DownloadTaskRow['status'], string> = {
  pending: '等待中',
  downloading: '下载中',
  paused: '已暂停',
  completed: '已完成',
  error: '失败',
};

/** URL 的 tab 参数 → 内部分段 key：downloads 是内部键，兼容旧参数 tab=download；非法值回 songs。 */
const parseTabParam = (value: string | null): TabKey => {
  const key = value === 'download' ? 'downloads' : value;
  return TAB_ITEMS.some((item) => item.key === key) ? (key as TabKey) : 'songs';
};

const LibraryPage: React.FC = () => {
  const favorites = useFavoriteStore((s) => s.favorites);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const favoritesLoading = useFavoriteStore((s) => s.loading);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const loadFavorites = useFavoriteStore((s) => s.loadFavorites);
  const updateFavoriteCover = useFavoriteStore((s) => s.updateFavoriteCover);
  const removeFavorite = useFavoriteStore((s) => s.removeFavorite);

  const localFolders = useLocalStore((s) => s.folders);
  const localSongs = useLocalStore((s) => s.songs);
  const localScanning = useLocalStore((s) => s.isScanning);
  const localScanProgress = useLocalStore((s) => s.scanProgress);
  const localCurrentFolder = useLocalStore((s) => s.currentFolder);
  const initializeLocal = useLocalStore((s) => s.initialize);
  const addLocalFolder = useLocalStore((s) => s.addFolder);
  const removeLocalFolder = useLocalStore((s) => s.removeFolder);
  const refreshLocal = useLocalStore((s) => s.refresh);
  const setCurrentLocalFolder = useLocalStore((s) => s.setCurrentFolder);

  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const { download, downloadBatch } = useDownload();

  // 分段由 URL 单一驱动（#685）：旧路由 /local、/download 会 Navigate 到 ?tab=local|downloads。
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTabParam(searchParams.get('tab'));
  const selectTab = useCallback((next: TabKey) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'songs') {
      params.delete('tab');
    } else {
      params.set('tab', next);
    }
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [sortOpen, setSortOpen] = useState(false);
  const sortTriggerRef = useRef<HTMLButtonElement>(null);
  const [history, setHistory] = useState<Song[]>([]);
  const [downloadPath, setDownloadPath] = useState('');
  const [tasks, setTasks] = useState<DownloadTaskRow[]>([]);
  const [loadingDownloads, setLoadingDownloads] = useState(false);

  useEffect(() => {
    loadFavorites();
    void initializeLocal();
  }, [loadFavorites, initializeLocal]);

  const loadHistory = useCallback(async () => {
    try {
      const rows = await IpcClient.invoke<{ song: SongBase }[]>('history:get', 100);
      // IPC 未实现 / 首次启动可能返回 undefined：按空历史处理，不抛错
      const unique = new Map<string, SongBase>();
      (rows ?? []).forEach((row) => { if (row?.song) unique.set(row.song.id, row.song); });
      setHistory(Array.from(unique.values()) as Song[]);
    } catch (error) {
      console.error('加载播放历史失败:', error);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const loadDownloads = useCallback(async () => {
    setLoadingDownloads(true);
    try {
      const [path, rows] = await Promise.all([
        IpcClient.invoke<string>('settings:getDownloadPath'),
        IpcClient.invoke<DownloadTaskRow[]>('download:getTasks'),
      ]);
      setDownloadPath(path ?? '');
      setTasks(rows ?? []);
    } catch (error) {
      console.error('加载下载信息失败:', error);
    } finally {
      setLoadingDownloads(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'downloads') return;
    void loadDownloads();
    const api = window.electronAPI;
    if (!api?.on) return;
    const refresh = () => { void loadDownloads(); };
    const offProgress = api.on('download:progress', refresh);
    const offComplete = api.on('download:complete', refresh);
    const offError = api.on('download:error', refresh);
    return () => {
      offProgress?.();
      offComplete?.();
      offError?.();
    };
  }, [tab, loadDownloads]);

  /** 资料库 = 收藏 + 本地 + 历史去重（判据在 core songDedupe：id 与 歌名+歌手） */
  const librarySongs = useMemo<Song[]>(() => {
    const withLocal = [...favorites, ...dedupeSongs(favorites, localSongs)];
    return [...withLocal, ...dedupeSongs(withLocal, history)];
  }, [favorites, localSongs, history]);

  const albumCount = useMemo(
    () => new Set(librarySongs.map((song) => song.album?.trim()).filter(Boolean)).size,
    [librarySongs],
  );

  const sortedSongs = useMemo(() => {
    if (sortKey === 'added') return librarySongs;
    const field = sortKey === 'title' ? 'name' : 'artist';
    return [...librarySongs].sort((a, b) => collator.compare(a[field] ?? '', b[field] ?? ''));
  }, [librarySongs, sortKey]);

  const albumGroups = useMemo(() => buildGroups(sortedSongs, 'album'), [sortedSongs]);
  const artistGroups = useMemo(() => buildGroups(sortedSongs, 'artist'), [sortedSongs]);

  /**
   * 列表点播（#697）：SongList 只回传歌曲、当前展示队列与行下标，建队列归本页。
   * 专辑 / 歌手分组行走 handlePlayGroup 自己建队列。
   */
  const handlePlaySong = useCallback((song: Song, queue: Song[], index: number) => {
    setCurrentPlaylist(queue, index);
    void play(song);
  }, [play, setCurrentPlaylist]);

  const handleDownload = useCallback((song: Song) => {
    void download(song);
  }, [download]);

  /** 选择模式 · 批量下载：走真实 batch 通道（不是逐首 start）。 */
  const handleBatchDownload = useCallback((songs: Song[]) => {
    void downloadBatch(songs);
  }, [downloadBatch]);

  /** 选择模式 · 批量删除：资料库里可持久移除的是收藏项；本地文件与历史不由本页删除。 */
  const handleBatchDelete = useCallback((songs: Song[]) => {
    const favoriteIdSet = new Set(favorites.map((song) => song.id));
    const removable = songs.filter((song) => favoriteIdSet.has(song.id));
    if (removable.length === 0) {
      toast.error('所选歌曲不在收藏中，无法从资料库删除');
      return;
    }
    void Promise.all(removable.map((song) => removeFavorite(song.id)))
      .then(() => toast.success('已从资料库移除 ' + removable.length + ' 首'))
      .catch((error) => {
        console.error('批量删除失败:', error);
        toast.error('批量删除失败');
      });
  }, [favorites, removeFavorite]);

  const handlePlayGroup = useCallback((group: GroupRow) => {
    setCurrentPlaylist(group.songs, 0);
    void play(group.firstSong);
  }, [play, setCurrentPlaylist]);

  const handleToggleFavorite = useCallback(async (song: Song) => {
    try {
      await toggleFavorite(song);
    } catch (error) {
      console.error('收藏操作失败:', error);
    }
  }, [toggleFavorite]);

  const handleCoverError = useCallback((song: Song) => {
    void refreshSongCover(song).then((cover) => {
      if (!cover) return;
      updateFavoriteCover(song.id, cover);
      setHistory((prev) => prev.map((item) => (item.id === song.id ? { ...item, cover } : item)));
    });
  }, [updateFavoriteCover]);

  const chooseSort = useCallback((next: SortKey) => {
    setSortKey(next);
    setSortOpen(false);
  }, []);

  const sortLabel = SORT_ITEMS.find((item) => item.key === sortKey)?.label ?? '按最近添加';

  const handleAddFolder = useCallback(() => {
    void addLocalFolder()
      .then(() => selectTab('local'))
      .catch((error) => {
        console.error('导入本地文件夹失败:', error);
        toast.error('导入失败，请重试');
      });
  }, [addLocalFolder, selectTab]);

  const handleChangeDownloadPath = useCallback(async () => {
    try {
      const picked = await IpcClient.invoke<{ canceled: boolean; filePaths: string[] }>('dialog:openDirectory', 'download');
      if (picked?.canceled || !picked?.filePaths?.length) return;
      try {
        await IpcClient.invoke('settings:setDownloadPath', picked.filePaths[0]);
        setDownloadPath(picked.filePaths[0]);
        toast.success('下载目录已更新');
      } catch (error) {
        console.error('保存下载目录失败:', error);
        toast.error('更新下载目录失败');
      }
    } catch (error) {
      console.error('选择下载目录失败:', error);
      toast.error('选择目录失败');
    }
  }, []);

  const handleCancelTask = useCallback(async (taskId: string) => {
    try {
      await IpcClient.invoke('download:cancel', taskId);
      await loadDownloads();
    } catch (error) {
      console.error('取消下载失败:', error);
      toast.error('取消下载失败');
    }
  }, [loadDownloads]);

  const handlePauseTask = useCallback(async (taskId: string) => {
    try {
      await IpcClient.invoke('download:pause', taskId);
      await loadDownloads();
    } catch (error) {
      console.error('暂停下载失败:', error);
      toast.error('暂停下载失败');
    }
  }, [loadDownloads]);

  const handleResumeTask = useCallback(async (taskId: string) => {
    try {
      await IpcClient.invoke('download:resume', taskId);
      await loadDownloads();
    } catch (error) {
      console.error('继续下载失败:', error);
      toast.error('继续下载失败');
    }
  }, [loadDownloads]);

  const handleOpenDownloadDir = useCallback(async () => {
    try {
      const opened = await IpcClient.invoke<boolean>('download:openDir');
      if (opened === false) toast.error('打开下载目录失败');
    } catch (error) {
      console.error('打开下载目录失败:', error);
      toast.error('打开下载目录失败');
    }
  }, []);

  const handleShowInFolder = useCallback(async (taskId: string) => {
    try {
      const shown = await IpcClient.invoke<boolean>('download:showInFolder', taskId);
      if (shown === false) toast.error('打开所在文件夹失败');
    } catch (error) {
      console.error('打开所在文件夹失败:', error);
      toast.error('打开所在文件夹失败');
    }
  }, []);

  const handleClearFinished = useCallback(async () => {
    try {
      await IpcClient.invoke('download:clearCompleted');
      await loadDownloads();
    } catch (error) {
      console.error('清除已完成下载失败:', error);
      toast.error('清除失败');
    }
  }, [loadDownloads]);

  const handleRemoveFolder = useCallback((folderPath: string, folderName: string) => {
    void removeLocalFolder(folderPath).then(() => toast.success('已移除「' + folderName + '」'));
  }, [removeLocalFolder]);

  const localDisplayed = useMemo(
    () => (localCurrentFolder
      ? localSongs.filter((song) => song.url.includes(localCurrentFolder.replace(/\\/g, '/')))
      : localSongs),
    [localSongs, localCurrentFolder],
  );

  const finishedCount = tasks.filter((task) => task.status === 'completed' || task.status === 'error').length;
  const sortMenuItems: MenuItem[] = SORT_ITEMS.map((item) => ({
    key: item.key,
    label: item.label,
    checked: sortKey === item.key,
    onSelect: () => chooseSort(item.key),
  }));

  /**
   * 两个歌曲分段（聚合 / 本地）共用同一份列表口径：density / 表头 / 时长列 / 回调只写一次，
   * 避免同一页面两处 props 漂移（规格 §2.1）。
   */
  const songListCommon = {
    density: 'library' as const,
    showHeader: true,
    showDuration: true,
    currentSongId: currentSong?.id,
    isPlaying,
    onPlay: handlePlaySong,
    onToggleFavorite: handleToggleFavorite,
    onDownload: handleDownload,
    onCoverError: handleCoverError,
    // 按需选择模式（#699）：普通浏览不显示复选框；点「选择」后才出现批量工具栏
    enableBatchDownload: true,
    onBatchDownload: handleBatchDownload,
    enableBatchAddToPlaylist: true,
  };

  /** 批量删除按分段下发：只有「歌曲」聚合分段可删收藏项；本地歌曲不由本页删除（规格 L132）。 */
  const batchDeleteProps = { enableBatchDelete: true, onBatchDelete: handleBatchDelete };

  return (
    <div className="library">
      <PageHeader
        className="library__header"
        title="资料库"
        lead={
          <span className="library__stats">
            {formatCount(librarySongs.length)} 首 · {formatCount(albumCount)} 张专辑 · 本地 {formatCount(localSongs.length)} 首
          </span>
        }
        actions={
          <>
            <div className="library__sort-wrap">
              <button
                ref={sortTriggerRef}
                type="button"
                className="library__text-btn"
                aria-haspopup="menu"
                aria-expanded={sortOpen}
                onClick={() => setSortOpen((prev) => !prev)}
              >
                <ArrowDownUp size={15} aria-hidden="true" />
                排序：{sortLabel}
              </button>
              <Menu
                open={sortOpen}
                anchorRef={sortTriggerRef}
                items={sortMenuItems}
                onClose={() => setSortOpen(false)}
                ariaLabel="排序"
                placement="bottom-end"
                minWidth={168}
              />
            </div>
            <button
              type="button"
              className="library__import"
              onClick={handleAddFolder}
              disabled={localScanning}
            >
              <Plus size={15} aria-hidden="true" />
              导入
            </button>
          </>
        }
      />

      <div className="library__tabs-row">
        <div className="library__segmented" role="tablist" aria-label="资料库视图">
          {TAB_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className="library__segment"
              onClick={() => selectTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="library__scroll" role="tabpanel">
        {tab === 'songs' && (
          <div className="library__card">
            <SongList
              {...songListCommon}
              {...batchDeleteProps}
              songs={sortedSongs}
              favoriteIds={favoriteIds}
              loading={favoritesLoading && sortedSongs.length === 0}
              emptyText="资料库还是空的——导入本地文件夹，或在任意列表点小心心。"
            />
          </div>
        )}

        {tab === 'albums' && (
          <div className="library__card">
            {albumGroups.length === 0 ? (
              <div className="library__empty">
                <Disc3 size={26} aria-hidden="true" />
                <div className="library__empty-title">还没有可聚合的专辑</div>
                <div className="library__empty-sub">收藏、本地或最近播放里的专辑信息会归到这里。</div>
              </div>
            ) : albumGroups.map((group) => (
              <div
                key={group.key}
                className="library__group-row"
                role="button"
                tabIndex={0}
                aria-label={'播放专辑 ' + group.name}
                onClick={() => handlePlayGroup(group)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handlePlayGroup(group);
                  }
                }}
              >
                <span className="library__group-cover">
                  {group.cover ? <img src={group.cover} alt="" loading="lazy" /> : <Disc3 size={18} aria-hidden="true" />}
                </span>
                <span className="library__group-main">
                  <span className="library__group-name">{group.name}</span>
                  {group.sub && <span className="library__group-sub">{group.sub}</span>}
                </span>
                <span className="library__group-count">{group.count} 首</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'artists' && (
          <div className="library__card">
            {artistGroups.length === 0 ? (
              <div className="library__empty">
                <User size={26} aria-hidden="true" />
                <div className="library__empty-title">还没有可聚合的歌手</div>
                <div className="library__empty-sub">收藏、本地或最近播放里的歌手信息会归到这里。</div>
              </div>
            ) : artistGroups.map((group) => (
              <div
                key={group.key}
                className="library__group-row"
                role="button"
                tabIndex={0}
                aria-label={'播放歌手 ' + group.name}
                onClick={() => handlePlayGroup(group)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handlePlayGroup(group);
                  }
                }}
              >
                <span className="library__group-cover">
                  {group.cover ? <img src={group.cover} alt="" loading="lazy" /> : <User size={18} aria-hidden="true" />}
                </span>
                <span className="library__group-main">
                  <span className="library__group-name">{group.name}</span>
                  <span className="library__group-sub">{group.count} 首歌曲</span>
                </span>
                <span className="library__group-count">{group.count} 首</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'downloads' && (
          <div className="library__stack">
            <div className="library__dir">
              <span className="library__dir-label">下载目录</span>
              <span className="library__dir-path" title={downloadPath}>{downloadPath || '加载中…'}</span>
              <button type="button" className="library__text-btn" onClick={() => void handleChangeDownloadPath()}>
                更改
              </button>
              <button
                type="button"
                className="library__text-btn"
                aria-label="打开目录"
                onClick={() => void handleOpenDownloadDir()}
              >
                <FolderOpen size={15} aria-hidden="true" />
                打开目录
              </button>
            </div>
            <div className="library__card">
              {tasks.length === 0 ? (
                <div className="library__empty">
                  <Music2 size={26} aria-hidden="true" />
                  {loadingDownloads ? (
                    <div className="library__empty-title">加载中…</div>
                  ) : (
                    <>
                      <div className="library__empty-title">暂无下载任务</div>
                      <div className="library__empty-sub">在歌曲「更多」菜单里选择下载，任务会出现在这里。</div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {tasks.map((task) => (
                    <div key={task.id} className="library__task-row">
                      <span className="library__task-main">
                        <span className="library__task-name">{task.song.name}</span>
                        <span className="library__task-meta">{task.song.artist}</span>
                      </span>
                      <span className="library__task-bar">
                        <Progress
                          value={task.progress}
                          tone={task.status === 'error' ? 'danger' : task.status === 'completed' ? 'success' : 'accent'}
                          ariaLabel={task.song.name + ' 下载进度'}
                        />
                      </span>
                      <span className="library__task-state" data-tone={task.status}>
                        {task.status === 'downloading' ? Math.round(task.progress) + '%' : TASK_LABELS[task.status]}
                      </span>
                      {(task.status === 'pending' || task.status === 'paused') && (
                        <button
                          type="button"
                          className="library__task-cancel"
                          aria-label={'开始下载: ' + task.song.name}
                          disabled={task.status === 'pending'}
                          title={task.status === 'pending' ? '等待队列自动开始' : undefined}
                          onClick={() => void handleResumeTask(task.id)}
                        >
                          <Play size={14} aria-hidden="true" />
                        </button>
                      )}
                      {task.status === 'downloading' && (
                        <button
                          type="button"
                          className="library__task-cancel"
                          aria-label={'暂停下载: ' + task.song.name}
                          onClick={() => void handlePauseTask(task.id)}
                        >
                          <Pause size={14} aria-hidden="true" />
                        </button>
                      )}
                      {(task.status === 'pending' || task.status === 'downloading' || task.status === 'paused') && (
                        <button
                          type="button"
                          className="library__task-cancel"
                          aria-label={'取消下载: ' + task.song.name}
                          onClick={() => void handleCancelTask(task.id)}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                      {task.status === 'completed' && (
                        <button
                          type="button"
                          className="library__task-cancel"
                          aria-label={'打开所在文件夹: ' + task.song.name}
                          onClick={() => void handleShowInFolder(task.id)}
                        >
                          <FolderOpen size={14} aria-hidden="true" />
                        </button>
                      )}
                      {task.status === 'error' && <span className="library__task-cancel" aria-hidden="true" />}
                    </div>
                  ))}
                  {finishedCount > 0 && (
                    <div className="library__task-foot">
                      <button type="button" className="library__text-btn" onClick={() => void handleClearFinished()}>
                        <Trash2 size={14} aria-hidden="true" />
                        清除已完成（{finishedCount}）
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'local' && (
          <div className="library__stack">
            <div className="library__chips">
              <button
                type="button"
                className="library__chip"
                data-active={localCurrentFolder === null || undefined}
                onClick={() => setCurrentLocalFolder(null)}
              >
                全部歌曲
                <span className="library__chip-count">{localSongs.length}</span>
              </button>
              {localFolders.map((folder) => (
                <span key={folder.path} className="library__chip-wrap">
                  <button
                    type="button"
                    className="library__chip"
                    data-active={localCurrentFolder === folder.path || undefined}
                    onClick={() => setCurrentLocalFolder(folder.path)}
                  >
                    <FolderOpen size={14} aria-hidden="true" />
                    {folder.name}
                    <span className="library__chip-count">{folder.songCount}</span>
                  </button>
                  <button
                    type="button"
                    className="library__chip-remove"
                    aria-label={'移除文件夹: ' + folder.name}
                    onClick={() => handleRemoveFolder(folder.path, folder.name)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              <button type="button" className="library__chip" onClick={handleAddFolder} disabled={localScanning}>
                <FolderPlus size={14} aria-hidden="true" />
                添加文件夹
              </button>
              <button type="button" className="library__chip" onClick={() => void refreshLocal()} disabled={localScanning}>
                <RefreshCw size={14} aria-hidden="true" />
                刷新
              </button>
              {localScanning && (
                <span className="library__scan">
                  扫描中{localScanProgress ? ' ' + localScanProgress.current + '/' + localScanProgress.total : ''}…
                </span>
              )}
            </div>
            <div className="library__card">
              <SongList
                {...songListCommon}
                songs={localDisplayed}
                favoriteIds={favoriteIds}
                loading={localScanning && localDisplayed.length === 0}
                emptyText="还没有本地歌曲——导入一个音乐目录后会自动出现在这里。"
              />
            </div>
            <div className="library__footnote">移除文件夹只会从资料库移除索引，不会删除磁盘上的文件。</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LibraryPage;