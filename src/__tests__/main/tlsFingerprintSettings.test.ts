import { beforeEach, describe, expect, it, vi } from 'vitest';

// T10 spec #156：TLS 指纹伪装险情开关 settings IPC 持久化接线。
// 默认关；settings:setTlsFingerprint → db 落盘 + core 开关更新；
// settings:getTlsFingerprint → core 当前开关值。
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-user-data' },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../../main/services/downloadService', () => ({
  downloadService: { getDownloadPath: vi.fn(() => '/dl'), updateDownloadPath: vi.fn() },
}));
vi.mock('../../main/services/updateService', () => ({
  updateService: { setMainWindow: vi.fn() },
}));
vi.mock('../../main/proxy', () => ({
  applyElectronProxy: vi.fn(),
  buildAgents: vi.fn(),
}));
vi.mock('../../main/storage/db', () => ({
  db: { getSetting: vi.fn(), setSetting: vi.fn() },
}));

import { ipcMain } from 'electron';
import { db } from '../../main/storage/db';
import { registerSettingsIpc } from '../../main/ipc/appSettingsUpdate';
import {
  getTlsFingerprintEnabled,
  setTlsFingerprintEnabled,
  loadTlsFingerprint,
  TLS_FINGERPRINT_SETTING_KEY,
} from '@mplayer/core';

function getHandler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`${channel} handler not registered`);
  return call[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
}

beforeEach(() => {
  loadTlsFingerprint(false);
  setTlsFingerprintEnabled(false);
  vi.clearAllMocks();
});

describe('TLS 指纹伪装险情开关 IPC（T10 持久化接线，仅桌面）', () => {
  it('默认关闭', () => {
    expect(getTlsFingerprintEnabled()).toBe(false);
  });

  it('settings:setTlsFingerprint 开启后落盘 db 并更新 core 开关', async () => {
    registerSettingsIpc();
    const handler = getHandler('settings:setTlsFingerprint');
    const res = (await (handler as (e: unknown, v: unknown) => Promise<unknown>)({}, true)) as { success: boolean };
    expect(res.success).toBe(true);
    expect(db.setSetting).toHaveBeenCalledWith(TLS_FINGERPRINT_SETTING_KEY, true);
    expect(getTlsFingerprintEnabled()).toBe(true);
  });

  it('settings:setTlsFingerprint 关闭后落盘 false', async () => {
    registerSettingsIpc();
    setTlsFingerprintEnabled(true);
    const handler = getHandler('settings:setTlsFingerprint');
    await (handler as (e: unknown, v: unknown) => Promise<unknown>)({}, false);
    expect(db.setSetting).toHaveBeenCalledWith(TLS_FINGERPRINT_SETTING_KEY, false);
    expect(getTlsFingerprintEnabled()).toBe(false);
  });

  it('settings:getTlsFingerprint 返回 core 当前开关值', async () => {
    registerSettingsIpc();
    loadTlsFingerprint(true);
    const handler = getHandler('settings:getTlsFingerprint');
    const res = (await (handler as (e: unknown) => Promise<unknown>)({})) as boolean;
    expect(res).toBe(true);
  });
});
