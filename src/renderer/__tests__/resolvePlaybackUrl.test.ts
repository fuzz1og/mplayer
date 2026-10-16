import { describe, expect, it, vi } from 'vitest';
import type { PlaybackFailureAdvice, Song } from '@mplayer/core';
import { resolvePlaybackUrl, type ResolvePlaybackUrlDeps } from '../services/resolvePlaybackUrl';

function song(over: Partial<Song> & { id: string }): Song {
  return {
    name: '晴天', artist: '周杰伦', album: '', duration: 240,
    sourceType: 'netease', url: '', cover: '', lrc: '',
    ...over,
  };
}

const advice = (message: string): PlaybackFailureAdvice => ({ message } as PlaybackFailureAdvice);

/** 全部端口默认成功；用例按需覆盖单项。**零 mock 框架**——纯函数 + 注入端口。 */
function deps(over: Partial<ResolvePlaybackUrlDeps> = {}): ResolvePlaybackUrlDeps {
  return {
    resolveRouted: vi.fn(async () => ({ url: 'https://routed/a.mp3', nonFull: false })),
    sodaPlayableUrl: vi.fn(async () => 'https://soda/a.mp3'),
    forgetPrefetched: vi.fn(async () => {}),
    explainFailure: vi.fn(async () => advice('直连与全部订阅源均未命中')),
    ...over,
  };
}

describe('resolvePlaybackUrl（#639 C2：播放地址解析，零副作用）', () => {
  it('远程源：走路由解析链拿地址', async () => {
    const d = deps();
    const result = await resolvePlaybackUrl(song({ id: '1' }), d);

    expect(result.url).toBe('https://routed/a.mp3');
    expect(result.nonFull).toBe(false);
    expect(result.advice).toBeNull();
  });

  it('本地文件：直接用 song.url，**不**走解析链', async () => {
    const d = deps();
    const result = await resolvePlaybackUrl(
      song({ id: '1', sourceType: 'local', url: 'file:///music/a.mp3' }), d,
    );

    expect(result.url).toBe('file:///music/a.mp3');
    expect(d.resolveRouted).not.toHaveBeenCalled();
  });

  it('汽水且无 url：走分享页直链，不走路由链', async () => {
    const d = deps();
    const result = await resolvePlaybackUrl(song({ id: '1', sourceType: 'soda' }), d);

    expect(result.url).toBe('https://soda/a.mp3');
    expect(d.resolveRouted).not.toHaveBeenCalled();
    expect(d.sodaPlayableUrl).toHaveBeenCalledWith('1');
  });

  it('fresh：先遗忘预取条目再重走解析链', async () => {
    const calls: string[] = [];
    const d = deps({
      forgetPrefetched: vi.fn(async () => { calls.push('forget'); }),
      resolveRouted: vi.fn(async () => { calls.push('resolve'); return { url: 'https://r/a.mp3' }; }),
    });

    await resolvePlaybackUrl(song({ id: '1' }), d, { fresh: true });

    expect(calls).toEqual(['forget', 'resolve']);
  });

  it('非 fresh：不遗忘（首次播放没有「刚失败的直链」）', async () => {
    const d = deps();
    await resolvePlaybackUrl(song({ id: '1' }), d, { fresh: false });

    expect(d.forgetPrefetched).not.toHaveBeenCalled();
  });

  it('解析链抛错：不抛给调用方，取归因后返回空 url', async () => {
    const d = deps({
      resolveRouted: vi.fn(async () => { throw new Error('chain down'); }),
      explainFailure: vi.fn(async () => advice('源都试了没命中')),
    });

    const result = await resolvePlaybackUrl(song({ id: '1' }), d);

    expect(result.url).toBe('');
    expect(result.advice?.message).toBe('源都试了没命中');
  });

  it('解析链返回空串：也取归因（与抛错同一条尾巴）', async () => {
    const d = deps({
      resolveRouted: vi.fn(async () => ({ url: '' })),
      explainFailure: vi.fn(async () => advice('tier3 未开启')),
    });

    const result = await resolvePlaybackUrl(song({ id: '1' }), d);

    expect(result.url).toBe('');
    expect(result.advice?.message).toBe('tier3 未开启');
  });

  it('归因本身失败：advice 为 null（调用方退回通用文案）', async () => {
    const d = deps({
      resolveRouted: vi.fn(async () => ({ url: '' })),
      explainFailure: vi.fn(async () => { throw new Error('no advice'); }),
    });

    const result = await resolvePlaybackUrl(song({ id: '1' }), d);

    expect(result.url).toBe('');
    expect(result.advice).toBeNull();
  });

  it('试听版（nonFull）：标记 nonFull、回写歌曲对象、通知宿主', async () => {
    const onNonFull = vi.fn();
    const d = deps({
      resolveRouted: vi.fn(async () => ({ url: 'https://r/a.mp3', nonFull: true })),
      onNonFull,
    });
    const target = song({ id: '1' });

    const result = await resolvePlaybackUrl(target, d);

    expect(result.url).toBe('https://r/a.mp3');
    expect(result.nonFull).toBe(true);
    expect(target.nonFull).toBe(true); // 回写歌对象（徽标依赖）
    expect(onNonFull).toHaveBeenCalledWith(target);
  });

  it('nonFull 但无 url：不算试听（没地址就播不了）', async () => {
    const onNonFull = vi.fn();
    const d = deps({
      resolveRouted: vi.fn(async () => ({ url: '', nonFull: true })),
      onNonFull,
    });

    const result = await resolvePlaybackUrl(song({ id: '1' }), d);

    expect(result.nonFull).toBe(false);
    expect(onNonFull).not.toHaveBeenCalled();
  });

  it('汽水直链失败：返回空 url，且不取解析链归因（它不是解析链）', async () => {
    const d = deps({
      sodaPlayableUrl: vi.fn(async () => { throw new Error('share page down'); }),
    });

    const result = await resolvePlaybackUrl(song({ id: '1', sourceType: 'soda' }), d);

    expect(result.url).toBe('');
    expect(d.explainFailure).not.toHaveBeenCalled();
  });
});
