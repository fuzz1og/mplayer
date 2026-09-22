import { describe, expect, it } from 'vitest';
import type { Song } from '../../types/index.js';
import {
  evaluatePlaybackGuard,
  GUARD_TOLERANCE_SEC,
  MEASURED_BITRATE_TOLERANCE_SEC,
  type PlaybackEvidence,
} from '../playbackGuard.js';

/**
 * 播放护栏决策纯函数测试（#361）。
 * 只断言外部行为：给定歌曲 + 候选证据，断言「是否接受」「guard 等级」
 * 「L3 码率分支」；不断言内部实现。
 */

const song = (duration = 240, overrides: Partial<Song> = {}): Song => ({
  id: '1',
  name: '晴天',
  artist: '周杰伦',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration,
  sourceType: 'netease',
  ...overrides,
});

/** L3 体积：码率 kbps、时长 sec 的 CBR 音频字节数。 */
const sizeFor = (sec: number, kbps: number): number => (sec * kbps * 1000) / 8;

describe('护栏分级与 ±2s 容差', () => {
  it('容差常量为 2s', () => {
    expect(GUARD_TOLERANCE_SEC).toBe(2);
  });

  it('L1 源自带时长：一致 → source-duration', () => {
    const d = evaluatePlaybackGuard(song(240), { sourceDuration: 240 });
    expect(d).toEqual({ accepted: true, guard: 'source-duration', reason: expect.any(String) });
  });

  it('L1 边界：恰好 Δ2.0s 通过，Δ2.1s 拒绝', () => {
    expect(evaluatePlaybackGuard(song(240), { sourceDuration: 242 }).accepted).toBe(true);
    expect(evaluatePlaybackGuard(song(240), { sourceDuration: 238 }).accepted).toBe(true);
    const over = evaluatePlaybackGuard(song(240), { sourceDuration: 242.1 });
    expect(over.accepted).toBe(false);
    expect(over.guard).toBe('source-duration');
    expect(evaluatePlaybackGuard(song(240), { sourceDuration: 237.9 }).accepted).toBe(false);
  });

  it('L1 优先于 L2/L3：有源自带时长就不看头时长', () => {
    const d = evaluatePlaybackGuard(song(240), {
      sourceDuration: 240,
      headerDuration: 30,
      headerTrusted: true,
      totalBytes: sizeFor(30, 128),
      bitrateKbps: 128,
    });
    expect(d.guard).toBe('source-duration');
    expect(d.accepted).toBe(true);
  });

  it('L2 音频头（可信）：按头时长判定', () => {
    const ok = evaluatePlaybackGuard(song(5), { headerDuration: 5.02, headerTrusted: true });
    expect(ok).toEqual({ accepted: true, guard: 'audio-header', reason: expect.any(String) });
    const bad = evaluatePlaybackGuard(song(240), { headerDuration: 30, headerTrusted: true });
    expect(bad.accepted).toBe(false);
    expect(bad.guard).toBe('audio-header');
  });

  it('L2 头时长不可信（ADTS/部分缓冲）→ 降级 L3，不拿不可信证据拒绝', () => {
    const d = evaluatePlaybackGuard(song(240), {
      headerDuration: 0.5, // 部分缓冲的帧计数：不可信
      headerTrusted: false,
      totalBytes: sizeFor(240, 128),
      bitrateKbps: 128,
      bitrateDeclared: true,
    });
    expect(d.guard).toBe('size-bitrate');
    expect(d.accepted).toBe(true);
  });

  it('L3 体积 ÷ 码率：优先源自称码率（branch=declared）', () => {
    const d = evaluatePlaybackGuard(song(240), {
      totalBytes: sizeFor(240, 128),
      bitrateKbps: 128,
      bitrateDeclared: true,
    });
    expect(d.guard).toBe('size-bitrate');
    expect(d.bitrateBranch).toBe('declared');
    expect(d.accepted).toBe(true);
  });

  it('L3 帧实测码率分支单独记录（branch=measured）', () => {
    const d = evaluatePlaybackGuard(song(240), {
      totalBytes: sizeFor(240, 128),
      bitrateKbps: 128,
      bitrateDeclared: false,
    });
    expect(d.bitrateBranch).toBe('measured');
    expect(d.accepted).toBe(true);
  });

  it('L3 实测数据复现 ADR：自称码率通过；帧实测码率按放宽容差也通过（±2s 会误拒）', () => {
    // ADR 实测：真值 166.416s；size ÷ 自称 br(986) = 166.5s（+0.08）；
    // size ÷ 帧实测 br(976.67) = 168.1s（相对标称 166 = 2.1s）。ADR 明确该分支
    // 「要么不用、要么单独放宽阈值」——放宽到 ±3s 后不再误拒，仍挡得住片段/错歌。
    const totalBytes = 20_520_000;
    const declared = evaluatePlaybackGuard(song(166), { totalBytes, bitrateKbps: 986, bitrateDeclared: true });
    expect(declared.accepted).toBe(true);
    expect(declared.bitrateBranch).toBe('declared');
    const measured = evaluatePlaybackGuard(song(166), { totalBytes, bitrateKbps: 976.67, bitrateDeclared: false });
    expect(measured.accepted).toBe(true);
    expect(measured.bitrateBranch).toBe('measured');
    expect(MEASURED_BITRATE_TOLERANCE_SEC).toBe(3);
  });

  it('L3 帧实测分支仍有闸：Δ3.1s 拒绝（差得离谱不播）', () => {
    const totalBytes = sizeFor(169.1, 128); // 估算 169.1s vs 标称 166s
    const d = evaluatePlaybackGuard(song(166), { totalBytes, bitrateKbps: 128, bitrateDeclared: false });
    expect(d.accepted).toBe(false);
    expect(d.bitrateBranch).toBe('measured');
  });

  it('L3 拿不到码率（体积/码率缺一）→ 降级 L4', () => {
    const d = evaluatePlaybackGuard(song(240), {
      totalBytes: sizeFor(240, 128),
      bitrateKbps: null,
      name: '晴天',
      artist: '周杰伦',
    });
    expect(d.guard).toBe('text-only');
    expect(d.accepted).toBe(true);
  });

  it('L1–L3 三指标：时长一致但歌名/歌手不匹配 → 拒绝（ADR 决策 3）', () => {
    const l1 = evaluatePlaybackGuard(song(240), { sourceDuration: 240, name: '晴天', artist: '五月天' });
    expect(l1.accepted).toBe(false);
    expect(l1.guard).toBe('source-duration');
    const l2 = evaluatePlaybackGuard(song(240), {
      headerDuration: 240,
      headerTrusted: true,
      name: '晴天',
      artist: '五月天',
    });
    expect(l2.accepted).toBe(false);
    expect(l2.guard).toBe('audio-header');
    const l3 = evaluatePlaybackGuard(song(240), {
      totalBytes: sizeFor(240, 128),
      bitrateKbps: 128,
      bitrateDeclared: true,
      name: '晴天',
      artist: '五月天',
    });
    expect(l3.accepted).toBe(false);
    expect(l3.guard).toBe('size-bitrate');
  });

  it('L1–L3 三指标：时长与文本都一致 → 接受', () => {
    const d = evaluatePlaybackGuard(song(240), { sourceDuration: 240, name: '晴天', artist: '周杰伦' });
    expect(d.accepted).toBe(true);
    expect(d.guard).toBe('source-duration');
    expect(d.reason).toContain('三指标');
  });

  it('L4 仅文本：歌名 + 歌手精确匹配通过', () => {
    const d = evaluatePlaybackGuard(song(240), { name: '晴天', artist: '周杰伦' });
    expect(d.guard).toBe('text-only');
    expect(d.accepted).toBe(true);
  });

  it('L4 文本不匹配（同名不同歌手）→ 拒绝', () => {
    const d = evaluatePlaybackGuard(song(240), { name: '晴天', artist: '五月天' });
    expect(d.guard).toBe('text-only');
    expect(d.accepted).toBe(false);
  });

  it('L4 拒绝翻唱/Live/remix 变体（歌名归一后相等但署名带混音标记）', () => {
    const d = evaluatePlaybackGuard(song(240), { name: '晴天 (Live)', artist: '周杰伦' });
    expect(d.accepted).toBe(false);
  });

  it('L5 无任何内容证据 → 放行 guard=none（source 契约信任，如实标注）', () => {
    const d = evaluatePlaybackGuard(song(240), {});
    expect(d).toEqual({ accepted: true, guard: 'none', reason: expect.any(String) });
    expect(d.reason).toContain('信任');
  });

  it('标称时长缺失（0）→ 不做时长判定，不阻断正常歌', () => {
    const evidence: PlaybackEvidence = { sourceDuration: 999, headerDuration: 999, headerTrusted: true };
    const d = evaluatePlaybackGuard(song(0), evidence);
    expect(d.accepted).toBe(true);
    expect(d.guard).toBe('source-duration');
  });

  it('L2 头时长存在但为 0/非法 → 视为无该级证据', () => {
    const d = evaluatePlaybackGuard(song(240), {
      headerDuration: 0,
      headerTrusted: true,
      totalBytes: sizeFor(240, 128),
      bitrateKbps: 128,
    });
    expect(d.guard).toBe('size-bitrate');
  });
});
