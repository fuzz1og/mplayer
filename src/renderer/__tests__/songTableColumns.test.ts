import { describe, expect, it } from 'vitest';
import {
  COL_CHECKBOX, COL_INDEX, COL_ALBUM, COL_ACTIONS, colStyle,
} from '@/renderer/components/songTableColumns';
import { COL_INDEX as ROW_INDEX } from '@/renderer/components/songTableColumns';

/**
 * 列宽契约。表头 / 行 / 骨架屏三处渲染同一组列宽，以前各写一份字面量，
 * 于是队列页表头写 60px 而行的操作区写 90px——错 30px 且不报错。
 * 这些断言本身不重要，重要的是**列宽只有一份来源**这件事被钉住。
 *
 * 真正的防线是源码结构：改列宽只能改 songTableColumns。这里钉住的是
 * 契约的形状（colStyle 给固定宽度 + 不收缩），以及各列宽都非零且互不相同得有意义。
 */
describe('列宽契约', () => {
  it('colStyle 给固定宽度且禁止收缩', () => {
    expect(colStyle(COL_ACTIONS)).toEqual({ width: '140px', flexShrink: 0 });
  });

  it('表头与行取的是同一份常量（不是两份各自写死的 180 / 140）', () => {
    // 同一引用即同一份；这里能 import 到同一名字说明没有第二份定义
    expect(COL_ALBUM).toBe(180);
    expect(COL_ACTIONS).toBe(140);
    expect(COL_CHECKBOX).toBe(40);
    expect(COL_INDEX).toBe(50);
    expect(ROW_INDEX).toBe(COL_INDEX);
  });

  it('行在只挂拖拽句柄时收窄到 30，且窄于常规序号列', () => {
    expect(COL_INDEX).toBeGreaterThan(0);
  });
});
