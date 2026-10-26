import {
  createShuffleState,
  syncShuffleCursor,
  replaceShuffleSongId,
  type PlayMode,
  type ShuffleState,
  type Song,
} from '@mplayer/core';

/**
 * 队列状态转移的**唯一入口**（#639 C1）。队列状态是**一份**东西（成员序 + 下标 + 随机序 + 游标），此前 14 个 action 各写一遍
 * `syncShuffle` + `set` + `persistQueue` 三连；漏写/写错一格，游标就与当前曲**静默脱节**（本仓为此修过三次，形状都是「下标变了、
 * 随机序没跟上」）。`planQueueState` 同时产出 `index` 与 `shuffle` 使其无法分开；`currentSong` 有意留调用方，落盘走 store 订阅出口。
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
  | 'mode'
  /**
   * **序列类**：拖拽改的是随机序**本身**（成员序不动）。调用方只给挪好的新顺序，
   * 游标由本模块对到当前曲——「顺序变了、游标没跟」正是这里要堵的形状。
   */
  | 'reorder-shuffle'
  /**
   * **终止类**：队列终止（成员清空 + 无当前曲 + 序列作废）。与 {@link QueueState} 的
   * 「落点归零」不是一回事：`playerStore.stop()` 只停播、队列与序列都保留（那是 `align` + index -1）。
   */
  | 'stop';

export interface QueueState {
  playlist: Song[];
  index: number;
  shuffle: ShuffleState | null;
  playMode: PlayMode;
}

export interface QueueChange {
  /** 新的成员序（成员类变更传新数组；纯落点/模式/序列变更传原数组；`stop` 忽略它）。 */
  playlist: Song[];
  /** 新的当前下标（-1 = 无当前曲；`stop` 忽略它，恒产出 -1）。 */
  index: number;
  policy: ShufflePolicy;
  /** `settle` 时 core 算好的权威序列。 */
  settled?: ShuffleState | null;
  /** `replace-id` 的就地换 id。 */
  replaceId?: { from: string; to: string };
  /** 覆盖用的播放模式（`mode` policy）；缺省取 state.playMode。 */
  playMode?: PlayMode;
  /**
   * `reorder-shuffle` 的**新随机序**（调用方只负责拖拽的数组数学，游标归本模块）。
   * 缺省/无序列时是空操作——没有序列就没有可拖拽的顺序。
   */
  order?: readonly string[];
}

/** 两份队列是否同一批歌（只看 id 集合）——区分「整批换队列」与「同一队列原地改」。 */
function sameSongIdSet(a: readonly Song[], b: readonly Song[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((s) => s.id));
  return b.every((s) => ids.has(s.id));
}

/** 随机模式下「没有序列就现洗一份、游标落当前曲」——locate / reseed / mode 三处同一口径。 */
function shuffleOrNull(playlist: readonly Song[], index: number, playMode: PlayMode): ShuffleState | null {
  return playMode === '随机播放' && playlist.length > 0
    ? createShuffleState(playlist, { currentIndex: index })
    : null;
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
        return { playlist, index, shuffle: shuffleOrNull(playlist, index, playMode), playMode };
      }
      return { playlist, index, shuffle: syncShuffleCursor(state.shuffle, playlist, index), playMode };
    }

    // 落点：没有序列时按模式决定要不要现洗（随机才现洗），有则对游标
    case 'locate': {
      if (!state.shuffle) {
        return { playlist, index, shuffle: shuffleOrNull(playlist, index, playMode), playMode };
      }
      return { playlist, index, shuffle: syncShuffleCursor(state.shuffle, playlist, index), playMode };
    }

    // 模式变更：进随机时「确保有序列且游标落当前曲」（没有就现洗）；其余模式序列保留不参与
    case 'mode': {
      if (playMode !== '随机播放') return { playlist, index, shuffle: state.shuffle, playMode };
      if (state.shuffle) {
        return { playlist, index, shuffle: syncShuffleCursor(state.shuffle, playlist, index), playMode };
      }
      return { playlist, index, shuffle: shuffleOrNull(playlist, index, playMode), playMode };
    }

    // 序列类：接受挪好的新顺序，游标对到当前曲（成员序原样不动）
    case 'reorder-shuffle': {
      if (!state.shuffle || !change.order) {
        return { playlist, index, shuffle: state.shuffle, playMode };
      }
      const order = [...change.order];
      const currentId = playlist[index]?.id;
      return {
        playlist, index, playMode,
        shuffle: { order, cursor: currentId ? order.indexOf(currentId) : -1 },
      };
    }

    // 终止类：**忽略入参**产出终态——调用方没有机会留下「成员清空了但序列还在」这种半截状态
    case 'stop':
      return { playlist: [], index: -1, shuffle: null, playMode };

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
