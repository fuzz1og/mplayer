import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const WORKTREE = path.resolve(import.meta.dirname, '..');
const OUT = 'D:/Playground/_mplayer-agent/shots-cards';
const USER_DATA = path.join(OUT, 'user-data');

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const settle = (page, ms) => page.waitForTimeout(ms);

const app = await electron.launch({
  args: ['--no-sandbox', '--force-device-scale-factor=1', '--user-data-dir=' + USER_DATA, '.'],
  cwd: WORKTREE,
  env,
  timeout: 60000,
});
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log('[pageerror] ' + e));
await page.waitForLoadState('domcontentloaded');
await settle(page, 2500);

const go = async (hash, ms) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await settle(page, ms);
};

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  const cards = await page.locator('.cover-card').count();
  const box = await page.locator('.cover-card').first().boundingBox().catch(() => null);
  const title = await page.locator('.cover-card__title').first().textContent().catch(() => null);
  console.log('[shot] ' + name + ' cards=' + cards + ' w=' + (box ? Math.round(box.width) : '?') + ' h=' + (box ? Math.round(box.height) : '?') + ' first=' + title);
};

await go('#/recommend', 3500);
await shot('1-recommend-playlists');

await go('#/discover', 1500);
const tab = (name) => page.locator('.discover-segment', { hasText: name }).first();
await tab('歌单').click();
await settle(page, 4500);
await shot('2-discover-playlists');

await tab('歌手').click();
await settle(page, 6000);
await shot('3-artist-list');

const input = page.locator('input[placeholder="搜索歌曲、专辑、歌手"]').first();
await input.click();
await input.fill('陶喆');
await input.press('Enter');
await settle(page, 3500);
await page.locator('.discover-pill--tab', { hasText: '歌手' }).first().click();
await settle(page, 4500);
await shot('4-search-artists');

await go('#/playlists', 2000);
for (const name of ['深夜通勤', '雨天读书']) {
  await page.getByRole('button', { name: '新建歌单' }).click();
  await settle(page, 400);
  await page.getByLabel('歌单名称').fill(name);
  await page.getByRole('button', { name: '创建' }).click();
  await settle(page, 700);
}
await shot('5-my-playlists');
await page.locator('.cover-card').first().hover();
await settle(page, 400);
await shot('6-my-playlists-hover-delete');
const delVisible = await page.locator('.cover-card__action > button').first().isVisible();
const delLabel = await page.locator('.cover-card__action > button').first().getAttribute('aria-label');
console.log('[action] visible=' + delVisible + ' label=' + delLabel);

await go('#/favorites', 2500);
await page.locator('.ui-segmented__option', { hasText: '歌手' }).first().click().catch(async () => { await page.getByText('歌手', { exact: true }).last().click(); });
await settle(page, 1500);
await shot('7-library-artists');

await app.close();
console.log('DONE ' + OUT);
