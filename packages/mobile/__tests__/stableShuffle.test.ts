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

/**
 * #520 blocker 1（评审）：冷启/对账把 JS 队列换成原生快照（= 预取窗口）后，**不能**用全量
 * normalize 对齐——窗口外的 id 会被丢掉，而且 store 订阅立刻落盘 ⇒ 随机序**永久截断**
 * （评审实测 12 首 → 5 首；Android 上只要歌单 > 窗口就必现）。
 *
 * 作用域（Lead 二轮补充，避免把「截断 bug」换成「膨胀 bug」）：
 * - **窗口态**（对账 / 冷启 hydrate / 逐曲游标同步）：**只补不丢**；
 * - **权威态**（`setQueue` 拿到整张歌单）：裁剪幽灵 id + 补新成员；id 集合变化则整批重洗。
 */
describe('#520 blocker 1：窗口态只补不丢，权威态才裁剪', () => {
  const FULL = Array.from({ length: 12 }, (_, i) => `s${i}`);
  const WINDOW = ['s2', 's3', 's4', 's5', 's6'];

  function windowState(): void {
    const q = WINDOW.map(song);
    usePlayerStore.setState({ queue: q, currentSong: q[1], currentIndex: 1, hasPlayed: true });
  }

  it('窗口态：冷启后 12 首序列仍是 12 首（不截断，落盘也是 12）', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify({ order: FULL, cursor: 0 }));
    windowState();
    await usePlayerStore.getState().hydrateShuffle();

    const st = usePlayerStore.getState().shuffle;
    expect(st?.order).toHaveLength(12);
    expect(st?.order).toEqual(FULL);
    expect(st?.cursor).toBe(FULL.indexOf('s3'));
    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(SHUFFLE_STORAGE_KEY, JSON.stringify(st));
  });

  it('窗口态：对账（syncShuffleCursorToCurrent）不裁剪序列', () => {
    usePlayerStore.setState({ shuffle: { order: FULL, cursor: 0 } });
    windowState();
    usePlayerStore.getState().syncShuffleCursorToCurrent();
    expect(usePlayerStore.getState().shuffle?.order).toEqual(FULL);
  });

  it('权威态：同一张歌单删掉一首后重新 setQueue → 裁剪幽灵 id', () => {
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: { order: FULL, cursor: 0 } });
    const members = FULL.filter((id) => id !== 's7').map(song);
    usePlayerStore.getState().setQueue(members, 0);

    const st = usePlayerStore.getState().shuffle;
    expect(st?.order).not.toContain('s7');
    expect(st?.order).toEqual(FULL.filter((id) => id !== 's7'));
  });

  it('权威态：换成另一张歌单 → 由新成员集重建（无幽灵、长度 = 新成员数）', () => {
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: { order: FULL, cursor: 0 } });
    usePlayerStore.getState().setQueue(['x0', 'x1', 'x2', 'x3'].map(song), 1);

    const st = usePlayerStore.getState().shuffle;
    expect(st?.order).toHaveLength(4);
    expect(new Set(st?.order)).toEqual(new Set(['x0', 'x1', 'x2', 'x3']));
    expect(st?.order.some((id) => id.startsWith('s'))).toBe(false);
  });
});

/** #520 minors：③ 坏 cursor 不能让 `next()` 原地返回；④ 重复 id 的队列展示行数不减。 */
describe('#520 minors', () => {
  it('minor 3a：store 里 cursor=0.5（非整数）不能让 next 原地返回当前曲', () => {
    setQueue(['A', 'B', 'C'], 0); // 当前 = A，且序列首也是 A：坏游标被当成 -1 时 next 会「原地返回」
    useSettingsStore.setState({ playMode: '随机播放' });
    usePlayerStore.setState({ shuffle: { order: ['A', 'C', 'B'], cursor: 0.5 } });

    const next = usePlayerStore.getState().next();
    expect(next).not.toBeNull();
    expect(next?.id).not.toBe('A');
    expect(usePlayerStore.getState().currentIndex).toBe(2); // 序列 A→C：下一首是 C
  });

  it('minor 3b：盘上的坏 cursor 在 load 处就夹取成 -1（脏值不进 store）', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(
      JSON.stringify({ order: ['C', 'A', 'B'], cursor: 0.5 })
    );
    // 队列为空（冷启早期）→ hydrate 只能原样存盘上的值，但必须是已夹取过的
    await usePlayerStore.getState().hydrateShuffle();
    expect(usePlayerStore.getState().shuffle).toEqual({ order: ['C', 'A', 'B'], cursor: -1 });
  });

  it('minor 4：重复 id 的队列在随机模式展示行数不减（按成员下标映射，不去重）', () => {
    const queue = ['A', 'B', 'A'].map(song);
    const display = selectQueueSongs(queue, '随机播放', { order: ['A', 'B'], cursor: 0 });
    expect(display).toHaveLength(3);
    expect(ids(display)).toEqual(['A', 'B', 'A']);
  });
});
