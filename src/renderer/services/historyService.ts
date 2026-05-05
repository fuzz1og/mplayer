const { ipcRenderer } = window.require('electron');
import type { Song, SongBase } from '@/shared/types/song';

export interface HistoryService {
  addToHistory(song: Song): Promise<number>;
  getHistory(limit?: number): Promise<Song[]>;
  clearHistory(): Promise<void>;
  removeFromHistory(songId: string): Promise<void>;
}

class HistoryServiceImpl implements HistoryService {
  async addToHistory(song: Song): Promise<number> {
    return ipcRenderer.invoke('history:add', song);
  }

  async getHistory(limit: number = 100): Promise<Song[]> {
    const history = await ipcRenderer.invoke('history:get', limit);
    const songBases = history.map((h: any) => h.song as SongBase);

    const uniqueMap = new Map<string, SongBase>();
    songBases.forEach((s: SongBase) => uniqueMap.set(s.id, s));

    const songsWithCover = await Promise.all(
      Array.from(uniqueMap.values()).map(async (songBase) => {
        try {
          const result = await ipcRenderer.invoke(
            'musicApi:searchSongs',
            `${songBase.name} ${songBase.artist}`,
            1,
            songBase.sourceType
          );
          if (result.success && result.data.length > 0) {
            return result.data[0];
          }
        } catch (e) {
          console.error('获取历史封面失败:', e);
        }
        return { ...songBase, url: '', cover: '', lrc: '' } as Song;
      })
    );

    return songsWithCover;
  }

  async clearHistory(): Promise<void> {
    return ipcRenderer.invoke('history:clear');
  }

  async removeFromHistory(songId: string): Promise<void> {
    return ipcRenderer.invoke('history:remove', songId);
  }
}

export const historyService = new HistoryServiceImpl();
