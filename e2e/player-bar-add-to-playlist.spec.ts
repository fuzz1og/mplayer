import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';

/**
 * #245 回归：播放栏「加入歌单」弹窗必须 portal 到 body 并相对视口居中。
 *
 * 背景：PlayerBar 根 div 的 backdropFilter 会为 fixed 后代建立包含块，
 * 弹窗手写遮罩被压进 72px 播放栏（bug 版特征 = 遮罩 height≈72、贴底）。
 *
 * 前置：vite dev 运行于 5174（如 `npm run electron:dev`）；未运行则整组 skip。
 * 运行：npx playwright test e2e/player-bar-add-to-playlist.spec.ts --workers=1
 */

let electronApp: ElectronApplication;
let page: Page;

const seedSong = {
  id: 'e2e-245-seed',
  name: '稻香',
  artist: '周杰伦',
  album: '魔杰座',
  url: '',
  cover: '',
  lrc: '',
  duration: 223,
  sourceType: 'netease',
};

test.beforeAll(async () => {
  const devServerUp = await fetch('http://localhost:5174').then(
    () => true,
    () => false,
  );
  test.skip(!devServerUp, '需要 vite dev 运行于 http://localhost:5174（如 npm run electron:dev）');

  electronApp = await electron.launch({
    args: ['--no-sandbox', '.'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VITE_DEV_SERVER_URL: 'http://localhost:5174',
    },
    timeout: 60000,
  });
  page = await electronApp.firstWindow();
  // dev 模式主进程自动开 DevTools，firstWindow 可能拿到 DevTools 窗口；改取加载 App 的窗口
  for (let i = 0; i < 40; i++) {
    const win = electronApp.windows().find((w) => w.url().includes('localhost:5174'));
    if (win) {
      page = win;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  page.on('dialog', (dialog) => {
    void dialog.dismiss();
  });
  // Electron 下 DCL 事件可能早于监听挂载，waitForLoadState 会挂起；改轮询就绪
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, undefined, { timeout: 30000 });
  // 预置播放队列 → 重载后 PlayerBar 有 currentSong，「加入歌单」可用（不依赖搜索/播放网络）
  await page.evaluate((song) => {
    localStorage.setItem('mplayer_queue', JSON.stringify({ playlist: [song], index: 0 }));
  }, seedSong);
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, undefined, { timeout: 30000 });
  await page.waitForTimeout(2000);
});

test.afterAll(async () => {
  try {
    const proc = electronApp.process();
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch {
    // 进程已退出
  }
});

test.describe.serial('播放栏「加入歌单」弹窗（#245）', () => {
  test('遮罩 portal 到 body，且相对视口居中并盖满视口', async () => {
    await expect(page.getByText(seedSong.name)).toBeVisible({ timeout: 10000 });
    await page.locator('button[aria-label="加入歌单"]').last().click();

    const mask = await page.evaluate(() => {
      const found = [...document.body.children].filter(
        (el): el is HTMLElement =>
          el instanceof HTMLElement &&
          getComputedStyle(el).position === 'fixed' &&
          el.style.zIndex === '1000',
      );
      if (found.length !== 1) return { count: found.length };
      const r = found[0].getBoundingClientRect();
      return {
        count: 1,
        isBodyChild: found[0].parentElement === document.body,
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
      };
    });

    expect(mask.count, 'body 直接子级应恰有一个 fixed 遮罩（portal 修复）').toBe(1);
    expect(mask.isBodyChild).toBe(true);
    const centerX = mask.left! + mask.width! / 2;
    const centerY = mask.top! + mask.height! / 2;
    expect(Math.abs(centerX - mask.viewportW! / 2), '遮罩水平居中').toBeLessThan(10);
    expect(Math.abs(centerY - mask.viewportH! / 2), '遮罩垂直居中').toBeLessThan(10);
    // bug 版特征 = 遮罩被包含块压进 72px 播放栏（height≈72、top≈vh-72）；修复后应盖满视口
    expect(mask.height!, '遮罩应盖满视口而非缩进播放栏').toBeGreaterThanOrEqual(mask.viewportH! * 0.9);
  });

  test('点遮罩空白处关闭弹窗', async () => {
    await expect(page.getByPlaceholder('新建歌单...')).toBeVisible();
    await page.mouse.click(20, 20);
    await expect(page.getByPlaceholder('新建歌单...')).toHaveCount(0);
  });
});
