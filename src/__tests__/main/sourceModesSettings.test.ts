import { beforeEach, describe, expect, it, vi } from 'vitest';

// 本文件在 renderer(config jsdom) 与 main 配置下都会运行，需自带 electron mock
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-user-data' },
  ipcMain: { handle: vi.fn() },
}));

// 来源开关 settings IPC 接线测试（T01）：settings:setSourceModes → db 落盘 + core 模式更新；
// settings:getSourceModes → 模式 + 直连状态。db/服务依赖打桩，core 路由用真实实现。
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
import { getSourceMode, setSourceModes, loadSourceModes } from '@mplayer/core';

function getHandler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`${channel} handler not registered`);
  return call[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
}

beforeEach(() => {
  loadSourceModes({});
  setSourceModes({});
  vi.clearAllMocks();
});

describe('来源开关 settings IPC（T01 持久化接线）', () => {
  it('settings:setSourceModes 落盘 db 并更新 core 模式（非法值过滤）', async () => {
    registerSettingsIpc();
    const handler = getHandler('settings:setSourceModes');
    const res = (await (handler as (e: unknown, v: unknown) => Promise<unknown>)({}, {
      netease: 'direct',
      qq: 'bogus', // 非法值应被过滤
    })) as { success: boolean; data: unknown };
    expect(res.success).toBe(true);
    expect(db.setSetting).toHaveBeenCalledWith('sourceModes', { netease: 'direct' });
    expect(getSourceMode('netease')).toBe('direct');
    expect(getSourceMode('qq')).toBe('auto');
  });

  it('settings:getSourceModes 返回模式 + 每源直连状态（已注册 netease → ready，未注册 → unavailable）', async () => {
    registerSettingsIpc();
    setSourceModes({ netease: 'direct' });
    const handler = getHandler('settings:getSourceModes');
    const res = (await (handler as (e: unknown) => Promise<unknown>)({})) as {
      modes: Record<string, string>;
      status: Record<string, 'ready' | 'unavailable'>;
    };
    expect(res.modes.netease).toBe('direct');
    // T02：网易直连客户端已注册（src/main/api/musicApi.ts 模块加载时），
    // 设置页「直连可用」状态自动变亮；未注册的 qq 仍为 unavailable。
    expect(res.status.netease).toBe('ready');
    expect(res.status.qq).toBe('unavailable');
  });
});
