import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BrowserWindow } from 'electron';
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
  getLyrics: vi.fn(async () => ''),
  // 取词计划（core planLyricsFetch）在下载侧接到的具体实现：按 ID 直取两源 + 非直取源搜索补全
  getNeteaseLyrics: vi.fn(async () => ''),
  getSodaLyrics: vi.fn(async () => ''),
  searchSongsRouted: vi.fn(async () => []),
}));

// 只覆写 routed 解析器与重试退避，其余 core 导出保持真实现
const routedResolveMock = vi.hoisted(() => ({ resolve: vi.fn() }));
// #608：取词决策单点守卫——默认透传 core 真实现，个别用例投毒成固定 plan
const planLyricsFetchMock = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('@mplayer/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mplayer/core')>();
  planLyricsFetchMock.fn.mockImplementation(actual.planLyricsFetch);
  return {
    ...actual,
    resolvePlayableSongRouted: routedResolveMock.resolve,
    retryBackoffMs: () => 0,
    planLyricsFetch: (song: Parameters<typeof actual.planLyricsFetch>[0]) => planLyricsFetchMock.fn(song),
  };
});

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
      buffer: ArrayBuffer | Uint8Array = new Uint8Array([0x49, 0x44, 0x33]).buffer;
      tags: any = {};
      error = '';
      constructor() {
        mp3tagMock.instantiated++;
      }
      read() {}
      save() {
        // 真 mp3tag 在 node 下回 ArrayBuffer；mock 回 Buffer 契约一致，写回才不抛
        this.buffer = new Uint8Array([1, 2, 3]).buffer;
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
    // 默认解析器按身份原样返回 song.url（存量行为），个别用例再覆写
    routedResolveMock.resolve.mockReset();
    routedResolveMock.resolve.mockImplementation(async (song: Song) => ({ url: song.url, nonFull: false }));
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

    const tasks = await service.addBatchDownloads([song]);
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
    const tasks = await service.addBatchDownloads([song]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    const files = require('fs').readdirSync(dir) as string[];
    expect(files.some((f) => f.endsWith('.flac'))).toBe(true);
    // 容器不支持 ID3 → mp3tag.js 不被实例化（未错灌 ID3）
    expect(mp3tagMock.instantiated).toBe(0);
  });

  it('M4A Content-Type 产物存为 .m4a 且不触发标签写入（ID32 标准读取方读不回，#607）', async () => {
    const song = makeSong();
    // 真 ftyp 头：detectAudioContainer 才认 m4a（否则退化成 unknown，走不到这条分支）
    serveDownload('audio/mp4', '\u0000\u0000\u0000\u001cftypM4A ' + 'x'.repeat(32));
    const tasks = await service.addBatchDownloads([song]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    const files = require('fs').readdirSync(dir) as string[];
    expect(files.some((f) => f.endsWith('.m4a'))).toBe(true);
    // core planAudioTagging 判 m4a=skip → mp3tag.js 不被实例化（不写读不回的 ID32 假标签）
    expect(mp3tagMock.instantiated).toBe(0);
  });

  it('MP3（真 ID3 头）仍写标签——收敛不误伤唯一承诺的容器', async () => {
    const song = makeSong();
    serveDownload('audio/mpeg', 'ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000' + 'x'.repeat(64));
    const tasks = await service.addBatchDownloads([song]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    expect(mp3tagMock.instantiated).toBe(1);
  });

  it('无歌词（lrc 为空）时不写 .lrc 侧车', async () => {
    const song = makeSong();
    serveDownload('audio/mpeg');
    const tasks = await service.addBatchDownloads([song]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    const files = require('fs').readdirSync(dir) as string[];
    expect(files.some((f) => f.endsWith('.lrc'))).toBe(false);
  });

  it('未知总量进度不卡 0%（进度回调给出软进度 > 0）', async () => {
    const song = makeSong();
    serveDownload('audio/mpeg');
    const tasks = await service.addBatchDownloads([song]);
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

// ---------------------------------------------------------------------------
// 按身份解析后下载（#211）：#171 后列表歌 url 恒空，下载不得要求/信任 song.url
// ---------------------------------------------------------------------------
describe('DownloadService 按身份解析（resolve-by-identity）', () => {
  let service: DownloadService;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mplayer-dl-'));
    service = new DownloadService();
    service.initialize({ downloadPath: dir });
    routedResolveMock.resolve.mockReset();
    routedResolveMock.resolve.mockImplementation(async () => ({ url: '', nonFull: false }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('无 url 的搜索结果歌可批量下载：按 id 解析出直链再抓流', async () => {
    const song = makeSong({ url: '' });
    routedResolveMock.resolve.mockResolvedValue({ url: 'https://cdn.example.com/resolved.flac', nonFull: false });
    serveDownload('audio/flac');

    const tasks = await service.addBatchDownloads([song]);
    await ticks();

    // 未被「歌曲数据不完整」静默跳过
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('completed');
    expect(routedResolveMock.resolve).toHaveBeenCalledWith(expect.objectContaining({ id: '1', sourceType: 'netease' }));
    expect(axiosMock.download).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://cdn.example.com/resolved.flac' }));
  });

  it('无 url 歌单曲下载同样走身份解析', async () => {
    const song = makeSong({ id: '2', url: '' });
    routedResolveMock.resolve.mockResolvedValue({ url: 'https://cdn.example.com/single.mp3', nonFull: false });
    serveDownload('audio/mpeg');

    const task = service.addDownload(song);
    await ticks();

    expect(task.status).toBe('completed');
    expect(axiosMock.download).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://cdn.example.com/single.mp3' }));
  });

  it('旧签名死链不入下载流：以解析结果为准', async () => {
    const deadUrl = 'https://legacy.example.com/api.php?get=url&id=1&sign=OLDSIGN';
    const song = makeSong({ url: deadUrl });
    routedResolveMock.resolve.mockResolvedValue({ url: 'https://cdn.example.com/fresh.mp3', nonFull: false });
    serveDownload('audio/mpeg');

    const tasks = await service.addBatchDownloads([song]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    expect(axiosMock.download).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://cdn.example.com/fresh.mp3' }));
    const calledWith = (axiosMock.download as ReturnType<typeof vi.fn>).mock.calls[0][0] as { url: string };
    expect(calledWith.url).not.toBe(deadUrl);
  });

  it('⭐ 汽水下载同样只走解析出口（#622：不再有 getSodaAudioUrl 旁路，编码归一在那一处）', async () => {
    const song = makeSong({ sourceType: 'soda', id: '7679694801201334312', url: '' });
    routedResolveMock.resolve.mockResolvedValue({
      url: 'https://v5-se-ex-alismart-luna.douyinvod.com/x.mp3?cd=0%7C0%7C0%7C5',
      nonFull: false,
    });
    serveDownload('audio/mpeg');

    const tasks = await service.addBatchDownloads([song]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    expect(routedResolveMock.resolve).toHaveBeenCalledTimes(1);
    expect(axiosMock.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://v5-se-ex-alismart-luna.douyinvod.com/x.mp3?cd=0%7C0%7C0%7C5' })
    );
  });

  it('解析失败（无直链）任务进 error 态并给出可读错误', async () => {
    const song = makeSong({ url: '' });
    routedResolveMock.resolve.mockResolvedValue({ url: '', nonFull: false });

    const tasks = await service.addBatchDownloads([song]);
    await ticks();

    expect(tasks[0].status).toBe('error');
    expect(tasks[0].error).toContain('无法获取音频 URL');
  });
});

// ---------------------------------------------------------------------------
// 进度节流（#305）：进度是粗粒度读模型，不再逐 chunk 打满 IPC 通道
// ---------------------------------------------------------------------------
describe('DownloadService 进度节流（#305）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mplayer-dl-throttle-'));
    routedResolveMock.resolve.mockReset();
    routedResolveMock.resolve.mockImplementation(async (song: Song) => ({ url: song.url, nonFull: false }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  });

  /** 注册一个假窗口，收集 download:* 事件通道 */
  function captureDownloadEvents(): string[] {
    const channels: string[] = [];
    const fakeWindow = {
      webContents: { send: (channel: string) => { channels.push(channel); } },
    };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([fakeWindow as unknown as BrowserWindow]);
    return channels;
  }

  /** 同一个 chunk 循环里连发 50 次进度（模拟高速下载） */
  function serveDownloadWithChunks(count: number) {
    axiosMock.download.mockImplementationOnce(async ({ onDownloadProgress }: any) => {
      for (let i = 1; i <= count; i++) {
        onDownloadProgress?.({ loaded: i * 1024, total: count * 1024 });
      }
      return {
        headers: { 'content-type': 'audio/mpeg' },
        data: Readable.from([Buffer.from('AUDIODATA')]),
      };
    });
  }

  it('一个 chunk 循环内的多次进度只推一次 IPC，完成态仍即时补齐', async () => {
    const service = new DownloadService();
    service.initialize({ downloadPath: dir });
    const channels = captureDownloadEvents();
    serveDownloadWithChunks(50);

    const tasks = await service.addBatchDownloads([makeSong()]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    expect(channels.filter((c) => c === 'download:progress')).toHaveLength(1);
    expect(channels).toContain('download:complete');
  });

  it('progressThrottleMs=0 时逐次推送（确认聚合来自节流窗口）', async () => {
    const service = new DownloadService({ progressThrottleMs: 0 });
    service.initialize({ downloadPath: dir });
    const channels = captureDownloadEvents();
    serveDownloadWithChunks(50);

    const tasks = await service.addBatchDownloads([makeSong()]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    expect(channels.filter((c) => c === 'download:progress')).toHaveLength(50);
  });

  it('每首任务的节流窗口互不影响', async () => {
    const service = new DownloadService();
    service.initialize({ downloadPath: dir });
    const channels = captureDownloadEvents();
    serveDownloadWithChunks(20);
    serveDownloadWithChunks(20);

    const tasks = await service.addBatchDownloads([makeSong({ id: '1' }), makeSong({ id: '2' })]);
    await ticks();

    expect(tasks.map((t) => t.status)).toEqual(['completed', 'completed']);
    // 两首任务各自的首次进度都要推出去（不能因共享窗口被吞掉）
    expect(channels.filter((c) => c === 'download:progress').length).toBeGreaterThanOrEqual(2);
    expect(channels.filter((c) => c === 'download:complete')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// #608：下载侧车取词决策收敛到 core planLyricsFetch（此前只认 song.lrc）
// ---------------------------------------------------------------------------
describe('DownloadService 取词决策单点（#608）', () => {
  let service: DownloadService;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mplayer-dl-plan-'));
    service = new DownloadService();
    service.initialize({ downloadPath: dir });
    routedResolveMock.resolve.mockReset();
    routedResolveMock.resolve.mockImplementation(async (song: Song) => ({ url: song.url, nonFull: false }));
    musicApiMock.getLyrics.mockClear();
    musicApiMock.getNeteaseLyrics.mockClear();
    musicApiMock.getSodaLyrics.mockClear();
    musicApiMock.searchSongsRouted.mockClear();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writtenLrc(): string {
    const files = require('fs').readdirSync(dir) as string[];
    const lrcFile = files.find((f) => f.endsWith('.lrc'));
    expect(lrcFile, '未写出 .lrc 侧车').toBeTruthy();
    return readFileSync(join(dir, lrcFile as string), 'utf-8');
  }

  it('⭐ 计划为 inline：直接落盘计划文本，不再按 song.lrc 走 getLyrics', async () => {
    planLyricsFetchMock.fn.mockReturnValueOnce({ kind: 'inline', text: '[00:00.00]计划注入的歌词' });
    // 有意带 URL：旧实现只认 song.lrc，会去 getLyrics 而不是用计划文本
    const song = makeSong({ lrc: 'http://example.com/lyric.lrc' });
    serveDownload('audio/mpeg');

    const tasks = await service.addBatchDownloads([song]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    expect(writtenLrc()).toContain('计划注入的歌词');
    expect(musicApiMock.getLyrics).not.toHaveBeenCalled();
  });

  it('⭐ 计划为 songid：按计划给的源与 ID 直取（#412：网易/汽水此前恒不写侧车）', async () => {
    planLyricsFetchMock.fn.mockReturnValueOnce({ kind: 'songid', source: 'netease', id: 'PLAN-ID' });
    musicApiMock.getNeteaseLyrics.mockResolvedValueOnce('[00:01.00]网易计划词');
    const song = makeSong({ lrc: 'http://example.com/lyric.lrc' });
    serveDownload('audio/mpeg');

    const tasks = await service.addBatchDownloads([song]);
    await ticks();

    expect(tasks[0].status).toBe('completed');
    expect(musicApiMock.getNeteaseLyrics).toHaveBeenCalledWith('PLAN-ID');
    expect(musicApiMock.getLyrics).not.toHaveBeenCalled();
    expect(writtenLrc()).toContain('网易计划词');
  });
});

// ---------------------------------------------------------------------------
// #685：资料库下载分段——暂停 / 恢复 / 取消 paused
// ---------------------------------------------------------------------------
describe('DownloadService 暂停 / 恢复 / 取消（#685）', () => {
  let service: DownloadService;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mplayer-dl-pause-'));
    service = new DownloadService({ progressThrottleMs: 0 });
    service.initialize({ downloadPath: dir });
    routedResolveMock.resolve.mockReset();
    routedResolveMock.resolve.mockImplementation(async (song: Song) => ({ url: song.url, nonFull: false }));
    axiosMock.download.mockReset();
  });

  afterEach(async () => {
    // 关掉测试里故意不结束的流：Windows 下句柄未释放会让 rmSync 报 EBUSY
    service.getAllTasks().forEach((task) => {
      if (task.status === 'downloading' || task.status === 'pending' || task.status === 'paused') {
        service.cancelDownload(task.id);
      }
    });
    await ticks(10);
    rmSync(dir, { recursive: true, force: true });
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  });

  /** 一直不推数据、只在 abort 时结束的流：模拟「下载进行中」。 */
  function serveStalledDownload(): void {
    axiosMock.download.mockImplementationOnce(async ({ signal, onDownloadProgress }: any) => {
      const stream = new Readable({ read() {} });
      signal.addEventListener('abort', () => {
        stream.destroy(new Error('aborted'));
      });
      onDownloadProgress?.({ loaded: 1024, total: 4096 });
      return { headers: { 'content-type': 'audio/mpeg' }, data: stream };
    });
  }

  /** 注册假窗口，收集 download:* 推送。 */
  function captureDownloadEvents(): Array<{ channel: string; payload: unknown }> {
    const events: Array<{ channel: string; payload: unknown }> = [];
    const fakeWindow = {
      webContents: { send: (channel: string, payload: unknown) => { events.push({ channel, payload }); } },
    };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([fakeWindow as unknown as BrowserWindow]);
    return events;
  }

  it('暂停 downloading：转 paused、删除半成品、不推 download:error', async () => {
    const events = captureDownloadEvents();
    serveStalledDownload();
    const [task] = await service.addBatchDownloads([makeSong({ id: 'pause-1', name: '暂停我' })]);
    await ticks(10);

    expect(task.status).toBe('downloading');
    expect((require('fs').readdirSync(dir) as string[])).toHaveLength(1);

    expect(service.pauseDownload(task.id)).toBe(true);
    await ticks(20);

    expect(task.status).toBe('paused');
    expect(task.error).toBeUndefined();
    expect((require('fs').readdirSync(dir) as string[])).toHaveLength(0);
    expect(events.filter((event) => event.channel === 'download:error')).toHaveLength(0);
    expect(
      events.some((event) => event.channel === 'download:progress' && (event.payload as { status?: string }).status === 'paused')
    ).toBe(true);
  });

  it('恢复 paused：progress 归零后重新下载（重下，非断点续传）', async () => {
    serveStalledDownload();
    const [task] = await service.addBatchDownloads([makeSong({ id: 'resume-1', name: '恢复我' })]);
    await ticks(10);
    expect(service.pauseDownload(task.id)).toBe(true);
    await ticks(20);
    expect(task.status).toBe('paused');
    expect(task.progress).toBeGreaterThan(0);

    serveDownload('audio/mpeg');
    expect(service.resumeDownload(task.id)).toBe(true);
    // 恢复即重新入队（并发可用时 processQueue 会同步把它置回 downloading）
    expect(['pending', 'downloading']).toContain(task.status);
    expect(task.progress).toBe(0);
    await ticks(30);

    expect(task.status).toBe('completed');
    expect(task.progress).toBe(100);
    expect(axiosMock.download).toHaveBeenCalledTimes(2);
    expect((require('fs').readdirSync(dir) as string[]).some((file) => file.endsWith('.mp3'))).toBe(true);
  });

  it('暂停 pending 直接转 paused；取消 paused 转 error/已取消', async () => {
    for (let i = 0; i < 3; i++) serveStalledDownload();
    const tasks = await service.addBatchDownloads(
      [1, 2, 3, 4].map((index) => makeSong({ id: 'pending-' + index, name: '排队' + index }))
    );
    await ticks(10);

    expect(tasks.slice(0, 3).map((task) => task.status)).toEqual(['downloading', 'downloading', 'downloading']);
    const queued = tasks[3];
    expect(queued.status).toBe('pending');

    expect(service.pauseDownload(queued.id)).toBe(true);
    expect(queued.status).toBe('paused');

    expect(service.cancelDownload(queued.id)).toBe(true);
    expect(queued.status).toBe('error');
    expect(queued.error).toBe('已取消');
  });

  it('cancel downloading 仍只发一次 download:error（catch 不重复通知）', async () => {
    const events = captureDownloadEvents();
    serveStalledDownload();
    const [task] = await service.addBatchDownloads([makeSong({ id: 'cancel-1', name: '取消我' })]);
    await ticks(10);

    expect(service.cancelDownload(task.id)).toBe(true);
    await ticks(20);

    expect(task.status).toBe('error');
    expect(task.error).toBe('已取消');
    expect(events.filter((event) => event.channel === 'download:error')).toHaveLength(1);
  });

  it('pause/resume 对非预期状态返回 false', async () => {
    serveDownload('audio/mpeg');
    const [task] = await service.addBatchDownloads([makeSong({ id: 'done-1' })]);
    await ticks(30);

    expect(task.status).toBe('completed');
    expect(service.pauseDownload(task.id)).toBe(false);
    expect(service.resumeDownload(task.id)).toBe(false);
    expect(service.pauseDownload('missing-task')).toBe(false);
    expect(service.resumeDownload('missing-task')).toBe(false);
  });
});
