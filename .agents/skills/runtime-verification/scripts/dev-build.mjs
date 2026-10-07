#!/usr/bin/env node
/**
 * dev-build.mjs — dev build 一条龙：出包 → 装 → 身份锚 → reverse → 拉起 → 启动期自检
 *                 （可选：`--after-play` 播放后三项目、`--dex <symbol>` 扫设备上的 dex）。
 *
 * 本脚本是 `runtime-verification` skill 包的一部分（`scripts/`），只服务它的「移动端 dev build」一节：
 * `SKILL.md` 讲「何时用、跑完必须成立什么」，坑由代码承担。判据全在 `./dev-build-rules.mjs`
 * （纯函数、可被 `node --test` 直接 import），本文件只做编排。
 *
 * 从 #582（`mobile-dev-build`，已 closed）搬过来时按评审逐条改掉的东西：
 *   1. `.bat`/`.cmd` 经 `cmd.exe /d /s /c`（原来直接 spawn `gradlew.bat`，Node ≥18.20 起必然 `EINVAL`）。
 *      决策在 rules 的 `spawnPlan()` 里，可单测；`EINVAL` 也不再被念成「出包失败」。
 *   2. 每条 adb 调用带超时（默认 30s，`MOBILE_ADB_TIMEOUT_MS`），卡死按「两份 adb 抢 5037」给处置。
 *   3. 自检拆相位：**启动期**（身份锚 + logcat `Running "main"`）决定退出码；FGS / media3 / 播放通知
 *      结构上要求「正在播放」，只在显式 `--after-play` 时才算 —— 冷跑不再假失败。
 *   4. `adb reverse` 不再吞掉失败：查 status 且用 `reverse --list` 复核，不通过就报双 transport 处置。
 *   5. FGS 判定限定在**一个** ServiceRecord 块内（原来全文扫，会跨服务假 PASS）；
 *      服务名也换成真身 `expo.modules.mplayerplayer.PlayerService`（原 `AudioControlsService` 已移除）。
 *   6. 短路径告警的处置补上第二层坑（短路径杂牌检出 → 启动崩 ClassNotFoundException）与真正解法
 *      （在主克隆里建临时分支构建）。
 *   7. 新增身份锚：`dumpsys package` 的 `lastUpdateTime` / `versionName` 对照设备时钟，
 *      以及 opt-in 的 `--dex <symbol>`（拉回设备 `base.apk`、解压后扫 dex/JS bundle 里的符号）。
 *   8. 结尾清理推上去的 APK（`--keep` 可保留）。
 *   9. `ROOT` 的「向上 4 层」写明耦合（见下面 ROOT 处）。
 *
 * 用法（仓库根执行）：
 *   node .agents/skills/runtime-verification/scripts/dev-build.mjs              # 完整回路
 *   …/dev-build.mjs --dry-run            # 只打印计划（含 cmd.exe 包装），不碰 gradle / adb
 *   …/dev-build.mjs --skip-build         # 跳过 gradle（APK 已存在时）
 *   …/dev-build.mjs --abi x86_64         # 显式指定架构（默认探测设备）
 *   …/dev-build.mjs --serial <s>         # 多设备时指定目标
 *   …/dev-build.mjs --dex <symbol>       # 身份锚加强：设备上的 base.apk 必须含这个符号
 *   …/dev-build.mjs --after-play         # 额外等「人去播一首」，验 FGS / 媒体会话 / 播放通知
 *   …/dev-build.mjs --keep               # 不清理设备上推上去的 APK
 *
 * 环境变量：
 *   MOBILE_ADB=<path>            钉死用哪份 adb（本机常见「雷电自带 adb 与 scoop 的抢 5037」）
 *   MOBILE_GRADLE=<path>         钉死 gradle（默认 android 目录下的 gradlew / gradlew.bat）
 *   ↑ 这两个变量**只钉死二进制路径**（多份 adb 抢 5037 时用来选定用哪份），
 *     **不是** 5037 争抢的自动处置 —— 脚本不检测争抢、不重试。争抢的诊断与处置在
 *     `adbHangHint()` 的超时文案里（Get-NetTCPConnection → 认 pid → 只留一份 → 重建 reverse）。
 *   MOBILE_ADB_TIMEOUT_MS        每条 adb 调用的超时（默认 30000）
 *   MOBILE_LAUNCH_TIMEOUT_MS     拉起后等 JS bundle 的预算（默认 90000）
 *   MOBILE_POSTPLAY_TIMEOUT_MS   --after-play 等「去播一首」的预算（默认 120000）
 *
 * 完成标准（退出码 0 的充要条件）：身份锚成立 + logcat 出现 `Running "main"` 且无
 * `undefined is not a function`；给了 `--after-play` / `--dex` 时，那两项也算数。
 * 只能人工做的两步（脚本无法代劳，首次启动必做）：点过 dev-client 引导页、放行
 * `POST_NOTIFICATIONS` —— 否则 FGS 通知发不出来。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADB_TIMEOUT_ENV,
  DEV_BUILD,
  LAUNCH_TIMEOUT_ENV,
  POSTPLAY_TIMEOUT_ENV,
  adbBinaryFor,
  adbHangHint,
  adbTimeoutMs,
  checkPlan,
  classifySpawnFailure,
  decidesExitCode,
  deviceClockMs,
  devClientUri,
  findSymbolInApk,
  gradleArgs,
  gradleBinaryFor,
  identityAnchor,
  isServiceForeground,
  launchTimeoutMs,
  logcatVerdict,
  needsSdcardFallback,
  parseAbi,
  parsePackageDump,
  parsePackagePath,
  postPlayTimeoutMs,
  processAliveVerdict,
  quoteForCmd,
  reverseFailureHint,
  reverseListed,
  serviceBlock,
  shortPathWarning,
  spawnPlan,
} from './dev-build-rules.mjs';

/**
 * 仓库根：本文件在 `<root>/.agents/skills/runtime-verification/scripts/` 下，向上**固定 4 层**。
 * 「4」与 skill 包的位置是一对耦合：skill 包一挪（改到 `.claude/skills/`、摊平成 `skills/<name>/`、
 * 或目录名变化后位置不同），这里必须同步改。耦合断掉的症状不是「根算错」，而是最后报
 * 「APK 不存在：…\packages\mobile\android\app\build\…」—— 看着像构建失败，其实是根错了一层。
 */
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
  const opts = { dryRun: false, skipBuild: false, abi: null, serial: null, afterPlay: false, keep: false, dex: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--skip-build') opts.skipBuild = true;
    else if (arg === '--after-play') opts.afterPlay = true;
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--abi') { opts.abi = argv[++i] ?? null; if (!opts.abi) die('--abi 需要一个值'); }
    else if (arg === '--serial') { opts.serial = argv[++i] ?? null; if (!opts.serial) die('--serial 需要一个值'); }
    else if (arg === '--dex') { opts.dex = argv[++i] ?? null; if (!opts.dex) die('--dex 需要一个符号名'); }
    else if (arg === '-h' || arg === '--help') { printUsage(); process.exit(0); }
    else die(`未知参数：${arg}（--help 看用法）`);
  }
  return opts;
}

function printUsage() {
  console.log(`dev build 一条龙：出包 → 装 → 身份锚 → reverse → 拉起 → 启动期自检

  node .agents/skills/runtime-verification/scripts/dev-build.mjs [选项]

  --dry-run        只打印将执行的计划（含 Windows 上的 cmd.exe 包装），不碰 gradle / adb
  --skip-build     跳过 gradle 出包（APK 必须已存在）
  --abi <abi>      显式指定架构（默认按设备 ro.product.cpu.abi 探测）
  --serial <s>     多设备时指定目标
  --dex <symbol>   身份锚加强：把设备上的 base.apk 拉回来，扫 dex 里有没有这个符号
  --after-play     额外等「人去播一首」，验 FGS / media3 会话 / 播放通知（默认不跑）
  --keep           不清理设备上推上去的 APK
  -h, --help       显示本说明

退出码：启动期自检（身份锚 + logcat Running "main"）全 PASS 才是 0；
播放后三项目只在 --after-play 下计入，--dex 给了就计入。

环境变量：MOBILE_ADB / MOBILE_GRADLE / MOBILE_ADB_TIMEOUT_MS /
          MOBILE_LAUNCH_TIMEOUT_MS / MOBILE_POSTPLAY_TIMEOUT_MS（见文件头注释）。`);
}

// ── 执行 ─────────────────────────────────────────────────────────

const opts = parseArgs(process.argv.slice(2));
// 这两个 env 只是「路径钉死」；争抢的检测/重试不在这里（见 rules 的 adbBinaryFor 注释与 adbHangHint）。
const gradle = gradleBinaryFor(process.env, ANDROID_DIR);
const ADB = adbBinaryFor(process.env);
const ADB_TIMEOUT = adbTimeoutMs(process.env[ADB_TIMEOUT_ENV]);
const LAUNCH_TIMEOUT = launchTimeoutMs(process.env[LAUNCH_TIMEOUT_ENV]);
const POSTPLAY_TIMEOUT = postPlayTimeoutMs(process.env[POSTPLAY_TIMEOUT_ENV]);
const POLL_MS = 3_000;
/** 计划里每条 adb 的 argv（--serial 已在最前） */
const adbArgv = (args) => (opts.serial ? ['-s', opts.serial, ...args] : [...args]);
/** 展示用：verbatim 的计划已经是命令行原文，不能再补引号 */
function planText(file, args) {
  const plan = spawnPlan(file, args, process.platform);
  if (!plan.verbatim) return [plan.command, ...plan.args].map(quoteForCmd).join(' ');
  return [plan.command, ...plan.args].join(' ');
}
const adbText = (args) => planText(ADB, adbArgv(args));

/** 同步睡一下：脚本是单线程顺序编排，用 Atomics.wait 而不是忙等。 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 跑一个命令；返回 { status, stdout, stderr, failure }，failure 见 classifySpawnFailure。 */
function run(file, args, { inherit = false, cwd = ROOT, timeout = null } = {}) {
  const plan = spawnPlan(file, args, process.platform);
  const res = spawnSync(plan.command, plan.args, {
    encoding: 'utf8',
    cwd,
    stdio: inherit ? 'inherit' : 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    // 必须原样透传：libuv 对 cmd.exe 有专门的引号转义，会改坏 spawnPlan 拼好的引号（见 rules 注释）
    windowsVerbatimArguments: plan.verbatim,
    ...(timeout ? { timeout } : {}),
  });
  const failure = classifySpawnFailure(res);
  return { status: res.status ?? (failure ? -1 : 1), stdout: res.stdout ?? '', stderr: res.stderr ?? '', failure };
}

function adb(args, { tolerate = false, timeout = ADB_TIMEOUT } = {}) {
  const full = adbArgv(args);
  const res = run(ADB, full, { timeout });
  // 卡死与「起不来」都不是可容忍失败：藏起来只会变成后面某一步的假结论，所以 tolerate 也不放行
  if (res.failure?.kind === 'timeout') {
    die(`adb ${full.join(' ')} 卡住 ${timeout}ms 没返回。\n${adbHangHint(timeout)}`);
  }
  if (res.failure?.kind === 'spawn') {
    die(`adb 起不来（${res.failure.code} ${res.failure.message}）。\n确认 MOBILE_ADB / PATH 上的 adb 可执行。`);
  }
  if (!tolerate && res.status !== 0) {
    die(`adb ${full.join(' ')} 失败（${res.status}）\n${res.stderr.trim()}`
      + (/(device|devices)/.test(res.stderr) ? '\n设备不在位？先跑 npm run mobile:usb-attach 或确认模拟器已启动。' : ''));
  }
  return res;
}

// ── 清理（缺陷 8） ───────────────────────────────────────────────
// 成功路径在收尾显式调一次（输出顺序才对）；同时挂在 exit 钩子上兜底 —— die() 直接
// process.exit，只写在流程末尾的清理在失败路径上根本不会执行。
// 失败时也清 —— 推上去的就是本地那份 APK 的同一批字节，诊断力在本地 APK + logcat 上，
// 设备上留一份不增加信息（真要留：--keep）。
let pushedRemote = null;
let pulledApk = null;
let cleaned = false;
function cleanupDevice() {
  if (cleaned || opts.dryRun) return;
  cleaned = true;
  if (pulledApk && fs.existsSync(pulledApk)) {
    try { fs.unlinkSync(pulledApk); } catch { /* 临时文件，删不掉就算了 */ }
  }
  if (!pushedRemote || opts.keep) return;
  const res = run(ADB, adbArgv(['shell', 'rm', '-f', pushedRemote]), { timeout: 10_000 });
  if (res.status === 0) console.log(C.ok + `✓ 已清理设备上的 ${pushedRemote}（--keep 可保留）` + C.off);
  else console.log(C.warn + `! 没能清理设备上的 ${pushedRemote}（不影响结论，可手动 adb shell rm -f）` + C.off);
}
process.on('exit', cleanupDevice);

const shortPath = shortPathWarning(ANDROID_DIR);

// ── --dry-run：只打印计划（缺陷 1 的可见性） ──────────────────────

if (opts.dryRun) {
  console.log('dev build 计划（--dry-run，未执行任何命令；下面的 argv 就是将要 spawn 的原文）');
  console.log(`  root         : ${ROOT}`);
  console.log(`  android-dir  : ${ANDROID_DIR}（${ANDROID_DIR.length} 字符）`);
  console.log(`  abi          : ${opts.abi ?? '（按设备 ro.product.cpu.abi 探测）'}`);
  console.log(`  apk          : ${APK_PATH}`);
  console.log(`  timeouts     : adb ${ADB_TIMEOUT}ms / launch ${LAUNCH_TIMEOUT}ms / after-play ${POSTPLAY_TIMEOUT}ms`);
  console.log('  1 probe-abi  : ' + adbText(['shell', 'getprop', 'ro.product.cpu.abi']));
  // 架构占位用真 abi 的样例值（`<abi>` 里的尖括号在 cmd 里是重定向符，会被 quoteForCmd 引起来，反而看不清形状）
  console.log(`  2 build      : ${planText(gradle, gradleArgs(DEV_BUILD.buildTask, opts.abi ?? 'arm64-v8a'))}`
    + `   (cwd=${ANDROID_DIR}${opts.skipBuild ? '；--skip-build 已跳过' : ''}`
    + `${opts.abi ? '' : '；abi 示例值，实际按第 1 步探测的设备 ABI'}）`);
  console.log(`  3 dev-clock  : ${adbText(['shell', 'date', '+%s'])}   （安装前基线，用于身份锚）`);
  console.log(`  4 push       : ${adbText(['push', APK_PATH, DEV_BUILD.remoteTmp])}`);
  console.log(`  4 install    : ${adbText(['shell', 'pm', 'install', '-r', DEV_BUILD.remoteTmp])}`);
  console.log(`  4 fallback   : restorecon / INSTALL_FAILED_MEDIA_UNAVAILABLE → ${DEV_BUILD.remoteSd} 重推一次`);
  console.log(`  5 identity   : ${adbText(['shell', 'dumpsys', 'package', DEV_BUILD.appId])}`
    + '   （lastUpdateTime 不得早于第 3 步的设备时钟）');
  console.log(`  5b dex       : ${opts.dex
    ? `${adbText(['shell', 'pm', 'path', DEV_BUILD.appId])} → ${adbText(['pull', '<base.apk>', '<tmp>'])} → 解压后扫符号「${opts.dex}」`
    : '（未启用；--dex <symbol> 才拉回 base.apk 扫 dex）'}`);
  console.log(`  6 reverse    : ${adbText(['reverse', `tcp:${DEV_BUILD.port}`, `tcp:${DEV_BUILD.port}`])}`
    + ` → ${adbText(['reverse', '--list'])}（复核，不在列表里就报处置）`);
  console.log(`  7 launch     : ${adbText(['logcat', '-c'])} 然后 ${adbText(['shell', 'am', 'start', '-n', DEV_BUILD.launchComponent, '-a', 'android.intent.action.VIEW', '-d', devClientUri()])}`);
  console.log(`  8 checklist  : ${adbText(['logcat', '-d', '-v', 'brief'])} + ${adbText(['shell', 'pidof', DEV_BUILD.appId])}`
    + `（轮询到 ${LAUNCH_TIMEOUT}ms）→ 身份锚 + Running "main" 决定退出码`);
  console.log(`  9 after-play : ${opts.afterPlay
    ? '已启用：提示「现在去播一首」并轮询 FGS / media_session / notification'
    : '（未启用；FGS / media_session / notification 结构上要正在播放，默认不跑、不计退出码）'}`);
  console.log(`  10 cleanup   : ${opts.keep ? '（--keep：保留）' : adbText(['shell', 'rm', '-f', DEV_BUILD.remoteTmp])}`);
  if (shortPath) warn(shortPath);
  process.exit(0);
}

if (shortPath) warn(shortPath);

// 自检计划（相位划分的唯一出处是 rules 的 checkPlan()）
const plan = checkPlan();

/** 评估一条自检。ctx 由各相位填（anchor / logcat / pidof / out）。 */
function evaluate(check, ctx) {
  switch (check.kind) {
    case 'identity':
      return { ok: ctx.anchor.ok, detail: ctx.anchor.detail };
    case 'logcat': {
      const v = logcatVerdict(ctx.logcat);
      return { ok: v.ok, detail: v.ok ? 'Running "main"' : v.reason };
    }
    case 'pidof': {
      const alive = processAliveVerdict(ctx.pidof);
      if (alive === 'alive') return { ok: true, detail: `pid ${String(ctx.pidof.stdout).trim()}` };
      if (alive === 'unknown') return { ok: false, unknown: true, detail: 'pidof 不可用或读不出（观测不到，不算失败）' };
      return { ok: false, detail: '设备上找不到该进程' };
    }
    case 'service-foreground': {
      const text = ctx.out?.[check.id] ?? '';
      const block = serviceBlock(text, check.service);
      return {
        ok: isServiceForeground(text, check.service),
        detail: block ? `${check.service} 自己的 ServiceRecord 块内 isForeground=true` : `dumpsys 里没有 ${check.service} 的 ServiceRecord`,
      };
    }
    case 'regex':
      return { ok: check.pattern.test(ctx.out?.[check.id] ?? ''), detail: `匹配 ${check.pattern}` };
    default:
      return { ok: false, detail: `未知自检类型：${check.kind}` };
  }
}

function report(check, res) {
  if (res.ok) ok(`${check.label}：PASS（${res.detail}）`);
  else if (res.unknown) warn(`${check.label}：观测不到 —— ${res.detail}`);
  else warn(`${check.label}：未命中 —— ${res.detail}`);
}

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
  if (!fs.existsSync(APK_PATH)) die(`APK 不存在：${APK_PATH}（--skip-build 要求它已出好）。`
    + '\n（若你刚挪过 skill 包位置：这条也可能是 ROOT 向上层数不对 —— 见本文件 ROOT 处的注释。）');
  ok('APK 在位');
} else {
  info(`2. 出包（${DEV_BUILD.buildTask}，架构 ${abi}）`);
  // 绝对路径 + 显式 cwd：裸 `gradlew.bat` 在 Windows 上不保证从 cwd 解析；
  // 而 .bat 本身必须经 cmd.exe 才起得来（spawnPlan 决定）。
  const res = run(gradle, gradleArgs(DEV_BUILD.buildTask, abi), { inherit: true, cwd: ANDROID_DIR });
  if (res.failure?.kind === 'spawn') {
    die(`gradle 根本没起来（${res.failure.code} ${res.failure.message}）—— 这不是编译失败。`
      + `\n检查 ${gradle} 是否存在（MOBILE_GRADLE 可钉死路径）；Windows 上 .bat 必须经 cmd.exe，见 spawnPlan。`);
  }
  if (res.failure?.kind === 'timeout') die(`gradle 超时（${res.failure.message}）—— 出包太慢或构建卡住，重跑并观察 gradle 输出。`);
  if (res.status !== 0) {
    die(`gradle 出包失败（${res.status}）。`
      + (shortPath ? '\n先按上面的短路径告警处置（注意那是两层坑，别只做第一层）。' : ''));
  }
  if (!fs.existsSync(APK_PATH)) die(`出包结束但找不到 APK：${APK_PATH}`);
  ok('APK 就绪');
}

// 3. 安装前的设备时钟基线：身份锚只和「设备自己」比，不与宿主机时钟混
info('3. 读设备时钟（安装前基线）');
const deviceTimeBeforeMs = deviceClockMs(adb(['shell', 'date', '+%s'], { tolerate: true }).stdout);
if (deviceTimeBeforeMs == null) {
  warn('读不到设备时钟（date +%s）—— 时间戳这条身份锚立不起来（下一步会判死），'
    + '除非用 --dex <symbol> 直接证明产物（那条比时间戳更硬）。');
}

// 4. 装：push + pm install，不用 adb install（坑 2）；restorecon 失败改推 /sdcard/（坑 3）
info('4. 安装');
function pushAndInstall(remote) {
  const pushed = adb(['push', APK_PATH, remote]);
  if (pushed.status !== 0) return { ok: false, output: pushed.stderr, remote: null };
  const installed = adb(['shell', 'pm', 'install', '-r', remote], { tolerate: true });
  return { ok: installed.status === 0, output: installed.stdout + installed.stderr, remote };
}

let install = pushAndInstall(DEV_BUILD.remoteTmp);
if (!install.ok && needsSdcardFallback(install.output)) {
  warn('从 /data/local/tmp 装撞上 restorecon / INSTALL_FAILED_MEDIA_UNAVAILABLE → 改推 /sdcard/ 重试');
  install = pushAndInstall(DEV_BUILD.remoteSd);
}
if (!install.ok) die(`安装失败：\n${install.output.trim()}`);
pushedRemote = install.remote;
ok('已安装（未走 adb install —— 那条路会卡死 adb server）');

// 5. 身份锚（缺陷 7）：证明设备上跑的是这份产物，不成立就不要往下走（SKILL.md §2）
info('5. 身份锚：设备上的 .dev 包是不是本次产物');
const pkgInfo = parsePackageDump(adb(['shell', 'dumpsys', 'package', DEV_BUILD.appId]).stdout);
let anchor = identityAnchor({ packageDump: pkgInfo, deviceTimeBeforeMs });
// 设备时钟读不到时，时间戳这条锚在结构上立不起来 —— 允许用 --dex 的符号证明顶上
// （符号是比时间戳更硬的证据：它证明「设备上的字节里就有这次改的东西」）。
// 只对「时钟不可得」开这个口子；包确实旧了（时钟可得但不新鲜）照样判死。
if (!anchor.ok && opts.dex && pkgInfo.installed && deviceTimeBeforeMs == null) {
  warn(`身份锚的时间戳部分不成立（${anchor.detail}）→ 改由 --dex 的符号证明顶上`);
  anchor = { ...anchor, ok: true, detail: '设备时钟不可得，改以 --dex 符号证明（证据换了但更强）' };
}
if (!anchor.ok) {
  die(`${anchor.detail}\n处置：确认装的是 dev 变体（包名 .dev）、且装的就是刚出的那个 APK；`
    + `\n别在「设备上是旧包」的前提下继续取证 —— 那正是「日志 changed=true 的假验收」的成因。`);
}
ok(anchor.detail);

if (opts.dex) {
  info(`5b. 身份锚加强：设备 base.apk 里必须有符号「${opts.dex}」`);
  const { apk } = parsePackagePath(adb(['shell', 'pm', 'path', DEV_BUILD.appId]).stdout);
  if (!apk) die(`pm path 读不到 ${DEV_BUILD.appId} 的 APK 路径。`);
  pulledApk = path.join(os.tmpdir(), `mplayer-device-base-${process.pid}.apk`);
  adb(['pull', apk, pulledApk]);
  const found = findSymbolInApk(fs.readFileSync(pulledApk), opts.dex);
  if (found.found === null) die(`读不出设备 APK 的内容：${found.reason}`);
  if (!found.found) {
    die(`设备上的 base.apk 里没有「${opts.dex}」（已扫 ${found.scanned} 个条目）。`
      + `\n设备跑的不是这份代码。debug 包不做 R8/混淆，符号本该以明文留在 dex 字符串表里 ——`
      + `\n所以要么装的是旧包，要么你改的符号根本没进这次构建（换个确实存在的符号复验）。`);
  }
  ok(`符号在：${found.hits.join(', ')}（扫了 ${found.scanned} 个条目）`);
}

// 6. reverse（缺陷 4：不再吞掉失败）
info('6. reverse 隧道');
const reverse = adb(['reverse', `tcp:${DEV_BUILD.port}`, `tcp:${DEV_BUILD.port}`], { tolerate: true });
if (reverse.status !== 0) die(`${reverseFailureHint()}\n\nadb 原话：${(reverse.stdout + reverse.stderr).trim()}`);
const reverseList = adb(['reverse', '--list'], { tolerate: true });
if (reverseList.status === 0 && !reverseListed(reverseList.stdout, DEV_BUILD.port)) {
  die(`adb reverse 返回成功，但 reverse --list 里没有 tcp:${DEV_BUILD.port} —— 隧道没真的建成。\n${reverseFailureHint()}`);
}
ok(`tcp:${DEV_BUILD.port} → tcp:${DEV_BUILD.port}（reverse --list 已复核）`);

// 7. 拉起：显式组件（坑 5）。先清 logcat，后面 -d 拿到的就只是本次启动之后的输出。
info('7. 拉起 dev build（显式组件，不用裸 scheme）');
adb(['logcat', '-c'], { tolerate: true });
adb(['shell', 'am', 'start', '-n', DEV_BUILD.launchComponent, '-a', 'android.intent.action.VIEW', '-d', devClientUri()]);
ok('已发送启动 Intent');

// 8. 启动期自检：这一相位决定退出码（缺陷 3）
info(`8. 启动期自检（轮询到 ${LAUNCH_TIMEOUT}ms；这一相位决定退出码）`);
const deadline = Date.now() + LAUNCH_TIMEOUT;
let ctx = { anchor, logcat: '', pidof: {} };
let launchResults = [];
for (;;) {
  ctx = {
    anchor,
    logcat: adb(['logcat', '-d', '-v', 'brief'], { tolerate: true }).stdout,
    pidof: adb(['shell', 'pidof', DEV_BUILD.appId], { tolerate: true }),
  };
  launchResults = plan.launch.map((check) => ({ check, ...evaluate(check, ctx) }));
  if (launchResults.every((r) => r.ok)) break;
  if (Date.now() >= deadline) break;
  sleepSync(POLL_MS);
}
launchResults.forEach((r) => report(r.check, r));
plan.advisory.map((check) => ({ check, ...evaluate(check, ctx) })).forEach((r) => report(r.check, r));
if (!launchResults.every((r) => r.ok)) {
  const tail = ctx.logcat.trim().split(/\r?\n/).slice(-20);
  console.log(`\n${C.warn}! 启动期没通过。logcat 末尾 20 行：${C.off}`);
  console.log(tail.length ? tail.map((l) => '    ' + l).join('\n') : '    （空：logcat -c 之后什么都没打出来 → 应用没起或进程立刻死了）');
  console.log('  若是「没有 Running "main"」：先看 reverse 是否还在（adb reverse --list）、Metro 是否在 8081；');
  console.log('  若是启动即崩：短路径杂牌检出会崩 ClassNotFoundException（见上面的短路径告警第二层）。');
}

// 9. 播放后三项目（缺陷 3 / 5）：只在 --after-play 下跑，且它是「显式要的」，所以计入退出码
let postResults = [];
if (opts.afterPlay) {
  info(`9. --after-play：等「去播一首」并轮询（最多 ${Math.round(POSTPLAY_TIMEOUT / 1000)}s）`);
  console.log('  >>> 现在去播一首（任意入口、任意一首歌），脚本会自己轮询 <<<');
  const postDeadline = Date.now() + POSTPLAY_TIMEOUT;
  for (;;) {
    const out = {};
    for (const check of plan.postPlayback) out[check.id] = adb(check.args, { tolerate: true }).stdout;
    postResults = plan.postPlayback.map((check) => ({ check, ...evaluate(check, { out }) }));
    if (postResults.every((r) => r.ok)) break;
    if (Date.now() >= postDeadline) break;
    sleepSync(POLL_MS);
  }
  postResults.forEach((r) => report(r.check, r));
  if (!postResults.every((r) => r.ok)) {
    console.log(`\n${C.warn}! 播放后自检有未命中（你显式要了这一阶段，所以它计入退出码）${C.off}`);
    console.log('  先确认真的在播（进度条在动），再确认首次启动已点过 dev-client 引导页、');
    console.log('  且放行过 POST_NOTIFICATIONS（这两步只能人工做，否则 FGS 通知发不出来）。');
  }
} else {
  info('9. 跳过播放后三项目（FGS / media3 会话 / 播放通知）');
  console.log('  它们的结构前提是「正在播放」，冷启动必然不成立 —— 默认既不跑也不计入退出码。');
  console.log('  要验它们：加 --after-play（脚本会提示「现在去播一首」并轮询到超时）。');
}

// 退出码：只由 decidable 的自检决定（相位规则在 rules 的 decidesExitCode 里）
const deciding = [...launchResults, ...(opts.afterPlay ? postResults : [])]
  .filter((r) => decidesExitCode(r.check, { afterPlay: opts.afterPlay }));
const failed = deciding.filter((r) => !r.ok);

if (failed.length) {
  console.log(`\n${C.warn}! ${failed.length} 条计入退出码的自检未通过：${failed.map((r) => r.check.label).join('、')}${C.off}`);
  process.exit(1);
}
cleanupDevice();
console.log(`\n${C.ok}✓ dev build 回路完成：启动期自检全 PASS${C.off}`
  + (opts.afterPlay ? '，播放后三项目全 PASS' : '（后三项目按相位规则未计入）'));
process.exit(0);
