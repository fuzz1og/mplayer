import type { PlayMode, Song } from '../types/index.js';
import {
  alignShuffleOrder,
  stepShuffle,
  type ShuffleScope,
  type ShuffleState,
} from './shuffleOrder.js';


/**
 * - `none`：无目标（队列空 / 下标越界）→ 宿主停播；- `restart-current`：目标就是当前曲（单曲循环的
 * 下一首）→ 宿主 seek(0) 重播，**不要**重新解析 URL（避免切走 → reload 的音轨闪烁，桌面既有行为）
 * ；- `load-target`：目标是另一首 → 宿主按 `index` 加载并播放。
 */
export type AdvanceEffect = 'none' | 'restart-current' | 'load-target';

/** 一次推进的完整结果（#541）。 */
export interface AdvancePlan {
  /** 目标歌曲在 `queue` 中的**成员下标**；-1 = 无目标（宿主按 effect='none' 处理）。 */
  index: number;
  /** 推进后的随机序列（游标已前进/后退）；非随机模式原样返回传入的 `shuffle`。 */
  shuffle: ShuffleState | null;
  effect: AdvanceEffect;
}

/** planAdvance 的入参（#541）：`shuffle` **必填**——表达「没有序列」请显式传 `null`。 */
export interface AdvanceInput {
  queue: readonly Song[];
  /** 当前播放曲的成员下标；-1 = 尚无当前曲。 */
  currentIndex: number;
  playMode: PlayMode;
  /**
   * 稳定随机序列。**必填**（#511 评审 major / #541）：此前该参数可选，
   * 移动端两个消费点忘传（audioPlayer.ts 的跳歌选曲与预取），而 core 缺失即静默退回
   * 「防重复现抽」——编译期不报错、运行期换了一套语义。必填后漏传在编译期就断。
   */
  shuffle: ShuffleState | null;
  /** 1 = 下一首，-1 = 上一首。 */
  direction: 1 | -1;
  /**
   * 随机序列的对齐**作用域**（#543/#555）：调用方手里的 `queue` 是完整成员集
   * （`authoritative`，缺省）还是只是原生**预取窗口**（`window`，只补不丢）。
   * 随机分支在推进前用它对序列做增量对齐，所以窗口语义也能走同一条推进路径。
   */
  shuffleScope?: ShuffleScope;
}

/**
 * 推进计划（#541）：**一次推进的唯一事实来源**。
 * 现在组合顺序藏在这里，宿主只按 `effect` 执行。
 */
export function planAdvance(input: AdvanceInput): AdvancePlan {
  const { queue, currentIndex, playMode, shuffle, direction, shuffleScope = 'authoritative' } = input;
  const none: AdvancePlan = { index: -1, shuffle, effect: 'none' };
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) return none;

  if (playMode === '单曲循环') {
    // 下一首 = 重播当前曲（桌面既有 seek 行为）；上一首 = 回上一首（不重播）。
    if (direction === 1) return { index: currentIndex, shuffle, effect: 'restart-current' };
    const prevIndex = (currentIndex - 1 + queue.length) % queue.length;
    return { index: prevIndex, shuffle, effect: 'load-target' };
  }

  if (playMode === '随机播放') {
    // 无序列：调用方显式传 null 时才走兼容路径（防重复现抽），有序列则消费序列。
    if (!shuffle) {
      const index = nextRandomIndex(queue, currentIndex);
      return { index, shuffle: null, effect: index === currentIndex ? 'restart-current' : 'load-target' };
    }
    const anchored = alignShuffleOrder(shuffle, queue, currentIndex, shuffleScope);
    const stepped = stepShuffle(anchored, queue, direction, shuffleScope);
    if (stepped.index < 0) return none;
    return {
      index: stepped.index,
      shuffle: stepped.state,
      effect: stepped.index === currentIndex ? 'restart-current' : 'load-target',
    };
  }

  // 列表循环（默认）
  const index = direction === 1
    ? (currentIndex + 1) % queue.length
    : (currentIndex - 1 + queue.length) % queue.length;
  return { index, shuffle, effect: index === currentIndex ? 'restart-current' : 'load-target' };
}

/**
 * 按播放模式计算下一首 index（纯函数）：单曲循环 → currentIndex；列表循环 → (i+1) % len；随机播放有稳定序列（#511）时消费游标、
 * 无序列退回现抽；队列空或 index 越界 → -1。`shuffleScope`（#639 R1）**必须**与调用方手里的 `queue` 相符（`authoritative` 完整集 /
 * `window` 预取窗口子集），否则同一份序列两套对齐口径、落点会分叉。
 */
export function getNextSongIndex(
  queue: Song[],
  currentIndex: number,
  playMode: PlayMode,
  shuffle?: ShuffleState | null,
  shuffleScope: ShuffleScope = 'authoritative',
): number {
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) return -1;
  if (playMode === '单曲循环') return currentIndex;
  if (playMode === '随机播放') {
    if (!shuffle) return nextRandomIndex(queue, currentIndex);
    return stepShuffle(alignShuffleOrder(shuffle, queue, currentIndex, shuffleScope), queue, 1, shuffleScope).index;
  }
  // 列表循环（默认）
  return (currentIndex + 1) % queue.length;
}

/**
 * 按播放模式计算上一首 index（纯函数，无副作用）。
 * 单曲循环与列表循环 → (i-1+len) % len（prev 刻意不做「单曲循环重播」，与桌面 playPrevious 一致）。随机播放（#511 行为变更）：
 * 有稳定序列时游标**后退一格**回到序列里的上一张（此前与 next 共用现抽），无序列保留旧现抽行为。`shuffleScope` 语义同 next。
 */
export function getPrevSongIndex(
  queue: Song[],
  currentIndex: number,
  playMode: PlayMode,
  shuffle?: ShuffleState | null,
  shuffleScope: ShuffleScope = 'authoritative',
): number {
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) return -1;
  if (playMode === '随机播放') {
    if (!shuffle) return nextRandomIndex(queue, currentIndex);
    return stepShuffle(alignShuffleOrder(shuffle, queue, currentIndex, shuffleScope), queue, -1, shuffleScope).index;
  }
  return (currentIndex - 1 + queue.length) % queue.length;
}


// ---------------------------------------------------------------- 曲末决策（#666）

/** 曲末动作。hold = 随机播到头，停在这里：不绕回、也不向 JS 要歌（与 ask-js 是两种不同的「不推进」）。 */
export type EndOfTrackAction = 'restart-current' | 'advance-next' | 'ask-js' | 'hold';

/** 随机播到序列末尾的产品语义。wrap 只是类型占位，当前不实现（ADR 2026-10-26 第 4 条）。 */
export type ShuffleEndPolicy = 'stop' | 'wrap';

/**
 * planEndOfTrack 的入参。与 {@link AdvanceInput} 同族：只吃纯数据，不碰播放器。hasNextInWindow 是原生几何事实，
 * windowSaturated 是本轮补窗事实——两者缺一都不能断言「随机到头」（#650 的病根就是只拿后者反推）。
 */
export interface EndOfTrackInput {
  playMode: PlayMode;
  /** 稳定随机序列；null = 没有序列 → 「随机到头」不可证，不得 hold。 */
  shuffle: ShuffleState | null;
  /**
   * 序列作用域。'authoritative'（缺省）= 队列是完整成员集，可据序列断言「到头」；
   * 'window' = 队列只是原生预取窗口的子集 → 序列可能缺成员，「到头」不可证。
   */
  shuffleScope?: ShuffleScope;
  /** 原生几何：播放列表里当前曲之后还有项。 */
  hasNextInWindow: boolean;
  /** 本轮补窗零新增（JS 上报 outcome 为 'deduped' / 'empty'）。 */
  windowSaturated: boolean;
  shuffleEndPolicy: ShuffleEndPolicy;
}

/** 一次曲末处置的结论。shuffle 原样透传——曲末不是一次「下一首」推进，游标不在这里动。 */
export interface EndOfTrackPlan {
  action: EndOfTrackAction;
  shuffle: ShuffleState | null;
}

/** 随机序游标是否已在序列末位；无序列/空序列一律 false（「到头」必须被证成，不能默认）。 */
function shuffleAtEnd(shuffle: ShuffleState | null): boolean {
  if (!shuffle || shuffle.order.length === 0) return false;
  return shuffle.cursor >= shuffle.order.length - 1;
}

/**
 * 曲末决策的唯一裁处（#666）：ADR 2026-10-26-end-of-track-decision-ownership 的 (c) 方案。
 * 顺序不可调换——单曲循环先于「窗口内有项」，与改前 Kotlin 的 endedAction 一致。
 */
export function planEndOfTrack(input: EndOfTrackInput): EndOfTrackPlan {
  const {
    playMode,
    shuffle,
    shuffleScope = 'authoritative',
    hasNextInWindow,
    windowSaturated,
    shuffleEndPolicy,
  } = input;
  const plan = (action: EndOfTrackAction): EndOfTrackPlan => ({ action, shuffle });

  // 单曲循环：曲末重播自己（原生 REPEAT_MODE_ONE 的防御分支）
  if (playMode === '单曲循环') return plan('restart-current');
  // 窗口里还有项：三种模式都顺序推进，不涉及「到头」判断
  if (hasNextInWindow) return plan('advance-next');
  // 随机播到头 = 序列末位（只有 core 看得见）+ 本轮零新增 同时成立；任一不成立都不得 hold。
  if (
    playMode === '随机播放' &&
    shuffleEndPolicy === 'stop' &&
    shuffleScope === 'authoritative' &&
    shuffleAtEnd(shuffle) &&
    windowSaturated
  ) {
    return plan('hold');
  }
  // 其余：列表循环绕回 / 随机未到头 / 序列缺失 / 本轮不确定 —— 都只能问 JS。
  // 'wrap' 刻意落在这里（= 今天的行为）：它只是类型占位，本轮不实现。
  return plan('ask-js');
}

/**
 * 下推原生的曲末策略表（#666 第 2 步）：把 playMode + 序列事实投影成原生可查表的形态，
 * 原生不再自己解释 playMode。与 planEndOfTrack 同源——atWindowTail 就是窗口尾那一次的结论。
 */
export interface EndOfTrackPolicy {
  /** 单曲循环 → 曲末重播当前曲（repeatMode 与 endedAction 共用这一格，拆开两者的隐式耦合）。 */
  restartOnSingle: boolean;
  /** 窗口里有下一项时是否顺序推进（三种模式当前恒 true）。 */
  advanceWithinWindow: boolean;
  /** 窗口尾动作：hold = 停在这里（随机到头），ask-js = 向 JS 要歌。另两个动作在窗口尾不可能出现。 */
  atWindowTail: 'ask-js' | 'hold';
  shuffleEndPolicy: ShuffleEndPolicy;
}

/** 下推表的入参：去掉几何事实（那是原生运行时才知道的）。 */
export type EndOfTrackPolicyInput = Omit<EndOfTrackInput, 'hasNextInWindow'>;

/**
 * 投影成下推表。不另写一套判定：窗口尾结论直接问 planEndOfTrack。
 * windowSaturated 由调用方给（那是本轮事实，只有 JS 知道），**不得在这里假定 true**——
 * 假定成立会把「本轮其实补进了新项」也下推成 hold（#650 病根）。
 */
export function buildEndOfTrackPolicy(input: EndOfTrackPolicyInput): EndOfTrackPolicy {
  const atWindowTail = planEndOfTrack({ ...input, hasNextInWindow: false }).action;
  return {
    restartOnSingle: input.playMode === '单曲循环',
    advanceWithinWindow: true,
    atWindowTail: atWindowTail === 'hold' ? 'hold' : 'ask-js',
    shuffleEndPolicy: input.shuffleEndPolicy,
  };
}
/** 随机防重复 index：队列 ≤ 1 归位 currentIndex，否则随机到不等于 currentIndex。
 *  **无序列时的兼容路径**：只在调用方没有稳定随机序列（#511）时走到。
 */
function nextRandomIndex(queue: readonly Song[], currentIndex: number): number {
  if (queue.length <= 1) return currentIndex;
  let next: number;
  do {
    next = Math.floor(Math.random() * queue.length);
  } while (next === currentIndex);
  return next;
}
