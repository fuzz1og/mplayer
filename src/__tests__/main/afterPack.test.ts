import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
type AfterPack = (context: { appOutDir: string; electronPlatformName: string }) => Promise<void>;
const afterPack = require('../../../scripts/afterPack.js').default as AfterPack;

describe('afterPack 产物清理', () => {
  let appOutDir: string;
  beforeEach(() => {
    appOutDir = mkdtempSync(path.join(tmpdir(), 'mplayer-afterpack-'));
  });
  afterEach(() => {
    rmSync(appOutDir, { recursive: true, force: true });
  });

  function touch(...names: string[]) {
    for (const name of names) writeFileSync(path.join(appOutDir, name), 'x');
  }

  it('Windows 删除 WebGPU 编译器与 Chromium 许可，保留运行时文件', async () => {
    touch('LICENSES.chromium.html', 'dxcompiler.dll', 'dxil.dll', 'electron.exe', 'ffmpeg.dll');
    await afterPack({ appOutDir, electronPlatformName: 'win32' });
    expect(existsSync(path.join(appOutDir, 'electron.exe'))).toBe(true);
    expect(existsSync(path.join(appOutDir, 'ffmpeg.dll'))).toBe(true);
    for (const name of ['LICENSES.chromium.html', 'dxcompiler.dll', 'dxil.dll']) {
      expect(existsSync(path.join(appOutDir, name)), name).toBe(false);
    }
  });

  it('非 Windows 平台保留 WebGPU 编译器', async () => {
    touch('dxcompiler.dll', 'dxil.dll');
    await afterPack({ appOutDir, electronPlatformName: 'darwin' });
    expect(existsSync(path.join(appOutDir, 'dxcompiler.dll'))).toBe(true);
    expect(existsSync(path.join(appOutDir, 'dxil.dll'))).toBe(true);
  });

  it('目标文件不存在时幂等', async () => {
    touch('electron.exe');
    await expect(afterPack({ appOutDir, electronPlatformName: 'win32' })).resolves.toBeUndefined();
    expect(existsSync(path.join(appOutDir, 'electron.exe'))).toBe(true);
  });
});
