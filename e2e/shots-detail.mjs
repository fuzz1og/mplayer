import { openShots, settle } from './lib/shots.mjs';

/** 四个详情页 + 歌手列表的几何证据：hero/工具栏/表头/行高/主 CTA（产物在 e2e/artifacts/shots/detail）。 */

const probe = (page) => page.evaluate(() => {
  const count = (selector) => document.querySelectorAll(selector).length;
  const height = (selector) => {
    const el = document.querySelector(selector);
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  };
  return {
    h1: document.querySelector('h1')?.textContent?.trim() ?? null,
    hero: count('.ui-page-hero'),
    toolbarH: height('[data-detail-toolbar]'),
    thead: count('thead'),
    listHead: count('.song-list__head'),
    localBack: count('.detail-page__nav'),
    rowH: height('.song-row'),
    rows: count('.song-row'),
    cards: count('.cover-card'),
    circleCards: count('.cover-card[data-shape="circle"]'),
    primaryCta: count('.ui-button--primary, .ui-btn--primary, [data-variant="primary"]'),
  };
});

const shots = await openShots('detail');
const { page } = shots;

await shots.go('#/hotlist/3778678', 4500);
await shots.shot('1-hotlist-detail', probe);

await shots.go('#/discover', 1200);
await page.locator('.discover-segment', { hasText: '歌手' }).first().click();
await settle(page, 5000);
await page.locator('.artists__grid .cover-card').first().click();
await settle(page, 5000);
await shots.shot('2-artist-detail', probe);

await shots.go('#/discover', 1200);
await page.locator('.discover-segment', { hasText: '新碟' }).first().click();
await settle(page, 5000);
await page.locator('.card-grid .cover-card').first().click();
await settle(page, 4500);
await shots.shot('3-album-detail', probe);

await shots.go('#/discover', 1200);
await page.locator('.discover-segment', { hasText: '歌单' }).first().click();
await settle(page, 5000);
await page.locator('.card-grid .cover-card').first().click();
await settle(page, 4500);
await shots.shot('4-discover-playlist-detail', probe);

await shots.go('#/playlists', 1500);
await page.getByRole('button', { name: '新建歌单' }).click();
await settle(page, 400);
await page.getByLabel('歌单名称').fill('走查歌单');
await page.getByRole('button', { name: '创建' }).click();
await settle(page, 800);
await page.locator('.card-grid .cover-card').first().click();
await settle(page, 2500);
await shots.shot('5-playlist-detail', probe);

await shots.go('#/artists', 4000);
await shots.shot('6-artist-list', probe);

await shots.finish();
