import { describe, expect, it } from 'vitest';
import { findScrollParent } from '@/renderer/hooks/useVirtualRows';

/**
 * 滚动祖先探测的契约（#445 / 1.9.0 去内联样式）。
 * 生产页面把 overflow 写在 CSS 文件里，jsdom 读不到 → 只看 getComputedStyle 会让虚拟化
 * 在测试里整段失效、与真实浏览器分叉。所以「哪一个是滚动容器」由结构声明，
 * data-scroll-container 与 computed overflow 任一命中即可。
 */
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
