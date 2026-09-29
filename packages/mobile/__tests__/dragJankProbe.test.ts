import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  RECENT_DRAG_MS, beginDragProbe, describeDragActivity, endDragProbe, resetDragProbe, sampleDragProbe,
} from '../services/dragJankProbe';
import { useLogsStore } from '../stores/logsStore';

/**
 * 探针的上报策略与活动描述单测。两件事是 A/B 能不能成立的关键：
 *  - 「跟手掉帧一律 warn、干净只在 dev 记 info」——干净手势若一声不吭，
 *    「零 warn」就无法区分「没卡」与「探针没跑」；
 *  - 「现场必须覆盖刚拖过」——帧率告警最早在拖拽结束后 4s 才落盘，
 *    只报瞬时状态的话那行告警永远显示没在拖。
 */

const dragEntries = () => useLogsStore.getState().entries.filter((e) => e.message.includes('[drag]'));

/** 喂一次完整手势：steps 为相邻 move 间隔（ms）。末点之后再 20ms 松手 */
function gesture(steps: number[], startAt = 1000, surface = 'sheet') {
  beginDragProbe(startAt, surface);
  let t = startAt;
  for (const step of steps) {
    t += step;
    sampleDragProbe(t);
  }
  endDragProbe(t + 20);
  return t + 20;
}

const JANKY = [16, 16, 16, 16, 16, 200, 16, 16];
const CLEAN = [16, 16, 16, 16, 16, 16, 16, 16];

beforeEach(() => {
  resetDragProbe();
  useLogsStore.getState().clearLogs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('拖拽跟手探针：上报策略', () => {
  it('跟手掉帧的手势一律 warn（release 构建上也要能拿到）', () => {
    gesture(JANKY);
    const entries = dragEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe('warn');
    expect(entries[0]!.message).toContain('跟手掉帧');
  });

  it('日志带接入点名（两个面混成一个数就没法归因）', () => {
    gesture(JANKY, 1000, 'player');
    expect(dragEntries()[0]!.message).toContain('面板=player');
  });

  it('干净手势在非 dev 环境不记（不刷屏）', () => {
    gesture(CLEAN);
    expect(dragEntries()).toHaveLength(0);
  });

  it('干净手势在 dev 构建记 info（A/B 的「没掉帧」正证据）', () => {
    vi.stubGlobal('__DEV__', true);
    gesture(CLEAN);
    const entries = dragEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe('info');
    expect(entries[0]!.message).toContain('跟手正常');
  });

  it('样本太少的轻点/微拖一声不吭（不给结论，也不冒充正常）', () => {
    vi.stubGlobal('__DEV__', true);
    gesture([16, 16]);
    expect(dragEntries()).toHaveLength(0);
  });

  it('未 begin 的 move/end 被忽略（点在别处不该产生手势结论）', () => {
    sampleDragProbe(1000);
    sampleDragProbe(1016);
    endDragProbe(1032);
    expect(dragEntries()).toHaveLength(0);
    expect(describeDragActivity(1032)).toBe('off');
  });

  it('end 之后再来的 move 不再计入（本会话已收口）', () => {
    gesture(CLEAN);
    const before = dragEntries().length;
    sampleDragProbe(99999);
    endDragProbe(99999);
    expect(dragEntries()).toHaveLength(before);
  });
});

describe('拖拽跟手探针：perf 现场的活动描述', () => {
  it('手势期间为 on，立即收口后是「刚拖过」而非 off', () => {
    beginDragProbe(1000, 'player');
    expect(describeDragActivity(1000)).toBe('on');
    const endAt = gesture(CLEAN, 1000, 'player');
    expect(describeDragActivity(endAt)).toBe('recent-clean');
  });

  it('掉帧手势收口后是 recent-janky（帧率告警晚 4s 落盘也能对上）', () => {
    const endAt = gesture(JANKY);
    expect(describeDragActivity(endAt + 3_000)).toBe('recent-janky');
  });

  it('超出窗口后回到 off（不让一次拖拽永远污染现场）', () => {
    const endAt = gesture(JANKY);
    expect(describeDragActivity(endAt + RECENT_DRAG_MS)).toBe('recent-janky');
    expect(describeDragActivity(endAt + RECENT_DRAG_MS + 1)).toBe('off');
  });

  it('样本不足的手势不留下「刚拖过」（没结论就不该进现场）', () => {
    gesture([16, 16]);
    expect(describeDragActivity(100_000)).toBe('off');
  });

  it('被系统抢走（terminate 走同一个 end）也会收口', () => {
    beginDragProbe(1000, 'sheet');
    for (let i = 1; i <= 8; i++) sampleDragProbe(1000 + i * 16);
    expect(describeDragActivity(1200)).toBe('on');
    endDragProbe(1000 + 9 * 16);
    expect(describeDragActivity(1000 + 9 * 16)).toBe('recent-clean');
  });
});
