import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Song } from '@mplayer/core';
import PlaylistDetailPage from '@/renderer/pages/PlaylistDetailPage';
import { useVirtualRows } from '@/renderer/hooks/useVirtualRows';

/** 本地歌单页接入窗口化排序列表（#445）的结构不变量与 scrollMargin 症状级单测。 */

function song(i: number): Song {
  return {
    id: `netease:${i}`,
    name: `歌曲 ${i}`,
    artist: `歌手 ${i}`,
    album: '',
    url: '',
    cover: 'https://cdn.example.com/cover.jpg',
    lrc: '',
    duration: 200,
    sourceType: 'netease',
  } as Song;
}

function renderPage(count: number) {
  const songs = Array.from({ length: count }, (_, i) => song(i));
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
  return { ...view, songs };
}

afterEach(() => {
  cleanup();
  document.querySelectorAll('body > div').forEach((node) => node.remove());
});

describe('PlaylistDetailPage 窗口化（#445）', () => {
  it('提示条 + 批量栏 + 表头 + 行容器同父：勾选后 rowsRef.parentElement 不变', async () => {
    const { container } = renderPage(10);
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBe(10));

    // < 30 首时走 plain 模式：行直接挂在 rowsRef 下，无需布局引擎
    const rowsRef = container.querySelectorAll('.song-row')[0].parentElement as HTMLElement;
    const wrapper = rowsRef.parentElement as HTMLElement;
    expect(rowsRef).not.toBe(wrapper);

    // 表头不一定是第一个子节点（#488 在列表上方加了过滤框），按内容定位
    const tableHeader = Array.from(wrapper.children).find((child) => child.textContent?.includes('标题')) as HTMLElement;
    expect(tableHeader).toBeTruthy();
    expect(tableHeader.parentElement).toBe(wrapper);
    expect(rowsRef.parentElement).toBe(wrapper);

    // 勾选一首歌 → 批量栏出现；它必须仍在同一个 wrapper 内，否则 scrollMargin 会停在旧值
    const firstCheckbox = container.querySelectorAll('.song-row input[type="checkbox"]')[0] as HTMLInputElement;
    fireEvent.click(firstCheckbox);
    await waitFor(() => expect(wrapper.textContent).toContain('已选择 1 项'));

    expect(rowsRef.parentElement).toBe(wrapper);
    const batchBar = Array.from(wrapper.children).find((child) => child.textContent?.includes('已选择'));
    expect(batchBar).toBeTruthy();
    expect(batchBar!.parentElement).toBe(wrapper);
    // 行容器没有被批量栏挤到别的父节点下
    expect((container.querySelector('.song-row') as HTMLElement).parentElement).toBe(rowsRef);
  });
});

/** jsdom 没有布局：给滚动容器造一个 900x600 的视口（同 virtualSortableList.test.tsx 口径） */
function mountScrollContainer(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 900, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(el, 'offsetWidth', { value: 900, configurable: true });
  el.getBoundingClientRect = rectWithTop(0);
  document.body.appendChild(el);
  return el;
}

function rectWithTop(top: number) {
  return () => ({
    width: 900, height: 600, top, left: 0, right: 900, bottom: top + 600, x: 0, y: top,
    toJSON: () => ({}),
  }) as DOMRect;
}

/**
 * 直接暴露 useVirtualRows 的两个输出：scrollMargin（测量的结果）与行的 translateY（同 VirtualRow 的算法）。
 * 用它把「list 上方内容变高 → 重新测量」这件事钉成症状级断言。
 */
function MarginProbe({ count }: { count: number }) {
  const virtual = useVirtualRows({ count, enabled: true, estimateSize: () => 64 });
  return (
    <div>
      <div data-testid="scroll-margin">{virtual.scrollMargin}</div>
      <div ref={virtual.rowsRef}>
        {virtual.items.map((row) => (
          <div
            key={row.key}
            data-testid={`probe-row-${row.index}`}
            style={{ transform: `translateY(${row.start - virtual.scrollMargin}px)` }}
          />
        ))}
      </div>
    </div>
  );
}

describe('useVirtualRows 症状级：list 上方内容变高（#445）', () => {
  it('父节点 top 0 → 56 后 resize 会重测 scrollMargin（0 → 56）', async () => {
    const scrollEl = mountScrollContainer();
    const { container } = render(<MarginProbe count={200} />, { container: scrollEl });

    await waitFor(() => expect(container.querySelector('[data-testid="probe-row-0"]')).toBeTruthy());
    const probeRoot = container.firstElementChild as HTMLElement;
    const rowsRef = probeRoot.lastElementChild as HTMLElement;
    const margin = () => container.querySelector('[data-testid="scroll-margin"]')!.textContent;
    const firstShell = () => container.querySelector('[data-testid="probe-row-0"]') as HTMLElement;

    expect(margin()).toBe('0');
    expect(firstShell().style.transform).toBe('translateY(0px)');

    // 模拟「提示条 + 批量栏」展开：rowsRef 相对滚动容器顶部下移 56px
    rowsRef.getBoundingClientRect = rectWithTop(56);
    act(() => { window.dispatchEvent(new Event('resize')); });

    await waitFor(() => expect(margin()).toBe('56'));

    // ⚠️ 与 #445 票面原文不同：首行 transform **不会**变成 translateY(-56px)。
    // @tanstack/virtual-core 的 measurement.start 已经含 scrollMargin（3.17.11 实测），
    // VirtualRow 再减一次 → transform = translateY(index * size)，与 scrollMargin 无关。
    // 票面写的 translateY(-56px) 反而是「measurement 未重算却重复扣减」的错误渲染；
    // stale scrollMargin 真正影响的只是挂载窗口（calculateRange），而 overscan=8 会吸收它。
    expect(firstShell().style.transform).toBe('translateY(0px)');
  });
});
