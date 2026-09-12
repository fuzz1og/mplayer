import { describe, expect, it } from 'vitest';
import { createSheetExitLatch } from '../services/sheetExit';

/**
 * #308 真机回归：关掉「更多」面板后点下一行的「更多」要点两下。
 * 真因是退场动画期间遮罩仍在接点击、每次点击都重播退场 → Modal 寿命被拉长。
 * 这些用例锁住闩的语义，避免再退化。
 */
describe('createSheetExitLatch 弹层退场闩', () => {
  it('退场中的重复关闭请求被忽略（遮罩在动画期间仍会被点到）', () => {
    const latch = createSheetExitLatch();
    expect(latch.beginClose()).toBe(true);
    expect(latch.isClosing()).toBe(true);
    for (let i = 0; i < 5; i += 1) expect(latch.beginClose()).toBe(false);
  });

  it('面板离屏 + 遮罩淡出两个条件齐了才算结束（先到先记账）', () => {
    const latch = createSheetExitLatch();
    latch.beginClose();
    expect(latch.markPanelOffscreen()).toBe(false);
    expect(latch.markMaskFaded()).toBe(true);
    expect(latch.markMaskFaded()).toBe(false); // 已齐：不重复触发
  });

  it('遮罩先淡出、面板后离屏：后到的信号触发结束', () => {
    const latch = createSheetExitLatch();
    latch.beginClose();
    expect(latch.markMaskFaded()).toBe(false);
    expect(latch.markPanelOffscreen()).toBe(true);
  });

  it('落定幂等：动画回调与离屏监听都触发也只算一次', () => {
    const latch = createSheetExitLatch();
    latch.beginClose();
    expect(latch.settle()).toBe(true);
    expect(latch.settle()).toBe(false);
  });

  it('未开闸时的结束信号不会误判为就绪', () => {
    const latch = createSheetExitLatch();
    expect(latch.markPanelOffscreen()).toBe(false);
    expect(latch.markMaskFaded()).toBe(false);
  });

  it('reopen 复位：下一轮开合能重新关闭', () => {
    const latch = createSheetExitLatch();
    latch.beginClose();
    latch.settle();
    latch.reopen();
    expect(latch.isClosing()).toBe(false);
    expect(latch.beginClose()).toBe(true);
  });

  it('一轮的条件状态不泄漏到下一轮', () => {
    const latch = createSheetExitLatch();
    latch.beginClose();
    latch.markPanelOffscreen();
    latch.markMaskFaded();
    latch.settle();
    latch.reopen();
    latch.beginClose();
    expect(latch.markPanelOffscreen()).toBe(false); // 需要本轮新的遮罩淡出信号
    expect(latch.markMaskFaded()).toBe(true);
  });
});
