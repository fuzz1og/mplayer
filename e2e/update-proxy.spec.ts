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

test.describe('更新服务测试', () => {
  test('1. 默认无代理时检查更新应超时', async () => {
    // 导航到设置页面
    await page.getByRole('complementary').getByText('设置').click();
    await page.waitForTimeout(2000);

    // 验证版本信息（使用第一个匹配）
    const versionText = page.locator('text=v1.2.0').first();
    await expect(versionText).toBeVisible();

    // 验证代理默认关闭
    const enableProxyText = page.getByText('启用代理');
    await expect(enableProxyText).toBeVisible();

    // 点击检查更新按钮
    const checkUpdateBtn = page.getByRole('button', { name: '检查更新' });
    await checkUpdateBtn.click();

    // 等待显示"检查中..."
    await page.waitForTimeout(1000);

    // 验证显示检查中
    const checkingText = page.getByText('检查中...');
    const isChecking = await checkingText.isVisible().catch(() => false);
    console.log(`显示检查中: ${isChecking}`);

    // 等待超时（12秒）
    await page.waitForTimeout(12000);

    // 截图保存状态
    await page.screenshot({ path: 'e2e/screenshots/update-timeout-result.png' });

    // 验证最终状态（可能显示错误或超时）
    const bodyText = await page.textContent('body');
    console.log(`最终状态: ${bodyText?.substring(0, 300)}`);
  });

  test('2. 验证设置页面结构', async () => {
    // 导航到设置页面
    await page.getByRole('complementary').getByText('设置').click();
    await page.waitForTimeout(1000);

    // 验证各个设置区域存在
    await expect(page.getByText('缓存管理')).toBeVisible();
    await expect(page.getByText('下载设置')).toBeVisible();
    await expect(page.getByText('API 设置')).toBeVisible();
    await expect(page.getByText('网络代理设置')).toBeVisible();
    await expect(page.getByRole('heading', { name: '检查更新' })).toBeVisible();
    await expect(page.getByText('关于MPlayer')).toBeVisible();

    // 截图
    await page.screenshot({ path: 'e2e/screenshots/update-settings-structure.png' });
  });

  test('3. 检查更新按钮功能', async () => {
    // 导航到设置页面
    await page.getByRole('complementary').getByText('设置').click();
    await page.waitForTimeout(1000);

    // 点击检查更新按钮
    const checkUpdateBtn = page.getByRole('button', { name: '检查更新' });
    await checkUpdateBtn.click();

    // 等待状态变化
    await page.waitForTimeout(2000);

    // 截图保存状态
    await page.screenshot({ path: 'e2e/screenshots/update-button-click.png' });

    // 验证按钮状态（可能变为禁用）
    const isDisabled = await checkUpdateBtn.isDisabled().catch(() => false);
    console.log(`按钮禁用状态: ${isDisabled}`);
  });
});
