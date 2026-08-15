/**
 * 下载质量阶梯 + 位率门控（T14 #160，P0）。
 *
 * 纯计算，双端共用：位率档设定、门控判定（实际位率低于设定 → 拒绝/提示）。
 * 源侧音质协商（按源请求更高档）为后续能力，本期交付 = 门控判定 + 设置档位
 * + 下载后校验（真实位率 = 文件大小 * 8 / 时长）。
 */

/** 位率门控档位（kbps）；0 = 不限。 */
export type BitrateGate = 0 | 128 | 192 | 320;

export const BITRATE_GATE_OPTIONS: { value: BitrateGate; label: string }[] = [
  { value: 0, label: '不限' },
  { value: 128, label: '≥128kbps' },
  { value: 192, label: '≥192kbps' },
  { value: 320, label: '≥320kbps' },
];

export interface QualityGateResult {
  allowed: boolean;
  actualKbps: number;
  /** below-gate = 实际低于设定；unknown = 位率未知（按通过，下载后可校验）。 */
  reason?: 'below-gate' | 'unknown';
  message: string;
}

/**
 * 位率门控判定。位率未知（0/null）→ 通过但标注 unknown（不臆断拒绝，
 * 下载后可由实际大小/时长二次校验）。实际低于设定 → 拒绝（调用方可降档/提示）。
 */
export function gateDownloadBitrate(
  actualKbps: number | null | undefined,
  minKbps: BitrateGate,
): QualityGateResult {
  const kbps = actualKbps && actualKbps > 0 ? Math.round(actualKbps) : 0;
  if (!minKbps) return { allowed: true, actualKbps: kbps, message: '' };
  if (!kbps) {
    return {
      allowed: true,
      actualKbps: 0,
      reason: 'unknown',
      message: '位率未知，按通过处理（下载后可校验）',
    };
  }
  if (kbps < minKbps) {
    return {
      allowed: false,
      actualKbps: kbps,
      reason: 'below-gate',
      message: `实际位率 ${kbps}kbps 低于设定 ${minKbps}kbps`,
    };
  }
  return { allowed: true, actualKbps: kbps, message: '' };
}

/**
 * 下载后由文件大小（字节）与时长（秒）反推实际位率（kbps）。
 * 时长缺失 → 0（未知）。用于下载后的位率门控复核。
 */
export function estimateBitrateKbps(fileSizeBytes: number, durationSec: number): number {
  if (!fileSizeBytes || !durationSec) return 0;
  return Math.round((fileSizeBytes * 8) / 1000 / durationSec);
}
