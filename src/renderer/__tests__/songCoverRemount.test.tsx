import React, { useCallback, useEffect, useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Song } from '@mplayer/core';

/**
 * 收藏/历史只落 SongBase（无 cover），列表每次重挂都靠 refreshSongCover 水合封面。
 * 覆盖真机路径：① 卸载重挂后从缓存渲染（冷却不能挡水合）② 挂载后被重读 SongBase 擦掉后能自愈。
 */

const h = vi.hoisted(() => ({
  cache: new Map<string, { url: string; cover: string; lrc: string }>(),
  search: vi.fn(),
}));

vi.mock('../services/IpcClient', () => ({
  IpcClient: {
    invoke: vi.fn(async (channel: string, key: string, arg?: unknown) => {
      if (channel === 'cache:getSongResources') return h.cache.get(key) ?? null;
      if (channel === 'cache:setSongResources') {
        h.cache.set(key, arg as { url: string; cover: string; lrc: string });
        return null;
      }
      return null;
    }),
  },
}));

vi.mock('../services/callMusicApi', () => ({
  callMusicApi: (...args: unknown[]) => h.search(...args),
}));

import SongRow from '../components/SongRow';
import { refreshSongCover, __resetSongCoverRefreshState } from '../utils/songCoverRefresh';

const song: Song = {
  id: '3336112836',
  name: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  duration: 269,
  sourceType: 'netease',
  url: '',
  cover: '',
  lrc: '',
};

const freshCover = 'https://img.example.com/new-cover.jpg';

/** 宿主：与 FavoritesPage 的 handleCoverError 同一契约——回填封面到列表状态。 */
function RowHost({ value, resetSignal = 0 }: { value: Song; resetSignal?: number }) {
  const [current, setCurrent] = useState<Song>(value);
  useEffect(() => {
    // 模拟切页返回后 loadFavorites 用 SongBase 覆盖内存里的已水合封面
    if (resetSignal > 0) setCurrent({ ...value, cover: '' });
  }, [resetSignal, value]);
  const handleCoverError = useCallback((target: Song) => {
    void refreshSongCover(target).then((cover) => {
      if (cover) setCurrent((prev) => ({ ...prev, cover }));
    });
  }, []);
  return (
    <MemoryRouter>
      <SongRow song={current} index={0} queue={[current]} onPlay={() => {}} onCoverError={handleCoverError} />
    </MemoryRouter>
  );
}

const imgSrc = (container: HTMLElement) => container.querySelector('.song-row img')?.getAttribute('src');

describe('封面卸载重挂 / 重读 SongBase（切页返回）', () => {
  beforeEach(() => {
    h.cache.clear();
    h.search.mockReset();
    __resetSongCoverRefreshState();
  });

  it('卸载重挂后歌曲对象退回 SongBase（无 cover），封面仍从缓存渲染', async () => {
    h.search.mockResolvedValue([{ ...song, cover: freshCover }]);

    const first = render(<RowHost value={song} />);
    await waitFor(() => expect(imgSrc(first.container)).toBe(freshCover));
    expect(h.search).toHaveBeenCalledTimes(1);
    first.unmount();

    // 切页返回：新挂载的列表只有 SongBase，cover 为空；仍在 60s 重搜冷却内
    const second = render(<RowHost value={{ ...song, cover: '' }} />);
    await waitFor(() => expect(imgSrc(second.container)).toBe(freshCover));
    // 水合命中的是本地缓存，不再打上游搜索
    expect(h.search).toHaveBeenCalledTimes(1);
  });

  it('挂载后封面被重读的 SongBase 擦掉，行仍会自愈回封面', async () => {
    // 上一次访问已把封面写进主进程 URL 缓存
    h.cache.set(song.id, { url: '', cover: freshCover, lrc: '' });
    // 页面挂载时内存里已有封面（上一次访问水合的结果）
    const { container, rerender } = render(<RowHost value={{ ...song, cover: freshCover }} />);
    expect(imgSrc(container)).toBe(freshCover);

    // 切页返回：loadFavorites 写入无封面的 SongBase，行挂载已完成、不能再靠挂载触发
    rerender(<RowHost value={{ ...song, cover: freshCover }} resetSignal={1} />);
    await waitFor(() => expect(imgSrc(container)).toBe(freshCover));
    expect(h.search).not.toHaveBeenCalled();
  });
});
