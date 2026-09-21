import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  extractAudioDuration,
  hasMpegXingHeader,
  isTrustedHeaderDuration,
} from '../audioDuration.js';

/**
 * 音频头时长取证测试（#361）：字节夹具覆盖 M4A / MP3 / FLAC / Ogg / ADTS
 * 与「都拿不到」的情形，断言解析出的时长与**降级选择**（trusted）。
 *
 * 夹具为 ffmpeg 生成的 5s 静音（`__tests__/fixtures/`），提交进仓库，
 * 测试不依赖本机 ffmpeg。
 */

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/** 模拟「只取了头部 64KB」：截断字节 + 声明完整大小。 */
const headOnly = (full: Uint8Array, headBytes: number): { bytes: Uint8Array; totalBytes: number } => ({
  bytes: full.subarray(0, Math.min(headBytes, full.length)),
  totalBytes: full.length,
});

/** 在真实文件后补零放大：验证「全局头容器部分缓冲仍可信」。 */
const padded = (full: Uint8Array, extra: number): Uint8Array => {
  const out = new Uint8Array(full.length + extra);
  out.set(full);
  return out;
};

describe('extractAudioDuration 格式矩阵', () => {
  it('M4A（moov 全局头）→ 时长精确且可信', async () => {
    const ev = await extractAudioDuration(fixture('sample.m4a'));
    expect(ev).not.toBeNull();
    expect(ev!.container).toMatch(/M4A|isom/i);
    expect(ev!.duration).toBeCloseTo(5, 0);
    expect(ev!.trusted).toBe(true);
    expect(ev!.bitrateKbps).toBeGreaterThan(0);
  });

  it('FLAC（STREAMINFO）→ 时长精确且可信', async () => {
    const ev = await extractAudioDuration(fixture('sample.flac'));
    expect(ev!.container).toMatch(/FLAC/i);
    expect(ev!.duration).toBeCloseTo(5, 1);
    expect(ev!.trusted).toBe(true);
  });

  it('Ogg 整文件 → 时长精确且可信', async () => {
    const full = fixture('sample.ogg');
    const ev = await extractAudioDuration(full, full.length);
    expect(ev!.container).toMatch(/Ogg/i);
    expect(ev!.duration).toBeCloseTo(5, 1);
    expect(ev!.trusted).toBe(true);
  });

  it('Ogg 部分缓冲 → 时长低估且不可信（必须降级 L3，不能拿它误拒）', async () => {
    const full = fixture('sample.ogg');
    const { bytes, totalBytes } = headOnly(full, 4096);
    const ev = await extractAudioDuration(bytes, totalBytes);
    expect(ev!.duration).toBeLessThan(2); // 末页 granule 不在缓冲里
    expect(ev!.trusted).toBe(false);
  });

  it('MP3 整文件（带 Info 头）→ 可信', async () => {
    const full = fixture('sample.mp3');
    expect(hasMpegXingHeader(full)).toBe(true);
    const ev = await extractAudioDuration(full, full.length);
    expect(ev!.container).toMatch(/MPEG/i);
    expect(ev!.duration).toBeCloseTo(5, 0);
    expect(ev!.trusted).toBe(true);
  });

  it('M4A 部分缓冲（全局头在头部）→ 仍可信', async () => {
    const full = fixture('sample.m4a');
    const big = padded(full, 200_000);
    const ev = await extractAudioDuration(big.subarray(0, 65_536), big.length);
    expect(ev!.duration).toBeCloseTo(5, 0);
    expect(ev!.trusted).toBe(true);
  });

  it('ADTS（无全局头）→ 头时长不可信（必须走体积 ÷ 码率）', async () => {
    const ev = await extractAudioDuration(fixture('sample.aac'));
    expect(ev!.container).toMatch(/ADTS/i);
    expect(ev!.trusted).toBe(false);
  });

  it('都拿不到：非音频字节 / 空字节 → null', async () => {
    expect(await extractAudioDuration(new TextEncoder().encode('<html>not audio</html>'))).toBeNull();
    expect(await extractAudioDuration(new Uint8Array(0))).toBeNull();
    expect(await extractAudioDuration(new Uint8Array([0x49, 0x44, 0x33, 0x04]))).toBeNull();
  });
});

describe('isTrustedHeaderDuration 可信性规则', () => {
  it('ADTS 永不可信（即便整文件）', () => {
    expect(isTrustedHeaderDuration('ADTS/MPEG-4', new Uint8Array(10), 10)).toBe(false);
  });

  it('FLAC / MP4 全局头容器恒可信', () => {
    expect(isTrustedHeaderDuration('FLAC', new Uint8Array(4), 1_000_000)).toBe(true);
    expect(isTrustedHeaderDuration('M4A/isom/iso2', new Uint8Array(4), 1_000_000)).toBe(true);
  });

  it('Ogg 仅整文件可信', () => {
    expect(isTrustedHeaderDuration('Ogg', new Uint8Array(100), 100)).toBe(true);
    expect(isTrustedHeaderDuration('Ogg', new Uint8Array(100), 1_000_000)).toBe(false);
  });

  it('MP3：整文件可信；部分缓冲仅带 Xing/Info 时可信', () => {
    const withXing = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x58, 0x69, 0x6e, 0x67]);
    const withoutXing = new Uint8Array(1000);
    expect(isTrustedHeaderDuration('MPEG', new Uint8Array(100), 100)).toBe(true);
    expect(isTrustedHeaderDuration('MPEG', withXing, 1_000_000)).toBe(true);
    expect(isTrustedHeaderDuration('MPEG', withoutXing, 1_000_000)).toBe(false);
  });
});
