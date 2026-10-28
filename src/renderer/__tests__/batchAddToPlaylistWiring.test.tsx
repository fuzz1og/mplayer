import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Song } from '@mplayer/core';

/**
 * #562 回归：**开了「批量加入歌单」开关，按钮就必须点得动**。
 * 弹窗与写入本来就在 SongList 内部闭环（BatchAddToPlaylistModal 自己走桌面 adapter），页面回调只是
 * 「成功通知」。
 */

const h = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: (...args: unknown[]) => h.invoke(...args) },
}));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return { ...actual, message: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } };
});

import SongList from '@/renderer/components/SongList';

const song = (id: string): Song => ({
  id,
  name: '歌' + id,
  artist: '歌手',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 180,
  sourceType: 'netease',
});

function renderList(extra: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <SongList
        songs={[song('a'), song('b')]}
        onPlay={() => {}}
        showHeader={false}
        showCheckbox
        enableBatchAddToPlaylist
        {...extra}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'playlist:getAll') return [{ id: 1, name: '我的歌单', songs: [] }];
    return undefined;
  });
});

describe('「批量加入歌单」入口不依赖页面回调（#562）', () => {
  it('只传 enableBatchAddToPlaylist（不传回调）：勾选后点击能开出弹窗', async () => {
    renderList();

    // 进入选择模式 → 勾一首
    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: /批量加入歌单/ }));

    // 弹窗标题出现 = 入口是活的（修复前这里永远不会出现）
    await waitFor(() => expect(screen.getByRole('heading', { name: '批量加入歌单' })).toBeTruthy());
    expect(h.invoke).toHaveBeenCalledWith('playlist:getAll');
  });

  it('传了回调也只是成功通知：点击同样开出弹窗（不重复渲染第二个弹窗）', async () => {
    const onBatchAddToPlaylist = vi.fn();
    renderList({ onBatchAddToPlaylist });

    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: /批量加入歌单/ }));

    await waitFor(() => expect(screen.getByRole('heading', { name: '批量加入歌单' })).toBeTruthy());
    // 通知回调是**成功之后**才调，弹窗刚开时不该被调
    expect(onBatchAddToPlaylist).not.toHaveBeenCalled();
  });
});
