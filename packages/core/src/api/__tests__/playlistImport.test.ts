import { describe, expect, it, vi } from 'vitest';
import { parsePlaylistUrl, parseSongList, importSongs, importFromLink } from '../playlistImport.js';
import type { PlaylistImportDeps } from '../playlistImport.js';
import type { Song, SourceKey } from '../../types/index.js';

function song(id: string, name: string, artist = 'a'): Song {
  return { id, name, artist, album: '', duration: 100, sourceType: 'netease', url: '', cover: '', lrc: '' };
}

function deps(overrides: Partial<PlaylistImportDeps> = {}): PlaylistImportDeps {
  return {
    batchSearch: vi.fn(async () => ({})),
    addSong: vi.fn(async () => {}),
    ...overrides,
  };
}

const progress = vi.fn();

describe('parsePlaylistUrl', () => {
  it('recognizes full netease playlist URLs', () => {
    expect(parsePlaylistUrl('https://music.163.com/#/playlist?id=123456')).toEqual({ type: 'netease', id: '123456' });
    expect(parsePlaylistUrl('https://music.163.com/playlist?id=123456')).toEqual({ type: 'netease', id: '123456' });
  });

  it('recognizes netease short links', () => {
    expect(parsePlaylistUrl('https://163cn.tv/abc123')).toEqual({ type: 'netease-short', url: 'https://163cn.tv/abc123' });
  });

  it('recognizes qq music links', () => {
    const qq = parsePlaylistUrl('https://c6.y.qq.com/base/fcgi-bin/u?__=xyz');
    expect(qq?.type).toBe('qq');
    expect(qq?.url).toContain('c6.y.qq.com');
  });

  it('returns null for unknown input', () => {
    expect(parsePlaylistUrl('')).toBeNull();
    expect(parsePlaylistUrl('https://example.com/foo')).toBeNull();
  });
});

describe('parseSongList', () => {
  it('parses name - artist lines and bare names', () => {
    const lines = parseSongList('晴天 - 周杰伦\n海阔天空\n\n  七里香 - 周杰伦  ');
    expect(lines).toEqual([
      { raw: '晴天 - 周杰伦', name: '晴天', artist: '周杰伦' },
      { raw: '海阔天空', name: '海阔天空', artist: '' },
      { raw: '七里香 - 周杰伦', name: '七里香', artist: '周杰伦' },
    ]);
  });
});

describe('importSongs', () => {
  it('skips songs already in the playlist and imports the rest', async () => {
    const existing = [song('e1', '晴天', '周杰伦')];
    const d = deps({
      batchSearch: vi.fn(async () => ({
        '海阔天空 b': [song('n1', '海阔天空', 'b')],
      })),
    });

    const result = await importSongs(1, '晴天 - 周杰伦\n海阔天空 - b', ['netease'], existing, d, progress);

    expect(result.skips).toHaveLength(1);
    expect(result.successes).toHaveLength(1);
    expect(result.successes[0].song.name).toBe('海阔天空');
    expect(result.failures).toHaveLength(0);
    expect(d.addSong).toHaveBeenCalledWith(1, expect.objectContaining({ id: 'n1' }));
    expect(progress).toHaveBeenCalled();
  });

  it('flows unmatched lines to the next source', async () => {
    const d = deps({
      batchSearch: vi.fn(async (keywords: string[], source: SourceKey) =>
        source === 'netease' ? {} : { [keywords[0]]: [song('k1', '独唱', 'b')] }
      ),
    });

    const result = await importSongs(1, '独唱 - b', ['netease', 'kugou'], [], d, progress);

    expect(result.successes).toHaveLength(1);
    expect(result.successes[0].source).toBe('kugou');
  });

  it('marks lines failed when no source matches', async () => {
    const d = deps();
    const result = await importSongs(1, '找不到的歌 - x', ['netease'], [], d, progress);
    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toContain('未找到');
  });
});

describe('importFromLink', () => {
  it('imports only selected songs, skipping duplicates', async () => {
    const songs = [song('1', 'A'), song('2', 'B'), song('3', 'C')];
    const d = deps();
    const result = await importFromLink(5, songs, new Set(['1', '2']), [song('2', 'B')], d, progress);
    expect(result.successes).toHaveLength(1);
    expect(result.successes[0].song.id).toBe('1');
    expect(result.skips).toHaveLength(1);
    expect(d.addSong).toHaveBeenCalledTimes(1);
  });
});
