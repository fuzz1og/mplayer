#!/usr/bin/env node
/**
 * dev-build.mjs — dev build（非 Expo Go）一条龙：出包 → 装 → reverse → 拉起 → 自检。
 *
 * 本脚本是 `mobile-device-debugging` skill 包的一部分（`scripts/`），只服务它的
 * 「dev build」一节。原先那条链写成裸 bash 躺在 SKILL.md 里，而每一步背后都有一条实测踩过的坑：
 * 命令抄在文档里就会被人手抄错、凭记忆漏掉处置。固定进脚本后坑由代码承担，
 * SKILL.md 只讲「何时用、跑完必须成立什么」。判据在 `./dev-build-rules.mjs`（可被单测直接 import），
 * 本文件只做编排。
 *
 * 脚本固化的五条坑（编号沿用 SKILL.md 的「陷阱速查」）：
 *   1. 架构必须与设备匹配 —— 装错报 `INSTALL_FAILED_NO_MATCHING_ABIS`（真机 arm64-v8a、
 *      雷电模拟器 x86_64）。按设备 `ro.product.cpu.abi` 自动取，不再手填。
 *   2. **不用 `adb install`** —— 实测 80MB 的流式安装能把 adb server 卡到 `adb devices` 都超时；
 *      改走 `adb push` + `adb shell pm install -r`。
 *   3. 从 `/data/local/tmp` 装可能撞 `Failed to restorecon`（`INSTALL_FAILED_MEDIA_UNAVAILABLE`）
 *      → 自动改推 `/sdcard/` 重试一次。
 *   4. 深层 worktree 里构建原生必失败（CMake 对象路径超限）→ 构建前按 android 目录绝对路径
 *      长度告警，并给出「换短路径检出」的处置。
 *   5. **拉起必须用显式组件** —— scheme 与 release 共用，直接发 `mplayer://` 会弹选择器。
 *
 * 用法（仓库根执行）：
 *   node .agents/skills/mobile-device-debugging/scripts/dev-build.mjs              # 完整回路
 *   …/dev-build.mjs --dry-run      # 只打印计划，不碰 gradle / adb
 *   …/dev-build.mjs --skip-build   # 跳过 gradle（APK 已存在时）
 *   …/dev-build.mjs --abi x86_64   # 显式指定架构（默认探测设备）
 *   …/dev-build.mjs --serial <s>   # 多设备时指定
 *
 * 环境变量：
 *   MOBILE_ADB=<path>    指定 adb。本机常见「雷电自带 adb 与 scoop 的抢 5037」，
 *                        钉死用哪一份就是那条坑的处置（默认 PATH 上的 `adb`）。
 *   MOBILE_GRADLE=<path> 指定 gradle（默认 android 目录下的 gradlew）。
 *
 * 完成标准：末尾三条 `dumpsys` 自检全 PASS（说明真的在 dev build 语义下，而不是 Expo Go）。
 * 只能人工做的两步（脚本无法代劳，首次启动必做）：点过 dev-client 引导页、放行
 * `POST_NOTIFICATIONS` —— 否则 FGS 通知发不出来。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEV_BUILD,
  gradleExecutable,
  parseAbi,
  needsSdcardFallback,
  devClientUri,
  shortPathWarning,
} from './dev-build-rules.mjs';

/** 仓库根：本文件在 `<root>/.agents/skills/mobile-device-debugging/scripts/` 下，向上 4 层 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const ANDROID_DIR = path.join(ROOT, 'packages', 'mobile', 'android');
export const APK_PATH = path.join(ANDROID_DIR, ...DEV_BUILD.apkRelPath);

const C = { info: '\u001b[1;36m', ok: '\u001b[32m', warn: '\u001b[33m', bad: '\u001b[31m', off: '\u001b[0m' };
const info = (msg) => console.log('\n' + C.info + '▶ ' + msg + C.off);
const ok = (msg) => console.log(C.ok + '✓ ' + msg + C.off);
const warn = (msg) => console.log(C.warn + '! ' + msg + C.off);
const die = (msg) => { console.error(C.bad + '✗ ' + msg + C.off); process.exit(1); };

// ── 参数 ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { dryRun: false, skipBuild: false, abi: null, serial: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--skip-build') opts.skipBuild = true;
    else if (arg === '--abi') { opts.abi = argv[++i] ?? null; if (!opts.abi) die('--abi 需要一个值'); }
    else if (arg === '--serial') { opts.serial = argv[++i] ?? null; if (!opts.serial) die('--serial 需要一个值'); }
    else if (arg === '-h' || arg === '--help') { printUsage(); process.exit(0); }
    else die(`未知参数：${arg}（--help 看用法）`);
  }
  return opts;
}

function printUsage() {
  console.log(`dev build 一条龙：出包 → 装 → reverse → 拉起 → 自检

  node .agents/skills/mobile-device-debugging/scripts/dev-build.mjs [选项]

  --dry-run     只打印将执行的计划（含短路径告警），不碰 gradle / adb
  --skip-build  跳过 gradle 出包（APK 必须已存在）
  --abi <abi>   显式指定架构（默认按设备 ro.product.cpu.abi 探测）
  --serial <s>  多设备时指定目标
  -h, --help    显示本说明

环境变量：MOBILE_ADB / MOBILE_GRADLE 可钉死可执行文件路径（见文件头注释）。`);
}

// ── 执行 ─────────────────────────────────────────────────────────

const opts = parseArgs(process.argv.slice(2));
const gradle = process.env.MOBILE_GRADLE || path.join(ANDROID_DIR, gradleExecutable());
const ADB = process.env.MOBILE_ADB || 'adb';

/** 跑一个命令；返回 { status, stdout, stderr }，起不来时 status = -1 */
function run(file, args, { inherit = false, cwd = ROOT } = {}) {
  const res = spawnSync(file, args, { encoding: 'utf8', cwd, stdio: inherit ? 'inherit' : 'pipe' });
  if (res.error) return { status: -1, stdout: '', stderr: String(res.error.message ?? res.error) };
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function adb(args, { tolerate = false } = {}) {
  const full = opts.serial ? ['-s', opts.serial, ...args] : args;
  const res = run(ADB, full);
  if (!tolerate && res.status !== 0) {
    die(`adb ${full.join(' ')} 失败（${res.status}）\n${res.stderr.trim()}`
      + (/(device|devices)/.test(res.stderr) ? '\n设备不在位？先跑 npm run mobile:usb-attach 或确认模拟器已启动。' : ''));
  }
  return res;
}

const shortPath = shortPathWarning(ANDROID_DIR);

if (opts.dryRun) {
  console.log('dev build 计划（--dry-run，未执行任何命令）');
  console.log(`  gradle      : ${gradle} assembleDebug -PreactNativeArchitectures=<abi>`);
  console.log(`  android-dir : ${ANDROID_DIR}（${ANDROID_DIR.length} 字符）`);
  console.log(`  abi         : ${opts.abi ?? '（按设备 ro.product.cpu.abi 探测）'}`);
  console.log(`  apk         : ${APK_PATH}`);
  console.log(`  install     : adb push → ${DEV_BUILD.remoteTmp} → adb shell pm install -r`);
  console.log(`  fallback    : restorecon / INSTALL_FAILED_MEDIA_UNAVAILABLE → 改推 ${DEV_BUILD.remoteSd} 重试一次`);
  console.log(`  launch      : adb shell am start -n ${DEV_BUILD.launchComponent} -a android.intent.action.VIEW -d '${devClientUri()}'`);
  if (shortPath) warn(shortPath);
  process.exit(0);
}

if (shortPath) warn(shortPath);

// 1. 设备与架构（坑 1）
let abi = opts.abi;
if (!abi) {
  info('1. 探测设备架构');
  const res = adb(['shell', 'getprop', 'ro.product.cpu.abi']);
  abi = parseAbi(res.stdout);
  if (!abi) die(`读不到设备 ABI（getprop 返回 "${res.stdout.trim()}"）。设备不在位？或用 --abi 显式指定。`);
  ok(`设备 ABI = ${abi}`);
}

// 2. 出包（坑 4 的告警已在上面给过）
if (opts.skipBuild) {
  info('2. 跳过出包（--skip-build）');
  if (!fs.existsSync(APK_PATH)) die(`APK 不存在：${APK_PATH}（--skip-build 要求它已出好）`);
  ok('APK 在位');
} else {
  info(`2. 出包（assembleDebug，架构 ${abi}）`);
  // 绝对路径 + 显式 cwd：裸 `gradlew.bat` 在 Windows 上不保证从 cwd 解析
  const res = run(gradle, ['assembleDebug', `-PreactNativeArchitectures=${abi}`], { inherit: true, cwd: ANDROID_DIR });
  if (res.status !== 0) {
    die(`gradle 出包失败（${res.status}）。`
      + (shortPath ? '\n先按上面的短路径告警换检出构建 —— 深层 worktree 里原生构建必失败。' : ''));
  }
  if (!fs.existsSync(APK_PATH)) die(`出包结束但找不到 APK：${APK_PATH}`);
  ok('APK 就绪');
}

// 3. 装：push + pm install，不用 adb install（坑 2）；restorecon 失败改推 /sdcard/（坑 3）
info('3. 安装');
function pushAndInstall(remote) {
  const pushed = adb(['push', APK_PATH, remote]);
  if (pushed.status !== 0) return { ok: false, output: pushed.stderr };
  const installed = adb(['shell', 'pm', 'install', '-r', remote], { tolerate: true });
  return { ok: installed.status === 0, output: installed.stdout + installed.stderr };
}

let install = pushAndInstall(DEV_BUILD.remoteTmp);
if (!install.ok && needsSdcardFallback(install.output)) {
  warn('从 /data/local/tmp 装撞上 restorecon / INSTALL_FAILED_MEDIA_UNAVAILABLE → 改推 /sdcard/ 重试');
  install = pushAndInstall(DEV_BUILD.remoteSd);
}
if (!install.ok) die(`安装失败：\n${install.output.trim()}`);
ok('已安装（未走 adb install —— 那条路会卡死 adb server）');

// 4. reverse（坑 5 的前置：不做 reverse 拉不到 bundle）
info('4. reverse 隧道');
adb(['reverse', `tcp:${DEV_BUILD.port}`, `tcp:${DEV_BUILD.port}`], { tolerate: true });
ok(`tcp:${DEV_BUILD.port} → tcp:${DEV_BUILD.port}`);

// 5. 拉起：显式组件（坑 5）
info('5. 拉起 dev build（显式组件，不用裸 scheme）');
adb(['shell', 'am', 'start', '-n', DEV_BUILD.launchComponent, '-a', 'android.intent.action.VIEW', '-d', devClientUri()]);
ok('已发送启动 Intent');

// 6. 自检：三条都成立才算真的在 dev build 语义下（Expo Go 下三条全不成立）
info('6. 自检（不成立说明还在 Expo Go 语义下）');
const checks = [
  ['FGS 前台服务', ['shell', 'dumpsys', 'activity', 'services', DEV_BUILD.appId], /AudioControlsService[\s\S]*isForeground=true/],
  ['media3 媒体会话', ['shell', 'dumpsys', 'media_session'], /Media button session is com\.mplayer\.mobile\.dev/],
  ['播放通知', ['shell', 'dumpsys', 'notification', '--noredact'], /music-playback/],
];
let failed = 0;
for (const [label, args, pattern] of checks) {
  const res = adb(args, { tolerate: true });
  if (pattern.test(res.stdout)) ok(`${label}：PASS`);
  else { warn(`${label}：未命中（还没开始播放？或跑的不是 dev build）`); failed++; }
}

if (failed > 0) {
  console.log(`\n${C.warn}! ${failed} 条自检未命中${C.off}`);
  console.log('  未开始播放时后两条本就不会出现 —— 先播一首再复看。');
  console.log('  若三条全不成立：确认装的是 dev build（包名 .dev），且首次启动已点过');
  console.log('  dev-client 引导页与 POST_NOTIFICATIONS 权限框（这两步只能人工做）。');
} else {
  console.log(`\n${C.ok}✓ dev build 回路完成，三条自检全 PASS${C.off}`);
}
process.exit(failed > 0 ? 1 : 0);
