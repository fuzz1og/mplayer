import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stickyTopForContent } from '@/renderer/hooks/useVirtualRows';
import SongList from '@/renderer/components/SongList';
import type { Song } from '@mplayer/core';

/**
 * sticky 表头的偏移口径：贴住**内容区**上边而不是滚动视口上边。
 *
 * 写死 top: 0 时，表头会比它该在的位置高出滚动容器的 padding-top，于是浮到内容上方，
 * 列表内容从表头上方那条缝里露出半截（#564，桌面端发现歌单详情页）。
 *
 * 两组断言：
 *  1) 偏移量本身（纯函数）；
 *  2) **真实列表在带内边距的滚动容器里**渲染出来的表头偏移——这才是 issue 里量的那个量
 *     （headerTop − scrollportTop = 24）。只测常量抓不到「短列表不虚拟化就探测不到容器」这档漏网。
 */
function fakeEl(paddingTop: string): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'ownerDocument', { value: document });
  el.style.paddingTop = paddingTop;
  return el;
}

function song(i: number): Song {
  return {
    id: 'netease:' + i, name: '曲目 ' + i, artist: '歌手', album: '专辑',
    duration: 200, sourceType: 'netease', url: '', cover: '', lrc: '',
  } as Song;
}

async function renderInPaddedScroller(count: number) {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  scroller.style.padding = '24px';
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(scroller, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: 900, configurable: true });
  Object.defineProperty(scroller, 'offsetWidth', { value: 900, configurable: true });
  document.body.appendChild(scroller);

  render(
    <MemoryRouter>
      <SongList
        songs={Array.from({ length: count }, (_, i) => song(i))}
        onPlay={() => {}}
        showIndex
      />
    </MemoryRouter>,
    { container: scroller },
  );
  await waitFor(() => expect(scroller.querySelector('.song-row')).toBeTruthy());

  // 选「真的是 sticky 的那个元素」，而不是按文本——文本选择器会命中包裹层。
  const header = Array.from(scroller.querySelectorAll('div')).find(
    (d) => getComputedStyle(d).position === 'sticky',
  ) as HTMLElement;
  return { scroller, header };
}

afterEach(() => cleanup());

describe('stickyTopForContent', () => {
  it('把表头压回内容区上边：偏移是负的 padding-top', () => {
    expect(stickyTopForContent(fakeEl('24px'))).toBe(-24);
  });

  it('容器没有内边距时为 0（绝大多数页面：行为与 top:0 一致）', () => {
    expect(stickyTopForContent(fakeEl('0px'))).toBe(0);
  });

  it('还没探测到滚动容器时为 0（首帧不留偏移）', () => {
    expect(stickyTopForContent(null)).toBe(0);
  });
});

describe('带内边距的滚动容器里的表头偏移（#564 的真实量）', () => {
  it('长列表（≥30 首，走虚拟化）：表头贴住内容区，不再浮高一个 padding', async () => {
    const { header } = await renderInPaddedScroller(45);
    expect(header).toBeTruthy();
    expect(getComputedStyle(header).position).toBe('sticky');
    expect(header.style.top).toBe('-24px');
  });

  it('短列表（<30 首，不虚拟化）：照样贴住内容区', async () => {
    const { header } = await renderInPaddedScroller(12);
    expect(header).toBeTruthy();
    expect(header.style.top).toBe('-24px');
  });
});
