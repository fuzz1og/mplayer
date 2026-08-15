/**
 * 可播性判定纯函数（T12 #158）。
 *
 * 独立叶子模块（零依赖）：完整时长校验（试听版检测）的单一事实来源，
 * 供 sourceRouter（播放解析 nonFull 标记）与 audioProbe（探测标签）引用，
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
