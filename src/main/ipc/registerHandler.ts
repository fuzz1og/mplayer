import { ipcMain } from 'electron';
import type { ApiResponse } from '@/shared/types/ipc';
import { checkTrustedSenderFrame } from './trustedSender';

type AsyncHandler<T, A extends any[]> = (...args: A) => Promise<T>;

/** 与 main.ts 共用同一份收紧后的信任面（dist / dev 同源，见 trustedSender.ts）。 */
function isTrustedSender(frame: Electron.WebFrameMain | null | undefined): boolean {
  return checkTrustedSenderFrame(frame) === null;
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
