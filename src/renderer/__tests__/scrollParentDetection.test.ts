import { describe, expect, it } from 'vitest';
import { findScrollParent } from '@/renderer/hooks/useVirtualRows';

/** 滚动祖先探测契约：data-scroll-container 标记与 computed overflow 任一命中即可。 */
describe('findScrollParent', () => {
  const build = (marker: boolean) => {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    if (marker) outer.setAttribute('data-scroll-container', '');
    outer.appendChild(inner);
    document.body.appendChild(outer);
    return { outer, inner };
  };

  it('认 data-scroll-container 标记（CSS 文件里的 overflow 在 jsdom 读不到）', () => {
    const { outer, inner } = build(true);
    expect(findScrollParent(inner)).toBe(outer);
  });

  it('没有标记时退回 computed overflow（页面写内联样式或真实浏览器）', () => {
    const outer = document.createElement('div');
    outer.style.overflowY = 'auto';
    const inner = document.createElement('div');
    outer.appendChild(inner);
    document.body.appendChild(outer);
    expect(findScrollParent(inner)).toBe(outer);
  });

  it('两样都没有就返回 null（安全退回整表渲染）', () => {
    const { inner } = build(false);
    expect(findScrollParent(inner)).toBeNull();
  });
});
