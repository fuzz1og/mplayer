import { describe, expect, it } from 'vitest';
import { handlePanelLayout } from '../components/panelHeight';
import type { PanelLayoutEvent } from '../components/panelHeight';

/** 假 setState：只把 updater 存下来，稍后才执行——复刻 React 的延迟执行时机 */
function deferredState() {
  let pending: ((prev: number) => number) | null = null;
  return {
    set: (updater: (prev: number) => number) => { pending = updater; },
    run: (prev: number) => {
      if (!pending) throw new Error('updater 未提交到 state');
      return pending(prev);
    },
  };
}

const layoutEvent = (height: number): PanelLayoutEvent => ({ nativeEvent: { layout: { height } } });

describe('handlePanelLayout：面板高度量取（onLayout）', () => {
  it('同步读出高度并回写（首帧之前是 winH 兜底）', () => {
    const s = deferredState();
    handlePanelLayout(s.set, layoutEvent(700));
    expect(s.run(3840)).toBe(700);
  });

  it('同值回写返回原引用（React 对相同值 bail out）', () => {
    const s = deferredState();
    handlePanelLayout(s.set, layoutEvent(700));
    expect(s.run(700)).toBe(700);
  });

  it('亚像素抖动（<1px）保留旧值，避免无谓重渲染', () => {
    const a = deferredState();
    handlePanelLayout(a.set, layoutEvent(700.4));
    expect(a.run(700)).toBe(700);

    const b = deferredState();
    handlePanelLayout(b.set, layoutEvent(701.5));
    expect(b.run(700)).toBe(701.5);
  });

  it('事件被回收后 updater 仍安全——真机 Render Error 回归护栏', () => {
    const s = deferredState();
    const event = layoutEvent(700);
    handlePanelLayout(s.set, event); // handler 同步执行（真机上就是这一帧读到高度）
    Object.assign(event, { nativeEvent: null }); // React 回收事件对象

    // 旧实现把 e.nativeEvent.layout.height 写在 updater 内：
    // 这一行就是真机上的 TypeError: Cannot read property 'layout' of null（打开即白屏）
    expect(() => s.run(3840)).not.toThrow();
    expect(s.run(3840)).toBe(700);
  });
});
