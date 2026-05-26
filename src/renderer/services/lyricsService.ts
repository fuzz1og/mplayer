import { IpcClient } from './IpcClient';

class LyricsService {
  async getLyrics(lrcUrl: string): Promise<string> {
    return IpcClient.invoke<string>('lyrics:get', lrcUrl);
  }
}

export const lyricsService = new LyricsService();
