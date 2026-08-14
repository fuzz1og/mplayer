/**
 * 下载标签写入决策 + ID3 帧构造（纯计算，双端共用）。
 *
 * 历史 bug：FLAC/M4A 被当作 MP3 用 mp3tag.js 错灌 ID3。修复原则是「按容器类型
 * 选择标签写入方式」——MP3 走 ID3；M4A 走 MP4 容器标签；FLAC/Ogg 等 mp3tag.js
 * 不支持的容器宁可不写标签，也不错灌 ID3。
 *
 * 真实参数原则：只写能确证的字段。时长（duration）可确证 → 写 TLEN（毫秒）；
 * 拿不到的位率/大小/编码器不写伪造值（TSSE 等仅当有真实来源时再考虑）。
 */

import type { AudioContainer } from './container.js';

export type TagStrategy = 'id3' | 'mp4' | 'skip';

/**
 * 容器 → 标签写入策略。
 * - mp3：mp3tag.js ID3
 * - m4a：MP4 容器标签（id3v2 in ID32 box；桌面 mp3tag.js 支持，但按容器正确写入）
 * - flac / ogg / unknown：跳过（宁可不写也不错灌 ID3）
 */
export function tagStrategyForContainer(container: AudioContainer): TagStrategy {
  switch (container) {
    case 'mp3':
      return 'id3';
    case 'm4a':
      return 'mp4';
    default:
      return 'skip';
  }
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
