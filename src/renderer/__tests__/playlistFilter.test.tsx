import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Modal } from 'antd';
import type { Song } from '@mplayer/core';
import PlaylistDetailPage from '@/renderer/pages/PlaylistDetailPage';
import { filterSongsByQuery } from '@/renderer/utils/songFilter';

/**
 * 本地歌单页「歌单内过滤」（#488）。三条铁律各有症状级断言：
 * 1. 过滤只影响展示集合 —— 清空输入后顺序与过滤前逐项相同；
 * 2. 过滤态禁用拖拽排序 —— 行不注册 useSortable（无拖拽手柄），全程不发 playlist:reorderFull；
 * 3. 全选 / 批量操作只见可见集合 —— 落库结果与界面一致。
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

const LIST = (count: number) => Array.from({ length: count }, (_, i) => song(i));
/** 在 40 首里只命中一首的关键词（`曲目 37` 不是 `曲目 3` / `曲目 7` 的子串） */
const ONE_HIT = '曲目 37';

type InvokeCall = [string, ...unknown[]];

function renderPage(songs: Song[]): { container: HTMLElement; calls: InvokeCall[] } {
  const calls: InvokeCall[] = [];
  // IpcClient 在模块加载时抓住了 window.electronAPI 引用（setup.ts 已注入），只能改方法本身
  const invoke = (window as unknown as { electronAPI: { invoke: ReturnType<typeof vi.fn> } }).electronAPI.invoke;
  invoke.mockReset();
  invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
    calls.push([channel, ...args]);
    if (channel === 'playlist:get') return { id: 7, name: '测试歌单', description: '', cover: '', songCount: songs.length };
    if (channel === 'playlist:getSongs') return songs;
    if (channel === 'download:startBatch') return [];
    return undefined;
  });
  const view = render(
    <MemoryRouter initialEntries={['/playlist/7']}>
      <Routes>
        <Route path="/playlist/:id" element={<PlaylistDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return { container: view.container, calls };
}

const rowTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.song-row')).map((el) => el.textContent ?? '');

const filterInput = (container: HTMLElement) =>
  container.querySelector('input[aria-label="按歌名或歌手过滤"]') as HTMLInputElement;

const selectAllCheckbox = (container: HTMLElement) =>
  container.querySelector('input[aria-label="全选可见歌曲"]') as HTMLInputElement;

const dragHandles = (container: HTMLElement) =>
  container.querySelectorAll('[aria-label^="拖拽排序"]');

const checkedRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLInputElement>('.song-row input[type="checkbox"]'))
    .filter((box) => box.checked).length;

const buttonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

const setFilter = (container: HTMLElement, value: string) =>
  fireEvent.change(filterInput(container), { target: { value } });

const reorderCalls = (calls: InvokeCall[]) => calls.filter(([channel]) => channel === 'playlist:reorderFull');

afterEach(() => {
  cleanup();
  document.querySelectorAll('body > div').forEach((node) => node.remove());
});

describe('filterSongsByQuery 匹配规则（#488）', () => {
  const big = Array.from({ length: 1000 }, (_, i) => ({
    id: `netease:${i}`,
    name: `曲目 ${i}`,
    artist: `歌手 ${i % 7}`,
  }));

  it('1000 首：命中项只包含歌名 / 歌手匹配的行，且保持全量顺序', () => {
    const hits = filterSongsByQuery(big, '曲目 99');
    // 99 / 990..999，且严格按源数组顺序（不排序、不反转）
    expect(hits.map((s) => s.id)).toEqual(
      ['netease:99', 'netease:990', 'netease:991', 'netease:992', 'netease:993', 'netease:994',
        'netease:995', 'netease:996', 'netease:997', 'netease:998', 'netease:999'],
    );

    const byArtist = filterSongsByQuery(big, '歌手 3');
    expect(byArtist).toEqual(big.filter((s) => s.artist.includes('歌手 3')));
    expect(byArtist.every((s) => s.artist.includes('歌手 3') || s.name.includes('歌手 3'))).toBe(true);
  });

  it('大小写不敏感，关键词去首尾空白', () => {
    const list = [
      { id: 'a', name: 'Hello World', artist: 'ABC' },
      { id: 'b', name: '别的', artist: '周杰伦' },
    ];
    expect(filterSongsByQuery(list, '  hello  ').map((s) => s.id)).toEqual(['a']);
    expect(filterSongsByQuery(list, 'abc').map((s) => s.id)).toEqual(['a']);
    expect(filterSongsByQuery(list, 'WORLD').map((s) => s.id)).toEqual(['a']);
    expect(filterSongsByQuery(list, '周杰伦').map((s) => s.id)).toEqual(['b']);
  });

  it('空 / 纯空白关键词原样返回入参（引用不变：非过滤态可见集合 === 全量）', () => {
    expect(filterSongsByQuery(big, '')).toBe(big);
    expect(filterSongsByQuery(big, '   ')).toBe(big);
  });
});

describe('本地歌单页过滤（#488）', () => {
  it('过滤只影响展示集合：清空输入后顺序与过滤前逐项相同', async () => {
    const { container } = renderPage(LIST(40));
    await waitFor(() => expect(rowTexts(container).length).toBe(40));
    const before = rowTexts(container);

    setFilter(container, ONE_HIT);
    await waitFor(() => expect(rowTexts(container).length).toBe(1));
    expect(rowTexts(container)[0]).toContain('曲目 37');
    expect(container.textContent).toContain('1 / 40 首');

    setFilter(container, '');
    await waitFor(() => expect(rowTexts(container).length).toBe(40));
    // 逐项相同：过滤从不重排、不改 order
    expect(rowTexts(container)).toEqual(before);
  });

  it('按歌名与歌手匹配，大小写不敏感', async () => {
    const list = [song(0), song(1), { ...song(2), name: 'Hello World', artist: 'ABC' } as Song];
    const { container } = renderPage(list);
    await waitFor(() => expect(rowTexts(container).length).toBe(3));

    setFilter(container, 'hello');
    await waitFor(() => expect(rowTexts(container).length).toBe(1));
    expect(rowTexts(container)[0]).toContain('Hello World');

    setFilter(container, 'abc');
    await waitFor(() => expect(rowTexts(container).length).toBe(1));
    expect(rowTexts(container)[0]).toContain('Hello World');
  });

  it('过滤态禁用拖拽排序：行不注册 useSortable，拖拽手势也发不出 reorderFull', async () => {
    const { container, calls } = renderPage(LIST(40));
    await waitFor(() => expect(rowTexts(container).length).toBe(40));
    expect(dragHandles(container).length).toBe(40);

    setFilter(container, ONE_HIT);
    await waitFor(() => expect(rowTexts(container).length).toBe(1));
    // 拖拽入口在结构上不存在（useSortable 的把手与 role/aria 一个都没有）
    expect(dragHandles(container).length).toBe(0);
    expect(container.querySelectorAll('[aria-roledescription="draggable"]').length).toBe(0);

    // 即便走一遍拖拽手势：没有 sensor 接在行上，落库通道也一次都不开
    const row = container.querySelector('.song-row') as HTMLElement;
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 30, clientY: 200 });
    fireEvent.pointerUp(row, { clientX: 30, clientY: 200 });
    expect(reorderCalls(calls)).toHaveLength(0);

    // 清空过滤 → 可拖拽的行回来（禁用是过滤态的属性，不是一次性降级）
    setFilter(container, '');
    await waitFor(() => expect(rowTexts(container).length).toBe(40));
    expect(dragHandles(container).length).toBe(40);
    expect(reorderCalls(calls)).toHaveLength(0);
  });

  it('过滤态全选只作用于可见集合，批量下载只见可见集合', async () => {
    const { container, calls } = renderPage(LIST(40));
    await waitFor(() => expect(rowTexts(container).length).toBe(40));

    setFilter(container, ONE_HIT);
    await waitFor(() => expect(rowTexts(container).length).toBe(1));

    fireEvent.click(selectAllCheckbox(container));
    await waitFor(() => expect(container.textContent).toContain('已选择 1 项'));

    fireEvent.click(buttonByText(container, '批量下载'));
    await waitFor(() => {
      const batch = calls.find(([channel]) => channel === 'download:startBatch');
      expect(batch).toBeTruthy();
      expect((batch![1] as Song[]).map((s) => s.id)).toEqual(['netease:37']);
    });
    // 过滤态下批量操作与选择都不触碰全量顺序
    expect(reorderCalls(calls)).toHaveLength(0);
  });

  it('过滤态批量移除只落库可见的已选项，被过滤掉的选中项保留', async () => {
    const { container, calls } = renderPage(LIST(40));
    await waitFor(() => expect(rowTexts(container).length).toBe(40));

    fireEvent.click(selectAllCheckbox(container));
    await waitFor(() => expect(container.textContent).toContain('已选择 40 项'));

    setFilter(container, ONE_HIT);
    await waitFor(() => expect(rowTexts(container).length).toBe(1));
    await waitFor(() => expect(container.textContent).toContain('已选择 1 项'));

    // jsdom 里 antd confirm 的 portal 不落地：直接接管 confirm 并执行 onOk，
    // 验的是 handleBatchDelete 的作用域（可见集合），弹层外壳不是本票主题
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(((config: {
      onOk?: (...args: unknown[]) => unknown;
    }) => {
      void config.onOk?.();
      return { destroy: () => {}, update: () => {} };
    }) as unknown as typeof Modal.confirm);
    try {
      fireEvent.click(buttonByText(container, '批量移除'));
      await waitFor(() => {
        const removed = calls.filter(([channel]) => channel === 'playlist:removeSong');
        expect(removed.map((call) => call[2])).toEqual(['netease:37']);
      });
    } finally {
      confirmSpy.mockRestore();
    }

    // 另外 39 首的选中状态没被这次移除波及（清空过滤后仍然在选）
    setFilter(container, '');
    await waitFor(() => expect(rowTexts(container).length).toBe(40));
    expect(checkedRows(container)).toBe(39);
    expect(reorderCalls(calls)).toHaveLength(0);
  });

  it('过滤框与行容器同父（scrollMargin 不错位，同 #445 口径）', async () => {
    const { container } = renderPage(LIST(10));
    await waitFor(() => expect(rowTexts(container).length).toBe(10));

    const rowsRef = container.querySelector('.song-row')!.parentElement as HTMLElement;
    const wrapper = rowsRef.parentElement as HTMLElement;
    const filterBar = filterInput(container).parentElement as HTMLElement;

    expect(filterBar).not.toBe(wrapper);
    expect(filterBar.parentElement).toBe(wrapper);
    expect(rowsRef.parentElement).toBe(wrapper);
  });

  it('无命中时给出空态，且空集合上全选不会选中任何项', async () => {
    const { container } = renderPage(LIST(10));
    await waitFor(() => expect(rowTexts(container).length).toBe(10));

    setFilter(container, '不存在的歌手');
    await waitFor(() => expect(rowTexts(container).length).toBe(0));
    expect(container.textContent).toContain('没有匹配「不存在的歌手」的歌曲');

    fireEvent.click(selectAllCheckbox(container));
    expect(container.textContent).not.toContain('已选择');
    expect(checkedRows(container)).toBe(0);
  });
});
