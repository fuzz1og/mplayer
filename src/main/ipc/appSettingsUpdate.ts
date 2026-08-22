import { app, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
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
  getTlsFingerprintEnabled,
  setTlsFingerprintEnabled,
  setTlsFingerprintPersister,
  TLS_FINGERPRINT_SETTING_KEY,
  getTier3State,
  setTier3Enabled,
  setTier3Persister,
  addTier3SubscriptionFromUrl,
  addTier3SubscriptionFromText,
  removeTier3Subscription,
  refreshTier3Subscription,
  getTier3Stats,
} from '../api/musicApi';
import { MULTI_SOURCE_LIST, type SourceKey, type SourceMode } from '@mplayer/core';
import type { BrowserWindow } from 'electron';

const SOURCE_MODE_SET: ReadonlySet<SourceMode> = new Set(['auto', 'direct', 'api']);

export const TIER3_SETTING_KEY = 'tier3State';

export function registerDialogIpc(): void {
  registerIpcHandlerSimple('dialog:openDirectory', () => dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }));

  registerIpcHandlerSimple('dialog:openTier3File', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON 音源清单', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    return { name: path.basename(filePath), content, source: filePath };
  });
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
  registerIpcHandlerSimple('settings:getProxy', async () => {
    const saved = await db.getSetting<ProxyConfig>('proxyConfig');
    return saved || { enabled: false, host: '', port: 8080, protocol: 'http' };
  });
  registerIpcHandler('settings:setProxy', async (proxyConfig: ProxyConfig) => {
    await db.setSetting('proxyConfig', proxyConfig);
    buildAgents(proxyConfig);
    applyElectronProxy(proxyConfig);
  });

  // 外观：主题模式（跟随系统/浅色/深色），默认跟随系统
  const THEME_MODE_SET: ReadonlySet<string> = new Set(['system', 'light', 'dark']);
  registerIpcHandlerSimple('settings:getThemeMode', async () => {
    const saved = await db.getSetting<string>('themeMode');
    return THEME_MODE_SET.has(saved || '') ? saved : 'system';
  });
  registerIpcHandler('settings:setThemeMode', async (mode: string) => {
    const clean = THEME_MODE_SET.has(mode) ? mode : 'system';
    await db.setSetting('themeMode', clean);
    return clean;
  });

  // T10 spec #156：TLS 指纹伪装险情开关（仅桌面，weapi 试点）。默认关。
  // 持久化仿 T01 sourceRouter：core 零 I/O，宿主注册 persister 落盘 db。
  setTlsFingerprintPersister((value) => {
    void db.setSetting(TLS_FINGERPRINT_SETTING_KEY, value);
  });
  registerIpcHandlerSimple('settings:getTlsFingerprint', () => getTlsFingerprintEnabled());
  registerIpcHandler('settings:setTlsFingerprint', async (value: boolean) => {
    setTlsFingerprintEnabled(value === true);
    return true;
  });

  // tier3 第三方解析源订阅执行器（#144）：默认关；公开仓库零端点，清单由用户订阅。
  setTier3Persister((next) => {
    void db.setSetting(TIER3_SETTING_KEY, next);
  });
  registerIpcHandlerSimple('settings:getTier3State', () => getTier3State());
  registerIpcHandler('settings:setTier3Enabled', async (value: boolean) => {
    setTier3Enabled(value === true);
    return true;
  });
  registerIpcHandler('settings:addTier3Url', async (input: { name?: string; url: string }) => {
    return addTier3SubscriptionFromUrl(input);
  });
  registerIpcHandler('settings:addTier3Text', async (input: { name?: string; text: string; kind?: 'url' | 'text' | 'file'; source?: string }) => {
    return addTier3SubscriptionFromText(input);
  });
  registerIpcHandler('settings:removeTier3Subscription', async (id: string) => {
    removeTier3Subscription(id);
    return true;
  });
  registerIpcHandler('settings:refreshTier3Subscription', async (id: string) => {
    return refreshTier3Subscription(id);
  });
  registerIpcHandlerSimple('settings:getTier3Stats', () => getTier3Stats());
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
