import { registerIpcHandler, registerIpcHandlerSimple } from './registerHandler';
import { clearPlaybackTraces, exportPlaybackTraces, listPlaybackTraces } from '../services/playbackTraceService';

/**
 * 播放诊断 IPC（#363 / ADR `2026-09-23-playback-trace-sink`）。
 *
 * - `playbackTrace:list`：当前会话环形缓冲快照（解析 trace）；
 * - `playbackTrace:clear`：清空缓冲；
 * - `playbackTrace:export`：弹系统保存对话框写 JSON，取消返回 null。
 *
 * 通道为语义命名（与 settings:* 同组），返回值由 IPC 封套统一包装。
 */
export function registerPlaybackTraceIpc(): void {
  registerIpcHandlerSimple('playbackTrace:list', () => ({
    resolves: listPlaybackTraces(),
  }));
  registerIpcHandlerSimple('playbackTrace:clear', () => {
    clearPlaybackTraces();
    return true;
  });
  registerIpcHandler('playbackTrace:export', () => exportPlaybackTraces());
}
