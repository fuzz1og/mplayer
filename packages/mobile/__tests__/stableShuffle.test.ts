/**
 * 稳定随机序列在移动端的消费（#519 = #511 方案 A 的移动端接线）。
 *
 * 契约唯一出处：ADR `docs/adr/2026-09-30-stable-shuffle-order.md` 的「移动端消费契约」。
 * 这里钉住四件事：
 * ① 随机序 + 游标（next 前进 / prev 回上一张 / 同会话不重洗）；
 * ② 「下一首播放」在随机序里的落点（= 当前曲的下一格）；
 * ③ 补窗不再自激：同一位置重复补窗计划收敛为同一批；
 * ④ 落盘 + 恢复（重启顺序不变）与队列页展示随机序。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ShuffleState, Song } from '@mplayer/core';
import { applyShuffleOrder } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useSettingsStore } from '../stores/settingsStore';
import { planNextIndexes } from '../services/queuePrefetch';
import { SHUFFLE_STORAGE_KEY, selectQueueSongs } from '../services/shuffleMode';

function song(id: string): Song {
  return { id, name: 'song-' + id, artist: 'artist', sourceType: 'netease' } as Song;
}

const ids = (list: readonly Song[]): string[] => list.map((s) => s.id);

function setQueue(queueIds: string[], currentIndex: number): Song[] {
  const queue = queueIds.map((id) => song(id));
  usePlayerStore.setState({
    queue,
    currentSong: queue[currentIndex] ?? null,
    currentIndex,
    hasPlayed: true,
  });
  return queue;
}

/** 显式给一份序列，测试不依赖洗牌随机源 */
const S = (order: string[], cursor = 0): ShuffleState => ({ order, cursor });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(AsyncStorage.setItem).mockClear();
  vi.mocked(AsyncStorage.getItem).mockReset();
  usePlayerStore.setState({ queue: [], currentSong: null, currentIndex: -1, hasPlayed: false, shuffle: null });
  useSettingsStore.setState({ playMode: '列表循环' });
});

describe('#519 ① 随机序 + 游标', () => {
  it('next 沿序列前进、prev 回上一张（不再现抽）', () => {
    setQueue(['A', 'B', 'C', 'D'], 0);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: S(['A', 'C', 'B', 'D'], 0) });
    // 旧实现（无序列）走 core 的「现抽」：固定随机源让旧行为可复现（会抽到 D）
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    expect(usePlayerStore.getState().next()?.id).toBe('C');
    expect(usePlayerStore.getState().currentIndex).toBe(2);
    expect(usePlayerStore.getState().shuffle).toEqual(S(['A', 'C', 'B', 'D'], 1));

    usePlayerStore.getState().prev();
    expect(usePlayerStore.getState().currentSong?.id).toBe('A');
    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(usePlayerStore.getState().shuffle).toEqual(S(['A', 'C', 'B', 'D'], 0));
  });

  it('来回切不重洗：序列内容稳定（同会话）', () => {
    setQueue(['A', 'B', 'C', 'D'], 0);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: S(['A', 'D', 'B', 'C'], 0) });
    vi.spyOn(Math, 'random').mockReturnValue(0.01);

    usePlayerStore.getState().next(); // D
    usePlayerStore.getState().next(); // B
    usePlayerStore.getState().prev(); // D
    usePlayerStore.getState().prev(); // A（回绕）
    expect(usePlayerStore.getState().currentSong?.id).toBe('A');
    expect(usePlayerStore.getState().shuffle?.order).toEqual(['A', 'D', 'B', 'C']);
    expect(usePlayerStore.getState().shuffle?.cursor).toBe(0);
  });

  it('prev 从序列开头回绕到末尾（不是重抽）', () => {
    setQueue(['A', 'B', 'C'], 0);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: S(['A', 'C', 'B'], 0) });
    usePlayerStore.getState().prev();
    expect(usePlayerStore.getState().currentSong?.id).toBe('B');
  });
});

describe('#519 ② 「下一首播放」的随机落点', () => {
  it('插到随机序里当前曲的下一格：成员追加、当前曲不动、序列移动', () => {
    setQueue(['A', 'B', 'C'], 0);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: S(['A', 'C', 'B'], 0) });

    const result = usePlayerStore.getState().insertNext(song('D'));
    expect(result.started).toBe(false);
    expect(result.moved).toBe(false);
    // 成员：新歌追加在末尾（成员序 = 列表循环序，不因随机被重排）
    expect(ids(usePlayerStore.getState().queue)).toEqual(['A', 'B', 'C', 'D']);
    // 序列：插在 A 之后
    expect(usePlayerStore.getState().shuffle?.order).toEqual(['A', 'D', 'C', 'B']);
    expect(usePlayerStore.getState().shuffle?.cursor).toBe(0);
    expect(usePlayerStore.getState().currentSong?.id).toBe('A');
    // 下一首真的变成 D
    expect(usePlayerStore.getState().next()?.id).toBe('D');
  });

  it('已是序列里的「下一格」→ noop（连点幂等）', () => {
    setQueue(['A', 'B', 'C'], 0);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: S(['A', 'C', 'B'], 0) });

    expect(usePlayerStore.getState().insertNext(song('C')).noop).toBe(true);
    expect(ids(usePlayerStore.getState().queue)).toEqual(['A', 'B', 'C']);
    expect(usePlayerStore.getState().shuffle?.order).toEqual(['A', 'C', 'B']);
  });
});

describe('#519 ③ 补窗不再自激', () => {
  it('随机模式：同一位置连续两次计划收敛为同一批（旧实现每轮重抽）', () => {
    const queue = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'].map(song);
    const shuffle: ShuffleState = { order: ['s0', 's3', 's6', 's1', 's4', 's7', 's2', 's5'], cursor: 0 };
    // 旧实现忽略 shuffle 参数 → 走现抽；给一个「每次调用都不同」的随机源，
    // 让它稳定地抽出一批与序列不同的下标（不靠运气红/绿）。
    let n = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      n += 1;
      return (n % 7) / 7;
    });

    const first = planNextIndexes(queue, 0, 3, new Set(), '随机播放', shuffle);
    const second = planNextIndexes(queue, 0, 3, new Set(), '随机播放', shuffle);
    expect(second).toEqual(first);

    // 且计划就是随机序里 s0 之后的三首（映射回成员下标）
    const ordered = applyShuffleOrder(queue, shuffle);
    const at = ordered.findIndex((s) => s.id === 's0');
    const expected = [1, 2, 3].map((k) => queue.indexOf(ordered[(at + k) % ordered.length]));
    expect(first).toEqual(expected);
  });

  it('已投喂的下一批不再重复投喂：同一稳态下第二轮计划为空', () => {
    const queue = ['s0', 's1', 's2', 's3'].map(song);
    const shuffle: ShuffleState = { order: ['s0', 's2', 's1', 's3'], cursor: 0 };
    const first = planNextIndexes(queue, 0, 3, new Set(), '随机播放', shuffle);
    const excluded = new Set(first.map((i) => queue[i].id));
    excluded.add('s0');
    const again = planNextIndexes(queue, 0, 3, excluded, '随机播放', shuffle);
    expect(again).toEqual([]);
  });
});

describe('#519 ④ 落盘 / 恢复 / 队列页', () => {
  it('序列变化即落盘；hydrate 在重启后恢复同一顺序', async () => {
    setQueue(['A', 'B', 'C'], 0);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.getState().ensureShuffle();
    const created = usePlayerStore.getState().shuffle;
    expect(created).toBeTruthy();
    expect(new Set(created?.order)).toEqual(new Set(['A', 'B', 'C']));
    expect(created?.cursor).toBe(created?.order.indexOf('A'));

    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(SHUFFLE_STORAGE_KEY, JSON.stringify(created));

    // 「重启」：内存清空，从盘上恢复
    usePlayerStore.setState({ shuffle: null });
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify(created));
    await usePlayerStore.getState().hydrateShuffle();
    expect(usePlayerStore.getState().shuffle).toEqual(created);

    // 不覆盖已有的内存序列（hydrate 只补空）
    usePlayerStore.setState({ shuffle: S(['B', 'A', 'C'], 1) });
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify(created));
    await usePlayerStore.getState().hydrateShuffle();
    expect(usePlayerStore.getState().shuffle).toEqual(S(['B', 'A', 'C'], 1));
  });

  it('ensureShuffle 幂等：切到随机不重洗；换歌单才重洗', () => {
    setQueue(['A', 'B', 'C', 'D'], 2);
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.getState().ensureShuffle();
    const first = usePlayerStore.getState().shuffle;
    usePlayerStore.getState().ensureShuffle();
    expect(usePlayerStore.getState().shuffle).toEqual(first);

    // 同一批歌原地改（封面回填 / 同列表再点播）→ 顺序不变
    usePlayerStore.setState({ queue: usePlayerStore.getState().queue.map((s) => ({ ...s, cover: 'x' })) });
    usePlayerStore.getState().ensureShuffle();
    expect(usePlayerStore.getState().shuffle?.order).toEqual(first?.order);

    // 换了歌单 → 序列换成新队列的排列
    usePlayerStore.getState().setQueue([song('X'), song('Y'), song('Z')], 1);
    const next = usePlayerStore.getState().shuffle;
    expect(new Set(next?.order)).toEqual(new Set(['X', 'Y', 'Z']));
    expect(next?.order[next.cursor]).toBe('Y');
  });

  it('队列页：随机模式显示随机序，其它模式显示成员序', () => {
    const queue = ['A', 'B', 'C', 'D'].map(song);
    const shuffle = S(['A', 'C', 'B', 'D'], 0);
    expect(ids(selectQueueSongs(queue, '随机播放', shuffle))).toEqual(['A', 'C', 'B', 'D']);
    expect(ids(selectQueueSongs(queue, '列表循环', shuffle))).toEqual(['A', 'B', 'C', 'D']);
    expect(ids(selectQueueSongs(queue, '随机播放', null))).toEqual(['A', 'B', 'C', 'D']);
    // 与 core 的展示语义同源（不在序列里的歌补在末尾）
    expect(selectQueueSongs(queue, '随机播放', shuffle)).toEqual(applyShuffleOrder(queue, shuffle));
  });
});
