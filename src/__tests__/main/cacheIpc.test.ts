import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const cacheDir = vi.hoisted(() => `${process.cwd()}/.cache-ipc-test-${Date.now()}`);

vi.mock('electron', () => ({
  app: { getPath: () => cacheDir },
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import { registerCacheIpc } from '../../main/ipc/cache';

type Handler = (...args: any[]) => any;

function getHandler(channel: string): Handler {
  const call = (ipcMain.handle as any).mock.calls.find((c: any[]) => c[0] === channel);
  if (!call) throw new Error(`IPC handler not registered: ${channel}`);
  return call[1];
}

describe('registerCacheIpc legacy binary channels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerCacheIpc();
  });

  afterAll(() => {
    const resolved = path.resolve(cacheDir);
    const root = path.resolve(process.cwd());
    if (resolved.startsWith(root + path.sep)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });

  it('returns a disk file path after caching a cover', async () => {
    const setCover = getHandler('cache:setCover');
    const getCover = getHandler('cache:getCover');

    // 有效 PNG 头
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    await setCover({}, 'https://example.com/cover.jpg', png);

    const cachedPath = await getCover({}, 'https://example.com/cover.jpg');
    expect(typeof cachedPath).toBe('string');
    expect(fs.existsSync(cachedPath as string)).toBe(true);
  });

  it('deletes a corrupt cached cover and returns null (triggers re-fetch)', async () => {
    const setCover = getHandler('cache:setCover');
    const getCover = getHandler('cache:getCover');

    // 非图片内容（错误页/默认图）不视为有效封面
    await setCover({}, 'https://example.com/broken.jpg', Buffer.from('<html>error</html>'));

    const cachedPath = await getCover({}, 'https://example.com/broken.jpg');
    expect(cachedPath).toBeNull();
  });

  it('returns null when the cover is not cached', async () => {
    const getCover = getHandler('cache:getCover');
    expect(await getCover({}, 'https://example.com/missing.jpg')).toBeNull();
  });
});
