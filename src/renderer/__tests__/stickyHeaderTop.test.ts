import { describe, expect, it } from 'vitest';
import { stickyTopForContent } from '@/renderer/hooks/useVirtualRows';

/**
 * sticky 表头的偏移口径：贴住**内容区**上边而不是滚动视口上边。
 *
 * 写死 `top: 0` 时，表头会比它该在的位置高出滚动容器的 padding-top，于是浮到内容上方，
 * 列表内容从表头上方那条缝里露出半截（桌面端发现歌单详情页）。这里钉住偏移量与符号。
 */
function fakeEl(paddingTop: string): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'ownerDocument', { value: document });
  el.style.paddingTop = paddingTop;
  return el;
}

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
