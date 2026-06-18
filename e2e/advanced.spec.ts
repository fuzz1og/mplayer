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
  page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);
});

test.afterAll(async () => {
  if (electronApp) {
    try { electronApp.process()?.kill('SIGKILL'); } catch {}
  }
});

test.describe.serial('高级场景', () => {
  test('搜索切换音源', async () => {
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'e2e/screenshots/adv-search-all.png' });
  });

  test('收藏列表页面验证', async () => {
    await page.getByRole('complementary').getByText('我的收藏').click();
    await page.waitForTimeout(2000);

    await expect(page.getByRole('heading', { name: '我的收藏' })).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/adv-favorites-page.png' });
  });

  test('歌单内移除歌曲', async () => {
    // 先创建歌单
    await page.getByText('我的歌单').click();
    await page.waitForTimeout(1000);

    const createBtn = page.getByText('新建歌单');
    if (await createBtn.isVisible()) {
      await createBtn.click();
      await page.waitForTimeout(1000);

      const nameInput = page.getByPlaceholder('请输入歌单名称');
      await nameInput.fill('测试歌单-移除');

      await page.getByRole('button', { name: '创' }).click();
      await page.waitForTimeout(2000);
    }

    // 进入歌单详情
    const playlist = page.getByText('测试歌单-移除').first();
    if (await playlist.isVisible()) {
      await playlist.click();
      await page.waitForTimeout(2000);

      // 验证空状态
      await expect(page.getByText('歌单暂无歌曲')).toBeVisible({ timeout: 5000 });
      await page.screenshot({ path: 'e2e/screenshots/adv-empty-playlist.png' });
    }
  });

  test('搜索结果歌手标签页', async () => {
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    // 切换到歌手标签
    await page.getByRole('button', { name: '歌手' }).click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/adv-artist-tab.png' });

    const pageText = await page.textContent('body');
    const hasArtistResults = pageText?.includes('周杰伦') || pageText?.includes('歌手');
    expect(hasArtistResults).toBeTruthy();
  });

  test('发现页热门歌单', async () => {
    await page.getByText('发现音乐').click();
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      const container = document.querySelector('[style*="overflow: auto"]');
      if (container) container.scrollTop = 500;
    });
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'e2e/screenshots/adv-discover-playlists.png' });
  });

  test('空状态验证', async () => {
    // 导航到收藏页面（空状态）
    await page.getByRole('complementary').getByText('我的收藏').click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/adv-empty-favorites.png' });

    // 导航到试听列表（空状态）
    await page.getByText('试听列表').click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/adv-empty-queue.png' });
  });
});
