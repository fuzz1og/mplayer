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

test.describe.serial('收藏功能', () => {
  test('收藏一首歌曲', async () => {
    // 使用已有搜索结果（依赖 electron-e2e 的搜索）
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    // 展开分组
    const expandBtn = page.getByText('全部展开');
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(1000);
    }

    // 点击收藏按钮
    const heartBtn = page.locator('svg.lucide-heart').first();
    await heartBtn.click();
    await page.waitForTimeout(1000);
  });

  test('查看收藏列表', async () => {
    await page.getByRole('complementary').getByText('我的收藏').click();
    await page.waitForTimeout(2000);

    await expect(page.getByRole('heading', { name: '我的收藏' })).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/favorites-list.png' });
  });

  test('取消收藏', async () => {
    const heartBtn = page.locator('svg.lucide-heart').first();
    await heartBtn.click();
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'e2e/screenshots/favorites-remove.png' });
  });
});
