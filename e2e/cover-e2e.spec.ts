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
  console.log('[e2e] launched, windows:', electronApp.windows().map((w) => w.url()));
  // DevTools 会先出现，主窗口稍后加载 dev server；轮询找到它
  let main: Page | undefined;
  for (let i = 0; i < 30; i++) {
    main = electronApp.windows().find((w) => w.url().includes('5173'));
    if (main) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!main) throw new Error('主窗口未加载 dev server');
  page = main;
  console.log('[e2e] using page url:', page.url());
  page.on('dialog', (dialog) => {
    dialog.dismiss().catch(() => {});
  });
  await page.waitForLoadState('domcontentloaded');
  console.log('[e2e] domcontentloaded');
  await page.waitForTimeout(8000);
  console.log('[e2e] ready');
});

test.afterAll(async () => {
  if (electronApp) {
    const proc = electronApp.process();
    if (proc && !proc.killed) proc.kill('SIGKILL');
  }
});

// 统计页面里真实加载成功的封面数量（img 已加载且有实际像素）
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

test.describe('封面加载与失败刷新 e2e', () => {
  test.describe.configure({ timeout: 180000 });

  test('歌单列表封面加载 + 播放栏封面', async () => {
    test.setTimeout(120000);

    // 1. 进入我的歌单，打开第一个歌单
    await page.getByText('我的歌单').click();
    await page.waitForTimeout(1500);
    await page.locator('[role="button"]').filter({ hasText: /首歌曲/ }).first().click();
    await page.waitForTimeout(3000);
    // 调试：当前页面文本与截图
    const pageText = (await page.locator('body').innerText()).slice(0, 400);
    console.log('[e2e] 页面文本:', JSON.stringify(pageText));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00-after-click.png') });

    // 2. 歌单歌曲列表渲染（歌单详情页行无 .song-row 类，用歌曲标题判断）
    await expect(page.getByText('MENTE MÁ').first()).toBeVisible({ timeout: 30000 });
    const totalImgs = await countTotalCovers();
    console.log(`[e2e] 页面 img 总数: ${totalImgs}`);

    // 3. 初始（部分过期封面失败，可能显示兜底），等待失败封面自动刷新
    const loadedBefore = await countLoadedCovers();
    console.log(`[e2e] 初始已加载封面: ${loadedBefore}/${totalImgs}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-playlist-initial.png') });

    // 4. 等待封面刷新（最多 60s，直到大部分封面加载成功）
    let loaded = loadedBefore;
    for (let i = 0; i < 60 && loaded < totalImgs; i++) {
      await page.waitForTimeout(1000);
      loaded = await countLoadedCovers();
      if (i % 5 === 4) console.log(`[e2e] 等待封面加载... ${loaded}/${totalImgs}`);
    }
    console.log(`[e2e] 最终已加载封面: ${loaded}/${totalImgs}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-playlist-loaded.png') });

    // 5. 双击第一首歌播放 → 播放栏封面
    await page.getByText('MENTE MÁ').first().dblclick();
    await page.waitForTimeout(4000);

    // 播放栏封面 img 加载成功
    const barCoverLoaded = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      // 播放栏在页面底部（最后一个非 song-row 的 img，宽高 240 附近）
      const barImg = imgs.find((img) => {
        const r = img.getBoundingClientRect();
        return r.width >= 100 && r.width <= 300 && r.height >= 100;
      });
      return barImg ? (barImg.complete && barImg.naturalWidth > 0) : false;
    });
    console.log(`播放栏封面加载成功: ${barCoverLoaded}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-playerbar.png') });

    // 6. 结论断言：允许少量失败（无版权/已下架歌曲），但大部分必须加载成功
    expect(loaded).toBeGreaterThan(Math.floor(totalImgs * 0.6));
    expect(barCoverLoaded).toBeTruthy();
  });
});
