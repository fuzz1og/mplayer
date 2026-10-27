import { test, expect } from '@playwright/test';

/** 1.9.0 UI 验收截图（Chromium + electronAPI stub，非真实 Electron）。用法：npx playwright test 本文件 --workers=1 */
const ROUTES: Array<[string, string, string]> = [
  ['ui-01-recommend', '/#/recommend', '推荐'],
  ['ui-02-discover', '/#/discover', '发现'],
  ['ui-03-library', '/#/library', '资料库'],
  ['ui-04-playlists', '/#/playlists', '我的歌单'],
  ['ui-05-artists', '/#/artists', '歌手'],
  ['ui-06-settings', '/#/settings', '设置'],
  ['ui-07-uilab', '/#/ui-lab', 'UI 原语'],
  ['ui-08-favorites', '/#/favorites', '我喜欢的音乐'],
  ['ui-09-history', '/#/history', '最近播放'],
  ['ui-10-queue', '/#/queue', '播放队列'],
  ['ui-11-local', '/#/local', '本地音乐'],
  ['ui-12-album', '/#/album/a1', '专辑详情'],
  ['ui-13-artist', '/#/artist/ar1', '歌手详情'],
  ['ui-14-hotlist', '/#/hotlist/netease:hot', '热榜详情'],
  ['ui-15-playlist', '/#/playlist/7', '歌单详情'],
];

test.beforeEach(async ({ page }) => {
  // 渲染层只经 window.electronAPI 通信：给最小 stub，让页面不因缺桥而白屏
  await page.addInitScript(() => {
    const noop = async () => undefined;
    const song = (i: number) => ({ id: 'n' + i, name: '示例歌曲 ' + i, artist: '示例歌手', album: '示例专辑', duration: 240, sourceType: 'netease', url: '', cover: '', lrc: '' });
    const songs = Array.from({ length: 12 }, (_, i) => song(i + 1));

    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      invoke: async (channel: string, ...args: unknown[]) => {
        // musicApi 单通道分发：详情页都靠它取数
        if (channel === 'musicApi:call') {
          const method = args[0] as string;
          if (method === 'getAlbumDetail') return { album: { id: 'a1', name: '示例专辑', artist: '示例歌手', picUrl: '', publishTime: String(Date.now()), description: '示例专辑简介' }, songs };
          if (method === 'getArtistSongs') return { songs, total: songs.length };
          if (method === 'getArtistAlbums') return { albums: [], total: 0, more: false, ok: true };
          if (method === 'getToplists') return [{ source: 'netease', sourceId: 'hot', sourceName: '网易云', groups: [{ key: 'hot', name: '热歌榜', songs }] }];
          if (method === 'getPlaylistSongs') return { songs, total: songs.length };
          if (method === 'getToplistSongs') return { songs, groups: [] };
          // 按方法给精确结构：一刀切的默认值会让 playlists.map / songs[0] 这类读法抛错
          if (method === 'getRecommendedPlaylists') return [];
          if (method === 'getRecommendedSongs') return songs;
          if (method === 'getDailySongs') return { songs };
          return { songs, total: songs.length, albums: [], artists: [], more: false, ok: true };
        }
        if (channel === 'update:getVersion') return '1.9.0';
        if (channel === 'settings:getThemeMode') return 'system';
        if (channel === 'history:get') return songs.slice(0, 5).map((song: Record<string, unknown>) => ({ song }));
        if (channel === 'playlist:getAll') return [];
        if (channel === 'favorite:getAll') return songs;
        if (channel === 'playlist:get') return { id: 7, name: '示例歌单', description: '示例简介', cover: '', songCount: songs.length };
        if (channel === 'playlist:getSongs') return songs;
        if (channel === 'settings:getSourceModes') return { status: {} };
        if (channel === 'getArtists') return { artists: [], more: false };
        if (channel === 'cache:getStats') return { totalSize: 0, fileCount: 0, songsCount: 0, coversCount: 0, audioCount: 0, urlsCount: 0 };
        if (channel === 'settings:getTier3State') return { enabled: false, subscriptions: [] };
        return undefined;
      },
      on: noop,
      removeListener: noop,
      send: noop,
    };
  });
});

for (const [name, route, label] of ROUTES) {
  test('截图 ' + label, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => { errors.push(String(e)); console.log('[PAGEERROR]', e.stack || String(e)); });
    await page.goto('http://[::1]:5174' + route, { waitUntil: 'commit', timeout: 15000 });
    await page.waitForTimeout(2500);
    // 页面里有常驻骨架动画（skeleton-shimmer 无限循环），截图必须停掉动画否则会一直等稳定态
    await page.screenshot({ path: 'shots/' + name + '.png', fullPage: false, animations: 'disabled', caret: 'hide' });
    // 用 count() 立即判定：textContent() 在元素不存在时会等满默认 30s 再抛错
    const boundaryCount = await page.locator('.errb__msg').count();
    if (boundaryCount > 0) {
      const msg = await page.locator('.errb__msg').first().textContent();
      throw new Error(name + ' 撞上错误边界：' + msg);
    }
    expect(errors, '页面运行时报错：' + errors.join('; ')).toHaveLength(0);
  });
}
