#!/usr/bin/env node
/**
 * mobile-debug.mjs — MPlayer 真机调试一条龙（usbipd 架构：WSL 原生 adb 单 server）：
 *   重置 adb → 设备/双 transport 检查 → USB reverse → 起 Metro → 冷启 App → logcat
 * 移植自 scripts/mobile-debug.sh（#502）：步骤、文案与退出码一致。
 *
 * 前置：手机已通过 scripts/mobile-device/usb-attach.sh attach 进 WSL。
 * 用法：node scripts/mobile-debug.mjs                     # 完整回路（含冷启）
 *       node scripts/mobile-debug.mjs --no-cold-start    # 不杀 App，直接热拉起
 *       node scripts/mobile-debug.mjs -c                 # 清 Metro 缓存启动
 *
 * 完成标准：logcat 出现 Running "main" + 存量数据迁移完成；
 *          Metro 日志（packages/mobile/.expo/dev/logs/start.log）出现 metro:bundling:done。
 *
 * 与原脚本的唯一差异：仓库根改为**脚本自身位置**推导，不再用 git rev-parse --show-toplevel。
 * 后者在「Windows 建的 worktree + WSL 侧跑」时解析 Windows 绝对路径会失败（mobile-e2e.sh 的
 * 已知环境限制）；mobile-frame-stats.sh 已经这么做。对正常克隆两者等价。
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = path.join(ROOT, 'packages', 'mobile');
const LOG = path.join(MOBILE, '.expo', 'dev', 'logs', 'start.log');
const PID_FILE = path.join(MOBILE, '.expo', 'dev', 'metro.pid');

const PORT = 8081;
const EXP_PKG = 'host.exp.exponent';

const C = { info: '\u001b[1;36m', ok: '\u001b[32m', warn: '\u001b[33m', bad: '\u001b[31m', off: '\u001b[0m' };
const info = (msg) => console.log('\n' + C.info + '▶ ' + msg + C.off);
const ok = (msg) => console.log(C.ok + '✓ ' + msg + C.off);
const warn = (msg) => console.log(C.warn + '! ' + msg + C.off);
const die = (msg) => { console.error(C.bad + '✗ ' + msg + C.off); process.exit(1); };

let NO_COLD = 0;
let CLEAR = 0;
for (const arg of process.argv.slice(2)) {
  if (arg === '--no-cold-start') NO_COLD = 1;
  else if (arg === '-c' || arg === '--clear') CLEAR = 1;
  else { console.error('未知参数：' + arg); process.exit(1); }
}

/** 捕获输出执行；起不来返回 null */
function capture(file, args) {
  const res = spawnSync(file, args, { encoding: 'utf8' });
  if (res.error) return null;
  return { status: res.status ?? 1, stdout: res.stdout ?? '' };
}

/**
 * 跑 adb。三类语义对齐原脚本的 shell：
 *   adb(args)                → 输出直通，失败即退出（对应 set -e）
 *   adb(args, { quiet: true }) → 输出丢弃（对应 >/dev/null）
 *   tolerate: true            → 失败不中止（对应 || true）
 */
function adb(args, { quiet = false, tolerate = false } = {}) {
  const res = spawnSync('adb', args, { stdio: quiet ? 'ignore' : 'inherit' });
  if (res.error) { if (tolerate) return 1; die('adb 起不来：' + res.error.message); }
  const status = res.status ?? 1;
  if (status !== 0 && !tolerate) die('adb ' + args.join(' ') + ' 失败（exit ' + status + '）');
  return status;
}

/** Metro 健康探针：等价于 curl -sf .../status | grep -q packager-status:running */
async function metroRunning() {
  try {
    const res = await fetch('http://127.0.0.1:' + PORT + '/status', { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    return (await res.text()).includes('packager-status:running');
  } catch {
    return false;
  }
}

if (!capture('adb', ['version'])) die('找不到 adb');

info('0. 重置 adb（保证单 server，消灭互踢竞态）');
adb(['kill-server'], { quiet: true, tolerate: true });
adb(['start-server'], { quiet: true });

info('1. 设备检查');
const devLines = ((capture('adb', ['devices'])?.stdout ?? '')).split(/\r?\n/).slice(1).filter((l) => l.trim() !== '');
if (devLines.length === 0) die('无设备。先插线并跑 scripts/mobile-device/usb-attach.sh');
for (const line of devLines) console.log('    ' + line);
const devText = devLines.join('\n');
if (devText.includes('unauthorized')) warn('设备 unauthorized——去手机上点「允许 USB 调试」');
if (devText.includes('offline')) warn('设备 offline——重插线或重跑 usb-attach.sh');

// 双 transport 串线陷阱：无线 + USB 同时挂着时 reverse 静默不通
const wireless = devLines.some((l) => l.trim().split(/\s+/)[1] === 'device' && /^[0-9.]+:[0-9]+$/.test(l.trim().split(/\s+/)[0]));
if (wireless) {
  warn('检测到无线 transport（双 transport 会静默串线），断开无线只留 USB');
  adb(['disconnect'], { quiet: true, tolerate: true });
}

info('2. USB reverse 隧道 tcp:' + PORT);
adb(['reverse', 'tcp:' + PORT, 'tcp:' + PORT]);
ok('手机侧 localhost:' + PORT + ' → 本机 Metro');

info('3. Metro（Expo dev server）');
mkdirSync(path.dirname(LOG), { recursive: true });
if (await metroRunning()) {
  ok('Metro 已在跑，复用之（日志：' + LOG + '）');
} else {
  const expoArgs = ['expo', 'start', '--localhost'];
  if (CLEAR === 1) expoArgs.push('-c');
  writeFileSync(LOG, '');
  const out = openSync(LOG, 'a');
  const [file, args] = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', 'npx ' + expoArgs.join(' ')]]
    : ['npx', expoArgs];
  const child = spawn(file, args, {
    cwd: MOBILE,
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid ?? ''));
  console.log('    后台启动中（日志：' + LOG + '）...');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (await metroRunning()) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (ready) ok('Metro 就绪'); else die('Metro 60s 未就绪，排查：' + LOG);
}

if (NO_COLD === 0) {
  info('4. 冷启 App（force-stop ' + EXP_PKG + '）');
  adb(['shell', 'am', 'force-stop', EXP_PKG], { quiet: true, tolerate: true });
  await new Promise((r) => setTimeout(r, 1000));
} else {
  info('4. 跳过冷启（--no-cold-start）');
}

info('5. 拉起 exp://localhost:' + PORT);
adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://localhost:' + PORT], { quiet: true });
ok('已发起。等 bundle 编译（首次较慢）');

info('6. logcat 监听（Ctrl-C 退出；Metro 继续后台跑）');
console.log('    完成标准：出现 Running "main" 和 存量数据迁移完成');
console.log('');

// exec 语义：把终端交给 logcat，退出码即它的退出码
const logcat = spawn('adb', ['logcat', '-v', 'time', 'ReactNativeJS:V', 'ExpoModulesCore:V', 'ActivityTaskManager:I', '*:S'], { stdio: 'inherit' });
logcat.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
