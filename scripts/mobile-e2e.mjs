#!/usr/bin/env node
/**
 * mobile-e2e.mjs — MPlayer 移动端真机 e2e：把手工真机验收流程固化为一条命令（adb 驱动，非 Playwright）。
 * 移植自 scripts/mobile-e2e.sh（#502）：步骤、断言、文案与退出码一致。
 *
 * 链路：设备在位 → reverse 隧道 → Metro 健康 + 归属校验 → 冷启 App（logcat 断言）→
 *       发现页排行榜四分区 → 榜单详情页 → 点歌出声（logcat + 播放栏断言）。
 * 每步截图/日志存档到 e2e/artifacts/（已 gitignore，仅本地留档）。
 *
 * 与原脚本的差异（两处，都是**去掉环境耦合**而不是换语义）：
 *   1. 仓库根取脚本自身位置，不再 git rev-parse —— 后者在「Windows 建的 worktree + WSL 侧跑」时
 *      解析 Windows 绝对路径会 fatal: not a git repository（原脚本自己在别处记过这条限制）；
 *   2. uiautomator dump 的 XML 解析与 manifest 的 projectRoot 提取改用 JS，**不再需要 python3**。
 *
 * 用法：
 *   node scripts/mobile-e2e.mjs                       # 唯一设备 + 复用 8081 Metro（没有则自起）
 *   MOBILE_E2E_SERIAL=N7TOAIMFOJPFIV7D node scripts/mobile-e2e.mjs
 *   MOBILE_E2E_DIR=/path/to/other/packages/mobile node scripts/mobile-e2e.mjs
 *
 * 参数（环境变量）：
 *   MOBILE_E2E_SERIAL          adb 序列号（多设备必填；默认取唯一在位设备）
 *   MOBILE_E2E_PORT            Metro/Expo 端口，默认 8081
 *   MOBILE_E2E_DIR             预期 Metro projectRoot，默认本仓库 packages/mobile
 *   MOBILE_E2E_WAIT_DEVICE     无设备时轮询等待秒数，默认 20
 *   MOBILE_E2E_BOOT_TIMEOUT    冷启断言超时秒数，默认 240
 *   MOBILE_E2E_START_METRO     端口无 Metro 时是否代为拉起（1 是 / 0 否），默认 1
 *   MOBILE_E2E_HOTLIST         走查的目标榜单，默认「QQ 音乐 · 新歌榜」
 *
 * 前置：手机经 usbipd 直挂进 WSL（scripts/mobile-device/usb-attach.sh）；
 *       @mplayer/core 已构建（dist 过期症状：启动即 undefined is not a function，本脚本识别为明确 FAIL）。
 *
 * 退出码：0 全部通过；1 有 FAIL（摘要逐条列出）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.MOBILE_E2E_PORT ?? '8081';
let SERIAL = process.env.MOBILE_E2E_SERIAL ?? '';
const EXPECT_ROOT = process.env.MOBILE_E2E_DIR ?? path.join(REPO, 'packages', 'mobile');
const WAIT_DEVICE = process.env.MOBILE_E2E_WAIT_DEVICE ?? '20';
const BOOT_TIMEOUT = process.env.MOBILE_E2E_BOOT_TIMEOUT ?? '240';
const START_METRO = process.env.MOBILE_E2E_START_METRO ?? '1';
const EXP_PKG = 'host.exp.exponent';
// 走查的目标榜单。默认 QQ 音乐 · 新歌榜（原脚本的选择）；某台机器的网络/订阅源解析不了
// 该源的曲子时，可用它换一个源跑完整条链（例如 MOBILE_E2E_HOTLIST='网易云音乐 · 新歌榜'）。
const HOTLIST_TITLE = process.env.MOBILE_E2E_HOTLIST ?? 'QQ 音乐 · 新歌榜';
const ART = path.join(REPO, 'e2e', 'artifacts');
const LCAT_FILE = path.join(ART, 'mobile-logcat.log');
const DUMP_FILE = path.join(ART, 'mobile-uidump.xml');
const USBIPD = '/mnt/c/Program Files/usbipd-win/usbipd.exe';

// 参考机（OPPO PKB110, 1256x2760）手工校准坐标；其他分辨率按 wm size 等比缩放
const REF_W = 1256;
const REF_H = 2760;
const TAB_DISCOVER_X = 466;
const TAB_DISCOVER_Y = 2593; // 底部 tab「发现」
// （原 SONG2_X/SONG2_Y「榜单详情页列表第 2 行」的固定坐标已删：改为按当前 dump 的第 2 个 rank 节点定位）

// 定位「纯数字文本」节点用的模式。注意 uiCenterOf/uiCentersOf 的 hay 是 `text + NUL + content-desc`，
// 所以这里必须显式吃掉那个 NUL——写成 `^[0-9]{1,3}$` 会因为末尾的 NUL 而**永远不匹配**
// （uiCountText 只看 text，没有这个问题，两处模式不能混用）。
const RANK_NODE_RE = '^[0-9]{1,3}\u0000';

let SCREEN_W = 0;
let SCREEN_H = 0;

const ESC = String.fromCharCode(27);
const C = { info: ESC + '[1;36m', ok: ESC + '[32m', warn: ESC + '[33m', bad: ESC + '[31m', off: ESC + '[0m' };
const info = (msg) => console.log(C.info + '▶ ' + msg + C.off);
const ok = (msg) => console.log(C.ok + '  ✓ ' + msg + C.off);
const warn = (msg) => console.log(C.warn + '  ! ' + msg + C.off);
const bad = (msg) => console.log(C.bad + '  ✗ ' + msg + C.off);
const detail = (msg) => console.log('    ' + msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 摘要 ----------

const SUMMARY = [];
let FAILS = 0;
let SUMMARY_PRINTED = 0;

function record(id, status, note) {
  SUMMARY.push(id + '|' + status + '|' + note);
  if (status === 'PASS') ok('[' + id + '] ' + note);
  else if (status === 'FAIL') { bad('[' + id + '] ' + note); FAILS += 1; }
  else warn('[' + id + '] 跳过：' + note);
}

// 前置步骤失败即终止：把未跑步骤标 SKIP、打摘要、退 1
function abortAfter(ids) {
  for (const id of ids) {
    if (id === '') continue;
    record(id, 'SKIP', '前置步骤失败');
  }
  stopLogcat();
  printSummary();
  process.exit(1);
}

function printSummary() {
  if (SUMMARY_PRINTED === 1) return;
  SUMMARY_PRINTED = 1;
  console.log('');
  console.log(C.info + '===== 移动端 e2e 摘要 =====' + C.off);
  for (const row of SUMMARY) {
    const first = row.indexOf('|');
    const second = row.indexOf('|', first + 1);
    const id = row.slice(0, first);
    const st = row.slice(first + 1, second);
    const note = row.slice(second + 1);
    if (st === 'PASS') console.log(C.ok + '✓' + C.off + ' ' + id + ' — ' + note);
    else if (st === 'FAIL') console.log(C.bad + '✗' + C.off + ' ' + id + ' — ' + note);
    else console.log(C.warn + '-' + C.off + ' ' + id + ' — ' + note);
  }
  if (FAILS === 0) {
    console.log(C.ok + '结果：全部通过（' + SUMMARY.length + ' 步）' + C.off);
  } else {
    console.log(C.bad + '结果：' + FAILS + ' 步失败，产物与 logcat 见 ' + ART + C.off);
  }
}

// ---------- 基础设施 ----------

const adbArgs = (args) => (SERIAL ? ['-s', SERIAL].concat(args) : args);

/** 捕获 stdout 的 adb 调用（不继承 stdio，避免污染断言输出） */
function adbCapture(args) {
  const res = spawnSync('adb', adbArgs(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) return { status: 1, stdout: '' };
  return { status: res.status ?? 1, stdout: res.stdout ?? '' };
}

/** 丢弃输出的 adb 调用（对应 >/dev/null 2>&1） */
function adbQuiet(args) {
  const res = spawnSync('adb', adbArgs(args), { stdio: 'ignore' });
  return res.error ? 1 : res.status ?? 1;
}


const splitLines = (text) => text.split(/\r?\n/);
const rowCells = (line) => line.trim().split(/\s+/);
const devicesLines = () => splitLines(adbCapture(['devices']).stdout).slice(1).filter((l) => l.trim() !== '');
const deviceSerials = (lines) => lines.map(rowCells).filter((c) => c[1] === 'device').map((c) => c[0]);

/** 本轮目标的 serial 是否仍以 device 状态在位 */
function deviceOk() {
  return devicesLines().some((l) => {
    const c = rowCells(l);
    return c[0] === SERIAL && c[1] === 'device';
  });
}

// usbipd 透传掉线自愈：重 attach → 等在位（脚本所在环境是 usbipd 直挂，
// attach 中途掉线是常态；非 usbipd 环境找不到 usbipd.exe 时只重试 adb）
async function healDevice() {
  warn('设备 ' + SERIAL + ' 不在位，尝试自愈（透传重挂）...');
  for (let i = 1; i <= 3; i++) {
    if (existsSync(USBIPD)) {
      const list = spawnSync(USBIPD, ['list'], { encoding: 'utf8' }).stdout ?? '';
      const busids = splitLines(list)
        .filter((l) => /^\s*[0-9]+-/.test(l))
        .filter((l) => /android|adb|PKB110|2a70|18d1|22d9/i.test(l))
        .map(rowCells)
        .map((c) => c[0]);
      for (const busid of busids) {
        const r = spawnSync(USBIPD, ['attach', '--wsl', '--busid', busid], { encoding: 'utf8' });
        if (!r.error && r.status === 0) detail('已重挂 ' + busid);
        else warn('attach ' + busid + ' 失败：' + String(r.stderr ?? '').split(/\r?\n/).filter(Boolean).pop());
      }
    }
    await sleep(4000);
    spawnSync('adb', ['start-server'], { stdio: 'ignore' });
    if (deviceOk()) {
      adbQuiet(['reverse', 'tcp:' + PORT, 'tcp:' + PORT]);
      // kill-server 会带走 logcat 捕获进程，复活它（不 clear，旧断言已消费）
      if (!logcatAlive()) startLogcat();
      ok('设备恢复，reverse 已重建');
      return true;
    }
    // 尾部重置：下一轮干净枚举（手动验证过 attach 本身不需要 kill-server）
    spawnSync('adb', ['kill-server'], { stdio: 'ignore' });
  }
  return false;
}

/** 截图存档（容错：设备掉线时警告，不打断断言链） */
function shot(name) {
  const out = openSync(path.join(ART, name), 'w');
  const r = spawnSync('adb', adbArgs(['exec-out', 'screencap', '-p']), { stdio: ['ignore', out, 'ignore'] });
  if (!r.error && r.status === 0) detail('截图：e2e/artifacts/' + name);
  else warn('截图失败：' + name + '（设备可能掉线）');
}


// logcat 捕获（冷启前启动，贯穿全程；各步骤对同一份文件轮询断言）
let lcatProc = null;
function startLogcat() {
  writeFileSync(LCAT_FILE, '');
  const out = openSync(LCAT_FILE, 'w');
  // -T 1：即便 logcat -c 失败，也只从启动瞬间起算，避免旧缓冲造成假 PASS
  lcatProc = spawn('adb', adbArgs(['logcat', '-v', 'time', '-T', '1', 'ReactNativeJS:V', 'ExpoModulesCore:V', '*:S']), {
    stdio: ['ignore', out, out],
  });
}
function stopLogcat() {
  if (lcatProc) {
    try { lcatProc.kill(); } catch { /* 已退出 */ }
    lcatProc = null;
  }
}
const logcatAlive = () => lcatProc !== null && lcatProc.exitCode === null;
// 兜底：任何路径退出（含意外异常）都保证有摘要
process.on('exit', () => { stopLogcat(); printSummary(); });

/** 读文件（不存在按空串） */
function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}

/**
 * 等 logcat 出现某段文本。原脚本用 grep（BRE）：两个调用点的模式都不含元字符，
 * 且「(出声)」在 BRE 里是**字面括号**——用正则会把括号当分组，反而匹配不到真实日志行，
 * 故这里按**字面包含**处理（与 grep 的实际行为一致）。
 */
async function logcatWait(literal, timeoutSec) {
  const deadline = Date.now() + Number(timeoutSec) * 1000;
  while (Date.now() < deadline) {
    if (readText(LCAT_FILE).includes(literal)) return true;
    // adb 掉线会带走捕获进程：设备还在就复活（: > file 只丢已消费的历史行）
    if (!logcatAlive() && deviceOk()) startLogcat();
    await sleep(1000);
  }
  return false;
}

// UI 树抓到 DUMP_FILE（uiautomator 偶发 idle 失败，重试）；true=成功
// 关键：进手先删旧文件——失败时绝不能让上层命中上一轮的过期快照
async function dumpUi() {
  rmSync(DUMP_FILE, { force: true });
  for (let i = 0; i < 5; i++) {
    adbQuiet(['shell', 'uiautomator', 'dump', '/sdcard/mobile-e2e-dump.xml']);
    const xml = adbCapture(['exec-out', 'cat', '/sdcard/mobile-e2e-dump.xml']).stdout;
    if (xml.includes('<node')) {
      writeFileSync(DUMP_FILE, xml.endsWith('\n') ? xml : xml + '\n');
      return true;
    }
    await sleep(1000);
  }
  return false;
}

/** 取 XML 属性值（等价 ElementTree 的 get：缺属性 → null，同时解实体） */
function attrOf(tag, name) {
  const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(tag);
  return m ? xmlUnescape(m[1]) : null;
}

/** XML 实体解码：ElementTree 会解，正则直读不会——不解就会在含 & 的文本上分叉 */
function xmlUnescape(value) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 逐个 <node ...> 标签（uiautomator dump 是平铺节点，无嵌套语义可用） */
function eachNode(xml) {
  return xml.match(/<node\b[^>]*>/g) ?? [];
}

/**
 * 原 Python ui_center_of：首个 (text + NUL + content-desc) 命中正则的节点 → 其中心坐标。
 * 注意 hay 里那个 NUL：锚定式模式（如 ^(发现)$）因此在原实现里也**匹配不到**，
 * 调用方本就准备了坐标兜底——移植保持同一行为，不做「修正」。
 */
/** 所有命中节点的中心坐标（文档顺序）。同一套 hay 语义，只是收全量而非首个 */
function uiCentersOf(pattern, file) {
  const xml = readText(file);
  let re;
  try { re = new RegExp(pattern); } catch { return []; }
  const out = [];
  for (const tag of eachNode(xml)) {
    const hay = (attrOf(tag, 'text') ?? '') + '\u0000' + (attrOf(tag, 'content-desc') ?? '');
    if (!re.test(hay)) continue;
    const m = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrOf(tag, 'bounds') ?? '');
    if (!m) continue;
    out.push([
      Math.floor((Number(m[1]) + Number(m[3])) / 2),
      Math.floor((Number(m[2]) + Number(m[4])) / 2),
    ]);
  }
  return out;
}

/** 首个命中节点的中心坐标（等价原 Python ui_center_of） */
function uiCenterOf(pattern, file) {
  return uiCentersOf(pattern, file)[0] ?? null;
}

/** 原 Python ui_count_text：text 命中正则的节点数（只看 text，不看 content-desc） */
function uiCountText(pattern, file) {
  const xml = readText(file);
  let re;
  try { re = new RegExp(pattern); } catch { return 0; }
  let n = 0;
  for (const tag of eachNode(xml)) {
    if (re.test(attrOf(tag, 'text') ?? '')) n += 1;
  }
  return n;
}

/** 按文本找元素并点按；rounds=最多尝试轮数（每轮找不到且 allowScroll 时上滑再找） */
async function uiTapText(pattern, rounds, allowScroll) {
  const tries = rounds ?? 2;
  for (let i = 0; i < tries; i++) {
    if (!(await dumpUi())) { if (!deviceOk()) await healDevice(); }
    const pos = uiCenterOf(pattern, DUMP_FILE);
    if (pos) {
      let st = adbQuiet(['shell', 'input', 'tap', String(pos[0]), String(pos[1])]);
      if (st !== 0) st = (await healDevice()) ? adbQuiet(['shell', 'input', 'tap', String(pos[0]), String(pos[1])]) : 1;
      if (st !== 0) return false;
      detail('按文本点按：/' + pattern + '/ → (' + pos[0] + ' ' + pos[1] + ')');
      return true;
    }
    if (allowScroll === 1) { adbQuiet(['shell', 'input', 'swipe', '628', '2100', '628', '1300', '300']); await sleep(1500); }
  }
  return false;
}

/** 坐标点按（带掉线自愈重试）；失败返回 false，调用方负责 FAIL 记录 */
async function devTap(x, y) {
  if (adbQuiet(['shell', 'input', 'tap', String(x), String(y)]) === 0) return true;
  if (!(await healDevice())) return false;
  return adbQuiet(['shell', 'input', 'tap', String(x), String(y)]) === 0;
}

/** 按参考机分辨率等比换算为整数坐标（awk printf %d = 向零取整） */
const scaleXy = (x, y) => [
  Math.trunc((x * SCREEN_W) / REF_W),
  Math.trunc((y * SCREEN_H) / REF_H),
];

/** Metro 健康探针（等价 curl -sf .../status | grep -q packager-status:running） */
async function metroStatus(timeoutMs) {
  try {
    const res = await fetch('http://127.0.0.1:' + PORT + '/status', { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}


// ---------- 前置检查 ----------
if (spawnSync('adb', ['version'], { stdio: 'ignore' }).error) {
  console.error('✗ 找不到 adb（~/.local/opt/platform-tools，软链 ~/.local/bin/adb）');
  process.exit(1);
}
for (const f of [path.join(REPO, 'packages', 'mobile', 'app.json'), path.join(REPO, 'package.json')]) {
  if (!existsSync(f)) {
    console.error('✗ 请在 MPlayer 仓库（或其 worktree）内运行：' + f + ' 不存在');
    process.exit(1);
  }
}
mkdirSync(ART, { recursive: true });

const currentDevices = () => splitLines(adbCapture(['devices']).stdout).slice(1).filter((l) => l.trim() !== '').join(' ');

info('MPlayer 移动端真机 e2e');
detail('串号=' + SERIAL + '(空=自动)  端口=' + PORT + '  预期 Metro projectRoot=' + EXPECT_ROOT);
detail('产物目录：' + ART);
console.log('');

// ---------- 1. 设备在位 ----------
const STEP_REST = ['reverse', 'metro', 'coldstart', 'discover', 'hotlist-detail', 'play'];
let devs = '';
let deadline = Date.now() + Number(WAIT_DEVICE) * 1000;
for (;;) {
  devs = splitLines(adbCapture(['devices']).stdout).slice(1).filter((l) => l.trim() !== '').join('\n');
  if (devs !== '') break;
  if (Date.now() >= deadline) break;
  await sleep(2000);
}
if (devs === '') {
  record('device', 'FAIL', '无设备（等了 ' + WAIT_DEVICE + 's）。插线后跑 scripts/mobile-device/usb-attach.sh；usbipd 透传掉线时重挂：adb kill-server 后 /mnt/c/Windows/System32/cmd.exe /c "usbipd attach --wsl --busid <busid>"');
  abortAfter(STEP_REST);
}
// 指定了 serial 但不在位：先试一轮透传自愈再判 FAIL（attach 掉线是常态）
if (SERIAL !== '' && !deviceSerials(splitLines(devs)).includes(SERIAL)) {
  await healDevice();
  devs = splitLines(adbCapture(['devices']).stdout).slice(1).filter((l) => l.trim() !== '').join('\n');
}
if (devs.includes('unauthorized')) {
  record('device', 'FAIL', '设备 unauthorized——去手机上点「允许 USB 调试」');
  abortAfter(STEP_REST);
}
// 双 transport 串线陷阱：无线 + USB 同时挂时 reverse 静默不通（同 mobile-debug.sh）
if (deviceSerials(splitLines(devs)).some((s) => /^[0-9.]+:[0-9]+$/.test(s))) {
  warn('检测到无线 transport（双 transport 会静默串线），断开无线只留 USB');
  spawnSync('adb', ['disconnect'], { stdio: 'ignore' });
  devs = splitLines(adbCapture(['devices']).stdout).slice(1).filter((l) => l.trim() !== '').join('\n');
}
if (SERIAL !== '') {
  if (!deviceSerials(splitLines(devs)).includes(SERIAL)) {
    record('device', 'FAIL', '序列号 ' + SERIAL + ' 不在在位设备中。当前：' + devs.split('\n').join(' '));
    abortAfter(STEP_REST);
  }
} else {
  const serials = deviceSerials(splitLines(devs));
  if (serials.length !== 1) {
    record('device', 'FAIL', '在位设备多于 1 台，请用 MOBILE_E2E_SERIAL 指定。当前：' + devs.split('\n').join(' '));
    abortAfter(STEP_REST);
  }
  SERIAL = serials[0];
}
const sizeMatch = (adbCapture(['shell', 'wm', 'size']).stdout.match(/[0-9]+x[0-9]+/g) ?? []).pop() ?? '';
SCREEN_W = Number(sizeMatch.split('x')[0]) || 0;
SCREEN_H = Number(sizeMatch.split('x')[1]) || 0;
record('device', 'PASS', '在位 serial=' + SERIAL + '，屏幕 ' + SCREEN_W + 'x' + SCREEN_H);

// ---------- 2. reverse 隧道 ----------
if (adbQuiet(['reverse', 'tcp:' + PORT, 'tcp:' + PORT]) === 0) {
  record('reverse', 'PASS', '手机侧 localhost:' + PORT + ' → 本机 ' + PORT);
} else {
  record('reverse', 'FAIL', 'adb reverse 失败（重跑前先 adb kill-server，或按 mobile-device-debugging skill 排查）');
  abortAfter(['metro', 'coldstart', 'discover', 'hotlist-detail', 'play']);
}

// ---------- 3. Metro 健康与归属 ----------
if ((await metroStatus(5000)).includes('packager-status:running')) {
  info('Metro 已在 ' + PORT + ' 跑，复用之（不杀、不起第二个）');
} else if (START_METRO === '1') {
  const mobileDir = path.join(REPO, 'packages', 'mobile');
  info('Metro 未运行，代为拉起（' + mobileDir + '，日志 packages/mobile/.expo/dev/logs/e2e-metro.log）');
  const metroLog = path.join(mobileDir, '.expo', 'dev', 'logs', 'e2e-metro.log');
  mkdirSync(path.dirname(metroLog), { recursive: true });
  const out = openSync(metroLog, 'a');
  const [file, args] = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', 'npx expo start --localhost --port ' + PORT]]
    : ['npx', ['expo', 'start', '--localhost', '--port', PORT]];
  // Windows 上 node 把 localhost 解析成 ::1 优先，`--localhost` 于是只绑 IPv6：
  // 而本脚本的健康探针与 adb reverse 都走 127.0.0.1 → 自己起的 Metro 自己看不见。
  // --dns-result-order=ipv4first 让 localhost 先解析到 127.0.0.1，保留 --localhost 语义的同时绑回 IPv4。
  const nodeOptions = [process.env.NODE_OPTIONS, '--dns-result-order=ipv4first'].filter(Boolean).join(' ');
  const child = spawn(file, args, {
    cwd: mobileDir,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  });
  child.unref();
  let ready = 0;
  for (let i = 0; i < 90; i++) {
    if ((await metroStatus(2000)).includes('packager-status:running')) { ready = 1; break; }
    await sleep(1000);
  }
  if (ready === 1) {
    ok('Metro 就绪');
  } else {
    record('metro', 'FAIL', '代拉的 Metro 90s 未就绪，排查 packages/mobile/.expo/dev/logs/e2e-metro.log');
    abortAfter(['coldstart', 'discover', 'hotlist-detail', 'play']);
  }
} else {
  record('metro', 'FAIL', '端口 ' + PORT + ' 无 Metro 且 MOBILE_E2E_START_METRO=0。先跑 scripts/mobile-debug.sh 或手动 npx expo start');
  abortAfter(['coldstart', 'discover', 'hotlist-detail', 'play']);
}

// 归属校验：App 实际吃到的 manifest 里 extra.expoClient._internal.projectRoot
let actualRoot = '';
try {
  const res = await fetch('http://127.0.0.1:' + PORT + '/', {
    headers: { 'expo-platform': 'android', Accept: 'application/expo+json,application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (res.ok) {
    const manifest = await res.text();
    actualRoot = JSON.parse(manifest)?.extra?.expoClient?._internal?.projectRoot ?? '';
  }
} catch {
  actualRoot = '';
}
if (actualRoot === '') {
  record('metro', 'FAIL', '取不到 manifest 的 projectRoot（' + PORT + ' 可能不是 Expo dev server？）');
  abortAfter(['coldstart', 'discover', 'hotlist-detail', 'play']);
} else if (actualRoot !== EXPECT_ROOT) {
  record('metro', 'FAIL', 'Metro 归属不符：' + PORT + ' 上的 Metro 属于 [' + actualRoot + ']，预期 [' + EXPECT_ROOT + ']。陈年/别的 worktree 的 Metro 串线——改用 MOBILE_E2E_DIR=该目录 复用，或杀掉后重跑');
  abortAfter(['coldstart', 'discover', 'hotlist-detail', 'play']);
} else {
  record('metro', 'PASS', 'projectRoot 匹配：' + actualRoot);
}

// ---------- 4. 冷启 + 启动断言 ----------
info('冷启 App（force-stop ' + EXP_PKG + ' → exp://localhost:' + PORT + '）');
adbQuiet(['shell', 'am', 'force-stop', EXP_PKG]);
await sleep(1000);
adbQuiet(['logcat', '-c']);
startLogcat();
const startApp = () => adbQuiet(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://localhost:' + PORT]) === 0;
if (!startApp()) {
  await healDevice();
  if (!startApp()) {
    record('coldstart', 'FAIL', 'am start 失败（设备掉线且自愈未果）。当前设备：' + currentDevices());
    abortAfter(['discover', 'hotlist-detail', 'play']);
  }
}
let haveMain = 0;
let haveMigrate = 0;
let bootFail = '';
const bootDeadline = Date.now() + Number(BOOT_TIMEOUT) * 1000;
while (Date.now() < bootDeadline) {
  const log = readText(LCAT_FILE);
  if (log.includes('undefined is not a function')) {
    bootFail = '启动即 undefined is not a function——core dist 断裂症状，先 npm run core:build 再冷启';
    break;
  }
  if (log.includes('Running "main"')) haveMain = 1;
  if (log.includes('存量数据迁移完成')) haveMigrate = 1;
  if (haveMain === 1 && haveMigrate === 1) break;
  if (!deviceOk()) await healDevice();
  await sleep(2000);
}
if (bootFail === '' && haveMain === 0) {
  bootFail = BOOT_TIMEOUT + 's 内未见 Running "main"——bundle 未编译完或隧道不通（看 e2e/artifacts/mobile-logcat.log）';
} else if (bootFail === '' && haveMigrate === 0) {
  bootFail = '启动后未见 存量数据迁移完成——启动接线（setupLegacyMigration）未跑到';
}
if (bootFail !== '') {
  shot('mobile-01-coldstart-fail.png');
  record('coldstart', 'FAIL', bootFail);
  abortAfter(['discover', 'hotlist-detail', 'play']);
}
ok('启动断言：Running "main" + 存量数据迁移完成，无 undefined is not a function');
shot('mobile-01-coldstart.png');
record('coldstart', 'PASS', '冷启完成，启动日志断言通过');


// ---------- 5. 发现页 · 排行榜四分区 ----------
const [TX, TY] = scaleXy(TAB_DISCOVER_X, TAB_DISCOVER_Y);
if (!(await uiTapText('^(发现)$', 2, 0))) {
  if (!(await devTap(TX, TY))) {
    record('discover', 'FAIL', '点「发现」tab 失败（设备掉线且自愈未果）。当前设备：' + currentDevices());
    abortAfter(['hotlist-detail', 'play']);
  }
  detail('文本未命中，按参考坐标点「发现」：(' + TX + ',' + TY + ')');
}
await sleep(3000); // 等 tab 切换 + 排行榜骨架屏出现

// 四分区标题逐个等（网络拉榜 5-8s 起渲染，给足轮询）
const SECTIONS = [
  ['netease-hot', '网易云音乐 · 热歌榜'],
  ['qq-hot', 'QQ 音乐 · 热歌榜'],
  ['netease-new', '网易云音乐 · 新歌榜'],
  ['qq-new', 'QQ 音乐 · 新歌榜'],
];
const titleOf = (key) => SECTIONS.find((s) => s[0] === key)[1];
let missing = SECTIONS.map((s) => s[0]);
const secDeadline = Date.now() + 60000;
let scrolls = 0;
while (missing.length > 0 && Date.now() < secDeadline) {
  // dump 失败且设备真不在位（usbipd attach 掉线是常态）才自愈；否则只是 uiautomator idle 抖动
  if (!(await dumpUi())) { if (!deviceOk()) await healDevice(); }
  const dump = readText(DUMP_FILE);
  // 前缀匹配：标题节点实际是「…热歌榜 ›」（带箭头），闭合引号前还有内容
  missing = missing.filter((k) => !dump.includes('text="' + titleOf(k)));
  if (missing.length === 0) break;
  scrolls += 1;
  if (scrolls >= 3) {
    // 一屏只装得下两个分区，新歌榜在折叠区：前 2 轮纯等（骨架屏/首屏数据），
    // 之后每轮滑一屏直到列表底（input swipe 到底自动 clamp）
    adbQuiet(['shell', 'input', 'swipe', '628', '2200', '628', '700', '400']);
    await sleep(2500);
  } else {
    await sleep(2000);
  }
}
shot('mobile-02-discover-hotlist.png');
if (missing.length > 0) {
  const missTitles = missing.map((k) => '「' + titleOf(k) + '」').join('');
  record('discover', 'FAIL', '排行榜分区未齐（缺失：' + missTitles + '）。截图 mobile-02-discover-hotlist.png 可核对——骨架屏卡住/接口失败都会命中');
  abortAfter(['hotlist-detail', 'play']);
}
// 分区头齐了还要有歌曲行：rank 数字文本节点（每个分区渲染 top N 行）
if (!(await dumpUi())) { if (!deviceOk()) await healDevice(); }
const rankNodes = uiCountText('^[0-9]{1,3}$', DUMP_FILE);
if (rankNodes < 4) {
  record('discover', 'FAIL', '四分区标题齐但歌曲行未渲染（rank 数字节点仅 ' + rankNodes + ' 个，应 ≥4）');
  abortAfter(['hotlist-detail', 'play']);
}
record('discover', 'PASS', '四分区（网易云/QQ · 热歌/新歌）齐，rank 行 ' + rankNodes + ' 个');

// ---------- 6. 榜单详情页 ----------
if (!(await uiTapText(HOTLIST_TITLE, 3, 1))) {
  shot('mobile-03-hotlist-tap-fail.png');
  record('hotlist-detail', 'FAIL', '找不到「' + HOTLIST_TITLE + '」分区头可点（截图 mobile-03-hotlist-tap-fail.png）');
  abortAfter(['play']);
}
await sleep(2000);
// 详情页断言：**页面身份 + 列表行都渲染了**。
// 不用「rank 数字节点 ≥8」——那条判据是**视口相关**的：封面 hero 按 dp 占高，逻辑视口越小占比越大。
// 雷电 2160x3840@960 的逻辑视口只有 360x640dp，只装得下 2 行（真机参考机更多），于是同一份代码在
// 「列表明明渲染了」的情况下被判 FAIL。改用不依赖视口的三条：
//   · 信息块「共 N 首」——app/hotlist.tsx 里只有 songs.length > 0 才渲染，等价于列表数据已到；
//   · 「播放全部」动作位——加载态走的是 HeroSkeleton，此时两者都不在（骨架屏不会误判成 PASS）；
//   · 至少 1 个 rank 行——证明行真的画出来了，而不只是数据到了。
const detailDeadline = Date.now() + 30000;
let detailRanks = 0;
let detailTotal = '';
let detailAction = false;
while (Date.now() < detailDeadline) {
  if (!(await dumpUi())) { if (!deviceOk()) await healDevice(); }
  const dump = readText(DUMP_FILE);
  detailRanks = uiCountText('^[0-9]{1,3}$', DUMP_FILE);
  const total = /text="共 ([0-9]+) 首"/.exec(dump);
  detailTotal = total ? total[1] : '';
  detailAction = dump.includes('text="播放全部"');
  if (detailTotal !== '' && detailAction && detailRanks >= 1) break;
  await sleep(2000);
}
shot('mobile-03-hotlist-detail.png');
if (detailTotal !== '' && detailAction && detailRanks >= 1) {
  record('hotlist-detail', 'PASS', HOTLIST_TITLE + '详情页：信息块「共 ' + detailTotal + ' 首」+ 播放全部 + 可见 rank 行 ' + detailRanks + ' 个（列表已渲染）');
} else {
  const lack = [];
  if (detailTotal === '') lack.push('信息块「共 N 首」');
  if (!detailAction) lack.push('「播放全部」动作位');
  if (detailRanks < 1) lack.push('可见 rank 行');
  record('hotlist-detail', 'FAIL', '详情页未渲染（缺 ' + lack.join(' / ') + '）。截图 mobile-03-hotlist-detail.png');
  abortAfter(['play']);
}

// ---------- 7. 点歌出声 ----------
// 目标是列表里的一首歌行，但第 2 行得**完整露出来**才点得中：小视口上封面 hero 把列表压到
// 屏幕最底部，第 2 行常常只露一条边、还落在迷你播放栏底下——雷电 2160x3840@960 实测：
// 第 1 行 rank 徽章高 108px，第 2 行只剩 18px（bounds [96,3462][264,3480]），按中心点必空。
// 所以先上滑一屏收起 hero 把列表让出来，再按当前 dump 里的第 2 个 rank 节点定位；
// 不用参考机固定坐标——那只是按分辨率等比缩放，而 hero 高度以 dp 计，跨设备不是固定比例。
const SWIPE_X = Math.floor(SCREEN_W / 2);
await adbQuiet(['shell', 'input', 'swipe',
  String(SWIPE_X), String(Math.floor(SCREEN_H * 0.55)),
  String(SWIPE_X), String(Math.floor(SCREEN_H * 0.25)), '300']);
await sleep(1500);
if (!(await dumpUi())) { if (!deviceOk()) await healDevice(); }
const rowYs = uiCentersOf(RANK_NODE_RE, DUMP_FILE).map((p) => p[1]).sort((a, b) => a - b);
if (rowYs.length < 1) {
  record('play', 'FAIL', '上滑后详情页仍无可见 rank 行，点不到歌。当前设备：' + currentDevices());
  abortAfter([]);
}
const SX = SWIPE_X;
const SY = rowYs.length >= 2 ? rowYs[1] : rowYs[0];
const rowNote = rowYs.length >= 2 ? '第 2 个' : '（列表只露 1 行，取第 1 个）';
if (!(await devTap(SX, SY))) {
  record('play', 'FAIL', '点列表第 2 行失败（设备掉线且自愈未果）。当前设备：' + currentDevices());
  abortAfter([]);
}
detail('点列表行：(' + SX + ',' + SY + ')，取 ' + rowNote + '可见 rank 行');
// RN 的 console.log('[player]', msg) 多参数在 logcat 里渲染为 '[player]', 'msg'（引号逗号分隔），
// 不能带 "[player] " 前缀匹配，直接匹配消息本体
if (!(await logcatWait('开始播放《', 20))) {
  shot('mobile-04-playing-fail.png');
  // 分诊：**点空了** 与 **点中了但解析失败** 处置完全不同，别混成一句「点击未命中」。
  // 实测（雷电 + QQ 新歌榜）：点击命中，播放准备开始都打了，死在「直连返回空串 + 订阅源全部
  // 因 source 归属被跳过」——那是环境/订阅内容问题，不是脚本问题。
  const log = readText(LCAT_FILE);
  const tried = /播放准备开始: 《([^》]+)》/.exec(log);
  const noSource = /无可用源（全部因 source 归属被跳过）/.test(log);
  const noUrl = /播放失败: no playable URL/.test(log);
  let why = '点击未命中歌曲行或播放流程未发起';
  if (tried) {
    why = '点中了《' + tried[1] + '》但播放解析没成功';
    if (noSource) why += '：全部订阅源都因 source 归属被跳过（该曲所属平台没有对应的订阅源）';
    else if (noUrl) why += '：no playable URL（直连返回空串且没有可用订阅源）';
  }
  record('play', 'FAIL', '点歌后 20s 无「开始播放《」日志——' + why);
  printSummary();
  process.exit(1);
}
const playedMatches = readText(LCAT_FILE).match(/开始播放《[^》]+》/g) ?? [];
const PLAYED = playedMatches.length > 0
  ? playedMatches[playedMatches.length - 1].replace(/^开始播放《/, '').replace(/》$/, '')
  : '';
const SONG_NAME = PLAYED.split(/[（\-]/)[0]; // 保险：去掉可能拖带的备注尾巴
if (await logcatWait('播放器就绪(出声)', 60)) {
  ok('logcat：开始播放《' + PLAYED + '》 + 播放器就绪(出声)');
} else {
  shot('mobile-04-playing-fail.png');
  record('play', 'FAIL', '「开始播放《' + PLAYED + '》」已见，但 60s 无「播放器就绪(出声)」——音源解析/缓冲失败');
  printSummary();
  process.exit(1);
}
await sleep(2000);
shot('mobile-04-playing.png');
// 播放栏断言：屏幕上应出现歌名文本（底部迷你播放栏）
const dumpReady = await dumpUi();
if (SONG_NAME !== '' && dumpReady && readText(DUMP_FILE).includes('text="' + SONG_NAME + '"')) {
  record('play', 'PASS', '出声且播放栏显示歌名《' + SONG_NAME + '》（截图 mobile-04-playing.png）');
} else {
  record('play', 'FAIL', '已出声，但屏幕文本未见歌名「' + SONG_NAME + '」——播放栏可能未滑入（截图 mobile-04-playing.png 核对）');
}

stopLogcat();
printSummary();
process.exit(FAILS === 0 ? 0 : 1);
