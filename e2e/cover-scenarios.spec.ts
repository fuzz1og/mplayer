import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  console.log('[e2e] launching electron...');
  electronApp = await electron.launch({
    args: ['--no-sandbox', '.'],
    env: { ...process.env, NODE_ENV: 'development', VITE_DEV_SERVER_URL: 'http://localhost:5173' },
    timeout: 60000,
  });
  // DevTools 会先出现，主窗口稍后加载 dev server；轮询找到它
  let main: Page | undefined;
  for (let i = 0; i < 30; i++) {
    main = electronApp.windows().find((w) => w.url().includes('5173'));
    if (main) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!main) throw new Error('主窗口未加载 dev server');
  page = main;
  page.on('dialog', (dialog) => {
    dialog.dismiss().catch(() => {});
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(8000);
});

test.afterAll(async () => {
  if (electronApp) {
    const proc = electronApp.process();
    if (proc && !proc.killed) proc.kill('SIGKILL');
  }
});

// ---------- 工具函数 ----------

async function countLoadedCovers(): Promise<number> {
  return page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    let loaded = 0;
    for (const img of imgs) {
      if (img.complete && img.naturalWidth > 0) loaded++;
    }
    return loaded;
  });
}

async function countTotalCovers(): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('img').length);
}

// 播放栏封面 img：播放栏封面按钮 aria-label="查看歌词"，稳定定位（不依赖几何位置）
async function barCoverLoaded(): Promise<boolean> {
  return page.getByLabel('查看歌词').locator('img').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);
}

async function barCoverSrc(): Promise<string> {
  return page.getByLabel('查看歌词').locator('img').getAttribute('src').catch(() => '') as Promise<string>;
}

async function waitBarCoverLoaded(seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    if (await barCoverLoaded()) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function waitCoversGrow(initial: number, total: number, seconds: number): Promise<number> {
  let loaded = initial;
  for (let i = 0; i < seconds; i++) {
    await page.waitForTimeout(1000);
    loaded = await countLoadedCovers();
    if (loaded >= total) break;
    if (i % 10 === 9) console.log(`[e2e] 等待封面加载... ${loaded}/${total}`);
  }
  return loaded;
}

async function clearCache(): Promise<void> {
  await page.evaluate(() => {
    return (window as any).require('electron').ipcRenderer.invoke('cache:clear');
  });
}

async function openBabyBusPlaylist(): Promise<void> {
  await page.getByText('我的歌单').click();
  await page.waitForTimeout(1500);
  await page.locator('[role="button"]').filter({ hasText: /首歌曲/ }).first().click();
  await page.waitForTimeout(3000);
  await expect(page.getByText('MENTE MÁ').first()).toBeVisible({ timeout: 30000 });
}

test.describe('封面多场景 e2e', () => {
  test.describe.configure({ timeout: 300000 });

  test('场景1: 播放队列封面 + 换歌播放栏封面切换 + 歌词页封面', async () => {
    await openBabyBusPlaylist();

    // 双击第一首播放
    await page.getByText('MENTE MÁ').first().dblclick();
    expect(await waitBarCoverLoaded(25)).toBeTruthy();
    const src1 = await barCoverSrc();
    console.log('[e2e] 播放中封面:', src1.slice(-40));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '10-playing-first.png') });

    // 双击歌单第 2 首 → 播放栏封面切换（不受 playMode/队列长度影响）
    await page.getByText('我是挖掘机').first().dblclick();
    expect(await waitBarCoverLoaded(25)).toBeTruthy();
    const src2 = await barCoverSrc();
    console.log('[e2e] 切歌后封面:', src2.slice(-40));
    expect(src2).not.toBe(src1); // 封面应随歌曲变化
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '11-playing-next.png') });

    // 点播放栏封面 → 歌词页，歌词页封面加载
    await page.getByLabel('查看歌词').click();
    await page.waitForTimeout(3000);
    const hasBackButton = await page.getByText('返回').first().isVisible().catch(() => false);
    console.log('[e2e] 歌词页已打开:', hasBackButton);
    if (hasBackButton) {
      const loaded = await countLoadedCovers();
      expect(loaded).toBeGreaterThan(0);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '12-lyrics.png') });
      // 返回
      await page.getByText('返回').click();
      await page.waitForTimeout(1000);
    }

    // 播放队列页：队列行封面
    await page.getByText('播放队列').click();
    await page.waitForTimeout(4000);
    const queueLoaded = await countLoadedCovers();
    console.log('[e2e] 播放队列已加载封面:', queueLoaded);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '13-queue.png') });
    expect(queueLoaded).toBeGreaterThan(0);
  });

  test('场景2: 收藏页封面正常显示', async () => {
    await page.getByText('我的收藏').click();
    await page.waitForTimeout(4000);

    // 收藏页行（.song-row）渲染
    const rows = await page.locator('.song-row').count();
    console.log('[e2e] 收藏歌曲数:', rows);
    expect(rows).toBeGreaterThan(0);

    // 收藏页加载时 refreshSongUrls 已自动补全封面（cache miss → 搜索），
    // 等待封面出现（最多 70s）
    let loaded = await countLoadedCovers();
    for (let i = 0; i < 70; i++) {
      await page.waitForTimeout(1000);
      loaded = await countLoadedCovers();
      if (loaded >= rows) break;
      if (i % 10 === 9) console.log(`[e2e] 收藏页等待封面... ${loaded}/${rows}`);
    }
    console.log('[e2e] 收藏页最终已加载封面:', loaded);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '20-favorites.png') });
    expect(loaded).toBeGreaterThan(Math.floor(rows * 0.7));
  });

  test('场景3: 搜索列表封面', async () => {
    const searchInput = page.getByPlaceholder('搜索音乐、歌手、专辑');
    await searchInput.fill('周杰伦');
    await searchInput.press('Enter');
    await page.waitForTimeout(6000);

    const total = await countTotalCovers();
    const loaded = await countLoadedCovers();
    console.log(`[e2e] 搜索结果封面: ${loaded}/${total}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '30-search.png') });
    expect(total).toBeGreaterThan(0);
    expect(loaded).toBeGreaterThan(0);
  });

  test('场景4: 清缓存后过期封面自动刷新（压轴）', async () => {
    await clearCache();
    console.log('[e2e] 缓存已清空');

    // 重新进入歌单：DB 里是过期签名的封面 URL → img 失败 → 兜底 → 自动按 ID 刷新
    await openBabyBusPlaylist();
    const total = await countTotalCovers();
    const initial = await countLoadedCovers();
    console.log(`[e2e] 清缓存后初始已加载封面: ${initial}/${total}（应明显小于总数=大量兜底）`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '40-stale-initial.png') });

    // 等待失败封面自动刷新为真图（最多 80s）
    const loaded = await waitCoversGrow(initial, total, 80);
    console.log(`[e2e] 清缓存后最终已加载封面: ${loaded}/${total}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '41-stale-refreshed.png') });

    expect(loaded).toBeGreaterThan(Math.floor(total * 0.6));

    // 播放栏封面同样恢复
    await page.getByText('MENTE MÁ').first().dblclick();
    await page.waitForTimeout(5000);
    expect(await barCoverLoaded()).toBeTruthy();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '42-stale-playerbar.png') });
  });
});
