import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
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

let mmModule: typeof import('music-metadata') | null = null;
async function getMusicMetadata(): Promise<typeof import('music-metadata')> {
  if (!mmModule) {
    mmModule = await import('music-metadata');
  }
  return mmModule;
}

class LocalMusicService {
  private dataDir: string = '';
  private coversDir: string = '';
  private storeFile: string = '';
  private store: LocalMusicStore = { folders: [] };
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private initialized: boolean = false;
  private userDataPath?: string;

  constructor(userDataPath?: string) {
    this.userDataPath = userDataPath;
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    const resolved = this.userDataPath ?? app.getPath('userData');
    this.dataDir = path.join(resolved, 'data');
    this.storeFile = path.join(this.dataDir, 'local-music.json');
    fs.mkdirSync(this.dataDir, { recursive: true });
    // 封面目录（审查修复：封面独立文件，不入 JSON）
    this.coversDir = path.join(this.dataDir, COVERS_DIR_NAME);
    fs.mkdirSync(this.coversDir, { recursive: true });
    this.loadStore();
    this.initialized = true;
  }

  private loadStore(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.storeFile)) {
      try {
        this.store = JSON.parse(fs.readFileSync(this.storeFile, 'utf-8'));
      } catch {
        this.store = { folders: [] };
      }
    }
  }

  private saveStore(): void {
    fs.writeFileSync(this.storeFile, JSON.stringify(this.store, null, 2), 'utf-8');
  }

  private isSupportedFormat(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_FORMATS.has(ext);
  }

  /**
   * 提取音频内嵌封面并落盘到 data/covers/（按图片内容 hash 命名，天然去重；
   * 同一张封面多首歌共享一个文件）。写入失败静默返回 undefined，不影响扫描。
   */
  private persistCover(pic: { format: string; data: Uint8Array } | undefined): string | undefined {
    if (!pic || !pic.data || pic.data.length === 0) return undefined;
    try {
      const ext = extensionForCover(pic.format || '');
      const hash = crypto.createHash('md5').update(pic.data).digest('hex');
      const coverPath = path.join(this.coversDir, `${hash}${ext}`);
      if (!fs.existsSync(coverPath)) {
        fs.writeFileSync(coverPath, Buffer.from(pic.data));
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
        coverPath: this.persistCover(tag.picture?.[0]),
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
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile() && this.isSupportedFormat(entry.name)) {
          const song = await this.parseFile(fullPath);
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
    this.saveStore();

    return {
      folder: { path: folderPath, name: folderData.name, songCount: songs.length, lastScanned: new Date(folderData.lastScanned) },
      songs,
    };
  }

  async removeFolder(folderPath: string): Promise<void> {
    this.ensureInitialized();
    this.stopWatching(folderPath);
    this.store.folders = this.store.folders.filter(f => f.path !== folderPath);
    this.saveStore();
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

  async refresh(): Promise<void> {
    this.ensureInitialized();
    for (const folder of this.store.folders) {
      const songs = await this.scanFolder(folder.path);
      folder.songs = songs;
      folder.lastScanned = new Date().toISOString();
    }
    this.saveStore();
  }

  destroy(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }

  startWatching(folderPath: string, onChange: (type: 'add' | 'remove', songs: LocalSong[], songIds: string[]) => void): void {
    if (this.watchers.has(folderPath)) return;

    const watcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const fullPath = path.join(folderPath, filename);
      const isSupported = this.isSupportedFormat(fullPath);

      if (eventType === 'rename') {
        const exists = fs.existsSync(fullPath);
        if (exists && isSupported) {
          this.parseFile(fullPath).then(song => {
            if (song) onChange('add', [song], []);
          });
        } else if (!exists) {
          onChange('remove', [], [fullPath]);
        }
      }
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
  }
}

let serviceInstance: LocalMusicService | null = null;

export function getLocalMusicService(): LocalMusicService {
  if (!serviceInstance) {
    serviceInstance = new LocalMusicService();
  }
  return serviceInstance;
}