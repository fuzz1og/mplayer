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

test.describe('跨页面交互', () => {
  test('搜索 → 播放 → 收藏 → 查看收藏', async () => {
    // 1. 搜索歌曲
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    // 2. 展开分组
    const expandBtn = page.getByText('全部展开');
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(1000);
    }

    // 3. 双击播放第一首歌
    const firstSong = page.locator('div').filter({ hasText: '屋顶' }).first();
    await firstSong.dblclick();
    await page.waitForTimeout(2000);

    // 4. 收藏这首歌
    const heartBtn = page.locator('svg.lucide-heart').first();
    await heartBtn.click();
    await page.waitForTimeout(1000);

    // 5. 导航到收藏页面查看
    await page.getByRole('complementary').getByText('我的收藏').click();
    await page.waitForTimeout(2000);

    await expect(page.getByRole('heading', { name: '我的收藏' })).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/cross-search-play-fav.png' });
  });

  test('搜索 → 添加到歌单 → 查看歌单', async () => {
    // 1. 搜索歌曲
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    // 2. 展开分组
    const expandBtn = page.getByText('全部展开');
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(1000);
    }

    // 3. 点击三点菜单
    const moreBtn = page.locator('svg.lucide-ellipsis').first();
    await moreBtn.click();
    await page.waitForTimeout(500);

    // 4. 点击"加入歌单"
    await page.getByText('加入歌单', { exact: true }).click();
    await page.waitForTimeout(1000);

    // 5. 验证弹窗
    await expect(page.getByText('加入歌单').first()).toBeVisible();

    // 6. 关闭弹窗
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/cross-add-to-playlist.png' });
  });

  test('页面状态保持', async () => {
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('测试搜索');
    await searchInput.press('Enter');
    await page.waitForTimeout(2000);

    await page.getByText('我的收藏').click();
    await page.waitForTimeout(1000);

    await page.getByText('发现音乐').click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/cross-state.png' });
  });
});
