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
];

test.beforeEach(async ({ page }) => {
  // 渲染层只经 window.electronAPI 通信：给最小 stub，让页面不因缺桥而白屏
  await page.addInitScript(() => {
    const noop = async () => undefined;
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      invoke: async (channel: string) => {
        if (channel === 'update:getVersion') return '1.9.0';
        if (channel === 'settings:getThemeMode') return 'system';
        if (channel === 'history:get') return [];
        if (channel === 'playlist:getAll') return [];
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
