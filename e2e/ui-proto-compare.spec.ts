import { test } from '@playwright/test';

/** 原型对照用截图：1225x788（原型 2450x1576 @2x），Chromium + stub。 */
const songs = [
  ['晴天', '周杰伦', '叶惠美', 269],
  ['后来', '刘若英', '我等你', 341],
  ['起风了', '买辣椒也用券', '起风了', 325],
  ['岁月神偷', '金玟岐', '岁月神偷', 250],
  ['成都', '赵雷', '无法长大', 328],
  ['消愁', '毛不易', '平凡的一天', 270],
  ['漠河舞厅', '柳爽', '冬眠', 265],
  ['刻在我心底的名字', '卢广仲', '刻在我心底的名字', 302],
].map(([name, artist, album, duration], i) => ({
  id: 'n' + i, name, artist, album, duration,
  sourceType: 'netease', url: '', lrc: '',
  cover: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + ['#274b8f','#8a4a12','#7a1f45','#0f5138','#6b6a12','#1f3a7a','#5a2b7a','#123c5a'][i % 8] + '"/><stop offset="1" stop-color="#101318"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/></svg>'
  ),
}));

const lrc = '[00:00.00]故事的小黄花\n[00:04.00]从出生那年就飘着\n[00:08.00]童年的荡秋千\n[00:12.00]随记忆一直晃到现在\n[00:16.00]吹着前奏望着天空\n[00:20.00]我想起花瓣试着掉落\n[00:24.00]为你翘课的那一天\n[00:28.00]花落的那一天';

test.use({ viewport: { width: 1225, height: 788 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ songs, lrc }) => {
    localStorage.setItem('mplayer_queue', JSON.stringify({ playlist: songs, index: 0, shuffle: null }));
    localStorage.setItem('themeMode', 'dark');
    const noop = async () => undefined;
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === 'musicApi:call') {
          const m = args[0] as string;
          if (m === 'getNeteaseLyrics') return lrc;
          if (m === 'getRecommendedPlaylists') return [];
          if (m === 'getRecommendedSongs') return songs;
          if (m === 'getPlaylistSongs') return { songs, total: songs.length };
          if (m === 'searchSongsRouted') return [];
          return { songs, total: songs.length, albums: [], artists: [], more: false, ok: true };
        }
        if (channel === 'playlist:getAll') return [{ id: 7, name: '示例歌单', description: '简介', cover: '', songCount: songs.length }];
        if (channel === 'playlist:get') return { id: 7, name: '示例歌单', description: '简介', cover: '', songCount: songs.length };
        if (channel === 'playlist:getSongs') return songs;
        if (channel === 'history:get') return songs.slice(0, 5).map((song) => ({ song }));
        if (channel === 'favorite:getAll') return songs;
        if (channel === 'cache:getStats') return { totalSize: 0, fileCount: 0, songsCount: 0, coversCount: 0, audioCount: 0, urlsCount: 0 };
        if (channel === 'settings:getThemeMode') return 'dark';
        if (channel === 'update:getVersion') return '1.9.0';
        return undefined;
      },
      on: noop, removeListener: noop, send: noop,
    };
  }, { songs, lrc });
});

test('current-library', async ({ page }) => {
  await page.goto('http://[::1]:5174/#/library', { waitUntil: 'commit' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '.proto/current-library.png', animations: 'disabled' });
});

test('current-settings-cache', async ({ page }) => {
  await page.goto('http://[::1]:5174/#/settings', { waitUntil: 'commit' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '.proto/current-settings-cache.png', animations: 'disabled' });
});

test('current-settings-appearance', async ({ page }) => {
  await page.goto('http://[::1]:5174/#/settings', { waitUntil: 'commit' });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: '外观' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: '.proto/current-settings-appearance.png', animations: 'disabled' });
});

test('current-now-playing', async ({ page }) => {
  await page.goto('http://[::1]:5174/#/recommend', { waitUntil: 'commit' });
  await page.waitForTimeout(2200);
  await page.locator('.player-bar__cover').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: '.proto/current-now-playing.png', animations: 'disabled' });
});
