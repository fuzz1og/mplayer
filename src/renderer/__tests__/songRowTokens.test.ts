import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** #694 评审：歌曲行排版 token 曾在 songlist.css 自造 :root 变量绕开 --text-* / --weight-*，
 * design-lint 只查 font-size: 声明所以不报。这里守「组件的排版 token 只能在 token 层登记」。 */
const stylesDir = join(dirname(fileURLToPath(String(import.meta.url))), '..', 'styles');
const globalCss = readFileSync(join(stylesDir, 'global.css'), 'utf8');
const songlistCss = readFileSync(join(stylesDir, 'songlist.css'), 'utf8');

describe('歌曲行排版 token（#699 密度协议）', () => {
  it('字号 / 字重复用既有刻度，其余原型值只登记在 global.css 的 token 层', () => {
    // 组件样式不再自造变量块
    expect(songlistCss).not.toContain(':root');
    expect(songlistCss).not.toContain('--song-row-title-size:');

    // 与刻度重合的取值引用 token，不另立数字
    expect(globalCss).toContain('--song-row-meta-size: var(--text-sm);');
    expect(globalCss).toContain('--song-row-number-size: var(--text-sm);');
    expect(globalCss).toContain('--song-row-head-size: var(--text-xs);');
    expect(globalCss).toContain('--song-row-head-weight: var(--weight-semibold);');

    // 不在 --text-* 刻度上的原型值：登记一次并注明用途
    expect(globalCss).toContain('--song-row-title-size: 14px;');
    expect(globalCss).toContain('--song-row-padding-x: 14px;');
    expect(globalCss).toContain('--song-row-gap: 10px;');
    expect(globalCss).toContain('--song-row-head-height: 28px;');
  });
});
