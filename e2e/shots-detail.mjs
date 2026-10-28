import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const WORKTREE = path.resolve(import.meta.dirname, '..');
const OUT = 'D:/Playground/_mplayer-agent/shots-detail2';
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
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
await page.waitForLoadState('domcontentloaded');
await settle(page, 2500);

const go = async (hash, ms) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await settle(page, ms);
};

const probe = () => page.evaluate(() => {
  const n = (sel) => document.querySelectorAll(sel).length;
  const h = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return Math.round(r.height); };
  const h1 = document.querySelector('h1');
  return {
    h1: h1 ? h1.textContent.trim() : null,
    hero: n('.ui-page-hero'),
    toolbarH: h('[data-detail-toolbar]'),
    thead: n('thead'),
    listHead: n('.song-list__head'),
    localBack: n('.detail-page__nav'),
    rowH: h('.song-row'),
    rows: n('.song-row'),
    cards: n('.cover-card'),
    circleCards: n('.cover-card[data-shape="circle"]'),
    primaryCta: n('.ui-button--primary, .ui-btn--primary, [data-variant="primary"]'),
  };
});

const shots = [];
const shot = async (name) => {
  const info = await probe();
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  shots.push(name);
  console.log('[shot] ' + name + ' ' + JSON.stringify(info));
};

await go('#/hotlist/3778678', 4500);
await shot('1-hotlist-detail');

await go('#/discover', 1200);
await page.locator('.discover-segment', { hasText: '歌手' }).first().click();
await settle(page, 5000);
await page.locator('.artists__grid .cover-card').first().click();
await settle(page, 5000);
await shot('2-artist-detail');

await go('#/discover', 1200);
await page.locator('.discover-segment', { hasText: '新碟' }).first().click();
await settle(page, 5000);
await page.locator('.card-grid .cover-card').first().click();
await settle(page, 4500);
await shot('3-album-detail');

await go('#/discover', 1200);
await page.locator('.discover-segment', { hasText: '歌单' }).first().click();
await settle(page, 5000);
await page.locator('.card-grid .cover-card').first().click();
await settle(page, 4500);
await shot('4-discover-playlist-detail');

await go('#/playlists', 1500);
await page.getByRole('button', { name: '新建歌单' }).click();
await settle(page, 400);
await page.getByLabel('歌单名称').fill('走查歌单');
await page.getByRole('button', { name: '创建' }).click();
await settle(page, 800);
await page.locator('.card-grid .cover-card').first().click();
await settle(page, 2500);
await shot('5-playlist-detail');

await go('#/artists', 4000);
await shot('6-artist-list');

console.log('[errors] ' + (errors.length ? errors.join(' | ') : 'none'));
console.log('DONE ' + shots.length + ' shots -> ' + OUT);
await app.close();
