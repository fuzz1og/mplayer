import { describe, expect, it, vi } from 'vitest';
import { resolvePlayableVersion } from '../playableVersion.js';
import type { Song } from '../../types/index.js';

function song(over: Partial<Song> & { id: string }): Song {
  return {
    name: '晴天', artist: '周杰伦', album: '', duration: 240,
    sourceType: 'netease', url: '', cover: '', lrc: '',
    ...over,
  };
}

describe('resolvePlayableVersion（#639 C3：补一个可播版本）', () => {
  it('已有地址：原样返回且**不搜索**（省掉必然多余的请求）', async () => {
    const search = vi.fn(async () => []);
    const target = song({ id: '1', url: 'https://a/1.mp3' });

    const result = await resolvePlayableVersion(target, { search });

    expect(result.song).toBe(target); // 同一个对象引用
    expect(result.searched).toBe(false);
    expect(search).not.toHaveBeenCalled();
  });

  it('缺地址 + 精确匹配命中：**只回填 url**，歌名/歌手/封面保持点击的那首', async () => {
    const target = song({ id: '1', name: '晴天', artist: '周杰伦', cover: 'cover-of-target' });
    const search = vi.fn(async () => [
      song({ id: '9', name: '晴天', artist: '周杰伦', url: 'https://b/9.mp3', cover: 'cover-of-candidate' }),
    ]);

    const result = await resolvePlayableVersion(target, { search });

    expect(result.matched).toBe(true);
    expect(result.song.url).toBe('https://b/9.mp3');
    // 关键：整首歌**不**被候选顶替 —— 封面/名字仍是用户点的那份
    expect(result.song.cover).toBe('cover-of-target');
    expect(result.song.id).toBe('1');
  });

  it('缺地址 + 无精确匹配：原样返回，**绝不用 results[0] 顶替**', async () => {
    const target = song({ id: '1', name: '单车恋人', artist: '原唱' });
    // 酷我这类源排序差：第一条是 cover 版（歌手不同）
    const search = vi.fn(async () => [
      song({ id: '9', name: '单车恋人', artist: '某某翻唱', url: 'https://b/9.mp3' }),
    ]);

    const result = await resolvePlayableVersion(target, { search });

    expect(result.matched).toBe(false);
    expect(result.song).toBe(target); // 原样，不换歌
    expect(result.song.url).toBe('');
  });

  it('缺地址 + 命中但候选无 url：视为未命中（不返回半成品）', async () => {
    const target = song({ id: '1' });
    const search = vi.fn(async () => [song({ id: '9', name: '晴天', artist: '周杰伦', url: '' })]);

    const result = await resolvePlayableVersion(target, { search });

    expect(result.matched).toBe(false);
    expect(result.song.url).toBe('');
  });

  it('搜索用歌曲自身来源，不写死某源', async () => {
    const target = song({ id: '1', sourceType: 'kugou' });
    const search = vi.fn(async () => []);

    await resolvePlayableVersion(target, { search });

    expect(search).toHaveBeenCalledWith(target);
  });

  it('搜索抛错：不抛给调用方，原样返回并记诊断', async () => {
    const log = vi.fn();
    const target = song({ id: '1' });
    const search = vi.fn(async () => { throw new Error('network down'); });

    const result = await resolvePlayableVersion(target, { search, log });

    expect(result.song).toBe(target);
    expect(result.matched).toBe(false);
    expect(log).toHaveBeenCalled();
  });

  it('无名歌曲：不搜索', async () => {
    const search = vi.fn(async () => []);
    const target = song({ id: '1', name: '' });

    const result = await resolvePlayableVersion(target, { search });

    expect(result.searched).toBe(false);
    expect(search).not.toHaveBeenCalled();
  });

  it('未命中时打候选摘要（便于定位为何没匹配上）', async () => {
    const log = vi.fn();
    const target = song({ id: '1', name: '目标', artist: '甲' });
    const search = vi.fn(async () => [song({ id: '2', name: '别的', artist: '乙' })]);

    await resolvePlayableVersion(target, { search, log });

    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('候选1首'));
  });
});
