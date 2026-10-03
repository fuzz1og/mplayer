import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
  it('core 有「未给回调 = 默认并入」这条分支（不是静默丢弃）', () => {
    const core = readRepo('packages/core/src/shared/playlistWrite.ts');
    expect(core).toContain('if (!deps.resolveNameConflict)');
    expect(core).toContain('默认并入');
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
      // 移动批量弹窗：对已有歌单整批写，冲突走 core 缺省
      'packages/mobile/components/AddToPlaylistModal.tsx',
      // 桌面单曲弹窗：新建路径目标快照为空，冲突结构上不可能发生
      'src/renderer/components/AddToPlaylistModal.tsx',
      // 桌面批量弹窗：同上
      'src/renderer/components/BatchAddToPlaylistModal.tsx',
      // 两端导入腿：无人值守的整批操作
      'src/renderer/services/importService.ts',
    ]) {
      expect(readRepo(file), file).toContain('默认并入');
    }
  });
});
