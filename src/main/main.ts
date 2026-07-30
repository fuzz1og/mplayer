import './env'; // 必须第一个 import，设置 ELECTRON_GET_USE_PROXY
import { app, BrowserWindow, ipcMain, session, globalShortcut } from 'electron';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

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
import { getApiUrl } from './config';
import { musicApi as coreMusicApi, injectProxyAgents, setApiBaseUrl } from './api/musicApi';
import { setMusicServiceConfig } from '@mplayer/core';
import { TrayManager } from './tray/trayManager';
import { getLocalMusicService } from './services/localMusicService';
import { applyElectronProxy, type ProxyConfig } from './proxy';
import { registerCacheIpc } from './ipc/cache';
import { registerFavoriteIpc, registerHistoryIpc, registerPlaylistIpc } from './ipc/favoriteHistoryPlaylist';
import { registerMusicApiIpc } from './ipc/musicApi';
import { registerLocalMusicIpc } from './ipc/localMusic';
import { registerDialogIpc, registerSettingsIpc, registerUpdateIpc, registerDownloadIpc, registerAppIpc } from './ipc/appSettingsUpdate';

// 扩展 musicApi：添加主进程特有的音频缓存方法
const musicApi = {
  ...coreMusicApi,
  async getSodaPlayableUrl(trackId: string): Promise<string> {
    const remoteUrl = await coreMusicApi.getSodaAudioUrl(trackId);
    if (!remoteUrl) return '';
    const cached = getCacheManager().getAudioCache(`soda_${trackId}`);
    if (cached) return 'file:///' + cached.replace(/\\/g, '/');
    try {
      const proxy = require('./proxy');
      const dl = await axios.get(remoteUrl, {
        httpAgent: proxy.getHttpAgent(),
        httpsAgent: proxy.getHttpsAgent(),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      const audioData = Buffer.from(dl.data);
      getCacheManager().setAudioCache(`soda_${trackId}`, audioData);
      const cachedFile = getCacheManager().getAudioCache(`soda_${trackId}`);
      if (cachedFile) return 'file:///' + cachedFile.replace(/\\/g, '/');
    } catch (dlErr) {
      console.error('下载汽水音频到缓存失败，回退直链:', dlErr);
    }
    return remoteUrl;
  },
};

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

  // 设置 API base URL（必须在 IPC 注册之前）
  const resolvedApiUrl = getApiUrl();
  if (resolvedApiUrl) {
    setApiBaseUrl(resolvedApiUrl);
    setMusicServiceConfig({ apiBaseUrl: resolvedApiUrl });
  }

  // 加载代理设置并应用
  try {
    const savedProxy = await db.getSetting<ProxyConfig>('proxyConfig');
    if (savedProxy) {
      const proxy = require('./proxy');
      injectProxyAgents(() => ({
        httpAgent: proxy.getHttpAgent(),
        httpsAgent: proxy.getHttpsAgent(),
      }));
      applyElectronProxy(savedProxy);
      setMusicServiceConfig({
        proxyUrl: savedProxy?.enabled && savedProxy.host
          ? `${savedProxy.protocol}://${savedProxy.host}:${savedProxy.port}`
          : '',
      });
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

  // IPC registration (grouped by domain)
  registerCacheIpc();
  registerFavoriteIpc(db);
  registerHistoryIpc(db);
  registerPlaylistIpc(db);
  registerMusicApiIpc(musicApi);
  registerLocalMusicIpc(mainWindow);
  registerDialogIpc();
  registerSettingsIpc();
  registerUpdateIpc(mainWindow);
  registerDownloadIpc();
  registerAppIpc();

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
