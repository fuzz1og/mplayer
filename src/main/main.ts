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
import { musicApi, getApiClient } from './api/musicApi';
import { TrayManager } from './tray/trayManager';
import { getLocalMusicService } from './services/localMusicService';
import { updateApiClientAgents, applyElectronProxy, type ProxyConfig } from './proxy';
import { registerIpcHandler, registerIpcHandlerSimple } from './ipc/registerHandler';
import type { Song } from '@/shared/types/song';

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

  // 加载代理设置并应用（必须在 setupIPC 之前，因为 setupIPC 中的 getApiClient 需要 proxy 模块就绪）
  try {
    const savedProxy = await db.getSetting<ProxyConfig>('proxyConfig');
    if (savedProxy) {
      updateApiClientAgents(getApiClient(), savedProxy);
      applyElectronProxy(savedProxy);
    } else {
      applyElectronProxy({ enabled: false, host: '', port: 8080, protocol: 'http' });
    }
  } catch (error) {
    console.error('加载代理设置失败:', error);
    applyElectronProxy({ enabled: false, host: '', port: 8080, protocol: 'http' });
  }

  // 设置IPC管理器
  const ipcManager = new IPCManager(mainWindow);
  ipcManager.setupAckHandlers();

  // 缓存 IPC (同步)
  registerIpcHandlerSimple('cache:getSong', (keyword: string) => getCacheManager().getSongCache(keyword));
  registerIpcHandlerSimple('cache:setSong', (keyword: string, songs: any[]) => getCacheManager().setSongCache(keyword, songs));
  registerIpcHandlerSimple('cache:getCover', (coverUrl: string) => getCacheManager().getCoverCache(coverUrl));
  registerIpcHandlerSimple('cache:setCover', (coverUrl: string, imageData: Buffer) => getCacheManager().setCoverCache(coverUrl, imageData));
  registerIpcHandlerSimple('cache:getAudio', (audioUrl: string) => getCacheManager().getAudioCache(audioUrl));
  registerIpcHandlerSimple('cache:setAudio', (audioUrl: string, audioData: Buffer) => getCacheManager().setAudioCache(audioUrl, audioData));
  registerIpcHandlerSimple('cache:getUrl', (songId: string) => getCacheManager().getUrlCache(songId));
  registerIpcHandlerSimple('cache:setUrl', (songId: string, urlData: any) => getCacheManager().setUrlCache(songId, urlData));
  registerIpcHandlerSimple('cache:clear', () => getCacheManager().clearAllCache());
  registerIpcHandlerSimple('cache:getStats', () => getCacheManager().getCacheStats());

  // 收藏 IPC
  registerIpcHandler('favorite:add', (song: any) => db.addFavorite(song));
  registerIpcHandler('favorite:remove', (songId: string) => db.removeFavorite(songId));
  registerIpcHandler('favorite:isFavorite', (songId: string) => db.isFavorite(songId));
  registerIpcHandler('favorite:getAll', () => db.getFavorites());

  // 历史记录 IPC
  registerIpcHandler('history:add', (song: any) => db.addToPlayHistory(song));
  registerIpcHandler('history:get', (limit?: number) => db.getPlayHistory(limit));
  registerIpcHandler('history:clear', () => db.clearPlayHistory());
  registerIpcHandler('history:remove', (songId: string) => db.removeFromPlayHistory(songId));

  // 歌单 IPC
  registerIpcHandler('playlist:create', (name: string, description?: string) => db.createPlaylist(name, description));
  registerIpcHandler('playlist:getAll', () => db.getPlaylists());
  registerIpcHandler('playlist:get', (playlistId: number) => db.getPlaylist(playlistId));
  registerIpcHandler('playlist:update', (playlistId: number, playlist: any) => db.updatePlaylist(playlistId, playlist));
  registerIpcHandler('playlist:delete', (playlistId: number) => db.deletePlaylist(playlistId));
  registerIpcHandler('playlist:addSong', (playlistId: number, song: any) => db.addSongToPlaylist(playlistId, song));
  registerIpcHandler('playlist:removeSong', (playlistId: number, songId: string) => db.removeSongFromPlaylist(playlistId, songId));
  registerIpcHandler('playlist:getSongs', (playlistId: number) => db.getPlaylistSongs(playlistId));
  registerIpcHandler('playlist:updateSongsOrder', (playlistId: number, songId: string, order: number) => db.updatePlaylistSongOrder(playlistId, songId, order));
  registerIpcHandler('playlist:reorderFull', async (playlistId: number, songIds: string[]) => {
    await db.reorderSongIds(playlistId, songIds);
  });

  // 歌词 & 音乐 API IPC
  registerIpcHandler('lyrics:get', (lrcUrl: string) => musicApi.getLyrics(lrcUrl));
  registerIpcHandler('musicApi:getAudioUrl', (audioUrl: string) => musicApi.getAudioUrl(audioUrl));
  registerIpcHandler('musicApi:searchSongs', (keyword: string, page: number, sourceType: 'netease' | 'qq' | 'kugou') => musicApi.searchSongs(keyword, page, sourceType));
  registerIpcHandler('musicApi:batchSearch', (keywords: string[], sourceType: 'netease' | 'qq' | 'kugou') => musicApi.batchSearch(keywords, sourceType));
  registerIpcHandler('musicApi:getNeteaseHotlist', () => musicApi.getNeteaseHotlist());
  registerIpcHandler('musicApi:getQQHotlist', () => musicApi.getQQHotlist());
  registerIpcHandler('musicApi:getNeteaseArtists', (catId: number, initial: number, offset: number, limit: number) => musicApi.getNeteaseArtists(catId, initial, offset, limit));
  registerIpcHandler('musicApi:getArtistSongs', (artistId: string, offset: number, limit: number, order: string) => musicApi.getNeteaseArtistSongs(artistId, offset, limit, order as 'hot' | 'time'));

  // 本地音乐 IPC
  registerIpcHandler('localMusic:addFolder', async (folderPath: string) => {
    const result = await getLocalMusicService().addFolder(folderPath);
    getLocalMusicService().startWatching(folderPath, (type, songs, songIds) => {
      mainWindow.webContents.send('localMusic:folderChanged', {
        type, folderPath, songs, songIds,
      });
    });
    return result;
  });
  registerIpcHandler('localMusic:removeFolder', (folderPath: string) => getLocalMusicService().removeFolder(folderPath));
  registerIpcHandler('localMusic:getFolders', () => getLocalMusicService().getFolders());
  registerIpcHandler('localMusic:getSongs', (folderPath?: string) => getLocalMusicService().getSongs(folderPath));
  registerIpcHandler('localMusic:refresh', async () => {
    await getLocalMusicService().refresh();
    const folders = await getLocalMusicService().getFolders();
    const songs = await getLocalMusicService().getSongs();
    return { folders, songs };
  });

  // 对话框 IPC
  registerIpcHandlerSimple('dialog:openDirectory', () => dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }));

  // 设置 IPC
  registerIpcHandlerSimple('settings:getDownloadPath', () => downloadService.getDownloadPath());
  registerIpcHandler('settings:setDownloadPath', async (path: string) => {
    downloadService.updateDownloadPath(path);
    await db.setSetting('downloadPath', path);
  });
  registerIpcHandler('settings:resetDownloadPath', async () => {
    const defaultPath = app.getPath('downloads');
    downloadService.updateDownloadPath(defaultPath);
    await db.setSetting('downloadPath', defaultPath);
    return { path: defaultPath };
  });
  registerIpcHandlerSimple('settings:getApiUrl', () => db.getSetting('apiUrl') || '');
  registerIpcHandler('settings:setApiUrl', (url: string) => db.setSetting('apiUrl', url));
  registerIpcHandlerSimple('settings:getProxy', async () => {
    const saved = await db.getSetting<ProxyConfig>('proxyConfig');
    return saved || { enabled: false, host: '', port: 8080, protocol: 'http' };
  });
  registerIpcHandler('settings:setProxy', async (proxyConfig: ProxyConfig) => {
    await db.setSetting('proxyConfig', proxyConfig);
    updateApiClientAgents(getApiClient(), proxyConfig);
    applyElectronProxy(proxyConfig);
  });

  // 应用 IPC
  registerIpcHandlerSimple('app:quit', () => app.exit());

  // 下载 IPC（移自 downloadService）
  registerIpcHandlerSimple('download:start', (song: Song) => downloadService.addDownload(song));
  registerIpcHandlerSimple('download:startBatch', (songs: Song[]) => downloadService.addBatchDownloads(songs));
  registerIpcHandlerSimple('download:cancel', (taskId: string) => downloadService.cancelDownload(taskId));
  registerIpcHandlerSimple('download:getTasks', () => downloadService.getAllTasks());
  registerIpcHandlerSimple('download:clearCompleted', () => downloadService.clearCompleted());

  // 对每个已有文件夹单独启动监视，确保 folderPath 正确传递
  getLocalMusicService().getFolders().then((existingFolders) => {
    for (const folder of existingFolders) {
      getLocalMusicService().startWatching(folder.path, (type, songs, songIds) => {
        mainWindow.webContents.send('localMusic:folderChanged', {
          type, folderPath: folder.path, songs, songIds,
        });
      });
    }
  });

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
