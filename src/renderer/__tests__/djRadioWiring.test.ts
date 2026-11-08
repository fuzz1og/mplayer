import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('DJ 电台内容接线守卫（#742）', () => {
  it('桌面与移动端都注册电台详情页，并暴露搜索与歌手页入口', () => {
    const desktopRouter = read('src/renderer/router/index.tsx');
    const mobileLayout = read('packages/mobile/app/_layout.tsx');
    const desktopSearch = read('src/renderer/pages/DiscoverPageV2.tsx');
    const mobileSearch = read('packages/mobile/app/(tabs)/search.tsx');
    const desktopArtist = read('src/renderer/pages/ArtistDetailPage.tsx');
    const mobileArtist = read('packages/mobile/app/artist/[id]/index.tsx');
    expect(desktopRouter).toContain("path: 'djradio/:id'");
    expect(mobileLayout).toContain('name="djradio/[id]"');
    expect(desktopSearch).toContain("label: '电台'");
    expect(mobileSearch).toContain("label: '电台'");
    expect(desktopArtist).toContain('getArtistRadiosRouted');
    expect(mobileArtist).toContain('getArtistRadiosRouted');
    expect(desktopSearch).toContain('describeDjRadioSearchFailure');
    expect(mobileSearch).toContain('describeDjRadioSearchFailure');
  });

  it('节目行保留歌曲收藏、收掉换源、用 programId 作 key，卡片不显示 programCount', () => {
    const page = read('src/renderer/pages/DjRadioDetailPage.tsx');
    const mobilePage = read('packages/mobile/app/djradio/[id].tsx');
    const grid = read('src/renderer/components/DjRadioGrid.tsx');
    const mobileSearch = read('packages/mobile/app/(tabs)/search.tsx');
    const mobileArtist = read('packages/mobile/app/artist/[id]/index.tsx');
    expect(page).toContain('favoriteIds={favoriteIds}');
    expect(page).toContain('onToggleFavorite={handleToggleFavorite}');
    expect(page).toContain('hideSwap');
    expect(page).toMatch(/rowKey=\{.*programId/);
    expect(mobilePage).not.toContain('hideActions');
    expect(mobilePage).toContain('hideSwap');
    for (const file of [grid, mobileSearch, mobileArtist]) {
      expect(file).not.toMatch(/programCount\s*\?/);
    }
    expect(page).toContain('description: radio.desc');
  });

  it('双端播放全部共用 core helper，桌面走三态门面', () => {
    const page = read('src/renderer/pages/DjRadioDetailPage.tsx');
    const mobilePage = read('packages/mobile/app/djradio/[id].tsx');
    expect(page).toContain('fetchAllDjRadioPrograms');
    expect(mobilePage).toContain('fetchAllDjRadioPrograms');
    expect(page).toContain('getDjRadioDetailRouted');
    expect(page).toContain('getDjRadioProgramsRouted');
    expect(mobilePage).toContain('getDjRadioProgramsRouted');
    expect(page).toContain('describeDjRadioFailure');
    expect(mobilePage).toContain('describeDjRadioFailure');
  });

  it('节目说明只取单期 description，不把电台 desc 当单期简介', () => {
    const page = read('src/renderer/pages/DjRadioDetailPage.tsx');
    const mobilePage = read('packages/mobile/app/djradio/[id].tsx');
    expect(page).toContain('rowTitle={(song) => (song as DjRadioProgram).description || undefined}');
    expect(mobilePage).toContain('description={item.description || undefined}');
  });
});
