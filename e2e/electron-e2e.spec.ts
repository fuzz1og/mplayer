import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: ['--no-sandbox', '.'],
    env: { ...process.env, NODE_ENV: 'development' },
    timeout: 30000,
  });
  page = await electronApp.firstWindow();
  // 注册 dialog 处理器（必须在页面加载前）
  page.on('dialog', dialog => {
    console.log('[Dialog]', dialog.type(), dialog.message());
    dialog.dismiss().catch(() => {});
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);
});

test.afterAll(async () => {
  if (electronApp) {
    try {
      // 强制杀死 Electron 进程
      const proc = electronApp.process();
      if (proc && !proc.killed) {
        proc.kill('SIGKILL');
      }
    } catch {
      // 忽略关闭错误
    }
  }
});

test.describe('MPlayer E2E', () => {
  test('应用窗口正常打开', async () => {
    const title = await page.title();
    expect(title).toContain('MPlayer');
  });

  test('页面有内容渲染', async () => {
    const rootHTML = await page.evaluate(() => {
      const root = document.getElementById('root');
      return root?.innerHTML?.length || 0;
    });
    expect(rootHTML).toBeGreaterThan(0);
  });

  test('侧边栏导航项可见', async () => {
    await expect(page.getByText('发现音乐')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('我的收藏')).toBeVisible();
    await expect(page.getByText('播放历史')).toBeVisible();
    await expect(page.getByText('我的歌单')).toBeVisible();
  });

  test('搜索框可见', async () => {
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
  });

  test('播放器栏可见', async () => {
    // 播放器栏底部有 "未播放" 文字
    await expect(page.getByText('未播放')).toBeVisible({ timeout: 10000 });
  });

  test('导航到收藏页面', async () => {
    await page.getByText('我的收藏').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/favorites.png' });
  });

  test('导航到历史页面', async () => {
    await page.getByText('播放历史').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/history.png' });
  });

  test('导航到下载管理页面', async () => {
    await page.getByText('下载管理').click();
    await page.waitForTimeout(1000);
    const pageText = await page.textContent('body');
    expect(pageText?.includes('下载') || pageText?.includes('管理')).toBeTruthy();
    await page.screenshot({ path: 'e2e/screenshots/download.png' });
  });

  test('导航到我的歌单', async () => {
    await page.getByText('我的歌单').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/playlists.png' });
  });

  test('导航到本地音乐', async () => {
    await page.getByText('本地音乐').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/local.png' });
  });

  test('导航到设置页面', async () => {
    await page.getByText('设置').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/settings.png' });
  });

  test('搜索功能', async () => {
    // 先导航回发现页
    await page.getByText('发现音乐').click();
    await page.waitForTimeout(1000);

    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'e2e/screenshots/search.png' });

    const pageText = await page.textContent('body');
    const hasResults = pageText?.includes('周杰伦') || pageText?.includes('搜索');
    expect(hasResults).toBeTruthy();
  });
});
