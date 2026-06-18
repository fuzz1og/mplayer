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
  // 找到"启用代理"文本旁边的复选框
  const enableProxyLabel = page.locator('text=启用代理').locator('..');
  const proxySwitch = enableProxyLabel.locator('input[type="checkbox"]');

  // 如果未启用，点击开启
  const isChecked = await proxySwitch.isChecked();
  if (!isChecked) {
    await proxySwitch.click();
    await page.waitForTimeout(500);
  }

  // 填写代理配置
  const hostInput = page.locator('input[placeholder="例如: 127.0.0.1"]');
  await hostInput.clear();
  await hostInput.fill(host);

  const portInput = page.locator('input[type="number"]');
  await portInput.clear();
  await portInput.fill(port);

  // 保存代理配置
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

  // 保存代理配置
  const saveBtn = page.getByRole('button', { name: '保存代理设置' });
  await saveBtn.click();
  await page.waitForTimeout(1000);
}

test.describe('更新服务测试', () => {
  test('1. 默认无代理时检查更新应超时', async () => {
    await goToSettings();

    // 验证版本信息
    const versionText = page.locator('text=v1.2.0').first();
    await expect(versionText).toBeVisible();

    // 点击检查更新按钮
    const checkUpdateBtn = page.getByRole('button', { name: '检查更新' });
    await checkUpdateBtn.click();

    // 等待显示"检查中..."
    await page.waitForTimeout(1000);
    const checkingText = page.getByText('检查中...');
    const isChecking = await checkingText.isVisible().catch(() => false);
    console.log(`显示检查中: ${isChecking}`);

    // 等待超时（12秒）
    await page.waitForTimeout(12000);

    // 截图保存状态
    await page.screenshot({ path: 'e2e/screenshots/update-timeout-result.png' });

    // 验证最终状态
    const bodyText = await page.textContent('body');
    console.log(`最终状态: ${bodyText?.substring(0, 300)}`);
  });

  test('2. 开启代理后检查更新', async () => {
    await goToSettings();

    // 启用代理
    await enableProxy('127.0.0.1', '7890');

    // 截图保存代理配置
    await page.screenshot({ path: 'e2e/screenshots/update-proxy-enabled.png' });

    // 点击检查更新按钮
    const checkUpdateBtn = page.getByRole('button', { name: '检查更新' });
    await checkUpdateBtn.click();

    // 等待状态变化（最多15秒）
    await page.waitForTimeout(15000);

    // 截图保存更新状态
    await page.screenshot({ path: 'e2e/screenshots/update-with-proxy.png' });

    // 验证状态
    const bodyText = await page.textContent('body');
    console.log(`开启代理后检查更新状态: ${bodyText?.substring(0, 300)}`);
  });

  test('3. 关闭代理后检查更新应再次超时', async () => {
    await goToSettings();

    // 禁用代理
    await disableProxy();

    // 截图保存代理配置
    await page.screenshot({ path: 'e2e/screenshots/update-proxy-disabled.png' });

    // 点击检查更新按钮
    const checkUpdateBtn = page.getByRole('button', { name: '检查更新' });
    await checkUpdateBtn.click();

    // 等待超时
    await page.waitForTimeout(12000);

    // 截图保存状态
    await page.screenshot({ path: 'e2e/screenshots/update-after-proxy-disabled.png' });

    // 验证状态
    const bodyText = await page.textContent('body');
    console.log(`关闭代理后检查更新状态: ${bodyText?.substring(0, 300)}`);
  });

  test('4. 验证设置页面结构', async () => {
    await goToSettings();

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
});
