import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECOMMEND_BATCH_SIZE, RECOMMEND_GRID_COLS } from '../components/recommendMetrics';

/** 读仓库内源文件（vitest root = packages/mobile） */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');

/**
 * #318 真机回归：推荐页冷启动骨架屏 ① 布局与真实布局不适配 ② 暗色下露浅底。
 * 这两条都源于「骨架屏与页面各写各的」。用例把「两端同源」钉成守卫：
 * 谁再把行数/列数写回字面量、或让 loading 分支回退到通用列表骨架，测试就红。
 */
describe('推荐页骨架屏不漂移（#318）', () => {
  it('契约值：一批 5 首 / 猜你喜欢 2 列', () => {
    expect(RECOMMEND_BATCH_SIZE).toBe(5);
    expect(RECOMMEND_GRID_COLS).toBe(2);
  });

  it('页面从共享常量取行数/列数，不再写死', () => {
    const page = read('app/(tabs)/recommend.tsx');
    expect(page).toContain('RECOMMEND_BATCH_SIZE');
    expect(page).toContain('RECOMMEND_GRID_COLS');
    expect(page).not.toMatch(/pickRandomBatch\([^)]*,\s*5\)/);
    expect(page).not.toMatch(/gridCardWidth\(\{\s*cols:\s*2\s*\}\)/);
  });

  it('骨架屏用同一组常量（行数/列数同源）', () => {
    const skeleton = read('components/RecommendSkeleton.tsx');
    expect(skeleton).toContain('RECOMMEND_BATCH_SIZE');
    expect(skeleton).toContain('RECOMMEND_GRID_COLS');
    // 与页面同一套 chrome 让位度量（跳版的主要来源）
    expect(skeleton).toContain('topChromeHeight');
    expect(skeleton).toContain('bottomChromeHeight');
    expect(skeleton).toContain('SECTION_TAIL_PADDING');
  });

  it('早退的 loading 分支自带底色（否则露导航容器浅色默认底）', () => {
    expect(read('components/RecommendSkeleton.tsx')).toContain('animatedBg');
    // 同类骨架屏一律自绘底色：SongListSkeleton / CoverGridSkeleton 都是早退调用点的占位
    for (const file of ['components/SongListSkeleton.tsx', 'components/CoverGridSkeleton.tsx']) {
      expect(read(file), file).toMatch(/flex: 1[\s\S]*?backgroundColor: colors\.bgBase/);
    }
  });

  it('推荐页 loading 走 RecommendSkeleton，不再用通用列表骨架', () => {
    const page = read('app/(tabs)/recommend.tsx');
    expect(page).toMatch(/if \(loading\) return <RecommendSkeleton \/>;/);
    expect(page).not.toContain('SongListSkeleton');
  });
});
