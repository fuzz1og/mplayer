import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Song } from '@mplayer/core';
import PlaylistDetailPage from '@/renderer/pages/PlaylistDetailPage';

/**
 * #694 评审：本地歌单详情曾是「每行常驻复选框 + 表头常驻全选」，与本轮按需选择模式（#699）不一致。
 * 修复后普通浏览没有复选框列，点「选择」才出现；拖拽把手仍留在序号列。
 */

function song(i: number): Song {
  return {
    id: `netease:${i}`,
    name: `曲目 ${i}`,
    artist: `歌手 ${i}`,
    album: '',
    url: '',
    cover: 'https://cdn.example.com/cover.jpg',
    lrc: '',
    duration: 200,
    sourceType: 'netease',
  } as Song;
}

function renderPage() {
  const songs = [song(0), song(1), song(2)];
  // IpcClient 在模块加载时抓住了 window.electronAPI 引用（setup.ts 已注入），只能改方法本身
  const invoke = (window as unknown as { electronAPI: { invoke: ReturnType<typeof vi.fn> } }).electronAPI.invoke;
  invoke.mockReset();
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'playlist:get') return { id: 7, name: '测试歌单', description: '', cover: '', songCount: songs.length };
    if (channel === 'playlist:getSongs') return songs;
    return undefined;
  });
  const view = render(
    <MemoryRouter initialEntries={['/playlist/7']}>
      <Routes>
        <Route path="/playlist/:id" element={<PlaylistDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return { container: view.container, songs };
}

const toggleButton = (container: HTMLElement) =>
  container.querySelector('.song-list__batch-toggle') as HTMLElement;

afterEach(() => {
  cleanup();
  document.querySelectorAll('body > div').forEach((node) => node.remove());
});

describe('本地歌单详情：按需选择模式（#694 评审）', () => {
  it('普通浏览没有复选框列与表头全选，点「选择」才出现；拖拽把手仍在序号列', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(3));

    // 普通浏览：没有常驻复选框、没有全选、没有批量栏；表头已删（#694），只剩一行工具条
    expect(container.querySelector('.song-row__check')).toBeNull();
    expect(container.querySelector('.playlist-detail__thead')).toBeNull();
    expect(container.querySelector('input[aria-label="全选可见歌曲"]')).toBeNull();
    expect(container.textContent).not.toContain('已选择');
    expect(container.querySelectorAll('.playlist-detail__toolbar').length).toBe(1);

    // 拖拽把手仍在序号列（与 #703 的拖拽语义同源，不进选择模式也在）
    const row = container.querySelector('.song-row') as HTMLElement;
    expect(row.querySelector('.song-row__index [aria-label^="拖拽排序"]')).toBeTruthy();

    // 行序号列宽仍是 COL_INDEX_LIBRARY = 28（表头删了，行的列几何不变）
    expect((row.querySelector('.song-row__index') as HTMLElement).style.getPropertyValue('--col-width')).toBe('28px');

    // 显式进入：复选框列出现，全选落在工具条内（表头删除后唯一入口），按钮用 aria-pressed 表达状态
    expect(toggleButton(container)).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggleButton(container));
    await waitFor(() => expect(container.querySelectorAll('.song-row__check').length).toBe(3));
    const toolbar = container.querySelector('.playlist-detail__toolbar') as HTMLElement;
    expect(toolbar.querySelector('input[aria-label="全选可见歌曲"]')).toBeTruthy();
    expect(container.querySelector('.playlist-detail__thead')).toBeNull();
    expect(toggleButton(container)).toHaveAttribute('aria-pressed', 'true');

    // 退出：复选框列消失，选择集被清空
    fireEvent.click(toggleButton(container));
    await waitFor(() => expect(container.querySelector('.song-row__check')).toBeNull());
    expect(container.textContent).not.toContain('已选择');
  });
});
