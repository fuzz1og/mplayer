import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const noop = async () => undefined;
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      invoke: async (channel: string) => {
        if (channel === 'settings:getThemeMode') return 'dark';
        if (channel === 'cache:getStats') return { totalSize: 0, fileCount: 0, songsCount: 0, coversCount: 0, audioCount: 0, urlsCount: 0, bytes: {} };
        if (channel === 'cache:getConfig') return { limitMb: 100, autoClean: true, dir: 'C:/AppData/MPlayer/cache' };
        if (channel === 'playlist:getAll') return [];
        if (channel === 'favorite:getAll') return [];
        if (channel === 'history:get') return [];
        return undefined;
      },
      on: noop, removeListener: noop, send: noop,
    };
  });
});

test('外观偏好落到 html data-*', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mplayer.appearance', JSON.stringify({ density: 'compact', material: 'off', fontScale: 'large', reduceMotion: 'on', lyricsSize: 'large' }));
  });
  await page.goto('http://[::1]:5174/#/settings/appearance', { waitUntil: 'commit' });
  await page.waitForTimeout(2000);
  const attrs = await page.evaluate(() => ({
    density: document.documentElement.dataset.density,
    material: document.documentElement.dataset.material,
    font: document.documentElement.dataset.fontScale,
    motion: document.documentElement.dataset.reduceMotion,
    lyrics: document.documentElement.dataset.lyricsSize,
    rowHeight: getComputedStyle(document.documentElement).getPropertyValue('--row-height').trim(),
  }));
  console.log(JSON.stringify(attrs));
  expect(attrs.density).toBe('compact');
  expect(attrs.rowHeight).toBe('38px');
  await page.screenshot({ path: '.proto/check-appearance-compact.png', animations: 'disabled' });
});

test('深链 #/settings/cache 直达缓存页', async ({ page }) => {
  await page.goto('http://[::1]:5174/#/settings/cache', { waitUntil: 'commit' });
  await page.waitForTimeout(1500);
  await expect(page.getByRole('heading', { name: '缓存' })).toBeVisible();
});
