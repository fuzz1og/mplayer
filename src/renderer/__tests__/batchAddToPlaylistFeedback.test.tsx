import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { Song } from '@mplayer/core';

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: (...args: unknown[]) => h.invoke(...args) },
}));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    message: { success: h.success, error: h.error, info: h.info, warning: vi.fn() },
  };
});

import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';

const song = (id: string): Song => ({
  id,
  name: `歌${id}`,
  artist: '歌手',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 180,
  sourceType: 'netease',
});

/**
 * #551 回归：8dc86fd（#542）把歌单写入改走 core 编排时，
 * 桌面批量新建分支的成功反馈被弄丢了——只剩 setNewPlaylistName('')，
 * 丢了 message.success / onClose / onSuccess。
 *
 * 这条用例在修复前会红（onClose 从不被调用），修复后转绿。
 * 它断言的是**行为**（提示 / 关闭 / 回调），不是渲染层源码文本——
 * 对照 hotlistSaveAll.test.ts 那种 readFileSync + toContain 的断言方式。
 */
describe('批量加入歌单：新建成功后必须给出反馈并关闭（#551）', () => {
  beforeEach(() => {
    h.invoke.mockReset();
    h.success.mockReset();
    h.error.mockReset();
    h.info.mockReset();
  });

  function mockIpc(handlers: Record<string, unknown | (() => unknown)> = {}) {
    h.invoke.mockImplementation(async (channel: string) => {
      const h2 = handlers[channel];
      if (h2 !== undefined) return typeof h2 === 'function' ? (h2 as () => unknown)() : h2;
      if (channel === 'playlist:getAll') return [];
      if (channel === 'playlist:create') return 42;
      if (channel === 'playlist:addSongs') return ['a', 'b'];
      return undefined;
    });
  }

  it('新建并加入成功 → 有成功提示、调用 onClose 与 onSuccess', async () => {
    mockIpc();
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <BatchAddToPlaylistModal
        songs={[song('a'), song('b')]}
        isVisible
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('新建歌单...'), { target: { value: '我的新歌单' } });
    fireEvent.click(screen.getByRole('button', { name: /新建并加入/ }));

    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('playlist:create', '我的新歌单'));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('playlist:addSongs', 42, expect.any(Array)));

    // ⭐ 这三条就是 8dc86fd 弄丢的东西
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(h.success).toHaveBeenCalled();
  });

  it('写入失败 → 回滚新建的歌单、不关闭、不谎报成功', async () => {
    mockIpc({
      'playlist:addSongs': () => {
        throw new Error('写入炸了');
      },
    });
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <BatchAddToPlaylistModal songs={[song('a')]} isVisible onClose={onClose} onSuccess={onSuccess} />,
    );

    fireEvent.change(screen.getByPlaceholderText('新建歌单...'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /新建并加入/ }));

    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('playlist:delete', 42));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled();
    expect(h.error).toHaveBeenCalled();
  });
});
