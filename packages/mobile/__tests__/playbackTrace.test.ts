import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackTrace } from '@mplayer/core';

// node 环境无原生模块：打桩 expo-file-system/legacy 与 react-native 的 Share，
// 让 service 的导出逻辑（序列化 → 写文件 → 分享）可以离线验证。
const fsMocks = vi.hoisted(() => ({
  documentDirectory: 'file:///doc/',
  writeAsStringAsync: vi.fn(async (_path: string, _data: string) => {}),
}));

vi.mock('expo-file-system/legacy', () => fsMocks);

const rnMocks = vi.hoisted(() => ({
  share: vi.fn(async (_content: { title?: string; message: string }) => ({ action: 'sharedAction' })),
}));

vi.mock('react-native', () => ({ Share: { share: rnMocks.share } }));

import { getPlaybackTraceSink } from '@mplayer/core';
import {
  registerPlaybackTraceSink,
  listPlaybackTraces,
  clearPlaybackTraces,
  serializePlaybackTraces,
  exportPlaybackTraces,
} from '../services/playbackTrace';

function makeTrace(overrides: Partial<PlaybackTrace> = {}): PlaybackTrace {
  return {
    ts: 1234,
    songId: 'netease:1',
    songName: '晴天',
    artist: '周杰伦',
    sourceType: 'netease',
    totalMs: 42,
    layer: 'direct',
    nonFull: false,
    prefetchHit: false,
    tier3Engaged: false,
    reason: '直连命中',
    via: 'direct',
    guard: null,
    directMs: 40,
    directMethod: 'getSongUrl',
    directSource: 'netease',
    directTimedOut: false,
    validateMs: null,
    tier3Ms: null,
    tier3TimedOut: false,
    sources: [{ sourceId: 'qianqian', ms: 12, outcome: 'hit' }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPlaybackTraces();
  registerPlaybackTraceSink();
});

describe('playbackTrace（移动端诊断缓冲与导出）', () => {
  it('注册 sink 后 list 读到 trace，clear 清空', () => {
    expect(getPlaybackTraceSink()).not.toBeNull();
    getPlaybackTraceSink()!.onResolve?.(makeTrace({ songName: '夜曲' }));

    expect(listPlaybackTraces().map((t) => t.songName)).toEqual(['夜曲']);

    clearPlaybackTraces();
    expect(listPlaybackTraces()).toHaveLength(0);
  });

  it('serializePlaybackTraces 输出带版本/导出时刻的 JSON', () => {
    getPlaybackTraceSink()!.onResolve?.(makeTrace());
    const parsed = JSON.parse(serializePlaybackTraces()) as {
      version: number;
      exportedAt: number;
      resolutions: PlaybackTrace[];
    };

    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBeGreaterThan(0);
    expect(parsed.resolutions).toHaveLength(1);
    expect(parsed.resolutions[0].songName).toBe('晴天');
  });

  it('exportPlaybackTraces 写入 documentDirectory 并调用 Share，返回文件路径', async () => {
    getPlaybackTraceSink()!.onResolve?.(makeTrace());

    const path = await exportPlaybackTraces();

    expect(path.startsWith('file:///doc/mplayer-playback-trace-')).toBe(true);
    expect(path.endsWith('.json')).toBe(true);
    expect(fsMocks.writeAsStringAsync).toHaveBeenCalledTimes(1);
    const call = fsMocks.writeAsStringAsync.mock.calls[0];
    expect(call[0]).toBe(path);
    expect((JSON.parse(call[1]) as { resolutions: PlaybackTrace[] }).resolutions).toHaveLength(1);
    expect(rnMocks.share).toHaveBeenCalledTimes(1);
  });
});
