import { test, expect } from '@playwright/test';

/**
 * 弹层类验收截图（Chromium + stub）。触发交互后截图，证明弹层能真正打开。
 * 播放栏/全屏播放器需要「有在播歌曲」：预置 localStorage 队列后重载，不依赖网络与真实解析链。
 */
const seedSongs = Array.from({ length: 5 }, (_, i) => ({
  id: 'n' + (i + 1),
  name: '示例歌曲 ' + (i + 1),
  artist: '示例歌手',
  album: '示例专辑',
  duration: 240,
  sourceType: 'netease',
  url: '',
  cover: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#274b8f"/><stop offset="1" stop-color="#0f1b33"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/></svg>'
  ),
  lrc: '',
}));

const SAMPLE_LRC = '[00:00.00]示例歌词第一行\n[00:04.00]示例歌词第二行\n[00:08.00]示例歌词第三行\n[00:12.00]示例歌词第四行\n[00:16.00]示例歌词第五行\n[00:20.00]示例歌词第六行';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ songs, lrc }) => {
    // 队列落盘 → 启动即有 currentSong，播放栏/全屏播放器才是「有歌」的真实形态
    localStorage.setItem('mplayer_queue', JSON.stringify({ playlist: songs, index: 0, shuffle: null }));
    const noop = async () => undefined;
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === 'musicApi:call') {
          const m = args[0] as string;
          if (m === 'getNeteaseLyrics') return lrc;
          if (m === 'getRecommendedPlaylists') return [];
          if (m === 'getRecommendedSongs') return songs;
          if (m === 'getPlaylistSongs') return { songs, total: songs.length };
          if (m === 'getAlbumDetail') return { album: { id: 'a1', name: '示例专辑', artist: '示例歌手', picUrl: '', publishTime: String(Date.now()), description: '简介' }, songs };
          if (m === 'getArtistSongs') return { songs, total: songs.length };
          if (m === 'getArtistAlbums') return { albums: [], total: 0, more: false, ok: true };
          if (m === 'searchSongsRouted') return [];
          return { songs, total: songs.length, albums: [], artists: [], more: false, ok: true };
        }
        if (channel === 'playlist:getAll') return [{ id: 7, name: '示例歌单', description: '简介', cover: '', songCount: songs.length }];
        if (channel === 'playlist:get') return { id: 7, name: '示例歌单', description: '简介', cover: '', songCount: songs.length };
        if (channel === 'playlist:getSongs') return songs;
        if (channel === 'history:get') return [];
        if (channel === 'favorite:getAll') return songs;
        if (channel === 'cache:getStats') return { totalSize: 0, fileCount: 0, songsCount: 0, coversCount: 0, audioCount: 0, urlsCount: 0 };
        // 全屏播放器截图：主进程取色接口的 stub 值（真实像素计算由 coverAccent 单测覆盖）。
        if (channel === 'cover:getAccent') return { hue: 218, saturation: 0.55, lightness: 0.32 };
        if (channel === 'settings:getThemeMode') return 'system';
        if (channel === 'update:getVersion') return '1.9.0';
        if (channel === 'download:start') {
          const song = args[0] as { id: string };
          return { id: 'dl-' + song.id, song, progress: 42, status: 'downloading' };
        }
        return undefined;
      },
      on: noop, removeListener: noop, send: noop,
    };
  }, { songs: seedSongs, lrc: SAMPLE_LRC });
});

/** 打开页面并等队列恢复完成（播放栏出现歌名即视为就绪） */
async function openWithSong(page: import('@playwright/test').Page, route: string) {
  await page.goto('http://[::1]:5174' + route, { waitUntil: 'commit' });
  await page.waitForTimeout(2500);
  await expect(page.locator('.player-bar__title')).toHaveText(seedSongs[0].name, { timeout: 10000 });
}

test('弹层截图：加入歌单', async ({ page }) => {
  await openWithSong(page, '/#/recommend');
  // 播放栏「更多操作」菜单里的加入歌单（1.9.0 右区只留一枚更多按钮）
  await page.locator('.player-bar button[aria-label="更多操作"]').click();
  await page.locator('.player-bar__more-item', { hasText: '加入歌单' }).click();
  await expect(page.getByRole('heading', { name: '加入歌单' })).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'shots/ui-16-add-to-playlist.png', animations: 'disabled' });
  expect(await page.locator('.errb__msg').count()).toBe(0);
});

test('弹层截图：换源', async ({ page }) => {
  await page.goto('http://[::1]:5174/#/playlist/7', { waitUntil: 'commit' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /更多操作/ }).first().click();
  await page.locator('.row-menu__item', { hasText: '换源完整版' }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/ui-17-source-swap.png', animations: 'disabled' });
  expect(await page.locator('.errb__msg').count()).toBe(0);
});

test('弹层截图：下载进度', async ({ page }) => {
  await openWithSong(page, '/#/recommend');
  await page.locator('.player-bar button[aria-label="更多操作"]').click();
  await page.locator('.player-bar__more-item', { hasText: '下载' }).click();
  await expect(page.locator('.dl-modal__panel')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'shots/ui-18-download-progress.png', animations: 'disabled' });
  expect(await page.locator('.errb__msg').count()).toBe(0);
});

test('全屏播放器截图', async ({ page }) => {
  await openWithSong(page, '/#/recommend');
  await page.locator('.player-bar__cover').click();
  await expect(page.locator('.lyrics-page')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'shots/ui-19-full-player.png', animations: 'disabled' });
  expect(await page.locator('.errb__msg').count()).toBe(0);
});
