/** #725：发布侧校验资产脚本产出 md5sum 兼容行；输入/参数错误 exit 2。 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'apk-md5.mjs');

const md5 = (buf) => createHash('md5').update(buf).digest('hex');

function run(args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO_ROOT });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-apk-md5-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFixture(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test('合法文件产出 md5sum 兼容行：小写 hex + 两个空格 + basename', () => {
  withTempDir((dir) => {
    const content = 'fake apk payload\n';
    const file = writeFixture(dir, 'nested/MPlayer-v1.9.1.apk', content);
    const res = run([file]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.stdout, md5(Buffer.from(content)) + '  MPlayer-v1.9.1.apk\n');
    // 只输出文件名，不带目录；哈希必须是小写（下载侧按小写比对）
    assert.match(res.stdout, /^[0-9a-f]{32} {2}MPlayer-v1\.9\.1\.apk\n$/);
  });
});

test('多个文件按参数顺序各输出一行', () => {
  withTempDir((dir) => {
    const a = writeFixture(dir, 'a.apk', 'first');
    const b = writeFixture(dir, 'b.apk', 'second');
    const res = run([a, b]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.stdout, [md5(Buffer.from('first')) + '  a.apk', md5(Buffer.from('second')) + '  b.apk'].join('\n') + '\n');
  });
});

test('--out 写入的文件与 stdout 完全一致', () => {
  withTempDir((dir) => {
    const file = writeFixture(dir, 'MPlayer-v1.9.1.apk', 'payload');
    const outFile = path.join(dir, 'MPlayer-v1.9.1.apk.md5');
    const res = run([file, '--out', outFile]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(fs.readFileSync(outFile, 'utf8'), res.stdout);
    assert.equal(res.stdout, md5(Buffer.from('payload')) + '  MPlayer-v1.9.1.apk\n');
  });
});

test('空文件也给出标准 md5（d41d8c…）而不是报错', () => {
  withTempDir((dir) => {
    const file = writeFixture(dir, 'empty.apk', '');
    const res = run([file]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.stdout, 'd41d8cd98f00b204e9800998ecf8427e  empty.apk\n');
  });
});

test('超过 8MB 的文件按流式读取算出正确 md5（不整读入内存）', () => {
  withTempDir((dir) => {
    const big = Buffer.concat([Buffer.alloc(6 * 1024 * 1024, 0x61), Buffer.alloc(2 * 1024 * 1024, 0x62)]);
    const file = writeFixture(dir, 'big.apk', big);
    const res = run([file]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.stdout, md5(big) + '  big.apk\n');
    const source = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(source, /createReadStream\(/);
    assert.doesNotMatch(source, /readFileSync/);
  });
});

test('缺参数 exit 2 并给中文用法', () => {
  const res = run([]);
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.match(res.stderr, /缺少输入文件/);
  assert.match(res.stderr, /用法/);
});

test('未知选项 exit 2 并指出是哪个选项', () => {
  withTempDir((dir) => {
    const file = writeFixture(dir, 'x.apk', 'x');
    const res = run(['--bogus', file]);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stderr, /未知选项: --bogus/);
  });
});

test('文件不存在 exit 2 并指出路径', () => {
  withTempDir((dir) => {
    const missing = path.join(dir, 'not-downloaded.apk');
    const res = run([missing]);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.ok(res.stderr.includes(missing), res.stderr);
    assert.equal(res.stdout, '', '失败时不得吐出半截校验行');
  });
});
