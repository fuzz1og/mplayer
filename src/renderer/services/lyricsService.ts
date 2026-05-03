import { ipcRenderer } from 'electron';

class LyricsService {
  async getLyrics(lrcUrl: string): Promise<string> {
    try {
      // 通过 IPC 调用主进程获取歌词
      const lyrics = await ipcRenderer.invoke('lyrics:get', lrcUrl);
      return lyrics;
    } catch (error) {
      console.error('通过 IPC 获取歌词失败:', error);
      throw error;
    }
  }
}

export const lyricsService = new LyricsService();
