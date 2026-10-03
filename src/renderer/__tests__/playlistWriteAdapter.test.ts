import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Song } from '@mplayer/core';
import { createDesktopPlaylistWriter } from '../services/playlistWriteAdapter';

const song = (id: string, name = `歌${id}`, artist = '歌手', sourceType: Song['sourceType'] = 'netease'): Song => ({
  id,
  name,
  artist,
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 180,
  sourceType,
});

/** 假 preload 桥：把 IPC 面记下来，按 channel 回值。 */
function fakeIpc(handlers: Record<string, unknown | ((...args: unknown[]) => unknown)> = {}) {
  const calls: { channel: string; args: unknown[] }[] = [];
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    calls.push({ channel, args });
    const h = handlers[channel];
    if (h !== undefined) return typeof h === 'function' ? (h as (...a: unknown[]) => unknown)(...args) : h;
    if (channel === 'playlist:getSongs') return [];
    if (channel === 'playlist:addSongs') return args[1] as unknown[];
    if (channel === 'playlist:create') return 42;
    return undefined;
  });
  return {
    port: { invoke: invoke as unknown as <T>(channel: string, ...args: unknown[]) => Promise<T> },
    calls,
    channels: () => calls.map((c) => c.channel),
  };
}

/**
 * #552：桌面歌单写入 adapter。
 *
 * 这三份**逐字相同**的 helper 曾被复制在 AddToPlaylistModal / BatchAddToPlaylistModal /
 * importService 里（先 `playlist:get` 校验存在，再 `playlist:addSong`），
 * 桌面链接导入因此是**每首 2 次 IPC**（2N）。这里钉住 adapter 的 IPC 形状：
 * 批量腿一次写整批，且回传宿主真实新增数（#554）。
 */
describe('createDesktopPlaylistWriter（#552 桌面写入 adapter）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('批量写入走一次 playlist:addSongs，不再逐首 playlist:addSong', async () => {
    const ipc = fakeIpc({ 'playlist:getSongs': [], 'playlist:addSongs': ['x', 'y'] });
    const writer = createDesktopPlaylistWriter(ipc.port);

    const result = await writer.add({ playlistId: 7, songs: [song('a'), song('b')] });

    expect(result.ok).toBe(true);
    expect(result.added).toBe(2);
    expect(ipc.channels()).toEqual(['playlist:getSongs', 'playlist:addSongs']);
    expect(ipc.channels()).not.toContain('playlist:addSong');
  });

  it('⭐ added 是宿主真实新增数（宿主只收下 1 首时不是请求数 2）', async () => {
    const ipc = fakeIpc({ 'playlist:getSongs': [], 'playlist:addSongs': ['only-one'] });
    const writer = createDesktopPlaylistWriter(ipc.port);

    const result = await writer.add({ playlistId: 7, songs: [song('a'), song('b')] });

    expect(result.added).toBe(1);
    expect(result.invalid).toBe(1);
  });

  it('目标歌单已有同源同一首歌 → 不发 write IPC，如实报 skipped', async () => {
    const ipc = fakeIpc({ 'playlist:getSongs': [song('a')] });
    const writer = createDesktopPlaylistWriter(ipc.port);

    const result = await writer.add({ playlistId: 7, songs: [song('a')] });

    expect(result.ok).toBe(true);
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(ipc.channels()).toEqual(['playlist:getSongs']);
  });

  it('同名异源 → 回调裁决一次，裁决通过后才写', async () => {
    const ipc = fakeIpc({ 'playlist:getSongs': [song('a', '晴天', '周杰伦', 'netease')], 'playlist:addSongs': ['qq'] });
    const writer = createDesktopPlaylistWriter(ipc.port);
    const resolver = vi.fn(async () => 'add' as const);

    const result = await writer.add({
      playlistId: 7,
      songs: [song('b', '晴天', '周杰伦', 'qq')],
      resolveNameConflict: resolver,
    });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(result.added).toBe(1);
    expect(result.duplicateNames).toBe(1);
  });

  it('createAndAdd 走 playlist:create 再整批写；写入失败时删除新歌单（不留空歌单）', async () => {
    const ok = fakeIpc({ 'playlist:addSongs': ['x'] });
    const writer = createDesktopPlaylistWriter(ok.port);
    const created = await writer.createAndAdd({ name: '新歌单', songs: [song('a')], description: '描述' });
    expect(created.ok).toBe(true);
    expect(created.created).toBe(true);
    expect(ok.calls[0]).toEqual({ channel: 'playlist:create', args: ['新歌单', '描述'] });

    const failing = fakeIpc({
      'playlist:addSongs': () => {
        throw new Error('写入炸了');
      },
    });
    const writer2 = createDesktopPlaylistWriter(failing.port);
    const failed = await writer2.createAndAdd({ name: '新歌单', songs: [song('a')] });
    expect(failed.ok).toBe(false);
    expect(failed.rolledBack).toBe(true);
    expect(failing.channels()).toContain('playlist:delete');
  });
});
