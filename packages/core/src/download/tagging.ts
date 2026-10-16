/**
 * 下载标签写入决策 + ID3 帧构造（纯计算，双端共用）。
 * 口径（#607 实测，见 ADR `docs/adr/2026-10-08-download-tag-write-boundary.md`）：**只对 MP3 承诺内
 * 嵌元数据**。
 */

import type { AudioContainer } from './container.js';

export type TagStrategy = 'id3' | 'skip';

/**
 * 容器 → 标签写入策略。
 * - mp3：mp3tag.js ID3（唯一有标准读取方的路径）- m4a：跳过（mp3tag.js 只能写 ID32，非 iTunes 
 * `ilst`/`covr`，标准读取方读不到）- flac / ogg / unknown：跳过（宁可不写也不错灌）
 */
export function tagStrategyForContainer(container: AudioContainer): TagStrategy {
  return container === 'mp3' ? 'id3' : 'skip';
}

/** 标签写入计划：两端下载 adapter 消费的唯一决策结果。 */
export interface AudioTaggingPlan {
  container: AudioContainer;
  strategy: TagStrategy;
  /** `strategy === 'skip'` 时的可读原因（供 I/O 端日志）；`'id3'` 时为 null */
  skipReason: string | null;
}

/** 各容器跳过写入的原因（双端日志同文案）。 */
function skipReasonFor(container: AudioContainer): string {
  if (container === 'm4a') {
    return 'M4A 无标准标签写入路径（mp3tag.js 只能写 ID32，iTunes ilst/covr 与标准读取方读不到），跳过标签写入（避免写入读不回的假标签）';
  }
  return `容器(${container})无标准标签写入路径，跳过标签写入（避免写入读不回的假标签）`;
}

/**
 * core 单点决策（#607）：给定容器，产出唯一的标签写入计划。
 * 两端下载 adapter 只消费本结果——不要再各自调 `tagStrategyForContainer` 做判断。
 */
export function planAudioTagging(container: AudioContainer): AudioTaggingPlan {
  const strategy = tagStrategyForContainer(container);
  return {
    container,
    strategy,
    skipReason: strategy === 'id3' ? null : skipReasonFor(container),
  };
}

export interface CoverFrameData {
  format: string;
  bytes: number[];
}

export interface BuildID3FramesInput {
  title: string;
  artist: string;
  album: string;
  /** 真实时长（毫秒）；缺失或 <=0 时不写 TLEN */
  durationMs?: number;
  cover?: CoverFrameData;
}

/** ID3v2 文本帧常量（mp3tag.js 帧名）。 */
export const ID3_FRAME_TLEN = 'TLEN';

/** APIC 封面帧的类型（3 = 封面 front cover）。 */
const APIC_TYPE_COVER = 3;

export interface ID3Frames {
  /** 基础曲目信息帧（TIT2/TPE1/TALB 恒有）；可选 TLEN、APIC */
  v2: {
    TIT2: string;
    TPE1: string;
    TALB: string;
    TLEN?: string;
    APIC?: Array<{ format: string; type: number; description: string; data: number[] }>;
  };
  /** 写入备注（如跳过某字段的原因），供 I/O 端日志/排障 */
  notes: string[];
}

/**
 * 构造 ID3 写入帧集合（纯数据，不含 mp3tag.js 依赖——桌面端据此调用 mp3tag.js）。
 * 只写入基础信息 + 可确证的真实参数（TLEN）。
 */
export function buildID3Frames(input: BuildID3FramesInput): ID3Frames {
  const notes: string[] = [];
  const frames: ID3Frames['v2'] = {
    TIT2: input.title || '',
    TPE1: input.artist || '',
    TALB: input.album || '',
  };

  const durationMs = input.durationMs;
  if (durationMs != null && Number.isFinite(durationMs) && durationMs > 0) {
    frames[ID3_FRAME_TLEN] = String(Math.round(durationMs));
  } else {
    notes.push('时长不可确证，跳过 TLEN');
  }

  if (input.cover != null) {
    if (input.cover.bytes.length > 0) {
      frames.APIC = [{
        format: input.cover.format,
        type: APIC_TYPE_COVER,
        description: 'Cover',
        data: input.cover.bytes,
      }];
    } else {
      notes.push('封面抓取为空，跳过 APIC');
    }
  }

  return { v2: frames, notes };
}
