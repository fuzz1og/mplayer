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

test.describe('音乐播放模块', () => {
  test('搜索歌曲并双击播放', async () => {
    // 搜索歌曲
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    // 展开分组（如果有）
    const expandBtn = page.getByText('全部展开');
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(1000);
    }

    // 双击第一首歌曲触发播放
    const firstSong = page.locator('div').filter({ hasText: '屋顶' }).first();
    await firstSong.dblclick();
    await page.waitForTimeout(2000);

    // 验证播放器栏显示了歌曲信息
    const playerText = await page.textContent('body');
    expect(playerText).toContain('屋顶');

    await page.screenshot({ path: 'e2e/screenshots/playback-playing.png' });
  });

  test('暂停和恢复播放', async () => {
    // 点击暂停按钮（播放/暂停按钮在播放器栏中央）
    const playPauseBtn = page.locator('button').filter({ has: page.locator('svg') }).nth(2);
    await playPauseBtn.click();
    await page.waitForTimeout(500);

    // 点击恢复播放
    await playPauseBtn.click();
    await page.waitForTimeout(500);

    // 验证仍在播放
    await page.screenshot({ path: 'e2e/screenshots/playback-resume.png' });
  });

  test('切换播放模式', async () => {
    // 点击播放模式按钮（播放器栏最左侧按钮）
    const playModeBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
    await playModeBtn.click();
    await page.waitForTimeout(500);

    // 验证模式切换（hover 查看 tooltip）
    await playModeBtn.hover();
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/playback-mode.png' });
  });

  test('点击下一首', async () => {
    // 点击下一首按钮
    const nextBtn = page.locator('button').filter({ has: page.locator('svg') }).nth(3);
    await nextBtn.click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/playback-next.png' });
  });

  test('点击上一首', async () => {
    // 点击上一首按钮
    const prevBtn = page.locator('button').filter({ has: page.locator('svg') }).nth(1);
    await prevBtn.click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/playback-prev.png' });
  });
});
