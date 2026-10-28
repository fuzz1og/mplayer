import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const yml = readFileSync(fileURLToPath(new URL('../../../electron-builder.yml', import.meta.url)), 'utf8');

/** 本仓用到的 glob 子集：* 不跨目录，** 跨目录 */
function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    source += char === '?' ? '[^/]' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

/** 顶层 key 的列表项（只解析本仓 yml 用到的写法） */
function listUnder(key: string): string[] {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start < 0) return [];
  const items: string[] = [];
  for (let i = start + 1; i < lines.length && /^\s/.test(lines[i]); i++) {
    const match = lines[i].match(/^\s*-\s*(?:"([^"]*)"|'([^']*)'|([^#]+?))\s*$/);
    if (match) items.push((match[1] ?? match[2] ?? match[3]).trim());
  }
  return items;
}

function excludedPatterns(): string[] {
  return listUnder('files')
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => pattern.slice(1));
}

describe('electron-builder.yml 打包范围', () => {
  it('files 排除项覆盖 electron-builder 的全部 staging 目录', () => {
    const patterns = excludedPatterns();
    const stagingSamples = [
      'dist/win-unpacked/MPlayer.exe',
      'dist/win-arm64-unpacked/MPlayer.exe',
      'dist/mac/MPlayer.app/Contents/Info.plist',
      'dist/mac-arm64/MPlayer.app/Contents/Info.plist',
      'dist/mac-universal/MPlayer.app/Contents/Info.plist',
      'dist/mac-arm64/Electron.app/Contents/Resources/LICENSES.chromium.html',
      'dist/linux-unpacked/mplayer',
      'dist/linux-arm64-unpacked/mplayer',
    ];
    const uncovered = stagingSamples.filter((sample) => !patterns.some((pattern) => globToRegExp(pattern).test(sample)));
    expect(uncovered).toEqual([]);
  });

  it('正常产物不会被 staging 排除项误伤', () => {
    const patterns = excludedPatterns();
    const keep = ['dist/index.html', 'dist/assets/index-abc.js', 'dist-electron/main.js', 'resources/icon.png'];
    const wronglyExcluded = keep.filter((sample) => patterns.some((pattern) => globToRegExp(pattern).test(sample)));
    expect(wronglyExcluded).toEqual([]);
  });

  it('electronLanguages 位于顶层，三个平台共用同一份', () => {
    expect(listUnder('electronLanguages')).toEqual(['zh-CN', 'en-US']);
  });
});
