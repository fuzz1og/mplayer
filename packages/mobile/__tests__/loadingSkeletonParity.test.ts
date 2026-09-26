import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 读仓库内源文件（vitest root = packages/mobile） */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');
const has = (rel: string) => existsSync(join(testDir, '..', rel));
/** 源码断言要去掉注释：注释里常常**引用**被禁掉的旧公式，否则守卫会误伤自己 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * #416 守卫：**骨架屏必须是真实结构的同形替身**。
 *
 * 这一族问题的根因只有一个——「骨架屏与页面各写各的」：
 * - `SongListSkeleton` 注释声称与 `SongRow` 一致，实际纵向内距 8 对 10、无分隔线、
 *   **无右侧两列**（歌名可用宽度都不同）→ 数据到达必跳版；
 * - `CoverGridSkeleton` 把 `gridCardWidth` 的公式抄了一遍，而 gridMetrics 明写
 *   「禁止在调用方重写公式」；`search.tsx` 的歌手网格更是第三个公式
 *   `(SCREEN_WIDTH - 24) / 3`；
 * - 全屏歌词页**没有加载分支**，加载中直接显示「这首歌暂无歌词」（假陈述）。
 *
 * 用例把这些钉死：谁再让骨架自成一派、或让加载态与真实结构脱钩，测试就红。
 */
describe('骨架屏与真实结构同源（#416）', () => {
  it('歌曲行的度量只有一个定义点，真实行与骨架都从它取', () => {
    const metrics = read('components/songRowMetrics.ts');
    expect(metrics).toMatch(/export const SONG_ROW\b/);
    expect(read('components/SongRow.tsx')).toContain('SONG_ROW');
    expect(read('components/SongRowSkeleton.tsx')).toContain('SONG_ROW');
    // 发现页榜单卡与 SongRow 是「同一种行」，此前各写一套（封面间距 10 对 12）
    expect(read('components/DiscoverTabs.tsx')).toContain('SONG_ROW');
  });

  it('骨架里不再出现硬编码的行度量（44 封面 / 10 纵距 / 28 榜位列）', () => {
    for (const file of ['components/SongRowSkeleton.tsx', 'components/SongListSkeleton.tsx', 'components/HotlistSkeleton.tsx']) {
      const s = read(file);
      expect(s, file).not.toMatch(/paddingVertical:\s*10\b/);
      expect(s, file).not.toMatch(/width:\s*44\b/);
      expect(s, file).not.toMatch(/height:\s*44\b/);
      expect(s, file).not.toMatch(/width:\s*28\b/);
    }
  });

  it('列表骨架是「一行」组件的复用，不是各页手写', () => {
    expect(read('components/SongListSkeleton.tsx')).toContain('SongRowSkeleton');
    expect(read('components/RecommendSkeleton.tsx')).toContain('SongRowSkeleton');
    expect(read('components/HotlistSkeleton.tsx')).toContain('SongRowSkeleton');
    // 发现页榜单 tab 是**分组卡片**结构，不能再用平铺列表骨架
    const tabs = read('components/DiscoverTabs.tsx');
    expect(tabs).toContain('HotlistSkeleton');
    expect(tabs).not.toMatch(/if \(loading\) return <SongListSkeleton/);
  });

  it('网格宽度一律走 gridMetrics，禁止第三个公式', () => {
    const grid = stripComments(read('components/CoverGridSkeleton.tsx'));
    expect(grid).toContain('gridCardWidth');
    expect(grid).not.toMatch(/columns\s*-\s*1/);
    // 搜索页歌手网格此前是 (SCREEN_WIDTH - 24) / 3
    const search = stripComments(read('app/(tabs)/search.tsx'));
    expect(search).toContain('gridCardWidth');
    expect(search).not.toMatch(/SCREEN_WIDTH\s*-\s*24/);
  });

  it('歌手网格用「圆头像 + 居中名字」的骨架，不是歌曲行骨架', () => {
    expect(read('app/(tabs)/search.tsx')).toMatch(/CoverGridSkeleton columns=\{3\} variant="artist"/);
    expect(read('components/DiscoverTabs.tsx')).toMatch(/CoverGridSkeleton columns=\{CARD_COLS\} variant="artist"/);
    expect(read('components/CoverGridSkeleton.tsx')).toContain("'artist'");
  });

  it('网格 tab 加载时保留分类条（否则数据到达网格整体下移）', () => {
    const tabs = stripComments(read('components/DiscoverTabs.tsx'));
    // 三个网格 tab 的 loading 分支都要先渲染 CategoryPills，再渲染网格骨架
    for (const state of ['albums', 'playlists', 'artists']) {
      expect(tabs, state).toMatch(
        new RegExp(`if \\(loading && ${state}\\.length === 0\\) \\{[\\s\\S]{0,400}CategoryPills`),
      );
    }
  });

  it('歌词：预览区与全屏歌词页共用同一个占位，且加载中不再显示「暂无歌词」', () => {
    const overlay = read('components/PlayerOverlay.tsx');
    expect(overlay).toContain('LyricsSkeleton');
    // 预览区 + 全屏页各一个加载分支
    expect((overlay.match(/lyricsLoading \?/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // 空态文案必须排在加载分支之后（先 loading 再空态），否则加载中会显示假陈述。
    // 只看**全屏歌词页**那一段：预览区在它之前，自己另有一处空态文案。
    const fullPage = stripComments(overlay).slice(stripComments(overlay).indexOf('lyricsFullWrap'));
    const loadingIdx = fullPage.indexOf('Math.ceil(winH / LYRICS_FULL_LINE_H)');
    const emptyIdx = fullPage.indexOf('这首歌暂无歌词');
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeGreaterThan(-1);
    expect(loadingIdx).toBeLessThan(emptyIdx);
    // 行高与真实列表的 getItemLayout 同值，避免加载完成跳版
    expect(overlay).toMatch(/lineHeight=\{LYRICS_FULL_LINE_H\}/);
    expect(overlay).toMatch(/lineHeight=\{LYRICS_PREVIEW_LINE_H\}/);
  });

  it('死代码清理：通用转圈 LoadingState 已无调用点，已删除', () => {
    expect(has('components/LoadingState.tsx')).toBe(false);
  });
});
