import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Song } from '@mplayer/core';

/**
 * #639 R2：重复 id 队列下行尾「移除」必须删掉用户点的那一行（旧实现按 id 反查 → 恒删第一个同 id 成员）。
 * 判别力来自「同 id 但 name 不同」：删错成员时留下的 name 与预期不同。
 */

const audioPlayerMock = vi.hoisted(() => {
  const player = {
    getVolume: vi.fn(() => 80),
    getPosition: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getState: vi.fn(() => 'idle'),
    getCurrentSong: vi.fn(() => null),
    isPlaying: vi.fn(() => false),
    isPaused: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    cancelLoad: vi.fn(),
    load: vi.fn(async () => {}),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    destroy: vi.fn(),
  };
  return { player };
});

vi.mock('../services/audioPlayer', () => ({
  getGlobalPlayer: () => audioPlayerMock.player,
  destroyGlobalPlayer: vi.fn(),
}));

const callMusicApiMock = vi.hoisted(() => vi.fn());
const ipcInvokeMock = vi.hoisted(() => vi.fn());

vi.mock('../services/callMusicApi', () => ({ callMusicApi: callMusicApiMock }));
vi.mock('../services/IpcClient', () => ({ IpcClient: { invoke: ipcInvokeMock } }));
vi.mock('../utils/songCoverRefresh', () => ({ refreshSongCover: vi.fn(async () => null) }));

import { usePlayerStore } from '../store/playerStore';
import QueuePage from '../pages/QueuePage';

/** 同一个 id 的两条成员靠 name 区分（队列允许同一首歌占多格）。 */
function song(id: string, name: string): Song {
  return {
    id, name, artist: '周杰伦', album: '', duration: 240,
    sourceType: 'netease', url: `https://audio.example.com/${id}.mp3`, cover: '', lrc: '',
  };
}

const DUP = 'netease:1';
const OTHER = 'netease:2';

/** 行根节点（SongRow 的 .song-row）：顺序 = 显示序 */
const rows = () => Array.from(document.querySelectorAll('.song-row')) as HTMLElement[];

/** 行尾第二个按钮就是「移除」（第一个是「加入歌单」，带 aria-label） */
function removeButtonAt(displayIndex: number): HTMLElement {
  const row = rows()[displayIndex];
  expect(row, `显示序第 ${displayIndex} 行不存在`).toBeTruthy();
  const buttons = Array.from(row.querySelectorAll('button')) as HTMLElement[];
  expect(buttons.length).toBeGreaterThanOrEqual(2);
  return buttons[1];
}

const names = () => usePlayerStore.getState().currentPlaylist.map((s) => s.name);

function renderPage() {
  return render(
    <MemoryRouter>
      <QueuePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  ipcInvokeMock.mockReset();
  ipcInvokeMock.mockResolvedValue(undefined);
  callMusicApiMock.mockReset();
  usePlayerStore.setState({
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    error: null,
    lyrics: '',
    lyricsLoading: false,
    playMode: '列表循环',
    currentPlaylist: [],
    currentPlaylistIndex: -1,
    shuffle: null,
  });
});

describe('#639 R2：队列页移除按显示序命中正确的成员', () => {
  it('非随机模式：队列含同 id 两条成员时，删第 2 行删掉的是第 2 个成员', async () => {
    usePlayerStore.setState({
      currentPlaylist: [song(DUP, 'A1'), song(DUP, 'A2'), song(OTHER, 'B')],
      currentPlaylistIndex: -1,
      playMode: '列表循环',
      shuffle: null,
    });
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(3));

    fireEvent.click(removeButtonAt(1)); // 第 2 行 = A2

    // 修前：findIndex 命中第一个同 id 成员 → 删掉 A1，剩 [A2, B]
    expect(names()).toEqual(['A1', 'B']);
  });

  it('随机模式：显示序 ≠ 成员序且含重复 id 时，删除命中显示的那一条', async () => {
    // 成员 [A1, B, A2]，随机序 [B, A, A] → 显示序 = [B, A1, A2]（FIFO：第 k 个 A 对第 k 个 A 成员）
    usePlayerStore.setState({
      currentPlaylist: [song(DUP, 'A1'), song(OTHER, 'B'), song(DUP, 'A2')],
      currentPlaylistIndex: 1, // 当前 B
      currentSong: song(OTHER, 'B'),
      playMode: '随机播放',
      shuffle: { order: [OTHER, DUP, DUP], cursor: 0 },
    });
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map((row) => row.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('B')]),
    );

    fireEvent.click(removeButtonAt(2)); // 显示第 3 行 = A2（成员下标 2）

    // 修前：按 id 反查命中成员下标 0 → 删掉 A1，剩 [B, A2]
    expect(names()).toEqual(['A1', 'B']);
  });

  it('随机模式下删除非重复 id 的行仍然正确（回归）', async () => {
    usePlayerStore.setState({
      currentPlaylist: [song(DUP, 'A'), song(OTHER, 'B'), song('netease:3', 'C')],
      currentPlaylistIndex: 0,
      currentSong: song(DUP, 'A'),
      playMode: '随机播放',
      shuffle: { order: [OTHER, 'netease:3', DUP], cursor: 2 },
    });
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(3));

    fireEvent.click(removeButtonAt(0)); // 显示第 1 行 = B（成员下标 1）

    expect(names()).toEqual(['A', 'C']);
  });
});
