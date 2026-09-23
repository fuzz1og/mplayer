import { documentDirectory, writeAsStringAsync } from 'expo-file-system/legacy';
import { Share } from 'react-native';
import {
  createPlaybackTraceRing,
  setPlaybackTraceSink,
  type PlaybackProbeTrace,
  type PlaybackTrace,
} from '@mplayer/core';

/**
 * 播放解析链诊断（#363 / ADR-2026-09-23-playback-trace-sink）。
 *
 * core 只出结构化 trace，宿主落 sink：本模块持有会话内内存环形缓冲（容量 200，
 * 不落盘），在 App 启动时注册给 core；设置页「播放诊断」区读取快照、手动导出。
 * 与桌面主进程实现（IPC playbackTrace:*）共享同一份 core schema，字段不漂移。
 *
 * 开销：sink 为空时 core 热路径零构造；注册后每次解析才 push 一条。
 */

/** 会话内环形缓冲（容量 200，与桌面口径一致）。 */
const ring = createPlaybackTraceRing(200);

let sinkRegistered = false;

/**
 * 注册 core trace sink（幂等）。与 registerDirectClient 相同，必须在 App 启动的
 * 模块顶层调用：首次播放解析可能早于任何 useEffect。ESM 模块单例保证只注册一次。
 */
export function registerPlaybackTraceSink(): void {
  if (sinkRegistered) return;
  sinkRegistered = true;
  setPlaybackTraceSink(ring.sink);
}

/** 最近解析链 trace 快照（旧→新；调用方自行倒序截断）。 */
export function listPlaybackTraces(): PlaybackTrace[] {
  return ring.listResolves();
}

/** 最近探测 trace 快照（旧→新）。 */
export function listProbeTraces(): PlaybackProbeTrace[] {
  return ring.listProbes();
}

/** 清空会话内诊断缓冲。 */
export function clearPlaybackTraces(): void {
  ring.clear();
}

/** 导出载荷：带 schema 版本与导出时刻，便于离线分析时对齐字段。 */
export interface PlaybackTraceExport {
  version: 1;
  exportedAt: number;
  resolutions: PlaybackTrace[];
  probes: PlaybackProbeTrace[];
}

/**
 * 序列化当前缓冲为 JSON 文本（纯函数，方便单测；不触碰文件系统）。
 * trace 的 ts 走 core 统一时钟（performance.now 优先），故附带 exportedAt（epoch ms）作锚点。
 */
export function serializePlaybackTraces(): string {
  const payload: PlaybackTraceExport = {
    version: 1,
    exportedAt: Date.now(),
    resolutions: ring.listResolves(),
    probes: ring.listProbes(),
  };
  return JSON.stringify(payload, null, 2);
}

/** 导出文件名：mplayer-playback-trace-<本地时间戳>.json，避免多次导出互相覆盖。 */
function exportFileName(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  return 'mplayer-playback-trace-' + stamp + '.json';
}

/**
 * 导出诊断：把当前缓冲 JSON 写到应用文档目录（documentDirectory），再唤起系统分享
 * （React Native 内置 Share）分享 JSON 文本；返回文件路径。
 *
 * 不新增依赖：仅用已有的 expo-file-system + RN Share。写文件失败向上抛，由调用方提示；
 * 分享由用户取消不视为失败（Share.share 正常 resolve）。
 */
export async function exportPlaybackTraces(): Promise<string> {
  const json = serializePlaybackTraces();
  const dir = documentDirectory;
  if (!dir) throw new Error('无法访问应用文档目录');
  const path = (dir.endsWith('/') ? dir : dir + '/') + exportFileName();
  await writeAsStringAsync(path, json);
  await Share.share({ title: '播放诊断', message: json });
  return path;
}
