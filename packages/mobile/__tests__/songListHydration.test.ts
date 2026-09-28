import { describe, expect, it, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Song } from '@mplayer/core';
import {
  VIEWPORT_SETTLE_MS,
  createViewportLyricsSettler,
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

afterEach(() => {
  vi.useRealTimers();
});

/**
 * #429：把「行进入视口」接到歌词预取。这一层只做「视口 → 候选」的翻译与**停稳判定**，
 * 去重 / single-flight / 取消 / 预算在 core `shared/lyricsHydrator`，并发与限速在 transport。
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
  });
});
