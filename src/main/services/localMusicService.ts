import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import { fileExists } from '../utils/fsAsync';
import type { LocalFolder, LocalSong } from '@mplayer/core';

const SUPPORTED_FORMATS = new Set(['.mp3', '.flac', '.wav', '.ogg']);

// 审查修复：封面独立落盘目录（data/covers/<hash>.<ext>），JSON 只存路径引用。
// 旧实现把封面 base64 内嵌进 local-music.json：单张数百 KB，千首歌即膨胀到
// 数十 MB，且每次变更全量重写整个 JSON 文件。
const COVERS_DIR_NAME = 'covers';
const COVER_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const DEFAULT_COVER_EXT = '.jpg';

/** 同一目录内解析音频标签的并发上限（#412）：串行解析一张专辑要等 12 个来回，全并发又会一次推出几百个解析 */
const PARSE_CONCURRENCY = 4;
/** fs.watch 事件合并窗口（#412）：一次「复制专辑」会派发成百上千条 rename 事件 */
const WATCH_DEBOUNCE_MS = 400;

/**
 * 曲库落盘布局（#426）：
 * - `folders.json`：目录清单（path / name / lastScanned），不含歌曲；
 * - `songs-<md5(path)>.json`：每个目录一个分片，装该目录的歌曲。
 *
 * 此前整份曲库是一个 `local-music.json`，任何变更都 `JSON.stringify(store)` 全量重写——
 * 单次「加一首歌」的代价与曲库总规模成正比（上万首 = 每次增删串几十 MB，异步只让「写」
 * 不阻塞主线程，`stringify` 仍在主线程）。分片之后写盘量只与**受影响的那一片**成正比。
 */
const FOLDERS_INDEX_FILE = 'folders.json';
/** 上一版的单文件（迁移源；分表写齐之后退役） */
const LEGACY_STORE_FILE = 'local-music.json';
const LEGACY_RETIRED_FILE = 'local-music.json.migrated';
const SONGS_SHARD_PREFIX = 'songs-';
const SONGS_SHARD_SUFFIX = '.json';



function extensionForCover(mime: string): string {
  return COVER_EXT_BY_MIME[mime] || DEFAULT_COVER_EXT;
}

interface FolderData {
  path: string;
  name: string;
  songs: LocalSong[];
  lastScanned: string;
}

interface LocalMusicStore {
  folders: FolderData[];
}

/** folders.json 里的目录条目：歌曲在各自分片里 */
interface StoredFolder {
  path: string;
  name: string;
  lastScanned: string;
}

/** 一次落盘要动哪些文件（分片粒度：加/删一个目录只碰它那一片） */
interface PersistChange {
  /** 目录清单（folders.json）是否变了 */
  index?: boolean;
  /** 需要重写的歌曲分片（目录路径） */
  songs?: string[];
  /** 需要删除的歌曲分片（目录路径） */
  removed?: string[];
}

let mmModule: typeof import('music-metadata') | null = null;
async function getMusicMetadata(): Promise<typeof import('music-metadata')> {
  if (!mmModule) {
    mmModule = await import('music-metadata');
  }
  return mmModule;
}

export class LocalMusicService {
  private dataDir: string = '';
  private coversDir: string = '';
  /** 目录清单文件（folders.json） */
  private foldersFile: string = '';
  /** 旧单文件（local-music.json）：迁移源 */
  private legacyStoreFile: string = '';
  private legacyRetiredFile: string = '';
  private store: LocalMusicStore = { folders: [] };
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private initialized: boolean = false;
  /** 写盘串行链（#412/#426）：避免并发落盘的 tmp→rename 交错（同一分片也走这条链） */
  private saveChain: Promise<void> = Promise.resolve();
  /** 上次落盘的分片内容指纹（目录路径 → md5）：内容没变就不重写 */
  private shardDigests: Map<string, string> = new Map();
  /** 旧单文件尚未拆片：首次落盘要把清单 + 所有分片一次写齐，成功后才退役单文件 */
  private needsMigrationWrite: boolean = false;
  /** 清单已可作数，但旧单文件还在（迁移中途被打断）：下次落盘顺手退役 */
  private needsLegacyRetire: boolean = false;
  /** fs.watch 事件合并定时器：fullPath → timer（destroy/stopWatching 时统一清） */
  private watchTimers: Map<string, NodeJS.Timeout> = new Map();
  private userDataPath?: string;

  constructor(userDataPath?: string) {
    this.userDataPath = userDataPath;
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    const resolved = this.userDataPath ?? app.getPath('userData');
    this.dataDir = path.join(resolved, 'data');
    this.foldersFile = path.join(this.dataDir, FOLDERS_INDEX_FILE);
    this.legacyStoreFile = path.join(this.dataDir, LEGACY_STORE_FILE);
    this.legacyRetiredFile = path.join(this.dataDir, LEGACY_RETIRED_FILE);
    fs.mkdirSync(this.dataDir, { recursive: true });
    // 封面目录（审查修复：封面独立文件，不入 JSON）
    this.coversDir = path.join(this.dataDir, COVERS_DIR_NAME);
    fs.mkdirSync(this.coversDir, { recursive: true });
    this.loadStore();
    this.initialized = true;
  }

  /**
   * 装载曲库（#426）。
   *
   * 分表之后是「`folders.json` 目录清单 + 每目录一个 `songs-<hash>.json` 分片」，
   * **装载路径与 IPC 面不变**（对外仍是同一个 store 视图），只是数据来自 N+1 个文件。
   * 分片缺失/损坏只让**那个目录**的歌单为空，其余照读——扫描中断/崩溃后曲库仍可读
   *（每片都是 tmp + rename 原子替换出来的，不存在写一半的中间态）。
   *
   * 老用户的单文件 `local-music.json` 仍读一次（迁移源）：首次落盘时先写齐清单与所有分片，
   * 成功后才把它退役成 `.migrated`（中途崩溃老数据还在，下次启动重新走迁移）。
   */
  private loadStore(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });

    const index = this.readJsonSync<StoredFolder[]>(this.foldersFile);
    if (Array.isArray(index)) {
      this.store = {
        folders: index
          .filter((entry) => entry && typeof entry.path === 'string')
          .map((entry) => ({
            path: entry.path,
            name: entry.name,
            songs: this.readFolderSongs(entry.path),
            lastScanned: entry.lastScanned,
          })),
      };
      // 迁移中途被打断（清单已写、单文件还没退役）：下次落盘顺手清掉
      this.needsLegacyRetire = fs.existsSync(this.legacyStoreFile);
      return;
    }

    const legacy = this.readJsonSync<LocalMusicStore>(this.legacyStoreFile);
    if (legacy && Array.isArray(legacy.folders)) {
      this.store = legacy;
      this.needsMigrationWrite = true;
      return;
    }

    this.store = { folders: [] };
  }

  private readJsonSync<T>(filePath: string): T | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  /** 读一个目录的歌曲分片；顺手记下内容指纹（内容没变时后续落盘可跳过） */
  private readFolderSongs(folderPath: string): LocalSong[] {
    const target = this.songsFilePath(folderPath);
    try {
      const raw = fs.readFileSync(target, 'utf-8');
      const songs = JSON.parse(raw);
      if (!Array.isArray(songs)) return [];
      this.shardDigests.set(folderPath, crypto.createHash('md5').update(raw).digest('hex'));
      return songs;
    } catch {
      return [];
    }
  }

  /**
   * 分片文件名 = 目录路径的 md5。路径里有 `:` `\` 这类 Windows 非法文件名字符，
   * 不能直接进文件名；hash 也让「目录改名」自然落成新分片。
   */
  private songsFilePath(folderPath: string): string {
    const hash = crypto.createHash('md5').update(folderPath).digest('hex');
    return path.join(this.dataDir, `${SONGS_SHARD_PREFIX}${hash}${SONGS_SHARD_SUFFIX}`);
  }

  /**
   * 落盘（#426）：只写本次变更触及的分片。
   *
   * 与 #412 的两条纪律一致：**异步 + tmp→rename 原子替换**、**同一个 writeChain 串行**
   * （并发调用按序落盘，同一个分片的 tmp 不会交错）。额外一条：**载荷在任务真正执行时才取**
   * ——后到的写拿到的必然是最新的内存状态，不会用旧快照覆盖新数据。
   */
  private persist(change: PersistChange): Promise<void> {
    const run = this.saveChain.then(
      () => this.persistNow(change),
      () => this.persistNow(change),
    );
    this.saveChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persistNow(change: PersistChange): Promise<void> {
    // 老单文件尚未拆片：这一次把目录清单与**所有**分片一次写齐，成功后才退役单文件
    const migrating = this.needsMigrationWrite;
    const songs = migrating ? this.store.folders.map((folder) => folder.path) : change.songs ?? [];
    try {
      for (const folderPath of songs) {
        const folder = this.store.folders.find((item) => item.path === folderPath);
        if (folder) await this.writeShard(folder);
      }
      for (const folderPath of change.removed ?? []) {
        await fsp.rm(this.songsFilePath(folderPath), { force: true });
        this.shardDigests.delete(folderPath);
      }
      if (migrating || change.index) {
        await this.writeFoldersIndex();
      }
      if (migrating) {
        this.needsMigrationWrite = false;
        this.needsLegacyRetire = true;
      }
      if (this.needsLegacyRetire) {
        await this.retireLegacyStore();
        this.needsLegacyRetire = false;
      }
    } catch (err) {
      console.error('[LocalMusic] 保存曲库失败:', err);
    }
  }

  /** 单目录分片的原子替换；内容与上次落盘一致（且文件还在）就跳过 */
  private async writeShard(folder: FolderData): Promise<void> {
    const target = this.songsFilePath(folder.path);
    const payload = JSON.stringify(folder.songs);
    const digest = crypto.createHash('md5').update(payload).digest('hex');
    if (this.shardDigests.get(folder.path) === digest && (await fileExists(target))) return;

    const temp = `${target}.tmp`;
    await fsp.writeFile(temp, payload, 'utf-8');
    await fsp.rename(temp, target);
    this.shardDigests.set(folder.path, digest);
  }

  private async writeFoldersIndex(): Promise<void> {
    const index: StoredFolder[] = this.store.folders.map((folder) => ({
      path: folder.path,
      name: folder.name,
      lastScanned: folder.lastScanned,
    }));
    const temp = `${this.foldersFile}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(index, null, 2), 'utf-8');
    await fsp.rename(temp, this.foldersFile);
  }

  private async retireLegacyStore(): Promise<void> {
    try {
      await fsp.rename(this.legacyStoreFile, this.legacyRetiredFile);
    } catch {
      // 没有单文件（新用户）或已退役
    }
  }

  /**
   * 替换某个目录的歌曲列表：曲库的**单目录变更**入口。
   * 内容没变（指纹相同）一个字节都不写；变了只重写**这一个分片**。
   */
  async updateFolderSongs(folderPath: string, songs: LocalSong[]): Promise<void> {
    this.ensureInitialized();
    const folder = this.store.folders.find((item) => item.path === folderPath);
    if (!folder) return;
    folder.songs = songs;
    await this.persist({ songs: [folderPath] });
  }

  private isSupportedFormat(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_FORMATS.has(ext);
  }

  /**
   * 提取音频内嵌封面并落盘到 data/covers/（按图片内容 hash 命名，天然去重；
   * 同一张封面多首歌共享一个文件）。写入失败静默返回 undefined，不影响扫描。
   */
  private async persistCover(pic: { format: string; data: Uint8Array } | undefined): Promise<string | undefined> {
    if (!pic || !pic.data || pic.data.length === 0) return undefined;
    try {
      const ext = extensionForCover(pic.format || '');
      const hash = crypto.createHash('md5').update(pic.data).digest('hex');
      const coverPath = path.join(this.coversDir, `${hash}${ext}`);
      // 异步存在性检查 + 写入（#412）：封面可能几百 KB，扫描上千首歌时同步写会卡住主进程
      if (!(await fileExists(coverPath))) {
        await fsp.writeFile(coverPath, pic.data);
      }
      return coverPath;
    } catch {
      return undefined;
    }
  }

  private async parseFile(filePath: string): Promise<LocalSong | null> {
    try {
      const mm = await getMusicMetadata();
      const metadata = await mm.parseFile(filePath);
      const stats = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase().slice(1);

      const tag = metadata.common;

      return {
        id: filePath,
        name: tag.title || path.basename(filePath, path.extname(filePath)),
        artist: tag.artist || 'Unknown Artist',
        album: tag.album || path.basename(path.dirname(filePath)),
        duration: metadata.format.duration || 0,
        sourceType: 'local',
        filePath,
        // 审查修复：封面落盘为独立文件，JSON 只存绝对路径（不再 base64 内嵌膨胀）
        coverPath: await this.persistCover(tag.picture?.[0]),
        format: ext,
        fileSize: stats.size,
      };
    } catch {
      return null;
    }
  }

  private async scanFolder(folderPath: string): Promise<LocalSong[]> {
    const songs: LocalSong[] = [];

    const walkDir = async (dir: string) => {
      // 异步遍历（#412）：此前 readdirSync 在递归里同步打磁盘
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile() && this.isSupportedFormat(entry.name)) {
          files.push(fullPath);
        }
      }
      // 同一目录内**有界并发**解析（#412）：此前逐个 await parseFile，
      // 一张 12 首的专辑要串 12 个来回；全并发又会一次推出几百个标签解析。
      for (let i = 0; i < files.length; i += PARSE_CONCURRENCY) {
        const batch = files.slice(i, i + PARSE_CONCURRENCY);
        const parsed = await Promise.all(batch.map((file) => this.parseFile(file)));
        for (const song of parsed) {
          if (song) songs.push(song);
        }
      }
    };

    await walkDir(folderPath);
    return songs;
  }

  async addFolder(folderPath: string): Promise<{ folder: LocalFolder; songs: LocalSong[] }> {
    this.ensureInitialized();

    const existing = this.store.folders.find(f => f.path === folderPath);
    if (existing) {
      return {
        folder: { path: existing.path, name: existing.name, songCount: existing.songs.length, lastScanned: new Date(existing.lastScanned) },
        songs: existing.songs,
      };
    }

    const songs = await this.scanFolder(folderPath);
    const folderData: FolderData = {
      path: folderPath,
      name: path.basename(folderPath),
      songs,
      lastScanned: new Date().toISOString(),
    };

    this.store.folders.push(folderData);
    // 先落歌曲分片、再落目录清单（数据先于引用，不会出现「清单指向空分片」）
    await this.persist({ index: true, songs: [folderPath] });

    return {
      folder: { path: folderPath, name: folderData.name, songCount: songs.length, lastScanned: new Date(folderData.lastScanned) },
      songs,
    };
  }

  async removeFolder(folderPath: string): Promise<void> {
    this.ensureInitialized();
    this.stopWatching(folderPath);
    this.store.folders = this.store.folders.filter(f => f.path !== folderPath);
    await this.persist({ index: true, removed: [folderPath] });
  }

  async getFolders(): Promise<LocalFolder[]> {
    this.ensureInitialized();
    return this.store.folders.map(f => ({
      path: f.path,
      name: f.name,
      songCount: f.songs.length,
      lastScanned: new Date(f.lastScanned),
    }));
  }

  async getSongs(folderPath?: string): Promise<LocalSong[]> {
    this.ensureInitialized();
    if (folderPath) {
      const folder = this.store.folders.find(f => f.path === folderPath);
      return folder ? folder.songs : [];
    }
    return this.store.folders.flatMap(f => f.songs);
  }

  /**
   * 全量重扫（IPC 面不变）。重扫按定义会让每个目录的歌单都是「新」的，但落盘仍按分片走
   * 指纹比对：只有内容真的变了的目录才重写它那一片（#426）。
   */
  async refresh(): Promise<void> {
    this.ensureInitialized();
    for (const folder of this.store.folders) {
      folder.songs = await this.scanFolder(folder.path);
      folder.lastScanned = new Date().toISOString();
    }
    await this.persist({ index: true, songs: this.store.folders.map((folder) => folder.path) });
  }

  destroy(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.clearWatchTimers();
  }

  /** fs.watch 事件合并后的落地处理（#412）：存在性检查也改异步 */
  private async handleWatchEvent(
    fullPath: string,
    onChange: (type: 'add' | 'remove', songs: LocalSong[], songIds: string[]) => void,
  ): Promise<void> {
    if (!(await fileExists(fullPath))) {
      onChange('remove', [], [fullPath]);
      return;
    }
    if (!this.isSupportedFormat(fullPath)) return;
    const song = await this.parseFile(fullPath);
    if (song) onChange('add', [song], []);
  }

  startWatching(folderPath: string, onChange: (type: 'add' | 'remove', songs: LocalSong[], songIds: string[]) => void): void {
    if (this.watchers.has(folderPath)) return;

    const watcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
      if (!filename || eventType !== 'rename') return;
      const fullPath = path.join(folderPath, filename);
      // **事件合并**（#412）：此前每条 rename 都立刻同步 existsSync + parseFile + IPC。
      // 复制一张专辑会派发成百上千条事件（每个文件 add 往往还伴随 change/rename 数条），
      // 于是同一秒里可能有几百次标签解析与 IPC 推送。合并窗口内只保留最后一次。
      const pending = this.watchTimers.get(fullPath);
      if (pending) clearTimeout(pending);
      this.watchTimers.set(
        fullPath,
        setTimeout(() => {
          this.watchTimers.delete(fullPath);
          void this.handleWatchEvent(fullPath, onChange);
        }, WATCH_DEBOUNCE_MS),
      );
    });

    // 审查修复：目录被移除/权限变化时 fs.watch 会派发 error，不监听将抛出未捕获异常
    watcher.on('error', (err) => {
      console.error(`[LocalMusic] 监听目录失败（已停止监听）: ${folderPath}`, err);
      watcher.close();
      this.watchers.delete(folderPath);
    });

    this.watchers.set(folderPath, watcher);
  }

  stopWatching(folderPath: string): void {
    const watcher = this.watchers.get(folderPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(folderPath);
    }
    this.clearWatchTimers();
  }

  /** 清掉已排队的 fs.watch 合并定时器（#412）：目录停了就不该再有落地的解析与推送 */
  private clearWatchTimers(): void {
    for (const timer of this.watchTimers.values()) clearTimeout(timer);
    this.watchTimers.clear();
  }

  startWatchingAll(onChange: (type: 'add' | 'remove', songs: LocalSong[], songIds: string[]) => void): void {
    this.ensureInitialized();
    for (const folder of this.store.folders) {
      this.startWatching(folder.path, onChange);
    }
  }

  stopWatchingAll(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.clearWatchTimers();
  }
}

let serviceInstance: LocalMusicService | null = null;

export function getLocalMusicService(): LocalMusicService {
  if (!serviceInstance) {
    serviceInstance = new LocalMusicService();
  }
  return serviceInstance;
}