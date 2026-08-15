import './env'; // 必须第一个 import，设置 ELECTRON_GET_USE_PROXY
import { app, BrowserWindow, ipcMain, session, globalShortcut } from 'electron';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

import { DiskCacheBackend } from './cache/diskBackend';
import { downloadService } from './services/downloadService';
import { db } from './storage/db';
import { musicApi as coreMusicApi, injectProxyAgents, setApiTimingLog, loadSourceModes, setTlsDegradeProvider, setTlsFingerprintAgentProvider, loadTlsFingerprint, TLS_FINGERPRINT_SETTING_KEY, loadTier3State } from './api/musicApi';
import { TrayManager } from './tray/trayManager';
import { getLocalMusicService } from './services/localMusicService';
import { applyElectronProxy, getHttpAgent, getHttpsAgent, getTlsDegradedHttpsAgent, getTlsFingerprintHttpsAgent, type ProxyConfig } from './proxy';
import type { Tier3Subscription } from '@mplayer/core';
import { registerCacheIpc } from './ipc/cache';
import { registerFavoriteIpc, registerHistoryIpc, registerPlaylistIpc } from './ipc/favoriteHistoryPlaylist';
import { registerLocalMusicIpc } from './ipc/localMusic';
import { registerMusicApiCall } from './ipc/musicApiHandlers';
import { registerDialogIpc, registerSettingsIpc, registerUpdateIpc, registerDownloadIpc, registerAppIpc, TIER3_SETTING_KEY } from './ipc/appSettingsUpdate';
import { registerCookiePersister, loadCookiesFromDisk } from './cookies/cookieAdapter';

// 扩展 musicApi：添加主进程特有的音频缓存方法
const audioCacheBackend = new DiskCacheBackend(path.join(app.getPath('userData'), 'cache'))
const musicApi = {
  ...coreMusicApi,
  async getSodaPlayableUrl(trackId: string): Promise<string> {
    const remoteUrl = await coreMusicApi.getSodaAudioUrl(trackId);
    if (!remoteUrl) return '';
    const cacheKey = `bin:soda:${trackId}`
    const cachedPath = audioCacheBackend.getFilePath(cacheKey)
    if (fs.existsSync(cachedPath)) return 'file:///' + cachedPath.replace(/\\/g, '/');
    try {
      const dl = await axios.get(remoteUrl, {
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      const audioData = Buffer.from(dl.data)
      await audioCacheBackend.write(cacheKey, new Uint8Array(audioData))
      return 'file:///' + audioCacheBackend.getFilePath(cacheKey).replace(/\\/g, '/')
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
    frame: false,
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


  ipcMain.handle('window:minimize', () => mainWindow.minimize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized());
  ipcMain.handle('window:close', () => mainWindow.close());
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));

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

  // ADR-0001：music 域单通道分发（替换旧 musicApi:* / lyrics:get / api:getThrottleWait）
  // 必须在 createWindow() 之前注册，否则渲染层加载后立即 invoke 会报
  // “No handler registered for 'musicApi:call'”。
  registerMusicApiCall(musicApi);
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

  // 自建 API 已退役：不再设置 API_BASE_URL，直连/第三方订阅为唯一播放链路。
  // dev 诊断：API 请求耗时日志（>300ms 才打，定位慢请求/超时链路）
  if (!app.isPackaged) {
    setApiTimingLog(true);
  }

  // 内容直链 TLS 降级 agent（T09 spec #155）：core 传输层检测到内容直链 TLS
  // 握手失败时，用放宽 minVersion 的降级 agent 重试一次（仅桌面注入；RN 不注入）。
  setTlsDegradeProvider(() => ({ httpsAgent: getTlsDegradedHttpsAgent() }));

  // TLS 指纹伪装险情开关（T10 spec #156）：注入桌面指纹 agent，供 weapi 请求装配。
  // 默认关；仅桌面（RN 不注入、不开启）。
  setTlsFingerprintAgentProvider(() => getTlsFingerprintHttpsAgent());

  // 加载代理设置并应用
  try {
    const savedProxy = await db.getSetting<ProxyConfig>('proxyConfig');
    if (savedProxy) {
      injectProxyAgents(() => ({
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
      }));
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

  // 加载来源开关（直连/自建 API 模式，spec #146 T01）
  try {
    const savedModes = await db.getSetting<Partial<Record<string, string>>>('sourceModes');
    if (savedModes) {
      loadSourceModes(savedModes as Partial<Record<string, 'auto' | 'direct' | 'api'>>);
    }
  } catch (error) {
    console.error('加载来源开关设置失败:', error);
  }

  // 加载 TLS 指纹伪装险情开关（T10 spec #156，默认关，仅桌面）
  try {
    const saved = await db.getSetting<boolean>(TLS_FINGERPRINT_SETTING_KEY);
    if (typeof saved === 'boolean') {
      loadTlsFingerprint(saved);
    }
  } catch (error) {
    console.error('加载 TLS 指纹伪装设置失败:', error);
  }

  // tier3 第三方解析源订阅执行器（#144）：默认关；空清单起步，用户订阅后才生效。
  try {
    const saved = await db.getSetting<{ enabled?: boolean; subscriptions?: Tier3Subscription[] }>(TIER3_SETTING_KEY);
    if (saved) {
      loadTier3State(saved);
    }
  } catch (error) {
    console.error('加载 tier3 订阅设置失败:', error);
  }

  // T13 spec #159：桌面 cookie 管理器 - 注册落盘 persister + 冷启动重水合（仅桌面落盘）
  registerCookiePersister();
  try {
    await loadCookiesFromDisk();
  } catch (error) {
    console.error('加载源 cookie 失败:', error);
  }

  // IPC registration (grouped by domain)
  registerCacheIpc();
  registerFavoriteIpc(db);
  registerHistoryIpc(db);
  registerPlaylistIpc(db);
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
