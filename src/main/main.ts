import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';

// 开发模式下加载 .env.local
if (!app.isPackaged) {
  const envPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^MUSIC_API_URL=(.*)$/);
      if (match) {
        process.env.MUSIC_API_URL = match[1].trim();
      }
    });
  }
}

import { getCacheManager } from './cache/cacheManager';
import { downloadService } from './services/downloadService';
import { db } from './storage/db';
import { musicApi } from './api/musicApi';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    },
    titleBarStyle: 'hiddenInset',
    show: false
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  return mainWindow;
}

function setupIPC() {
  // 缓存相关 IPC
  ipcMain.handle('cache:getSong', (_event, keyword: string) => {
    return getCacheManager().getSongCache(keyword);
  });

  ipcMain.handle('cache:setSong', (_event, keyword: string, songs: any[]) => {
    getCacheManager().setSongCache(keyword, songs);
  });

  ipcMain.handle('cache:getCover', (_event, coverUrl: string) => {
    return getCacheManager().getCoverCache(coverUrl);
  });

  ipcMain.handle('cache:setCover', (_event, coverUrl: string, imageData: Buffer) => {
    getCacheManager().setCoverCache(coverUrl, imageData);
  });

  ipcMain.handle('cache:getAudio', (_event, audioUrl: string) => {
    return getCacheManager().getAudioCache(audioUrl);
  });

  ipcMain.handle('cache:setAudio', (_event, audioUrl: string, audioData: Buffer) => {
    getCacheManager().setAudioCache(audioUrl, audioData);
  });

  ipcMain.handle('cache:getUrl', (_event, songId: string) => {
    return getCacheManager().getUrlCache(songId);
  });

  ipcMain.handle('cache:setUrl', (_event, songId: string, urlData: any) => {
    getCacheManager().setUrlCache(songId, urlData);
  });

  ipcMain.handle('cache:clear', () => {
    getCacheManager().clearAllCache();
  });

  ipcMain.handle('cache:getStats', () => {
    return getCacheManager().getCacheStats();
  });

  // 收藏相关 IPC
  ipcMain.handle('favorite:add', (_event, song: any) => {
    return db.addFavorite(song);
  });

  ipcMain.handle('favorite:remove', (_event, songId: string) => {
    return db.removeFavorite(songId);
  });

  ipcMain.handle('favorite:isFavorite', (_event, songId: string) => {
    return db.isFavorite(songId);
  });

  ipcMain.handle('favorite:getAll', () => {
    return db.getFavorites();
  });

  // 历史记录相关 IPC
  ipcMain.handle('history:add', (_event, song: any) => {
    console.log('[main.ts] history:add 被调用，song:', song?.name, 'song.id:', song?.id);
    return db.addToPlayHistory(song);
  });

  ipcMain.handle('history:get', (_event, limit?: number) => {
    console.log('[main.ts] history:get 被调用，limit:', limit);
    return db.getPlayHistory(limit);
  });

  ipcMain.handle('history:clear', () => {
    console.log('[main.ts] history:clear 被调用');
    return db.clearPlayHistory();
  });

  ipcMain.handle('history:remove', (_event, songId: string) => {
    console.log('[main.ts] history:remove 被调用，songId:', songId);
    return db.removeFromPlayHistory(songId);
  });

  // 歌单相关 IPC
  ipcMain.handle('playlist:create', (_event, name: string, description?: string) => {
    return db.createPlaylist(name, description);
  });

  ipcMain.handle('playlist:getAll', () => {
    return db.getPlaylists();
  });

  ipcMain.handle('playlist:get', (_event, playlistId: number) => {
    return db.getPlaylist(playlistId);
  });

  ipcMain.handle('playlist:update', (_event, playlistId: number, playlist: any) => {
    return db.updatePlaylist(playlistId, playlist);
  });

  ipcMain.handle('playlist:delete', (_event, playlistId: number) => {
    return db.deletePlaylist(playlistId);
  });

  ipcMain.handle('playlist:addSong', (_event, playlistId: number, song: any) => {
    return db.addSongToPlaylist(playlistId, song);
  });

  ipcMain.handle('playlist:removeSong', (_event, playlistId: number, songId: string) => {
    return db.removeSongFromPlaylist(playlistId, songId);
  });

  ipcMain.handle('playlist:getSongs', (_event, playlistId: number) => {
    return db.getPlaylistSongs(playlistId);
  });

  ipcMain.handle('playlist:updateSongsOrder', async (_event, playlistId: number, songId: string, order: number) => {
    await db.updatePlaylistSongOrder(playlistId, songId, order);
  });



  // 歌词获取 IPC
  ipcMain.handle('lyrics:get', async (_event, lrcUrl: string) => {
    try {
      console.log('主进程获取歌词:', lrcUrl);
      const lyrics = await musicApi.getLyrics(lrcUrl);
      console.log('主进程获取歌词成功，长度:', lyrics.length);
      return lyrics;
    } catch (error) {
      console.error('主进程获取歌词失败:', error);
      throw error;
    }
  });

  // 对话框相关 IPC
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });
    return result;
  });

  // 设置相关 IPC
  ipcMain.handle('settings:getDownloadPath', async () => {
    return downloadService.getDownloadPath();
  });

  ipcMain.handle('settings:setDownloadPath', async (_event, path: string) => {
    try {
      downloadService.updateDownloadPath(path);
      await db.setSetting('downloadPath', path);
      return { success: true };
    } catch (error) {
      console.error('设置下载目录失败:', error);
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  ipcMain.handle('settings:resetDownloadPath', async () => {
    try {
      const defaultPath = app.getPath('downloads');
      downloadService.updateDownloadPath(defaultPath);
      await db.setSetting('downloadPath', defaultPath);
      return { success: true, path: defaultPath };
    } catch (error) {
      console.error('重置下载目录失败:', error);
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // API URL 设置
  ipcMain.handle('settings:getApiUrl', async () => {
    return db.getSetting('apiUrl') || '';
  });

  ipcMain.handle('settings:setApiUrl', async (_event, url: string) => {
    try {
      await db.setSetting('apiUrl', url);
      return { success: true };
    } catch (error) {
      console.error('设置API地址失败:', error);
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });
}

app.whenReady().then(async () => {
  const mainWindow = createWindow();

  // 获取保存的下载目录，如果没有则使用默认的 Downloads 目录
  const defaultDownloadPath = app.getPath('downloads');
  let downloadPath = defaultDownloadPath;
  try {
    const savedDownloadPath = await db.getSetting<string>('downloadPath');
    if (savedDownloadPath) {
      downloadPath = savedDownloadPath;
    }
  } catch (error) {
    console.error('读取下载目录设置失败:', error);
  }

  // 初始化下载服务
  downloadService.initialize({
    downloadPath,
    onProgress: (task) => {
      mainWindow.webContents.send('download:progress', task);
    },
    onComplete: (task) => {
      mainWindow.webContents.send('download:complete', task);
    },
    onError: (task, error) => {
      mainWindow.webContents.send('download:error', { task, error: error.message });
    }
  });

  // 设置 IPC 处理器
  setupIPC();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
