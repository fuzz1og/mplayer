import { beforeEach, describe, expect, it, vi } from 'vitest';

// T13 spec #159：桌面 cookie 管理器 adapter 持久化接线。
// core 零 I/O；adapter 把 cookie 变更写 db（fire-and-forget），冷启动从 db 重水合。
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-user-data' },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../../main/storage/db', () => ({
  db: { getSetting: vi.fn(), setSetting: vi.fn() },
}));

import { db } from '../../main/storage/db';
import {
  registerCookiePersister,
  loadCookiesFromDisk,
  ensureKugouDeviceCookie,
  getSourceCookie,
  cookieSettingKey,
} from '../../main/cookies/cookieAdapter';
import {
  clearCookie,
  generateCookie,
  setCookiePersister,
  createKugouDeviceCookie,
  loadCookies,
  getCookie,
} from '@mplayer/core';

beforeEach(() => {
  clearCookie('netease');
  clearCookie('kugou');
  setCookiePersister(null);
  vi.clearAllMocks();
});

describe('桌面 cookie adapter（T13 持久化 wiring）', () => {
  it('registerCookiePersister 后 generateCookie 触发 db.setSetting 落盘（独立键）', () => {
    registerCookiePersister();
    generateCookie('netease', { clock: () => Date.now() });
    expect(db.setSetting).toHaveBeenCalledWith(
      cookieSettingKey('netease'),
      expect.objectContaining({ source: 'netease' }),
    );
  });

  it('clearCookie 落盘空 cookie（表示清除）', () => {
    registerCookiePersister();
    clearCookie('netease');
    expect(db.setSetting).toHaveBeenCalledWith(
      cookieSettingKey('netease'),
      expect.objectContaining({ value: '' }),
    );
  });

  it('loadCookiesFromDisk 重水合磁盘 cookies 进 core，不触发再落盘', async () => {
    vi.mocked(db.getSetting).mockResolvedValueOnce(
      createKugouDeviceCookie({ guid: 'g', mid: 'm', mac: 'x', dev: 'd', dfid: 'f' }, () => Date.now()),
    );
    await loadCookiesFromDisk();
    expect(getCookie('kugou')).toBeTruthy();
    // 重水合不触发落盘
    expect(db.setSetting).not.toHaveBeenCalled();
  });

  it('ensureKugouDeviceCookie 返回仍有效的现有 cookie，不重复落盘', () => {
    registerCookiePersister();
    loadCookies([
      createKugouDeviceCookie({ guid: 'g', mid: 'm', mac: 'x', dev: 'd', dfid: 'f' }, () => Date.now()),
    ]);
    vi.clearAllMocks();
    const c = ensureKugouDeviceCookie();
    expect(c.source).toBe('kugou');
    expect(getSourceCookie('kugou')).toBe(c);
    expect(db.setSetting).not.toHaveBeenCalled();
  });

  it('ensureKugouDeviceCookie 缺失时用缺省伪设备参数重新生成并落盘', () => {
    registerCookiePersister();
    const c = ensureKugouDeviceCookie();
    expect(c.source).toBe('kugou');
    // 缺省伪设备：程序化自建，无需用户 cookie
    expect(c.value).toContain('KUGOU_API_GUID=');
    expect(db.setSetting).toHaveBeenCalledWith(cookieSettingKey('kugou'), expect.anything());
  });
});
