import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import QueuePanel, { openQueuePanel, toggleQueuePanel, useQueuePanelStore } from '../components/QueuePanel';
import QueuePage from '../pages/QueuePage';
import { LIBRARY_ROW_HEIGHT } from '../components/songRowMetrics';

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
    expect(screen.getByRole('dialog', { name: '播放队列' })).toBeInTheDocument();
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
    expect(screen.getByRole('dialog', { name: '播放队列' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭队列' })).toHaveFocus());
    expect(usePlayerStore.getState().currentPlaylist).toBe(originalQueue);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '播放队列' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('弹出层语义：再点触发按钮收回，点面板外任意处也收回', async () => {
    render(
      <MemoryRouter>
        <button type="button" data-queue-trigger onClick={toggleQueuePanel}>播放队列</button>
        <QueuePanel />
      </MemoryRouter>,
    );
    const trigger = screen.getByRole('button', { name: '播放队列' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '播放队列' })).toBeInTheDocument();

    // 再点一下同一个按钮：收回（不是换路由，也不是叠第二块）
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog', { name: '播放队列' })).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '播放队列' })).toBeInTheDocument();
    // 面板外的点击：pointerdown 捕获阶段直接收回
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: '播放队列' })).toBeNull();
  });

  it('表头序号列宽与行同源：不会把标题列推偏 22px', () => {
    render(<MemoryRouter><QueuePanel standalone /></MemoryRouter>);
    const head = document.querySelector('.queue-panel__thead-index') as HTMLElement;
    const rowIndex = document.querySelector('.song-row__index') as HTMLElement;
    // 修前：表头 COL_INDEX=50、行（library 变体）COL_INDEX_LIBRARY=28
    expect(head.style.getPropertyValue('--col-width')).toBe('28px');
    expect(head.style.getPropertyValue('--col-width')).toBe(rowIndex.style.getPropertyValue('--col-width'));
  });

  it('行高单源：虚拟测量的 estimate 取自 songRowMetrics，面板内不再自写一份 46', () => {
    // 虚拟测量是行为断言不到的（jsdom 量不出视口）：这里钉住「数值只有一个来源」这一结构事实，
    // 再加一条运行时的行高对齐断言——两处一旦各写一份，改密度协议时就会静默压叠。
    const source = readFileSync(
      join(dirname(fileURLToPath(String(import.meta.url))), '..', 'components', 'QueuePanel.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/QUEUE_PANEL_ROW_HEIGHT/);
    expect(source).toContain('estimateSize={() => songRowHeight(QUEUE_ROW_DENSITY)}');

    usePlayerStore.setState({ currentPlaylist: QUEUE, currentPlaylistIndex: -1, playMode: '列表循环', shuffle: null });
    render(<MemoryRouter><QueuePanel standalone /></MemoryRouter>);
    const row = document.querySelector('.song-row') as HTMLElement;
    expect(row.style.getPropertyValue('--song-row-height')).toBe(`${LIBRARY_ROW_HEIGHT}px`);
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
