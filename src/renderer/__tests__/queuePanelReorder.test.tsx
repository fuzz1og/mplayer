import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
// 只验证“面板把拖拽结果交给真实 store”；拖拽 DOM 行为由 virtualSortableList.test 覆盖。
vi.mock('../components/VirtualSortableList', () => ({
  default: ({ items, onReorder }: { items: Song[]; onReorder: (from: number, to: number) => void }) => (
    <div>
      <span data-testid="item-count">{items.length}</span>
      <button type="button" data-testid="reorder" onClick={() => onReorder(0, 2)}>重排</button>
    </div>
  ),
}));

import { usePlayerStore } from '../store/playerStore';
import QueuePanel from '../components/QueuePanel';

function song(id: string, name: string): Song {
  return { id, name, artist: '歌手', album: '专辑', duration: 240, sourceType: 'netease', url: '', cover: '', lrc: '' };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe('QueuePanel 拖拽排序（#707）', () => {
  it('面板把重排交给 store，顺序变化且播放状态不中断', () => {
    const a = song('a', 'A');
    usePlayerStore.setState({
      currentPlaylist: [a, song('b', 'B'), song('c', 'C')],
      currentPlaylistIndex: 0,
      currentSong: a,
      isPlaying: true,
      playMode: '列表循环',
      shuffle: null,
    });
    render(<QueuePanel standalone />);
    expect(screen.getByTestId('item-count')).toHaveTextContent('3');
    fireEvent.click(screen.getByTestId('reorder'));
    const state = usePlayerStore.getState();
    expect(state.currentPlaylist.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(state.currentPlaylistIndex).toBe(2);
    expect(state.currentSong?.id).toBe('a');
    expect(state.isPlaying).toBe(true);
  });
});
