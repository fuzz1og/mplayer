import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Song } from '@mplayer/core';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
}));

import { FileStorage } from '../../main/storage/fileStorage';

function song(id: string, name = '晴天'): Song {
  return {
    id, name, artist: '周杰伦', album: '', duration: 240,
    sourceType: 'netease', url: '', cover: '', lrc: '',
  };
}

const dataFile = (name: string) => path.join(state.dir, 'data', name);

beforeEach(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-storage-domains-'));
});

afterEach(() => {
  if (state.dir) fs.rmSync(state.dir, { recursive: true, force: true });
  state.dir = '';
});

/**
 * #410 ④：存储每次变更**全量重写** + 每次写入都拷一份备份。
 * 五个域挤在一个 storage.json 里，加一首收藏 / 切一个设置开关都要重写整份用户数据，
 * `setSetting` 更是跳过防抖立即全量写。现在按域分表、各自原子替换。
 */
describe('#410 存储按域分表', () => {
  it('改设置只写 settings.json，收藏文件原样不动', async () => {
    const storage = new FileStorage();
    await storage.addFavorite(song('netease:1'));
    await storage.flushSave();

    const favoritesBefore = fs.readFileSync(dataFile('favorites.json'), 'utf-8');
    expect(JSON.parse(favoritesBefore)).toHaveLength(1);

    await storage.setSetting('theme', 'dark');

    // 收藏文件一个字节都没变（此前会被整份重写一遍）
    expect(fs.readFileSync(dataFile('favorites.json'), 'utf-8')).toBe(favoritesBefore);
    expect(JSON.parse(fs.readFileSync(dataFile('settings.json'), 'utf-8'))).toEqual({ theme: 'dark' });
  });

  it('落盘是紧凑 JSON（去掉 pretty-print）', async () => {
    const storage = new FileStorage();
    await storage.setSetting('theme', 'dark');

    const raw = fs.readFileSync(dataFile('settings.json'), 'utf-8');
    expect(raw).toBe('{"theme":"dark"}');
  });

  it('每个域各自一个文件', async () => {
    const storage = new FileStorage();
    await storage.addFavorite(song('netease:1'));
    const playlistId = await storage.createPlaylist('测试');
    await storage.addSongToPlaylist(playlistId, song('netease:2'));
    await storage.addToPlayHistory(song('netease:3'));
    await storage.flushSave();

    for (const name of ['favorites.json', 'playlists.json', 'playlistSongs.json', 'history.json']) {
      expect(fs.existsSync(dataFile(name)), name).toBe(true);
    }
  });
});

describe('#410 旧版单文件迁移', () => {
  function writeLegacy(): void {
    const dataDir = path.join(state.dir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'storage.json'), JSON.stringify({
      favorites: [{
        id: 1,
        songId: 'netease:9',
        song: { id: 'netease:9', name: '老收藏', artist: 'A', album: '', duration: 1, sourceType: 'netease' },
        createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      }],
      playHistory: [{
        id: 2,
        songId: 'netease:9',
        song: { id: 'netease:9', name: '老收藏', artist: 'A', album: '', duration: 1, sourceType: 'netease' },
        playedAt: new Date('2026-01-02T00:00:00.000Z').toISOString(),
      }],
      playlists: [],
      playlistSongs: [],
      settings: { volume: 42 },
    }));
  }

  it('旧数据的 settings 同步可见（getSettingSync 在 app ready 前就被调用）', () => {
    writeLegacy();
    const storage = new FileStorage();
    expect(storage.getSettingSync('volume')).toBe(42);
  });

  it('旧数据被拆到分域文件，单文件退役为 .migrated', async () => {
    writeLegacy();
    const storage = new FileStorage();

    expect((await storage.getFavorites()).map(f => f.id)).toEqual(['netease:9']);
    expect((await storage.getPlayHistory()).map(h => h.songId)).toEqual(['netease:9']);

    await storage.flushSave();

    const dataDir = path.join(state.dir, 'data');
    expect(fs.existsSync(path.join(dataDir, 'storage.json'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'storage.json.migrated'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'favorites.json'), 'utf-8'))).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf-8'))).toEqual({ volume: 42 });
  });

  it('迁移后可重新装载：新实例从分域文件读到同样数据', async () => {
    writeLegacy();
    const first = new FileStorage();
    await first.getFavorites();
    await first.flushSave();

    const second = new FileStorage();
    expect((await second.getFavorites()).map(f => f.id)).toEqual(['netease:9']);
    expect((await second.getPlayHistory()).length).toBe(1);
    expect(await second.getSetting('volume')).toBe(42);
  });
});
