import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #493「保存全部到新歌单」的两条硬约束都是「没人看着就会退回去」的东西：
 * 1. **必须走批量 IPC**（`playlist:addSongs`，整批一次落盘）——照抄 DiscoverPlaylistDetailPage 的
 *    `handleSaveToLocal` 就是 N 次 `playlist:addSong`（1000 首 = 1000 次全量重写 JSON）；
 * 2. **失败不留空歌单**——建完歌单后任一步失败，必须把刚建的歌单删掉再报错。
 * 落盘次数本身由 main 侧 `fileStorage.test.ts` 的 saveData 断言钉住（一次调用）。
 */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
/** 本文件在 <root>/src/renderer/__tests__/ 下，基准取 <root>/src */
const read = (rel: string) => readFileSync(join(testDir, '..', '..', rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('榜单页「保存全部到新歌单」（#493）', () => {
  const source = read('renderer/pages/HotlistDetailPage.tsx');

  it('走批量 IPC，不逐首 playlist:addSong', () => {
    const code = stripComments(source);
    expect(code).toContain("'playlist:addSongs'");
    // 逐首通道在这个页面不该再出现（保存全部 = 一次批量写入）
    expect(code).not.toContain("'playlist:addSong'");
  });

  it('失败时删除刚建的歌单，不留空歌单', () => {
    const code = stripComments(source);
    expect(code).toContain("'playlist:delete'");
    // 先建歌单 → 批量写入 → 0 首成功/抛错都要走回滚分支
    expect(code).toMatch(/createdId/);
  });

  it('确认文案含榜单名与曲目数', () => {
    const code = stripComments(source);
    expect(code).toMatch(/content: \`[^\`]*\${title}[^\`]*\${count}[^\`]*\`/);
  });
});

describe('桌面批量加入歌单可就地新建（#489）', () => {
  const source = read('renderer/components/BatchAddToPlaylistModal.tsx');

  it('新建行走 core 写入编排（create → 整批写入 → 失败回滚，同一次交互内完成）', () => {
    const code = stripComments(source);
    // #542：编排已收进 core `writeSongsToPlaylist`——这里只断言**接线仍在**：
    // 就地新建（createName）+ 整批写入（addSongs）+ 回滚（deletePlaylist）三件事都接上了。
    expect(code).toContain('writeSongsToPlaylist');
    expect(code).toContain('createName');
    expect(code).toContain("'playlist:addSongs'");
    expect(code).toContain("'playlist:delete'");
    // 硬约束「失败不留空歌单」不再靠读源码文本保证——
    // 它现在是 core 编排的契约，由 packages/core/src/shared/__tests__/playlistWrite.test.ts 断言。
  });

  it('新歌单必然无重复，跳过预读 getSongs 与同名确认', () => {
    const code = stripComments(source);
    expect(code).toMatch(/isNew[\s\S]{0,80}\?\s*\[\]/);
  });
});
