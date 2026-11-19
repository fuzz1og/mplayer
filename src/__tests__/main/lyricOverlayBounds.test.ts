import { describe, expect, it } from 'vitest';
import {
  clampBoundsToWorkArea,
  defaultBoundsForDisplay,
  displayContainingBounds,
  resolveBounds,
  sanitizeStoredBounds,
} from '@/main/lyricOverlay/overlayBounds';

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const SIZE = { width: 520, height: 112 };

describe('悬浮歌词位置计算（#765 / #769）', () => {
  it('默认位 = workArea 底部居中（含 24px 底边距）', () => {
    expect(defaultBoundsForDisplay(WORK_AREA, SIZE)).toEqual({
      x: 700,
      y: 1040 - 112 - 24,
      width: 520,
      height: 112,
    });
  });

  it('恢复用记录左上角 + 当前档位尺寸，再夹进 workArea', () => {
    expect(resolveBounds({ x: 100, y: 200, width: 1, height: 1 }, WORK_AREA, { width: 640, height: 112 }))
      .toEqual({ x: 100, y: 200, width: 640, height: 112 });
    expect(resolveBounds({ x: 5000, y: 5000, width: 520, height: 112 }, WORK_AREA, SIZE))
      .toEqual({ x: 1400, y: 928, width: 520, height: 112 });
    expect(resolveBounds({ x: -50, y: -50, width: 520, height: 112 }, WORK_AREA, SIZE))
      .toEqual({ x: 0, y: 0, width: 520, height: 112 });
  });

  it('workArea 比条高 + 底边距还矮时夹到 workArea（高度不越界、纵坐标不越顶）', () => {
    const short = { x: 0, y: 0, width: 400, height: 100 };
    expect(defaultBoundsForDisplay(short, SIZE)).toEqual({ x: 0, y: 0, width: 400, height: 100 });
  });

  it('无记录 = 默认位', () => {
    expect(resolveBounds(undefined, WORK_AREA, SIZE)).toEqual(defaultBoundsForDisplay(WORK_AREA, SIZE));
  });

  it('夹紧时窗口比 workArea 还大也不出界', () => {
    const clamped = clampBoundsToWorkArea({ x: 10, y: 10, width: 4000, height: 2000 }, WORK_AREA);
    expect(clamped).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  it('按窗口中心判所在显示器，中心落空则按相交，再兜底主屏', () => {
    const left = { id: 1, workArea: WORK_AREA } as Electron.Display;
    const right = {
      id: 2,
      workArea: { x: 1920, y: 0, width: 1280, height: 1024 },
    } as Electron.Display;
    expect(displayContainingBounds({ x: 100, y: 100, width: 520, height: 112 }, [left, right], left).id).toBe(1);
    expect(displayContainingBounds({ x: 2500, y: 100, width: 520, height: 112 }, [left, right], left).id).toBe(2);
    expect(displayContainingBounds({ x: 9000, y: 9000, width: 520, height: 112 }, [left, right], left).id).toBe(1);
  });

  it('坏存档只保留四个有限数字的记录', () => {
    expect(sanitizeStoredBounds(null)).toEqual({});
    expect(sanitizeStoredBounds({
      '1': { x: 1, y: 2, width: 520, height: 112 },
      '2': { x: 'bad', y: 2, width: 520, height: 112 },
      '3': { x: 1, y: 2 },
    })).toEqual({ '1': { x: 1, y: 2, width: 520, height: 112 } });
  });
});
