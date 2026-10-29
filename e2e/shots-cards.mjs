import { openShots, settle } from './lib/shots.mjs';

/** 卡片与歌单证据：封面卡尺寸、歌单增删悬浮操作、收藏页歌手分段（产物在 e2e/artifacts/shots/cards）。 */

const cardProbe = (page) => page.evaluate(() => {
  const first = document.querySelector('.cover-card');
  const box = first ? first.getBoundingClientRect() : null;
  return {
    cards: document.querySelectorAll('.cover-card').length,
    w: box ? Math.round(box.width) : null,
    h: box ? Math.round(box.height) : null,
    first: document.querySelector('.cover-card__title')?.textContent ?? null,
  };
});

const shots = await openShots('cards');
const { page } = shots;

await shots.go('#/recommend', 3500);
await shots.shot('1-recommend-playlists', cardProbe);

await shots.go('#/discover', 1500);
const tab = (name) => page.locator('.discover-segment', { hasText: name }).first();
await tab('歌单').click();
await settle(page, 4500);
await shots.shot('2-discover-playlists', cardProbe);

await tab('歌手').click();
await settle(page, 6000);
await shots.shot('3-artist-list', cardProbe);

const input = page.locator('input[placeholder="搜索歌曲、专辑、歌手"]').first();
await input.click();
await input.fill('陶喆');
await input.press('Enter');
await settle(page, 3500);
await page.locator('.discover-pill--tab', { hasText: '歌手' }).first().click();
await settle(page, 4500);
await shots.shot('4-search-artists', cardProbe);

await shots.go('#/playlists', 2000);
for (const name of ['深夜通勤', '雨天读书']) {
  await page.getByRole('button', { name: '新建歌单' }).click();
  await settle(page, 400);
  await page.getByLabel('歌单名称').fill(name);
  await page.getByRole('button', { name: '创建' }).click();
  await settle(page, 700);
}
await shots.shot('5-my-playlists', cardProbe);
await page.locator('.cover-card').first().hover();
await settle(page, 400);
await shots.shot('6-my-playlists-hover-delete', cardProbe);

const action = page.locator('.cover-card__action > button').first();
console.log('[action] visible=' + await action.isVisible() + ' label=' + await action.getAttribute('aria-label'));

await shots.go('#/favorites', 2500);
await page.locator('.ui-segmented__option', { hasText: '歌手' }).first().click()
  .catch(async () => { await page.getByText('歌手', { exact: true }).last().click(); });
await settle(page, 1500);
await shots.shot('7-library-artists', cardProbe);

await shots.finish();
