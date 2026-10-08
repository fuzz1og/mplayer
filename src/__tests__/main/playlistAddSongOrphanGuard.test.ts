import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #610 守卫：`playlist:addSong` 单曲通道 + `fileStorage.addSongToPlaylist`
 * （第二份容量实现）已删除，不得复活。
 *
 * 「零调用者」的实证（#610 验收）：
 * - 注册处只有 `src/main/ipc/favoriteHistoryPlaylist.ts` 一处，handler 只调
 *   `db.addSongToPlaylist`；
 * - preload 是通用 `invoke(channel, ...)` 透传（`src/main/preload.ts`），无通道白名单；
 * - 渲染层产线代码（含 `services/playlistWriteAdapter.ts`）只调批量腿
 *   `playlist:addSongs`，从未 invoke `playlist:addSong`（#552/#554 后批量腿是唯一写入口）。
 *
 * 因此任何一次回退（重新注册通道、或恢复逐首存储方法）都会让本文件变红。
 */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
/** 本文件在 <root>/src/__tests__/main/ 下，基准取 <root>/src */
const srcDir = join(testDir, '..', '..');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 递归收集某个目录下所有 `.ts/.tsx` 源码（排除 __tests__）。 */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      collectSources(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('playlist:addSong 单曲通道已删除（#610）', () => {
  const sources = collectSources(srcDir).map((full) => ({
    rel: full.replace(srcDir, 'src').replace(/\\/g, '/'),
    code: stripComments(readFileSync(full, 'utf8')),
  }));

  it('产线代码不再注册/调用 playlist:addSong（批量腿 playlist:addSongs 不受影响）', () => {
    const offenders = sources
      .filter(({ code }) => /['"]playlist:addSong['"]/.test(code))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('产线代码不再有 addSongToPlaylist（第二份容量实现随之消失）', () => {
    const offenders = sources
      .filter(({ code }) => /\baddSongToPlaylist\b/.test(code))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
