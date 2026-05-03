import { ipcRenderer } from 'electron';
import type { Song } from '@/shared/types/song';

export interface HistoryService {
  addToHistory(song: Song): Promise<number>;
  getHistory(limit?: number): Promise<Song[]>;
  clearHistory(): Promise<void>;
  removeFromHistory(songId: string): Promise<void>;
}

class HistoryServiceImpl implements HistoryService {
  async addToHistory(song: Song): Promise<number> {
    console.log('[historyService] addToHistory 被调用，song:', song.name, 'song.id:', song.id, 'sourceType:', song.sourceType);
    return ipcRenderer.invoke('history:add', song);
  }

  async getHistory(limit: number = 100): Promise<Song[]> {
    console.log('[historyService] getHistory 被调用，limit:', limit);
    const history = await ipcRenderer.invoke('history:get', limit);
    const songs = history.map((h: any) => h.song as Song);

    console.log('[historyService] 从主进程获取到', songs.length, '条记录');

    // 使用Map去重，保持最后一条记录
    const songMap = new Map<string, Song>(songs.map((s: Song) => [s.id, s]));
    const uniqueSongs = Array.from(songMap.values());

    console.log('[historyService] 去重后', uniqueSongs.length, '条记录');

    return uniqueSongs;
  }

  async clearHistory(): Promise<void> {
    console.log('[historyService] clearHistory 被调用');
    return ipcRenderer.invoke('history:clear');
  }

  async removeFromHistory(songId: string): Promise<void> {
    console.log('[historyService] removeFromHistory 被调用，songId:', songId);
    return ipcRenderer.invoke('history:remove', songId);
  }
}

export const historyService = new HistoryServiceImpl();
