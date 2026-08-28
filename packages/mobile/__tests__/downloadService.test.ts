import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import {
  pickDownloadDirectory,
  removeDownloadedFile,
  writePublicCopy,
  downloadSong,
} from '../services/downloadService';
import { useSettingsStore } from '../stores/settingsStore';
import { useDownloadStore } from '../stores/downloadStore';
import { musicApi } from '@mplayer/core';

const safMocks = vi.hoisted(() => {
  const createFileAsync = vi.fn(
    async (_parentUri: string, _fileName: string, _mimeType: string) => 'content://downloads/mplayer/song.mp3'
  );
  const readAsStringAsync = vi.fn(async (_uri: string, _options?: unknown) => 'QUJDRA==');
  const writeAsStringAsync = vi.fn(async () => {});
  const deleteAsync = vi.fn(async () => {});
  const requestDirectoryPermissionsAsync = vi.fn(
    async (): Promise<{ granted: boolean; directoryUri: string | null }> => ({
      granted: true,
      directoryUri: 'content://downloads/',
    })
  );
  return {
    createFileAsync,
    readAsStringAsync,
    writeAsStringAsync,
    deleteAsync,
    requestDirectoryPermissionsAsync,
  };
});

// 控制下载产物字节头，模拟 FLAC / MP3 容器
const fsMocks = vi.hoisted(() => {
  const headerBytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43]); // fLaC
  const downloadFileAsync = vi.fn(async (_url: string, file: any, options?: any) => {
    options?.onProgress?.({ bytesWritten: 512, totalBytes: -1 });
    file.header = headerBytes;
    return file;
  });
  return { headerBytes, downloadFileAsync };
});

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

vi.mock('expo-file-system', () => {
  class FakeFile {
    uri: string;
    exists = true;
    header: Uint8Array = new Uint8Array([0x49, 0x44, 0x33]); // ID3(MP3)
    constructor(_parent: unknown, name: string) {
      this.uri = `file:///doc/${name}`;
    }
    get extension(): string {
      return this.name.slice(this.name.lastIndexOf('.'));
    }
    get name(): string {
      return this.uri.split('/').pop()!;
    }
    slice(_start: number, _end: number) {
      // 模拟下载产物字节头（本测试固定为 FLAC fLaC）；slice 同步返回 Blob 形对象
      const buf = new ArrayBuffer(16);
      new Uint8Array(buf).set(Uint8Array.from(fsMocks.headerBytes)); // 0x66 0x4c 0x61 0x43
      return { arrayBuffer: async (): Promise<ArrayBuffer> => buf };
    }
    async delete() {
      this.exists = false;
    }
    async create() {}
    async write() {}
    async move() {
      this.exists = true;
    }
    static downloadFileAsync = fsMocks.downloadFileAsync;
  }
  return {
    File: FakeFile,
    Directory: class {
      async create() {}
    },
    Paths: { document: { uri: 'file:///doc' } },
  };
});

vi.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    createFileAsync: safMocks.createFileAsync,
    readAsStringAsync: safMocks.readAsStringAsync,
    writeAsStringAsync: safMocks.writeAsStringAsync,
    deleteAsync: safMocks.deleteAsync,
    requestDirectoryPermissionsAsync: safMocks.requestDirectoryPermissionsAsync,
  },
}));

vi.mock('@mplayer/core', async () => {
  const actual = await vi.importActual<typeof import('@mplayer/core')>('@mplayer/core');
  return {
    ...actual,
    makeSongFileName: actual.makeSongFileName,
    md5: actual.md5,
    musicApi: {
      ...actual.musicApi,
      getLyrics: vi.fn(async () => '[00:12.00]你好'),
    },
  };
});

// downloadService 复用播放的 URL 解析链（resolvePlayableUrlMobile）；audioPlayer 依赖
// expo-audio（RN 原生链，vitest node 环境 __DEV__ 未定义），mock 掉避免拉入
vi.mock('../services/audioPlayer', () => ({
  resolvePlayableUrlMobile: vi.fn(async (song: any) => ({
    url: song?.url || '',
    lrc: song?.lrc || '',
    nonFull: false,
  })),
}));

function makeSong(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    name: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    duration: 240,
    sourceType: 'netease',
    url: 'http://example.com/song.mp3',
    cover: '',
    lrc: 'http://example.com/lyric.lrc',
    ...overrides,
  };
}

describe('downloadService public copy (SAF)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ downloadDirUri: '' });
  });

  afterEach(() => {
    useSettingsStore.setState({ downloadDirUri: '' });
    (Platform as { OS: string }).OS = 'android';
  });

  it('把私有副本写入 SAF 公共目录并返回公共 uri', async () => {
    const fileName = '[netease] 晴天 - 周杰伦 [abc123].mp3';
    const uri = await writePublicCopy('file:///doc/晴天.mp3', fileName, 'content://downloads/');

    expect(safMocks.createFileAsync).toHaveBeenCalledWith('content://downloads/', fileName, 'audio/mpeg');
    expect(safMocks.readAsStringAsync).toHaveBeenCalledWith('file:///doc/晴天.mp3', { encoding: 'base64' });
    expect(safMocks.writeAsStringAsync).toHaveBeenCalledWith(
      'content://downloads/mplayer/song.mp3',
      'QUJDRA==',
      { encoding: 'base64' }
    );
    expect(uri).toBe('content://downloads/mplayer/song.mp3');
  });

  it('writePublicCopy 支持按容器传真实 MIME（FLAC 用 audio/flac）', async () => {
    await writePublicCopy('file:///doc/a.flac', 'a.flac', 'content://downloads/', 'audio/flac');
    expect(safMocks.createFileAsync).toHaveBeenCalledWith('content://downloads/', 'a.flac', 'audio/flac');
  });

  it('SAF 创建文件失败时抛错（由调用方降级为仅保留私有副本）', async () => {
    safMocks.createFileAsync.mockRejectedValueOnce(new Error('SAF denied'));

    await expect(writePublicCopy('file:///doc/x.mp3', 'x.mp3', 'content://downloads/')).rejects.toThrow('SAF denied');
    expect(safMocks.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it('pickDownloadDirectory: 授权后持久化目录并返回 true', async () => {
    const ok = await pickDownloadDirectory();

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().downloadDirUri).toBe('content://downloads/');
  });

  it('pickDownloadDirectory: 拒绝授权时不动设置并返回 false', async () => {
    safMocks.requestDirectoryPermissionsAsync.mockResolvedValueOnce({ granted: false, directoryUri: null });

    const ok = await pickDownloadDirectory();

    expect(ok).toBe(false);
    expect(useSettingsStore.getState().downloadDirUri).toBe('');
  });

  it('pickDownloadDirectory: 非 Android 不请求授权直接返回 false', async () => {
    (Platform as { OS: string }).OS = 'ios';
    const ok = await pickDownloadDirectory();

    expect(ok).toBe(false);
    expect(safMocks.requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
  });

  it('removeDownloadedFile 同时删除 SAF 公共文件', async () => {
    await removeDownloadedFile('a.mp3', 'content://downloads/a.mp3');

    expect(safMocks.deleteAsync).toHaveBeenCalledWith('content://downloads/a.mp3', { idempotent: true });
  });
});

describe('downloadSong（T15 容器修正 + .lrc 侧车 + 进度，T16 未知总量软进度）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ downloadDirUri: '' });
    useDownloadStore.setState({ items: [] });
    fsMocks.headerBytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43]); // 默认 FLAC，验证扩展名修正
  });

  it('下载后按字节头嗅探重命名为正确扩展名并写入 .lrc 侧车', async () => {
    const file = await downloadSong(makeSong() as any);

    expect(fsMocks.downloadFileAsync).toHaveBeenCalled();
    // FLAC 容器 → 文件名为 .flac（不再错标 .mp3）
    expect(file.name.endsWith('.flac')).toBe(true);
    // .lrc 侧车已尝试写入（无实际目录，mock 层不抛）
    expect(musicApi.getLyrics).toHaveBeenCalledWith('http://example.com/lyric.lrc');
    // 下载记录 status 完成
    const items = useDownloadStore.getState().items;
    expect(items[0].status).toBe('done');
    expect(items[0].progress).toBe(100);
  });

  it('未知总大小进度通过 onProgress 上报软进度（不等 0%）', async () => {
    const originalUpdate = useDownloadStore.getState().updateStatus;
    const progressSeen: number[] = [];
    const spy = vi.spyOn(useDownloadStore.getState(), 'updateStatus').mockImplementation((key, patch: any) => {
      if (patch.progress != null) progressSeen.push(patch.progress);
      return originalUpdate(key, patch);
    });

    await downloadSong(makeSong() as any);
    // onProgress 上报未知总量软进度：至少存在一次 (0,100) 的中间进度，不再卡 0%
    expect(progressSeen.some((p) => p > 0 && p < 100)).toBe(true);
    spy.mockRestore();
  });

  it('并发下载受 DEFAULT_MAX_CONCURRENT 约束，槽位释放后续排（T16 队列门控）', async () => {
    const originalImpl = fsMocks.downloadFileAsync.getMockImplementation();
    const release: (() => void)[] = [];
    fsMocks.downloadFileAsync.mockImplementation(async (_url: string, file: any, options?: any) => {
      options?.onProgress?.({ bytesWritten: 512, totalBytes: -1 });
      file.header = fsMocks.headerBytes;
      await new Promise<void>((r) => release.push(r));
      return file;
    });
    try {
      const songs = [1, 2, 3, 4].map((i) =>
        makeSong({ id: String(i), name: `歌${i}`, url: `http://example.com/${i}.mp3` })
      );
      const promises = songs.map((s) => downloadSong(s as any).catch(() => {}));

      // 并发上限 3：第 4 首必须等待槽位
      await vi.waitFor(() => expect(fsMocks.downloadFileAsync).toHaveBeenCalledTimes(3));
      expect(fsMocks.downloadFileAsync).not.toHaveBeenCalledTimes(4);

      // 放行一首 → 等待中的第 4 首进入
      release.shift()!();
      await vi.waitFor(() => expect(fsMocks.downloadFileAsync).toHaveBeenCalledTimes(4));

      // 全部放行收尾
      while (release.length > 0) release.shift()!();
      await Promise.all(promises);
    } finally {
      fsMocks.downloadFileAsync.mockImplementation(originalImpl as never);
    }
  });
});
