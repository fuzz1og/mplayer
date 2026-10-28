import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * shots.mjs — 桌面端截图证据的统一驱动（#717）：e2e/shots-*.mjs 原本各抄一份 Electron 启动样板，产物写死在仓库外。
 * 产物落 e2e/artifacts/shots/<name>/（gitignore 内）+ report.json；不进 CI，手工跑（见 e2e/README.md）。
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..');

export const settle = (page, ms = 800) => page.waitForTimeout(ms);

export function shotsDir(name) {
  const dir = path.join(ROOT, 'e2e', 'artifacts', 'shots', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 需要预置目录（本地曲库等）的脚本在 openShots 之前先用它算路径。 */
export const userDataDir = (name) => path.join(shotsDir(name), 'user-data');

/**
 * 起真实 Electron 并返回证据句柄：go(hash) 跳路由、shot(label, probe) 截图 + 打印探针、finish(failures) 落 report.json。
 * keepUserData = true 时不清理 user-data（调用方已预置数据）。
 */
export async function openShots(name, { env: extra = {}, keepUserData = false } = {}) {
  const out = shotsDir(name);
  const userData = userDataDir(name);
  if (!keepUserData) fs.rmSync(userData, { recursive: true, force: true });

  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;

  const app = await electron.launch({
    args: ['--no-sandbox', '--force-device-scale-factor=1', '--user-data-dir=' + userData, '.'],
    cwd: ROOT, env, timeout: 60000,
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 200)));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)); });
  await page.waitForLoadState('domcontentloaded');
  await settle(page, 2500);

  const shots = [];
  const go = async (hash, ms = 1200) => {
    await page.evaluate((next) => { location.hash = next; }, hash);
    await settle(page, ms);
  };
  const shot = async (label, probe) => {
    const info = probe ? await probe(page) : undefined;
    const file = path.join(out, label + '.png');
    await page.screenshot({ path: file });
    shots.push(file);
    console.log('[shot] ' + label + (info === undefined ? '' : ' ' + JSON.stringify(info)));
    return file;
  };
  const finish = async (failures = [], extraReport = {}) => {
    const report = {
      runtime: 'electron (playwright _electron)', out, shots, pageErrors, consoleErrors, failures,
      ...extraReport,
    };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2), 'utf-8');
    console.log('截图 ' + shots.length + ' 张 → ' + out);
    for (const failure of failures) console.log('  ✗ ' + failure);
    if (pageErrors.length > 0) console.log('页面异常 ' + pageErrors.length + ' 条: ' + pageErrors.slice(0, 3).join(' | '));
    if (consoleErrors.length > 0) console.log('控制台错误 ' + consoleErrors.length + ' 条（前 3 条）: ' + consoleErrors.slice(0, 3).join(' | '));
    await app.close();
    if (failures.length > 0) process.exitCode = 1;
    return report;
  };
  return { app, page, out, userData, shots, go, shot, finish, pageErrors, consoleErrors, settle };
}
