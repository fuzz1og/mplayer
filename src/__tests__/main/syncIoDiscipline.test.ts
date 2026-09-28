import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #412 守卫：**主进程请求路径上不得有全量同步文件读写**。
 *
 * 这类退化肉眼很难发现（新增一行 `fs.readFileSync` 就能把主进程的事件循环连带
 * IPC / 托盘 / 封面刷新一起卡住），所以在源码层面钉住。断言必须去掉注释——
 * 注释里常常**引用**被禁掉的旧写法。
 */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
/** 仓库根：本文件在 <root>/src/__tests__/main/ 下 */
const read = (rel: string) => readFileSync(join(testDir, '..', '..', '..', rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 按大括号配对切出一个方法体。用法名签名定位定义处（方法名也会出现在调用点），
 * 且不依赖缩进或局部变量名——后者会随重构漂移，钉不住真正的结构。
 */
function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `源码里找不到 ${signature}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`无法切出 ${signature} 的方法体`);
}

/**
 * 一处「原子替换」落盘：内容必须先写进 `.tmp`，再 `rename` 到最终路径。
 *
 * 变量名从 `.tmp` 赋值里现取（不钉 `temp` 这种会漂移的局部变量名），并断言该方法体里
 * **没有**第二条直接写最终路径的 writeFile——只有 tmp→rename 一条落盘路径。
 */
function expectAtomicReplace(source: string, signature: string): void {
  const body = methodBody(source, signature);
  const tmpDecl = /const\s+(\w+)\s*=\s*`[^`]*\.tmp`/.exec(body);
  expect(tmpDecl, `${signature} 必须先把内容写进 .tmp`).not.toBeNull();
  const tmp = tmpDecl![1];
  const writes = [...body.matchAll(/await fsp\.writeFile\(([^,]+),/g)].map((m) => m[1].trim());
  expect(writes.length, `${signature} 至少要有一处 writeFile`).toBeGreaterThan(0);
  expect(writes.every((target) => target === tmp), `${signature} 的 writeFile 目标必须都是 .tmp`).toBe(true);
  const rename = new RegExp('await fsp\\.rename\\(' + tmp + ',\\s*([^)]+)\\)').exec(body);
  expect(rename, `${signature} 必须把 ${tmp} rename 到最终路径`).not.toBeNull();
  expect(rename![1].trim()).not.toMatch(/\.tmp/);
}

describe('主进程同步 I/O 纪律（#412）', () => {
  it('downloadService 的读写全部走 fs/promises', () => {
    const src = stripComments(read('src/main/services/downloadService.ts'));
    expect(src).toContain("from 'fs/promises'");
    for (const bad of ['readFileSync', 'writeFileSync', 'renameSync']) {
      expect(src, bad).not.toContain(bad);
    }
  });

  it('扩展名修正只读文件头，不再整文件读入', () => {
    const src = stripComments(read('src/main/services/downloadService.ts'));
    // 只允许通过 readAudioHeader 拿前 16 字节
    expect(src).toContain('readAudioHeader(filePath)');
    expect(src).toMatch(/detectAudioContainer\(await readAudioHeader/);
  });

  it('汽水音频流式落盘（不再整段进内存），且播放请求路径上没有 existsSync', () => {
    const src = stripComments(read('src/main/main.ts'));
    // #426：arraybuffer 整段进内存 → stream + 后端流式入口
    expect(src).not.toContain("responseType: 'arraybuffer'");
    expect(src).toContain("responseType: 'stream'");
    expect(src).toContain('await audioCacheBackend.writeFromStream(cacheKey, dl.data)');
    // 存在性检查改异步（fileExists 用 fsp.stat）
    expect(src).not.toMatch(/fs\.existsSync\(cachedPath\)/);
    expect(src).toContain('await fileExists(cachedPath)');

    // ADR-0002：调用方不自己开写流、不手拼落盘路径。原先的
    // `not.toContain('createWriteStream')` 在改动前也成立（这条腿当时走 arraybuffer），
    // 对本次变更没有约束力；改成对**这条腿**有约束力的结构断言：
    const soda = methodBody(src, 'async getSodaPlayableUrl(');
    expect(soda).not.toMatch(/createWriteStream|writeFile|\.pipe\(/);
    // 下载流只作为 writeFromStream 的入参被消费一次：再出现就说明被另一条写盘路径拿走了
    expect(soda.match(/dl\.data/g) ?? []).toHaveLength(1);
  });

  it('汽水音频缓存有大小预算，落盘后异步回收', () => {
    const src = stripComments(read('src/main/main.ts'));
    expect(src).toContain('SODA_AUDIO_CACHE_MAX_BYTES');
    expect(src).toContain('SODA_AUDIO_CACHE_KEY_PREFIX');
    expect(src).toContain(
      'void enforceKeyBudget(audioCacheBackend, SODA_AUDIO_CACHE_KEY_PREFIX, SODA_AUDIO_CACHE_MAX_BYTES)',
    );
    // 磁盘布局不往调用方泄漏：main.ts 里不该出现手拼的 ...'cache', 'bin'
    expect(src).not.toMatch(/path\.join\([^)]*'cache', 'bin'/);
    expect(src).not.toContain('readdir');
  });

  it('回收按 key 前缀精确淘汰，不扫目录误伤其它 bin 条目', () => {
    const budget = stripComments(read('src/main/cache/binCacheBudget.ts'));
    expect(budget).toContain('export async function enforceKeyBudget');
    // 用后端 keys() + 前缀筛选（#410 的接口），而不是 readdir 整个 bin 目录
    expect(budget).toContain('await backend.keys()');
    expect(budget).toContain('key.startsWith(keyPrefix)');
    expect(budget).not.toContain('readdir');
    // 路径由后端解释
    expect(budget).toContain('backend.getFilePath(key)');
    // 全程异步
    expect(budget).not.toContain('statSync');
    expect(budget).not.toContain('unlinkSync');
  });

  it('异步存在性检查只有一份实现', () => {
    const helper = stripComments(read('src/main/utils/fsAsync.ts'));
    expect(helper).toContain('export async function fileExists');
    // 两处调用方都引用它，而不是各自再写一份
    expect(stripComments(read('src/main/main.ts'))).toContain("from './utils/fsAsync'");
    expect(stripComments(read('src/main/services/localMusicService.ts'))).toContain("from '../utils/fsAsync'");
    expect(stripComments(read('src/main/services/localMusicService.ts'))).not.toMatch(/async function fileExists/);
  });

  it('本地曲库：异步遍历 + 有界并发 + 两处落盘都是 tmp→rename 原子替换', () => {
    const src = stripComments(read('src/main/services/localMusicService.ts'));
    expect(src).not.toContain('readdirSync');
    expect(src).not.toContain('writeFileSync');
    expect(src).toContain('PARSE_CONCURRENCY');
    expect(src).toContain('await fsp.readdir(dir');
    // #426：整份重写 → 分表（folders.json + songs-<hash>.json），并经 saveChain 串行化
    expect(src).toContain('this.saveChain');
    expect(src).toContain('FOLDERS_INDEX_FILE');
    expect(src).toContain('SONGS_SHARD_PREFIX');
    // 不再把整个 store 一次 stringify 落盘
    expect(src).not.toContain('JSON.stringify(this.store');
    // 分表之后有**两处**落盘（歌曲分片、目录清单），都必须先写 .tmp 再 rename。
    // 旧断言只钉了分片那一处、且靠局部变量名 `temp` 匹配——这里按方法体结构钉住两处。
    expectAtomicReplace(src, 'private async writeShard(');
    expectAtomicReplace(src, 'private async writeFoldersIndex(');
  });

  it('fs.watch 事件合并，且落地处理里的存在性检查是异步的', () => {
    const src = stripComments(read('src/main/services/localMusicService.ts'));
    expect(src).toContain('WATCH_DEBOUNCE_MS');
    expect(src).toMatch(/private async handleWatchEvent/);
    expect(src).toContain('await fileExists(fullPath)');
    expect(src).not.toMatch(/fs\.existsSync\(fullPath\)/);
    // 定时器要能被清理，否则停机后仍有解析与 IPC 落地
    expect(src).toContain('clearWatchTimers');
  });
});
