import { describe, it, expect } from 'vitest';
import { gateDownloadBitrate, estimateBitrateKbps, BITRATE_GATE_OPTIONS } from '../quality.js';

/**
 * T14 下载质量阶梯 + 位率门控（#160）纯函数测试。
 */

describe('gateDownloadBitrate 位率门控', () => {
  it('不限（0）→ 恒通过', () => {
    expect(gateDownloadBitrate(96, 0).allowed).toBe(true);
    expect(gateDownloadBitrate(undefined, 0).allowed).toBe(true);
  });

  it('实际 ≥ 设定 → 通过', () => {
    const r = gateDownloadBitrate(320, 192);
    expect(r).toMatchObject({ allowed: true, actualKbps: 320 });
  });

  it('实际 < 设定 → 拒绝并提示', () => {
    const r = gateDownloadBitrate(128, 320);
    expect(r).toMatchObject({ allowed: false, reason: 'below-gate', actualKbps: 128 });
    expect(r.message).toContain('低于设定');
  });

  it('位率未知 → 通过但标注 unknown（下载后二次校验）', () => {
    const r = gateDownloadBitrate(null, 192);
    expect(r).toMatchObject({ allowed: true, reason: 'unknown', actualKbps: 0 });
  });

  it('档位选项覆盖 不限/128/192/320', () => {
    expect(BITRATE_GATE_OPTIONS.map((o) => o.value)).toEqual([0, 128, 192, 320]);
  });
});

describe('estimateBitrateKbps 下载后反推', () => {
  it('size*8/duration → kbps', () => {
    // 5MB = 41943040 位 / 240s = 174762.6 bit/s ≈ 175 kbps
    expect(estimateBitrateKbps(5 * 1024 * 1024, 240)).toBe(175);
  });

  it('时长缺失 → 0（未知）', () => {
    expect(estimateBitrateKbps(5 * 1024 * 1024, 0)).toBe(0);
  });
});
