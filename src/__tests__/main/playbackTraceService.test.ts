import { beforeEach, describe, expect, it, vi } from 'vitest';

// 播放诊断服务（#363 / ADR 2026-09-23-playback-trace-sink）：
// 模块加载即注册 core sink；测试直接 emit 走真实环形缓冲，只 mock 导出用的 dialog 与 fs。

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  writeFileSync: vi.fn(),
  getVersion: vi.fn(() => '9.9.9'),
}));

vi.mock('electron', () => ({
  app: { getVersion: mocks.getVersion },
  dialog: { showSaveDialog: mocks.showSaveDialog },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const patched = { ...actual, writeFileSync: mocks.writeFileSync };
  return { ...patched, default: patched, writeFileSync: mocks.writeFileSync };
});

import fs from 'fs';
import { emitPlaybackProbeTrace, emitPlaybackTrace } from '@mplayer/core';
import type { PlaybackProbeTrace, PlaybackTrace } from '@mplayer/core';
import {
  buildPlaybackTraceExport,
  clearPlaybackTraces,
  exportPlaybackTraces,
  listPlaybackTraces,
  listProbeTraces,
  PLAYBACK_TRACE_CAPACITY,
} from '../../main/services/playbackTraceService';

function makeTrace(overrides: Partial<PlaybackTrace> = {}): PlaybackTrace {
  return {
    ts: 1,
    songId: 's1',
    songName: '晴天',
    artist: '周杰伦',
    sourceType: 'netease',
    totalMs: 123,
    layer: 'direct',
    nonFull: false,
    prefetchHit: false,
    tier3Engaged: false,
    reason: '直连命中',
    via: 'direct',
    guard: null,
    directMs: 100,
    directMethod: 'weapi',
    directSource: 'netease',
    tier3Ms: null,
    tier3TimedOut: false,
    sources: [],
    ...overrides,
  };
}

function makeProbe(overrides: Partial<PlaybackProbeTrace> = {}): PlaybackProbeTrace {
  return { ts: 2, songId: 's1', resolveMs: 50, validateMs: 10, tag: 'valid', ...overrides };
}

beforeEach(() => {
  clearPlaybackTraces();
  vi.clearAllMocks();
  mocks.getVersion.mockReturnValue('9.9.9');
});

describe('桌面播放诊断服务（ring list/clear + export）', () => {
  it('模块加载已注册 sink：emit 后 list 能读到解析与探测 trace', () => {
    emitPlaybackTrace(makeTrace({ songId: 'a', songName: '七里香' }));
    emitPlaybackProbeTrace(makeProbe({ songId: 'a' }));

    const resolves = listPlaybackTraces();
    const probes = listProbeTraces();
    expect(resolves).toHaveLength(1);
    expect(resolves[0].songId).toBe('a');
    expect(resolves[0].songName).toBe('七里香');
    expect(probes).toHaveLength(1);
    expect(probes[0].resolveMs).toBe(50);
  });

  it('list 返回副本：外部修改不影响缓冲', () => {
    emitPlaybackTrace(makeTrace({ songId: 'a' }));
    const snapshot = listPlaybackTraces();
    snapshot.length = 0;
    expect(listPlaybackTraces()).toHaveLength(1);
  });

  it('clearPlaybackTraces 同时清空解析与探测缓冲', () => {
    emitPlaybackTrace(makeTrace());
    emitPlaybackProbeTrace(makeProbe());
    clearPlaybackTraces();
    expect(listPlaybackTraces()).toHaveLength(0);
    expect(listProbeTraces()).toHaveLength(0);
  });

  it('环形缓冲维持容量上限并丢弃最旧记录', () => {
    const total = PLAYBACK_TRACE_CAPACITY + 5;
    for (let i = 0; i < total; i++) {
      emitPlaybackTrace(makeTrace({ songId: `s${i}` }));
    }
    const list = listPlaybackTraces();
    expect(list).toHaveLength(PLAYBACK_TRACE_CAPACITY);
    expect(list[0].songId).toBe('s5');
    expect(list[list.length - 1].songId).toBe(`s${total - 1}`);
  });

  it('buildPlaybackTraceExport 含 meta（导出版本/时间）与两份快照', () => {
    emitPlaybackTrace(makeTrace({ songId: 'x' }));
    emitPlaybackProbeTrace(makeProbe({ songId: 'x' }));
    const payload = buildPlaybackTraceExport(new Date('2026-09-23T00:00:00.000Z'));
    expect(payload.meta).toEqual({ exportedAt: '2026-09-23T00:00:00.000Z', appVersion: '9.9.9' });
    expect(payload.resolves).toHaveLength(1);
    expect(payload.probes).toHaveLength(1);
  });

  it('exportPlaybackTraces 选路径后写入 JSON 并返回文件路径', async () => {
    emitPlaybackTrace(makeTrace({ songId: 'x', songName: '夜曲' }));
    emitPlaybackProbeTrace(makeProbe({ songId: 'x' }));
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/tmp/trace.json' });

    const result = await exportPlaybackTraces();

    expect(result).toBe('/tmp/trace.json');
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '导出播放诊断',
        defaultPath: expect.stringMatching(/^mplayer-playback-trace-.*\.json$/),
      }),
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/trace.json', expect.any(String), 'utf-8');

    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
    expect(written.meta.appVersion).toBe('9.9.9');
    expect(typeof written.meta.exportedAt).toBe('string');
    expect(written.resolves).toHaveLength(1);
    expect(written.resolves[0].songName).toBe('夜曲');
    expect(written.probes).toHaveLength(1);
  });

  it('exportPlaybackTraces 用户取消时返回 null 且不写盘', async () => {
    emitPlaybackTrace(makeTrace());
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' });

    const result = await exportPlaybackTraces();

    expect(result).toBeNull();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
