import { registerIpcHandler } from './registerHandler';
import { getLocalMusicService } from '../services/localMusicService';
import type { BrowserWindow } from 'electron';

export function registerLocalMusicIpc(mainWindow: BrowserWindow): void {
  const service = getLocalMusicService();
  registerIpcHandler('localMusic:addFolder', async (folderPath: string) => {
    const result = await service.addFolder(folderPath);
    service.startWatching(folderPath, (type, songs, songIds) => {
      mainWindow.webContents.send('localMusic:folderChanged', { type, folderPath, songs, songIds });
    });
    return result;
  });
  registerIpcHandler('localMusic:removeFolder', (folderPath: string) => service.removeFolder(folderPath));
  registerIpcHandler('localMusic:getFolders', () => service.getFolders());
  registerIpcHandler('localMusic:getSongs', (folderPath?: string) => service.getSongs(folderPath));
  registerIpcHandler('localMusic:refresh', async () => {
    await service.refresh();
    const folders = await service.getFolders();
    const songs = await service.getSongs();
    return { folders, songs };
  });
}
