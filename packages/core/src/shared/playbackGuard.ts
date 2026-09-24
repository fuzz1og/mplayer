import type { Song } from '../types/index.js';
import { isExactMatch, normalize } from '../utils/songMatcher.js';

/**
 * 播放护栏（#361，ADR `2026-09-21-tier3-url-substitution.md`）。
 *
 * tier3 兜底只替换**流 URL**、绝不铸造新身份；但第三方源返回的音频不保证就是
 * 用户点的那一首（翻唱 / Live / 混音 / 同名不同歌手）。本模块是护栏的**决策单点**：
 * 输入一首歌与候选音频的**证据**，输出「是否接受」与**证据等级** `guard`。
 *
 * 分级（参考值 = 歌曲标称 `Song.duration`，**不是**直连试听返回的 playTime——
 * 那是片段长度，会把完整版误判掉）：
 * - L1 `source-duration`：源自带时长（搜索条目 / 解析响应自带）；
 * - L2 `audio-header`：音频头解析（music-metadata；仅"全局头"容器可信，
 *   见 `audioDuration.ts` 的 trusted 规则）；
 * - L3 `size-bitrate`：`体积 × 8 ÷ 码率`（优先源自称码率，缺失才用帧实测）；
 *   **L1–L3 有文本证据时三指标（歌名 + 歌手 + 时长）必须全达标**（ADR 决策 3）；
 * - L4 `text-only`：以上全无 → **只验歌名 + 歌手精确匹配**（临时特例，待更好方案）；
 * - L5 `none`：连文本都没有（url-resolver 且响应无 name/artist）→ 只剩 `source`
 *   声明这一条**信任**（契约不是证据，如实标注）。
 *
 * 不过护栏**不静默播**：调用方换下一个候选源；全不过走既有失败链路。
 * 标称时长缺失（0）时不做时长判定——「我们无法预校验」不该牺牲一首正常的歌。
 */

/** 护栏证据等级（L1→L5 降级链；直连腿不走护栏，恒为 `none`）。 */
export type PlaybackGuard = 'source-duration' | 'audio-header' | 'size-bitrate' | 'text-only' | 'none';

/** 可播 URL 的来源腿（#361：解析结果需区分直连 / tier3）。 */
export type PlaybackVia = 'direct' | 'tier3';

/** 时长容差（秒）：|候选 − 标称| ≤ 2 通过，2.1 拒绝。 */
export const GUARD_TOLERANCE_SEC = 2;

/**
 * L3「帧实测码率」分支的放宽容差（秒）。ADR 实测：真值 166.416s 的 ADTS，
 * `体积 ÷ 帧实测码率` = 168.1s（相对标称 166 = 2.1s），按 ±2s 会**误拒**；
 * ADR 明确该分支「要么不用、要么单独放宽阈值」——这里选放宽：该分支仍能挡住
 * 30s 试听片段/明显错歌，又不会因为 ±0.1s 的估算误差牺牲一首正常的歌。
 */
export const MEASURED_BITRATE_TOLERANCE_SEC = 3;

/** 候选音频可用的证据集合（源无关；缺哪级就降级到下一级）。 */
export interface PlaybackEvidence {
  /** L1 源自带时长（秒）。 */
  sourceDuration?: number | null;
  /** L2 音频头解析时长（秒）。 */
  headerDuration?: number | null;
  /** L2 头时长是否可信（ADTS / 部分 MP3 / 部分 Ogg 的头时长不可信）。 */
  headerTrusted?: boolean;
  /** L3 完整字节数（Range 探测的 content-range 总量）。 */
  totalBytes?: number | null;
  /** L3 码率（kbps）：优先源自称，缺失才用帧实测。 */
  bitrateKbps?: number | null;
  /** 码率是否来自源**自称**；`false` = 帧实测（走放宽容差）。 */
  bitrateDeclared?: boolean;
  /** L4 文本证据（歌名 / 歌手）。 */
  name?: string;
  artist?: string;
}

/** 护栏决策结果。 */
export interface GuardDecision {
  accepted: boolean;
  guard: PlaybackGuard;
  /** 命中 L3 时用的是哪条码率分支：`declared` 源自称 / `measured` 帧实测。 */
  bitrateBranch?: 'declared' | 'measured';
  /** 决策说明（日志与测试断言用，不面向用户）。 */
  reason: string;
}

/** 正数归一：非有限值 / ≤0 视为「无该级证据」。 */
function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** 候选是否带文本证据（歌名或歌手任一非空）。 */
function hasText(evidence: PlaybackEvidence): boolean {
  return !!(normalize(evidence.name ?? '') || normalize(evidence.artist ?? ''));
}

/** 文本证据判定：歌名 + 歌手精确匹配（拒绝 Live/remix/同名不同歌手）。 */
function judgeText(song: Song, evidence: PlaybackEvidence): { ok: boolean; reason: string } {
  const name = evidence.name ?? '';
  const artist = evidence.artist ?? '';
  const matched = isExactMatch(
    { name: song.name || '', artist: song.artist || '' },
    { name, artist },
  );
  return matched
    ? { ok: true, reason: `歌名 + 歌手精确匹配：${name || '无'} / ${artist || '无'}` }
    : { ok: false, reason: `歌名 + 歌手不匹配（候选：${name || '无'} / ${artist || '无'}）` };
}

/**
 * L1–L3 的时长判定：标称缺失 = 不做判定（不阻断）；Δ 超容差 = 拒绝；
 * Δ 达标且**有文本证据**时必须同时过文本校验（ADR：三指标全达标才接受）。
 */
function judgeDuration(
  song: Song,
  guard: PlaybackGuard,
  candidateSec: number,
  nominalSec: number,
  toleranceSec: number,
  evidence: PlaybackEvidence,
): GuardDecision {
  if (!nominalSec) {
    return {
      accepted: true,
      guard,
      reason: `标称时长缺失，${guard} 证据 ${candidateSec.toFixed(1)}s 不作时长判定`,
    };
  }
  const delta = Math.abs(candidateSec - nominalSec);
  const detail = `${guard} 证据 ${candidateSec.toFixed(1)}s vs 标称 ${nominalSec}s（Δ${delta.toFixed(1)}s，容差 ±${toleranceSec}s）`;
  if (delta > toleranceSec) {
    return { accepted: false, guard, reason: `时长不符：${detail}` };
  }
  if (hasText(evidence)) {
    const text = judgeText(song, evidence);
    if (!text.ok) return { accepted: false, guard, reason: `时长一致但${text.reason}` };
    return { accepted: true, guard, reason: `三指标一致：${detail}；${text.reason}` };
  }
  return { accepted: true, guard, reason: `时长一致（无文本证据）：${detail}` };
}

/** 时长证据的选定结果：秒数 + 证据等级 + 该等级适用的容差。 */
export interface DurationEvidence {
  seconds: number;
  guard: PlaybackGuard;
  toleranceSec: number;
  /** 命中 L3 时的码率分支（L1/L2 无此字段）。 */
  bitrateBranch?: 'declared' | 'measured';
}

/**
 * 取**最高可用等级**的时长证据（纯函数）。L2 头时长不可信时继续降级而不是拿它误拒；
 * 这也是「证据优先级」的单一来源——护栏决策与直连腿取证（#392）共用同一条降级链。
 */
export function pickDurationEvidence(evidence: PlaybackEvidence): DurationEvidence | null {
  const sourceDuration = positive(evidence.sourceDuration);
  if (sourceDuration) {
    return { seconds: sourceDuration, guard: 'source-duration', toleranceSec: GUARD_TOLERANCE_SEC };
  }

  const headerDuration = positive(evidence.headerDuration);
  if (evidence.headerTrusted && headerDuration) {
    return { seconds: headerDuration, guard: 'audio-header', toleranceSec: GUARD_TOLERANCE_SEC };
  }

  const totalBytes = positive(evidence.totalBytes);
  const bitrateKbps = positive(evidence.bitrateKbps);
  if (totalBytes && bitrateKbps) {
    const measured = evidence.bitrateDeclared === false;
    return {
      seconds: (totalBytes * 8) / (bitrateKbps * 1000),
      guard: 'size-bitrate',
      toleranceSec: measured ? MEASURED_BITRATE_TOLERANCE_SEC : GUARD_TOLERANCE_SEC,
      bitrateBranch: measured ? 'measured' : 'declared',
    };
  }

  return null;
}

/**
 * 护栏决策（纯函数）。证据优先级 L1→L5：**取最高可用等级判定**，
 * 该级不可信（如 ADTS 头时长）则继续降级，而不是拿不可信证据误拒。
 */
export function evaluatePlaybackGuard(song: Song, evidence: PlaybackEvidence): GuardDecision {
  const nominalSec = positive(song.duration) ?? 0;

  const duration = pickDurationEvidence(evidence);
  if (duration) {
    const decision = judgeDuration(song, duration.guard, duration.seconds, nominalSec, duration.toleranceSec, evidence);
    return duration.bitrateBranch ? { ...decision, bitrateBranch: duration.bitrateBranch } : decision;
  }

  if (hasText(evidence)) {
    const text = judgeText(song, evidence);
    return {
      accepted: text.ok,
      guard: 'text-only',
      reason: `无时长证据，${text.reason}`,
    };
  }

  return {
    accepted: true,
    guard: 'none',
    reason: '无任何内容级证据，仅凭源声明的 source 归属放行（契约信任，非证据）',
  };
}
