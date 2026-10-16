import { describe, expect, it } from 'vitest';
import {
  COL_CHECKBOX, COL_INDEX, COL_INDEX_COMPACT, COL_ALBUM, COL_ACTIONS, colStyle,
} from '@/renderer/components/songTableColumns';

/**
 * 列宽契约。
 * 注意：这里只能钉住**契约的形状**（colStyle 给固定宽度 + 禁止收缩、常量取值）。
 * 别把断言名字写成它证明不了的东西。
 */
describe('列宽契约', () => {
  it('colStyle 给固定宽度且禁止收缩', () => {
    expect(colStyle(COL_ACTIONS)).toEqual({ width: '140px', flexShrink: 0 });
  });

  it('各列宽取值符合当前设计（改这里等于改全站列宽）', () => {
    expect(COL_CHECKBOX).toBe(40);
    expect(COL_INDEX).toBe(50);
    expect(COL_ALBUM).toBe(180);
    expect(COL_ACTIONS).toBe(140);
  });

  it('只挂拖拽句柄时序号列收窄，且窄于常规序号列', () => {
    expect(COL_INDEX_COMPACT).toBe(30);
    expect(COL_INDEX_COMPACT).toBeLessThan(COL_INDEX);
  });
});
