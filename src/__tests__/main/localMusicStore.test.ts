import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { LocalSong } from '@mplayer/core';

const state = vi.hoisted(() => ({ dir: '' }));
/** 记录真正落到 fs/promises 的写：`path` → 每次 writeFile 的字节数（含临时文件） */
const io = vi.hoisted(() => ({
  writes: [] as { path: string; bytes: number }[],
  inflight: new Map<string, number>(),
  maxInflight: 0,
}));

vi.mock('electron', () => ({ app: { getPath: () => state.dir } }));

// 标签解析不是本票的观察对象：给每个真实存在的文件一个确定的名字即可
vi.mock('music-metadata', () => ({
  parseFile: async (filePath: string) => ({
    common: {
      title: filePath.split(/[\\/]/).pop() ?? filePath,
      artist: '测试歌手',
      album: '测试专辑',
    },
    format: { duration: 200 },
  }),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const track = <T>(target: unknown, run: () => Promise<T>): Promise<T> => {
    const key = String(target);
    const now = (io.inflight.get(key) ?? 0) + 1;
    io.inflight.set(key, now);
    io.maxInflight = Math.max(io.maxInflight, now);
    return run().finally(() => {
      io.inflight.set(key, (io.inflight.get(key) ?? 1) - 1);
    }) as Promise<T>;
  };
  const writeFile = ((target: any, data: any, options?: any) => {
    io.writes.push({
      path: String(target),
      bytes: typeof data === 'string' ? Buffer.byteLength(data) : (data?.byteLength ?? 0),
    });
    return track(target, () => actual.writeFile(target, data, options));
  }) as typeof actual.writeFile;
  const rename = ((from: any, to: any) => track(from, () => actual.rename(from, to))) as typeof actual.rename;
  return { ...actual, default: { ...actual, writeFile, rename }, writeFile, rename };
});

import { LocalMusicService } from '../../main/services/localMusicService';

const dataDir = () => path.join(state.dir, 'data');
const shardName = (folderPath: string) =>
  `songs-${crypto.createHash('md5').update(folderPath).digest('hex')}.json`;
const shardPath = (folderPath: string) => path.join(dataDir(), shardName(folderPath));
const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));

/** data/ 下所有 JSON 文件的内容快照：用来断言「哪些文件被重写了」 */
function snapshotDataFiles(): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of fs.readdirSync(dataDir())) {
    if (!name.endsWith('.json')) continue;
    out.set(name, fs.readFileSync(path.join(dataDir(), name), 'utf-8'));
  }
  return out;
}

function localSong(id: string): LocalSong {
  return {
    id,
    name: path.basename(id),
    artist: '测试歌手',
    album: '测试专辑',
    duration: 200,
    sourceType: 'local',
    filePath: id,
    format: 'mp3',
    fileSize: 1,
  };
}

function makeLibrary(root: string, folder: string, songCount: number): string {
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < songCount; i++) {
    fs.writeFileSync(path.join(dir, `${folder}${i}.mp3`), 'not-real-audio');
  }
  return dir;
}

let service: LocalMusicService | null = null;

beforeEach(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-local-store-'));
  io.writes.length = 0;
  io.inflight.clear();
  io.maxInflight = 0;
});

afterEach(() => {
  service?.destroy();
  service = null;
  if (state.dir) fs.rmSync(state.dir, { recursive: true, force: true });
  state.dir = '';
});

/**
 * #426 B：本地曲库从「`JSON.stringify(this.store, null, 2)` 整份重写」改成
 * `folders.json`（目录清单）+ 每目录一个 `songs-<hash>.json` 分片——变更只写受影响的那一片。
 * 加载路径与 IPC 面不变（对外仍是同一个 store 视图）。
 */
describe('#426 本地曲库分表：只写变更的分片', () => {
  it('加一个目录只写它的分片与目录清单，其它分片一个字节都不动', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 40);
    const b = makeLibrary(state.dir, 'B', 1);

    await service.addFolder(a);
    const before = snapshotDataFiles();

    io.writes.length = 0;
    await service.addFolder(b);
    const after = snapshotDataFiles();

    const changed = [...after.keys()].filter((name) => before.get(name) !== after.get(name));
    expect(changed.sort()).toEqual([shardName(b), 'folders.json'].sort());
    // A 的分片（40 首）一个字节都没被重写
    expect(after.get(shardName(a))).toBe(before.get(shardName(a)));

    // 写盘量恰好等于「新增的那一片 + 清单」，与曲库总规模无关
    const written = io.writes.reduce((sum, w) => sum + w.bytes, 0);
    expect(written).toBe(
      Buffer.byteLength(after.get(shardName(b))!) + Buffer.byteLength(after.get('folders.json')!),
    );
  });

  it('单次变更的写盘量与曲库总规模无关（A 从 10 首涨到 200 首，写盘字节数不变）', async () => {
    const measure = async (librarySongs: number): Promise<number> => {
      state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-local-store-scale-'));
      const svc = new LocalMusicService(state.dir);
      const a = makeLibrary(state.dir, 'A', librarySongs);
      const b = makeLibrary(state.dir, 'B', 1);
      await svc.addFolder(a);
      io.writes.length = 0;
      await svc.addFolder(b);
      const written = io.writes.reduce((sum, w) => sum + w.bytes, 0);
      svc.destroy();
      return written;
    };

    expect(await measure(200)).toBe(await measure(10));
  });

  it('内容没变的目录一个字节都不写；变了的只重写它那一片', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 3);
    const b = makeLibrary(state.dir, 'B', 3);
    await service.addFolder(a);
    await service.addFolder(b);

    const songsOfA = await service.getSongs(a);
    io.writes.length = 0;
    await service.updateFolderSongs(a, songsOfA);
    expect(io.writes).toEqual([]);

    io.writes.length = 0;
    await service.updateFolderSongs(a, [...songsOfA, localSong('A/new.mp3')]);
    expect(io.writes.map((w) => path.basename(w.path))).toEqual([`${shardName(a)}.tmp`]);
    expect(readJson(shardPath(a)).map((s: LocalSong) => s.id)).toEqual([
      ...songsOfA.map((s) => s.id),
      'A/new.mp3',
    ]);
  });

  it('并发写同一分片：串行落盘、文件完整，最终内容就是最后一次变更后的状态', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 1);
    await service.addFolder(a);

    io.maxInflight = 0;
    const writes = Array.from({ length: 10 }, (_, i) =>
      service!.updateFolderSongs(a, [localSong(`A/track-${i}.mp3`)]),
    );
    await Promise.all(writes);

    // 同一个临时文件的写入/改名从不交叠
    expect(io.maxInflight).toBe(1);
    expect(readJson(shardPath(a)).map((s: LocalSong) => s.id)).toEqual(['A/track-9.mp3']);
    expect((await service.getSongs(a)).map((s) => s.id)).toEqual(['A/track-9.mp3']);
  });

  it('加载合并：新实例从 folders.json + 各分片读出同一个 store 视图（IPC 面不变）', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 2);
    const b = makeLibrary(state.dir, 'B', 3);
    await service.addFolder(a);
    await service.addFolder(b);
    service.destroy();

    const reopened = new LocalMusicService(state.dir);
    service = reopened;
    expect((await reopened.getFolders()).map((f) => [f.name, f.songCount])).toEqual([
      ['A', 2],
      ['B', 3],
    ]);
    expect(await reopened.getSongs(a)).toHaveLength(2);
    expect(await reopened.getSongs(b)).toHaveLength(3);
    expect(await reopened.getSongs()).toHaveLength(5);
    expect(fs.existsSync(path.join(dataDir(), 'folders.json'))).toBe(true);
  });

  it('分片损坏/缺失时曲库仍可读：只有那一个目录为空', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 2);
    const b = makeLibrary(state.dir, 'B', 2);
    await service.addFolder(a);
    await service.addFolder(b);
    service.destroy();

    fs.writeFileSync(shardPath(a), '{ 半个文件');
    fs.rmSync(shardPath(b));

    const reopened = new LocalMusicService(state.dir);
    service = reopened;
    expect((await reopened.getFolders()).map((f) => f.name)).toEqual(['A', 'B']);
    expect(await reopened.getSongs(a)).toEqual([]);
    expect(await reopened.getSongs(b)).toEqual([]);
  });

  it('删除目录：分片被删、清单更新，重启后不再出现', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 2);
    const b = makeLibrary(state.dir, 'B', 2);
    await service.addFolder(a);
    await service.addFolder(b);

    await service.removeFolder(a);
    expect(fs.existsSync(shardPath(a))).toBe(false);
    expect(readJson(path.join(dataDir(), 'folders.json')).map((f: { path: string }) => f.path)).toEqual([b]);

    service.destroy();
    const reopened = new LocalMusicService(state.dir);
    service = reopened;
    expect((await reopened.getFolders()).map((f) => f.name)).toEqual(['B']);
  });

  it('旧单文件迁移：首次落盘拆成清单 + 分片，数据不丢，单文件退役为 .migrated', async () => {
    const legacyFolder = path.join(state.dir, 'Legacy');
    fs.mkdirSync(path.join(state.dir, 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(state.dir, 'data', 'local-music.json'),
      JSON.stringify({
        folders: [
          {
            path: legacyFolder,
            name: 'Legacy',
            songs: [localSong(path.join(legacyFolder, 'old.mp3'))],
            lastScanned: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          },
        ],
      }),
    );

    service = new LocalMusicService(state.dir);
    // 装载路径不变：老单文件照读
    expect((await service.getSongs(legacyFolder)).map((s) => s.id)).toEqual([path.join(legacyFolder, 'old.mp3')]);

    // 第一次落盘（加一个目录）把清单 + 所有分片一次写齐，然后才退役单文件
    const c = makeLibrary(state.dir, 'C', 1);
    await service.addFolder(c);

    expect(readJson(shardPath(legacyFolder)).map((s: LocalSong) => s.id)).toEqual([path.join(legacyFolder, 'old.mp3')]);
    expect(fs.existsSync(path.join(dataDir(), 'local-music.json'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir(), 'local-music.json.migrated'))).toBe(true);

    service.destroy();
    const reopened = new LocalMusicService(state.dir);
    service = reopened;
    expect((await reopened.getSongs()).map((s) => s.id).sort()).toEqual(
      [path.join(legacyFolder, 'old.mp3'), path.join(c, 'C0.mp3')].sort(),
    );
  });
});
