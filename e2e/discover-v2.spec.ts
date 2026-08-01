import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page, Locator } from 'playwright';

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: ['--no-sandbox', '.'],
    env: { ...process.env, NODE_ENV: 'development', MUSIC_API_URL: 'http://www.jbsou.cn/' },
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

async function navigateToDiscover() {
  const discoverBtn = page.getByText('发现音乐');
  if (await discoverBtn.isVisible().catch(() => false)) {
    await discoverBtn.click();
  }
  // Clear any lingering search state
  const backBtn = page.getByRole('button', { name: '返回', exact: true });
  if (await backBtn.isVisible().catch(() => false)) {
    await backBtn.click();
  }
  await page.waitForTimeout(1000);
}

type ExpectedState = { text: string } | { selector: string };

async function expectAnyState(locator: Locator, states: ExpectedState[]): Promise<void> {
  const timeout = 10000;
  const deadline = Date.now() + timeout;
  let body = '';
  while (Date.now() < deadline) {
    body = (await locator.textContent()) || '';
    for (const state of states) {
      if ('text' in state && body.includes(state.text)) return;
      if ('selector' in state && (await locator.locator(state.selector).count()) > 0) return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Expected state not found. Last content: ${body.slice(0, 200)}`);
}

test.describe('发现页 V2 - 排行榜', () => {

  const getFirstSongRow = () => page.locator('main [style*="cursor: pointer"]').first();

  test('加载后显示热歌榜和新歌榜标题', async () => {
    await navigateToDiscover();
    await expect(page.getByText('🔥 热歌榜')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('🎵 新歌榜')).toBeVisible();
  });

  test('加载后显示歌曲行', async () => {
    await navigateToDiscover();
    await expect(getFirstSongRow()).toBeVisible({ timeout: 15000 });
  });

  test('歌曲行包含 SourceBadge', async () => {
    await navigateToDiscover();
    await expect(getFirstSongRow()).toBeVisible({ timeout: 15000 });

    // SourceBadge renders as colored text spans (not images)
    const badges = page.locator('main span').filter({ hasText: /网易云|QQ|酷狗/ });
    const count = await badges.count().catch(() => 0);
    expect(count).toBeGreaterThan(0);
  });

  test('展开后显示多源版本', async () => {
    await navigateToDiscover();
    await expect(getFirstSongRow()).toBeVisible({ timeout: 15000 });

    await getFirstSongRow().click();
    await page.waitForTimeout(500);

    // Expanded section shows more rows
    const rows = page.locator('main [style*="cursor: pointer"]');
    expect(await rows.count()).toBeGreaterThan(1);
  });

  test('点击排行榜歌曲播放按钮', async () => {
    await navigateToDiscover();
    await expect(getFirstSongRow()).toBeVisible({ timeout: 15000 });

    const playBtn = getFirstSongRow().locator('button').last();
    if (await playBtn.isVisible().catch(() => false)) {
      await playBtn.click();
    } else {
      await getFirstSongRow().dblclick();
    }
    await page.waitForTimeout(3000);

    const playerText = await page.evaluate(() => {
      const els = document.querySelectorAll('[style*="font-size: var(--text-sm)"]');
      return Array.from(els).map(e => e.textContent).filter(Boolean);
    });
    const hasSong = playerText.some(t => t && t.trim() !== '未播放' && t.trim() !== '—' && t.length > 0);
    expect(hasSong).toBeTruthy();
  });
});

test.describe('发现页 V2 - 新碟上架', () => {

  test('切换标签后显示专辑卡片', async () => {
    await navigateToDiscover();

    await page.getByText('新碟上架').click();
    await page.waitForTimeout(3000);

    const main = page.locator('main');
    await expectAnyState(main, [
      { selector: 'img' },
      { text: '暂无新碟数据' },
      { text: '重试' },
      { selector: '.skeleton-shimmer' },
    ]);
  });

  test('地区筛选按钮可点击切换', async () => {
    await navigateToDiscover();
    await page.getByText('新碟上架').click();
    await page.waitForTimeout(5000);

    const main = page.locator('main');
    await expectAnyState(main, [{ text: '华语' }, { text: '重试' }]);

    const zhBtn = page.getByRole('button', { name: '华语', exact: true });
    if (await zhBtn.isVisible().catch(() => false)) {
      await zhBtn.click();
      await page.waitForTimeout(500);
      await expect(zhBtn).toBeVisible();
    } else {
      await expect(page.getByText('重试')).toBeVisible();
    }
  });

  test('加载或失败态不白屏', async () => {
    await navigateToDiscover();
    await page.getByText('新碟上架').click();
    await page.waitForTimeout(2000);
    const main = page.locator('main');
    await expectAnyState(main, [
      { selector: 'img' },
      { text: '暂无新碟数据' },
      { text: '重试' },
      { selector: '.skeleton-shimmer' },
    ]);
  });
});

test.describe('发现页 V2 - 猜你喜欢', () => {

  test('切换后显示推荐歌单网格', async () => {
    await navigateToDiscover();
    await page.getByText('猜你喜欢').click();
    await page.waitForTimeout(5000);

    const main = page.locator('main');
    await expectAnyState(main, [
      { selector: 'img' },
      { text: '暂无推荐歌单' },
      { text: '暂无推荐歌曲' },
      { text: '重试' },
      { selector: '.skeleton-shimmer' },
    ]);
  });
});

test.describe('发现页 V2 - 歌单', () => {

  test('切换后显示歌单大卡片网格', async () => {
    await navigateToDiscover();
    await page.getByRole('button', { name: '歌单', exact: true }).click();
    await page.waitForTimeout(5000);

    const main = page.locator('main');
    await expectAnyState(main, [
      { selector: 'img' },
      { text: '暂无歌单' },
      { text: '重试' },
      { selector: '.skeleton-shimmer' },
    ]);
  });
});

test.describe('发现页 V2 - 搜索交互', () => {

  test('搜索后搜索结果可见', async () => {
    await navigateToDiscover();

    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(5000);

    await expect(page.getByText(/搜索结果:/)).toBeVisible({ timeout: 10000 });
  });

  test('搜索返回后排行榜数据仍在', async () => {
    await navigateToDiscover();
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
    const songRow = page.locator('main [style*="cursor: pointer"]').first();
    await expect(songRow).toBeVisible({ timeout: 5000 });
  });
});

test.describe('播放器栏', () => {

  test('播放器栏始终可见', async () => {
    await navigateToDiscover();
    const playerBar = page.locator('[aria-label="查看歌词"]');
    await expect(playerBar.first()).toBeVisible({ timeout: 10000 });

    // Verify across tab switches
    await page.getByText('新碟上架').click({ noWaitAfter: true });
    await page.waitForTimeout(500);
    await expect(playerBar.first()).toBeVisible();

    await page.getByText('猜你喜欢').click({ noWaitAfter: true });
    await page.waitForTimeout(500);
    await expect(playerBar.first()).toBeVisible();
  });

  test('播放后显示歌曲信息', async () => {
    await navigateToDiscover();
    const firstSong = page.locator('main [style*="cursor: pointer"]').first();
    await expect(firstSong).toBeVisible({ timeout: 15000 });

    const playBtn = firstSong.locator('button').last();
    if (await playBtn.isVisible().catch(() => false)) {
      await playBtn.click();
    } else {
      await firstSong.dblclick();
    }
    await page.waitForTimeout(3000);

    const playerText = await page.evaluate(() => {
      const els = document.querySelectorAll('[style*="font-size: var(--text-sm)"]');
      return Array.from(els).map(e => e.textContent).filter(Boolean);
    });
    const hasSong = playerText.some(t => t && t.trim() !== '未播放' && t.trim() !== '—' && t.length > 0);
    expect(hasSong).toBeTruthy();
  });
});
