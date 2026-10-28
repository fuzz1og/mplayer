import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Song } from '@mplayer/core';

const audioPlayerMock = vi.hoisted(() => {
  const player = {
    getVolume: vi.fn(() => 80), getPosition: vi.fn(() => 0), getDuration: vi.fn(() => 0),
    getState: vi.fn(() => 'idle'), getCurrentSong: vi.fn(() => null),
    isPlaying: vi.fn(() => false), isPaused: vi.fn(() => false), isLoading: vi.fn(() => false),
    cancelLoad: vi.fn(), load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
    seek: vi.fn(), setVolume: vi.fn(), destroy: vi.fn(),
  };
  return { player };
});
vi.mock('../services/audioPlayer', () => ({ getGlobalPlayer: () => audioPlayerMock.player, destroyGlobalPlayer: vi.fn() }));
vi.mock('../utils/songCoverRefresh', () => ({ refreshSongCover: vi.fn(async () => null) }));

import { usePlayerStore } from '../store/playerStore';
import QueuePanel, { openQueuePanel, useQueuePanelStore } from '../components/QueuePanel';
import QueuePage from '../pages/QueuePage';

function song(id: string, name: string): Song {
  return { id, name, artist: '歌手', album: '专辑', duration: 240, sourceType: 'netease', url: '', cover: '', lrc: '' };
}

const QUEUE = [song('a', 'A'), song('b', 'B')];

beforeEach(() => {
  cleanup();
  localStorage.clear();
  usePlayerStore.setState({
    currentSong: null, isPlaying: false, isLoading: false, error: null,
    lyrics: '', lyricsLoading: false, playMode: '列表循环',
    currentPlaylist: QUEUE, currentPlaylistIndex: -1, shuffle: null,
  });
  useQueuePanelStore.setState({ isOpen: false, returnFocus: null });
});

describe('QueuePanel（#707）', () => {
  it('旧 /queue 路由渲染为右侧面板，而不是独立列表页', () => {
    render(<MemoryRouter><QueuePage /></MemoryRouter>);
    expect(screen.getByRole('complementary', { name: '播放队列' })).toBeInTheDocument();
    expect(document.querySelector('.list-page')).toBeNull();
    expect(document.querySelectorAll('.song-row')).toHaveLength(2);
  });

  it('全局打开不改变队列引用；ESC 关闭并把焦点归还触发按钮', async () => {
    const originalQueue = usePlayerStore.getState().currentPlaylist;
    render(
      <MemoryRouter>
        <button type="button" onClick={openQueuePanel}>打开队列</button>
        <QueuePanel />
      </MemoryRouter>,
    );
    const trigger = screen.getByRole('button', { name: '打开队列' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('complementary', { name: '播放队列' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭队列' })).toHaveFocus());
    expect(usePlayerStore.getState().currentPlaylist).toBe(originalQueue);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: '播放队列' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('保存为歌单保留批量能力：打开统一 Dialog', async () => {
    const electron = (window as unknown as { electronAPI: { invoke: (channel: string) => Promise<unknown> } }).electronAPI;
    const originalInvoke = electron.invoke;
    electron.invoke = vi.fn(async (channel: string) => (channel === 'playlist:getAll' ? [] : undefined));
    render(<MemoryRouter><QueuePanel standalone /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '保存为歌单' }));
    expect(await screen.findByRole('heading', { name: '批量加入歌单' })).toBeInTheDocument();
    electron.invoke = originalInvoke;
  });
});
