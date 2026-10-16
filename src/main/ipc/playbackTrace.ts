import { registerIpcHandler, registerIpcHandlerSimple } from './registerHandler';
import { clearPlaybackTraces, exportPlaybackTraces, listPlaybackTraces } from '../services/playbackTraceService';

/**
 * 播放诊断 IPC（#363 / ADR `2026-09-23-playback-trace-sink`）：`list` 取当前会话环形缓冲快照（解析 trace）；
 * `clear` 清空缓冲；`export` 弹系统保存对话框写 JSON，取消返回 null。
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
