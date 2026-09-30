import { create } from 'zustand'
import type { ShuffleState, Song } from '@mplayer/core'
import { createShuffleState, getNextSongIndex, stepShuffle, syncShuffleCursor } from '@mplayer/core'
import { useSettingsStore } from './settingsStore'
import { prefetchKey } from '../services/queuePrefetch'
import { planPlayNext, planPlayNextShuffle } from '../services/queueInsert'
import {
  ensureShuffleFor,
  loadShuffleState,
  orderMatchesQueue,
  sameOrder,
  saveShuffleState,
} from '../services/shuffleMode'

interface PlayerState {
  currentSong: Song | null;
  queue: Song[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  showPlayer: boolean;
  /** 播放准备中（解析直链/创建播放器）：UI 显示加载反馈，避免点击后无响应感 */
  preparing: boolean;
  /** 是否曾播放过（ADR-0008）：首次播放前隐藏迷你播放栏，此后队列清空仍显示空态 */
  hasPlayed: boolean;
  /**
   * 稳定随机序列（#511 方案 A / #519 移动端消费）：`null` = 尚无序列（进随机时按当前队列现洗）。
   *
   * 与 `queue`（成员 + 列表循环序）是**两份数据**：随机模式下播放推进（next/prev）、
   * 预取窗口定序、队列页展示、「下一首播放」的落点都由它说了算；换回列表循环时**保留但不参与**。
   * 契约唯一出处：ADR `2026-09-30-stable-shuffle-order.md`。
   */
  shuffle: ShuffleState | null;
  // actions
  play: (song: Song) => void;
  pause: () => void;
  resume: () => void;
  next: () => Song | null;
  prev: () => void;
  setQueue: (songs: Song[], startIndex?: number) => void;
  /**
   * 「下一首播放」（#495）：把 `song` 放到当前曲之后。
   *
   * 与桌面 #506（`playerStore.insertNext`）和 Android `QueueStore.insertAfterCurrent`
   * 同一套语义：已在队列 → **移动**（不复制、保留队列里那份对象、长度不变）；不在 → 插入；
   * 已在下一首位置 / 就是当前曲 → no-op（连点幂等）；当前曲不被打断。
   *
   * `started = true`：队列为空 / 没有当前曲（currentIndex < 0）→ **等价于开始播放这首**
   * （与桌面 #506 同口径），调用方据此决定要不要真正起播。
   * `moved` = 从队列别处移动过来。
   */
  insertNext: (song: Song) => { started: boolean; moved: boolean; noop: boolean };
  /**
   * 确保有一份覆盖当前队列的随机序（进随机、换队列、喂窗口前调用）。
   * 已有且仍是**这批歌**的排列 → 只把游标对到当前曲（不重洗，会话内顺序稳定）。
   */
  ensureShuffle: () => void;
  /** 把游标对到**当前曲**（原生推进 / 对账之后调用）；没有序列或没有当前曲时不动。 */
  syncShuffleCursorToCurrent: () => void;
  /** 冷启恢复：从 AsyncStorage 读回随机序（只补空，不覆盖内存里已有的）。 */
  hydrateShuffle: () => Promise<void>;
  setCurrentTime: (time: number) => void;
  setDuration: (dur: number) => void;
  setShowPlayer: (show: boolean) => void;
  setPreparing: (preparing: boolean) => void;
  /**
   * 原生对账入口（规格 §4.3）：后台期间队列索引的真相源是原生，
   * 回前台/事件到达时**单向**把原生状态写进 store。禁止双向写（否则出现第二个真相源）。
   * 只覆盖传入的字段，未传字段保持 store 现值。
   */
  applyNativeState: (patch: {
    song?: Song | null;
    index?: number;
    isPlaying?: boolean;
    currentTime?: number;
    duration?: number;
  }) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentSong: null,
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  showPlayer: false,
  preparing: false,
  hasPlayed: false,
  shuffle: null,

  play: (song) => set({ currentSong: song, isPlaying: true, currentTime: 0, hasPlayed: true }),
  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true }),

  next: () => {
    const { queue, currentIndex, shuffle } = get();
    const playMode = useSettingsStore.getState().playMode;

    // 随机（#519）：消费**稳定序列**——游标前进一格（没有序列就按当前队列现洗一份）。
    // 旧实现走 core 的「每次现抽」：无记忆 → 补窗每轮换一批（#519 的自激循环）。
    if (playMode === '随机播放' && queue.length > 0 && currentIndex >= 0) {
      const base = shuffle ?? createShuffleState(queue, { currentIndex });
      const step = stepShuffle(base, queue, 1);
      if (step.index < 0) return null;
      set({
        currentSong: queue[step.index],
        currentIndex: step.index,
        shuffle: step.state,
        isPlaying: true,
        currentTime: 0,
        hasPlayed: true,
      });
      return get().currentSong;
    }

    const nextIndex = getNextSongIndex(queue, currentIndex, playMode);
    if (nextIndex === -1) return null;
    set({ currentSong: queue[nextIndex], currentIndex: nextIndex, isPlaying: true, currentTime: 0, hasPlayed: true });
    return get().currentSong;
  },

  prev: () => {
    const { queue, currentIndex, shuffle } = get();
    if (queue.length === 0 || currentIndex < 0) return;
    const playMode = useSettingsStore.getState().playMode;

    if (playMode === '单曲循环') {
      set({ currentTime: 0, isPlaying: true });
      return;
    }

    // 随机（#519 = #511 的行为变更）：游标**后退一格**——回到序列里的上一张。
    // 旧实现与 next 共用同一「现抽」→ 回的是一张新随机曲，从不回上一张。
    if (playMode === '随机播放') {
      const base = shuffle ?? createShuffleState(queue, { currentIndex });
      const step = stepShuffle(base, queue, -1);
      if (step.index < 0) return;
      set({
        currentSong: queue[step.index],
        currentIndex: step.index,
        shuffle: step.state,
        isPlaying: true,
        currentTime: 0,
      });
      return;
    }

    const prevIdx = (currentIndex - 1 + queue.length) % queue.length;
    set({ currentSong: queue[prevIdx], currentIndex: prevIdx, isPlaying: true, currentTime: 0 });
  },

  insertNext: (song) => {
    const { queue, currentIndex, currentSong, shuffle } = get();
    const playMode = useSettingsStore.getState().playMode;
    // 队列为空 / 没有当前曲：没有「当前曲之后」这个位置 → 等价于开始播放这首（桌面 #506 同口径）
    if (queue.length === 0 || currentIndex < 0 || !currentSong) {
      const nextQueue = queue.length === 0 ? [song] : queue;
      const nextIndex = queue.length === 0 ? 0 : currentIndex;
      set({
        queue: nextQueue,
        currentIndex: nextIndex,
        currentSong: song,
        // 进随机后第一首：序列按这一首建（没有「之前」可谈）
        shuffle: playMode === '随机播放' ? ensureShuffleFor(nextQueue, nextIndex, shuffle) : shuffle,
        isPlaying: true,
        currentTime: 0,
        hasPlayed: true,
      });
      return { started: true, moved: false, noop: false };
    }
    // 当前曲的 index 优先按 key 反查（`play()` 只写 currentSong、不写 currentIndex），
    // 反查不到才退回 currentIndex。
    const byKey = queue.findIndex((s) => prefetchKey(s) === prefetchKey(currentSong));
    const current = byKey >= 0 ? byKey : Math.min(Math.max(currentIndex, 0), queue.length - 1);

    // 随机（#519）：落点由**随机序**说了算——插到序列里当前曲的下一格；成员序不重排
    // （新歌追加到成员末尾）。无 id 的歌进不了 id 序列 → 退回顺序路径（见 shuffleMode.canShuffle）。
    if (playMode === '随机播放' && song.id && queue.every((s) => !!s.id)) {
      const shuffled = planPlayNextShuffle(queue, current, song, shuffle);
      if (shuffled.noop) return { started: false, moved: false, noop: true };
      set({ queue: shuffled.queue, shuffle: shuffled.shuffle, hasPlayed: true });
      return { started: false, moved: shuffled.moved, noop: false };
    }

    const plan = planPlayNext(queue, current, song, useSettingsStore.getState().playMode);
    if (plan.noop) return { started: false, moved: false, noop: true };
    // currentIndex 由 indexOf(currentSong) 重新推导，`next()` 因此仍指向同一首
    const nextCurrent = plan.sequence.findIndex((s) => prefetchKey(s) === prefetchKey(currentSong));
    set({
      queue: plan.sequence,
      currentIndex: nextCurrent >= 0 ? nextCurrent : currentIndex,
      hasPlayed: true,
    });
    return { started: false, moved: plan.moved, noop: false };
  },

  setQueue: (songs, startIndex = 0) => {
    if (songs.length === 0) return;
    const idx = Math.max(0, Math.min(startIndex, songs.length - 1));
    const playMode = useSettingsStore.getState().playMode;
    const { shuffle } = get();
    // #519：同一批歌（封面回填 / 同列表再点播）→ 沿用既有序列，只对游标（不重洗）；
    // 换了歌单 → 随机模式下按新队列重洗一份，否则清掉（下次进随机再洗）。
    const nextShuffle = shuffle && orderMatchesQueue(shuffle.order, songs)
      ? syncShuffleCursor(shuffle, songs, idx)
      : playMode === '随机播放'
        ? ensureShuffleFor(songs, idx, null)
        : null;
    set({
      queue: songs,
      currentSong: songs[idx],
      currentIndex: idx,
      shuffle: nextShuffle,
      isPlaying: true,
      currentTime: 0,
      hasPlayed: true,
    });
  },

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (dur) => set({ duration: dur }),
  setShowPlayer: (show) => set({ showPlayer: show }),
  setPreparing: (preparing) => set({ preparing }),

  applyNativeState: (patch) => {
    const next: Partial<PlayerState> = {};
    if (patch.song !== undefined && patch.song) {
      next.currentSong = patch.song;
      next.hasPlayed = true;
    }
    if (patch.index !== undefined && patch.index >= 0) next.currentIndex = patch.index;
    if (patch.isPlaying !== undefined) next.isPlaying = patch.isPlaying;
    if (patch.currentTime !== undefined && Number.isFinite(patch.currentTime)) {
      next.currentTime = patch.currentTime;
    }
    if (patch.duration !== undefined && Number.isFinite(patch.duration) && patch.duration > 0) {
      next.duration = patch.duration;
    }
    if (Object.keys(next).length > 0) set(next);
    // 原生推进 / 对账之后：随机模式下把游标对到**实际在播**的那首（序列本身不动）
    if ((patch.song || (patch.index !== undefined && patch.index >= 0)) &&
      useSettingsStore.getState().playMode === '随机播放') {
      get().syncShuffleCursorToCurrent();
    }
  },

  ensureShuffle: () => {
    const { queue, currentIndex, shuffle } = get();
    if (queue.length === 0) return;
    const next = ensureShuffleFor(queue, currentIndex, shuffle);
    if (next === shuffle) return;
    if (shuffle && next && sameOrder(shuffle.order, next.order) && shuffle.cursor === next.cursor) return;
    set({ shuffle: next });
  },

  syncShuffleCursorToCurrent: () => {
    const { queue, currentIndex, currentSong, shuffle } = get();
    if (!shuffle || !currentSong || queue.length === 0) return;
    const byKey = queue.findIndex((s) => prefetchKey(s) === prefetchKey(currentSong));
    const index = byKey >= 0 ? byKey : currentIndex;
    if (index < 0 || index >= queue.length) return;
    const next = syncShuffleCursor(shuffle, queue, index);
    if (sameOrder(shuffle.order, next.order) && shuffle.cursor === next.cursor) return;
    set({ shuffle: next });
  },

  hydrateShuffle: async () => {
    if (get().shuffle) return;
    const restored = await loadShuffleState();
    if (!restored || get().shuffle) return;
    const { queue, currentIndex } = get();
    // 盘上的序列可能属于更大的歌单（冷启后 JS 队列 = 原生窗口）→ 对齐到当前队列与当前曲
    const aligned = queue.length > 0 ? syncShuffleCursor(restored, queue, currentIndex) : restored;
    set({ shuffle: aligned });
    console.log(`[player] 随机序已从盘上恢复：${aligned.order.length} 首（游标 ${aligned.cursor}）`);
  },
}));

/**
 * 序列变化即落盘（#519 验收第 3 条：重启后顺序不变）。
 *
 * 单一出口：各 action 只改内存，持久化只发生在这里，避免「某个 action 忘了写盘」。
 * 与桌面 `persistQueue(queue, index, shuffle)` 同一职责（移动端只存序列，队列由原生快照恢复）。
 */
usePlayerStore.subscribe((state, prev) => {
  if (state.shuffle !== prev.shuffle) saveShuffleState(state.shuffle);
});
