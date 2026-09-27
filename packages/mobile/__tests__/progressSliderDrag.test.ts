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
 * 根因是「受控值由心跳驱动」——`value={currentTime}`（250ms 心跳）在拖动期间每帧把原生
 * SeekBar 的拇指拽回播放位置，真机表现是「只能点一下、按住拖不动圆钮」。
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