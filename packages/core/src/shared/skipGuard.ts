import type { PlayMode, Song } from '../types/index.js';
import { identityKey } from '../utils/songIdentity.js';
import { getNextSongIndex } from '../utils/queue.js';

/**
 * 跳歌护栏（#385，spec 见 issue #385）：**「一首歌失败之后怎么办」的决策单点**。
 *
 * 现状缺陷（#385）：护栏用**队列长度**当阈值（200 首队列断网会依次试 200 首）、
 * 手动点歌把计数清零（可无限循环）、没有网络态、`invalid` 标记不参与跳歌决策、
 * 两端两套实现两套文案。本模块把语义与文案收敛到 core 一处，宿主只做接线。
 *
 * 设计（对应 spec 的缝）：
 * - **决策函数是纯函数**：输入离线态 / 用户偏好 / 队列有无下一首 / 连续失败计数，
 *   输出 `skip | stop` + 一句话文案。core 零 I/O，离线判定由宿主注入 predicate。
 * - **固定绝对值上限** `SKIP_LIMIT`，与队列长度无关（D1）。
 * - **会话内状态**（模块级 Map/计数，不落盘；与 `tier3Stats`/`prefetchCache` 同取向）：
 *   连续失败计数 + 坏歌集合。计数只在**终局失败**（fresh 重试之后仍失败）+1，
 *   只在**真正开始播放**时归零——**手动点歌不清零**（修 D2 的无限循环）。
 * - **坏歌记忆**：终局失败即记住（键 = 歌曲身份键），跳歌选曲时查询跳过（D4）。
 */

/** 连续失败跳歌的**绝对值**上限：与队列长度无关（D1）。取 3（区间 3–5 的保守值）。 */
export const SKIP_LIMIT = 3;

/** 离线文案（单一来源）：宿主可在**进解析链之前**用它快速失败（#385「不进解析链」）。 */
export const OFFLINE_COPY = '当前处于离线状态，已暂停播放';

export type SkipGuardAction = 'skip' | 'stop';

export interface SkipGuardInput {
  songName: string;
  /** 失败归因文案（宿主取 core `explainPlaybackFailure` 的结果传入；已有则复用）。 */
  reasonText: string;
  /** 宿主判定的离线态（core 不碰 I/O：桌面 navigator.onLine / 移动端 NetInfo）。 */
  offline: boolean;
  /** 用户偏好「失败即跳」；false = 失败即停，等用户处理（对齐 lx-music/MusicFree）。 */
  autoSkip: boolean;
  /** 队列里是否还有别的歌可跳。 */
  hasNextSong: boolean;
  /** 终局失败计数（`registerTerminalFailure` 的返回值）。 */
  consecutiveFailures: number;
  /** 本地文件失败：文案不同（与在线源失败区分）。 */
  isLocal: boolean;
}

export interface SkipGuardDecision {
  action: SkipGuardAction;
  /** 双端共用的结果文案（core 单一来源）。 */
  copy: string;
}

/**
 * 终局失败后的决策（纯函数）。优先级（spec #385 定序）：
 * 离线 → 停；关闭「失败即跳」→ 停；**无下一首 → 停**；连续失败达上限 → 停；
 * 本地文件 → 跳（文案不同）；否则 → 跳。
 */
export function decideAfterPlaybackFailure(input: SkipGuardInput): SkipGuardDecision {
  const { songName, reasonText, offline, autoSkip, hasNextSong, consecutiveFailures, isLocal } = input;

  if (offline) {
    return { action: 'stop', copy: OFFLINE_COPY };
  }
  if (!autoSkip) {
    return { action: 'stop', copy: `《${songName}》${reasonText}，已暂停（自动跳歌已关闭）` };
  }
  if (!hasNextSong) {
    return { action: 'stop', copy: `《${songName}》${reasonText}，且队列中没有其他歌曲` };
  }
  if (consecutiveFailures >= SKIP_LIMIT) {
    return { action: 'stop', copy: `连续 ${consecutiveFailures} 首无法播放，已暂停` };
  }
  if (isLocal) {
    return { action: 'skip', copy: `《${songName}》本地文件无法播放，已自动跳到下一首` };
  }
  return { action: 'skip', copy: `《${songName}》${reasonText}，已自动跳到下一首` };
}

// ── 会话内状态（模块级，不落盘、不持久化）────────────────────────────

let failureStreak = 0;
const badSongKeys = new Set<string>();

/**
 * 记一次**终局失败**（同曲 fresh 重试之后仍失败）：连续计数 +1，并记住这首歌。
 * 返回新的连续失败数，供决策函数使用。
 */
export function registerTerminalFailure(song: Song): number {
  failureStreak += 1;
  badSongKeys.add(identityKey(song));
  return failureStreak;
}

/**
 * 成功开始播放：连续失败链中断。
 * **只有这里会归零**——手动点歌不清零（否则「断网中点歌 → 跳 3 首 → 再点」可无限循环，D2）。
 */
export function resetFailureStreak(): void {
  failureStreak = 0;
}

export function getFailureStreak(): number {
  return failureStreak;
}

/** 会话内已被证明失效的歌：跳歌选曲时应跳过（D4）。 */
export function isKnownBadSong(song: Song): boolean {
  return badSongKeys.has(identityKey(song));
}

/**
 * 跳歌候选（#385 D4）：沿播放模式从当前索引起找，**跳过会话内已证明失效的歌**
 * （否则同一条坏歌链会被反复选中）。绕回自己 / 翻完一圈 → null，
 * 由 `decideAfterPlaybackFailure` 判「无下一首 → 停」。
 *
 * 放 core 的理由（#385 的前提就是单一来源）：两端原本各写一份，语义极易漂移。
 */
export function pickNextSongAfterFailure(
  playlist: Song[],
  currentIndex: number,
  playMode: PlayMode,
  currentSongId: string,
): { index: number; song: Song } | null {
  let index = currentIndex;
  for (let step = 0; step < playlist.length; step += 1) {
    index = getNextSongIndex(playlist, index, playMode);
    if (index < 0) return null;
    const candidate = playlist[index];
    if (!candidate || candidate.id === currentSongId) return null;
    if (isKnownBadSong(candidate)) continue;
    return { index, song: candidate };
  }
  return null;
}

/** 测试/重置用：清空连续计数与坏歌记忆。 */
export function clearSkipGuard(): void {
  failureStreak = 0;
  badSongKeys.clear();
}
