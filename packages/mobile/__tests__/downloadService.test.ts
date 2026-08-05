import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { pickDownloadDirectory, removeDownloadedFile, writePublicCopy } from '../services/downloadService';
import { useSettingsStore } from '../stores/settingsStore';

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

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

vi.mock('expo-file-system', () => {
  class FakeFile {
    uri: string;
    exists = true;
    constructor(_parent: unknown, name: string) {
      this.uri = `file:///doc/${name}`;
    }
    async delete() {
      this.exists = false;
    }
  }
  return {
    File: FakeFile,
    Directory: class {},
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

  it('pickDownloadDirectory: 非 Android 平台不请求授权', async () => {
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
