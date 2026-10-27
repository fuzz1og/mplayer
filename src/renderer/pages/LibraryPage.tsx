import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  Check,
  Disc3,
  FolderOpen,
  FolderPlus,
  Music2,
  Plus,
  RefreshCw,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { dedupeSongs } from '@mplayer/core';
import type { Song, SongBase } from '@mplayer/core';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useLocalStore } from '@/renderer/store/localStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { useVirtualRows, VIRTUALIZE_THRESHOLD } from '@/renderer/hooks/useVirtualRows';
import { useLatest } from '@/renderer/hooks/useLatest';
import { IpcClient } from '@/renderer/services/IpcClient';
import { toast } from '@/renderer/services/toastStore';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import SongRow from '@/renderer/components/SongRow';
import RowActionButtons from '@/renderer/components/RowActionButtons';
import type { RowActionItem } from '@/renderer/components/RowActionMenu';
import VirtualRow from '@/renderer/components/VirtualRow';
import AddToPlaylistModal from '@/renderer/components/AddToPlaylistModal';
import { Progress } from '@/renderer/ui';
import '@/renderer/styles/library.css';

/**
 * 资料库（1.9.0，#685）：收藏 / 本地 / 历史去重后的聚合列表，对齐 .proto/library.png（规格 .proto/ALIGN.md §1）。
 * 行复用共享 SongRow 的既有 props（actions 插槽装时长列），不修改 SongList / SongRow。
 * 下载走 settings:getDownloadPath + download:getTasks；本地复用 localStore 的扫描 / 播放 / 删除。
 */

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

/** 与 library.css 的 .library__rows .song-row 高度保持一致（虚拟滚动估算用）。 */
const LIBRARY_ROW_HEIGHT = 46;

const collator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base' });

const formatDuration = (seconds?: number): string => {
  if (!seconds || !Number.isFinite(seconds)) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ':' + secs.toString().padStart(2, '0');
};

const formatCount = (value: number): string => value.toLocaleString('zh-CN');

interface LibraryRowTailProps {
  song: Song;
  isFavorite: boolean;
  onToggleFavorite?: (song: Song) => void;
  onDownload?: (song: Song) => void;
  onAddToPlaylist: (song: Song) => void;
}

/** 行尾：时长常驻 + 收藏/下载/更多（hover 才显示，见 library.css）。 */
const LibraryRowTail: React.FC<LibraryRowTailProps> = ({
  song, isFavorite, onToggleFavorite, onDownload, onAddToPlaylist,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  const menuItems: RowActionItem[] = useMemo(() => [
    {
      key: 'playNext',
      label: '下一首播放',
      icon: <ArrowDownUp size={14} />,
      onClick: () => { void usePlayerStore.getState().insertNext(song); },
    },
    {
      key: 'playlist',
      label: '加入歌单',
      icon: <Plus size={14} />,
      onClick: () => onAddToPlaylist(song),
    },
  ], [song, onAddToPlaylist]);

  return (
    <div className="library__tail">
      <span className="library__duration">{formatDuration(song.duration)}</span>
      <RowActionButtons
        song={song}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        onDownload={onDownload}
        moreOpen={moreOpen}
        moreTriggerRef={moreTriggerRef}
        onToggleMore={(e) => { e.stopPropagation(); setMoreOpen((prev) => !prev); }}
        onCloseMore={(e) => { e.stopPropagation(); setMoreOpen(false); }}
        menuItems={menuItems}
      />
    </div>
  );
};

interface LibrarySongRowProps {
  song: Song;
  index: number;
  isCurrentSong: boolean;
  isPlaying: boolean;
  isFavorite: boolean;
  /** 播放本行：由表格把「当前展示列表 + 行号」一起带回，建立正确队列 */
  onPlay: (song: Song, index: number) => void;
  onToggleFavorite?: (song: Song) => void;
  onDownload?: (song: Song) => void;
  onAddToPlaylist: (song: Song) => void;
  onCoverError?: (song: Song) => void;
}

/** 单行：SongRow 的现有 props + actions 插槽（时长列 + hover 操作）。 */
const LibrarySongRow = React.memo<LibrarySongRowProps>(({
  song, index, isCurrentSong, isPlaying, isFavorite,
  onPlay, onToggleFavorite, onDownload, onAddToPlaylist, onCoverError,
}) => {
  // 行内包一层稳定回调：父级 onPlay 身份稳定时，行 memo 不被每帧新箭头击穿
  const handlePlay = useCallback(() => onPlay(song, index), [onPlay, song, index]);
  return (
  <SongRow
    song={song}
    index={index}
    isCurrentSong={isCurrentSong}
    isPlaying={isPlaying}
    isFavorite={isFavorite}
    showIndex
    showAlbum
    albumWidth={196}
    fillTitle
    onPlay={handlePlay}
    onToggleFavorite={onToggleFavorite}
    onDownload={onDownload}
    onCoverError={onCoverError}
    actions={(
      <LibraryRowTail
        song={song}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        onDownload={onDownload}
        onAddToPlaylist={onAddToPlaylist}
      />
    )}
  />
  );
});
LibrarySongRow.displayName = 'LibrarySongRow';

interface LibrarySongTableProps {
  songs: Song[];
  currentSongId?: string;
  isPlaying: boolean;
  favoriteIds: string[];
  emptyText: string;
  /** 播放：带上当前展示列表与行号，页面据此建立队列（与 SongList 的 handlePlaySong 同义） */
  onPlay: (song: Song, queue: Song[], index: number) => void;
  onToggleFavorite: (song: Song) => void;
  onDownload: (song: Song) => void;
  onAddToPlaylist: (song: Song) => void;
  onCoverError: (song: Song) => void;
}

/** 歌单表：沿用 SongList 的虚拟滚动契约（useVirtualRows + VirtualRow），行尾多一个时长列。 */
const LibrarySongTable: React.FC<LibrarySongTableProps> = ({
  songs, currentSongId, isPlaying, favoriteIds, emptyText,
  onPlay, onToggleFavorite, onDownload, onAddToPlaylist, onCoverError,
}) => {
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const estimateSize = useCallback(() => LIBRARY_ROW_HEIGHT, []);
  // 播放回调身份稳定（行 memo 依赖它）：内部始终用最新的 songs / onPlay
  const latest = useLatest({ songs, onPlay });
  const handlePlayAt = useCallback((song: Song, index: number) => {
    latest.current.onPlay(song, latest.current.songs, index);
  }, [latest]);
  const virtual = useVirtualRows({
    count: songs.length,
    enabled: songs.length >= VIRTUALIZE_THRESHOLD,
    estimateSize,
  });

  if (songs.length === 0) {
    return (
      <div className="library__empty">
        <Music2 size={26} aria-hidden="true" />
        <div>{emptyText}</div>
      </div>
    );
  }

  const renderRow = (song: Song, index: number) => (
    <LibrarySongRow
      key={song.id}
      song={song}
      index={index}
      isCurrentSong={currentSongId === song.id}
      isPlaying={isPlaying && currentSongId === song.id}
      isFavorite={favoriteSet.has(song.id)}
      onPlay={handlePlayAt}
      onToggleFavorite={onToggleFavorite}
      onDownload={onDownload}
      onAddToPlaylist={onAddToPlaylist}
      onCoverError={onCoverError}
    />
  );

  return (
    <div
      ref={virtual.rowsRef}
      className="library__rows"
      data-virtual={virtual.mode === 'virtual' || undefined}
      style={{ '--total-size': virtual.totalSize + 'px' } as React.CSSProperties}
    >
      {virtual.mode === 'virtual'
        ? virtual.items.map((item) => {
            const song = songs[item.index];
            if (!song) return null;
            return (
              <VirtualRow key={song.id} start={item.start} size={item.size} scrollMargin={virtual.scrollMargin}>
                {renderRow(song, item.index)}
              </VirtualRow>
            );
          })
        : songs.map((song, index) => renderRow(song, index))}
    </div>
  );
};

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
  status: 'pending' | 'downloading' | 'completed' | 'error';
  error?: string;
}

const TASK_LABELS: Record<DownloadTaskRow['status'], string> = {
  pending: '等待中',
  downloading: '下载中',
  completed: '已完成',
  error: '失败',
};

const LibraryPage: React.FC = () => {
  const favorites = useFavoriteStore((s) => s.favorites);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const loadFavorites = useFavoriteStore((s) => s.loadFavorites);

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
  const { download } = useDownload();

  const [tab, setTab] = useState<TabKey>('songs');
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [sortOpen, setSortOpen] = useState(false);
  const [history, setHistory] = useState<Song[]>([]);
  const [playlistSong, setPlaylistSong] = useState<Song | null>(null);
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

  const favoriteIdList = useMemo(() => favorites.map((song) => song.id), [favorites]);

  const handlePlay = useCallback((song: Song, queue: Song[], index: number) => {
    setCurrentPlaylist(queue, index);
    void play(song);
  }, [play, setCurrentPlaylist]);

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
      useFavoriteStore.setState((state) => ({
        favorites: state.favorites.map((item) => (item.id === song.id ? { ...item, cover } : item)),
      }));
      setHistory((prev) => prev.map((item) => (item.id === song.id ? { ...item, cover } : item)));
    });
  }, []);

  const handleAddToPlaylist = useCallback((song: Song) => {
    setPlaylistSong(song);
  }, []);

  const chooseSort = useCallback((next: SortKey) => {
    setSortKey(next);
    setSortOpen(false);
  }, []);

  const cycleSort = useCallback(() => {
    setSortKey((prev) => (prev === 'added' ? 'title' : prev === 'title' ? 'artist' : 'added'));
  }, []);

  const handleAddFolder = useCallback(() => {
    void addLocalFolder()
      .then(() => setTab('local'))
      .catch((error) => {
        console.error('导入本地文件夹失败:', error);
        toast.error('导入失败，请重试');
      });
  }, [addLocalFolder]);

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
  const sortText = SORT_ITEMS.find((item) => item.key === sortKey)?.text ?? '按最近添加排序';

  const tableCommon = {
    currentSongId: currentSong?.id,
    isPlaying,
    onPlay: handlePlay,
    onToggleFavorite: handleToggleFavorite,
    onDownload: (song: Song) => { void download(song); },
    onAddToPlaylist: handleAddToPlaylist,
    onCoverError: handleCoverError,
  };

  return (
    <div className="library">
      <header className="library__header">
        <h1 className="library__title">资料库</h1>
        <span className="library__stats">
          {formatCount(librarySongs.length)} 首 · {formatCount(albumCount)} 张专辑 · 本地 {formatCount(localSongs.length)} 首
        </span>
        <div className="library__header-actions">
          <div className="library__sort-wrap">
            <button
              type="button"
              className="library__text-btn"
              aria-haspopup="menu"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen((prev) => !prev)}
            >
              <ArrowDownUp size={15} aria-hidden="true" />
              排序
            </button>
            {sortOpen && (
              <>
                <div className="library__menu-scrim" onClick={() => setSortOpen(false)} aria-hidden="true" />
                <div className="library__menu" role="menu">
                  {SORT_ITEMS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortKey === item.key}
                      className="library__menu-item"
                      onClick={() => chooseSort(item.key)}
                    >
                      {item.label}
                      {sortKey === item.key && <Check size={14} className="library__menu-check" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </>
            )}
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
        </div>
      </header>

      <div className="library__tabs-row">
        <div className="library__segmented" role="tablist" aria-label="资料库视图">
          {TAB_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className="library__segment"
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" className="library__sortlink" onClick={cycleSort}>
          {sortText}
        </button>
      </div>

      <div className="library__scroll" role="tabpanel">
        {tab === 'songs' && (
          <div className="library__card">
            <LibrarySongTable
              {...tableCommon}
              songs={sortedSongs}
              favoriteIds={favoriteIds}
              emptyText="资料库还是空的——导入本地文件夹，或在任意列表点小心心。"
            />
          </div>
        )}

        {tab === 'albums' && (
          <div className="library__card">
            {albumGroups.length === 0 ? (
              <div className="library__empty">
                <Disc3 size={26} aria-hidden="true" />
                <div>还没有可聚合的专辑。</div>
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
                <div>还没有可聚合的歌手。</div>
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
            </div>
            <div className="library__card">
              {tasks.length === 0 ? (
                <div className="library__empty">
                  <Music2 size={26} aria-hidden="true" />
                  <div>{loadingDownloads ? '加载中…' : '暂无下载任务。'}</div>
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
                      {(task.status === 'pending' || task.status === 'downloading') ? (
                        <button
                          type="button"
                          className="library__task-cancel"
                          aria-label={'取消下载: ' + task.song.name}
                          onClick={() => void handleCancelTask(task.id)}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="library__task-cancel" aria-hidden="true" />
                      )}
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
              <LibrarySongTable
                {...tableCommon}
                songs={localDisplayed}
                favoriteIds={favoriteIdList}
                emptyText="还没有本地歌曲——导入一个音乐目录后会自动出现在这里。"
              />
            </div>
            <div className="library__footnote">移除文件夹只会从资料库移除索引，不会删除磁盘上的文件。</div>
          </div>
        )}
      </div>

      {playlistSong && (
        <AddToPlaylistModal
          song={playlistSong}
          isVisible
          onClose={() => setPlaylistSong(null)}
          onSuccess={() => setPlaylistSong(null)}
        />
      )}
    </div>
  );
};

export default LibraryPage;