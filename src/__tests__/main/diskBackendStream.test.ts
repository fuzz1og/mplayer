import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { DiskCacheBackend } from '../../main/cache/diskBackend';

let dir = '';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-disk-cache-stream-'));
});

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** 一个带 ID3 头的假音频负载（够 core 的 isAudioBytes/文件头判定用） */
function audioPayload(size = 4096): Buffer {
  const buf = Buffer.alloc(size, 0x11);
  buf.write('ID3', 0, 'ascii');
  return buf;
}

const dataFiles = (type: 'bin' | 'json') => fs.readdirSync(path.join(dir, type));

/** 把 buffer 切成固定大小的多块（模拟下载流的 chunk 序列） */
function* chunkify(buf: Buffer, size: number): Generator<Buffer> {
  for (let offset = 0; offset < buf.length; offset += size) {
    yield buf.subarray(offset, offset + size);
  }
}

/** 手动驱动的读流：测试自己决定何时 push / 结束 / 中断，不靠 sleep 抢时序 */
function controlledStream(): {
  stream: Readable;
  push: (chunk: Buffer) => void;
  end: () => void;
  fail: (error: Error) => void;
} {
  const stream = new Readable({ read() {} });
  return {
    stream,
    push: (chunk) => {
      stream.push(chunk);
    },
    end: () => {
      stream.push(null);
    },
    fail: (error) => {
      stream.destroy(error);
    },
  };
}

/** 轮询到条件成立（默认 3s 上限）：等的是「磁盘上已经发生的事实」，不是固定时长 */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (predicate()) return;
    } catch {
      // 目录/文件还没出现，继续等
    }
    if (Date.now() > deadline) throw new Error('waitFor 超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** bin/ 里正在写的临时文件绝对路径（流式写入先写 .tmp 再 rename） */
function streamTempPath(): string {
  const name = dataFiles('bin').find((file) => file.endsWith('.tmp'));
  return name ? path.join(dir, 'bin', name) : '';
}

/**
 * #426 A：汽水音频从「整段 arraybuffer 进内存」改成流式落盘。流式入口的**记账语义必须与
 * `write()` 完全一致**（同一个 key 规则、同一份 meta、同一个写队列），否则这类条目会从
 * `stats()`/`keys()` 里消失——正是 #410 建立的记账纪律。
 */
describe('#426 DiskCacheBackend 流式写入：记账与 write() 一致', () => {
  it('二进制条目：流式写入的 size/kind 与 write() 相同（stats 增量一致）', async () => {
    const backend = new DiskCacheBackend(dir);
    const payload = audioPayload();

    const before = backend.stats();
    await backend.write('bin:soda:buffered', new Uint8Array(payload));
    const afterWrite = backend.stats();

    await backend.writeFromStream(
      'bin:soda:streamed',
      Readable.from([payload.subarray(0, 1000), payload.subarray(1000)]),
    );
    const afterStream = backend.stats();

    expect(afterStream.totalSize - afterWrite.totalSize).toBe(afterWrite.totalSize - before.totalSize);
    expect(afterStream.audioCount - afterWrite.audioCount).toBe(afterWrite.audioCount - before.audioCount);
    expect(afterStream.fileCount - afterWrite.fileCount).toBe(afterWrite.fileCount - before.fileCount);

    const streamed = await backend.read('bin:soda:streamed');
    expect(streamed).not.toBeNull();
    expect(Buffer.from(streamed!).equals(payload)).toBe(true);
    expect(await backend.keys()).toEqual(expect.arrayContaining(['bin:soda:buffered', 'bin:soda:streamed']));
  });

  it('JSON 条目：流式写入也按内容判定 kind（与 write() 同口径）', async () => {
    const backend = new DiskCacheBackend(dir);

    await backend.write(':json:search:1', new TextEncoder().encode('[{"id":"1"}]'));
    await backend.writeFromStream(
      ':json:search:2',
      Readable.from([Buffer.from('[{"id":"2"}]', 'utf-8')]),
    );

    expect(backend.stats()).toMatchObject({ fileCount: 2, songsCount: 2 });
  });

  it('流式写入不留下临时文件（最终目录里只有数据文件）', async () => {
    const backend = new DiskCacheBackend(dir);
    await backend.writeFromStream('bin:soda:1', Readable.from([audioPayload()]));

    expect(dataFiles('bin')).toHaveLength(1);
    expect(dataFiles('bin')[0]).not.toMatch(/tmp/);
  });

  it('JSON 歌曲列表 >1MB：流式写入的 kind/size/stats/keys 与 write() 完全一致', async () => {
    const backend = new DiskCacheBackend(dir);
    const payload = Buffer.from(
      JSON.stringify(Array.from({ length: 40000 }, (_, i) => ({ id: 'song-' + i, name: '曲目' + i }))),
      'utf-8',
    );
    expect(payload.byteLength).toBeGreaterThan(1024 * 1024);

    const before = backend.stats();
    await backend.write(':json:search:buffered', new Uint8Array(payload));
    const afterWrite = backend.stats();
    await backend.writeFromStream(':json:search:streamed', Readable.from(chunkify(payload, 64 * 1024)));
    const afterStream = backend.stats();

    // 记账增量逐项对齐：kind 若被归到 other，songsCount 的增量就不等了
    expect(afterStream.totalSize - afterWrite.totalSize).toBe(afterWrite.totalSize - before.totalSize);
    expect(afterStream.songsCount - afterWrite.songsCount).toBe(afterWrite.songsCount - before.songsCount);
    expect(afterStream.fileCount - afterWrite.fileCount).toBe(afterWrite.fileCount - before.fileCount);
    expect(await backend.keys()).toEqual(
      expect.arrayContaining([':json:search:buffered', ':json:search:streamed']),
    );
    expect(Buffer.from((await backend.read(':json:search:streamed'))!).equals(payload)).toBe(true);
  });

  it('JSON URL 条目 >1MB：同样按 urls 归类（不是 other）', async () => {
    const backend = new DiskCacheBackend(dir);
    const payload = Buffer.from(
      JSON.stringify({ url: 'https://example.com/a.mp3', lrc: 'x'.repeat(1024 * 1024) }),
      'utf-8',
    );
    expect(payload.byteLength).toBeGreaterThan(1024 * 1024);

    const before = backend.stats();
    await backend.writeFromStream(':json:url:big', Readable.from(chunkify(payload, 64 * 1024)));
    expect(backend.stats().urlsCount - before.urlsCount).toBe(1);
  });

  it('超过 1MB 的损坏 JSON：两边都归 other，不存在「只有流式才有」的分类', async () => {
    const backend = new DiskCacheBackend(dir);
    const broken = Buffer.from('x'.repeat(1024 * 1024 + 64), 'utf-8');

    const before = backend.stats();
    await backend.write(':json:broken:buffered', new Uint8Array(broken));
    const afterWrite = backend.stats();
    await backend.writeFromStream(':json:broken:streamed', Readable.from(chunkify(broken, 64 * 1024)));
    const afterStream = backend.stats();

    expect(afterWrite.songsCount - before.songsCount).toBe(0);
    expect(afterWrite.urlsCount - before.urlsCount).toBe(0);
    expect(afterStream.songsCount - afterWrite.songsCount).toBe(0);
    expect(afterStream.urlsCount - afterWrite.urlsCount).toBe(0);
    expect(afterStream.fileCount - afterWrite.fileCount).toBe(afterWrite.fileCount - before.fileCount);
  });
});
/** 推到一半就出错的读流（模拟 axios 流 ECONNRESET / 上游 5xx 中断） */
function failingStream(chunks: Buffer[], error: Error): Readable {
  let sent = false;
  return new Readable({
    read() {
      if (sent) return;
      sent = true;
      for (const chunk of chunks) this.push(chunk);
      this.destroy(error);
    },
  });
}

describe('#426 DiskCacheBackend 流式写入：中断不留半个文件', () => {
  it('source 中途抛错：不留数据文件、不留 meta、stats/keys 不变', async () => {
    const backend = new DiskCacheBackend(dir);
    const before = backend.stats();

    await expect(
      backend.writeFromStream('bin:soda:broken', failingStream([audioPayload(2048)], new Error('boom'))),
    ).rejects.toThrow('boom');

    expect(dataFiles('bin')).toEqual([]);
    expect(fs.readdirSync(path.join(dir, 'meta'))).toEqual([]);
    expect(backend.stats()).toMatchObject({ fileCount: before.fileCount, totalSize: before.totalSize });
    expect(await backend.keys()).not.toContain('bin:soda:broken');
    expect(await backend.read('bin:soda:broken')).toBeNull();
  });

  it('source 被 destroy（下载被中断）：同样不留文件', async () => {
    const backend = new DiskCacheBackend(dir);
    const source = controlledStream();
    const pending = backend.writeFromStream('bin:soda:aborted', source.stream);
    source.push(audioPayload(1024));

    // 等这一块**真的落到临时文件**再中断：中断点确定在「写到一半」，
    // 不再靠 setTimeout 去赌「检查时刚好还没收完」
    await waitFor(() => {
      const temp = streamTempPath();
      return temp !== '' && fs.statSync(temp).size >= 1024;
    });

    source.fail(new Error('aborted'));
    await expect(pending).rejects.toThrow('aborted');
    expect(dataFiles('bin')).toEqual([]);
    expect(await backend.keys()).toEqual([]);
  });

  it('覆盖已有条目时中断：旧条目与记账原样保留', async () => {
    const backend = new DiskCacheBackend(dir);
    const old = audioPayload(1024);
    await backend.write('bin:soda:1', new Uint8Array(old));
    const before = backend.stats();

    await expect(
      backend.writeFromStream('bin:soda:1', failingStream([audioPayload(2048)], new Error('boom'))),
    ).rejects.toThrow('boom');

    expect(Buffer.from((await backend.read('bin:soda:1'))!).equals(old)).toBe(true);
    expect(backend.stats()).toMatchObject({ fileCount: 1, totalSize: before.totalSize });
    expect(dataFiles('bin')).toHaveLength(1);
  });

  it('进程被杀留下的临时文件在索引装载时清扫，且从不进 stats/keys', async () => {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'abandoned-hash.8f3a1c.tmp'), 'half-downloaded');

    const backend = new DiskCacheBackend(dir);
    await backend.ensureIndexReady();

    expect(fs.readdirSync(binDir)).toEqual([]);
    expect(backend.stats().fileCount).toBe(0);
    expect(await backend.keys()).toEqual([]);
  });
});
describe('#426 流式写入的内存/增量口径（验收 A1 的佐证）', () => {
  it('32MB 负载边收边落盘：arrayBuffers 峰值远低于载荷（不出现整段缓冲）', async () => {
    const backend = new DiskCacheBackend(dir);
    const CHUNK = 64 * 1024;
    const total = 32 * 1024 * 1024;
    // 分片复用同一块 64KB，源侧本身不持有整段负载
    const chunk = audioPayload(CHUNK);
    const before = process.memoryUsage().arrayBuffers;
    let peak = before;
    async function* chunks() {
      for (let written = 0; written < total; written += CHUNK) {
        peak = Math.max(peak, process.memoryUsage().arrayBuffers);
        yield chunk;
      }
    }

    await backend.writeFromStream('bin:soda:big', Readable.from(chunks()));
    peak = Math.max(peak, process.memoryUsage().arrayBuffers);

    // arrayBuffers 是**全进程**口径，慢机/GC 下会抖，所以不用「精确峰值」口径：
    // 载荷放大到 32MB、阈值放宽到载荷的 1/8（4MB）。旧实现（arraybuffer 整段下载）
    // 至少要同时驻留一整份 32MB，与阈值差一个数量级 —— 慢机抖动吃不掉这个余量。
    expect(peak - before).toBeLessThan(total / 8);
    const files = dataFiles('bin');
    expect(files).toHaveLength(1);
    expect(fs.statSync(path.join(dir, 'bin', files[0])).size).toBe(total);
    expect(backend.stats().totalSize).toBe(total);
  });

  it('边收边落盘：源只产出前半段时，磁盘上已经有前半段（不是收完才写）', async () => {
    const backend = new DiskCacheBackend(dir);
    const CHUNK = 64 * 1024;
    const source = controlledStream();
    const pending = backend.writeFromStream('bin:soda:partial', source.stream);

    source.push(audioPayload(CHUNK));
    await waitFor(() => {
      const temp = streamTempPath();
      return temp !== '' && fs.statSync(temp).size >= CHUNK;
    });
    source.push(audioPayload(CHUNK));
    await waitFor(() => {
      const temp = streamTempPath();
      return temp !== '' && fs.statSync(temp).size >= CHUNK * 2;
    });

    // 源还没结束，临时文件里已经有两个 chunk —— 这才是「边收边落盘」的确定性证据
    source.end();
    await pending;
    const files = dataFiles('bin');
    expect(files).toHaveLength(1);
    expect(files[0]).not.toMatch(/tmp/);
    expect(fs.statSync(path.join(dir, 'bin', files[0])).size).toBe(CHUNK * 2);
  });
});
