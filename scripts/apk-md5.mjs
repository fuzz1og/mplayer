#!/usr/bin/env node
/**
 * apk-md5.mjs — #725：生成 md5sum 兼容的 APK 校验行；流式哈希，55MB 不进内存。
 * 退出码 0 成功 / 2 参数或输入问题 / 1 读写失败。
 */

import { createHash } from 'node:crypto';
import { createReadStream, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const USAGE = [
  '用法: node scripts/apk-md5.mjs <文件...> [--out <输出文件>]',
  '输出: 每行 `<md5>  <文件名>`（文件名取 basename，md5sum -c 兼容）；同时写 stdout 与 --out。',
].join('\n');

function fail(message) {
  console.error('✗ ' + message);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv) {
  const files = [];
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out' || arg === '-o') {
      out = argv[i + 1];
      if (!out) fail('--out 缺少参数（要写入的文件路径）');
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg.startsWith('-')) {
      fail('未知选项: ' + arg);
    } else {
      files.push(arg);
    }
  }
  if (files.length === 0) fail('缺少输入文件');
  return { files, out };
}

/** 流式哈希；中间读失败按 I/O 错误处理（退出码 1），与参数错误区分开。 */
async function md5Of(file) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    fail('读不到文件: ' + file);
  }
  if (!stat.isFile()) fail('不是普通文件: ' + file);

  const hash = createHash('md5');
  try {
    for await (const chunk of createReadStream(file)) hash.update(chunk);
  } catch (err) {
    console.error('✗ 读取失败: ' + file + '（' + err.message + '）');
    process.exit(1);
  }
  return hash.digest('hex');
}

const { files, out } = parseArgs(process.argv.slice(2));

const lines = [];
for (const file of files) {
  lines.push((await md5Of(file)) + '  ' + path.basename(file));
}
const payload = lines.join('\n') + '\n';

process.stdout.write(payload);

if (out) {
  try {
    writeFileSync(out, payload, 'utf8');
  } catch (err) {
    console.error('✗ 写不进 ' + out + '（' + err.message + '）');
    process.exit(1);
  }
}
