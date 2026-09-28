import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { LocalSong } from '@mplayer/core';

const state = vi.hoisted(() => ({ dir: '' }));
/**
 * 记录真正落到 fs/promises 的写（路径 / 字节数 / 调用顺序），并支持三类注入：
 * 一次性 rename 失败（清单写失败）、一次性 rm 失败（删分片失败）、可控写入闸门（编排交错）。
 */
const io = vi.hoisted(() => ({
  writes: [] as { path: string; bytes: number }[],
  events: [] as string[],
  /** 每次 folders.json 提交时的现场：清单引用的目录 + 当时缺失的分片 */
  commits: [] as { paths: string[]; missing: string[] }[],
  /** 「最新一次提交的清单仍引用它，却把这个分片删了」的现场（半更新窗口） */
  violations: [] as string[],
  inflight: new Map<string, number>(),
  maxInflight: 0,
  failNextRename: null as null | ((from: string, to: string) => Error | null),
  failNextRm: null as null | ((target: string) => Error | null),
  gateWrite: null as null | ((target: string) => Promise<void> | null),
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

/** 每次 folders.json 提交时的现场：清单引用的目录 + 当时缺失的分片（用于钉「清单不指向空分片」） */
function recordCommit(tempPath: string): void {
  try {
    const entries = JSON.parse(fs.readFileSync(tempPath, 'utf-8')) as { path: string }[];
    const paths = entries.map((entry) => entry.path);
    io.commits.push({ paths, missing: paths.filter((folderPath) => !fs.existsSync(shardPath(folderPath))) });
  } catch {
    // 清单内容读不到就不记（不影响被测行为）
  }
}

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
    io.events.push('write:' + String(target));
    const gate = io.gateWrite?.(String(target));
    return track(target, () =>
      gate ? gate.then(() => actual.writeFile(target, data, options)) : actual.writeFile(target, data, options),
    );
  }) as typeof actual.writeFile;
  const rename = ((from: any, to: any) => {
    const failure = io.failNextRename?.(String(from), String(to));
    if (failure) {
      io.failNextRename = null;
      return Promise.reject(failure);
    }
    io.events.push('rename:' + String(from) + '->' + String(to));
    if (String(to).endsWith('folders.json')) recordCommit(String(from));
    return track(from, () => actual.rename(from, to));
  }) as typeof actual.rename;
  const rm = ((target: any, options?: any) => {
    const failure = io.failNextRm?.(String(target));
    if (failure) {
      io.failNextRm = null;
      return Promise.reject(failure);
    }
    io.events.push('rm:' + String(target));
    // 违规现场：最新一次提交的清单仍引用这个分片，却要把它删掉
    // ——那就是「清单说有这个目录、分片已经没了」的半更新窗口（重启即丢歌）
    const committed = io.commits[io.commits.length - 1];
    if (committed?.paths.some((folderPath) => shardPath(folderPath) === String(target))) {
      io.violations.push(String(target));
    }
    return actual.rm(target, options);
  }) as typeof actual.rm;
  return { ...actual, default: { ...actual, writeFile, rename, rm }, writeFile, rename, rm };
});

import { LocalMusicService } from '../../main/services/localMusicService';

const dataDir = () => path.join(state.dir, 'data');
const foldersFile = () => path.join(dataDir(), 'folders.json');
const shardName = (folderPath: string) =>
  'songs-' + crypto.createHash('md5').update(folderPath).digest('hex') + '.json';
const shardPath = (folderPath: string) => path.join(dataDir(), shardName(folderPath));
const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const indexedPaths = () => readJson(foldersFile()).map((entry: { path: string }) => entry.path);

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
    fs.writeFileSync(path.join(dir, folder + i + '.mp3'), 'not-real-audio');
  }
  return dir;
}

/** 可控闸门：把一次写入卡住，用来编排「串行链被占住时的交错」 */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** 轮询到条件成立（等的是「状态真的到了」，不是固定时长） */
async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('waitUntil 超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let service: LocalMusicService | null = null;

beforeEach(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-local-store-'));
  io.writes.length = 0;
  io.events.length = 0;
  io.commits.length = 0;
  io.violations.length = 0;
  io.inflight.clear();
  io.maxInflight = 0;
  io.failNextRename = null;
  io.failNextRm = null;
  io.gateWrite = null;
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
 *
 * 分表的跨文件原子性：**清单是提交点**。先写分片、再写清单；删目录时先写清单、再删分片。
 * 任意两步之间崩溃只留**孤儿分片**（清单不引用 → 不可见），不会出现「清单有、分片无」＝丢歌。
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
    const written = io.writes.reduce((sum, item) => sum + item.bytes, 0);
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
      const written = io.writes.reduce((sum, item) => sum + item.bytes, 0);
      svc.destroy();
      return written;
    };

    expect(await measure(200)).toBe(await measure(10));
  });

  it('加目录：先写分片、后写清单（崩在中间只留不可见的孤儿分片）', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 1);

    io.events.length = 0;
    await service.addFolder(a);

    const shardWrite = io.events.findIndex((event) => event.startsWith('write:') && event.includes(shardName(a)));
    const indexWrite = io.events.findIndex((event) => event.startsWith('write:') && event.endsWith('folders.json.tmp'));
    expect(shardWrite).toBeGreaterThanOrEqual(0);
    expect(indexWrite).toBeGreaterThan(shardWrite);
    // 提交那一刻清单引用的分片都在
    expect(io.commits[io.commits.length - 1]?.missing).toEqual([]);
  });

  it('删目录：先落清单（提交点）再删分片——顺序本身就是崩溃安全的边界', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 1);
    await service.addFolder(a);

    io.events.length = 0;
    io.commits.length = 0;
    await service.removeFolder(a);

    const indexCommit = io.events.findIndex((event) => event.startsWith('rename:') && event.endsWith('folders.json'));
    const shardDrop = io.events.findIndex((event) => event.startsWith('rm:') && event.includes(shardName(a)));
    expect(indexCommit).toBeGreaterThanOrEqual(0);
    // 删分片排在清单提交**之后**：提交那一刻清单已不引用它，「清单有、分片无」不可能出现
    expect(shardDrop).toBeGreaterThan(indexCommit);
    expect(io.commits[io.commits.length - 1]?.paths).toEqual([]);
    expect(fs.existsSync(shardPath(a))).toBe(false);
  });

  it('重扫（refresh）：内容没变的目录不重写分片，变了的只重写它那一片', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 3);
    const b = makeLibrary(state.dir, 'B', 3);
    await service.addFolder(a);
    await service.addFolder(b);

    // 内容没变：分片指纹命中，一个分片都不重写（只有清单因 lastScanned 变化而重写）
    io.writes.length = 0;
    await service.refresh();
    expect(io.writes.map((item) => path.basename(item.path))).toEqual(['folders.json.tmp']);

    // A 里加一首：只重写 A 那一片
    const added = path.join(a, 'Anew.mp3');
    fs.writeFileSync(added, 'not-real-audio');
    io.writes.length = 0;
    await service.refresh();
    expect(io.writes.map((item) => path.basename(item.path))).toEqual([
      shardName(a) + '.tmp',
      'folders.json.tmp',
    ]);
    expect(readJson(shardPath(a)).map((song: LocalSong) => song.id)).toContain(added);
    expect(readJson(shardPath(b))).toHaveLength(3);
  });

  it('并发加目录：落盘全部串行（写入不交叠），清单与分片都完整', async () => {
    service = new LocalMusicService(state.dir);
    const dirs = Array.from({ length: 6 }, (_, i) => makeLibrary(state.dir, 'F' + i, 1));

    io.maxInflight = 0;
    await Promise.all(dirs.map((folder) => service!.addFolder(folder)));

    expect(io.maxInflight).toBe(1);
    expect(indexedPaths().sort()).toEqual([...dirs].sort());
    for (const folder of dirs) expect(fs.existsSync(shardPath(folder)), folder).toBe(true);

    service.destroy();
    const reopened = new LocalMusicService(state.dir);
    service = reopened;
    expect(await reopened.getSongs()).toHaveLength(6);
  });

  it('remove → re-add 交错：清单每次提交时它引用的分片都在（旧「调用时快照」会在这里翻车）', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 2);
    const b = makeLibrary(state.dir, 'B', 1);
    await service.addFolder(a);

    // 用一次被卡住的写把串行链占住：remove(A) 的 persist 排在它后面，
    // 期间 addFolder(A) 完成扫描并把 A 推回 store —— 正是旧实现「removed 快照」翻车的交错
    const gate = deferred();
    io.gateWrite = (target) => (target.includes(shardName(b)) ? gate.promise : null);
    const slow = service.addFolder(b);
    await waitUntil(() => io.events.some((event) => event.startsWith('write:') && event.includes(shardName(b))));

    io.commits.length = 0;
    const removing = service.removeFolder(a);
    await waitUntil(async () => (await service!.getSongs(a)).length === 0);
    const readding = service.addFolder(a);
    await waitUntil(async () => (await service!.getSongs(a)).length === 2);

    gate.release();
    await Promise.all([slow, removing, readding]);

    // 关键断言：**每一次清单提交**，清单引用的分片都在磁盘上；
    // 且提交之后不许再删掉它仍引用的分片（旧「removed 快照」两处都会在这里现形）
    expect(io.commits.length).toBeGreaterThan(0);
    expect(io.commits.every((commit) => commit.missing.length === 0)).toBe(true);
    expect(io.violations).toEqual([]);
    // 且测试确实走到了危险交错：有一次提交里清单已含 A（旧实现此时刚把 A 的分片删掉）
    expect(io.commits.some((commit) => commit.paths.includes(a))).toBe(true);

    expect(indexedPaths().sort()).toEqual([a, b].sort());
    expect(fs.existsSync(shardPath(a))).toBe(true);

    service.destroy();
    const reopened = new LocalMusicService(state.dir);
    service = reopened;
    expect((await reopened.getFolders()).map((folder) => folder.name).sort()).toEqual(['A', 'B']);
    expect(await reopened.getSongs(a)).toHaveLength(2);
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
    expect((await reopened.getFolders()).map((folder) => [folder.name, folder.songCount])).toEqual([
      ['A', 2],
      ['B', 3],
    ]);
    expect(await reopened.getSongs(a)).toHaveLength(2);
    expect(await reopened.getSongs(b)).toHaveLength(3);
    expect(await reopened.getSongs()).toHaveLength(5);
    expect(fs.existsSync(foldersFile())).toBe(true);
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
    expect((await reopened.getFolders()).map((folder) => folder.name)).toEqual(['A', 'B']);
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
    expect(indexedPaths()).toEqual([b]);

    service.destroy();
    const reopened = new LocalMusicService(state.dir);
    service = reopened;
    expect((await reopened.getFolders()).map((folder) => folder.name)).toEqual(['B']);
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
    expect((await service.getSongs(legacyFolder)).map((song) => song.id)).toEqual([
      path.join(legacyFolder, 'old.mp3'),
    ]);

    // 第一次落盘（加一个目录）把清单 + 所有分片一次写齐，然后才退役单文件
    const c = makeLibrary(state.dir, 'C', 1);
    await service.addFolder(c);

    expect(readJson(shardPath(legacyFolder)).map((song: LocalSong) => song.id)).toEqual([
      path.join(legacyFolder, 'old.mp3'),
    ]);
    expect(fs.existsSync(path.join(dataDir(), 'local-music.json'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir(), 'local-music.json.migrated'))).toBe(true);
    // 迁移也守「提交时清单引用的分片都在」
    expect(io.commits.every((commit) => commit.missing.length === 0)).toBe(true);

    service.destroy();
    const reopened = new LocalMusicService(state.dir);
    service = reopened;
    expect((await reopened.getSongs()).map((song) => song.id).sort()).toEqual(
      [path.join(legacyFolder, 'old.mp3'), path.join(c, 'C0.mp3')].sort(),
    );
  });

  it('落盘纪律：data/ 里的写只写 .tmp，最终文件都由 rename 产出（原子替换）', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 2);

    io.writes.length = 0;
    await service.addFolder(a);
    await service.removeFolder(a);

    const storeWrites = io.writes.filter((item) => item.path.startsWith(dataDir()));
    expect(storeWrites.length).toBeGreaterThan(0);
    expect(storeWrites.every((item) => item.path.endsWith('.tmp'))).toBe(true);
    // 每一次改名都是 .tmp → 最终路径
    for (const event of io.events.filter((item) => item.startsWith('rename:'))) {
      const [from, to] = event.slice('rename:'.length).split('->');
      expect(from.endsWith('.tmp'), event).toBe(true);
      expect(to.endsWith('.tmp'), event).toBe(false);
    }
  });

  it('孤儿分片：清单未引用的分片与残留 .tmp 在装载时清扫（清单是唯一真相），被引用的不误删', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 2);
    const ghost = makeLibrary(state.dir, 'Ghost', 2);
    await service.addFolder(a);
    service.destroy();
    service = null;

    // 造出「加目录写到一半崩溃」的现场：分片已写、清单没引用它（还有 tmp→rename 的残留）
    fs.writeFileSync(shardPath(ghost), JSON.stringify([localSong(path.join(ghost, 'g.mp3'))]));
    fs.writeFileSync(shardPath(ghost) + '.tmp', '半个文件');
    expect(fs.existsSync(shardPath(ghost))).toBe(true);

    const reopened = new LocalMusicService(state.dir);
    service = reopened;
    await reopened.getFolders();

    expect(fs.existsSync(shardPath(ghost))).toBe(false);
    expect(fs.existsSync(shardPath(ghost) + '.tmp')).toBe(false);
    expect(fs.existsSync(shardPath(a))).toBe(true);
    expect((await reopened.getFolders()).map((folder) => folder.name)).toEqual(['A']);
  });
});

describe('#426 本地曲库分表：失败注入下的提交语义', () => {
  it('清单写失败：不静默吞（上抛 + 置 dirty），下一次落盘把内存里的变更补写进清单', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 1);
    await service.addFolder(a);

    const b = makeLibrary(state.dir, 'B', 1);
    io.failNextRename = (_from, to) => (to.endsWith('folders.json') ? new Error('disk full') : null);
    await expect(service.addFolder(b)).rejects.toThrow('disk full');
    // 提交没发生：磁盘清单还是旧的（此刻与内存不一致，但不许**永久**停在这里）
    expect(indexedPaths()).toEqual([a]);

    // 下一次落盘（任何变更）必须把 B 也补进清单
    const c = makeLibrary(state.dir, 'C', 1);
    await service.addFolder(c);
    expect(indexedPaths()).toEqual([a, b, c]);

    service.destroy();
    const reopened = new LocalMusicService(state.dir);
    service = reopened;
    expect((await reopened.getFolders()).map((folder) => folder.name)).toEqual(['A', 'B', 'C']);
    expect(await reopened.getSongs(b)).toHaveLength(1);
  });

  it('删分片失败不丢歌：清单已提交（不再引用），分片留成孤儿，下一次落盘重试清扫', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 2);
    const b = makeLibrary(state.dir, 'B', 1);
    await service.addFolder(a);
    await service.addFolder(b);

    io.failNextRm = (target) => (target === shardPath(a) ? new Error('EBUSY') : null);
    await service.removeFolder(a);
    expect(indexedPaths()).toEqual([b]);
    // 删除失败只留孤儿分片（清单已不引用 → 不可见），不影响「不再丢歌」
    expect(fs.existsSync(shardPath(a))).toBe(true);

    // 下一次落盘重试删除
    const c = makeLibrary(state.dir, 'C', 1);
    await service.addFolder(c);
    expect(fs.existsSync(shardPath(a))).toBe(false);
    expect(indexedPaths()).toEqual([b, c]);
  });

  it('清单写失败后重启：磁盘是「提交没发生」的旧视图，内存变更不会污染它', async () => {
    service = new LocalMusicService(state.dir);
    const a = makeLibrary(state.dir, 'A', 2);
    await service.addFolder(a);

    const b = makeLibrary(state.dir, 'B', 2);
    io.failNextRename = (_from, to) => (to.endsWith('folders.json') ? new Error('disk full') : null);
    await expect(service.addFolder(b)).rejects.toThrow('disk full');

    // B 的分片写下去了（数据先于引用），但清单没提交 → 重启后是孤儿，被清扫，B 不可见
    expect(fs.existsSync(shardPath(b))).toBe(true);
    service.destroy();
    const reopened = new LocalMusicService(state.dir);
    service = reopened;
    expect((await reopened.getFolders()).map((folder) => folder.name)).toEqual(['A']);
    expect(fs.existsSync(shardPath(b))).toBe(false);
    expect(await reopened.getSongs(a)).toHaveLength(2);
  });
});
