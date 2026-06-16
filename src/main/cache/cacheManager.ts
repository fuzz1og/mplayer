import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const CACHE_EXPIRE_DAYS = 7;
const URL_EXPIRE_HOURS = 12;
const MAX_CACHE_SIZE = 100 * 1024 * 1024;

interface CacheIndexItem {
  type: 'songs' | 'cover' | 'audio' | 'url';
  time: number;
  size: number;
  [key: string]: any;
}

interface CacheIndex {
  [key: string]: CacheIndexItem;
}

interface CacheStats {
  totalSize: number;
  fileCount: number;
  songsCount: number;
  coversCount: number;
  audioCount: number;
  urlsCount: number;
}

interface CacheConsistencyReport {
  inconsistencies: string[];
  totalFiles: number;
  corruptedFiles: number;
  orphanedFiles: number;
}

interface RepairResult {
  fixedIssues: number;
  removedFiles: number;
  errors: string[];
}

export class CacheManager {
  private cacheDir: string;
  private maxCacheSize: number;
  private cacheExpireDays: number;
  private urlExpireHours: number;
  private cacheIndex: CacheIndex = {};
  private indexFile: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.cacheDir = path.join(userDataPath, 'cache');
    this.maxCacheSize = MAX_CACHE_SIZE;
    this.cacheExpireDays = CACHE_EXPIRE_DAYS;
    this.urlExpireHours = URL_EXPIRE_HOURS;
    this.indexFile = path.join(this.cacheDir, 'cache_index.json');

    this.init();
  }

  private init(): void {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.mkdirSync(path.join(this.cacheDir, 'songs'), { recursive: true });
    fs.mkdirSync(path.join(this.cacheDir, 'covers'), { recursive: true });
    fs.mkdirSync(path.join(this.cacheDir, 'audio'), { recursive: true });
    fs.mkdirSync(path.join(this.cacheDir, 'urls'), { recursive: true });

    this.loadIndex();
    this.cleanExpiredCache();
  }

  private loadIndex(): void {
    if (fs.existsSync(this.indexFile)) {
      try {
        const data = fs.readFileSync(this.indexFile, 'utf-8');
        this.cacheIndex = JSON.parse(data);
      } catch {
        this.cacheIndex = {};
      }
    }
  }

  private saveIndex(): void {
    try {
      fs.writeFileSync(this.indexFile, JSON.stringify(this.cacheIndex, null, 2));
    } catch (error) {
      console.error('保存缓存索引失败:', error);
    }
  }

  private getCacheKey(data: string): string {
    return crypto.createHash('md5').update(data).digest('hex');
  }

  getSongCache(keyword: string): any[] | null {
    const cacheKey = this.getCacheKey(`songs_${keyword}`);
    const cacheFile = path.join(this.cacheDir, 'songs', `${cacheKey}.json`);

    if (fs.existsSync(cacheFile)) {
      const stats = fs.statSync(cacheFile);
      const cacheTime = stats.mtimeMs;
      if (Date.now() - cacheTime < this.cacheExpireDays * 24 * 3600 * 1000) {
        try {
          const data = fs.readFileSync(cacheFile, 'utf-8');
          return JSON.parse(data);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  setSongCache(keyword: string, songs: any[]): void {
    const cacheKey = this.getCacheKey(`songs_${keyword}`);
    const cacheFile = path.join(this.cacheDir, 'songs', `${cacheKey}.json`);

    try {
      // 确保目录存在
      fs.mkdirSync(path.join(this.cacheDir, 'songs'), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(songs, null, 2));
      const stats = fs.statSync(cacheFile);

      this.cacheIndex[cacheKey] = {
        type: 'songs',
        keyword,
        time: Date.now(),
        size: stats.size
      };

      this.saveIndex();
      this.cleanExpiredCache();
    } catch (error) {
      console.error('设置歌曲缓存失败:', error);
    }
  }

  getCoverCache(coverUrl: string): string | null {
    const cacheKey = this.getCacheKey(coverUrl);
    const cacheFile = path.join(this.cacheDir, 'covers', `${cacheKey}.jpg`);

    if (fs.existsSync(cacheFile)) {
      // 封面图片永久缓存，除非空间不足
      return cacheFile;
    }
    return null;
  }

  setCoverCache(coverUrl: string, imageData: Buffer): void {
    const cacheKey = this.getCacheKey(coverUrl);
    const cacheFile = path.join(this.cacheDir, 'covers', `${cacheKey}.jpg`);

    try {
      // 确保目录存在
      fs.mkdirSync(path.join(this.cacheDir, 'covers'), { recursive: true });
      fs.writeFileSync(cacheFile, imageData);
      const stats = fs.statSync(cacheFile);

      this.cacheIndex[cacheKey] = {
        type: 'cover',
        url: coverUrl,
        time: Date.now(),
        size: stats.size
      };

      this.saveIndex();
      this.cleanExpiredCache();
    } catch (error) {
      console.error('设置封面缓存失败:', error);
    }
  }

  getAudioCache(audioUrl: string): string | null {
    const cacheKey = this.getCacheKey(audioUrl);
    const cacheFile = path.join(this.cacheDir, 'audio', `${cacheKey}.mp3`);

    if (fs.existsSync(cacheFile)) {
      const stats = fs.statSync(cacheFile);
      const cacheTime = stats.mtimeMs;
      if (Date.now() - cacheTime < this.cacheExpireDays * 24 * 3600 * 1000) {
        return cacheFile;
      }
    }
    return null;
  }

  setAudioCache(audioUrl: string, audioData: Buffer): void {
    const cacheKey = this.getCacheKey(audioUrl);
    const cacheFile = path.join(this.cacheDir, 'audio', `${cacheKey}.mp3`);

    try {
      // 确保目录存在
      fs.mkdirSync(path.join(this.cacheDir, 'audio'), { recursive: true });
      fs.writeFileSync(cacheFile, audioData);
      const stats = fs.statSync(cacheFile);

      this.cacheIndex[cacheKey] = {
        type: 'audio',
        url: audioUrl,
        time: Date.now(),
        size: stats.size
      };

      this.saveIndex();
      this.cleanExpiredCache();
    } catch (error) {
      console.error('设置音频缓存失败:', error);
    }
  }

  trimAudioCache(keepCount: number): void {
    const audioEntries = Object.entries(this.cacheIndex).filter(
      ([_, info]) => info.type === 'audio'
    );

    if (audioEntries.length <= keepCount) return;

    audioEntries.sort((a, b) => b[1].time - a[1].time);

    const toDelete = audioEntries.slice(keepCount);
    for (const [key] of toDelete) {
      const cacheFile = path.join(this.cacheDir, 'audio', `${key}.mp3`);
      if (fs.existsSync(cacheFile)) {
        fs.rmSync(cacheFile);
      }
      delete this.cacheIndex[key];
    }
    this.saveIndex();
  }

  getUrlCache(songId: string): any | null {
    const cacheKey = this.getCacheKey(`url_${songId}`);
    const cacheFile = path.join(this.cacheDir, 'urls', `${cacheKey}.json`);

    if (fs.existsSync(cacheFile)) {
      const stats = fs.statSync(cacheFile);
      const cacheTime = stats.mtimeMs;
      if (Date.now() - cacheTime < this.urlExpireHours * 3600 * 1000) {
        try {
          const data = fs.readFileSync(cacheFile, 'utf-8');
          return JSON.parse(data);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  setUrlCache(songId: string, urlData: any): void {
    const cacheKey = this.getCacheKey(`url_${songId}`);
    const cacheFile = path.join(this.cacheDir, 'urls', `${cacheKey}.json`);

    try {
      // 确保目录存在
      fs.mkdirSync(path.join(this.cacheDir, 'urls'), { recursive: true });
      urlData.cache_time = Date.now();
      fs.writeFileSync(cacheFile, JSON.stringify(urlData, null, 2));
      const stats = fs.statSync(cacheFile);

      this.cacheIndex[cacheKey] = {
        type: 'url',
        songId,
        time: Date.now(),
        size: stats.size
      };

      this.saveIndex();
      this.cleanExpiredCache();
    } catch (error) {
      console.error('设置URL缓存失败:', error);
    }
  }

  private cleanExpiredCache(): void {
    try {
      const currentTime = Date.now();
      const expiredKeys: string[] = [];

      for (const [key, info] of Object.entries(this.cacheIndex)) {
        if (info.type === 'url') {
          if (currentTime - info.time > this.urlExpireHours * 3600 * 1000) {
            expiredKeys.push(key);
          }
        } else if (info.type !== 'cover') {
          // 封面图片不过期，其他类型按设置过期
          if (currentTime - info.time > this.cacheExpireDays * 24 * 3600 * 1000) {
            expiredKeys.push(key);
          }
        }
      }

      for (const key of expiredKeys) {
        this.deleteCacheFile(key);
        delete this.cacheIndex[key];
      }

      if (expiredKeys.length > 0) {
        this.saveIndex();
      }

      this.checkCacheSize();
    } catch (error) {
      console.error('清理过期缓存失败:', error);
    }
  }

  private deleteCacheFile(cacheKey: string): void {
    try {
      const info = this.cacheIndex[cacheKey];
      if (!info) return;

      let cacheFile: string;
      switch (info.type) {
        case 'songs':
          cacheFile = path.join(this.cacheDir, 'songs', `${cacheKey}.json`);
          break;
        case 'cover':
          cacheFile = path.join(this.cacheDir, 'covers', `${cacheKey}.jpg`);
          break;
        case 'audio':
          cacheFile = path.join(this.cacheDir, 'audio', `${cacheKey}.mp3`);
          break;
        case 'url':
          cacheFile = path.join(this.cacheDir, 'urls', `${cacheKey}.json`);
          break;
        default:
          return;
      }

      if (fs.existsSync(cacheFile)) {
        fs.unlinkSync(cacheFile);
      }
    } catch (error) {
      console.error('删除缓存文件失败:', error);
    }
  }

  private checkCacheSize(): void {
    try {
      let totalSize = 0;
      for (const info of Object.values(this.cacheIndex)) {
        totalSize += info.size || 0;
      }

      if (totalSize > this.maxCacheSize) {
        // 按时间排序，优先删除最旧的（封面图片最后删除）
        const sortedItems = Object.entries(this.cacheIndex).sort((a, b) => {
          // 封面图片优先级最低
          if (a[1].type === 'cover' && b[1].type !== 'cover') return 1;
          if (a[1].type !== 'cover' && b[1].type === 'cover') return -1;
          return a[1].time - b[1].time;
        });

        while (totalSize > this.maxCacheSize && sortedItems.length > 0) {
          const [key, info] = sortedItems.shift()!;
          totalSize -= info.size || 0;
          this.deleteCacheFile(key);
          delete this.cacheIndex[key];
        }

        this.saveIndex();
      }
    } catch (error) {
      console.error('检查缓存大小失败:', error);
    }
  }

  getCacheStats(): CacheStats {
    let totalSize = 0;
    let songsCount = 0;
    let coversCount = 0;
    let audioCount = 0;
    let urlsCount = 0;

    for (const info of Object.values(this.cacheIndex)) {
      totalSize += info.size || 0;
      switch (info.type) {
        case 'songs':
          songsCount++;
          break;
        case 'cover':
          coversCount++;
          break;
        case 'audio':
          audioCount++;
          break;
        case 'url':
          urlsCount++;
          break;
      }
    }

    return {
      totalSize,
      fileCount: Object.keys(this.cacheIndex).length,
      songsCount,
      coversCount,
      audioCount,
      urlsCount
    };
  }

  clearAllCache(): void {
    try {
      const subdirs = ['songs', 'covers', 'audio', 'urls'];
      for (const subdir of subdirs) {
        const dirPath = path.join(this.cacheDir, subdir);
        if (fs.existsSync(dirPath)) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
        fs.mkdirSync(dirPath, { recursive: true });
      }

      this.cacheIndex = {};
      this.saveIndex();
    } catch (error) {
      console.error('清除所有缓存失败:', error);
    }
  }

  async checkCacheConsistency(): Promise<CacheConsistencyReport> {
    const report: CacheConsistencyReport = {
      inconsistencies: [],
      totalFiles: 0,
      corruptedFiles: 0,
      orphanedFiles: 0
    };

    try {
      // 检查缓存索引文件是否存在
      if (!fs.existsSync(this.indexFile)) {
        report.inconsistencies.push('缓存索引文件不存在');
        return report;
      }

      const index = { ...this.cacheIndex };
      report.totalFiles = Object.keys(index).length;

      // 检查每个缓存项
      for (const [key, cacheItem] of Object.entries(index)) {
        let filePath: string;
        switch (cacheItem.type) {
          case 'songs':
            filePath = path.join(this.cacheDir, 'songs', `${key}.json`);
            break;
          case 'cover':
            filePath = path.join(this.cacheDir, 'covers', `${key}.jpg`);
            break;
          case 'audio':
            filePath = path.join(this.cacheDir, 'audio', `${key}.mp3`);
            break;
          case 'url':
            filePath = path.join(this.cacheDir, 'urls', `${key}.json`);
            break;
          default:
            report.inconsistencies.push(`未知缓存类型: ${key} (${cacheItem.type})`);
            continue;
        }

        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
          report.inconsistencies.push(`缓存文件丢失: ${key}`);
          report.orphanedFiles++;
          continue;
        }

        // 检查文件完整性
        try {
          const stats = fs.statSync(filePath);
          if (stats.size !== cacheItem.size) {
            report.inconsistencies.push(`文件大小不匹配: ${key} (期望: ${cacheItem.size}, 实际: ${stats.size})`);
            report.corruptedFiles++;
          }

          // 检查过期时间
          if (cacheItem.time) {
            const age = Date.now() - cacheItem.time;
            const maxAge = cacheItem.type === 'url'
              ? this.urlExpireHours * 3600 * 1000
              : this.cacheExpireDays * 24 * 3600 * 1000;

            if (age > maxAge && cacheItem.type !== 'cover') {
              report.inconsistencies.push(`缓存已过期: ${key} (${Math.floor(age / (24 * 3600 * 1000))}天前)`);
            }
          }

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          report.inconsistencies.push(`文件访问错误: ${key} (${errorMessage})`);
          report.corruptedFiles++;
        }
      }

      // 检查孤立文件（存在于缓存目录但不在索引中）
      const checkDirectory = (subdir: string, extension: string) => {
        const dirPath = path.join(this.cacheDir, subdir);
        if (!fs.existsSync(dirPath)) return;

        const files = fs.readdirSync(dirPath);
        for (const filename of files) {
          if (!filename.endsWith(extension)) continue;

          const key = filename.replace(extension, '');
          const found = Object.keys(this.cacheIndex).some(indexKey => indexKey === key);
          if (!found) {
            report.inconsistencies.push(`孤立文件: ${subdir}/${filename}`);
            report.orphanedFiles++;
          }
        }
      };

      checkDirectory('songs', '.json');
      checkDirectory('covers', '.jpg');
      checkDirectory('audio', '.mp3');
      checkDirectory('urls', '.json');

    } catch (error) {
      console.error('缓存一致性检查失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      report.inconsistencies.push(`检查过程出错: ${errorMessage}`);
    }

    return report;
  }

  async repairCacheConsistency(): Promise<RepairResult> {
    const result: RepairResult = {
      fixedIssues: 0,
      removedFiles: 0,
      errors: []
    };

    try {
      await this.checkCacheConsistency();

      // 修复缓存索引
      let indexModified = false;

      for (const [key, cacheItem] of Object.entries(this.cacheIndex)) {
        let filePath: string;
        switch (cacheItem.type) {
          case 'songs':
            filePath = path.join(this.cacheDir, 'songs', `${key}.json`);
            break;
          case 'cover':
            filePath = path.join(this.cacheDir, 'covers', `${key}.jpg`);
            break;
          case 'audio':
            filePath = path.join(this.cacheDir, 'audio', `${key}.mp3`);
            break;
          case 'url':
            filePath = path.join(this.cacheDir, 'urls', `${key}.json`);
            break;
          default:
            continue;
        }

        // 删除丢失文件的索引项
        if (!fs.existsSync(filePath)) {
          delete this.cacheIndex[key];
          indexModified = true;
          result.fixedIssues++;
          continue;
        }

        // 删除过期缓存
        if (cacheItem.time) {
          const age = Date.now() - cacheItem.time;
          const maxAge = cacheItem.type === 'url'
            ? this.urlExpireHours * 3600 * 1000
            : this.cacheExpireDays * 24 * 3600 * 1000;

          if (age > maxAge && cacheItem.type !== 'cover') {
            try {
              fs.unlinkSync(filePath);
              delete this.cacheIndex[key];
              indexModified = true;
              result.removedFiles++;
              result.fixedIssues++;
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : '未知错误';
              result.errors.push(`删除过期文件失败 ${filePath}: ${errorMessage}`);
            }
          }
        }
      }

      // 删除孤立文件
      const checkAndRemoveOrphanedFiles = (subdir: string, extension: string) => {
        const dirPath = path.join(this.cacheDir, subdir);
        if (!fs.existsSync(dirPath)) return;

        const files = fs.readdirSync(dirPath);
        for (const filename of files) {
          if (!filename.endsWith(extension)) continue;

          const key = filename.replace(extension, '');
          const found = Object.keys(this.cacheIndex).some(indexKey => indexKey === key);
          if (!found) {
            try {
              fs.unlinkSync(path.join(dirPath, filename));
              result.removedFiles++;
              result.fixedIssues++;
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : '未知错误';
              result.errors.push(`删除孤立文件失败 ${filename}: ${errorMessage}`);
            }
          }
        }
      };

      checkAndRemoveOrphanedFiles('songs', '.json');
      checkAndRemoveOrphanedFiles('covers', '.jpg');
      checkAndRemoveOrphanedFiles('audio', '.mp3');
      checkAndRemoveOrphanedFiles('urls', '.json');

      // 保存修复后的索引
      if (indexModified) {
        this.saveIndex();
      }

    } catch (error) {
      console.error('缓存修复失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      result.errors.push(`修复过程出错: ${errorMessage}`);
    }

    return result;
  }

  startConsistencyCheck(interval: number = 3600000): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        const report = await this.checkCacheConsistency();
        if (report.inconsistencies.length > 0) {
          console.warn('发现缓存不一致，开始自动修复...', report);
          await this.repairCacheConsistency();
        }
      } catch (error) {
        console.error('定期缓存检查失败:', error);
      }
    }, interval);
  }
}

let cacheManagerInstance: CacheManager | null = null;

export function getCacheManager(): CacheManager {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager();
  }
  return cacheManagerInstance;
}
