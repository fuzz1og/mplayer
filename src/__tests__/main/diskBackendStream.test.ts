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
    const source = new Readable({ read() {} });
    const pending = backend.writeFromStream('bin:soda:aborted', source);
    source.push(audioPayload(1024));
    await new Promise((resolve) => setTimeout(resolve, 20));
    source.destroy(new Error('aborted'));

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
describe('#426 流式写入的内存峰值（验收 A1 的佐证）', () => {
  it('16MB 负载边收边落盘：内存里不出现整段音频 buffer', async () => {
    const backend = new DiskCacheBackend(dir);
    const CHUNK = 64 * 1024;
    const total = 16 * 1024 * 1024;
    // 分片复用同一块 64KB，源侧本身不持有整段负载
    const chunk = audioPayload(CHUNK);
    let peak = process.memoryUsage().arrayBuffers;
    async function* chunks() {
      for (let written = 0; written < total; written += CHUNK) {
        peak = Math.max(peak, process.memoryUsage().arrayBuffers);
        yield chunk;
      }
    }

    const before = process.memoryUsage().arrayBuffers;
    await backend.writeFromStream('bin:soda:big', Readable.from(chunks()));
    peak = Math.max(peak, process.memoryUsage().arrayBuffers);

    // 旧实现（arraybuffer 整段下载）这里至少要驻留一整份 16MB
    expect(peak - before).toBeLessThan(total / 4);
    const files = dataFiles('bin');
    expect(files).toHaveLength(1);
    expect(fs.statSync(path.join(dir, 'bin', files[0])).size).toBe(total);
    expect(backend.stats().totalSize).toBe(total);
  });
});
