import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import {
  clearDirectClients,
  clearTier3Scheduling,
  registerDirectClient,
  resolvePlayableSongRouted,
  resolvePlayableUrlRouted,
  setDirectValidator,
  setSourceModes,
  setTier3Enabled,
  setTier3Resolver,
  type DirectSourceClient,
} from '../sourceRouter.js';
import { clearPrefetchCache, setPrefetchedUrl } from '../../api/prefetchCache.js';

/**
 * #622 守卫测试：编码归一只有一个落点——core 播放解析链的出口。
 *
 * 汽水 CDN 直链带未编码的 `|`（实测形态 `...&cd=0|0|0|5&...`）。JS 侧一路放行，
 * 但 `java.net.URI` 判它非法，移动端 `File.downloadFileAsync` 于是在原生层抛转换失败。
 * 下载链、播放链、预取都从 `resolvePlayableSongRouted` / `resolvePlayableUrlRouted`
 * 取 URL，所以归一做在这两条入口的共同内层——各条腿（直连 / 权威时长 / tier3 / 预取命中）
 * 都必须在出口处收敛，宿主侧不再各修一遍。
 */

/** 真机同形态的原始直链（签名段截短；query 里三处未编码的 `|`）。 */
const RAW = 'https://v5-se-ex-alismart-luna.douyinvod.com/6aca4e50/video/tos/cn/oQ0azIPV2TCTJtQ/?a=8478&cd=0|0|0|5&br=126';
/** 归一后的期望值：独立手写的字面量，只有 `|` → `%7C`，其余逐字不变。 */
const NORMALIZED =
  'https://v5-se-ex-alismart-luna.douyinvod.com/6aca4e50/video/tos/cn/oQ0azIPV2TCTJtQ/?a=8478&cd=0%7C0%7C0%7C5&br=126';

const sodaSong = (overrides: Partial<Song> = {}): Song => ({
  id: '7679694801201334312',
  name: '稻香',
  artist: '哇欣',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 269,
  sourceType: 'soda',
  ...overrides,
});

function makeClient(overrides: Partial<DirectSourceClient> = {}): DirectSourceClient {
  return {
    key: 'soda',
    resolvePlayableUrl: vi.fn(async () => RAW),
    ...overrides,
  };
}

beforeEach(() => {
  clearDirectClients();
  clearPrefetchCache();
  clearTier3Scheduling();
  setSourceModes({});
  setTier3Enabled(false);
  setTier3Resolver(null);
  // 直连取证默认真发一次 Range：本文件零 I/O，关掉（结论只影响 nonFull 标记）。
  setDirectValidator(null);
});

describe('播放解析链出口的 URL 编码归一（#622）', () => {
  it('⭐ 直连腿吐出未编码的 | → 出口是 %7C，其余字段不动', async () => {
    registerDirectClient(makeClient());

    const routed = await resolvePlayableSongRouted(sodaSong());

    expect(routed.url).toBe(NORMALIZED);
    expect(routed).toMatchObject({ nonFull: false, via: 'direct', guard: 'none' });
  });

  it('权威时长腿（soda track_v2 的 play_auth 形态）同样在出口归一', async () => {
    registerDirectClient(
      makeClient({
        resolveUrlInfo: vi.fn(async () => ({
          url: 'https://v5-se-ex-alismart-luna.douyinvod.com/x.mp3?cd=0|0|0|5&play_auth=TOKEN%20A',
          br: 320,
          size: 5242880,
          playTime: 269,
          fee: 0,
          payed: 1,
        })),
      })
    );

    const routed = await resolvePlayableSongRouted(sodaSong());

    // 已编码的 `%20` 不被二次编码，未编码的 `|` 归一。
    expect(routed.url).toBe(
      'https://v5-se-ex-alismart-luna.douyinvod.com/x.mp3?cd=0%7C0%7C0%7C5&play_auth=TOKEN%20A'
    );
  });

  it('URL 腿（resolvePlayableUrlRouted）与歌曲腿共用同一个出口，不各归一一次', async () => {
    registerDirectClient(makeClient());

    await expect(resolvePlayableUrlRouted(sodaSong())).resolves.toBe(NORMALIZED);
  });

  it('预取缓存里的存量脏 URL 也在出口收敛（缓存不是第二份口径）', async () => {
    const song = sodaSong();
    registerDirectClient(makeClient({ resolvePlayableUrl: vi.fn(async () => { throw new Error('不该走到直连'); }) }));
    setPrefetchedUrl(song, RAW, false);

    const routed = await resolvePlayableSongRouted(song);

    expect(routed.url).toBe(NORMALIZED);
    expect(routed.via).toBe('direct');
  });

  it('tier3 兜底腿交回的 URL 同样归一（脏 URL 不止来自直连）', async () => {
    registerDirectClient(makeClient({ resolvePlayableUrl: vi.fn(async () => '') }));
    setTier3Enabled(true);
    setTier3Resolver(async () => ({ url: RAW, guard: 'source-duration' }));

    const routed = await resolvePlayableSongRouted(sodaSong());

    expect(routed.url).toBe(NORMALIZED);
    expect(routed.via).toBe('tier3');
  });

  it('空 URL 原样上抛语义不变（无版权 / VIP 的空串不是「需要编码」）', async () => {
    registerDirectClient(makeClient({ resolvePlayableUrl: vi.fn(async () => '') }));

    const routed = await resolvePlayableSongRouted(sodaSong());

    expect(routed.url).toBe('');
  });
});
