const { ipcRenderer } = window.require('electron');

export class IpcClient {
  static async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const result = await ipcRenderer.invoke(channel, ...args);
    if (result && typeof result === 'object' && 'success' in result) {
      if (!result.success) {
        throw new Error(result.error || `${channel} 失败`);
      }
      return result.data as T;
    }
    return result as T;
  }
}
