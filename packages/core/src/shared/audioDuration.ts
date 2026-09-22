/**
 * 音频时长取证（#361，ADR `2026-09-21-tier3-url-substitution.md`）。
 *
 * 护栏的 L2 证据来源：**从音频本身取时长**，不要求第三方源配合提供元数据。
 * 用已装的只读解析器 `music-metadata` 解析 Range 探测拿到的头部字节。
 *
 * 关键约束（本次实测，2026-09-21）：
 * - 只取**头部**（64KB）时，时长可信性因容器而异：
 *   - FLAC（STREAMINFO）/ MP4-M4A（moov 全局头）→ 头部即全量时长，**可信**；
 *   - MP3 → 仅当带 Xing/Info 头（总帧数）或已取全文件时可信；否则解析器只能
 *     按"已取字节里的帧数"估算，部分缓冲会**大幅低估**；
 *   - Ogg → 时长来自**末页 granule**，部分缓冲必然低估，只在取全文件时可信；
 *   - ADTS（无全局头）→ 头时长只是已取字节的帧计数，**永不可信**，必须走 L3
 *     「体积 × 8 ÷ 码率」。
 * - 不可信 ≠ 拒绝：决策层会降级到 L3/L4（见 `shared/playbackGuard.ts`），
 *   拿不可信证据误拒会牺牲一首正常的歌。
 */

/** 音频头取证结果（music-metadata 原始结论 + 可信性判定）。 */
export interface AudioDurationEvidence {
  /** music-metadata 的容器名（如 `MPEG` / `FLAC` / `M4A/isom` / `Ogg` / `ADTS/MPEG-4`）。 */
  container: string | null;
  /** 头部解析出的时长（秒）；拿不到为 null。 */
  duration: number | null;
  /** 帧实测码率（kbps）；拿不到为 null。L3 的兜底码率。 */
  bitrateKbps: number | null;
  /** `duration` 是否可作为 L2 证据（见文件头注释的容器矩阵）。 */
  trusted: boolean;
}

type MusicMetadataModule = typeof import('music-metadata');

/** 懒加载解析库：core 被移动端/渲染层打包，静态 import 会把解析器拖进所有 bundle；
 *  不可用时（宿主环境缺该依赖）静默降级到 L3/L4，而不是让整条兜底链抛错。 */
let mmModule: MusicMetadataModule | null | undefined;

async function loadMusicMetadata(): Promise<MusicMetadataModule | null> {
  if (mmModule !== undefined) return mmModule;
  try {
    mmModule = (await import('music-metadata')) as MusicMetadataModule;
  } catch (e) {
    console.warn(`[guard] 音频元数据解析库不可用，L2 头解析降级: ${(e as Error)?.message || e}`);
    mmModule = null;
  }
  return mmModule;
}

/** 跳过 ID3v2 头，返回首个 MPEG 帧的大致偏移（无 ID3v2 时为 0）。 */
function skipId3v2(bytes: Uint8Array): number {
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size =
      ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    return 10 + size;
  }
  return 0;
}

/**
 * MP3 是否带 Xing / Info 头（总帧数 → 精确时长）。
 * 只在首个帧头附近（ID3v2 之后 2KB 内）扫描：整段扫描会被音频负载里的
 * 偶然字节误判，而 Xing/Info 必然紧跟第一个帧头。
 */
export function hasMpegXingHeader(bytes: Uint8Array): boolean {
  const start = skipId3v2(bytes);
  const end = Math.min(bytes.length, start + 2048);
  for (let i = start; i + 4 <= end; i++) {
    if (bytes[i] === 0x58 && bytes[i + 1] === 0x69 && bytes[i + 2] === 0x6e && bytes[i + 3] === 0x67) return true; // Xing
    if (bytes[i] === 0x49 && bytes[i + 1] === 0x6e && bytes[i + 2] === 0x66 && bytes[i + 3] === 0x6f) return true; // Info
  }
  return false;
}

/**
 * 荒谬时长上限（4 小时）：没有任何单曲/有声书会超过它。超过即视为**头解析不可信**
 * （例如 STREAMINFO 损坏/被错读），降级到 L3/L4/L5——而不是拿这个值去误拒一首正常的歌。
 * 实测案例：字节被文本化损坏时 FLAC 头读成 25069s（≈7h）。
 */
const MAX_PLAUSIBLE_DURATION_SEC = 4 * 60 * 60;

/** 头部时长是否可信（容器全局头 / 已取全文件 / MP3 带 Xing-Info）。 */
export function isTrustedHeaderDuration(
  container: string | null,
  bytes: Uint8Array,
  totalBytes?: number | null,
): boolean {
  const c = (container || '').toLowerCase();
  if (!c) return false;
  if (c.includes('adts')) return false; // 无全局头：头时长只是已取字节的帧计数
  if (c.includes('flac')) return true; // STREAMINFO 全局头
  if (c.includes('m4a') || c.includes('isom') || c.includes('mp4')) return true; // moov 全局头
  if (typeof totalBytes === 'number' && totalBytes > 0 && totalBytes <= bytes.length) return true; // 已取全文件
  if (c.includes('mpeg') && hasMpegXingHeader(bytes)) return true; // Xing/Info 自带总帧数
  return false; // Ogg 等：时长来自末页 granule，部分缓冲会低估
}

/**
 * 从音频头部字节取证时长（纯函数，无网络）。
 * `totalBytes` = 完整文件大小（Range 探测的 content-range 总量）；用于判断
 * 「已取全文件」，以及 L3 的体积估算。解析失败返回 null（调用方降级）。
 */
export async function extractAudioDuration(
  bytes: Uint8Array,
  totalBytes?: number | null,
): Promise<AudioDurationEvidence | null> {
  if (!bytes || bytes.length < 4) return null;
  const mm = await loadMusicMetadata();
  if (!mm) return null;
  let parsed: Awaited<ReturnType<MusicMetadataModule['parseBuffer']>>;
  try {
    parsed = await mm.parseBuffer(bytes, undefined, { duration: true });
  } catch {
    return null; // 不是可识别音频 / 字节不足 → 无 L2 证据
  }
  const container = parsed.format.container ?? null;
  const rawDuration = parsed.format.duration;
  const duration =
    typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
  const rawBitrate = parsed.format.bitrate;
  const bitrateKbps =
    typeof rawBitrate === 'number' && Number.isFinite(rawBitrate) && rawBitrate > 0 ? rawBitrate / 1000 : null;
  return {
    container,
    duration,
    bitrateKbps,
    trusted:
      !!duration &&
      duration <= MAX_PLAUSIBLE_DURATION_SEC &&
      isTrustedHeaderDuration(container, bytes, totalBytes),
  };
}
