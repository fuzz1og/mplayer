import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// 桌面系统要求同时写在 minimumSystemVersion 与两版 README，钉住三处一致（#658）。
const repoRoot = path.resolve(__dirname, '../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf-8');
}

/** 从 electron-builder.yml 的 mac 段里取 minimumSystemVersion 的字面值 */
function readMinimumSystemVersion(): string | null {
  const yml = read('electron-builder.yml');
  const m = yml.match(/^\s{2}minimumSystemVersion:\s*["']?([0-9.]+)["']?\s*$/m);
  return m ? m[1] : null;
}

describe('桌面端系统要求（README × 打包配置一致性）', () => {
  it('electron-builder.yml 声明了 macOS 最低版本', () => {
    const version = readMinimumSystemVersion();
    expect(version).not.toBeNull();
    // macOS 13 = Ventura，低于它就与 Electron 44 的内嵌 Chromium 不符
    expect(Number(version)).toBeGreaterThanOrEqual(13);
  });

  it('中文 README 声明 macOS 13 并在下载表附近给出系统要求', () => {
    const md = read('README.md');
    expect(md).toMatch(/macOS 13/);
    expect(md).toMatch(/桌面端系统要求/);
  });

  it('英文 README 与中文 README 口径一致', () => {
    const en = read('README.en.md');
    expect(en).toMatch(/macOS 13/);
    expect(en).toMatch(/Desktop system requirements/);
  });

  it('README 里声明的 macOS 主版本与打包配置一致', () => {
    const version = readMinimumSystemVersion();
    if (version === null) throw new Error('minimumSystemVersion 缺失');
    const major = version.split('.')[0];
    for (const file of ['README.md', 'README.en.md']) {
      expect(read(file)).toMatch(new RegExp(`macOS ${major}`));
    }
  });

  it('不把 Electron 版本字面量抄进 README 技术栈表（AGENTS.md）', () => {
    for (const file of ['README.md', 'README.en.md']) {
      const md = read(file);
      // 允许出现「Electron」，但不允许紧跟版本号（会随升级腐烂）
      expect(md).not.toMatch(/Electron \d+\.\d+/);
    }
  });
});
