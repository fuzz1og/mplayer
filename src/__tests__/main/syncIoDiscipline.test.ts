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
const read = (rel: string) => readFileSync(join(testDir, '..', '..', rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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

  it('汽水音频不再复制多份，且播放请求路径上没有 existsSync', () => {
    const src = stripComments(read('src/main/main.ts'));
    expect(src).not.toContain('Buffer.from(dl.data)');
    expect(src).toContain('new Uint8Array(dl.data as ArrayBuffer)');
    // 存在性检查改异步（fileExists 用 fsp.stat）
    expect(src).not.toMatch(/fs\.existsSync\(cachedPath\)/);
    expect(src).toContain('await fileExists(cachedPath)');
  });

  it('cache/bin 有大小预算，落盘后异步回收', () => {
    const src = stripComments(read('src/main/main.ts'));
    expect(src).toContain('SODA_AUDIO_CACHE_MAX_BYTES');
    expect(src).toMatch(/function pruneBinCache/);
    expect(src).toContain('void pruneBinCache(sodaAudioBinDir)');
    // 回收本身也必须异步
    expect(src).toContain('await fsp.readdir(binDir)');
  });

  it('本地曲库：异步遍历 + 有界并发 + 原子写盘', () => {
    const src = stripComments(read('src/main/services/localMusicService.ts'));
    expect(src).not.toContain('readdirSync');
    expect(src).not.toContain('writeFileSync');
    expect(src).toContain('PARSE_CONCURRENCY');
    expect(src).toContain('await fsp.readdir(dir');
    // 全量重写改成 tmp + rename 原子替换，并经 saveChain 串行化
    expect(src).toContain('this.saveChain');
    expect(src).toMatch(/await fsp\.rename\(tmpFile, this\.storeFile\)/);
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
