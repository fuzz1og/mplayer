import { ipcMain } from 'electron';
import type { ApiResponse } from '@/shared/types/ipc';

type AsyncHandler<T, A extends any[]> = (...args: A) => Promise<T>;

/**
 * IPC 来源可信校验（审查修复）：只信任应用自身页面（file:// 生产 / dev server 开发）。
 * 渲染层被注入时，senderFrame.url 为恶意来源 → 拦截，返回失败封套。
 * 测试直接调用 handler（无 event/senderFrame）时放行，保持测试可驱动。
 */
function isTrustedSender(frame: Electron.WebFrameMain | null | undefined): boolean {
  if (!frame) return true; // 非真实 IPC 调用（测试直接调用）
  const url = frame.url || '';
  if (url.startsWith('file://')) return true;
  if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) return true;
  return false;
}

export function registerIpcHandler<T, A extends any[] = []>(
  channel: string,
  handler: AsyncHandler<T, A>
): void {
  ipcMain.handle(channel, async (event, ...args: A): Promise<ApiResponse<T>> => {
    if (!isTrustedSender(event?.senderFrame)) {
      console.warn(`[IPC] 拦截非可信来源调用 ${channel}: ${event?.senderFrame?.url ?? 'unknown'}`);
      return { success: false, error: 'IPC 来源不受信任' };
    }
    try {
      const data = await handler(...args);
      return { success: true, data };
    } catch (error) {
      console.error(`[IPC] ${channel} 失败:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  });
}

export function registerIpcHandlerSimple<T, A extends any[] = []>(
  channel: string,
  handler: (...args: A) => T
): void {
  ipcMain.handle(channel, (event, ...args: A) => {
    if (!isTrustedSender(event?.senderFrame)) {
      console.warn(`[IPC] 拦截非可信来源调用 ${channel}: ${event?.senderFrame?.url ?? 'unknown'}`);
      throw new Error('IPC 来源不受信任');
    }
    try {
      return handler(...args);
    } catch (error) {
      console.error(`[IPC] ${channel} 失败:`, error);
      throw error;
    }
  });
}
