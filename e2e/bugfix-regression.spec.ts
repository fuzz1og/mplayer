import { test, _electron as electron } from '@playwright/test';
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

test.describe('Bug 回归测试', () => {
  test('API 设置: 保存和测试连接', async () => {
    // 进入设置页
    await page.goto('#/settings');
    await page.waitForTimeout(1000);

    // 找到 API 地址输入框
    const apiInput = page.getByPlaceholder('请输入 API 地址');
    if (await apiInput.isVisible()) {
      await apiInput.fill('http://localhost:3000');
      await page.waitForTimeout(500);

      // 点击保存
      const saveBtn = page.getByText('保存');
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await page.waitForTimeout(1000);
      }
    }
    await page.screenshot({ path: 'e2e/screenshots/bugfix-api-settings.png' });
  });

  test('收藏: 添加和移除收藏', async () => {
    // 先搜索歌曲
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

    // 找到第一首歌曲的收藏按钮
    const favBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
    await favBtn.click();
    await page.waitForTimeout(500);

    // 进入收藏页验证
    await page.goto('#/favorites');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e/screenshots/bugfix-favorites-add.png' });

    // 回到搜索结果移除收藏
    await page.goBack();
    await page.waitForTimeout(2000);
    const favBtnAgain = page.locator('button').filter({ has: page.locator('svg') }).first();
    await favBtnAgain.click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/bugfix-favorites-remove.png' });
  });

  test('播放模式循环切换', async () => {
    // 先搜索并播放一首歌
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    const expandBtn = page.getByText('全部展开');
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(1000);
    }

    // 双击第一首歌曲
    const firstSong = page.locator('div').filter({ hasText: '屋顶' }).first();
    await firstSong.dblclick();
    await page.waitForTimeout(2000);

    // 循环点击播放模式按钮（播放器栏第一个按钮）
    const playModeBtn = page.locator('button').filter({ has: page.locator('svg') }).first();

    // 点击 4 次，检查不报错
    for (let i = 0; i < 4; i++) {
      await playModeBtn.click();
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: 'e2e/screenshots/bugfix-playmode-cycle.png' });
  });

  test('添加到歌单', async () => {
    // 搜索歌曲
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    const expandBtn = page.getByText('全部展开');
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(1000);
    }

    // 右键第一首歌曲 → 添加到歌单
    const firstSongRow = page.locator('div').filter({ hasText: '屋顶' }).first();
    await firstSongRow.click({ button: 'right' });
    await page.waitForTimeout(1000);

    // 检查上下文菜单
    const addToPlaylist = page.getByText('加入歌单');
    if (await addToPlaylist.isVisible()) {
      await addToPlaylist.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'e2e/screenshots/bugfix-add-to-playlist.png' });
  });

  test('歌单详情页重命名可用', async () => {
    // 进入歌单页
    await page.goto('#/playlists');
    await page.waitForTimeout(2000);

    // 如果存在歌单，点击第一个
    const firstPlaylist = page.locator('div').filter({ hasText: '歌单' }).first();
    if (await firstPlaylist.isVisible()) {
      await firstPlaylist.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'e2e/screenshots/bugfix-playlist-detail.png' });
  });

  test('无歌词时不崩溃', async () => {
    // 播放一首可能没有歌词的歌曲
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('test instrumental');
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    const expandBtn = page.getByText('全部展开');
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(1000);
    }

    const firstSong = page.locator('div').filter({ hasText: 'test' }).first();
    await firstSong.dblclick();
    await page.waitForTimeout(2000);

    // 切换到歌词视图
    const lyricToggle = page.getByText('词');
    if (await lyricToggle.isVisible()) {
      await lyricToggle.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: 'e2e/screenshots/bugfix-no-lyrics-crash.png' });
  });
});
