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

test('搜索结果页加入歌单功能验证', async () => {
  // 1. 搜索歌曲
  const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
  await searchInput.fill('周杰伦');
  await searchInput.press('Enter');
  await page.waitForTimeout(3000);

  // 2. 展开所有分组
  const expandBtn = page.getByText('全部展开');
  if (await expandBtn.isVisible()) {
    await expandBtn.click();
    await page.waitForTimeout(2000);
  }

  // 3. 点击三点菜单按钮
  const moreBtn = page.locator('svg.lucide-ellipsis').first();
  await moreBtn.click();
  await page.waitForTimeout(1000);

  // 4. 点击下拉菜单中的"加入歌单"按钮
  const dropdownBtn = page.locator('button').filter({ hasText: '加入歌单' }).first();
  await expect(dropdownBtn).toBeVisible();
  await dropdownBtn.click();
  await page.waitForTimeout(2000);

  // 5. 验证弹窗显示 — 弹窗内有"新建歌单"输入框（下拉菜单没有）
  await page.screenshot({ path: 'e2e/screenshots/bug-add-modal.png' });
  const newPlaylistInput = page.getByPlaceholder('新建歌单...');
  await expect(newPlaylistInput).toBeVisible();
});
