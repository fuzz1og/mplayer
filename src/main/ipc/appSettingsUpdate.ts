import { app, dialog } from 'electron';
import { registerIpcHandler, registerIpcHandlerSimple } from './registerHandler';
import { downloadService } from '../services/downloadService';
import { updateService } from '../services/updateService';
import { db } from '../storage/db';
import { applyElectronProxy, type ProxyConfig } from '../proxy';

export function registerDialogIpc(): void {
  registerIpcHandlerSimple('dialog:openDirectory', () => dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }));
}

export function registerSettingsIpc(): void {
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
    const proxy = require('./proxy');
    proxy.buildAgents(proxyConfig);
    applyElectronProxy(proxyConfig);
  });
}

export function registerUpdateIpc(): void {
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
