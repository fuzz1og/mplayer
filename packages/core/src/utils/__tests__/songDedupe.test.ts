import { describe, it, expect } from 'vitest';
import type { Song } from '../../types/index.js';
import { classifySong, createPlaylistSnapshot, DEFAULT_PLAYLIST_CAPACITY } from '../songDedupe.js';

/**
 * 歌单写入的「同一首歌」判据（#553）——**唯一一份**实现。
 *
 * 此前有 4 份互不相同的判据：
 * - songDedupe: name + sourceType（不含 artist）
 * - playlistImport: name | artist
 * - playlistWrite: 裸 song.id
 * - 移动端 AddToPlaylistModal: id + name+artist + 异源三选一
 *
 * 本文件把统一后的口径钉死：
 * - **同源**同一首歌 = `identityKey` 相等（源 + 去源前缀真实 ID），
 *   或同源 name + artist 文本相等（存量裸 id 与换源前缀 id 的合流）；
 * - **跨源**「同名」只算真冲突当且仅当 artist **也**相等（同一次录音）；
 *   异源同名不同歌手 = 两首不同的歌，既不是 duplicate 也不是 nameConflict；
 * - 同源同名但歌手不同 = 两首不同的歌（旧判据在这里会误判为已存在并拒收）。
 */
const song = (id: string, name: string, artist: string, sourceType: Song['sourceType'] = 'netease'): Song => ({
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

describe('classifySong（#553 歌单写入的统一判据）', () => {
  it('同源同 id（含换源前缀形态）→ duplicate', () => {
    const target = [song('netease:123', '晴天', '周杰伦')];
    // 裸 id 与带源前缀 id 是同一首歌（identityKey 归一）
    expect(classifySong(target, song('123', '晴天', '周杰伦')).status).toBe('duplicate');
  });

  it('同源同名同歌手、id 不同（换源后 id 变了）→ duplicate', () => {
    const target = [song('1', '晴天', '周杰伦')];
    expect(classifySong(target, song('99', '晴天', '周杰伦')).status).toBe('duplicate');
  });

  it('⭐ 同源同名**不同歌手** → ok（不是已存在，合法的新歌）', () => {
    const target = [song('1', '晚安', '张三')];
    expect(classifySong(target, song('2', '晚安', '李四')).status).toBe('ok');
  });

  it('⭐ 异源同名**不同歌手** → ok（旧判据一律报 conflict，是假冲突）', () => {
    const target = [song('1', '晴天', '周杰伦', 'netease')];
    expect(classifySong(target, song('2', '晴天', '陈奕迅', 'qq')).status).toBe('ok');
  });

  it('异源同名同歌手 → nameConflict（同一次录音的两个来源，交宿主裁决）', () => {
    const target = [song('1', '晴天', '周杰伦', 'netease')];
    const result = classifySong(target, song('2', '晴天', '周杰伦', 'qq'));
    expect(result.status).toBe('nameConflict');
    expect(result.existingSong?.sourceType).toBe('netease');
  });

  it('完全不同的歌 → ok', () => {
    expect(classifySong([song('1', '晴天', '周杰伦')], song('2', '七里香', '周杰伦')).status).toBe('ok');
  });
});

describe('createPlaylistSnapshot（写入编排的目标快照入参）', () => {
  it('capacity 有默认值（唯一常量），显式传入时透传', () => {
    // 缺省值 = 唯一常量本身：两条断言互为约束，改一处漏一处会红。
    expect(createPlaylistSnapshot({ songs: [] }).capacity).toBe(DEFAULT_PLAYLIST_CAPACITY);
    expect(DEFAULT_PLAYLIST_CAPACITY).toBe(1000);
    expect(createPlaylistSnapshot({ songs: [], capacity: 3 }).capacity).toBe(3);
  });
});
