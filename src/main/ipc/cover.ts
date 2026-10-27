import { getCoverAccent, isSupportedCoverSource } from '../services/coverAccent';
import { registerIpcHandlerSimple } from './registerHandler';

/**
 * 全屏播放器封面取色 IPC（#688）。
 *
 * 入参只有一个 cover 字符串；非字符串、空串、非 http(s)/本地绝对路径一律 null。
 * 任何取图/解码失败也静默 null —— 渲染层拿不到颜色就回落纯色底，不应看到错误弹窗。
 */
export function registerCoverIpc(): void {
  registerIpcHandlerSimple('cover:getAccent', async (coverUrl: unknown) => {
    if (typeof coverUrl !== 'string') return null;
    const value = coverUrl.trim();
    if (!value || !isSupportedCoverSource(value)) return null;
    return getCoverAccent(value);
  });
}
