import { create } from 'zustand'
import type { AdvanceEffect, ShuffleScope, ShuffleState, Song } from '@mplayer/core'
import {
  createShuffleState,
  planAdvance,
  replaceShuffleSongId as coreReplaceShuffleSongId,
} from '@mplayer/core'
import { useSettingsStore } from './settingsStore'
import { prefetchKey } from '../services/queuePrefetch'
import { planPlayNext, planPlayNextShuffle } from '../services/queueInsert'
import {
  alignShuffleForMembers,
  alignShuffleForWindow,
  ensureShuffleFor,
  loadShuffleState,
  orderCoversQueue,
  sameOrder,
  saveShuffleState,
} from '../services/shuffleMode'

/**
 * 当前曲在 `queue` 里的成员下标（#520 minor 3）：优先按 key 反查——`play()` 只写 currentSong、
 * 不写 currentIndex，所以下标以「正在播的那首」为准；反查不到才退回（夹取过的）currentIndex。
 */
function currentMemberIndex(queue: Song[], currentIndex: number, currentSong: Song | null): number {
  const byKey = currentSong ? queue.findIndex((s) => prefetchKey(s) === prefetchKey(currentSong)) : -1;
  return byKey >= 0 ? byKey : Math.min(Math.max(currentIndex, 0), queue.length - 1);
}

/** `advance` 的结果：core 决定的落点与 effect（宿主据此决定「怎么落」）。 */
export interface AdvanceOutcome {
  /** 目标成员下标；-1 = 无目标（`effect: 'none'`）。 */
  index: number;
  effect: AdvanceEffect;
}

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
  /**
   * 当前 `queue` 的**来源作用域**（#639 R1）：`authoritative` = 完整成员集，
   * `window` = 原生预取窗口的子集。由 `setQueue` 与原生对账写入，随机序相关的
   * 入口（`ensureShuffle` / `advance`）据此决定「能不能现洗 / 能不能裁」——
   * 不再靠每个调用点自己记得传。
   */
  queueScope: ShuffleScope;
  // actions
  play: (song: Song) => void;
  pause: () => void;
  resume: () => void;
  next: () => Song | null;
  prev: () => void;
  /**
   * 换队列。`scope`（#639 R1）**必须**与 `songs` 的真实身份相符：
   * - `authoritative`（缺省）——`songs` 是**完整成员集**（整张歌单 / 搜索结果整批）；
   * - `window`——`songs` 只是**原生预取窗口**（冷启对账、队列弹层回灌当前队列）。
   *
   * 传错会把窗口当全集：随机序被裁到窗口那几首并立刻落盘 ⇒ **永久截断**
   * （重启也回不来）。`window` 作用域下只补不丢、不重洗。
   */
  setQueue: (songs: Song[], startIndex?: number, scope?: ShuffleScope) => void;
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
   * 推进一格（#555：`next` / `prev` / `nativePrev` 的**唯一实现**）。
   *
   * 随机模式下先按窗口态对齐序列——没有序列就现洗一份（前置步骤）
   * （#520 minor 2/3：此前 store 与 nativePlayer 各复制了一份「步进游标 + 落 store」；
   * 且盘上/内存里的游标损坏或陈旧不得让推进失效），落点与 effect 一律由 core `planAdvance`
   * 决定，这里只执行 effect：`none` → 不动；`restart-current` → 重播当前曲（不换歌）；
   * `load-target` → 换到 `queue[index]`。
   *
   * 返回 `{ index, effect }`：JS 引擎按 effect 直接落地；原生引擎还要把这个 effect 交给
   * `nativePlayer.nativeStep` 决定**交付方式**（交原生顺序推进 / 起播目标曲 / seek 0 重播），
   * 所以 effect 必须随落点一起回来，不能让原生宿主自己猜（#555）。
   */
  advance: (direction: 1 | -1) => AdvanceOutcome;
  /**
   * 确保有一份覆盖当前队列的随机序（进随机、换队列、喂窗口前调用）。
   * 已有且仍是**这批歌**的排列 → 窗口态只补不丢地把游标对到当前曲（不重洗，会话内顺序稳定）。
   *
   * `scope`（#639 R1）与队列身份相符：`window` 时**没有序列就什么都不做**——
   * 拿窗口当全集现洗会落盘一份短序列（永久截断）。喂窗口（`feedWindow`）走缺省的
   * `authoritative`：那时能走到这里说明已有序列，只对齐不重洗。
   */
  ensureShuffle: (scope?: ShuffleScope) => void;
  /** 原位换源（#520 blocker 2）：随机序里把 `fromId` **就地**换成 `toId`（同格换 id、顺序与游标不动）。 */
  replaceShuffleSongId: (fromId: string, toId: string) => void;
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
  // 初始无队列：按权威态起步（空队列下两个作用域等价，首次 setQueue 会写入真实来源）
  queueScope: 'authoritative',

  play: (song) => set({ currentSong: song, isPlaying: true, currentTime: 0, hasPlayed: true }),
  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true }),

  next: () => {
    // #555：随机模式也走同一条落点（core planAdvance，含「单曲循环 / 单元素 = 重播当前曲」），
    // effect 由 advance 执行——此前随机分支在这里 stepShuffle 后 return，绕开了 effect。
    return get().advance(1).index >= 0 ? get().currentSong : null;
  },

  prev: () => {
    // #555：与 next 同一条路（此前随机分支自己 stepShuffle 后 return）。
    // 单曲循环 + prev = 回上一首（不重播），由 core 的契约决定。
    get().advance(-1);
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

  setQueue: (songs, startIndex = 0, scope = 'authoritative') => {
    if (songs.length === 0) return;
    const idx = Math.max(0, Math.min(startIndex, songs.length - 1));
    const playMode = useSettingsStore.getState().playMode;
    const { shuffle } = get();
    // #639 R1：作用域**显式**。此前一律当权威成员集（注释里写着「入参是整张歌单，不是原生窗口」），
    // 但冷启对账（`reconcileQueueFromNative`）与队列弹层回灌（`QueueListModal`）传的正是**窗口**
    // ⇒ 窗口外的 id 被裁掉并立刻落盘，随机序永久截断（#520 实测 12 → 5）。
    // - `window`：只补不丢（不裁、不重洗），窗口外的 id 原样留在序列里；
    // - `authoritative`：完整成员集 → 允许裁幽灵 id；序列不覆盖这批歌 = 整批换队列 → 重洗。
    let nextShuffle: ShuffleState | null = shuffle;
    if (scope === 'window') {
      nextShuffle = shuffle ? alignShuffleForWindow(shuffle, songs, idx) : null;
    } else if (shuffle && orderCoversQueue(shuffle.order, songs)) {
      nextShuffle = alignShuffleForMembers(shuffle, songs, idx);
    } else if (playMode === '随机播放') {
      // 队列里出现了序列没有的歌 = 整批换歌单 → 按 ADR 重洗一份（此时旧序列整体作废）
      nextShuffle = ensureShuffleFor(songs, idx, null);
    } else {
      nextShuffle = null;
    }
    set({
      queue: songs,
      currentSong: songs[idx],
      currentIndex: idx,
      shuffle: nextShuffle,
      queueScope: scope,
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

  ensureShuffle: (scope) => {
    const { queue, currentIndex, shuffle, queueScope } = get();
    if (queue.length === 0) return;
    // #639 R1：作用域缺省取**队列自己的来源**（`setQueue` / 原生对账写入）——
    // 不再靠调用点记得传。窗口态下**没有序列就不得现洗**：拿窗口当全集洗出的是
    // 窗口那几首，store 订阅立刻落盘 ⇒ 随机序永久截断。窗口态只能等 `hydrateShuffle`
    // 从盘上恢复，或等一次**权威**入队（整张歌单）再建。
    const effectiveScope = scope ?? queueScope;
    const next = ensureShuffleFor(queue, currentIndex, shuffle, effectiveScope);
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
    // **窗口态**：对账/逐曲同步拿到的队列可能只是原生预取窗口 → 只补不丢（#520 blocker 1）
    const next = alignShuffleForWindow(shuffle, queue, index);
    if (sameOrder(shuffle.order, next.order) && shuffle.cursor === next.cursor) return;
    set({ shuffle: next });
  },

  hydrateShuffle: async () => {
    if (get().shuffle) return;
    const restored = await loadShuffleState();
    if (!restored || get().shuffle) return;
    const { queue, currentIndex } = get();
    // **窗口态**：冷启时 JS 队列 = 原生快照（预取窗口，可能是整张歌单的子集）
    // → 只补不丢，绝不 normalize（否则窗口外的 id 被删掉并立刻落盘 = 序列永久截断）
    const aligned = queue.length > 0 ? alignShuffleForWindow(restored, queue, currentIndex) : restored;
    set({ shuffle: aligned });
    console.log(`[player] 随机序已从盘上恢复：${aligned.order.length} 首（游标 ${aligned.cursor}）`);
  },

  advance: (direction) => {
    const { queue, currentIndex, currentSong, shuffle, queueScope } = get();
    if (queue.length === 0 || currentIndex < 0) return { index: -1, effect: 'none' };
    const playMode = useSettingsStore.getState().playMode;
    // 当前曲的成员下标：优先按 key 反查（`play()` 只写 currentSong、不写 currentIndex）。
    const at = playMode === '随机播放' ? currentMemberIndex(queue, currentIndex, currentSong) : currentIndex;
    // 前置步骤：随机模式没有序列时——**权威队列**才现洗（窗口队列现洗 = 落盘短序列、永久截断，
    // #639 R1）；窗口态把 `null` 交给 core 走兼容路径（不落盘、不建序列）。
    const base = shuffle
      ?? (playMode === '随机播放' && queueScope === 'authoritative'
        ? createShuffleState(queue, { currentIndex: at })
        : null);
    const plan = planAdvance({
      queue,
      currentIndex: at,
      playMode,
      shuffle: base,
      direction,
      shuffleScope: 'window',
    });
    if (plan.effect === 'none') return { index: -1, effect: 'none' };
    const patch: Partial<PlayerState> = { isPlaying: true, currentTime: 0, currentIndex: plan.index };
    if (plan.shuffle !== shuffle) patch.shuffle = plan.shuffle;
    // restart-current（单曲循环 / 单元素队列）：目标是当前曲——不换歌，只重播。
    if (plan.effect === 'load-target') {
      patch.currentSong = queue[plan.index];
      patch.hasPlayed = true;
    }
    set(patch);
    return { index: plan.index, effect: plan.effect };
  },

  replaceShuffleSongId: (fromId, toId) => {
    const { shuffle } = get();
    if (!shuffle) return;
    const next = coreReplaceShuffleSongId(shuffle, fromId, toId);
    if (next === shuffle) return;
    set({ shuffle: next });
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
