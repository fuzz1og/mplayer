/**
 * mobile-ui.mjs 的解析层 + CLI 契约测试。
 *
 * 用 node:test 跑（`node --test scripts/__tests__/mobile-ui.test.js`），**零依赖、不碰 adb、不写仓库**：
 * 纯函数直接断言；CLI 用子进程跑，并且一律带 `--file <临时 fixture>`，走不到 adb 那一段。
 *
 * 回归对象是两处**实测踩出来的陷阱**（不是风格问题，见 scripts/mobile-e2e.mjs:62-65）：
 *   1. haystack = `text + NUL + content-desc`——所以 `^(发现)$` 匹配不到 text 恰好是「发现」的节点。
 *      这条行为原来躲在 mobile-e2e.mjs 的私有实现里，没有任何测试钉住；顺手「修好」它会让
 *      RANK_NODE_RE（`^[0-9]{1,3}\u0000`）这类既有模式静默失效。
 *   2. countText 只读 text，不读 content-desc——它和 find/centersOf 的模式不能互换。
 * 另外钉住「真实 dump 是**一行** XML」：fixture 全部拼成单行，按行读的实现会在这里现形。
 *
 * mobile-ui.mjs 是 ESM，本文件是 CJS（与 version-bump.test.js 同一约定）——用动态 import 拿
 * 命名空间，全用例复用同一个 promise。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'mobile-ui.mjs');

/** import 一次，全用例复用；顺带就是「被 import 时 CLI 不跑」的第一层证据（跑了会 exit 掉本进程） */
const ui = import(pathToFileURL(SCRIPT).href);

/** 真实 dump 是平铺的单行 XML：fixture 一律拼成一行 */
const tag = (attrs) => '<node ' + attrs + ' />';
const doc = (nodes) =>
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\">" + nodes + '</hierarchy>';

/** 单行快照：文案断言 / 坐标 / 实体 / 无 bounds / content-desc 各来一个 */
const FIXTURE_XML = doc([
  tag('index="0" text="发现" content-desc="" bounds="[0,0][100,200]"'),
  tag('index="1" text="播放队列 (7)" content-desc="" bounds="[96,1700][1160,2100]"'),
  tag('index="2" text="" content-desc="播放" bounds="[10,20][30,40]"'),
  tag('index="3" text="&amp;lt;" content-desc="" bounds="[5,0][10,10]"'),
].join(''));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-mobile-ui-'));
const FIXTURE = path.join(TMP, 'single-line-uidump.xml');
fs.writeFileSync(FIXTURE, FIXTURE_XML, 'utf8');
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

/** 跑 CLI 子进程（全部用例都带 --file，不会碰 adb） */
function run(args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// ────────────────────────── 纯解析层 ──────────────────────────

test('xmlUnescape：&amp; 最后解，&amp;lt; 得到 &lt; 而不是 <', async () => {
  const { xmlUnescape } = await ui;
  // 顺序就是语义：先解 &amp; 会把 &amp;lt; 再解一次成 <
  assert.equal(xmlUnescape('&amp;lt;'), '&lt;');
  assert.equal(xmlUnescape('&amp;amp;'), '&amp;');
});

test('xmlUnescape：五个基本实体 + 十进制 / 十六进制数字实体', async () => {
  const { xmlUnescape } = await ui;
  assert.equal(xmlUnescape('&lt;&gt;&quot;&apos;&amp;'), '<>"\'&');
  assert.equal(xmlUnescape('&#65;&#x41;'), 'AA');
  assert.equal(xmlUnescape('&#20013;&#x4e2d;'), '中中');
});

test('attrOf：缺属性 → null，值解实体，属性名卡边界', async () => {
  const { attrOf } = await ui;
  const t = tag('text="A&amp;B" content-desc="封面" bounds="[0,0][2,2]"');

  assert.equal(attrOf(t, 'text'), 'A&B');
  assert.equal(attrOf(t, 'content-desc'), '封面');
  assert.equal(attrOf(t, 'bounds'), '[0,0][2,2]');
  assert.equal(attrOf(t, 'clickable'), null);
  // 边界：`desc` 不是 `content-desc` 的缩写，取 content-desc 也不会串到 text
  assert.equal(attrOf(t, 'desc'), null);
  assert.equal(attrOf(tag('content-desc="只有 desc"'), 'text'), null);
});

test('eachNode：单行 dump 上也数得全（真实文件就是一行）', async () => {
  const { eachNode } = await ui;
  assert.equal(FIXTURE_XML.includes('\n'), false, 'fixture 必须是单行——真实 dump 就是这样');

  const nodes = eachNode(FIXTURE_XML);
  assert.equal(nodes.length, 4);
  assert.match(nodes[1], /播放队列/);
  // 只认 <node>：<nodes> 这类前缀相似的标签不算
  assert.equal(eachNode('<hierarchy><node/><nodes/></hierarchy>').length, 1);
  assert.deepEqual(eachNode(''), []);
});

test('boundsCenterOf：中心是 floor((l+r)/2)，负坐标也向 -∞ 取整', async () => {
  const { boundsCenterOf } = await ui;
  assert.deepEqual(boundsCenterOf(tag('bounds="[96,1700][1160,2100]"')), [628, 1900]);
  assert.deepEqual(boundsCenterOf(tag('bounds="[0,0][5,7]"')), [2, 3]);
  assert.deepEqual(boundsCenterOf(tag('bounds="[-100,-200][-10,-20]"')), [-55, -110]);
  // floor 而非向零截断：-50.5 → -51（trunc 会给 -50）
  assert.deepEqual(boundsCenterOf(tag('bounds="[-101,0][0,0]"')), [-51, 0]);
});

test('boundsCenterOf：缺 bounds / 形态不对 → null（别拿 NaN 去点按）', async () => {
  const { boundsCenterOf } = await ui;
  assert.equal(boundsCenterOf(tag('text="没有 bounds"')), null);
  assert.equal(boundsCenterOf(tag('bounds=""')), null);
  assert.equal(boundsCenterOf(tag('bounds="abc"')), null);
  assert.equal(boundsCenterOf(tag('bounds="[0,0][1,1"')), null);
});

test('centersOf：跳过没有可用 bounds 的命中节点，其余按文档顺序', async () => {
  const { centersOf } = await ui;
  const xml = doc([
    tag('text="甲" bounds="[0,0][10,10]"'),
    tag('text="甲"'),
    tag('text="甲" bounds="oops"'),
    tag('text="乙" bounds="[10,10][30,30]"'),
  ].join(''));

  assert.deepEqual(centersOf(xml, '甲'), [[5, 5]]);
  assert.deepEqual(centersOf(xml, '甲|乙'), [[5, 5], [20, 20]]);
  assert.deepEqual(centersOf(xml, '丙'), []);
});

test('NUL haystack：`^(发现)$` 匹配不到 text 恰好是「发现」的节点', async () => {
  const { centerOf, centersOf, haystackOf, eachNode } = await ui;
  const xml = doc(tag('text="发现" content-desc="" bounds="[0,0][100,200]"'));

  // hay 末尾永远还有一段（NUL + content-desc），所以 $ 锚不上
  assert.equal(haystackOf(eachNode(xml)[0]), '发现\u0000');
  assert.equal(centerOf(xml, '^(发现)$'), null);
  assert.deepEqual(centersOf(xml, '^(发现)$'), []);

  // 不锚、或把 NUL 显式吃掉，都能命中（mobile-e2e 的 RANK_NODE_RE 就是这个写法）
  assert.deepEqual(centerOf(xml, '发现'), [50, 100]);
  assert.deepEqual(centerOf(xml, '^发现\u0000'), [50, 100]);

  // content-desc 那一侧同理：hay 的第二段后面也没有字符串结尾
  const desc = doc(tag('text="" content-desc="发现" bounds="[0,0][100,200]"'));
  assert.equal(centerOf(desc, '^(发现)$'), null);
  assert.deepEqual(centerOf(desc, '发现'), [50, 100]);
});

test('countText：只数 text，不数 content-desc（两套模式不可互换）', async () => {
  const { countText, centersOf } = await ui;
  const xml = doc([
    tag('text="" content-desc="播放" bounds="[0,0][10,10]"'),
    tag('text="播放" content-desc="" bounds="[0,0][10,10]"'),
    tag('text="播放队列 (7)" content-desc="" bounds="[0,0][10,10]"'),
  ].join(''));

  assert.equal(countText(xml, '^播放$'), 1);
  assert.equal(countText(xml, '播放'), 2);
  assert.equal(countText(xml, '^$'), 1, '空 text 节点也数');
  assert.equal(countText(xml, '播放队列'), 1);
  assert.deepEqual(countText(xml, '封面'), 0);
  // 同一个模式在两套语义下结果不同：这就是「不能混用」的证据
  assert.deepEqual(centersOf(xml, '^播放$'), []);
});

test('非法正则 → [] / 0 / null，不抛（沿用旧行为）', async () => {
  const { centersOf, centerOf, countText } = await ui;
  assert.deepEqual(centersOf(FIXTURE_XML, '['), []);
  assert.equal(centerOf(FIXTURE_XML, '(['), null);
  assert.equal(countText(FIXTURE_XML, '\\'), 0);
});

test('导出面：8 个纯函数都在（含 haystackOf / boundsCenterOf）', async () => {
  const ns = await ui;
  for (const name of [
    'xmlUnescape', 'attrOf', 'eachNode', 'haystackOf',
    'boundsCenterOf', 'centersOf', 'centerOf', 'countText',
  ]) {
    assert.equal(typeof ns[name], 'function', name + ' 应从 mobile-ui.mjs 导出');
  }
});

test('被 import 时不跑 CLI：只打印哨兵就正常退出', () => {
  const probe = path.join(TMP, 'import-probe.mjs');
  fs.writeFileSync(
    probe,
    'import { centerOf } from ' + JSON.stringify(pathToFileURL(SCRIPT).href) + ';\n'
      + "console.log('IMPORTED-OK');\n",
    'utf8'
  );
  const res = spawnSync(process.execPath, [probe], { encoding: 'utf8' });
  assert.equal(res.status, 0, 'import 触发了 CLI（守卫失效）：' + res.stdout + res.stderr);
  assert.match(res.stdout, /IMPORTED-OK/);
});

// ────────────────────────── CLI ──────────────────────────

test('CLI --help：三条命令与环境变量都在，退 0', () => {
  const res = run(['--help']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /dump \[--out <file>\]/);
  assert.match(res.stdout, /find <regex> \[--file <file>\] \[--desc\] \[--limit N\]/);
  assert.match(res.stdout, /tap\s+<regex>/);
  assert.match(res.stdout, /MOBILE_UI_SERIAL/);
  assert.match(res.stdout, /MOBILE_UI_ADB/);
  assert.match(res.stdout, /MOBILE_UI_DUMP_FILE/);
});

test('CLI find --file：一行一个命中，格式与契约逐字一致', () => {
  const res = run(['find', '播放队列', '--file', FIXTURE]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(
    res.stdout.trimEnd(),
    '(628, 1900)  bounds=[96,1700][1160,2100]  text="播放队列 (7)"  desc=""'
  );
});

test('CLI find：实体在管道里也被解（&amp;lt; → &lt;）', () => {
  const res = run(['find', '&lt;', '--file', FIXTURE]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trimEnd(), '(7, 5)  bounds=[5,0][10,10]  text="&lt;"  desc=""');
});

test('CLI find --desc：只比 content-desc；不带的锚定式模式命中 0 个但退 0', () => {
  const desc = run(['find', '^播放$', '--desc', '--file', FIXTURE]);
  assert.equal(desc.status, 0, desc.stderr);
  assert.equal(desc.stdout.trimEnd(), '(20, 30)  bounds=[10,20][30,40]  text=""  desc="播放"');

  const hay = run(['find', '^播放$', '--file', FIXTURE]);
  assert.equal(hay.status, 0, hay.stderr);
  assert.equal(hay.stdout, '', '匹配行之外不该有别的 stdout（诊断走 stderr）');
  assert.match(hay.stderr, /没有命中/);
});

test('CLI find --limit：截断输出行数', () => {
  const all = run(['find', '^', '--file', FIXTURE]);
  assert.equal(all.stdout.trimEnd().split('\n').length, 4);

  const one = run(['find', '^', '--file', FIXTURE, '--limit', '1']);
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.stdout.trimEnd().split('\n').length, 1);
});

test('CLI find：非法正则退 1 并说破（纯层才是静默的）', () => {
  const res = run(['find', '[', '--file', FIXTURE]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /不是合法正则/);
});

test('CLI find --file：快照不存在退 1（不静默当空树）', () => {
  const res = run(['find', 'x', '--file', path.join(TMP, 'never-written.xml')]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /快照不存在/);
});

test('CLI：没给命令 / 未知命令都退 1 并提示用法', () => {
  assert.equal(run([]).status, 1);
  const unknown = run(['frobnicate']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /未知命令/);
});
