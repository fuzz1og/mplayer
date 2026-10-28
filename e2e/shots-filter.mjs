import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const WORKTREE = path.resolve(import.meta.dirname, '..');
const OUT = 'D:/Playground/_mplayer-agent/shots-filter';
const UD = path.join(OUT, 'user-data');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(UD, { recursive: true, force: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: ['--no-sandbox', '--force-device-scale-factor=1', '--user-data-dir=' + UD, '.'],
  cwd: WORKTREE, env, timeout: 60000,
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);

const rows = () => page.locator('.song-row').count();
const counter = () => page.locator('[data-detail-toolbar]').first().textContent();

await page.evaluate(() => { location.hash = '#/discover'; });
await page.waitForTimeout(1500);
await page.locator('.discover-segment', { hasText: '歌单' }).first().click();
await page.waitForTimeout(5000);
await page.locator('.card-grid .cover-card').first().click();
await page.waitForTimeout(4500);

const total = await rows();
await page.screenshot({ path: path.join(OUT, '1-before-filter.png') });

const input = page.locator('input[aria-label="按歌名或歌手过滤"]').first();
await input.click();
await input.fill('米津');
await page.waitForTimeout(500);
const filtered = await rows();
await page.screenshot({ path: path.join(OUT, '2-filtered.png') });
console.log('filter=米津 rows=' + filtered + '/' + total + ' counter=' + String(await counter()).replace(/\s+/g, ' ').slice(0, 40));

await input.fill('YOASOBI');
await page.waitForTimeout(400);
const byArtist = await rows();
await page.screenshot({ path: path.join(OUT, '3-filter-artist.png') });
console.log('filter=YOASOBI rows=' + byArtist + ' counter=' + String(await counter()).replace(/\s+/g, ' ').slice(0, 40));

await input.fill('不存在的歌名zzz');
await page.waitForTimeout(400);
const empty = await rows();
const emptyText = await page.locator('.song-list').first().textContent().catch(() => '');
console.log('filter=none rows=' + empty + ' empty=' + String(emptyText).replace(/\s+/g, ' ').slice(0, 30));
await page.screenshot({ path: path.join(OUT, '4-filter-empty.png') });

await input.fill('');
await page.waitForTimeout(400);
const restored = await rows();
console.log('cleared rows=' + restored + '/' + total);
await page.screenshot({ path: path.join(OUT, '5-filter-cleared.png') });

console.log('[errors] ' + (errors.length ? errors.join(' | ') : 'none'));
await app.close();
console.log('DONE');
