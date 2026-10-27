import { test, expect } from '@playwright/test';

/** 骨架自检：标题栏搜索 / 侧栏 / 播放栏三处新形状（Chromium + stub）。 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const noop = async () => undefined;
    const song = (i: number) => ({ id: 'n' + i, name: '示例歌曲 ' + i, artist: '示例歌手', album: '示例专辑', duration: 240, sourceType: 'netease', url: '', cover: '', lrc: '' });
    const songs = Array.from({ length: 8 }, (_, i) => song(i + 1));
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === 'musicApi:call') {
          const m = args[0] as string;
          if (m === 'getRecommendedPlaylists') return [];
          if (m === 'getRecommendedSongs') return songs;
          return { songs, total: songs.length, albums: [], artists: [], more: false, ok: true };
        }
        if (channel === 'playlist:getAll') return [{ id: 7, name: '示例歌单', description: '简介', cover: '', songCount: 3 }];
        if (channel === 'history:get') return [];
        if (channel === 'favorite:getAll') return songs.slice(0, 3);
        if (channel === 'cache:getStats') return { totalSize: 0, fileCount: 0, songsCount: 0, coversCount: 0, audioCount: 0, urlsCount: 0 };
        if (channel === 'settings:getThemeMode') return 'system';
        if (channel === 'update:getVersion') return '1.9.0';
        return undefined;
      },
      on: noop, removeListener: noop, send: noop,
    };
    localStorage.setItem('mplayer_queue', JSON.stringify({ playlist: songs, index: 0, shuffle: null }));
  });
});

test('骨架自检', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => { errors.push(String(e)); console.log('[PAGEERROR]', e.stack || String(e)); });
  await page.goto('http://[::1]:5174/#/recommend', { waitUntil: 'commit' });
  await page.waitForTimeout(2500);
  const box = await page.evaluate(() => {
    const q = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      titlebar: q('.titlebar'),
      search: q('.titlebar__search'),
      sidebar: q('.sidebar'),
      content: q('.app-shell__content'),
      player: q('.player-bar'),
      sidebarLabels: Array.from(document.querySelectorAll('.sidebar__label')).map((e) => e.textContent?.trim()),
    };
  });
  console.log(JSON.stringify(box, null, 1));
  await page.screenshot({ path: '.proto/current-shell.png', animations: 'disabled' });
  expect(await page.locator('.errb__msg').count()).toBe(0);
  expect(errors).toHaveLength(0);
});
