const { ipcRenderer } = window.require('electron');

class LyricsService {
  async getLyrics(lrcUrl: string): Promise<string> {
    try {
      const result = await ipcRenderer.invoke('lyrics:get', lrcUrl);
      if (result.success && result.data) {
        return result.data;
      }
      return '';
    } catch (error) {
      console.error('通过 IPC 获取歌词失败:', error);
      return '';
    }
  }
}

export const lyricsService = new LyricsService();
