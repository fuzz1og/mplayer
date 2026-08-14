import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DownloadService } from '../../main/services/downloadService';
import type { Song } from '@mplayer/core';

// ── mocks ─────────────────────────────────────────────────────
const axiosMock = vi.hoisted(() => {
  const download = vi.fn();
  const get = vi.fn();
  const create = vi.fn(() => fakeAxiosInstance());
  function fakeAxiosInstance() {
    return {
      get,
      create,
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      defaults: {},
    };
  }
  // 既可直接调用（stream 下载），也支持 .get / .create（core 内部使用）
  const axios = (config: unknown) => download(config);
  (axios as unknown as { get: typeof get }).get = get;
  (axios as unknown as { create: typeof create }).create = create;
  return { axios, download, get, create };
});

const musicApiMock = vi.hoisted(() => ({
  getAudioUrl: vi.fn(async (u: string) => u),
  getLyrics: vi.fn(async () => ''),
  fillSongUrls: vi.fn(),
}));

// mp3tag.js 记录是否被调用（FLAC 不应触发写入）
const mp3tagMock = vi.hoisted(() => ({
  instantiated: 0,
  cleared: vi.fn(),
}));

vi.mock('axios', () => ({ default: axiosMock.axios }));

vi.mock('../../main/api/musicApi', () => ({ musicApi: musicApiMock }));

// 下载服务通过 BrowserWindow.getAllWindows() 推送下载事件；主测试 setup 按顺序在
// vitest 中会被本文件同名 mock 覆盖，这里给一个最小可用 electron mock（含静态方法）。
vi.mock('electron', () => {
  const windowSend = vi.fn();
  const FakeBrowserWindow = Object.assign(
    () => ({ webContents: { send: windowSend, on: vi.fn(), openDevTools: vi.fn() }, on: vi.fn(), close: vi.fn(), destroy: vi.fn() }),
    { getAllWindows: vi.fn(() => []) }
  );
  return {
    BrowserWindow: FakeBrowserWindow,
    session: { defaultSession: { setProxy: vi.fn().mockResolvedValue(undefined), resolveProxy: vi.fn().mockResolvedValue('') } },
    app: { getPath: vi.fn().mockReturnValue('/tmp/mock-user-data') },
    dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    clipboard: { writeText: vi.fn(), readText: vi.fn().mockReturnValue('') },
    shell: { openExternal: vi.fn() },
  };
});

vi.mock('mp3tag.js', () => {
  return {
    default: class FakeMP3Tag {
      buffer: { data: Uint8Array } | Uint8Array = { data: new Uint8Array([0x49, 0x44, 0x33]) };
      tags: any = {};
      error = '';
      constructor() {
        mp3tagMock.instantiated++;
      }
      read() {}
      save() {
        this.buffer = { data: new Uint8Array([1, 2, 3]) };
      }
      get bufferData() {
        return Buffer.from([1, 2, 3]);
      }
    },
  };
});

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: '1',
    name: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    duration: 240,
    sourceType: 'netease',
    url: 'http://example.com/song.mp3',
    cover: '',
    lrc: '',
    ...overrides,
  };
}

/** 服务返回一个流式响应，写入下载路径并触发 writer finish */
function serveDownload(contentType: string, body?: string) {
  axiosMock.download.mockImplementationOnce(async ({ onDownloadProgress }: any) => {
    // 触发一次进度回调（未知总量场景）
    onDownloadProgress?.({ loaded: 2048, total: 0 });
    return {
      headers: { 'content-type': contentType },
      data: Readable.from([Buffer.from(body ?? 'AUDIODATA')]),
    };
  });
}

describe('DownloadService (T15 多格式标签 + .lrc 侧车)', () => {
  let service: DownloadService;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mplayer-dl-'));
    service = new DownloadService();
    service.initialize({ downloadPath: dir });
    mp3tagMock.instantiated = 0;
    axiosMock.get.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('MP3 下载写出 .lrc 歌词侧车（与音频同名同目录）', async () => {
    const song = makeSong({
      lrc: 'http://example.com/lyric.lrc',
      cover: 'http://example.com/cover.jpg',
    });
    musicApiMock.getLyrics.mockResolvedValueOnce('[00:12.00]你好\n[00:20.00]再见');
    serveDownload('audio/mpeg');
    axiosMock.get.mockResolvedValueOnce({ data: Buffer.from([0xff, 0xfb]), headers: { 'content-type': 'image/jpeg' } });

    const tasks = service.addBatchDownloads([song]);
    await ticks(); // 等待队列异步完成

    expect(tasks[0].status).toBe('completed');
    const files = require('fs').readdirSync(dir) as string[];
    expect(files.some((f) => f.endsWith('.mp3'))).toBe(true);
    expect(files.some((f) => f.endsWith('.lrc'))).toBe(true);
    const lrcFile = files.find((f) => f.endsWith('.lrc'))!;
    expect(readFileSync(join(dir, lrcFile), 'utf-8')).toContain('[00:12.00]你好');
    expect(musicApiMock.getLyrics).toHaveBeenCalledWith('http://example.com/lyric.lrc');
  });

  it('FLAC Content-Type 产物存为 .flac 且不触发 ID3 标签写入（不错灌）', async () => {
    const song = makeSong();
    serveDownload('audio/flac', 'fLaC-HEADER-BYTES');
    const tasks = service.addBatchDownloads([song]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    const files = require('fs').readdirSync(dir) as string[];
    expect(files.some((f) => f.endsWith('.flac'))).toBe(true);
    // 容器不支持 ID3 → mp3tag.js 不被实例化（未错灌 ID3）
    expect(mp3tagMock.instantiated).toBe(0);
  });

  it('无歌词（lrc 为空）时不写 .lrc 侧车', async () => {
    const song = makeSong();
    serveDownload('audio/mpeg');
    const tasks = service.addBatchDownloads([song]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    const files = require('fs').readdirSync(dir) as string[];
    expect(files.some((f) => f.endsWith('.lrc'))).toBe(false);
  });

  it('未知总量进度不卡 0%（进度回调给出软进度 > 0）', async () => {
    const song = makeSong();
    serveDownload('audio/mpeg');
    const tasks = service.addBatchDownloads([song]);
    await ticks();

    // 流下载结束时置 100；进度回调期间 >0（软进度），不再停留在 0
    expect(tasks[0].status).toBe('completed');
    expect(tasks[0].progress).toBe(100);
  });
});

/** 等待队列内全部异步下载（含 retry 的 setTimeout）落地 */
async function ticks(n = 30): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 8));
  }
}
