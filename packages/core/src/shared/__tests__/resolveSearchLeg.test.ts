import { describe, it, expect, beforeEach } from 'vitest';
import type { Song } from '../../types/index.js';
import {
  registerDirectClient,
  clearDirectClients,
  resolvePlayableSongRouted,
  setStrictSearch,
  clearPrefetchCache,
  type DirectSourceClient,
} from '../../index.js';

const song = (over: Partial<Song> = {}): Song => ({
  id: 'netease:1',
  name: '晴天',
  artist: '周杰伦',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 240,
  sourceType: 'netease',
  ...over,
});

/** 直连恒返回空串（无版权/VIP）→ 解析链必然落到搜索腿。 */
const emptyClient: DirectSourceClient = {
  key: 'netease',
  resolvePlayableUrl: async () => '',
};

/**
 * #544：解析链的**严格搜索腿**。
 *
 * 此前这条规则在桌面被手抄成「搜索 → findExactMatch → 取 hit.url」，
 * 缺三条守卫（非 http / 旧签名死链 / audioTag=invalid）也不写缓存；
 * core 的 `refreshSongResource` 一直有完整规则却只有 1 个消费者。
 * 这里用矩阵钉死守卫，证明「弱化手抄」与「core 唯一实现」的差别真实存在。
 */
describe('解析链严格搜索腿（#544）', () => {
  beforeEach(() => {
    clearDirectClients();
    clearPrefetchCache();
    registerDirectClient(emptyClient);
  });

  it('直连空串 + 精确匹配命中 → 拿到 URL', async () => {
    setStrictSearch(async () => [song({ id: 'netease:hit', url: 'https://cdn.example.com/full.mp3' })]);
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('https://cdn.example.com/full.mp3');
    expect(res.via).toBe('direct'); // 搜索腿拿到的仍是该源直链
    expect(res.nonFull).toBe(false);
    setStrictSearch(null);
  });

  it('守卫：候选是旧签名死链 → 不采用（手抄版会采用）', async () => {
    setStrictSearch(async () => [
      song({ id: 'netease:dead', url: 'https://api.example.com/api.php?get=url&id=1' }),
    ]);
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('');
    setStrictSearch(null);
  });

  it('守卫：候选 audioTag=invalid → 不采用（手抄版会采用）', async () => {
    setStrictSearch(async () => [
      song({ id: 'netease:bad', url: 'https://cdn.example.com/bad.mp3', audioTag: 'invalid' }),
    ]);
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('');
    setStrictSearch(null);
  });

  it('守卫：候选 url 非 http → 不采用（手抄版会采用）', async () => {
    setStrictSearch(async () => [song({ id: 'netease:rel', url: '/relative/path.mp3' })]);
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('');
    setStrictSearch(null);
  });

  it('nonFull 保留：候选是试听版 → 结果带 nonFull=true（手抄版会丢）', async () => {
    setStrictSearch(async () => [
      song({ id: 'netease:trial', url: 'https://cdn.example.com/trial.mp3', audioTag: 'preview' }),
    ]);
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('https://cdn.example.com/trial.mp3');
    expect(res.nonFull).toBe(true);
    setStrictSearch(null);
  });

  it('采用后写回预取缓存 → 第二次解析不再搜索（手抄版不写缓存）', async () => {
    let searches = 0;
    setStrictSearch(async () => {
      searches += 1;
      return [song({ id: 'netease:hit', url: 'https://cdn.example.com/full.mp3' })];
    });
    await resolvePlayableSongRouted(song());
    expect(searches).toBe(1);
    const again = await resolvePlayableSongRouted(song());
    expect(again.url).toBe('https://cdn.example.com/full.mp3');
    expect(searches).toBe(1); // 预取缓存命中，没再搜索
    setStrictSearch(null);
  });

  it('搜索抛错 → 失败打开，返回空 url 而不抛', async () => {
    setStrictSearch(async () => {
      throw new Error('搜索炸了');
    });
    const res = await resolvePlayableSongRouted(song());
    expect(res.url).toBe('');
    setStrictSearch(null);
  });

  it('本地文件不走搜索腿', async () => {
    let called = 0;
    setStrictSearch(async () => {
      called += 1;
      return [song({ id: 'netease:hit', url: 'https://cdn.example.com/full.mp3' })];
    });
    await resolvePlayableSongRouted(song({ sourceType: 'local' })).catch(() => null);
    expect(called).toBe(0);
    setStrictSearch(null);
  });
});
