import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 读仓库内源文件（vitest root = packages/mobile），与 loadingSkeletonParity 同款 */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * #423 守卫：进度条的受控 `value` 在拖动期间必须被冻结。
 *
 * 归因修正（源码核对后）：Android 的 @react-native-community/slider 5.2.0 **已有**拖动期守卫
 * （`ReactSliderManagerImpl.setValue` 里 `if (view.isSliding() == false)`），所以「拖动中被
 * 心跳改写拇指」在 Android 上不成立；拖动不动的**主因是横向分页 ScrollView 的拦截**（见下方守卫二）。
 * 这里仍保留三段式 + 本地拖动值，理由是：iOS 实现不同、新架构出现过 controlledValue 回归
 * （callstack/react-native-slider#667），而且我们要「读数跟手」。
 * 这条规则没有可渲染的组件测试（移动端不引 RN testing-library），故按本仓既有做法
 * 用源码级守卫钉住：谁把 `value` 改回裸 `currentTime`，测试就红。
 */
describe('进度条拖动：受控值在拖动期间冻结（#423）', () => {
  const src = stripComments(read('components/PlayerOverlay.tsx'));

  it('value 由拖动状态决定，不是裸的 currentTime', () => {
    expect(src).toContain('value={dragFrom === null ? currentTime : dragFrom}');
    expect(src).not.toContain('value={currentTime}');
  });

  it('三种滑动手势回调都接了（start / change / complete）', () => {
    expect(src).toContain('onSlidingStart');
    expect(src).toContain('onValueChange');
    expect(src).toContain('onSlidingComplete');
  });

  it('只有松手才写 store + seekTo', () => {
    const block = src.slice(src.indexOf('onSlidingComplete'));
    expect(block).toContain('setCurrentTime(t)');
    expect(block).toContain('seekTo(t)');
  });

  it('时间标签跟手但走独立状态（不回写受控 value）', () => {
    expect(src).toContain('{formatTime(shownTime)}');
    expect(src).toContain('setDragTime(t)');
  });
});

/**
 * #423 守卫二：**横向分页 ScrollView 不能在拖动中拦截滑块**。
 *
 * Android 上 `AbsSeekBar` 在滚动容器里要越过自己的 slop 才 startDrag，而 ViewGroup 的
 * `onInterceptTouchEvent` 先于子 View 拿到同一个 MOVE——分页 ScrollView 在同一个 slop 上
 * 先拦截，子级收 ACTION_CANCEL，滑块永远没 startDrag（RN #32103，库侧没有
 * requestDisallowInterceptTouchEvent）。修法 = 按下即把分页 `scrollEnabled` 置 false
 * （RN 的 ReactHorizontalScrollView.onInterceptTouchEvent 首行判它）。
 */
describe('进度条拖动：分页 ScrollView 不参与拦截（#423）', () => {
  const src = stripComments(read('components/PlayerOverlay.tsx'));

  it('pager 的滚动由状态控着，且能从进度行按下时关掉', () => {
    expect(src).toContain('scrollEnabled={pagerScrollEnabled}');
    expect(src).toContain('onStartShouldSetResponderCapture={() => { holdPagerScroll(); return false; }}');
  });

  it('滑动结束会恢复分页滚动（并有兜底定时器，点按也能恢复）', () => {
    expect(src).toContain('onScrubEnd={releasePagerScroll}');
    expect(src).toContain('setTimeout(() => { pagerHoldTimer.current = null; setPagerScrollEnabled(true); }, 4000)');
  });

  it('capture 观察者不抢 responder（返回 false，滑块手感不受影响）', () => {
    expect(src).not.toMatch(/onStartShouldSetResponderCapture=\{\(\) => \{\s*holdPagerScroll\(\);\s*return true/);
  });
});
