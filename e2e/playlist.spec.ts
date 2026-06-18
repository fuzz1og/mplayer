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

test.describe.serial('添加歌单模块', () => {
  test('导航到我的歌单', async () => {
    // 点击侧边栏的"我的歌单"
    await page.getByText('我的歌单').click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/playlist-page.png' });
  });

  test('点击新建歌单按钮', async () => {
    // 点击"新建歌单"按钮
    await page.getByText('新建歌单').click();
    await page.waitForTimeout(1000);

    // 验证弹窗出现
    await expect(page.getByText('歌单名称')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/playlist-create-modal.png' });
  });

  test('输入歌单信息', async () => {
    // 输入歌单名称
    const nameInput = page.getByPlaceholder('请输入歌单名称');
    await nameInput.fill('我的测试歌单');

    // 输入歌单描述
    const descInput = page.getByPlaceholder('请输入歌单描述（可选）');
    await descInput.fill('这是一个测试歌单');

    await page.screenshot({ path: 'e2e/screenshots/playlist-input.png' });
  });

  test('创建歌单', async () => {
    // 点击"创建"按钮（使用更通用的选择器）
    await page.getByRole('button', { name: '创' }).click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/playlist-created.png' });
  });

  test('验证歌单创建成功', async () => {
    // 验证歌单列表中有新创建的歌单
    await expect(page.getByText('我的测试歌单').first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/playlist-verify.png' });
  });

  test('点击歌单查看详情', async () => {
    // 点击新创建的歌单
    await page.getByText('我的测试歌单').first().click();
    await page.waitForTimeout(2000);

    // 验证歌单详情页面
    await expect(page.getByText('歌单暂无歌曲')).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/playlist-detail.png' });
  });
});
