import { describe, expect, it } from 'vitest';
import { springs, projectMomentum, rubberband } from '../theme/motion';

/** 由 RN 参数反推 Apple 语义参数（ADR-0004 换算恒等式，mass=1）：
 *  ζ = damping / (2√stiffness)，response = 2π/√stiffness */
function dampingRatio(preset: { stiffness: number; damping: number }): number {
  return preset.damping / (2 * Math.sqrt(preset.stiffness));
}
function responseSec(preset: { stiffness: number; damping: number }): number {
  return (2 * Math.PI) / Math.sqrt(preset.stiffness);
}

describe('springs 预设换算恒等式', () => {
  it('uiDefault ≈ ζ1.0 / response 0.4s（临界阻尼）', () => {
    expect(dampingRatio(springs.uiDefault)).toBeCloseTo(1.0, 1);
    expect(responseSec(springs.uiDefault)).toBeCloseTo(0.4, 2);
  });

  it('sheet ≈ ζ0.8 / response 0.3s（欠阻尼，唯一允许过冲）', () => {
    const zeta = dampingRatio(springs.sheet);
    expect(zeta).toBeGreaterThan(0.78);
    expect(zeta).toBeLessThan(0.82);
    expect(responseSec(springs.sheet)).toBeCloseTo(0.3, 2);
  });

  it('pressScale ≈ ζ1.0 / response 0.25s', () => {
    expect(dampingRatio(springs.pressScale)).toBeCloseTo(1.0, 1);
    expect(responseSec(springs.pressScale)).toBeCloseTo(0.25, 2);
  });

  it('只有 sheet 是欠阻尼，其余临界阻尼不产生过冲', () => {
    expect(dampingRatio(springs.sheet)).toBeLessThan(1);
    expect(dampingRatio(springs.uiDefault)).toBeCloseTo(1, 1);
    expect(dampingRatio(springs.pressScale)).toBeCloseTo(1, 1);
  });
});

describe('projectMomentum 动量投影', () => {
  it('零速度投影为零', () => {
    expect(projectMomentum(0)).toBe(0);
  });

  it('Apple 指数衰减公式：500px/s → ≈249.5px', () => {
    // (500/1000) · d/(1−d)，d=0.998 → 0.5·499 = 249.5
    expect(projectMomentum(500)).toBeCloseTo(249.5, 5);
  });

  it('速度越快滑行越远（单调递增）', () => {
    let prev = -Infinity;
    for (const v of [100, 300, 600, 1200, 2400, 4800]) {
      const p = projectMomentum(v);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });

  it('自定义 decelerationRate 生效（0.99 更利落）', () => {
    expect(projectMomentum(1000, 0.99)).toBeCloseTo(99, 5);
    expect(projectMomentum(1000, 0.99)).toBeLessThan(projectMomentum(1000));
  });
});

describe('rubberband 橡皮筋阻力', () => {
  it('零越界为零；正负越界符号保持、幅度对称', () => {
    expect(rubberband(0, 800)).toBe(0);
    expect(rubberband(-50, 800)).toBeLessThan(0);
    expect(Math.abs(rubberband(-50, 800))).toBeCloseTo(rubberband(50, 800), 10);
  });

  it('有阻力：跟随量恒小于线性外推（永远"拉得住"）', () => {
    for (const x of [10, 40, 80, 160]) {
      expect(Math.abs(rubberband(x, 800))).toBeLessThan(x);
    }
  });

  it('渐进阻力：越界越大每像素跟随越少（阻尼递增）', () => {
    const seg1 = rubberband(20, 800) / 20;
    const seg2 = (rubberband(60, 800) - rubberband(20, 800)) / 40;
    const seg3 = (rubberband(140, 800) - rubberband(60, 800)) / 80;
    expect(seg2).toBeLessThan(seg1);
    expect(seg3).toBeLessThan(seg2);
  });

  it('可见维度越小阻力感越强（同越界下跟随更少）', () => {
    expect(rubberband(50, 400)).toBeLessThan(rubberband(50, 800));
  });
});
