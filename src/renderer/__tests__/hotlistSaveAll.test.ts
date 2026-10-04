import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #493「保存全部到新歌单」的两条硬约束都是「没人看着就会退回去」的东西：
 * 1. **必须走批量 IPC**（`playlist:addSongs`，整批一次落盘）——照抄 DiscoverPlaylistDetailPage 的
 *    `handleSaveToLocal` 就是 N 次 `playlist:addSong`（1000 首 = 1000 次全量重写 JSON）；
 * 2. **失败不留空歌单**——建完歌单后任一步失败，必须把刚建的歌单删掉再报错。
 * 落盘次数本身由 main 侧 `fileStorage.test.ts` 的 saveData 断言钉住（一次调用）。
 *
 * #552：这两条现在由**桌面唯一的写入 adapter**（`services/playlistWriteAdapter.ts`）
 * 承载，页面不再直接拿 IPC 拼编排。文件内容守卫因此从「页面里有 'playlist:addSongs'」
 * 改成「页面**没有**任何 `playlist:` IPC 字面量、且走了 adapter / core 编排」。
 */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
/** 本文件在 <root>/src/renderer/__tests__/ 下，基准取 <root>/src */
const read = (rel: string) => readFileSync(join(testDir, '..', '..', rel), 'utf8');
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

describe('榜单页「保存全部到新歌单」（#493 / #552）', () => {
  const source = read('renderer/pages/HotlistDetailPage.tsx');

  it('不再自己拿 IPC 拼编排：页面里没有任何 playlist: IPC 字面量', () => {
    const code = stripComments(source);
    expect(code).not.toContain("'playlist:addSong'");
    expect(code).not.toContain("'playlist:addSongs'");
    expect(code).not.toContain("'playlist:create'");
    expect(code).not.toContain("'playlist:delete'");
  });

  it('走 adapter / core 写入编排（新建 + 整批写入 + 失败回滚三件事都交出去）', () => {
    const code = stripComments(source);
    expect(code).toContain('createDesktopPlaylistWriter');
    expect(code).toContain('createAndAdd');
    expect(code).toContain('name: title');
  });

  it('成功文案用宿主真实新增数（result.added），不是请求数', () => {
    const code = stripComments(source);
    expect(code).toMatch(/result\.added/);
  });

  it('确认文案含榜单名与曲目数', () => {
    const code = stripComments(source);
    expect(code).toMatch(/content: `[^`]*\$\{title\}[^`]*\$\{count\}[^`]*`/);
  });
});

describe('桌面批量加入歌单可就地新建（#489 / #552）', () => {
  const source = read('renderer/components/BatchAddToPlaylistModal.tsx');

  it('新建行走 adapter 背后的 core 写入编排（create → 整批写入 → 失败回滚）', () => {
    const code = stripComments(source);
    expect(code).toContain('createDesktopPlaylistWriter');
    expect(code).toContain('createAndAdd');
    expect(code).toContain('desktopWriter.add');
  });
});

describe('桌面只剩一个写入 adapter（#552）', () => {
  const rendererDir = join(testDir, '..');

  it('只有 playlistWriteAdapter.ts 直接调歌单**写入** IPC（addSong / addSongs）', () => {
    // 读快照（getSongs）与歌单本身的建删（create / delete）不在本判据内：
    // 本票收敛的是「把歌写进歌单」这条腿的判据与编排。
    const offenders = collectSources(rendererDir)
      .filter((f) => !f.endsWith('playlistWriteAdapter.ts'))
      .filter((f) => /'playlist:(addSong|addSongs)'/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(rendererDir, '').replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });

  it('三份「先 playlist:get 再 playlist:addSong」的复制 helper 都不在了', () => {
    const addModal = read('renderer/components/AddToPlaylistModal.tsx');
    const batchModal = read('renderer/components/BatchAddToPlaylistModal.tsx');
    for (const code of [addModal, batchModal]) {
      expect(stripComments(code)).not.toMatch(/async function addSongToPlaylist/);
    }
  });
});
