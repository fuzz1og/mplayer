#!/usr/bin/env node
/**
 * usb-attach.mjs — 把 Android 真机从 Windows 侧 attach 进 WSL（usbipd-win 架构）。
 * 移植自 scripts/mobile-device/usb-attach.sh（#502）：流程、文案与退出码一致。
 *
 * 背景：WSL 里只允许存在一个 adb server（原生 Linux 版）。手机插在 Windows 上，
 * 需要 usbipd 把这个 USB 设备透传进 WSL 内核，WSL 的原生 adb 才能看到它。
 * 每次重新插拔都要重跑本脚本（bind 只需每台设备做一次，会弹一次 UAC）。
 *
 * 用法：node scripts/mobile-device/usb-attach.mjs
 * 之后跑 node scripts/mobile-debug.mjs 进入调试回路。
 *
 * 注意：路径按 WSL 约定硬编码（/mnt/c/...），因此**只在 WSL 里有意义** —— 这是原脚本的语义，
 * 移植不改。Windows 原生 adb 回路（mobile-device-debugging skill 第二条）不走本脚本。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const USBIPD_WIN = '/mnt/c/Program Files/usbipd-win/usbipd.exe';
const USBIPD_WINPATH = 'C:\\Program Files\\usbipd-win\\usbipd.exe';
const PS = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

const ESC = String.fromCharCode(27);
const C = { info: ESC + '[1;36m', ok: ESC + '[32m', warn: ESC + '[33m', bad: ESC + '[31m', off: ESC + '[0m' };
const info = (msg) => console.log(C.info + '▶ ' + msg + C.off);
const ok = (msg) => console.log(C.ok + '✓ ' + msg + C.off);
const warn = (msg) => console.log(C.warn + '! ' + msg + C.off);
const die = (msg) => { console.error(C.bad + '✗ ' + msg + C.off); process.exit(1); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const which = (cmd) => spawnSync('command', ['-v', cmd], { shell: true, stdio: 'ignore' }).status === 0;

if (!which('adb')) die('找不到 adb（应装在 ~/.local/opt/platform-tools，软链 ~/.local/bin/adb）');
if (!existsSync(USBIPD_WIN)) die('Windows 未安装 usbipd-win：winget install dorssel.usbipd-win');

// ---- 找候选设备（描述含 android，或命中常见厂商 VID）----
const KNOWN_VID_RE = /^(18d1|04e8|2717|12d1|22d9|2d95|2a70|22b8|0fce|0bb4|1004|19d2|2a45):/;
const ROW_RE = /^\s*[0-9]+-[0-9]+(\.[0-9]+)*\s/;

info('扫描 Windows 侧 USB 设备（usbipd list）...');
const listOut = spawnSync(USBIPD_WIN, ['list'], { encoding: 'utf8' }).stdout ?? '';
const ROWS = listOut.split(/\r?\n/).filter((l) => ROW_RE.test(l));

if (ROWS.length === 0) die('Windows 没看到任何 USB 设备——请插上数据线、手机选「文件传输(MTP)」模式并打开 USB 调试');

const CANDS = [];
for (const row of ROWS) {
  const cells = row.trim().split(/\s+/);
  const busid = cells[0];
  const vidpid = cells[1] ?? '';
  if (/android/i.test(row) || KNOWN_VID_RE.test(vidpid)) {
    // 排除已经 Attached 的
    if (/\sAttached/i.test(row)) {
      ok(busid + ' (' + vidpid + ') 已经 attach 进 WSL');
    } else {
      CANDS.push(busid);
    }
  }
}

if (CANDS.length === 0) die('没找到可 attach 的 Android 设备。检查：数据线 / 手机 USB 模式 / USB 调试开关');

for (const busid of CANDS) {
  let row = '';
  for (const r of ROWS) {
    if (new RegExp('\\b' + busid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(r)) { row = r; break; }
  }

  // ---- 未绑定 → 提权 bind（每台设备一次，会弹 UAC）----
  if (/\sNot\s+shared/i.test(row)) {
    info(busid + ' 尚未 bind，正在请求管理员权限（请在 UAC 弹窗点「是」）...');
    const psCmd = "Start-Process -FilePath '" + USBIPD_WINPATH + "' -ArgumentList 'bind','--busid','" + busid + "' -Verb RunAs -Wait";
    const bind = spawnSync(PS, ['-NoProfile', '-Command', psCmd], { stdio: 'inherit' });
    if (bind.error || bind.status !== 0) die('bind 失败：UAC 被取消或策略拒绝。可手动在管理员终端跑：usbipd bind --busid ' + busid);
    await sleep(1000);
  }

  // ---- attach 进 WSL ----
  info('attach ' + busid + ' 进 WSL ...');
  let attached = 0;
  for (let i = 1; i <= 3; i++) {
    const res = spawnSync(USBIPD_WIN, ['attach', '--wsl', '--busid', busid], { encoding: 'utf8' });
    const out = String(res.stdout ?? '') + String(res.stderr ?? '');
    if (!res.error && res.status === 0) { attached = 1; console.log(out.trimEnd()); break; }
    console.log(out.trimEnd());
    if (/busy/i.test(out)) {
      die('Windows 正占用设备（通常是手机「文件传输/MTP」模式）。修法：手机下拉通知，把 USB 用途切成「仅充电」（USB 调试保持开），然后重跑本脚本');
    }
    warn('第 ' + i + ' 次 attach 失败，1s 后重试...');
    await sleep(1000);
  }
  if (attached !== 1) die('attach 失败。试试：手机切换 USB 模式后重插，再跑一次本脚本');
}

await sleep(2000);

// ---- 验证原生 adb 可见 ----
info('验证 WSL 原生 adb ...');
const devOut = spawnSync('adb', ['devices'], { encoding: 'utf8' }).stdout ?? '';
const SERIALS = devOut
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.trim().split(/\s+/))
  .filter((c) => c.length >= 2 && c[0] !== '')
  .map((c) => c[0] + '\t' + c[1])
  .join('\n');
if (SERIALS === '') die('usbipd 显示已 attach，但 adb 看不到设备。等 2 秒重跑本脚本，或 adb kill-server 后重试');
ok('adb 设备列表：');
for (const line of SERIALS.split('\n')) console.log('    ' + line);
if (/unauthorized/.test(SERIALS)) warn('设备未授权——请在手机上点「允许 USB 调试」弹窗');
console.log('');
console.log('下一步：node scripts/mobile-debug.mjs');
