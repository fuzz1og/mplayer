import { describe, expect, it } from 'vitest';
import { createDragSession } from '../gestures/dragSession';
import { DISMISS_PROJECT_RATIO } from '../theme/motion';

const SIZE = 800;
const SLOW = 500; // dt ≥ 100ms：速度样本被丢弃，落点即为位置本身，便于测阈值边界

/** 慢拖到某个位置（速度样本全部因 dt 越界丢弃 → 松手速度 0） */
function slowDragTo(target: number) {
  const s = createDragSession();
  s.grab();
  s.calibrate(0);
  s.move({ dy: 0, timestamp: 0, panelSize: SIZE }); // 校准基准帧（首帧无速度样本）
  s.move({ dy: target, timestamp: SLOW, panelSize: SIZE });
  return s;
}

describe('拖拽会话：抓取 / 校准（Fabric 异步回路）', () => {
  it('中途抓住进行中的动画：从呈现值接续，不回到 0 也不跳变', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(120); // 入场/退场动画当前呈现到 120px
    expect(s.move({ dy: 400, timestamp: 1000, panelSize: SIZE })).toBe(120);
    expect(s.move({ dy: 500, timestamp: 1016, panelSize: SIZE })).toBe(220);
  });

  it('基准未就绪（stopAnimation 回调未回）的 move 被丢弃，就绪后从首个 move 校准原点', () => {
    const s = createDragSession();
    s.grab();
    expect(s.move({ dy: 50, timestamp: 1000, panelSize: SIZE })).toBeNull();
    s.calibrate(0);
    expect(s.move({ dy: 50, timestamp: 1016, panelSize: SIZE })).toBe(0);
  });

  it('首帧校准：认领前累计的位移不参与跟手（防瞬移）', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    expect(s.move({ dy: 30, timestamp: 1000, panelSize: SIZE })).toBe(0);
    expect(s.move({ dy: 60, timestamp: 1016, panelSize: SIZE })).toBe(30);
  });
});

describe('拖拽会话：跟手位移与橡皮筋', () => {
  it('下拉 1:1 跟手（越界到面板之外也不设限）', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 0, panelSize: SIZE });
    expect(s.move({ dy: 900, timestamp: SLOW, panelSize: SIZE })).toBe(900);
  });

  it('上推越界走橡皮筋：跟随量小于线性外推，且维度越小阻力越强', () => {
    const at = (panelSize: number) => {
      const s = createDragSession();
      s.grab();
      s.calibrate(0);
      s.move({ dy: 0, timestamp: 0, panelSize });
      return s.move({ dy: -100, timestamp: SLOW, panelSize })!;
    };
    expect(at(SIZE)).toBeLessThan(0);
    expect(Math.abs(at(SIZE))).toBeLessThan(100);
    expect(Math.abs(at(400))).toBeLessThan(Math.abs(at(SIZE)));
  });
});

describe('拖拽会话：自采样速度（EMA + 钳幅）', () => {
  it('首个速度样本直接播种，不与 0 做 EMA（否则起步半速）', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, panelSize: SIZE });
    s.move({ dy: 40, timestamp: 1016, panelSize: SIZE }); // 40px/16ms = 2500px/s
    expect(s.release(SIZE).velocity).toBe(2500);
  });

  it('后续样本按 0.6/0.4 平滑（速度衰减不突跳）', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, panelSize: SIZE });
    s.move({ dy: 40, timestamp: 1016, panelSize: SIZE }); // 播种 2500
    s.move({ dy: 40, timestamp: 1032, panelSize: SIZE }); // 瞬时 0 → 2500×0.6 = 1500
    s.move({ dy: 40, timestamp: 1048, panelSize: SIZE }); // → 1500×0.6 = 900
    expect(s.release(SIZE).velocity).toBe(900);
  });

  it('瞬时速度钳到 ±4000：否则一帧大跳会把天文速度灌给弹簧', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, panelSize: SIZE });
    s.move({ dy: 200, timestamp: 1010, panelSize: SIZE }); // 200px/10ms = 20000 → 钳 4000
    s.move({ dy: 200, timestamp: 1026, panelSize: SIZE }); // 瞬时 0 → 4000×0.6 = 2400（未钳则 14400）
    expect(s.release(SIZE).velocity).toBe(2400);
  });

  it('dt<4ms 视为时间戳抖动：该样本丢弃，不污染速度估计', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, panelSize: SIZE });
    s.move({ dy: 40, timestamp: 1002, panelSize: SIZE }); // dt=2ms → 丢弃速度，位置照常跟手
    expect(s.release(SIZE)).toEqual({ dismiss: false, velocity: 0 });
  });

  it('dt≥100ms 说明中间断了帧：该样本丢弃', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, panelSize: SIZE });
    s.move({ dy: 40, timestamp: 1200, panelSize: SIZE }); // dt=200ms → 丢弃
    expect(s.release(SIZE).velocity).toBe(0);
  });
});

describe('拖拽会话：松手判决（动量投影 vs 面板比例）', () => {
  const threshold = SIZE * DISMISS_PROJECT_RATIO;

  it('阈值取自 motion 的 DISMISS_PROJECT_RATIO（唯一事实源，不是本地魔数）', () => {
    expect(slowDragTo(threshold - 1).release(SIZE)).toEqual({ dismiss: false, velocity: 0 });
    expect(slowDragTo(threshold).release(SIZE)).toEqual({ dismiss: true, velocity: 0 });
  });

  it('快甩：位移很小但速度够，投影落点照样越过阈值 → 判关', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, panelSize: SIZE });
    s.move({ dy: 100, timestamp: 1016, panelSize: SIZE }); // 高速（钳 4000 → 松手钳 3000）
    const verdict = s.release(SIZE);
    expect(verdict.dismiss).toBe(true);
    expect(verdict.velocity).toBe(3000);
    expect(100 + (verdict.velocity / 1000) * 499).toBeGreaterThanOrEqual(threshold);
  });

  it('慢拖半途：速度可忽略时落点即位置，回弹由调用点做弹簧', () => {
    const s = slowDragTo(threshold - 1);
    expect(s.release(SIZE).dismiss).toBe(false);
  });

  it('面板尺寸现取：同一手势在更矮的面板上更容易判关', () => {
    const s = slowDragTo(300);
    expect(s.release(1024).dismiss).toBe(false); // 1024 × 0.35 = 358 > 300
    expect(s.release(800).dismiss).toBe(true);   // 800 × 0.35 = 280 ≤ 300
  });
});

describe('拖拽会话：terminate 与跨会话无残留', () => {
  it('terminate（系统抢走手势）零速回弹，不继承速度也不判关', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, panelSize: SIZE });
    s.move({ dy: 600, timestamp: 1016, panelSize: SIZE }); // 高速下拉中
    expect(s.terminate()).toEqual({ dismiss: false, velocity: 0 });
  });

  it('抓取后一帧 move 都没收到就松手：绝不判关（不拿上一次手势的残留落点）', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(700); // 抓住正在退场的面板
    expect(s.release(SIZE)).toEqual({ dismiss: false, velocity: 0 });
  });

  it('跨会话无残留：上一次手势的落点不污染下一次', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, panelSize: SIZE });
    s.move({ dy: 600, timestamp: 1016, panelSize: SIZE });
    expect(s.release(SIZE).dismiss).toBe(true);

    // 第二次手势只在顶部轻轻下压一帧就松手：旧实现读上一次的 lastY=600 → 误判关闭
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 2000, panelSize: SIZE });
    expect(s.release(SIZE)).toEqual({ dismiss: false, velocity: 0 });
  });
});
