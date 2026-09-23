import fs from 'fs';
import { app, dialog } from 'electron';
import {
  createPlaybackTraceRing,
  setPlaybackTraceSink,
  type PlaybackProbeTrace,
  type PlaybackTrace,
} from '@mplayer/core';

/**
 * 桌面播放解析链诊断 sink（#363 / ADR `2026-09-23-playback-trace-sink`）。
 *
 * 职责与 cookieAdapter / musicApi 的接缝同构：core 只出结构化 trace（零 I/O），
 * 本模块在主进程常驻内存环形缓冲、注册 sink，并在用户点击「导出诊断」时写文件。
 *
 * - 缓冲**会话内、不落盘、不外传**（容量 200，超出丢最旧）；
 * - 模块加载即 `setPlaybackTraceSink(ring.sink)`——core 热路径据此开始产出；
 *   sink 为空时 core 不构造任何记录（关掉即零开销）。
 */

/** 环形缓冲容量：足够回看一次连续播放会话，又不至于长期占用内存。 */
export const PLAYBACK_TRACE_CAPACITY = 200;

const ring = createPlaybackTraceRing(PLAYBACK_TRACE_CAPACITY);

// 模块加载时注册 sink（参考 src/main/cookies/cookieAdapter.ts 的接缝写法）。
setPlaybackTraceSink(ring.sink);

/** 当前会话最近若干条解析 trace（最旧 → 最新）。 */
export function listPlaybackTraces(): PlaybackTrace[] {
  return ring.listResolves();
}

/** 当前会话最近若干条探测 trace（最旧 → 最新）。 */
export function listProbeTraces(): PlaybackProbeTrace[] {
  return ring.listProbes();
}

/** 清空当前会话的全部 trace（解析 + 探测）。 */
export function clearPlaybackTraces(): void {
  ring.clear();
}

/** 导出文件结构：meta + 两条 trace 快照。 */
export interface PlaybackTraceExport {
  /** 导出元信息：导出时刻（ISO）与应用版本。 */
  meta: { exportedAt: string; appVersion: string };
  resolves: PlaybackTrace[];
  probes: PlaybackProbeTrace[];
}

/** 组装导出内容（便于测试与复用，不触碰磁盘）。 */
export function buildPlaybackTraceExport(exportedAt: Date = new Date()): PlaybackTraceExport {
  return {
    meta: { exportedAt: exportedAt.toISOString(), appVersion: app.getVersion() },
    resolves: ring.listResolves(),
    probes: ring.listProbes(),
  };
}

/** 导出文件名用的时间戳（冒号/点替换为短横线，跨平台安全）。 */
function exportFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `mplayer-playback-trace-${stamp}.json`;
}

/**
 * 弹系统保存对话框并写入 JSON。成功返回落盘路径；用户取消返回 null。
 * 写盘失败会抛错，由 IPC 封套转成失败结果。
 */
export async function exportPlaybackTraces(): Promise<string | null> {
  const now = new Date();
  const result = await dialog.showSaveDialog({
    title: '导出播放诊断',
    defaultPath: exportFileName(now),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const payload = buildPlaybackTraceExport(now);
  fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return result.filePath;
}
