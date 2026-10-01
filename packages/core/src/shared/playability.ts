/**
 * 可播性判定纯函数（T12 #158）。
 *
 * 独立叶子模块（零依赖）：完整时长校验（试听版检测）的单一事实来源，
 * 供 sourceRouter（播放解析 nonFull 标记）与直连腿取证引用，
 * 避免 sourceRouter → audioProbe → musicApi 的循环导入。
 */

export type LengthClass = 'full' | 'trial' | 'unknown';

/**
 * 完整时长校验（原型 classifyLength 落地）：
 * 返回音频时长 vs 歌曲标称时长。≥0.95 → full（完整）；<0.5 → trial（试听版/片段，
 * 换元触发条件之一）；中间段拿不准 → unknown，交给下载探测（体积启发式）。
 * playTime/标称时长缺失（0）→ unknown（数据缺失，不臆断）。
 */
export function classifyLength(playTimeMs: number, songDurationSec: number): LengthClass {
  if (!playTimeMs || !songDurationSec) return 'unknown';
  const ratio = playTimeMs / 1000 / songDurationSec;
  if (ratio >= 0.95) return 'full';
  if (ratio < 0.5) return 'trial';
  return 'unknown';
}

/** 权威字段结构（直接客户端 resolveUrlInfo 返回，T02 等提供 playTime/size/br/fee/payed）。 */
export interface UrlInfo {
  url: string;
  br: number;
  size: number;
  playTime: number;
  fee: number;
  payed: number;
}

/** 由 UrlInfo 判定是否为试听版（non-full）：playTime 明显短于标称 → trial。 */
export function isTrialUrlInfo(info: UrlInfo, songDurationSec: number): boolean {
  return classifyLength(info.playTime, songDurationSec) === 'trial';
}

/**
 * 直连结果的试听判定（#539：**唯一事实来源**）。
 *
 * 此前 sourceRouter 的三个调用点各写一套布尔式（预取缓存的 nonFull / UrlInfo 的
 * isTrialUrlInfo || audioTag==='preview' / 纯 audioTag==='preview'），其中一条腿还
 * 少算了 audioTag，导致两条入口腿语义分叉。现在全部收敛到这里：
 *
 * - **audioTag=preview**（搜索期标记，如酷我 VIP 歌的 M500 试听）→ 试听；
 * - **UrlInfo 权威时长明显短于标称**（isTrialUrlInfo）→ 试听；
 * - **直连腿播放时取证判为片段**（validatedNonFull，仅无权威时长的源会走）→ 试听。
 *
 * 三者是「或」关系：任一命中即非完整版。
 * _Avoid_: 试听版检测、nonFull 判定（分散在调用点的布尔式）
 */
export function isNonFullDirect(params: {
  /** 歌曲的搜索期标记（audioTag==='preview' 表示已知试听片段）。 */
  audioTag?: string | null;
  /** 直连客户端的权威时长信息（resolveUrlInfo）；无则跳过该判据。 */
  info?: UrlInfo | null;
  /** 歌曲标称时长（秒），供 isTrialUrlInfo 比较。 */
  duration?: number | null;
  /** #392：直连腿播放时取证结果（仅无权威时长的源会发一次 Range）。 */
  validatedNonFull?: boolean;
}): boolean {
  if (params.audioTag === 'preview') return true;
  if (params.info && typeof params.duration === 'number') {
    if (isTrialUrlInfo(params.info, params.duration)) return true;
  }
  return params.validatedNonFull === true;
}
