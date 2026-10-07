import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * #594 守卫：链接导入的写入 deps 装配只允许 core 一份。
 *
 * 判据取 issue 的「删除测试」：此前 renderer importService 与 mobile playlistExport
 * 各自内联同一段 addSong/addSongs（回报真实新增数、ok=false 抛错），删掉任意一份
 * 另一份原样可用——是复制品，不是被复用的能力。装配下沉 core importDepsFor 后，
 * 两端只准剩「注入各自 I/O」的转调；本测试把「两份」钉成「一份」。
 */
const ROOT = path.resolve(__dirname, '../..');

const CORE = path.join(ROOT, 'packages', 'core', 'src', 'api', 'playlistImport.ts');
const ENDS = [
  path.join(ROOT, 'src', 'renderer', 'services', 'importService.ts'),
  path.join(ROOT, 'packages', 'mobile', 'services', 'playlistExport.ts'),
];

describe('导入 deps 装配单一来源（#594）', () => {
  it('装配本体只落在 core importDepsFor', () => {
    expect(fs.readFileSync(CORE, 'utf8')).toMatch(/export function importDepsFor\(/);
  });

  it('两端只转调 core：不再各自持有装配体', () => {
    for (const file of ENDS) {
      const src = fs.readFileSync(file, 'utf8');
      // 复制品的指纹必须消失（旧实现里两端逐字各一份）……
      expect(src).not.toMatch(/writer\.add\(/);
      expect(src).not.toMatch(/if \(!result\.ok\) throw/);
      // ……取而代之的是对 core 的转调。
      expect(src).toMatch(/importDepsFor as coreImportDepsFor/);
      expect(src).toMatch(/coreImportDepsFor\(/);
    }
  });
});
