import { describe, it, expect, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import type { TransportResponse } from '../../api/transport.js';
import { validateDirectUrlNonFull } from '../directValidation.js';

/**
 * 直连腿播放时时长取证（#392）。
 * 接缝：注入传输（Transport）与头解析（extract）——只断言**外部行为**：
 * 「给定头部字节/大小 → 是否判为试听片段、有没有发请求」。
 */

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 'q1',
    name: '晴天',
    artist: '周杰伦',
    album: '',
    url: '',
    cover: '',
    lrc: '',
    duration: 269,
    sourceType: 'qq',
    ...overrides,
  };
}

/** 伪造 Range 响应：206 + content-range 总量。 */
function headResponse(bytes: Uint8Array, totalBytes: number): TransportResponse {
  return {
    status: 206,
    headers: {
      'content-type': 'audio/mpeg',
      'content-range': `bytes 0-${bytes.length - 1}/${totalBytes}`,
    },
    body: bytes,
    finalUrl: 'https://cdn.example.com/a.mp3',
  } as unknown as TransportResponse;
}

/** 最小可被 isAudioBytes 认可的 MP3 帧头（0xFF 0xFB）。 */
const MP3_BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x00, ...new Array(60).fill(0)]);

const trustNothing = async () => null;

describe('validateDirectUrlNonFull（#392）', () => {
  it('头部时长比标称短超容差 → nonFull=true（verify=audio-header）', async () => {
    const request = vi.fn(async () => headResponse(MP3_BYTES, 4_000_000));
    const extract = vi.fn(async () => ({ container: 'MPEG', duration: 30, bitrateKbps: 128, trusted: true }));
    const out = await validateDirectUrlNonFull(song(), 'https://cdn.example.com/a.mp3', { request: request as any, extract: extract as any });
    expect(out.nonFull).toBe(true);
    expect(out.verify).toBe('audio-header');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('头部时长与标称一致 → nonFull=false', async () => {
    const request = vi.fn(async () => headResponse(MP3_BYTES, 4_000_000));
    const extract = vi.fn(async () => ({ container: 'MPEG', duration: 268, bitrateKbps: 128, trusted: true }));
    const out = await validateDirectUrlNonFull(song(), 'https://cdn.example.com/a.mp3', { request: request as any, extract: extract as any });
    expect(out.nonFull).toBe(false);
    expect(out.verify).toBe('audio-header');
  });

  it('比标称**长**（加长版/误配）不判试听 → nonFull=false', async () => {
    const request = vi.fn(async () => headResponse(MP3_BYTES, 4_000_000));
    const extract = vi.fn(async () => ({ container: 'MPEG', duration: 400, bitrateKbps: 128, trusted: true }));
    const out = await validateDirectUrlNonFull(song(), 'https://cdn.example.com/a.mp3', { request: request as any, extract: extract as any });
    expect(out.nonFull).toBe(false);
  });

  it('头时长不可信时降级 L3（体积 ÷ 帧实测码率）判定', async () => {
    const request = vi.fn(async () => headResponse(MP3_BYTES, 400_000)); // 400KB @128kbps ≈ 25s
    const extract = vi.fn(async () => ({ container: 'ADTS/MPEG-4', duration: 5, bitrateKbps: 128, trusted: false }));
    const out = await validateDirectUrlNonFull(song(), 'https://cdn.example.com/a.mp3', { request: request as any, extract: extract as any });
    expect(out.verify).toBe('size-bitrate');
    expect(out.nonFull).toBe(true); // 25s vs 标称 269s：短于容差 → 试听片段
  });

  it('标称时长缺失 → 不发请求、fail-open', async () => {
    const request = vi.fn();
    const out = await validateDirectUrlNonFull(song({ duration: 0 }), 'https://cdn.example.com/a.mp3', { request: request as any });
    expect(out.nonFull).toBe(false);
    expect(out.verify).toBe('none');
    expect(request).not.toHaveBeenCalled();
  });

  it('Range 失败 / 非音频字节 → 不发第二次请求、fail-open', async () => {
    const request = vi.fn(async () => ({ status: 500, headers: {}, body: '', finalUrl: 'x' }) as unknown as TransportResponse);
    const out = await validateDirectUrlNonFull(song(), 'https://cdn.example.com/a.mp3', { request: request as any, extract: trustNothing as any });
    expect(out.nonFull).toBe(false);
    expect(out.verify).toBe('none');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('无可用时长证据（头解析为 null 且无体积/码率）→ fail-open', async () => {
    const request = vi.fn(async () => ({
      status: 206, headers: { 'content-type': 'audio/mpeg' }, body: MP3_BYTES, finalUrl: 'x',
    }) as unknown as TransportResponse);
    const out = await validateDirectUrlNonFull(song(), 'https://cdn.example.com/a.mp3', { request: request as any, extract: trustNothing as any });
    expect(out.nonFull).toBe(false);
    expect(out.verify).toBe('none');
  });
});
