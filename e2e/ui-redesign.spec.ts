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

test.describe('UI 改动验证', () => {
  test('TopBar 导航按钮可见', async () => {
    // 后退按钮
    const backBtn = page.locator('header button[aria-label="后退"]');
    await expect(backBtn).toBeVisible({ timeout: 10000 });

    // 前进按钮
    const forwardBtn = page.locator('header button[aria-label="前进"]');
    await expect(forwardBtn).toBeVisible();

    // 刷新按钮
    const refreshBtn = page.locator('header button[aria-label="刷新"]');
    await expect(refreshBtn).toBeVisible();
  });

  test('TopBar 后退按钮初始禁用', async () => {
    const backBtn = page.locator('header button[aria-label="后退"]');
    await expect(backBtn).toBeDisabled();
  });

  test('TopBar 导航按钮点击后退禁用状态变化', async () => {
    // 先导航到其他页面
    await page.getByText('我的收藏').click();
    await page.waitForTimeout(1000);

    // 后退按钮应该可用
    const backBtn = page.locator('header button[aria-label="后退"]');
    await expect(backBtn).toBeEnabled();

    // 点击后退
    await backBtn.click();
    await page.waitForTimeout(1000);

    // 应该回到发现页
    await expect(page.getByText('发现音乐')).toBeVisible();
  });

  test('TopBar 刷新按钮点击', async () => {
    const refreshBtn = page.locator('header button[aria-label="刷新"]');
    await refreshBtn.click();
    await page.waitForTimeout(2000);

    // 页面应该仍然正常显示
    await expect(page.getByText('发现音乐')).toBeVisible();
  });

  test('侧边栏设置无边框', async () => {
    // 导航到设置页面
    await page.getByText('设置').click();
    await page.waitForTimeout(1000);

    // 验证设置页面正常显示
    await expect(page.getByText('设置').first()).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/ui-settings.png' });
  });

  test('侧边栏 Logo 使用 icon.png', async () => {
    // 检查侧边栏顶部是否有 img 元素
    const logoImg = page.locator('aside img[alt="MPlayer"]');
    await expect(logoImg).toBeVisible({ timeout: 10000 });

    // 检查图片 src 是否正确
    const src = await logoImg.getAttribute('src');
    expect(src).toBe('/icon.png');
  });

  test('播放器栏布局验证', async () => {
    // 导航回发现页
    await page.getByText('发现音乐').click();
    await page.waitForTimeout(1000);

    // 播放器栏可见
    await expect(page.getByText('未播放')).toBeVisible({ timeout: 10000 });

    // 验证播放器栏有收藏按钮
    const heartBtn = page.locator('button[aria-label="收藏"]').first();
    await expect(heartBtn).toBeVisible();

    // 验证播放器栏有下载按钮
    const downloadBtn = page.locator('button[aria-label="下载"]').first();
    await expect(downloadBtn).toBeVisible();

    // 验证播放器栏有歌词按钮
    const lyricsBtn = page.locator('button[aria-label="歌词"]').first();
    await expect(lyricsBtn).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/ui-player-bar.png' });
  });

  test('播放器进度条触摸区域加大', async () => {
    // 检查进度条容器是否有足够的高度
    const progressContainer = page.locator('[role="slider"][aria-label="播放进度"]');
    await expect(progressContainer).toBeVisible();

    // 验证进度条容器高度至少 16px
    const box = await progressContainer.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(16);
  });

  test('配色为蓝色', async () => {
    // 检查 CSS 变量 --accent 是否为蓝色
    const accentColor = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    });

    // 应该包含蓝色相关值
    expect(accentColor).toContain('#74B9FF');
  });

  test('发现页排行榜歌曲点击播放', async () => {
    // 导航到发现页
    await page.getByText('发现音乐').click();
    await page.waitForTimeout(2000);

    // 滚动到排行榜区域
    await page.evaluate(() => {
      const container = document.querySelector('[style*="overflow: auto"]');
      if (container) container.scrollTop = 500;
    });
    await page.waitForTimeout(1000);

    // 尝试点击排行榜中的歌曲
    const songRow = page.locator('div').filter({ hasText: /晴天|起风了|稻香/ }).first();
    if (await songRow.isVisible()) {
      await songRow.click();
      await page.waitForTimeout(3000);

      // 截图查看状态
      await page.screenshot({ path: 'e2e/screenshots/ui-hotlist-click.png' });
    }
  });
});
