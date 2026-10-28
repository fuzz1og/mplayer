import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const WORKTREE = path.resolve(import.meta.dirname, '..');
const OUT = 'D:/Playground/_mplayer-agent/shots-strip';
const USER_DATA = path.join(OUT, 'user-data');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: ['--no-sandbox', '--force-device-scale-factor=1', '--user-data-dir=' + USER_DATA, '.'],
  cwd: WORKTREE, env, timeout: 60000,
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);

const go = async (hash, ms) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(ms); };
const probe = () => page.evaluate(() => {
  const el = document.querySelector('.ui-page-header');
  const h1 = document.querySelector('.ui-page-header__title');
  const head = el ? el.getBoundingClientRect() : null;
  const firstRow = document.querySelector('.discover-filters, .list-page__tabs, .rec__flow, .card-grid, .playlists__scroll, .library__body');
  return {
    h1: h1 ? h1.textContent.trim() : null,
    h1box: h1 ? Math.round(h1.getBoundingClientRect().width) + 'x' + Math.round(h1.getBoundingClientRect().height) : null,
    headerH: head ? Math.round(head.height) : null,
    firstRowY: firstRow ? Math.round(firstRow.getBoundingClientRect().y) : null,
    eyebrow: document.querySelectorAll('.ui-page-hero__eyebrow').length,
  };
});
const shot = async (name) => {
  const info = await probe();
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('[shot] ' + name + ' ' + JSON.stringify(info));
};

await go('#/recommend', 4000); await shot('1-recommend');
await go('#/discover', 2500); await shot('2-discover');
await go('#/favorites', 2000); await shot('3-favorites');
await go('#/history', 2000); await shot('4-history');
await go('#/playlists', 1500); await shot('5-playlists');
await go('#/local', 2000); await shot('6-local');
await go('#/settings', 1500); await shot('7-settings');
await go('#/hotlist/3778678', 4000); await shot('8-hotlist');
console.log('[errors] ' + (errors.length ? errors.join(' | ') : 'none'));
await app.close();
console.log('DONE ' + OUT);
