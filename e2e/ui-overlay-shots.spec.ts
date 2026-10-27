import { test, expect } from '@playwright/test';
/**
 * 弹层类验收截图（Chromium + stub）。触发交互后截图，证明弹层能真正打开。
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const noop = async () => undefined;
    const song = (i: number) => ({ id: 'n' + i, name: '示例歌曲 ' + i, artist: '示例歌手', album: '示例专辑', duration: 240, sourceType: 'netease', url: '', cover: '', lrc: '' });
    const songs = Array.from({ length: 5 }, (_, i) => song(i + 1));
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === 'musicApi:call') {
          const m = args[0] as string;
          if (m === 'getRecommendedPlaylists') return [];
          if (m === 'getRecommendedSongs') return songs;
          if (m === 'getPlaylistSongs') return { songs, total: songs.length };
          return { songs, total: songs.length, albums: [], artists: [], more: false, ok: true };
        }
        if (channel === 'playlist:getAll') return [{ id: 7, name: '示例歌单', description: '简介', cover: '', songCount: 3 }];
        if (channel === 'playlist:get') return { id: 7, name: '示例歌单', description: '简介', cover: '', songCount: songs.length };
        if (channel === 'playlist:getSongs') return songs;
        if (channel === 'history:get') return [];
        if (channel === 'cache:getStats') return { totalSize: 0, fileCount: 0, songsCount: 0, coversCount: 0, audioCount: 0, urlsCount: 0 };
        if (channel === 'settings:getThemeMode') return 'system';
        if (channel === 'update:getVersion') return '1.9.0';
        return undefined;
      },
      on: noop, removeListener: noop, send: noop,
    };
  });
});

test('弹层截图：加入歌单', async ({ page }) => {
  await page.goto('http://[::1]:5174/#/playlist/7', { waitUntil: 'commit' });
  await page.waitForTimeout(2500);
  const more = page.getByRole('button', { name: /更多操作/ }).first();
  await more.click();
  // 行操作菜单里的项是 button[aria-label=加入歌单]
  await page.getByRole('button', { name: '加入歌单' }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/ui-16-add-to-playlist.png', animations: 'disabled' });
  expect(await page.locator('.errb__msg').count()).toBe(0);
});

test('弹层截图：换源', async ({ page }) => {
  await page.goto('http://[::1]:5174/#/playlist/7', { waitUntil: 'commit' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /更多操作/ }).first().click();
  await page.getByRole('button', { name: '换源完整版' }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/ui-17-source-swap.png', animations: 'disabled' });
  expect(await page.locator('.errb__msg').count()).toBe(0);
});
