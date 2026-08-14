import { app, dialog } from 'electron';
import { registerIpcHandler, registerIpcHandlerSimple } from './registerHandler';
import { downloadService } from '../services/downloadService';
import { updateService } from '../services/updateService';
import { db } from '../storage/db';
import { applyElectronProxy, buildAgents, type ProxyConfig } from '../proxy';
import {
  setSourceModes,
  setSourceModePersister,
  getAllSourceModes,
  hasDirectClient,
} from '../api/musicApi';
import { MULTI_SOURCE_LIST, type SourceKey, type SourceMode } from '@mplayer/core';
import type { BrowserWindow } from 'electron';

const SOURCE_MODE_SET: ReadonlySet<SourceMode> = new Set(['auto', 'direct', 'api']);

export function registerDialogIpc(): void {
  registerIpcHandlerSimple('dialog:openDirectory', () => dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }));
}

export function registerSettingsIpc(): void {
  // 来源开关持久化：core 内零 I/O，宿主注册回调落盘（fire-and-forget）
  setSourceModePersister((modes) => {
    void db.setSetting('sourceModes', modes);
  });

  registerIpcHandlerSimple('settings:getSourceModes', () => {
    const modes = getAllSourceModes();
    const status: Partial<Record<SourceKey, 'ready' | 'unavailable'>> = {};
    for (const key of MULTI_SOURCE_LIST) {
      status[key] = hasDirectClient(key) ? 'ready' : 'unavailable';
    }
    return { modes, status };
  });

  registerIpcHandler('settings:setSourceModes', async (next: Record<string, unknown>) => {
    const clean: Partial<Record<SourceKey, SourceMode>> = {};
    for (const key of MULTI_SOURCE_LIST) {
      const value = next[key];
      if (typeof value === 'string' && SOURCE_MODE_SET.has(value as SourceMode)) {
        clean[key] = value as SourceMode;
      }
    }
    setSourceModes(clean);
    return true;
  });

  registerIpcHandlerSimple('settings:getDownloadPath', () => downloadService.getDownloadPath());
  registerIpcHandler('settings:setDownloadPath', async (inputPath: string) => {
    downloadService.updateDownloadPath(inputPath);
    await db.setSetting('downloadPath', downloadService.getDownloadPath());
  });
  registerIpcHandler('settings:resetDownloadPath', async () => {
    const defaultPath = app.getPath('downloads');
    downloadService.updateDownloadPath(defaultPath);
    await db.setSetting('downloadPath', defaultPath);
    return { path: defaultPath };
  });
  registerIpcHandlerSimple('settings:getApiUrl', () => db.getSetting('apiUrl') || '');
  registerIpcHandler('settings:setApiUrl', (url: string) => {
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
    buildAgents(proxyConfig);
    applyElectronProxy(proxyConfig);
  });
}

export function registerUpdateIpc(mainWindow: BrowserWindow): void {
  updateService.setMainWindow(mainWindow);
  registerIpcHandler('update:check', () => updateService.checkForUpdates());
  registerIpcHandler('update:download', () => updateService.downloadUpdate());
  registerIpcHandlerSimple('update:install', () => updateService.quitAndInstall());
  registerIpcHandlerSimple('update:getVersion', () => updateService.getVersion());
}

export function registerDownloadIpc(): void {
  registerIpcHandlerSimple('download:start', (song: any) => downloadService.addDownload(song));
  registerIpcHandlerSimple('download:startBatch', (songs: any[]) => downloadService.addBatchDownloads(songs));
  registerIpcHandlerSimple('download:cancel', (taskId: string) => downloadService.cancelDownload(taskId));
  registerIpcHandlerSimple('download:getTasks', () => downloadService.getAllTasks());
  registerIpcHandlerSimple('download:clearCompleted', () => downloadService.clearCompleted());
}

export function registerAppIpc(): void {
  registerIpcHandlerSimple('app:quit', () => app.quit());
}
