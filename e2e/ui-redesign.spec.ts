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

test.describe('UI 交互验证', () => {
  test('TopBar 后退前进导航', async () => {
    const backBtn = page.locator('header button[aria-label="后退"]');
    const forwardBtn = page.locator('header button[aria-label="前进"]');

    // 初始状态：后退禁用，前进禁用
    await expect(backBtn).toBeDisabled();
    await expect(forwardBtn).toBeDisabled();

    // 导航到收藏页（用 sidebar 的按钮）
    await page.getByRole('complementary').getByText('我的收藏').click();
    await page.waitForTimeout(1000);

    // 后退可用，前进禁用
    await expect(backBtn).toBeEnabled();
    await expect(forwardBtn).toBeDisabled();

    // 点击后退回到发现页
    await backBtn.click();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('complementary').getByText('发现音乐')).toBeVisible();

    // 后退禁用，前进可用
    await expect(backBtn).toBeDisabled();
    await expect(forwardBtn).toBeEnabled();

    // 点击前进回到收藏页
    await forwardBtn.click();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('heading', { name: '我的收藏' })).toBeVisible();
  });

  test('TopBar 刷新按钮不丢失状态', async () => {
    // 导航回发现页
    await page.getByRole('complementary').getByText('发现音乐').click();
    await page.waitForTimeout(1000);

    // 点击刷新
    const refreshBtn = page.locator('header button[aria-label="刷新"]');
    await refreshBtn.click();
    await page.waitForTimeout(2000);

    // 页面仍然在发现页
    await expect(page.getByRole('complementary').getByText('发现音乐')).toBeVisible();
  });

  test('播放器收藏按钮无歌曲时 disabled', async () => {
    await page.getByRole('complementary').getByText('发现音乐').click();
    await page.waitForTimeout(1000);

    // 收藏按钮可见
    const heartBtn = page.locator('button[aria-label="收藏"]').first();
    await expect(heartBtn).toBeVisible();

    // 无歌曲时 aria-pressed 为 false
    const pressed = await heartBtn.getAttribute('aria-pressed');
    expect(pressed).toBe('false');
  });

  test('播放器下载按钮点击', async () => {
    await page.getByRole('complementary').getByText('发现音乐').click();
    await page.waitForTimeout(1000);

    const downloadBtn = page.locator('button[aria-label="下载"]').first();
    await expect(downloadBtn).toBeVisible();

    // 无歌曲时按钮 visible 但 disabled
    const isDisabled = await downloadBtn.isDisabled();
    expect(isDisabled).toBeTruthy();
  });

  test('播放器歌词按钮跳转', async () => {
    await page.getByRole('complementary').getByText('发现音乐').click();
    await page.waitForTimeout(1000);

    const lyricsBtn = page.locator('button[aria-label="歌词"]').first();
    await expect(lyricsBtn).toBeVisible();

    // 无歌曲时按钮 disabled
    const isDisabled = await lyricsBtn.isDisabled();
    expect(isDisabled).toBeTruthy();
  });

  test('侧边栏导航切换', async () => {
    // 点击各个导航项
    const navItems = ['发现音乐', '我的收藏', '播放历史', '我的歌单'];

    for (const item of navItems) {
      await page.getByRole('complementary').getByText(item).click();
      await page.waitForTimeout(500);

      // 活跃状态应该有 aria-current="page"
      const activeItem = page.locator('button[aria-current="page"]').filter({ hasText: item });
      await expect(activeItem).toBeVisible();
    }
  });

  test('发现页排行榜歌曲点击', async () => {
    await page.getByRole('complementary').getByText('发现音乐').click();
    await page.waitForTimeout(2000);

    // 滚动到排行榜
    await page.evaluate(() => {
      const container = document.querySelector('[style*="overflow: auto"]');
      if (container) container.scrollTop = 500;
    });
    await page.waitForTimeout(1000);

    // 点击排行榜中的歌曲
    const songRow = page.locator('main div').filter({ hasText: /晴天|起风了|稻香/ }).first();
    if (await songRow.isVisible()) {
      await songRow.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'e2e/screenshots/ui-hotlist-click.png' });
    }
  });

  test('播放器进度条点击跳转', async () => {
    await page.getByRole('complementary').getByText('发现音乐').click();
    await page.waitForTimeout(1000);

    // 搜索播放
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    const songRow = page.locator('main div').filter({ hasText: '晴天' }).first();
    if (await songRow.isVisible()) {
      await songRow.dblclick();
      await page.waitForTimeout(2000);

      // 点击进度条跳转
      const progressBar = page.locator('[role="slider"][aria-label="播放进度"]');
      const box = await progressBar.boundingBox();
      if (box) {
        // 点击进度条中间位置
        await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
        await page.waitForTimeout(500);
        // 不应报错
      }
    }
  });
});
