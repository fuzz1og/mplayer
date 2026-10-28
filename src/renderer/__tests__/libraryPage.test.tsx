import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Song } from '@mplayer/core';
import LibraryPage from '@/renderer/pages/LibraryPage';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useLocalStore } from '@/renderer/store/localStore';
import { usePlayerStore } from '@/renderer/store/playerStore';

const song = (id: string, name: string, artist: string, album: string, duration = 240, sourceType: Song['sourceType'] = 'netease'): Song => ({
  id,
  name,
  artist,
  album,
  duration,
  sourceType,
  url: 'https://audio.example.com/' + id + '.mp3',
  cover: '',
  lrc: '',
});

const favorites = [
  song('netease:1', 'Bravo', '歌手乙', '专辑乙'),
  song('netease:2', 'Alpha', '歌手甲', '专辑甲'),
];
const localRaw = [
  {
    id: 'local:1',
    name: 'Zulu',
    artist: '本地歌手',
    album: '本地专辑',
    duration: 180,
    filePath: 'D:/Music/Zulu.mp3',
    coverPath: '',
  },
];
const historyRows = [
  // 与收藏同 id：应被去重
  { song: favorites[0] },
  { song: song('netease:3', 'Charlie', '歌手丙', '专辑丙') },
];

const downloadTasks = [
  {
    id: 'task-downloading',
    song: song('netease:9', 'Downloading', '歌手丁', '专辑丁'),
    progress: 42,
    status: 'downloading',
  },
  {
    id: 'task-paused',
    song: song('netease:10', 'PausedSong', '歌手戊', '专辑戊'),
    progress: 17,
    status: 'paused',
  },
  {
    id: 'task-pending',
    song: song('netease:11', 'PendingSong', '歌手己', '专辑己'),
    progress: 0,
    status: 'pending',
  },
  {
    id: 'task-completed',
    song: song('netease:12', 'CompletedSong', '歌手庚', '专辑庚'),
    progress: 100,
    status: 'completed',
    filePath: 'D:/Downloads/CompletedSong.mp3',
  },
];

const invokeMock = vi.fn();

const installIpc = () => {
  const api = (window as unknown as { electronAPI: { invoke: typeof invokeMock; on: ReturnType<typeof vi.fn> } }).electronAPI;
  api.invoke = invokeMock;
  invokeMock.mockImplementation(async (channel: string) => {
    switch (channel) {
      case 'favorite:getAll':
        return favorites;
      case 'history:get':
        return historyRows;
      case 'localMusic:getFolders':
        return [{ path: 'D:/Music', name: 'Music', songCount: 1 }];
      case 'localMusic:getSongs':
        return localRaw;
      case 'settings:getDownloadPath':
        return 'D:/Downloads';
      case 'download:getTasks':
        return downloadTasks;
      case 'download:pause':
      case 'download:resume':
      case 'download:openDir':
      case 'download:showInFolder':
        return true;
      default:
        return { success: true };
    }
  });
};

const LocationProbe = () => {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
};

const renderPage = (path = '/library') => render(
  <MemoryRouter initialEntries={[path]}>
    <LibraryPage />
    <LocationProbe />
  </MemoryRouter>,
);

/** 共享 SongList 的行容器（library 密度渲染在 .library__card 里）。 */
const rows = () => within(document.querySelector('.library__card .song-list__rows') as HTMLElement);

describe('资料库页', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installIpc();
    useFavoriteStore.setState({ favorites: [], favoriteIds: [], loading: false, error: null });
    useLocalStore.setState({ folders: [], songs: [], currentFolder: null, isScanning: false, initialized: false });
    usePlayerStore.setState({ currentSong: null, isPlaying: false, currentPlaylist: [], currentPlaylistIndex: -1 });
  });

  it('页头现算统计：收藏 + 本地 + 历史去重', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: '资料库' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/4 首 · 4 张专辑 · 本地 1 首/)).toBeInTheDocument();
    });
  });

  it('分段 pill 有五个视图，默认停在歌曲', async () => {
    renderPage();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['歌曲', '专辑', '歌手', '下载', '本地']);
    expect(screen.getByRole('tab', { name: '歌曲' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(rows().getByText('Bravo')).toBeInTheDocument());
  });

  it('排序菜单提供三种方式，按标题排序后顺序改变', async () => {
    renderPage();
    await waitFor(() => expect(rows().getByText('Bravo')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '排序' }));
    const options = screen.getAllByRole('menuitemradio');
    expect(options.map((item) => item.textContent)).toEqual(['按最近添加', '按标题', '按歌手']);
    await userEvent.click(screen.getByRole('menuitemradio', { name: '按标题' }));

    await waitFor(() => {
      const titles = Array.from(document.querySelectorAll('.library__card .song-row__title')).map((el) => el.textContent);
      expect(titles).toEqual(['Alpha', 'Bravo', 'Charlie', 'Zulu']);
    });
    expect(screen.getByText('按标题排序')).toBeInTheDocument();
  });

  it('导入按钮打开本地文件夹选择（真实可用）', async () => {
    const base = invokeMock.getMockImplementation();
    invokeMock.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'dialog:openDirectory') return { canceled: true, filePaths: [] };
      return base ? base(channel, ...args) : { success: true };
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: '导入' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('dialog:openDirectory', 'localMusic');
    });
  });

  it('下载 tab 读目录与任务列表，可取消任务', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: '下载' }));
    await waitFor(() => expect(screen.getByText('D:/Downloads')).toBeInTheDocument());
    expect(screen.getByText('Downloading')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '取消下载: Downloading' }));
    expect(invokeMock).toHaveBeenCalledWith('download:cancel', 'task-downloading');
  });

  it('URL tab 参数决定初始分段：download 兼容 downloads', async () => {
    renderPage('/library?tab=download');
    expect(screen.getByRole('tab', { name: '下载' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByText('Downloading')).toBeInTheDocument());
  });

  it('非法 tab 参数回落到歌曲分段', async () => {
    renderPage('/library?tab=bogus');
    expect(screen.getByRole('tab', { name: '歌曲' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(rows().getByText('Bravo')).toBeInTheDocument());
  });

  it('切换分段 replace 同步 URL（歌曲默认不带 tab）', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: '下载' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/library?tab=downloads');
    await userEvent.click(screen.getByRole('tab', { name: '歌曲' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/library$/);
  });

  it('下载任务按状态提供开始/暂停/取消/打开所在文件夹，目录行可打开目录', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: '下载' }));
    await waitFor(() => expect(screen.getByText('PausedSong')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: '开始下载: PendingSong' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '开始下载: PausedSong' }));
    expect(invokeMock).toHaveBeenCalledWith('download:resume', 'task-paused');

    await userEvent.click(screen.getByRole('button', { name: '暂停下载: Downloading' }));
    expect(invokeMock).toHaveBeenCalledWith('download:pause', 'task-downloading');

    await userEvent.click(screen.getByRole('button', { name: '取消下载: PausedSong' }));
    expect(invokeMock).toHaveBeenCalledWith('download:cancel', 'task-paused');

    await userEvent.click(screen.getByRole('button', { name: '打开所在文件夹: CompletedSong' }));
    expect(invokeMock).toHaveBeenCalledWith('download:showInFolder', 'task-completed');

    await userEvent.click(screen.getByRole('button', { name: '打开目录' }));
    expect(invokeMock).toHaveBeenCalledWith('download:openDir');
  });

  it('本地 tab 展示文件夹与本地歌曲', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: '本地' }));
    await waitFor(() => expect(rows().getByText('Zulu')).toBeInTheDocument());
    expect(screen.getByText('Music')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除文件夹: Music' })).toBeInTheDocument();
  });

  it('当前播放行显示三根音柱', async () => {
    usePlayerStore.setState({ currentSong: favorites[1], isPlaying: true });
    renderPage();
    await waitFor(() => expect(rows().getByText('Alpha')).toBeInTheDocument());
    const currentRow = document.querySelector('.song-row[data-current]');
    expect(currentRow).not.toBeNull();
    expect(currentRow?.querySelectorAll('.song-row__bar').length).toBe(3);
  });

  it('歌曲分段用共享 SongList 的 library 密度：无表头、时长列、单个 More 操作', async () => {
    renderPage();
    await waitFor(() => expect(rows().getByText('Bravo')).toBeInTheDocument());

    const list = document.querySelector('.library__card .song-list') as HTMLElement;
    expect(list).toHaveAttribute('data-density', 'library');
    // library 密度默认无表头
    expect(document.querySelector('.song-list__head')).toBeNull();

    const firstRow = document.querySelector('.library__card .song-row') as HTMLElement;
    expect(firstRow).toHaveAttribute('data-variant', 'library');
    // 时长列常驻（240s → 4:00）
    expect(firstRow.querySelector('.song-row__duration')?.textContent).toBe('4:00');
    expect(
      (firstRow.querySelector('.song-row__duration') as HTMLElement).style.getPropertyValue('--col-width'),
    ).toBe('50px');
    // 行尾不再并排三个图标：只留一个「更多」
    const actionButtons = firstRow.querySelectorAll('.row-actions button');
    expect(actionButtons).toHaveLength(1);
    expect(actionButtons[0]).toHaveAttribute('aria-label', '更多操作: Bravo');
  });

  it('点行封面播放时用当前显示列表建立队列', async () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    const originalPlay = usePlayerStore.getState().play;
    usePlayerStore.setState({ play: playSpy });
    try {
      renderPage();
      await waitFor(() => expect(rows().getByText('Alpha')).toBeInTheDocument());

      // 行内查询必须限定在列表里：每行的换源弹窗也会把歌名 portal 到 body
      const row = rows().getByText('Alpha').closest('.song-row') as HTMLElement;
      fireEvent.click(row.querySelector('.song-row__cover-play') as HTMLElement);

      expect(playSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'netease:2' }));
      const state = usePlayerStore.getState();
      // 收藏 + 本地 + 历史去重后的当前显示列表，行号 = 2
      expect(state.currentPlaylist.map((song) => song.id)).toEqual([
        'netease:1',
        'netease:2',
        'local:1',
        'netease:3',
      ]);
      expect(state.currentPlaylistIndex).toBe(1);
    } finally {
      usePlayerStore.setState({ play: originalPlay });
    }
  });
});