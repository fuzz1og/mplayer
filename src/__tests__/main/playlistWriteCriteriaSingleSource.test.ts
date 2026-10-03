import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Song } from '@mplayer/core';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir,
  },
}));

// #556 评审 C：写入判据必须取自 core 的 `songWriteRejection` 单点，而不是 fileStorage
// 自留的 `validateSongData`。把 core 的这个导出替换成「一律拒收」，若 fileStorage 仍走
// 本地副本，下面的用例会照常收下歌曲 → 修前红。这是「跨端知识只有一份」的行为守卫。
vi.mock('@mplayer/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mplayer/core')>();
  return { ...actual, songWriteRejection: vi.fn(() => 'missing-fields') };
});

import { FileStorage } from '../../main/storage/fileStorage';

function song(id: string, sourceType: Song['sourceType'] = 'netease'): Song {
  return {
    id,
    name: '晴天',
    artist: '周杰伦',
    album: '',
    duration: 240,
    sourceType,
    url: `https://audio.example.com/${id}.mp3`,
    cover: '',
    lrc: '',
  };
}

beforeEach(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-criteria-'));
});

afterEach(() => {
  if (state.dir) fs.rmSync(state.dir, { recursive: true, force: true });
  state.dir = '';
});

describe('歌单写入判据的单点（#556 评审 C）', () => {
  it('⭐ 逐首写入消费 core songWriteRejection（不是 fileStorage 自留的 validateSongData）', async () => {
    const storage = new FileStorage();
    const playlistId = await storage.createPlaylist('测试歌单');

    await expect(storage.addSongToPlaylist(playlistId, song('ok'))).rejects.toThrow('歌曲数据不完整');
  });

  it('⭐ 批量写入同样消费 core songWriteRejection', async () => {
    const storage = new FileStorage();
    const playlistId = await storage.createPlaylist('测试歌单');

    const added = await storage.addSongsToPlaylist(playlistId, [song('ok')]);

    expect(added).toEqual([]);
  });
});
