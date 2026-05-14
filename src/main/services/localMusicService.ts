import fs from 'fs';
import path from 'path';
import * as mm from 'music-metadata';
import { app } from 'electron';
import type { LocalFolder, LocalSong } from '@/shared/types/song';

const SUPPORTED_FORMATS = new Set(['.mp3', '.flac', '.wav', '.ogg']);

interface FolderData {
  path: string;
  name: string;
  songs: LocalSong[];
}

interface LocalMusicStore {
  folders: FolderData[];
}

class LocalMusicService {
  private dataDir: string = '';
  private storeFile: string = '';
  private store: LocalMusicStore = { folders: [] };
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private initialized: boolean = false;

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.dataDir = path.join(app.getPath('userData'), 'data');
    this.storeFile = path.join(this.dataDir, 'local-music.json');
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

  private async parseFile(filePath: string): Promise<LocalSong | null> {
    try {
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
        coverBase64: (() => {
          if (tag.picture && tag.picture.length > 0) {
            const pic = tag.picture[0];
            const base64 = Buffer.from(pic.data).toString('base64');
            return `data:${pic.format};base64,${base64}`;
          }
          return undefined;
        })(),
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
        folder: { path: existing.path, name: existing.name, songCount: existing.songs.length, lastScanned: new Date() },
        songs: existing.songs,
      };
    }

    const songs = await this.scanFolder(folderPath);
    const folderData: FolderData = {
      path: folderPath,
      name: path.basename(folderPath),
      songs,
    };

    this.store.folders.push(folderData);
    this.saveStore();

    return {
      folder: { path: folderPath, name: folderData.name, songCount: songs.length, lastScanned: new Date() },
      songs,
    };
  }

  async removeFolder(folderPath: string): Promise<void> {
    this.ensureInitialized();
    this.store.folders = this.store.folders.filter(f => f.path !== folderPath);
    this.saveStore();
  }

  async getFolders(): Promise<LocalFolder[]> {
    this.ensureInitialized();
    return this.store.folders.map(f => ({
      path: f.path,
      name: f.name,
      songCount: f.songs.length,
      lastScanned: new Date(),
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