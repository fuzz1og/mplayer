import {
  createShuffleState,
  syncShuffleCursor,
  replaceShuffleSongId,
  type PlayMode,
  type ShuffleState,
  type Song,
} from '@mplayer/core';

/**
 * 队列状态转移的**唯一入口**（#639 C1）。
 *
 * ## 为什么要它
 *
 * 队列状态是**一份**东西（成员序 + 当前下标 + 随机序 + 游标），但它此前从 14 个
 * action 各写一遍同一个三连：
 *
 * ```ts
 * const nextShuffle = syncShuffle(get(), next, idx, opts);
 * set({ currentPlaylist: next, currentPlaylistIndex: idx, shuffle: nextShuffle });
 * persistQueue(next, idx, nextShuffle);
 * ```
 *
 * 每一次漏掉或写错一格，游标就与当前曲**静默脱节**——本仓为此修过三次
 * （#511 评审的「失败跳歌漏同步」、`play()` 的「预取顺序反了」、#639 R3）。
 * 那些 bug 的形状都一样：**下标变了、随机序没跟上**。本模块让这两件事
 * 在类型上无法分开：`planQueueState` 同时产出 `index` 与 `shuffle`。
 *
 * ## 边界（不纳入的）
 * - `currentSong`：它不是 `playlist[index]` 的严格派生——点歌时存的是用户点的那份
 *   对象、队列里可能是另一份副本，合并会改变封面等行为。**有意留在调用方**。
 * - 落盘：走 store 的订阅单一出口（见 `playerStore` 的 `persistQueue` 订阅），
 *   不在本模块内做 I/O —— 纯函数才可零 mock 单测。
 */

/** 生成随机序列时的策略（决定「要不要游标跟随」「要不要现洗」「要不要重洗」）。 */
export type ShufflePolicy =
  /** 成员增删 / 拖拽：已有序列就增量对齐，**不**现洗（没有序列就保持 null）。 */
  | 'align'
  /** 播放落点变了：从新的成员下标**推导**游标（没有序列且随机模式时现洗一份）。 */
  | 'locate'
  /** 接受调用方**已算好**的序列（core `planAdvance` / `pickNextSongAfterFailure` 给的权威值）。 */
  | 'settle'
  /** 整批换队列：id 集合变了才允许重洗，同一批歌保持既有顺序。 */
  | 'reseed'
  /** 原位换源：先在序列里把 fromId 就地换成 toId（同一格），再对齐。 */
  | 'replace-id'
  /** 播放模式变更（进随机时现洗并落游标）。 */
  | 'mode';

export interface QueueState {
  playlist: Song[];
  index: number;
  shuffle: ShuffleState | null;
  playMode: PlayMode;
}

export interface QueueChange {
  /** 新的成员序（成员类变更传新数组；纯落点/模式变更传原数组）。 */
  playlist: Song[];
  /** 新的当前下标（-1 = 无当前曲）。 */
  index: number;
  policy: ShufflePolicy;
  /** `settle` 时 core 算好的权威序列。 */
  settled?: ShuffleState | null;
  /** `replace-id` 的就地换 id。 */
  replaceId?: { from: string; to: string };
  /** 覆盖用的播放模式（`mode` policy）；缺省取 state.playMode。 */
  playMode?: PlayMode;
}

/** 两份队列是否同一批歌（只看 id 集合）——区分「整批换队列」与「同一队列原地改」。 */
function sameSongIdSet(a: readonly Song[], b: readonly Song[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((s) => s.id));
  return b.every((s) => ids.has(s.id));
}

/**
 * 规划一次队列状态转移：返回**同时**算好的 `playlist` / `index` / `shuffle`。
 *
 * 调用方拿到的三元组一定自洽——这正是本模块存在的理由（下标与随机序无法分开改）。
 */
export function planQueueState(state: QueueState, change: QueueChange): QueueState {
  const { playlist, index, policy } = change;
  const playMode = change.playMode ?? state.playMode;

  switch (policy) {
    // core 已算好权威序列：原样接受（游标值归 core，不再二次推导）
    case 'settle':
      return { playlist, index, shuffle: change.settled ?? null, playMode };

    // 原位换源：同一格换 id，顺序与游标不动
    case 'replace-id': {
      const base = state.shuffle && change.replaceId
        ? replaceShuffleSongId(state.shuffle, change.replaceId.from, change.replaceId.to)
        : state.shuffle;
      return { playlist, index, shuffle: base ? syncShuffleCursor(base, playlist, index) : null, playMode };
    }

    // 整体重洗：id 集合变了才重洗（同一批歌只对齐）
    case 'reseed': {
      const reseed = !sameSongIdSet(state.playlist, playlist);
      if (!state.shuffle || reseed) {
        return {
          playlist, index,
          shuffle: playMode === '随机播放' && playlist.length > 0
            ? createShuffleState(playlist, { currentIndex: index })
            : null,
          playMode,
        };
      }
      return { playlist, index, shuffle: syncShuffleCursor(state.shuffle, playlist, index), playMode };
    }

    // 落点：没有序列时按模式决定要不要现洗（随机才现洗），有则对游标
    case 'locate': {
      if (!state.shuffle) {
        return {
          playlist, index,
          shuffle: playMode === '随机播放' && playlist.length > 0
            ? createShuffleState(playlist, { currentIndex: index })
            : null,
          playMode,
        };
      }
      return { playlist, index, shuffle: syncShuffleCursor(state.shuffle, playlist, index), playMode };
    }

    // 模式变更：进随机时「确保有序列且游标落当前曲」（没有就现洗）；其余模式序列保留不参与
    case 'mode': {
      if (playMode !== '随机播放') return { playlist, index, shuffle: state.shuffle, playMode };
      if (state.shuffle) {
        return { playlist, index, shuffle: syncShuffleCursor(state.shuffle, playlist, index), playMode };
      }
      return {
        playlist, index,
        shuffle: playlist.length > 0 ? createShuffleState(playlist, { currentIndex: index }) : null,
        playMode,
      };
    }

    // 成员增删 / 拖拽：只对齐既有序列，**不**凭空建（没有序列就保持没有）
    case 'align':
    default:
      return {
        playlist, index,
        shuffle: state.shuffle ? syncShuffleCursor(state.shuffle, playlist, index) : null,
        playMode,
      };
  }
}
