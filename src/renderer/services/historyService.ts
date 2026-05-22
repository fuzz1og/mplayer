import { IpcClient } from './IpcClient';
import type { Song, SongBase } from '@/shared/types/song';

export interface HistoryService {
  addToHistory(song: Song): Promise<number>;
  getHistory(limit?: number): Promise<Song[]>;
  clearHistory(): Promise<void>;
  removeFromHistory(songId: string): Promise<void>;
}

class HistoryServiceImpl implements HistoryService {
  async addToHistory(song: Song): Promise<number> {
    return IpcClient.invoke<number>('history:add', song);
  }

  async getHistory(limit: number = 100): Promise<Song[]> {
    const history = await IpcClient.invoke<any[]>('history:get', limit);
    const songBases = history.map((h: any) => h.song as SongBase);

    const uniqueMap = new Map<string, SongBase>();
    songBases.forEach((s: SongBase) => uniqueMap.set(s.id, s));

    const songsWithCover = await Promise.all(
      Array.from(uniqueMap.values()).map(async (songBase) => {
        try {
          const songs = await IpcClient.invoke<Song[]>('musicApi:searchSongs', `${songBase.name} ${songBase.artist}`, 1, songBase.sourceType);
          if (songs.length > 0) {
            return songs[0];
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
    return IpcClient.invoke<void>('history:clear');
  }

  async removeFromHistory(songId: string): Promise<void> {
    return IpcClient.invoke<void>('history:remove', songId);
  }
}

export const historyService = new HistoryServiceImpl();
