import type { Song } from '../types/index.js';
import type { Transport } from '../api/transport.js';
import { BROWSER_UA, refererForSourceKey } from '../utils/sourceReferer.js';
import { extractAudioDuration } from './audioDuration.js';
import { fetchAudioHead } from './audioHead.js';
import { pickDurationEvidence, type PlaybackEvidence } from './playbackGuard.js';
import { traceNow } from './playbackTrace.js';

/**
 * 直连腿播放时时长取证（#392，来源：wayfinder 票 #380 决议 D3）。
 *
 * **要解决什么**：探测链删掉（#391）后，试听版判定在 qq / kugou / kuwo / migu /
 * qianqian 的直连腿上出现缺口——这五个客户端只实现 `resolvePlayableUrl`（返回裸 URL），
 * 没有权威时长字段（`resolveUrlInfo` 只有 netease / soda 实现），直连拿到试听片段会被
 * 当完整版播出去。旧探测的 1MB 体积启发式随 #391 删除，这里补上「**播放时 1 次取证、
 * 只对在播那一首**」的替代。
 *
 * **复用而非新造**：取证走 `shared/audioHead.ts`（一次 Range + 完整大小），时长结论走
 * `shared/audioDuration.ts`（容器可信性矩阵），证据选择走 `shared/playbackGuard.ts`
 * 的 `pickDurationEvidence`（与 tier3 护栏同一条 L1→L3 降级链、同一套容差）。
 *
 * **只判「比标称短」**：试听片段的定义是「短于标称」。比标称长（加长版 / 误配 / 标称
 * 本身不准）不做判定——把正常歌误标成试听版比漏标糟得多。
 *
 * **fail-open**：标称时长缺失、Range 失败、非音频字节、证据不足——一律按现状放行，
 * 不新增失败路径、不写任何缓存。
 */

/** 取证命中的证据等级；`none` = 未取证或证据不足（fail-open）。 */
export type DirectVerify = 'none' | 'audio-header' | 'size-bitrate';

export interface DirectValidationResult {
  /** true = 判定为试听片段（短于标称超容差）。 */
  nonFull: boolean;
  verify: DirectVerify;
  /** 取证耗时（ms）；未取证为 ~0。 */
  validateMs: number;
  /** 结论说明（日志 / 测试断言用，不面向用户）。 */
  reason: string;
}

export interface DirectValidationDeps {
  request?: Transport;
  /** 测试注入：默认 `extractAudioDuration`。 */
  extract?: typeof extractAudioDuration;
}

/** 取证 Range 超时：独立小额（一次头请求），不继承任何源 timeoutMs。 */
const VALIDATION_TIMEOUT_MS = 1_500;

/**
 * 直连 URL 播放时取证（#392）。调用方须已保证「直连腿 + 该源无权威时长 +
 * 标称时长已知」三个前提；本函数自身对缺失前提也 fail-open。
 */
export async function validateDirectUrlNonFull(
  song: Song,
  url: string,
  deps?: DirectValidationDeps,
): Promise<DirectValidationResult> {
  const t0 = traceNow();
  const done = (nonFull: boolean, verify: DirectVerify, reason: string): DirectValidationResult => ({
    nonFull,
    verify,
    reason,
    validateMs: Math.round(traceNow() - t0),
  });

  const nominal = typeof song.duration === 'number' && Number.isFinite(song.duration) && song.duration > 0 ? song.duration : 0;
  // 「我们无法预校验」不该牺牲一首正常的歌（与护栏既有约定一致）。
  if (!nominal) return done(false, 'none', '标称时长缺失，不取证（fail-open）');
  if (!url.startsWith('http')) return done(false, 'none', '非 http URL，不取证');

  const referer = refererForSourceKey(song.sourceType);
  const head = await fetchAudioHead(url, {
    headers: { 'User-Agent': BROWSER_UA, ...(referer ? { Referer: referer } : {}) },
    timeoutMs: VALIDATION_TIMEOUT_MS,
    request: deps?.request,
  });
  if (!head.ok) return done(false, 'none', 'Range 取证失败 / 非音频字节（fail-open）');

  const extract = deps?.extract ?? extractAudioDuration;
  const header = await extract(head.bytes, head.totalBytes);
  const evidence: PlaybackEvidence = {
    headerDuration: header?.duration ?? null,
    headerTrusted: header?.trusted ?? false,
    totalBytes: head.totalBytes,
    bitrateKbps: header?.bitrateKbps ?? null,
    // 头解析出的码率是**帧实测**（非源自称）→ L3 走放宽容差。
    bitrateDeclared: false,
  };
  const picked = pickDurationEvidence(evidence);
  // source-duration 只可能来自源声明，直连腿走不到；防御性排除。
  if (!picked || picked.guard === 'source-duration') return done(false, 'none', '无可用时长证据（fail-open）');

  const verify: DirectVerify = picked.guard === 'size-bitrate' ? 'size-bitrate' : 'audio-header';
  const shorter = nominal - picked.seconds > picked.toleranceSec;
  return done(
    shorter,
    verify,
    `取证 ${picked.seconds.toFixed(1)}s vs 标称 ${nominal}s（${verify}，容差 ±${picked.toleranceSec}s）`,
  );
}
