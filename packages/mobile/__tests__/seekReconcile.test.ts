import { describe, expect, it } from 'vitest';
import {
  SEEK_SETTLE_TIMEOUT_MS,
  SEEK_SETTLE_TOLERANCE_S,
  acceptsTransportTime,
  beginSeek,
} from '../services/seekReconcile';

/**
 * #423：松手之后的 seek 对账——不这么做，下一个 250ms 心跳会把刚落地的乐观值覆盖回旧位置
 * （表现：松手瞬间进度条跳回去）。规则与桌面 playbackClock.pendingSeek 同构。
 */
describe('seek 对账（松手后不被旧心跳拽回）', () => {
  it('没有 pending 时一律接受传输位置（默认路径零变化）', () => {
    expect(acceptsTransportTime(null, 12.34, 1000)).toBe(true);
  });

  it('seek 已落地（容差内）→ 接受', () => {
    const pending = beginSeek(100, 1_000);
    expect(acceptsTransportTime(pending, 100 + SEEK_SETTLE_TOLERANCE_S, 1_050)).toBe(true);
    expect(acceptsTransportTime(pending, 100 - SEEK_SETTLE_TOLERANCE_S, 1_050)).toBe(true);
  });

  it('seek 还没落地（心跳带回旧位置）→ 丢弃', () => {
    const pending = beginSeek(100, 1_000);
    // 旧位置 5s，差 95s，远超容差且未超时 → 必须丢弃，否则就是"松手回跳"
    expect(acceptsTransportTime(pending, 5, 1_100)).toBe(false);
  });

  it('超时兜底：即使一直追不上也接受真实位置（不把进度条冻死）', () => {
    const pending = beginSeek(100, 1_000);
    expect(acceptsTransportTime(pending, 5, 1_000 + SEEK_SETTLE_TIMEOUT_MS)).toBe(true);
  });

  it('容差边界：刚好超出容差且未超时 → 丢弃', () => {
    const pending = beginSeek(100, 1_000);
    expect(acceptsTransportTime(pending, 100 + SEEK_SETTLE_TOLERANCE_S + 0.01, 1_050)).toBe(false);
  });
});
