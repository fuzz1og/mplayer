import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createPlaylistSnapshot, writeSongsToPlaylist } from '@mplayer/core';
import type { Song } from '@mplayer/core';

const song = (
  id: string,
  name = `歌${id}`,
  artist = '歌手',
  sourceType: Song['sourceType'] = 'netease',
): Song => ({
  id, name, artist, album: '', url: '', cover: '', lrc: '', duration: 180, sourceType,
});

const testDir = dirname(fileURLToPath(String(import.meta.url)));
/** src/renderer/__tests__ → 仓库根 */
const repoRoot = join(testDir, '..', '..', '..');
const readRepo = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * #556 评审 A4 守卫：同名异源冲突的裁决策略**必须显式**，缺省绝不静默丢弃。
 *
 * 缺陷形态：core 在调用点没给 resolveNameConflict 时「既不写入也不计数」——冲突歌凭空
 * 消失；而移动弹窗的注释写「core 编排并入、两端一致」，与实现相反。文件内容守卫把
 * 「实现分支」与「每个省掉回调的调用点都得写下自己的口径」一起钉住：改实现不改注释、
 * 或新增一个省掉回调的调用点却不说明，都会红。
 */
describe('歌单写入的同名冲突接线（#556 评审 A4）', () => {
  // 这条此前是 `toContain('默认并入')` 的文本断言——注释写对就能糊弄。改成行为守卫：
  // 真的调一次 core，争议歌必须落到宿主的写入端口上（修前「既不写入也不计数」时红）。
  it('core 未给裁决回调 = 默认并入（行为：争议歌真的写进去，不静默丢弃）', async () => {
    const existing = [song('a', '晴天', '周杰伦', 'netease')];
    const written: Song[] = [];
    const res = await writeSongsToPlaylist(
      {
        playlistId: '1',
        target: createPlaylistSnapshot({ songs: existing }),
        songs: [song('b', '晴天', '周杰伦', 'qq')],
      },
      {
        addSongs: async (_id, songs) => {
          written.push(...songs);
          return songs.length;
        },
      },
    );

    expect(res.ok).toBe(true);
    expect(res.duplicateNames).toBe(1);
    expect(written.map((s) => s.id)).toEqual(['b']);
  });

  it('两端 adapter 都把 resolveNameConflict 透传进 core 编排', () => {
    const desktop = readRepo('src/renderer/services/playlistWriteAdapter.ts');
    // add 与 createAndAdd 各一处（createAndAdd 的冲突回调由调用点按需给）
    expect((desktop.match(/makeDeps\(resolveNameConflict\)/g) ?? []).length).toBe(2);

    const mobile = readRepo('packages/mobile/services/playlistExport.ts');
    expect((mobile.match(/\{ \.\.\.base, resolveNameConflict \}/g) ?? []).length).toBe(2);
  });

  it('每个省掉回调的调用点都在源码里写下「默认并入」口径', () => {
    for (const file of [
      // 桌面单曲弹窗：新建路径目标快照为空，冲突结构上不可能发生
      'src/renderer/components/AddToPlaylistModal.tsx',
      // 桌面批量弹窗：同上
      'src/renderer/components/BatchAddToPlaylistModal.tsx',
      // 两端导入腿：无人值守的整批操作（桌面注释里明写「与移动端导入腿同一口径」）
      'src/renderer/services/importService.ts',
      'packages/mobile/services/playlistExport.ts',
    ]) {
      expect(readRepo(file), file).toContain('默认并入');
    }
  });

  /**
   * #560：「批量加入已有歌单」这个动作两端都必须**真的问**，且问的是**同一句话**。
   *
   * 缺陷形态：移动端批量腿不传 resolveNameConflict（core 走默认并入）→ 同一个动作
   * 桌面会问、移动端不问，用户没得拒绝。修法 = 移动批量腿接上裁决回调。
   *
   * 两句断言各挡一类回退：
   * - 移动批量腿必须接回调（否则退回静默并入）；
   * - **字面量只许出现在 core**：两端各自硬编码一份文案 = 迟早分叉，分叉后没人同时看两端
   *   （与 OFFLINE_COPY 同一条纪律）。
   */
  it('#560：移动批量腿接上裁决回调，且两端问的是同一句话（文案只在 core）', () => {
    const mobileModal = readRepo('packages/mobile/components/AddToPlaylistModal.tsx');
    expect(mobileModal).toMatch(/resolveNameConflict:\s*promptNameConflict/);

    for (const file of [
      'packages/mobile/components/nameConflictPrompt.ts',
      'src/renderer/components/BatchAddToPlaylistModal.tsx',
    ]) {
      const src = readRepo(file);
      expect(src, file).toContain('NAME_CONFLICT_COPY');
      expect(src, file + ' 不该再硬编码同名确认文案').not.toContain('同名但来自不同平台');
    }

    // 文案本体只在 core 一处
    const core = readRepo('packages/core/src/shared/playlistWrite.ts');
    expect(core).toContain('同名但来自不同平台');
  });
});
