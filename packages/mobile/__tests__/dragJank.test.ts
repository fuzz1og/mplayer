import { describe, expect, it } from 'vitest';
import {
  FRAME_BUDGET_MS, JANK_DROP_RATIO, JANK_MAX_GAP_MS, MAX_SAMPLES, MIN_INTERVALS_FOR_VERDICT,
  createDragJankMeter, formatDragJank, isJanky,
} from '../gestures/dragJank';

/** 用等间隔（16ms ≈ 60Hz）喂 n 个 move 观测点，末点之后按 tailMs 松手 */
function steadyDrag(n: number, step = 16) {
  const m = createDragJankMeter();
  m.start();
  for (let i = 0; i < n; i++) m.sample(i * step);
  return { m, lastAt: (n - 1) * step };
}

describe('拖拽跟手统计：采样与间隔', () => {
  it('认领 → 首个 move 的耗时不算跟手间隔（否则每次手势都伪造一个长间隔）', () => {
    const m = createDragJankMeter();
    m.start();
    const t0 = 5000; // 认领后 5s 才收到第一个 move
    for (let i = 0; i < 7; i++) m.sample(t0 + i * 16);
    const r = m.finish(t0 + 6 * 16)!;
    expect(r.samples).toBe(7);
    expect(r.intervals).toBe(6);
    expect(r.spanMs).toBe(96); // 不含 start → 首个 move 的那 5000ms
    expect(r.maxGapMs).toBe(16);
  });

  it('间隔数不足最小样本数时不给结论（null，而不是「正常」）', () => {
    const { m, lastAt } = steadyDrag(MIN_INTERVALS_FOR_VERDICT - 1 + 1, 16); // 间隔数 = MIN-1
    expect(m.finish(lastAt)).toBeNull();
  });

  it('恰好达到最小间隔数即给结论', () => {
    const { m, lastAt } = steadyDrag(MIN_INTERVALS_FOR_VERDICT + 1, 16);
    expect(m.finish(lastAt)).not.toBeNull();
  });

  it('未 start 就 finish 不给结论', () => {
    const m = createDragJankMeter();
    expect(m.finish(100)).toBeNull();
  });

  it('start 清空上一次手势的状态（会话跨手势复用）', () => {
    const m = createDragJankMeter();
    m.start();
    for (let i = 0; i < 10; i++) m.sample(i * 16);
    expect(m.finish(160)).not.toBeNull();
    m.start();
    expect(m.finish(0)).toBeNull(); // 上一轮的 10 个样本不再参与
  });

  it('时间戳回退（负间隔）被丢弃，不污染分位数', () => {
    const m = createDragJankMeter();
    m.start();
    m.sample(1000);
    m.sample(900); // 回拨：丢弃
    for (let i = 1; i <= 6; i++) m.sample(1000 + i * 16);
    const r = m.finish(1000 + 6 * 16)!;
    expect(r.intervals).toBe(6);
    expect(r.maxGapMs).toBe(16);
    expect(r.p50Ms).toBeGreaterThan(0);
  });

  it('同一毫秒内的合并回调（间隔 0）如实保留', () => {
    const m = createDragJankMeter();
    m.start();
    for (let i = 0; i < 8; i++) m.sample(1000);
    const r = m.finish(1000)!;
    expect(r.intervals).toBe(7);
    expect(r.maxGapMs).toBe(0);
  });

  it('采样数量有上限，但首末观测点仍如实推进（截断的是间隔统计，不是时长）', () => {
    const m = createDragJankMeter();
    m.start();
    const n = MAX_SAMPLES + 50;
    for (let i = 0; i < n; i++) m.sample(i * 16);
    const r = m.finish(n * 16)!;
    expect(r.samples).toBe(MAX_SAMPLES);
    expect(r.intervals).toBe(MAX_SAMPLES - 1);
    expect(r.spanMs).toBe((n - 1) * 16); // 时长覆盖整段，不因上限缩水
    expect(r.tailMs).toBe(16);
  });

  it('尾距（末个 move → 松手）单独记，不计入间隔统计', () => {
    const { m, lastAt } = steadyDrag(20, 16);
    const r = m.finish(lastAt + 250)!; // 拖到位后停顿 250ms 再抬手
    expect(r.tailMs).toBe(250);
    expect(r.maxGapMs).toBe(16); // 停顿不污染 max
    expect(isJanky(r)).toBe(false); // 也不该因此判掉帧
  });
});

describe('拖拽跟手统计：判语', () => {
  it('均匀 16ms 间隔 → 跟手正常', () => {
    const { m, lastAt } = steadyDrag(30, 16);
    const r = m.finish(lastAt)!;
    expect(r.overBudget).toBe(0);
    expect(isJanky(r)).toBe(false);
    expect(formatDragJank(r)).toContain('跟手正常');
  });

  it('单次长间隔（JS 卡一下）即判掉帧，即使其余全正常', () => {
    const m = createDragJankMeter();
    m.start();
    let t = 0;
    for (let i = 0; i < 10; i++) { t += 16; m.sample(t); }
    t += JANK_MAX_GAP_MS; m.sample(t); // 卡这一下
    for (let i = 0; i < 10; i++) { t += 16; m.sample(t); }
    const r = m.finish(t)!;
    expect(r.maxGapMs).toBe(JANK_MAX_GAP_MS);
    expect(r.overBudget).toBe(1);
    expect(isJanky(r)).toBe(true);
    expect(formatDragJank(r)).toContain('跟手掉帧');
  });

  it('超预算占多数但单次都不长 → 也判掉帧（持续性迟滞）', () => {
    const { m, lastAt } = steadyDrag(30, Math.ceil(FRAME_BUDGET_MS) + 5); // 每个间隔都超一帧预算
    const r = m.finish(lastAt)!;
    expect(r.maxGapMs).toBeLessThan(JANK_MAX_GAP_MS);
    expect(r.overBudget / r.intervals).toBeGreaterThanOrEqual(JANK_DROP_RATIO);
    expect(isJanky(r)).toBe(true);
  });

  it('超预算占比恰在阈值之下 → 不判掉帧', () => {
    const m = createDragJankMeter();
    m.start();
    let t = 0;
    // 19 个间隔里 3 个超预算（15.8% < 20%），且每个都短于单次阈值
    // （首个 sample 不产生间隔，故 i < 4 只落出 3 个 20ms 间隔）
    for (let i = 0; i < 20; i++) { t += i < 4 ? 20 : 10; m.sample(t); }
    const r = m.finish(t + 30)!;
    expect(r.intervals).toBe(19);
    expect(r.overBudget).toBe(3);
    expect(r.overBudget / r.intervals).toBeLessThan(JANK_DROP_RATIO);
    expect(isJanky(r)).toBe(false);
  });

  it('现场字符串一行、带接入点名、含全部关键量（logcat 按消息本体断言）', () => {
    const { m, lastAt } = steadyDrag(12, 16);
    const line = formatDragJank(m.finish(lastAt)!, 'sheet');
    expect(line.startsWith('[drag] ')).toBe(true);
    expect(line).toContain('面板=sheet');
    expect(line).not.toContain('\n');
    expect(line).toContain('样本=12');
    expect(line).toContain('p50=');
    expect(line).toContain('p95=');
    expect(line).toContain('max=');
    expect(line).toContain('超帧=');
    expect(line).toContain('尾距=');
  });

  it('不传接入点名时退化为 unknown（不假装知道是哪个面）', () => {
    const { m, lastAt } = steadyDrag(12, 16);
    expect(formatDragJank(m.finish(lastAt)!)).toContain('面板=unknown');
  });
});
