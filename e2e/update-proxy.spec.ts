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

// 辅助函数：导航到设置页面
async function goToSettings() {
  await page.getByRole('complementary').getByText('设置').click();
  await page.waitForTimeout(1000);
}

// 辅助函数：启用代理
async function enableProxy(host: string = '127.0.0.1', port: string = '7890') {
  const enableProxyLabel = page.locator('text=启用代理').locator('..');
  const proxySwitch = enableProxyLabel.locator('input[type="checkbox"]');

  const isChecked = await proxySwitch.isChecked();
  if (!isChecked) {
    await proxySwitch.click();
    await page.waitForTimeout(500);
  }

  const hostInput = page.locator('input[placeholder="例如: 127.0.0.1"]');
  await hostInput.clear();
  await hostInput.fill(host);

  const portInput = page.locator('input[type="number"]');
  await portInput.clear();
  await portInput.fill(port);

  const saveBtn = page.getByRole('button', { name: '保存代理设置' });
  await saveBtn.click();
  await page.waitForTimeout(1000);
}

// 辅助函数：禁用代理
async function disableProxy() {
  const enableProxyLabel = page.locator('text=启用代理').locator('..');
  const proxySwitch = enableProxyLabel.locator('input[type="checkbox"]');

  const isChecked = await proxySwitch.isChecked();
  if (isChecked) {
    await proxySwitch.click();
    await page.waitForTimeout(500);
  }

  const saveBtn = page.getByRole('button', { name: '保存代理设置' });
  await saveBtn.click();
  await page.waitForTimeout(1000);
}

// 辅助函数：点击检查更新并等待结果
async function checkForUpdates(waitSeconds: number = 15) {
  const checkUpdateBtn = page.getByRole('button', { name: '检查更新' });
  await checkUpdateBtn.click();

  // 等待显示"检查中..."
  await page.waitForTimeout(1000);

  // 等待指定时间
  await page.waitForTimeout(waitSeconds * 1000);
}

// 辅助函数：获取检查更新状态
async function getUpdateStatus(): Promise<{
  isChecking: boolean;
  hasError: boolean;
  errorMessage: string | null;
  hasSuccess: boolean;
}> {
  const bodyText = await page.textContent('body') || '';

  const isChecking = bodyText.includes('检查中...');
  const hasError = bodyText.includes('检查更新失败') || bodyText.includes('超时');
  const hasSuccess = bodyText.includes('已是最新版本') || bodyText.includes('发现新版本');

  let errorMessage = null;
  if (hasError) {
    const match = bodyText.match(/检查更新失败[，,]([^。]+)/);
    errorMessage = match ? match[1] : '检查更新失败';
  }

  return { isChecking, hasError, errorMessage, hasSuccess };
}

test.describe('更新服务测试', () => {
  test('1. 默认无代理时检查更新应显示失败', async () => {
    await goToSettings();

    // 验证版本信息
    const versionText = page.locator('text=v1.2.0').first();
    await expect(versionText).toBeVisible();

    // 点击检查更新并等待超时
    await checkForUpdates(12);

    // 截图保存状态
    await page.screenshot({ path: 'e2e/screenshots/update-timeout-result.png' });

    // 验证最终状态
    const status = await getUpdateStatus();
    console.log(`默认无代理状态:`, status);

    // 应该显示失败或超时
    expect(status.hasError).toBe(true);
    expect(status.isChecking).toBe(false);
  });

  test('2. 开启代理后检查更新', async () => {
    await goToSettings();

    // 启用代理
    await enableProxy('127.0.0.1', '7890');

    // 截图保存代理配置
    await page.screenshot({ path: 'e2e/screenshots/update-proxy-enabled.png' });

    // 点击检查更新并等待
    await checkForUpdates(15);

    // 截图保存更新状态
    await page.screenshot({ path: 'e2e/screenshots/update-with-proxy.png' });

    // 验证最终状态
    const status = await getUpdateStatus();
    console.log(`开启代理状态:`, status);

    // 代理可能成功也可能失败（取决于代理是否可用）
    // 但应该不再是"检查中..."
    expect(status.isChecking).toBe(false);
  });

  test('3. 关闭代理后检查更新应再次显示失败', async () => {
    await goToSettings();

    // 禁用代理
    await disableProxy();

    // 截图保存代理配置
    await page.screenshot({ path: 'e2e/screenshots/update-proxy-disabled.png' });

    // 点击检查更新并等待超时
    await checkForUpdates(12);

    // 截图保存状态
    await page.screenshot({ path: 'e2e/screenshots/update-after-proxy-disabled.png' });

    // 验证最终状态
    const status = await getUpdateStatus();
    console.log(`关闭代理后状态:`, status);

    // 应该显示失败或超时
    expect(status.hasError).toBe(true);
    expect(status.isChecking).toBe(false);
  });

  test('4. 验证代理配置状态', async () => {
    await goToSettings();

    // 验证代理配置已保存为关闭状态
    const enableProxyLabel = page.locator('text=启用代理').locator('..');
    const proxySwitch = enableProxyLabel.locator('input[type="checkbox"]');
    const isChecked = await proxySwitch.isChecked();
    expect(isChecked).toBe(false);

    // 截图保存最终状态
    await page.screenshot({ path: 'e2e/screenshots/update-final-state.png' });
  });
});
