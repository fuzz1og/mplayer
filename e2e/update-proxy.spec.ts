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

  // 捕获 Electron 主进程控制台输出
  electronApp.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'error') {
      console.log(`[Electron ${msg.type()}]:`, msg.text());
    }
  });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);
});

test.afterAll(async () => {
  if (electronApp) {
    try { electronApp.process()?.kill('SIGKILL'); } catch {}
  }
});

async function goToSettings() {
  await page.getByRole('complementary').getByText('设置').click();
  await page.waitForTimeout(1000);
}

async function enableProxy(host: string = '127.0.0.1', port: string = '7897') {
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

async function checkUpdate(): Promise<{ isChecking: boolean; hasError: boolean; hasSuccess: boolean }> {
  const checkUpdateBtn = page.getByRole('button', { name: '检查更新' });
  await checkUpdateBtn.click();
  // 等待超过 app 内 10s 超时，确保检查完成
  await page.waitForTimeout(15000);

  const bodyText = await page.textContent('body') || '';
  const isChecking = bodyText.includes('检查中...');
  const hasError = bodyText.includes('检查更新失败') || bodyText.includes('超时');
  const hasSuccess = bodyText.includes('已是最新版本') || bodyText.includes('发现新版本');
  return { isChecking, hasError, hasSuccess };
}

test.describe('更新服务代理测试', () => {
  test('1. 默认无代理时检查更新应完成', async () => {
    await goToSettings();

    // 确认代理默认关闭
    const enableProxyLabel = page.locator('text=启用代理').locator('..');
    const proxySwitch = enableProxyLabel.locator('input[type="checkbox"]');
    const isChecked = await proxySwitch.isChecked();
    expect(isChecked).toBe(false);

    const status = await checkUpdate();
    console.log(`1. 默认无代理状态:`, status);
    // 只验证检查完成，不假设成功或失败（环境可能直连也可能被墙）
    expect(status.isChecking).toBe(false);
  });

  test('2. 开启代理后检查更新应成功', async () => {
    await goToSettings();
    await enableProxy('127.0.0.1', '7897');
    await page.screenshot({ path: 'e2e/screenshots/update-proxy-saved.png' });

    const status = await checkUpdate();
    console.log(`2. 开启代理状态:`, status);

    expect(status.hasSuccess).toBe(true);
    expect(status.isChecking).toBe(false);
  });

  test('3. 关闭代理后检查更新应完成', async () => {
    await goToSettings();
    await disableProxy();
    await page.screenshot({ path: 'e2e/screenshots/update-proxy-disabled.png' });

    const status = await checkUpdate();
    console.log(`3. 关闭代理后状态:`, status);
    // 同测试 1，只验证完成不假设成败
    expect(status.isChecking).toBe(false);
  });
});
