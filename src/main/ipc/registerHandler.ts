import { ipcMain } from 'electron';
import type { ApiResponse } from '@/shared/types/ipc';

type AsyncHandler<T, A extends any[]> = (...args: A) => Promise<T>;

export function registerIpcHandler<T, A extends any[] = []>(
  channel: string,
  handler: AsyncHandler<T, A>
): void {
  ipcMain.handle(channel, async (_event, ...args: A): Promise<ApiResponse<T>> => {
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
  ipcMain.handle(channel, (_event, ...args: A) => {
    return handler(...args);
  });
}
