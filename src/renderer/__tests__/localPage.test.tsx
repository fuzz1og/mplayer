import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Song } from '@mplayer/core';
import LocalPage from '@/renderer/pages/LocalPage';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useLocalStore } from '@/renderer/store/localStore';
import { usePlayerStore } from '@/renderer/store/playerStore';

const localSong = (id: string, name: string, artist: string, album: string, folder = 'D:/Music'): Song => ({
  id,
  name,
  artist,
  album,
  duration: 180,
  sourceType: 'local',
  url: 'file:///' + folder + '/' + name + '.mp3',
  cover: '',
  lrc: '',
});

const folder = (path: string, name: string, songCount: number) => ({
  path,
  name,
  songCount,
  lastScan: new Date(0),
});

const invokeMock = vi.fn();

const installIpc = () => {
  const api = (window as unknown as { electronAPI: { invoke: typeof invokeMock; on: ReturnType<typeof vi.fn> } }).electronAPI;
  api.invoke = invokeMock;
  invokeMock.mockImplementation(async (channel: string) => {
    switch (channel) {
      case 'localMusic:getFolders':
        return [folder('D:/Music', 'Music', 2)];
      case 'localMusic:getSongs':
        return [];
      case 'localMusic:refresh':
        return { folders: [folder('D:/Music', 'Music', 2)], songs: [] };
      case 'settings:getDownloadPath':
        return 'D:/Downloads';
      case 'download:getTasks':
        return [
          { id: 'task-1', song: localSong('x1', 'Downloading', '歌手丁', '专辑丁'), progress: 42, status: 'downloading' },
          { id: 'task-2', song: localSong('x2', 'PausedSong', '歌手戊', '专辑戊'), progress: 17, status: 'paused' },
        ];
      case 'download:pause':
      case 'download:resume':
      case 'download:cancel':
      case 'download:openDir':
      case 'download:showInFolder':
      case 'download:clearCompleted':
        return true;
      default:
        return { success: true };
    }
  });
};

const renderPage = (path = '/local') => render(
  <MemoryRouter initialEntries={[path]}>
    <LocalPage />
  </MemoryRouter>,
);

const rows = () => within(document.querySelector('.library__card .song-list__rows') as HTMLElement);

describe('本地页（#694）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installIpc();
    useFavoriteStore.setState({ favorites: [], favoriteIds: [], loading: false, error: null });
    useLocalStore.setState({
      folders: [folder('D:/Music', 'Music', 2)],
      songs: [
        localSong('local:1', 'Zulu', '本地歌手', '本地专辑'),
        localSong('local:2', 'Alpha', '本地歌手', '另一张专辑'),
      ],
      currentFolder: null,
      isScanning: false,
      scanProgress: null,
      initialized: true,
    });
    usePlayerStore.setState({ currentSong: null, isPlaying: false, currentPlaylist: [], currentPlaylistIndex: -1 });
  });

  it('页头是「本地」，内容视角恒为三段：歌曲 / 专辑 / 歌手，默认歌曲', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: '本地' })).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll('[role="radio"]')).map((el) => el.textContent?.trim()))
      .toEqual(['歌曲', '专辑', '歌手']);
    expect(screen.getByRole('radio', { name: '歌曲' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(rows().getByText('Zulu')).toBeInTheDocument());
    expect(screen.getByText('Music')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除文件夹: Music' })).toBeInTheDocument();
  });

  it('「专辑 / 歌手」段用同一批本地歌曲聚合，网格复用 AlbumGrid 与歌手卡', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: '专辑' }));
    const albumNames = Array.from(document.querySelectorAll('.album-grid__name')).map((el) => el.textContent);
    expect(albumNames.sort()).toEqual(['另一张专辑', '本地专辑'].sort());

    await userEvent.click(screen.getByRole('radio', { name: '歌手' }));
    expect(Array.from(document.querySelectorAll('.artist-card__name')).map((el) => el.textContent)).toEqual(['本地歌手']);
  });

  it('「导入文件夹」走本地音乐目录选择，导入后不丢失自己的扫描入口', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'dialog:openDirectory') return { canceled: true, filePaths: [] };
      if (channel === 'localMusic:getFolders') return [folder('D:/Music', 'Music', 2)];
      if (channel === 'localMusic:getSongs') return [];
      return { success: true };
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: '导入文件夹' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('dialog:openDirectory', 'localMusic'));
    expect(screen.getByRole('button', { name: '扫描' })).toBeInTheDocument();
  });

  it('「扫描」触发本地库刷新', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: '扫描' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('localMusic:refresh'));
  });

  it('移除文件夹只删索引并提示文件名', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: '移除文件夹: Music' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('localMusic:removeFolder', 'D:/Music'));
  });

  it('空态：没有本地歌曲时给出导入指引', async () => {
    useLocalStore.setState({ folders: [], songs: [], currentFolder: null });
    renderPage();
    await waitFor(() => expect(screen.getByText(/还没有本地歌曲/)).toBeInTheDocument());
  });

  it('「已下载」打开下载管理弹窗：目录、任务与取消操作可用', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: '已下载' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('D:/Downloads')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText('Downloading')).toBeInTheDocument());
    expect(within(dialog).getByText('42%')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: '取消下载: Downloading' }));
    expect(invokeMock).toHaveBeenCalledWith('download:cancel', 'task-1');
  });

  it('旧深链 /download → /local?downloads=1：进入本地页即打开下载管理', async () => {
    renderPage('/local?downloads=1');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('已下载')).toBeInTheDocument();
  });

  it('点本地歌曲播放时用当前显示列表建立队列', async () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    const originalPlay = usePlayerStore.getState().play;
    usePlayerStore.setState({ play: playSpy });
    try {
      renderPage();
      await waitFor(() => expect(rows().getByText('Alpha')).toBeInTheDocument());
      const row = rows().getByText('Alpha').closest('.song-row') as HTMLElement;
      const { fireEvent } = await import('@testing-library/react');
      fireEvent.click(row.querySelector('.song-row__cover-play') as HTMLElement);
      expect(playSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'local:2' }));
      const state = usePlayerStore.getState();
      expect(state.currentPlaylist.map((song) => song.id)).toEqual(['local:1', 'local:2']);
      expect(state.currentPlaylistIndex).toBe(1);
    } finally {
      usePlayerStore.setState({ play: originalPlay });
    }
  });
});
