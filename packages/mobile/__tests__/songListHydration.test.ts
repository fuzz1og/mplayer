import { describe, expect, it, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  awaitLyricsHydrationIdle,
  cacheManager,
  getLyricsHydrationStats,
  getOutboundGateStats,
  resetLyricsHydrator,
  resetOutboundGate,
  setOutboundGateOptions,
  setTransport,
  setTransportRetryOptions,
} from '@mplayer/core';
import type { LyricsHydrationCandidate, Song } from '@mplayer/core';
import {
  VIEWPORT_SETTLE_MS,
  createViewportLyricsSettler,
  lyricsCandidateKey,
  lyricsCandidatesOfRows,
} from '../components/songListHydration';
import type { SongListRow } from '../components/songListLayout';

/** 读仓库内源文件（vitest root = packages/mobile） */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');
/** 源码断言必须去掉注释：注释里常常**引用**被禁掉的旧写法，否则守卫会误伤自己 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function song(id: string, sourceType: Song['sourceType'] = 'netease'): Song {
  return { id, name: 'x', artist: 'y', album: '', url: '', cover: '', lrc: '', duration: 1, sourceType };
}
const songRow = (id: string, sourceType: Song['sourceType'] = 'netease'): SongListRow => ({
  kind: 'song',
  key: `s${id}`,
  song: song(id, sourceType),
});
const candidates = (ids: string[]): LyricsHydrationCandidate[] =>
  ids.map((id) => ({ sourceType: 'netease', id }));

afterEach(() => {
  vi.useRealTimers();
  // 集成用例碰了 core 的全局单例（hydrator 在飞表 / transport 闸门 / 歌词缓存）：逐个还原，
  // 免得漏进同进程的其它 mobile 用例。
  resetLyricsHydrator();
  resetOutboundGate();
  setTransport(null);
  setTransportRetryOptions(null);
  cacheManager.clearAll();
});

/**
 * #429：把「行进入视口」接到歌词预取。这一层只做「视口 → 候选」的翻译、**停稳判定**与
 * **可见集合差集**；去重 / single-flight / 取消 / 预算在 core `shared/lyricsHydrator`，
 * 并发与限速在 transport。
 */
describe('视口 → 歌词预取候选（#429）', () => {
  it('只有歌曲行成为候选：分区头 / 组头跳过，顺序保持', () => {
    const rows: SongListRow[] = [
      { kind: 'sectionHeader', key: 'h', title: '历史' },
      songRow('1'),
      { kind: 'groupHeader', key: 'g', title: '歌手A' },
      songRow('2', 'qq'),
      songRow('3'),
    ];

    expect(lyricsCandidatesOfRows(rows)).toEqual([
      { sourceType: 'netease', id: '1' },
      { sourceType: 'qq', id: '2' },
      { sourceType: 'netease', id: '3' },
    ]);
  });

  it('空列表 → 空候选（不入队）', () => {
    expect(lyricsCandidatesOfRows([])).toEqual([]);
  });

  it('候选身份键 = 源:id；缺源或缺 id 返回 null（不参与差集，也不会被当成同一个 key）', () => {
    expect(lyricsCandidateKey({ sourceType: 'netease', id: '1' })).toBe('netease:1');
    expect(lyricsCandidateKey({ sourceType: 'netease', id: 12 })).toBe('netease:12');
    expect(lyricsCandidateKey({ sourceType: null, id: '1' })).toBeNull();
    expect(lyricsCandidateKey({ sourceType: 'netease', id: null })).toBeNull();
    expect(lyricsCandidateKey({ sourceType: 'netease' })).toBeNull();
  });
});

describe('停稳闸：上滑中不入队（#429 / #421）', () => {
  it('可见集合一直变时一次都不交付，停稳后只交付最后一屏', () => {
    vi.useFakeTimers();
    const delivered: unknown[] = [];
    const settler = createViewportLyricsSettler({ enqueue: (c) => delivered.push(c) });

    settler.onViewableRows([songRow('1')]);
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS / 2);
    settler.onViewableRows([songRow('2')]);
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS / 2);
    settler.onViewableRows([songRow('3')]);
    // 一直在滑：窗口每次被推后，一屏都没交付（上滑不抢帧、也不出网）
    expect(delivered).toEqual([]);

    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);
    expect(delivered).toEqual([[{ sourceType: 'netease', id: '3' }]]);
  });

  it('停稳后可见集合里没有歌（只有标题行）→ 不交付空批次', () => {
    vi.useFakeTimers();
    const delivered: unknown[] = [];
    const settler = createViewportLyricsSettler({ enqueue: (c) => delivered.push(c) });

    settler.onViewableRows([{ kind: 'sectionHeader', key: 'h', title: '历史' }]);
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);
    expect(delivered).toEqual([]);
  });

  it('dispose 丢掉待交付项；flush 可立刻结算', () => {
    vi.useFakeTimers();
    const delivered: unknown[] = [];
    const settler = createViewportLyricsSettler({ enqueue: (c) => delivered.push(c) });

    settler.onViewableRows([songRow('1')]);
    settler.flush();
    expect(delivered).toEqual([[{ sourceType: 'netease', id: '1' }]]);

    settler.onViewableRows([songRow('2')]);
    settler.dispose();
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS * 2);
    expect(delivered).toHaveLength(1);
  });
});

describe('停稳那一拍的可见集合差集（#429 必修 1）', () => {
  it('只收回本次真的滑出可见集合的行；重新滑入会再次交付', () => {
    vi.useFakeTimers();
    const enqueued: LyricsHydrationCandidate[][] = [];
    const cancelled: LyricsHydrationCandidate[][] = [];
    const settler = createViewportLyricsSettler({
      enqueue: (c) => enqueued.push(c),
      cancel: (c) => cancelled.push(c),
    });

    settler.onViewableRows([songRow('1'), songRow('2')]);
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);
    expect(enqueued).toEqual([candidates(['1', '2'])]);
    // 第一次停稳没有基线可差：不该凭空取消
    expect(cancelled).toEqual([]);

    // 行 1 滑出、行 3 滑入：停稳这一拍只收回 1
    settler.onViewableRows([songRow('2'), songRow('3')]);
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);
    expect(cancelled).toEqual([candidates(['1'])]);
    expect(enqueued[1]).toEqual(candidates(['2', '3']));

    // 行 1 重新滑入：重新交付（取消过的 key 在 core 里不算已结算），且没有任何行离开
    settler.onViewableRows([songRow('1'), songRow('2'), songRow('3')]);
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);
    expect(cancelled).toHaveLength(1);
    expect(enqueued[2]).toEqual(candidates(['1', '2', '3']));
  });

  it('滑动途中的中间集合不参与差集：滑回原样不算「离开」', () => {
    vi.useFakeTimers();
    const cancelled: LyricsHydrationCandidate[][] = [];
    const enqueued: LyricsHydrationCandidate[][] = [];
    const settler = createViewportLyricsSettler({
      enqueue: (c) => enqueued.push(c),
      cancel: (c) => cancelled.push(c),
    });

    settler.onViewableRows([songRow('1')]);
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);
    expect(enqueued).toEqual([candidates(['1'])]);

    // 甩动过程中报出的中间集合：每次都把停稳窗口推后，从没成为「上一次交付」
    settler.onViewableRows([songRow('2'), songRow('3')]);
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS / 2);
    settler.onViewableRows([songRow('4')]);
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS / 2);
    settler.onViewableRows([songRow('1')]);
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);

    // 1 始终可见 → 没有行离开，不该收回任何 key；中间集合里的 2/3/4 从未被交付过。
    // （停稳那一拍总会再交一次当前整屏；同一 key 的重复交付由 core 的 single-flight 吃掉。）
    expect(cancelled).toEqual([]);
    expect(enqueued).toEqual([candidates(['1']), candidates(['1'])]);
  });
});

describe('停稳闸 → core hydrator：差集取消真的收回（#429 必修 1 端到端）', () => {
  it('行滑出可见集合 → 排队项从闸门摘除、从未进入底层传输；再次滑入仍可重新入队', async () => {
    vi.useRealTimers();
    setTransportRetryOptions({ maxRetries: 0, baseDelayMs: 0 });
    // 每 host 上限 1：两条在飞里只有一条真的进底层传输，另一条留在闸门队列里。
    setOutboundGateOptions({ maxGlobal: 6, maxPerHost: 1 });

    const seen: string[] = [];
    const release: (() => void)[] = [];
    setTransport(
      (req) =>
        new Promise((resolve) => {
          seen.push(req.url);
          release.push(() =>
            resolve({ status: 200, headers: {}, body: '{}', finalUrl: req.url })
          );
        })
    );

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    // 用真 core hydrator（不注入 enqueue/cancel）+ 真 transport 闸门：这条是接线本身的守卫。
    const settler = createViewportLyricsSettler({ settleMs: 10 });

    settler.onViewableRows([songRow('1'), songRow('2')]);
    await sleep(80);
    expect(getLyricsHydrationStats().dispatched).toBe(2);
    expect(seen).toHaveLength(1);
    expect(getOutboundGateStats().queued).toBe(1);

    // 两行都滑出可见集合：停稳那一拍对两个 key 收回
    settler.onViewableRows([]);
    await sleep(80);
    expect(getLyricsHydrationStats().cancelled).toBe(2);
    expect(getLyricsHydrationStats().settled).toBe(0); // 取消不算已结算
    expect(getOutboundGateStats().queued).toBe(0); // 排队项已从闸门摘除
    expect(seen).toHaveLength(1); // 被取消的排队项从未触达底层传输

    release.forEach((fn) => fn());
    await awaitLyricsHydrationIdle();

    // 重新滑入 → 重新入队（`dispatched` 从 2 涨到 3，说明这一 key 没有被记成已结算）
    settler.onViewableRows([songRow('1')]);
    await sleep(80);
    expect(getLyricsHydrationStats().dispatched).toBe(3);

    settler.dispose();
  });
});

describe('SongList 消费视口接缝（#429）', () => {
  it('FlatList 挂了 viewabilityConfig / onViewableItemsChanged，并转交停稳闸与 hydrator', () => {
    const src = stripComments(read('components/SongList.tsx'));
    expect(src).toContain('viewabilityConfig');
    expect(src).toContain('onViewableItemsChanged');
    expect(src).toContain('createViewportLyricsSettler');
    expect(src).toContain('enqueueLyricsHydration');
    // 回调必须是稳定引用（RN 不支持热换 onViewableItemsChanged，换了会重设追踪）
    expect(src).toMatch(/onViewableItemsChanged = useRef\(/);
    // 卸载收回本列表入队的 key（hydrator 是全局单例，不做整体清场）
    expect(src).toContain('cancelLyricsHydration');
    expect(src).toContain('.dispose()');
    // 行滑出可见集合的收回：停稳闸用同一个身份键回调 cancel（#429 必修 1）
    expect(src).toContain('lyricsCandidateKey');
    expect(src).toMatch(/cancel: \(candidates\)/);
  });
});
