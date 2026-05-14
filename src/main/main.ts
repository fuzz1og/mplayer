import { app, BrowserWindow, ipcMain, dialog, session, globalShortcut } from 'electron';
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
import { TrayManager } from './tray/trayManager';
import { getLocalMusicService } from './services/localMusicService';

// IPC通信管理器
class IPCManager {
  private pendingRequests: Map<string, { resolve: (value: any) => void, reject: (reason?: any) => void, timeout: NodeJS.Timeout }> = new Map();
  private requestId = 0;

  constructor(private mainWindow: BrowserWindow) {}

  // 生成唯一请求ID
  private generateRequestId(): string {
    return `${Date.now()}-${++this.requestId}`;
  }

  // 发送请求并等待确认
  public async sendRequest(channel: string, data: any, timeout: number = 30000): Promise<any> {
    const requestId = this.generateRequestId();

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`IPC请求超时: ${channel}`));
      }, timeout);

      // 存储待处理请求
      this.pendingRequests.set(requestId, { resolve, reject, timeout: timeoutId });

      // 发送请求
      this.mainWindow.webContents.send(channel, {
        requestId,
        data
      });
    });
  }

  // 处理确认消息
  public handleAck(requestId: string, success: boolean, data: any, error: string) {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    // 清除超时
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    if (success) {
      pending.resolve(data);
    } else {
      pending.reject(new Error(error || 'IPC通信失败'));
    }
  }

  // 添加确认处理器
  public setupAckHandlers() {
    // 通用确认处理器
    ipcMain.on('ipc:ack', (_, payload) => {
      this.handleAck(payload.requestId, payload.success, payload.data, payload.error);
    });
  }
}

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
    return db.addToPlayHistory(song);
  });

  ipcMain.handle('history:get', (_event, limit?: number) => {
    return db.getPlayHistory(limit);
  });

  ipcMain.handle('history:clear', () => {
    return db.clearPlayHistory();
  });

  ipcMain.handle('history:remove', (_event, songId: string) => {
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

  ipcMain.handle('playlist:reorderFull', async (_event, playlistId: number, songIds: string[]) => {
    await db.reorderSongIds(playlistId, songIds);
    return { success: true };
  });

  // 歌词获取 IPC
  ipcMain.handle('lyrics:get', async (_event, lrcUrl: string) => {
    try {
      console.log('主进程获取歌词:', lrcUrl);
      const lyrics = await musicApi.getLyrics(lrcUrl);
      console.log('主进程获取歌词成功，长度:', lyrics.length);
      return { success: true, data: lyrics };
    } catch (error) {
      console.error('主进程获取歌词失败:', error);
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // 获取音频URL IPC (renderer 调用)
  ipcMain.handle('musicApi:getAudioUrl', async (_event, audioUrl: string) => {
    try {
      const url = await musicApi.getAudioUrl(audioUrl);
      return { success: true, data: url };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // 搜索歌曲 IPC (renderer 调用)
  ipcMain.handle('musicApi:searchSongs', async (_event, keyword: string, page: number, sourceType: 'netease' | 'qq') => {
    try {
      const songs = await musicApi.searchSongs(keyword, page, sourceType);
      return { success: true, data: songs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // 获取网易云热榜 IPC
  ipcMain.handle('musicApi:getNeteaseHotlist', async () => {
    try {
      console.log('[IPC] getNeteaseHotlist 开始');
      const hotlist = await musicApi.getNeteaseHotlist();
      console.log('[IPC] getNeteaseHotlist 完成，数量:', hotlist.length);
      if (!hotlist || hotlist.length === 0) {
        return { success: false, error: '获取网易热榜返回空数据' };
      }
      return { success: true, data: hotlist };
    } catch (error) {
      console.error('[IPC] getNeteaseHotlist 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // 获取QQ音乐热榜 IPC
  ipcMain.handle('musicApi:getQQHotlist', async () => {
    try {
      console.log('[IPC] getQQHotlist 开始');
      const hotlist = await musicApi.getQQHotlist();
      console.log('[IPC] getQQHotlist 完成，数量:', hotlist.length);
      if (!hotlist || hotlist.length === 0) {
        return { success: false, error: '获取QQ热榜返回空数据' };
      }
      return { success: true, data: hotlist };
    } catch (error) {
      console.error('[IPC] getQQHotlist 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  // 本地音乐 IPC
  ipcMain.handle('localMusic:addFolder', async (_event, folderPath: string) => {
    try {
      const result = await getLocalMusicService().addFolder(folderPath);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  ipcMain.handle('localMusic:removeFolder', async (_event, folderPath: string) => {
    try {
      getLocalMusicService().removeFolder(folderPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  ipcMain.handle('localMusic:getFolders', async () => {
    try {
      const folders = await getLocalMusicService().getFolders();
      return { success: true, data: folders };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  ipcMain.handle('localMusic:getSongs', async (_event, folderPath?: string) => {
    try {
      const songs = await getLocalMusicService().getSongs(folderPath);
      return { success: true, data: songs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });

  ipcMain.handle('localMusic:refresh', async () => {
    try {
      await getLocalMusicService().refresh();
      const folders = await getLocalMusicService().getFolders();
      const songs = await getLocalMusicService().getSongs();
      return { success: true, data: { folders, songs } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
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

  ipcMain.handle('app:quit', () => {
    app.exit();
  });
}

// 为图片请求补充 Cache-Control 头，利用 Chromium 内置 HTTP 缓存
// 只在服务器未返回 Cache-Control 时才注入，避免覆盖 CDN 已有的更优缓存策略
function setupImageCache() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const contentType = details.responseHeaders?.['content-type']?.[0] || '';
    const isImage = contentType.startsWith('image/');
    const hasCacheControl = details.responseHeaders?.['cache-control']?.[0];

    if (isImage && !hasCacheControl) {
      details.responseHeaders = {
        ...details.responseHeaders,
        'Cache-Control': ['public, max-age=604800']
      };
    }

    callback({ responseHeaders: details.responseHeaders });
  });
}

function setupGlobalShortcuts(mainWindow: BrowserWindow) {
  const sendAction = (type: string) => {
    mainWindow.webContents.send('shortcut:action', { type });
  };

  globalShortcut.register('MediaPlayPause', () => sendAction('playPause'));
  globalShortcut.register('MediaNextTrack', () => sendAction('next'));
  globalShortcut.register('MediaPreviousTrack', () => sendAction('prev'));
  globalShortcut.register('CommandOrControl+Alt+Space', () => sendAction('playPause'));
  globalShortcut.register('CommandOrControl+Alt+Right', () => sendAction('next'));
  globalShortcut.register('CommandOrControl+Alt+Left', () => sendAction('prev'));
}

app.whenReady().then(async () => {
  setupImageCache();
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

  // 设置IPC管理器
  const ipcManager = new IPCManager(mainWindow);
  ipcManager.setupAckHandlers();

  // 设置 IPC 处理器
  setupIPC();

  const trayManager = new TrayManager();
  trayManager.create(mainWindow);

  setupGlobalShortcuts(mainWindow);

  // Tray state sync from renderer
  ipcMain.on('tray:state', (_event, state: { songName: string; artist: string; isPlaying: boolean }) => {
    trayManager.updateSongInfo(state.songName, state.artist);
    trayManager.updatePlayState(state.isPlaying);
    trayManager.refreshMenu(mainWindow);
  });

  // Tray action handler (minimize, etc.)
  ipcMain.on('tray:action', (_event, payload: { type: string }) => {
    if (payload.type === 'minimize') {
      mainWindow.hide();
      return;
    }
    mainWindow.webContents.send('tray:action', payload);
  });

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

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
