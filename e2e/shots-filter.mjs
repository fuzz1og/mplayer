import { openShots, settle } from './lib/shots.mjs';

/** 歌单详情页的过滤证据：按歌名 / 歌手 / 无结果 / 清空四态的行数对比（产物在 e2e/artifacts/shots/filter）。 */

const rows = (page) => page.locator('.song-row').count();
const counter = (page) => page.locator('[data-detail-toolbar]').first().textContent();
const dump = (label, value) => String(value).replace(/\s+/g, ' ').slice(0, 40);

const shots = await openShots('filter');
const { page } = shots;

await shots.go('#/discover', 1500);
await page.locator('.discover-segment', { hasText: '歌单' }).first().click();
await settle(page, 5000);
await page.locator('.card-grid .cover-card').first().click();
await settle(page, 4500);

const total = await rows(page);
await shots.shot('1-before-filter');

const input = page.locator('input[aria-label="按歌名或歌手过滤"]').first();
await input.click();
await input.fill('米津');
await settle(page, 500);
console.log('filter=米津 rows=' + await rows(page) + '/' + total + ' counter=' + dump('', await counter(page)));
await shots.shot('2-filtered');

await input.fill('YOASOBI');
await settle(page, 400);
console.log('filter=YOASOBI rows=' + await rows(page) + ' counter=' + dump('', await counter(page)));
await shots.shot('3-filter-artist');

await input.fill('不存在的歌名zzz');
await settle(page, 400);
const emptyText = await page.locator('.song-list').first().textContent().catch(() => '');
console.log('filter=none rows=' + await rows(page) + ' empty=' + dump('', emptyText));
await shots.shot('4-filter-empty');

await input.fill('');
await settle(page, 400);
console.log('cleared rows=' + await rows(page) + '/' + total);
await shots.shot('5-filter-cleared');

await shots.finish();
