import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: ['--no-sandbox', '.'],
    env: { ...process.env, NODE_ENV: 'development', MUSIC_API_URL: 'http://www.thirdparty.cn/' },
    timeout: 30000,
  });
  page = await electronApp.firstWindow();
  page.on('dialog', dialog => {
    console.log('[Dialog]', dialog.type(), dialog.message());
    dialog.dismiss().catch(() => {});
  });
  page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);
});

test.afterAll(async () => {
  if (electronApp) {
    try {
      const proc = electronApp.process();
      if (proc && !proc.killed) proc.kill('SIGKILL');
    } catch { /* ignore */ }
  }
});

test.describe('发现页 V2 - 核心功能', () => {

  // Helper: get first song row in chart panel (skip sidebar buttons)
  const getFirstSongRow = () => page.locator('main [style*="cursor: pointer"]').first();

  test('排行榜加载并显示歌曲列表', async () => {
    await page.getByText('发现音乐').click();
    await page.waitForTimeout(2000);

    await expect(page.getByText('🔥 热歌榜')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('🎵 新歌榜')).toBeVisible();

    // 等待歌曲加载（最多 15 秒）
    await expect(getFirstSongRow()).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: 'e2e/screenshots/charts-loaded.png' });
  });

  test('排行榜歌曲展开查看多源', async () => {
    await page.getByText('发现音乐').click();
    await page.waitForTimeout(2000);

    await expect(getFirstSongRow()).toBeVisible({ timeout: 15000 });

    // 点击展开
    await getFirstSongRow().click();
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'e2e/screenshots/charts-expanded.png' });
  });

  test('播放排行榜歌曲', async () => {
    await page.getByText('发现音乐').click();
    await page.waitForTimeout(2000);

    await expect(getFirstSongRow()).toBeVisible({ timeout: 15000 });

    // 点击播放按钮（行内的 button）
    const playBtn = getFirstSongRow().locator('button').last();
    if (await playBtn.isVisible().catch(() => false)) {
      await playBtn.click();
    } else {
      // 没有按钮时双击行播放
      await getFirstSongRow().dblclick();
    }
    await page.waitForTimeout(3000);

    // 播放器栏应显示歌曲名
    const playerText = await page.evaluate(() => {
      const els = document.querySelectorAll('[style*="font-size: var(--text-sm)"]');
      return Array.from(els).map(e => e.textContent).filter(Boolean);
    });
    const hasSong = playerText.some(t => t && t.trim() !== '未播放' && t.trim() !== '—' && t.length > 0);
    expect(hasSong).toBeTruthy();

    await page.screenshot({ path: 'e2e/screenshots/charts-playing.png' });
  });

  test('搜索并显示结果', async () => {
    await page.getByText('发现音乐').click();
    await page.waitForTimeout(1000);

    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(5000);

    const pageText = await page.textContent('body');
    expect(pageText?.includes('周杰伦')).toBeTruthy();
    expect(pageText?.includes('搜索结果')).toBeTruthy();

    await page.screenshot({ path: 'e2e/screenshots/search-results.png' });
  });

  test('搜索返回后排行榜数据仍在', async () => {
    await page.getByText('发现音乐').click();
    await page.waitForTimeout(1000);
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    const backBtn = page.getByRole('button', { name: '返回', exact: true });
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click();
      await page.waitForTimeout(1000);
    }

    await expect(page.getByRole('button', { name: '排行榜', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(getFirstSongRow()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/charts-after-back.png' });
  });
});

test.describe('播放器栏', () => {
  test('播放器栏始终可见', async () => {
    await page.getByText('发现音乐').click();
    await page.waitForTimeout(1000);
    const playerBar = page.locator('[aria-label="查看歌词"]');
    await expect(playerBar.first()).toBeVisible({ timeout: 10000 });
  });

  test('播放后播放器栏显示歌曲信息', async () => {
    // 确保在发现页（清除可能的搜索状态）
    await page.getByText('发现音乐').click();
    await page.waitForTimeout(500);
    const backBtn = page.getByRole('button', { name: '返回', exact: true });
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click();
      await page.waitForTimeout(1000);
    }

    // 等待排行榜歌曲加载
    await expect(page.locator('main [style*="cursor: pointer"]').first()).toBeVisible({ timeout: 15000 });

    const playBtn = page.locator('main [style*="cursor: pointer"]').first().locator('button').last();
    if (await playBtn.isVisible().catch(() => false)) {
      await playBtn.click();
    } else {
      await page.locator('main [style*="cursor: pointer"]').first().dblclick();
    }
    await page.waitForTimeout(3000);

    const playerText = await page.evaluate(() => {
      const els = document.querySelectorAll('[style*="font-size: var(--text-sm)"]');
      return Array.from(els).map(e => e.textContent).filter(Boolean);
    });
    const hasSong = playerText.some(t => t && t.trim() !== '未播放' && t.trim() !== '—' && t.length > 0);
    expect(hasSong).toBeTruthy();

    await page.screenshot({ path: 'e2e/screenshots/playerbar-playing.png' });
  });
});
