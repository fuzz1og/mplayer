#!/usr/bin/env node
/**
 * mobile-ui.mjs — uiautomator dump 的「取树 / 查节点 / 点按」三件套，外加它的纯解析层。
 *
 * 为什么存在：dump → 读 bounds → input tap 这个循环在最近 8 轮真机验收会话里被手工重写了 8 次，
 * 每次都要把同一批坑再踩一遍。这里把**解析**冻结成可 import、可单测的纯函数（不碰 I/O），
 * 把 **adb 动作**冻结成一条命令；scripts/mobile-e2e.mjs 从同一份实现取解析层，不再各写一份。
 *
 * 两条必须原样保留的语义（实测踩出来的行为，不是风格问题）：
 *   1. hay = text + '\u0000' + content-desc，那个 NUL 是有意的：hay 里永远还有第二段，
 *      所以 `^(发现)$` 匹配不到 text 恰好是「发现」的节点——原 Python 实现同样匹配不到，
 *      调用方本来就备了坐标兜底。要锚定就写 `^发现\u0000`（吃掉 NUL），或干脆别锚。
 *      见 scripts/mobile-e2e.mjs:62-65 的 RANK_NODE_RE。
 *   2. countText 只读 text（不含 content-desc），所以它和 find / centersOf 的模式**不能互换**。
 *
 * 用法：见下面的 HELP（--help 直接打印）。退出码 0 = 成功，1 = 失败。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ==================== 纯解析层（无 I/O） ====================
// 语义与 scripts/mobile-e2e.mjs 里那份私有实现逐字一致，只换签名：解析器只吃**文本**，
// 文件读写留在调用方（所以这里可以零依赖单测，见 scripts/__tests__/mobile-ui.test.js）。

/** XML 实体解码：ElementTree 会解，正则直读不会——不解就会在含 & 的文本上分叉 */
export function xmlUnescape(value) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 取 XML 属性值（等价 ElementTree 的 get：缺属性 → null，同时解实体）。
 * 属性名靠 `(?:^|\s)` 卡边界：否则 `desc` 会命中 `content-desc=` 的尾巴，取到隔壁属性的值。
 */
export function attrOf(tag, name) {
  const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(tag);
  return m ? xmlUnescape(m[1]) : null;
}

/**
 * 逐个 <node ...> 标签（uiautomator dump 是平铺节点，无嵌套语义可用）。
 * 这里是**整串全局扫描**，所以「dump 是单行 XML」对它是透明的；会栽的是那些按行切分的读法
 * （截断后静默 0 个节点，看着像空树）——见 runtime-verification/references/mobile.md 取证 1。
 */
export function eachNode(xml) {
  return xml.match(/<node\b[^>]*>/g) ?? [];
}

/**
 * 匹配用 haystack：`text + NUL + content-desc`。
 * **NUL 是刻意的**：它让 hay 末尾永远不是字符串结尾，于是 `^(发现)$` 这类锚定模式在
 * 「text 恰好是发现」时也**不命中**（原 Python ui_center_of 就是这样）。别顺手「修」成空格——
 * 那会静默改变 mobile-e2e 的 rank 判定等一批既有模式的含义。
 */
export function haystackOf(tag) {
  return (attrOf(tag, 'text') ?? '') + '\u0000' + (attrOf(tag, 'content-desc') ?? '');
}

/**
 * bounds → 中心坐标 [x, y]；缺失/形态不对 → null（宁可跳过，也不拿 NaN 去 input tap）。
 * 中心是 floor((left + right) / 2)：与坐标点按的既有口径一致，负数时向 -∞ 取整。
 */
export function boundsCenterOf(tag) {
  const m = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrOf(tag, 'bounds') ?? '');
  if (!m) return null;
  return [
    Math.floor((Number(m[1]) + Number(m[3])) / 2),
    Math.floor((Number(m[2]) + Number(m[4])) / 2),
  ];
}

/** 编译正则；非法 → null（纯层沿用旧行为：**不抛**，当作不命中） */
function compile(pattern) {
  try { return new RegExp(pattern); } catch { return null; }
}

/** 命中节点（含原始 tag）。hayOf 决定比什么；无可用 bounds 的节点不参与（点不动） */
function matchTags(xml, pattern, hayOf) {
  const re = compile(pattern);
  if (!re) return [];
  const out = [];
  for (const tag of eachNode(xml)) {
    if (!re.test(hayOf(tag))) continue;
    const center = boundsCenterOf(tag);
    if (!center) continue;
    out.push({ tag, center });
  }
  return out;
}

/** 所有命中节点的中心坐标（文档顺序） */
export function centersOf(xml, pattern) {
  return matchTags(xml, pattern, haystackOf).map((m) => m.center);
}

/** 首个命中节点的中心坐标 */
export function centerOf(xml, pattern) {
  return centersOf(xml, pattern)[0] ?? null;
}

/** text 命中正则的节点数——**只看 text**，不看 content-desc（与 find/centersOf 不可互换） */
export function countText(xml, pattern) {
  const re = compile(pattern);
  if (!re) return 0;
  let n = 0;
  for (const tag of eachNode(xml)) {
    if (re.test(attrOf(tag, 'text') ?? '')) n += 1;
  }
  return n;
}

// ==================== CLI ====================

const ADB = process.env.MOBILE_UI_ADB ?? 'adb';
const SERIAL = process.env.MOBILE_UI_SERIAL ?? '';
// 默认落 e2e/artifacts/（.gitignore:50 已覆盖），与 mobile-e2e 的快照目录一致
const DUMP_FILE = process.env.MOBILE_UI_DUMP_FILE ?? path.join(REPO, 'e2e', 'artifacts', 'mobile-uidump.xml');

// 每条 adb 都必须带超时。本机最常撞的失效是「adb 命令卡死」：雷电自带的 adb 与 scoop /
// 平台工具的那份抢 5037，server 版本一不一致，start-server 就能无限等下去——脚本挂死比报错难查得多。
const ADB_TIMEOUT_MS = 20000;
// 远端临时文件固定一个名字：每次 dump 覆盖它，不在设备上攒文件
const REMOTE_DUMP = '/sdcard/mobile-ui-dump.xml';
// 上滑一屏（--scroll）沿用 e2e 的参考机坐标（1256x2760）；换机型可能要调
const SWIPE = ['628', '2100', '628', '1300', '300'];

const ESC = String.fromCharCode(27);
const C = { info: ESC + '[1;36m', ok: ESC + '[32m', warn: ESC + '[33m', bad: ESC + '[31m', off: ESC + '[0m' };

/** 前缀输出。绑 out=stdout / err=stderr 两份：find 的匹配行必须能干净地进管道 */
const mkLog = (write) => ({
  info: (msg) => write(C.info + '▶ ' + msg + C.off),
  ok: (msg) => write(C.ok + '  ✓ ' + msg + C.off),
  warn: (msg) => write(C.warn + '  ! ' + msg + C.off),
  bad: (msg) => write(C.bad + '  ✗ ' + msg + C.off),
  detail: (msg) => write('    ' + msg),
});
const out = mkLog((s) => console.log(s));
const err = mkLog((s) => console.error(s));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readText = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };

/** 卡死/超时的统一处置：5037 被另一份 adb server 占着（雷电自带 vs scoop/平台工具） */
function adbTimeoutHint() {
  err.warn('adb 命令超时（' + ADB_TIMEOUT_MS + 'ms 未返回）——本机最常是 5037 端口被另一份 adb server 占着。');
  err.detail('处置：`adb kill-server` 后只保留一份 adb（用 MOBILE_UI_ADB=<绝对路径> 指定），或 `adb -P 5038 start-server` 起独立 server。');
}

const adbArgs = (args) => (SERIAL ? ['-s', SERIAL] : []).concat(args);

/** 捕获 stdout 的 adb 调用（超时/缺 adb 都归一成 status=1，并就地给出处置提示） */
function adbCapture(args) {
  const res = spawnSync(ADB, adbArgs(args), {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: ADB_TIMEOUT_MS,
  });
  if (res.error) {
    const missing = res.error.code === 'ENOENT';
    if (missing) err.bad('找不到 adb：' + ADB + '（用 MOBILE_UI_ADB 指定绝对路径）');
    else adbTimeoutHint();
    return { status: 1, stdout: '', stderr: '', failed: true, missing };
  }
  if (res.status === null) { adbTimeoutHint(); return { status: 1, stdout: '', stderr: '', failed: true, missing: false }; }
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', failed: false, missing: false };
}

/** 丢弃输出的 adb 调用 */
function adbQuiet(args) {
  const res = spawnSync(ADB, adbArgs(args), { stdio: 'ignore', timeout: ADB_TIMEOUT_MS });
  if (res.error) {
    if (res.error.code === 'ENOENT') err.bad('找不到 adb：' + ADB + '（用 MOBILE_UI_ADB 指定绝对路径）');
    else adbTimeoutHint();
    return 1;
  }
  if (res.status === null) { adbTimeoutHint(); return 1; }
  return res.status;
}

/**
 * 前置：没给 MOBILE_UI_SERIAL 时必须只有一台在位设备。
 * 不带 -s 的多设备 adb 只会报 more than one device/emulator——提前说清「填哪个」，别让人对着报错猜。
 */
function ensureSingleDevice() {
  if (SERIAL) return true;
  const r = adbCapture(['devices']);
  if (r.failed) return false;
  const serials = r.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c[1] === 'device')
    .map((c) => c[0]);
  if (serials.length === 1) return true;
  if (serials.length === 0) { err.bad('没有在位的 adb 设备（adb devices 为空）'); return false; }
  err.bad('有多台设备在位，必须显式指定：MOBILE_UI_SERIAL=<serial>（不带 -s 的 adb 会报 more than one device/emulator）');
  for (const s of serials) err.detail('候选：' + s);
  return false;
}

/**
 * 抓 UI 树到 file，true = 成功。
 * 进手先删旧文件：dump 失败时**绝不能**让上层命中上一轮的过期快照（假 PASS 的来源）。
 * 结果里没有 <node> 就重试，最多 5 次；始终拿不到就退 1 并给出已知处置。
 */
async function dumpTo(file) {
  rmSync(file, { force: true });
  mkdirSync(path.dirname(file), { recursive: true });
  if (!ensureSingleDevice()) return false;
  for (let i = 1; i <= 5; i++) {
    adbQuiet(['shell', 'uiautomator', 'dump', REMOTE_DUMP]);
    const r = adbCapture(['exec-out', 'cat', REMOTE_DUMP]);
    if (r.missing) return false; // adb 都不在，再重试 5 次只是刷屏
    if (r.status === 0 && r.stdout.includes('<node')) {
      writeFileSync(file, r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
      out.ok('UI 树已抓到 ' + file + '（第 ' + i + ' 次）');
      return true;
    }
    out.warn('第 ' + i + '/5 次没拿到 <node>，1s 后重试');
    await sleep(1000);
  }
  err.bad('uiautomator dump 连续 5 次都没拿到 <node>，已放弃（旧快照已删，不会留过期内容）');
  err.detail('若是 `ERROR: could not get idle state`：这是动画界面（播放页唱片动画 / 底部弹层入场）的已知失效，');
  err.detail('不是坐标写错，别反复重试——改用 logcat 断言（如 `[player] 补窗 mode=… 计划=[…]`）或截图裁切判读。');
  return false;
}

/** 命中节点 → 一行证据（字段顺序与 find 的输出契约一致） */
const hitLine = (m) => '(' + m.center[0] + ', ' + m.center[1] + ')'
  + '  bounds=' + (attrOf(m.tag, 'bounds') ?? '')
  + '  text="' + (attrOf(m.tag, 'text') ?? '') + '"'
  + '  desc="' + (attrOf(m.tag, 'content-desc') ?? '') + '"';

/** 校验正则：纯层对非法正则静默返回空，CLI 不该跟着静默——直接说破 */
function badRegex(pattern) {
  if (compile(pattern)) return false;
  err.bad('不是合法正则：/' + pattern + '/');
  return true;
}

/** 解析出快照文本：--file 读文件（不存在即失败），否则现抓一份 */
async function snapshot(values) {
  const file = values.file ?? DUMP_FILE;
  if (values.file) {
    if (!existsSync(file)) { err.bad('快照不存在：' + file + '（先跑 dump，或换个 --file）'); return null; }
    return { file, xml: readText(file) };
  }
  out.info('抓 UI 树 → ' + file);
  if (!(await dumpTo(file))) return null;
  return { file, xml: readText(file) };
}

async function cmdDump(values) {
  const file = values.out ?? DUMP_FILE;
  out.info('抓 UI 树 → ' + file);
  return (await dumpTo(file)) ? 0 : 1;
}

async function cmdFind(pattern, values) {
  if (!pattern) { err.bad('find 需要一个正则：node scripts/mobile-ui.mjs find "<re>"'); return 1; }
  if (badRegex(pattern)) return 1;
  const limit = values.limit === undefined ? Infinity : Number(values.limit);
  if (Number.isNaN(limit) || limit < 0) { err.bad('--limit 需要一个非负整数，收到：' + values.limit); return 1; }

  const snap = await snapshot(values);
  if (!snap) return 1;

  const hits = matchTags(snap.xml, pattern, values.desc ? (tag) => attrOf(tag, 'content-desc') ?? '' : haystackOf);

  // 匹配行走 stdout（可管道），诊断走 stderr——别让进度行污染证据
  for (const m of hits.slice(0, limit)) console.log(hitLine(m));
  if (hits.length === 0) err.warn('没有命中 /' + pattern + '/（快照：' + snap.file + '）');
  else if (hits.length > limit) err.detail('共命中 ' + hits.length + ' 个，--limit ' + limit + ' 截断到前 ' + limit + ' 行');
  return 0;
}

async function cmdTap(pattern, values) {
  if (!pattern) { err.bad('tap 需要一个正则：node scripts/mobile-ui.mjs tap "<re>"'); return 1; }
  if (badRegex(pattern)) return 1;
  if (values.file && values.scroll) err.warn('--file 不会重新抓树，--scroll 无从生效，已忽略');

  // 没命中就上滑一屏再找一轮（等价 mobile-e2e 的 uiTapText(..., allowScroll=1)）
  const rounds = values.scroll && !values.file ? 2 : 1;
  for (let i = 1; i <= rounds; i++) {
    const snap = await snapshot(values);
    if (!snap) return 1;
    const hit = matchTags(snap.xml, pattern, haystackOf)[0];
    if (hit) {
      const [x, y] = hit.center;
      if (adbQuiet(['shell', 'input', 'tap', String(x), String(y)]) !== 0) {
        err.bad('adb shell input tap 失败（超时或掉线）');
        return 1;
      }
      // 这行就是「点到了哪」的证据，别删
      out.ok('已点按 (' + x + ', ' + y + ')  ← /' + pattern + '/');
      return 0;
    }
    err.warn('第 ' + i + '/' + rounds + ' 轮没命中 /' + pattern + '/');
    if (i < rounds) {
      adbQuiet(['shell', 'input', 'swipe'].concat(SWIPE));
      await sleep(1500);
    }
  }
  err.bad('没找到 /' + pattern + '/，未点按');
  return 1;
}

const HELP = [
  'mobile-ui.mjs — uiautomator dump 的取树 / 查节点 / 点按三件套（adb 驱动）',
  '',
  '用法：',
  '  node scripts/mobile-ui.mjs dump [--out <file>]',
  '  node scripts/mobile-ui.mjs find <regex> [--file <file>] [--desc] [--limit N]',
  '  node scripts/mobile-ui.mjs tap  <regex> [--file <file>] [--scroll]',
  '  node scripts/mobile-ui.mjs --help',
  '',
  '命令：',
  '  dump  抓当前 UI 树落本地。进手先删旧文件；结果不含 <node> 就重试，最多 5 次，',
  '        始终拿不到则退 1——绝不留下上一轮的过期快照。',
  '  find  在快照里按正则列节点，一行一个：',
  '           (628, 1900)  bounds=[96,1700][1160,2100]  text="播放队列 (7)"  desc=""',
  '        匹配行走 stdout（可管道），诊断走 stderr；命中 0 个也退 0（要「找不到就失败」用 tap）。',
  '  tap   找第一个命中节点并 `adb shell input tap <x> <y>`；打印实际点下的坐标（这行是证据）。',
  '        --scroll：没命中就上滑一屏（参考机坐标 628 2100 → 628 1300）再找一轮。找不到退 1。',
  '',
  '匹配语义（与 scripts/mobile-e2e.mjs 的历史实现完全一致，不是「顺便改好」）：',
  '  find 默认匹配 `text + NUL + content-desc`，--desc 只匹配 content-desc，countText 只管 text。',
  '  那个 NUL 是刻意的：hay 末尾永远还有一段，所以 `^(发现)$` **匹配不到** text 恰好是「发现」的节点；',
  '  要么写 `^发现\\u0000` 吃掉 NUL，要么别加锚。',
  '',
  '环境变量：',
  '  MOBILE_UI_SERIAL    adb 序列号；多设备必填，每条 adb 都带 -s（不带会报 more than one device/emulator）',
  '  MOBILE_UI_ADB       adb 可执行文件，默认 adb（雷电自带的那份常与 scoop/平台工具抢 5037）',
  '  MOBILE_UI_DUMP_FILE 快照路径，默认 e2e/artifacts/mobile-uidump.xml（已在 .gitignore）',
  '',
  '退出码：0 = 成功；1 = 失败（dump 拿不到 <node> / tap 没找到 / 非法正则 / adb 超时或缺失）',
  '每条 adb 都有 ' + ADB_TIMEOUT_MS + 'ms 超时：卡死时按提示处理 5037，脚本自己不会挂死。',
].join('\n');

// === Main ===（ESM 版守卫：被 import 时不跑 CLI。version-bump.js 是 CJS、顶层直接跑；
// 本文件同时是库与 CLI，所以必须判「是不是被当主程序执行」——见文件头的纯解析层约定）
async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean', short: 'h' },
        out: { type: 'string' },
        file: { type: 'string' },
        desc: { type: 'boolean' },
        limit: { type: 'string' },
        scroll: { type: 'boolean' },
      },
      allowPositionals: true,
    });
  } catch (e) {
    err.bad('参数解析失败：' + e.message);
    err.detail('node scripts/mobile-ui.mjs --help');
    return 1;
  }

  const { values, positionals } = parsed;
  if (values.help) { console.log(HELP); return 0; }

  const cmd = positionals[0];
  if (!cmd) { err.bad('缺少命令（dump / find / tap）'); console.error(HELP); return 1; }

  if (cmd === 'dump') return cmdDump(values);
  if (cmd === 'find') return cmdFind(positionals[1], values);
  if (cmd === 'tap') return cmdTap(positionals[1], values);
  err.bad('未知命令：' + cmd + '（可用：dump / find / tap）');
  return 1;
}

/** Windows 路径大小写不敏感，Linux 敏感——按平台判等 */
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const isMain = process.argv[1] !== undefined
  && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url));

if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
