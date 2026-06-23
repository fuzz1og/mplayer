import './env'; // 必须第一个 import，设置 ELECTRON_GET_USE_PROXY
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
import { updateService } from './services/updateService';
import type { Song } from '@/shared/types/song';

// 标记是否正在退出（托盘退出时设置，防止 close 事件拦截退出）
let isQuitting = false;

function createWindow() {
  const iconPath = path.join(app.getAppPath(), 'resources', 'icon.png');
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    },
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    show: false
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    if (!app.isPackaged) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 关闭时隐藏到托盘，而不是退出
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
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
      // 同时配置 electron-updater 的专用 session
      try {
        const { autoUpdater } = require('electron-updater');
        const updaterSession = autoUpdater.netSession;
        if (updaterSession) {
          if (savedProxy.enabled && savedProxy.host) {
            const proxyRules = `http=${savedProxy.host}:${savedProxy.port};https=${savedProxy.host}:${savedProxy.port}`;
            await updaterSession.setProxy({ proxyRules });
          } else {
            await updaterSession.setProxy({ proxyRules: 'direct://' });
          }
        }
      } catch (updaterErr) {
        console.error('electron-updater session 代理配置失败:', updaterErr);
      }
    } else {
      applyElectronProxy({ enabled: false, host: '', port: 8080, protocol: 'http' });
    }
  } catch (error) {
    console.error('加载代理设置失败:', error);
    applyElectronProxy({ enabled: false, host: '', port: 8080, protocol: 'http' });
  }

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
  registerIpcHandler('favorite:updateSongData', (songId: string, songData: any) => db.updateFavoriteSongData(songId, songData));

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
  registerIpcHandler('playlist:updateSongData', (playlistId: number, songId: string, songData: any) => db.updatePlaylistSongData(playlistId, songId, songData));
  registerIpcHandler('playlist:reorderFull', async (playlistId: number, songIds: string[]) => {
    await db.reorderSongIds(playlistId, songIds);
  });

  // 歌词 & 音乐 API IPC
  registerIpcHandler('lyrics:get', (lrcUrl: string) => musicApi.getLyrics(lrcUrl));
  registerIpcHandler('musicApi:getAudioUrl', (audioUrl: string) => musicApi.getAudioUrl(audioUrl));
  registerIpcHandler('musicApi:getSodaAudioUrl', (trackId: string) => musicApi.getSodaAudioUrl(trackId));
  registerIpcHandler('musicApi:getSodaPlayableUrl', (trackId: string) => musicApi.getSodaPlayableUrl(trackId));
  registerIpcHandler('musicApi:parseSodaShareLink', (link: string) => musicApi.parseSodaShareLink(link));
  registerIpcHandler('musicApi:searchSongs', (keyword: string, page: number, sourceType: 'netease' | 'qq' | 'kugou' | 'migu' | 'kuwo' | 'qianqian' | 'soda') => musicApi.searchSongs(keyword, page, sourceType));
  registerIpcHandler('musicApi:batchSearch', (keywords: string[], sourceType: 'netease' | 'qq' | 'kugou' | 'migu' | 'kuwo' | 'qianqian' | 'soda') => musicApi.batchSearch(keywords, sourceType));
  registerIpcHandler('musicApi:searchAllSources', (keyword: string, page: number) => musicApi.searchAllSources(keyword, page));
  registerIpcHandler('musicApi:getNeteaseHotlist', () => musicApi.getNeteaseHotlist());
  registerIpcHandler('musicApi:getNeteaseNewSongList', () => musicApi.getNeteaseNewSongList());
  registerIpcHandler('musicApi:getQQHotlist', () => musicApi.getQQHotlist());
  registerIpcHandler('musicApi:getQQNewSongList', () => musicApi.getQQNewSongList());
  registerIpcHandler('musicApi:getNeteasePlaylists', (cat: string, order: string, offset: number, limit: number) => musicApi.getNeteasePlaylists(cat, order, offset, limit));
  registerIpcHandler('musicApi:getNeteasePlaylistDetail', (id: number) => musicApi.getNeteasePlaylistDetail(id));
  registerIpcHandler('musicApi:getPlaylistSongsFromThirdParty', (playlistUrl: string, sourceType: 'netease' | 'qq' | 'kugou' | 'migu' | 'kuwo' | 'qianqian' | 'soda' = 'netease') => musicApi.getPlaylistSongsFromThirdParty(playlistUrl, sourceType));
  registerIpcHandler('musicApi:getNeteaseArtists', (cat: number, offset: number, limit: number, initial: number) => musicApi.getNeteaseArtists(cat, offset, limit, initial));
  registerIpcHandler('musicApi:getArtistSongs', (artistId: string, offset: number, limit: number, order: string) => musicApi.getNeteaseArtistSongs(artistId, offset, limit, order));
  registerIpcHandler('musicApi:searchArtists', (keyword: string, limit: number) => musicApi.searchNeteaseArtists(keyword, limit));

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
  registerIpcHandler('settings:setApiUrl', (url: string) => {
    // 仅允许 http/https 协议，防止 file:// 等危险协议
    if (url && !/^https?:\/\/.+/.test(url)) {
      throw new Error('API URL 必须以 http:// 或 https:// 开头');
    }
    return db.setSetting('apiUrl', url);
  });
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
  registerIpcHandlerSimple('app:quit', () => app.quit());

  // 更新 IPC
  updateService.setMainWindow(mainWindow);
  registerIpcHandler('update:check', () => updateService.checkForUpdates());
  registerIpcHandler('update:download', () => updateService.downloadUpdate());
  registerIpcHandlerSimple('update:install', () => updateService.quitAndInstall());
  registerIpcHandlerSimple('update:getVersion', () => updateService.getVersion());

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
    // 截断并过滤控制字符，防止恶意内容注入托盘
    const sanitize = (s: string) => (s || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100);
    trayManager.updateSongInfo(sanitize(state.songName), sanitize(state.artist));
    trayManager.updatePlayState(!!state.isPlaying);
    trayManager.refreshMenu(mainWindow);
  });

  // Tray action handler (minimize, etc.) - 仅允许已知类型
  const TRAY_ACTION_TYPES = new Set(['minimize']);
  ipcMain.on('tray:action', (_event, payload: { type: string }) => {
    if (payload.type === 'minimize') {
      mainWindow.hide();
      return;
    }
    if (TRAY_ACTION_TYPES.has(payload.type)) {
      mainWindow.webContents.send('tray:action', payload);
    }
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

// 在退出流程开始时设置标志，让 close 事件不再拦截
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  // 确保防抖写入的数据落盘
  try {
    const { fileStorage } = require('./storage/fileStorage');
    if (fileStorage && typeof fileStorage.flushSave === 'function') {
      fileStorage.flushSave();
    }
  } catch {
    // ignore
  }
});
