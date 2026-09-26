import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { Song, SongBase, Favorite, PlayHistory, Playlist, PlaylistSong } from '@mplayer/core';
import { clearLegacyDeadResources } from '@mplayer/core';

interface StorageData {
  favorites: Favorite[];
  playHistory: PlayHistory[];
  playlists: Playlist[];
  playlistSongs: PlaylistSong[];
  settings: Record<string, any>;
}

/**
 * 存储域 —— **一份独立文件**（#410）。
 *
 * 此前五个域挤在一个 `storage.json` 里：任何一处改动（加一首收藏、切一个设置开关）
 * 都 `JSON.stringify(data, null, 2)` 重写**整个**文件，还附带一次全文件 `copyFileSync`
 * 备份。收藏/历史/歌单越多，单次改动越贵；`setSetting` 更是**跳过防抖立即全量写**，
 * 用户在设置页连点几下就是几次全量重写。
 *
 * 现在每个域各自一个文件、各自原子替换（写临时文件 + rename），改动只落对应域。
 */
type Domain = 'settings' | 'favorites' | 'history' | 'playlists' | 'playlistSongs';

const DOMAIN_FILENAMES: Record<Domain, string> = {
  settings: 'settings.json',
  favorites: 'favorites.json',
  history: 'history.json',
  playlists: 'playlists.json',
  playlistSongs: 'playlistSongs.json',
};
const ALL_DOMAINS: Domain[] = ['settings', 'favorites', 'history', 'playlists', 'playlistSongs'];

/** 上一版的单文件（迁移源；分域文件齐了之后退役为 .migrated） */
const LEGACY_FILENAME = 'storage.json';
const LEGACY_RETIRED_FILENAME = 'storage.json.migrated';

/**
 * 备份周期。此前**每次写入**都先 `copyFileSync` 一份 .backup —— 大文件下等于每次改动
 * 多写一遍全量数据。改为同一域最多每 10 分钟留一份上一版内容，够人工回溯即可。
 */
const BACKUP_INTERVAL_MS = 10 * 60 * 1000;

// 审查修复：ID 唯一化。旧实现用裸 Date.now() 作主键，同毫秒内连续操作
//（批量收藏 / 快速加歌单）会生成相同 ID，导致去重误判、按 ID 删除错乱。
// 改为「时间戳 + 进程内单调序号」：同进程内严格递增唯一，仍为 number 类型
// 且与历史数据兼容（ID 为不透明标识，无格式依赖）。
let idSeq = 0;
function nextId(): number {
  idSeq = (idSeq + 1) % 1000;
  return Date.now() * 1000 + idSeq;
}

/** 播放历史上限（对齐移动端 historyStore max 200）。 */
const MAX_HISTORY_ITEMS = 200;

export class FileStorage {
  private dataDir: string = '';
  private legacyPath: string = '';
  private legacyRetiredPath: string = '';
  private domainPaths: Partial<Record<Domain, string>> = {};
  private backupPaths: Partial<Record<Domain, string>> = {};

  private data: StorageData = {
    favorites: [],
    playHistory: [],
    playlists: [],
    playlistSongs: [],
    settings: {}
  };
  private initialized: boolean = false;
  /** 分域装载（异步，只做一次）；同步路径只碰 settings */
  private loadPromise: Promise<void> | null = null;
  /** 单文件时代的数据；分域文件齐了之后为 null（不再读那份大文件） */
  private legacyData: StorageData | null = null;
  /** 老数据尚未落到分域文件：首次写入要把五个域都写一遍，成功后才退役单文件 */
  private needsMigrationWrite: boolean = false;

  // 防抖写入机制
  private isDirty: boolean = false;
  private dirtyDomains = new Set<Domain>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_DELAY: number = 200; // 200ms 防抖延迟
  private lastBackupAt: Partial<Record<Domain, number>> = {};

  private ensurePaths(): void {
    if (this.dataDir) return;
    const userDataPath = app.getPath('userData');
    this.dataDir = path.join(userDataPath, 'data');
    this.legacyPath = path.join(this.dataDir, LEGACY_FILENAME);
    this.legacyRetiredPath = path.join(this.dataDir, LEGACY_RETIRED_FILENAME);
    for (const domain of ALL_DOMAINS) {
      const target = path.join(this.dataDir, DOMAIN_FILENAMES[domain]);
      this.domainPaths[domain] = target;
      this.backupPaths[domain] = `${target}.backup`;
    }
  }

  private domainPath(domain: Domain): string {
    const target = this.domainPaths[domain];
    if (!target) throw new Error(`存储域路径未初始化: ${domain}`);
    return target;
  }

  private backupPath(domain: Domain): string {
    return this.backupPaths[domain] as string;
  }

  /**
   * 同步初始化。**只有 settings 走同步读**——`getSettingSync` 在 app ready 前就被
   * `config.ts` 调用，必须同步可得。其余域（收藏 / 历史 / 歌单）由 `ensureLoaded()`
   * 异步装载：启动路径不再同步解析整份用户数据（#410：此前 `loadData()` 同步读
   * 并把全部域 `JSON.parse` 一遍）。
   */
  private ensureInitialized(): void {
    if (this.initialized) return;
    this.ensurePaths();
    fs.mkdirSync(this.dataDir, { recursive: true });
    // 分域文件齐全 = 已完成迁移，那份单文件不必再读（老用户升级后这一读就消失）
    this.legacyData = this.hasAllDomainFiles() ? null : this.readLegacySync();
    this.data.settings = this.readSettingsSync();
    this.initialized = true;
  }

  private hasAllDomainFiles(): boolean {
    return ALL_DOMAINS.every((domain) => fs.existsSync(this.domainPath(domain)));
  }

  private readSettingsSync(): Record<string, any> {
    try {
      if (fs.existsSync(this.domainPath('settings'))) {
        const parsed = JSON.parse(fs.readFileSync(this.domainPath('settings'), 'utf-8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      }
    } catch (error) {
      console.error('加载设置失败，使用默认值:', error);
    }
    return (this.legacyData?.settings as Record<string, any>) ?? {};
  }

  private readLegacySync(): StorageData | null {
    try {
      if (!fs.existsSync(this.legacyPath)) return null;
      const parsedData = JSON.parse(fs.readFileSync(this.legacyPath, 'utf-8'));
      if (!this.validateDataIntegrity(parsedData)) throw new Error('数据完整性验证失败');
      return this.convertDates(parsedData);
    } catch (error) {
      console.error('加载旧版单文件数据失败，忽略:', error);
      return null;
    }
  }

  /** 分域装载（幂等）。所有异步读写入口都先 await 它。 */
  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.loadAll();
    return this.loadPromise;
  }

  private async loadAll(): Promise<void> {
    this.ensureInitialized();
    const readDomain = async (name: string): Promise<unknown> => {
      try {
        return JSON.parse(await fsp.readFile(path.join(this.dataDir, name), 'utf-8'));
      } catch {
        return null;
      }
    };

    const [favorites, history, playlists, playlistSongs] = await Promise.all([
      readDomain(DOMAIN_FILENAMES.favorites),
      readDomain(DOMAIN_FILENAMES.history),
      readDomain(DOMAIN_FILENAMES.playlists),
      readDomain(DOMAIN_FILENAMES.playlistSongs),
    ]);

    const legacy = this.legacyData;
    this.data.favorites = this.convertFavorites(favorites ?? legacy?.favorites ?? []);
    this.data.playHistory = this.convertHistory(history ?? legacy?.playHistory ?? []);
    this.data.playlists = this.convertPlaylists(playlists ?? legacy?.playlists ?? []);
    this.data.playlistSongs = (playlistSongs as PlaylistSong[]) ?? legacy?.playlistSongs ?? [];

    // 还没落到分域文件的老数据：首次写入时五个域一起写，成功后才退役单文件
    this.needsMigrationWrite = legacy !== null;

    // 自建 API 退役后自动清理旧 302 端点残留：不删歌曲，只清死链字段。
    if (this.migrateLegacyData()) {
      this.markDirty('favorites', 'history', 'playlistSongs');
    } else if (this.needsMigrationWrite) {
      this.markDirty(...ALL_DOMAINS);
    }
  }

  private async saveData(...domains: Domain[]): Promise<void> {
    if (!this.initialized) return;
    this.markDirty(...domains);
  }

  private markDirty(...domains: Domain[]): void {
    for (const domain of domains) this.dirtyDomains.add(domain);
    this.isDirty = true;
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    // 清除之前的定时器（防抖）
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushPending().catch((error) => {
        console.error('防抖写入失败:', error);
      });
    }, this.SAVE_DELAY);
  }

  /** 落盘当前脏域。失败时把域放回脏集，避免「写失败 = 数据丢失」。 */
  private async flushPending(): Promise<void> {
    if (!this.isDirty) return;
    const domains = [...this.dirtyDomains];
    this.dirtyDomains.clear();
    this.isDirty = false;
    try {
      await this.writeDomains(domains);
    } catch (error) {
      for (const domain of domains) this.dirtyDomains.add(domain);
      this.isDirty = true;
      throw error;
    }
  }

  /**
   * 立即写入数据（用于应用退出时）
   * 跳过防抖机制，确保数据不丢失
   */
  async flushSave(): Promise<void> {
    await this.ensureLoaded();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.isDirty) return;
    const domains = [...this.dirtyDomains];
    this.dirtyDomains.clear();
    this.isDirty = false;
    try {
      await this.writeDomains(domains);
    } catch (error) {
      console.error('立即写入失败:', error);
      for (const domain of domains) this.dirtyDomains.add(domain);
      this.isDirty = true;
      throw error;
    }
  }

  private async writeDomains(requested: Domain[]): Promise<void> {
    // 迁移未完成时，一次把五个域都写出来，之后才允许退役单文件
    const domains = this.needsMigrationWrite ? ALL_DOMAINS : requested;
    for (const domain of domains) {
      await this.writeDomainFile(domain);
    }
    if (this.needsMigrationWrite) {
      this.needsMigrationWrite = false;
      await this.retireLegacyFile();
    }
  }

  /**
   * 单域原子写入：先写 `.tmp` 再 rename。
   * 原子替换之后不再需要旧实现的「失败时从 backup 恢复」——目标文件要么是上一版
   * 完整内容，要么是新一版完整内容，不存在写一半的中间态。
   */
  private async writeDomainFile(domain: Domain): Promise<void> {
    const target = this.domainPath(domain);
    const temp = `${target}.tmp`;
    const payload = JSON.stringify(this.serializeDomain(domain));
    await this.maybeBackup(domain);
    await fsp.writeFile(temp, payload, 'utf-8');
    await fsp.rename(temp, target);
  }

  /** 周期备份上一版内容（同一域最多每 BACKUP_INTERVAL_MS 一次）。 */
  private async maybeBackup(domain: Domain): Promise<void> {
    const now = Date.now();
    const last = this.lastBackupAt[domain] ?? 0;
    if (now - last < BACKUP_INTERVAL_MS) return;
    this.lastBackupAt[domain] = now;
    try {
      await fsp.copyFile(this.domainPath(domain), this.backupPath(domain));
    } catch {
      // 首次写入时还没有旧文件
    }
  }

  private async retireLegacyFile(): Promise<void> {
    try {
      await fsp.rename(this.legacyPath, this.legacyRetiredPath);
    } catch {
      // 没有单文件（新用户）或已退役
    }
  }

  private serializeDomain(domain: Domain): unknown {
    switch (domain) {
      case 'settings': return this.data.settings;
      case 'favorites': return this.data.favorites;
      case 'history': return this.data.playHistory;
      case 'playlists': return this.data.playlists;
      case 'playlistSongs': return this.data.playlistSongs;
    }
  }

  private validateDataIntegrity(data: StorageData): boolean {
    // 验证基本数据结构
    if (!data || typeof data !== 'object') return false;

    const requiredKeys = ['favorites', 'playHistory', 'playlists', 'playlistSongs', 'settings'];
    for (const key of requiredKeys) {
      if (!(key in data)) return false;
    }

    // 验证数组类型
    if (!Array.isArray(data.favorites) ||
        !Array.isArray(data.playHistory) ||
        !Array.isArray(data.playlists) ||
        !Array.isArray(data.playlistSongs)) {
      return false;
    }

    // 验证settings对象
    if (typeof data.settings !== 'object') return false;

    return true;
  }

  private convertFavorites(raw: unknown): Favorite[] {
    return ((raw as any[]) || []).map((f: any) => ({
      ...f,
      createdAt: f.createdAt instanceof Date ? f.createdAt : new Date(f.createdAt)
    }));
  }

  private convertHistory(raw: unknown): PlayHistory[] {
    return ((raw as any[]) || []).map((h: any) => ({
      ...h,
      playedAt: h.playedAt instanceof Date ? h.playedAt : new Date(h.playedAt)
    }));
  }

  private convertPlaylists(raw: unknown): Playlist[] {
    return ((raw as any[]) || []).map((p: any) => ({
      ...p,
      createdAt: p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt)
    }));
  }

  private convertDates(data: any): StorageData {
    return {
      favorites: this.convertFavorites(data.favorites),
      playHistory: this.convertHistory(data.playHistory),
      playlists: this.convertPlaylists(data.playlists),
      playlistSongs: data.playlistSongs || [],
      settings: data.settings || {}
    } as StorageData;
  }

  /**
   * 一次性/幂等迁移旧数据：
   * - 歌曲 ID 统一为字符串（旧 API 部分源返回数字）；
   * - 清掉指向已退役旧签名端点（api.php?get=...）的 url/cover/lrc；
   * - 不删除任何收藏/歌单/历史条目。
   */
  private migrateLegacyData(): boolean {
    let changed = false;

    const normalizeSong = (song: any): void => {
      if (!song || typeof song !== 'object') return;
      if (song.id != null && typeof song.id !== 'string') {
        song.id = String(song.id);
        changed = true;
      }
      if (clearLegacyDeadResources(song)) {
        changed = true;
      }
      // 旧 audioTag 是跟着旧签名 URL 一起探测出来的，URL 清掉后不再可信。
      if ('audioTag' in song) {
        delete song.audioTag;
        changed = true;
      }
      if ('nonFull' in song) {
        delete song.nonFull;
        changed = true;
      }
    };

    for (const favorite of this.data.favorites) {
      if (favorite.songId != null && typeof favorite.songId !== 'string') {
        favorite.songId = String(favorite.songId);
        changed = true;
      }
      normalizeSong(favorite.song);
    }

    for (const historyItem of this.data.playHistory) {
      if (historyItem.songId != null && typeof historyItem.songId !== 'string') {
        historyItem.songId = String(historyItem.songId);
        changed = true;
      }
      normalizeSong(historyItem.song);
    }

    for (const playlistSong of this.data.playlistSongs) {
      if (playlistSong.songId != null && typeof playlistSong.songId !== 'string') {
        playlistSong.songId = String(playlistSong.songId);
        changed = true;
      }
      normalizeSong(playlistSong.song);
    }

    return changed;
  }

  // Favorites
  async addFavorite(song: Song): Promise<number> {
    await this.ensureLoaded();
    const existing = this.data.favorites.find(f => f.songId === song.id);
    if (existing) {
      return existing.id!;
    }

    const id = nextId();
    const favorite: Favorite = {
      id,
      songId: song.id,
      song: {
        id: song.id,
        name: song.name,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        sourceType: song.sourceType
      },
      createdAt: new Date()
    };

    this.data.favorites.push(favorite);
    await this.saveData('favorites');
    return id;
  }

  /**
   * 原位替换收藏歌曲（单曲换源）：按旧 ID 找到条目，整条换成新歌，
   * 保持收藏时间与排序位置；历史与下载记录不追溯改写。
   */
  async replaceFavoriteSong(oldSongId: string, newSong: Song): Promise<void> {
    await this.ensureLoaded();
    const favorite = this.data.favorites.find(f => f.songId === oldSongId);
    if (!favorite) return;
    favorite.songId = newSong.id;
    favorite.song = newSong as SongBase;
    await this.saveData('favorites');
  }

  async removeFavorite(songId: string): Promise<void> {
    await this.ensureLoaded();
    this.data.favorites = this.data.favorites.filter(f => f.songId !== songId);
    await this.saveData('favorites');
  }

  async isFavorite(songId: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.data.favorites.some(f => f.songId === songId);
  }

  async getFavorites(): Promise<SongBase[]> {
    await this.ensureLoaded();
    return this.data.favorites
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(f => f.song);
  }

  // Play History
  async addToPlayHistory(song: Song): Promise<number> {
    await this.ensureLoaded();
    const id = nextId();
    const songBase: SongBase = {
      id: song.id,
      name: song.name,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      sourceType: song.sourceType
    };
    const historyItem: PlayHistory = {
      id,
      songId: song.id,
      song: songBase,
      playedAt: new Date()
    };

    this.data.playHistory.push(historyItem);
    // 审查修复：历史上限截断（与移动端 max 200 对齐），防止存储无限增长
    if (this.data.playHistory.length > MAX_HISTORY_ITEMS) {
      this.data.playHistory = this.data.playHistory.slice(-MAX_HISTORY_ITEMS);
    }
    await this.saveData('history');
    return id;
  }

  async getPlayHistory(limit: number = 50): Promise<PlayHistory[]> {
    await this.ensureLoaded();
    return this.data.playHistory
      .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime())
      .slice(0, limit);
  }

  async clearPlayHistory(): Promise<void> {
    await this.ensureLoaded();
    this.data.playHistory = [];
    await this.saveData('history');
  }

  async removeFromPlayHistory(songId: string): Promise<void> {
    await this.ensureLoaded();
    this.data.playHistory = this.data.playHistory.filter(h => h.songId !== songId);
    await this.saveData('history');
  }

  // Playlists
  async createPlaylist(name: string, description?: string): Promise<number> {
    await this.ensureLoaded();
    const id = nextId();
    const playlist: Playlist = {
      id,
      name,
      description,
      createdAt: new Date()
    };

    this.data.playlists.push(playlist);
    await this.saveData('playlists');
    return id;
  }

  async getPlaylists(): Promise<Playlist[]> {
    await this.ensureLoaded();
    return this.data.playlists
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((playlist) => {
        const songs = this.data.playlistSongs.filter(song => song.playlistId === playlist.id);
        return {
          ...playlist,
          cover: songs[0]?.song.cover || undefined,
          songCount: songs.length,
        };
      });
  }

  async getPlaylist(playlistId: number): Promise<Playlist | undefined> {
    await this.ensureLoaded();
    const playlist = this.data.playlists.find(p => p.id === playlistId);
    if (!playlist) return undefined;
    const songs = this.data.playlistSongs.filter(song => song.playlistId === playlistId);
    return {
      ...playlist,
      cover: songs[0]?.song.cover || undefined,
      songCount: songs.length,
    };
  }

  async updatePlaylist(playlistId: number, playlist: Partial<Playlist>): Promise<void> {
    await this.ensureLoaded();
    const index = this.data.playlists.findIndex(p => p.id === playlistId);
    if (index !== -1) {
      this.data.playlists[index] = { ...this.data.playlists[index], ...playlist };
      await this.saveData('playlists');
    }
  }

  async deletePlaylist(playlistId: number): Promise<void> {
    await this.ensureLoaded();
    // 验证歌单是否存在
    const playlist = this.data.playlists.find(p => p.id === playlistId);
    if (!playlist) {
      throw new Error(`歌单不存在: ${playlistId}`);
    }

    // 执行事务性删除
    try {
      // 1. 删除歌单歌曲关联
      this.data.playlistSongs = this.data.playlistSongs.filter(ps => ps.playlistId !== playlistId);

      // 2. 删除歌单本身
      this.data.playlists = this.data.playlists.filter(p => p.id !== playlistId);

      // 3. 保存更改（两个域一起落）
      await this.saveData('playlists', 'playlistSongs');
    } catch (error) {
      console.error('删除歌单失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      throw new Error(`删除歌单失败: ${errorMessage}`);
    }
  }

  // Playlist Songs
  async addSongToPlaylist(playlistId: number, song: Song): Promise<number> {
    await this.ensureLoaded();
    // 验证歌单是否存在
    const playlist = this.data.playlists.find(p => p.id === playlistId);
    if (!playlist) {
      throw new Error(`歌单不存在: ${playlistId}`);
    }

    // 验证歌曲数据完整性
    if (!this.validateSongData(song)) {
      throw new Error('歌曲数据不完整');
    }

    // 检查歌曲是否已经存在于歌单中
    const existing = this.data.playlistSongs.find(
      ps => ps.playlistId === playlistId && ps.songId === song.id
    );
    if (existing) {
      return existing.id!;
    }

    // 检查歌单容量限制（可选）
    const currentSongs = this.data.playlistSongs.filter(ps => ps.playlistId === playlistId);
    if (currentSongs.length >= 1000) { // 限制1000首歌
      throw new Error('歌单已达到最大容量限制');
    }

    const maxOrder = currentSongs.reduce((max, ps) => Math.max(max, ps.order), -1);

    const id = nextId();
    const playlistSong: PlaylistSong = {
      id,
      playlistId,
      songId: song.id,
      song: song as Song,
      order: maxOrder + 1
    };

    this.data.playlistSongs.push(playlistSong);
    await this.saveData('playlistSongs');
    return id;
  }

  private validateSongData(song: Song): boolean {
    if (!song.id || !song.name || !song.artist) return false;
    // 在线歌曲的 url 由播放链路懒解析（预取缓存 → 直连 → tier3），
    // 搜索结果入库时 url 为空是常态；本地歌曲的 url 即文件路径，必须存在。
    if (song.sourceType === 'local' && !song.url) return false;
    return true;
  }

  async removeSongFromPlaylist(playlistId: number, songId: string): Promise<void> {
    await this.ensureLoaded();
    this.data.playlistSongs = this.data.playlistSongs.filter(
      ps => !(ps.playlistId === playlistId && ps.songId === songId)
    );
    await this.saveData('playlistSongs');
  }

  async getPlaylistSongs(playlistId: number): Promise<SongBase[]> {
    await this.ensureLoaded();
    return this.data.playlistSongs
      .filter(ps => ps.playlistId === playlistId)
      .sort((a, b) => a.order - b.order)
      .map(ps => ps.song);
  }

  async updatePlaylistSongOrder(playlistId: number, songId: string, order: number): Promise<void> {
    await this.ensureLoaded();
    const item = this.data.playlistSongs.find(
      ps => ps.playlistId === playlistId && ps.songId === songId
    );
    if (item) {
      item.order = order;
      await this.saveData('playlistSongs');
    }
  }

  /**
   * 原位替换本地歌单歌曲（单曲换源）：按旧 ID 找到条目，整条换成新歌，
   * 保持排序位置不变。
   */
  async replacePlaylistSong(playlistId: number, oldSongId: string, newSong: Song): Promise<void> {
    await this.ensureLoaded();
    const item = this.data.playlistSongs.find(
      ps => ps.playlistId === playlistId && ps.songId === oldSongId
    );
    if (!item) return;
    item.songId = newSong.id;
    item.song = newSong as Song;
    await this.saveData('playlistSongs');
  }

  async reorderSongIds(playlistId: number, songIds: string[]): Promise<void> {
    await this.ensureLoaded();
    const existing = this.data.playlistSongs.filter(ps => ps.playlistId === playlistId);
    const existingMap = new Map(existing.map(ps => [ps.songId, ps]));

    const newPlaylistSongs = songIds.map((songId, index) => {
      const existingItem = existingMap.get(songId);
      if (existingItem) {
        return { ...existingItem, order: index };
      }
      return null;
    }).filter(Boolean) as PlaylistSong[];

    const remainingIds = new Set(songIds);
    const remaining = existing.filter(ps => !remainingIds.has(ps.songId));
    const allSongs = [...newPlaylistSongs, ...remaining];

    this.data.playlistSongs = this.data.playlistSongs.filter(ps => ps.playlistId !== playlistId);
    this.data.playlistSongs.push(...allSongs);
    await this.saveData('playlistSongs');
  }

  // Settings
  async setSetting<T>(key: string, value: T): Promise<void> {
    await this.ensureLoaded();
    this.data.settings[key] = value;
    // 设置项需要立即写入磁盘，避免防抖导致重启后丢失。
    // 只写 settings.json —— 此前是「跳过防抖立即全量重写整个存储」（#410）。
    await this.writeDomainFile('settings');
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    await this.ensureLoaded();
    return this.data.settings[key] as T | undefined;
  }

  // 同步方法，供 config.ts 使用（只依赖 settings，见 ensureInitialized）
  getSettingSync<T>(key: string): T | undefined {
    try {
      this.ensureInitialized();
    } catch {
      // app 未 ready，返回 undefined
      return undefined;
    }
    return this.data.settings[key] as T | undefined;
  }
}

let fileStorageInstance: FileStorage | null = null;

export function getFileStorage(): FileStorage {
  if (!fileStorageInstance) {
    fileStorageInstance = new FileStorage();
  }
  return fileStorageInstance;
}
