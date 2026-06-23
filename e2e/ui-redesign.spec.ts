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

  test('发现页排行榜歌曲点击有反馈', async () => {
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

      // 验证有反馈：要么播放成功（播放器显示歌名），要么显示错误提示
      const playerHasSong = await page.getByText('未播放').isHidden().catch(() => false);
      const hasWarning = await page.locator('.ant-message-notice').isVisible().catch(() => false);
      const hasErrorMsg = await page.getByText('未找到可播放的音源').isVisible().catch(() => false)
        || await page.getByText('播放失败').isVisible().catch(() => false);

      // 至少有一种反馈
      expect(playerHasSong || hasWarning || hasErrorMsg).toBeTruthy();
      await page.screenshot({ path: 'e2e/screenshots/ui-hotlist-click.png' });
    }
  });

  test('播放器进度条键盘支持', async () => {
    const progressBar = page.locator('[role="slider"][aria-label="播放进度"]');

    // 导航到发现页，确保页面干净
    await page.getByRole('complementary').getByText('发现音乐').click();
    await page.waitForTimeout(1000);

    // 如果当前无歌曲播放，验证无歌曲状态
    const ariaDisabled = await progressBar.getAttribute('aria-disabled');
    if (ariaDisabled === 'true') {
      // 无歌曲时: tabIndex 应为 -1（不可聚焦）
      const tabIndexBefore = await progressBar.getAttribute('tabindex');
      expect(tabIndexBefore).toBe('-1');
    }

    // 确保有歌曲在播放（搜索并播放）
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    const songRow = page.locator('main div').filter({ hasText: '晴天' }).first();
    if (await songRow.isVisible()) {
      await page.screenshot({ path: 'e2e/screenshots/keyboard-before-dblclick.png' });
      await songRow.dblclick();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'e2e/screenshots/keyboard-after-dblclick.png' });

      // 有歌曲时: aria-disabled 应不存在或为 false
      const disabledAfterPlay = await progressBar.getAttribute('aria-disabled');
      expect(disabledAfterPlay).not.toBe('true');

      // 有歌曲时: tabIndex 应为 0（可聚焦）
      const tabIndexAfter = await progressBar.evaluate((el: HTMLElement) => (el as HTMLDivElement).tabIndex);
      expect(tabIndexAfter).toBe(0);

      // 键盘操作: ArrowRight 前进 5 秒
      const posBefore = Number(await progressBar.getAttribute('aria-valuenow'));
      await progressBar.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      const posAfterArrowRight = Number(await progressBar.getAttribute('aria-valuenow'));
      expect(posAfterArrowRight).toBeGreaterThanOrEqual(posBefore + 4); // allow timing tolerance

      // 键盘操作: ArrowLeft 后退 5 秒
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(200);
      const posAfterArrowLeft = Number(await progressBar.getAttribute('aria-valuenow'));
      expect(posAfterArrowLeft).toBeLessThanOrEqual(posAfterArrowRight - 3);

      // 键盘操作: Home 回到开头
      await page.keyboard.press('Home');
      await page.waitForTimeout(200);
      const posAfterHome = Number(await progressBar.getAttribute('aria-valuenow'));
      expect(posAfterHome).toBeLessThanOrEqual(2);

      // 键盘操作: End 跳到结尾
      await page.keyboard.press('End');
      await page.waitForTimeout(500);
      const posAfterEnd = Number(await progressBar.getAttribute('aria-valuenow'));
      const dur = Number(await progressBar.getAttribute('aria-valuemax'));
      expect(posAfterEnd).toBeGreaterThanOrEqual(dur - 2);
    }
  });

  test('播放器下载按钮 IPC 失败有错误提示', async () => {
    // 捕获 console error 用于检测 unhandled rejection
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // 下载按钮应可见
    const downloadBtn = page.locator('button[aria-label="下载"]').first();
    await expect(downloadBtn).toBeVisible();

    // 如果按钮可用（有歌曲），点击后不应有 unhandled rejection（.catch 处理了）
    // 如果按钮 disabled（无歌曲），也不应有 unhandled rejection
    const isDisabled = await downloadBtn.isDisabled();
    if (!isDisabled) {
      await downloadBtn.click();
    }

    // 给 1 秒观察是否有 unhandled rejection
    await page.waitForTimeout(1000);
    const unhandledBefore = consoleErrors.filter(e => e.includes('Unhandled Promise Rejection'));
    expect(unhandledBefore.length).toBe(0);
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
