import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SourceKey } from '@mplayer/core';
import { SOURCE_DISPLAY_NAMES } from '@mplayer/core';
import { SOURCE_LABELS, SOURCE_OPTION_LABELS } from '../stores/sourceStore';

/** 读移动端源文件（vitest root = packages/mobile） */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');

const KEYS: SourceKey[] = ['netease', 'qq', 'kugou', 'kuwo', 'migu', 'qianqian', 'soda', 'local'];

/**
 * #556 评审 C 续：来源中文名只允许一处。移动端此前自带 SOURCE_LABELS 字面量表，
 * 与 core SOURCE_DISPLAY_NAMES 取值漂移（qq 缩写 vs 全名、core 缺 local）。
 * 这里钉死「移动端就是 core 那一张表」，防止副本回流。
 */
describe('来源中文名单一落点（#556 评审 C 续）', () => {
  it('移动端 SOURCE_LABELS 与 core SOURCE_DISPLAY_NAMES 是同一张表', () => {
    expect(SOURCE_LABELS).toBe(SOURCE_DISPLAY_NAMES);
  });

  it('core 表覆盖全部 SourceKey（含 local 本地）', () => {
    for (const key of KEYS) expect(SOURCE_DISPLAY_NAMES[key]).toBeTruthy();
    expect(SOURCE_DISPLAY_NAMES.local).toBe('本地');
  });

  it('QQ 用产品全名「QQ音乐」，两端不因收敛被缩写成「QQ」', () => {
    expect(SOURCE_DISPLAY_NAMES.qq).toBe('QQ音乐');
    expect(SOURCE_LABELS.qq).toBe('QQ音乐');
    expect(SOURCE_OPTION_LABELS.qq).toBe('QQ音乐');
  });

  it('移动端源文件不再自带第二份标签字面量', () => {
    const src = read('stores/sourceStore.ts');
    expect(src).toContain("from '@mplayer/core'");
    expect(src).not.toMatch(/netease:\s*'/);
  });
});
