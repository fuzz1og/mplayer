import fs from 'fs';
import path from 'path';
import axios from 'axios';
import MP3Tag from 'mp3tag.js';
import { BrowserWindow } from 'electron';
import { musicApi, getApiClient } from '../api/musicApi';
import type { Song } from '@/shared/types/song';

export interface DownloadTask {
  id: string;
  song: Song;
  progress: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  error?: string;
  filePath?: string;
}

export interface DownloadOptions {
  downloadPath: string;
  onProgress?: (task: DownloadTask) => void;
  onComplete?: (task: DownloadTask) => void;
  onError?: (task: DownloadTask, error: Error) => void;
}

class DownloadService {
  private tasks: Map<string, DownloadTask> = new Map();
  private queue: string[] = [];
  private activeDownloads: Set<string> = new Set();
  private maxConcurrentDownloads: number = 3;
  private downloadPath: string = '';
  private callbacks: DownloadOptions = { downloadPath: '' };

  private async fetchCoverAsBuffer(coverUrl: string): Promise<{ buffer: Buffer; mime: string } | null> {
    if (!coverUrl) return null;
    try {
      const res = await axios.get(coverUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
      });
      return { buffer: Buffer.from(res.data), mime: res.headers['content-type'] || 'image/jpeg' };
    } catch {
      return null;
    }
  }

  private async writeMetadata(song: Song, filePath: string): Promise<void> {
    try {
      const buffer = fs.readFileSync(filePath);
      const mp3tag = new MP3Tag(buffer);
      mp3tag.read();
      if (mp3tag.error) {
        console.error('[DownloadService] 读取音频标签失败:', mp3tag.error);
        return;
      }

      mp3tag.tags.title = song.name || '';
      mp3tag.tags.artist = song.artist || '';
      mp3tag.tags.album = song.album || '';

      if (!mp3tag.tags.v2) {
        (mp3tag.tags as unknown as Record<string, unknown>).v2 = {};
      }

      mp3tag.tags.v2!.TIT2 = song.name || '';
      mp3tag.tags.v2!.TPE1 = song.artist || '';
      mp3tag.tags.v2!.TALB = song.album || '';

      const coverInfo = await this.fetchCoverAsBuffer(song.cover);
      if (coverInfo) {
        mp3tag.tags.v2!.APIC = [{
          format: coverInfo.mime,
          type: 3,
          description: 'Cover',
          data: Array.from(coverInfo.buffer),
        }];
      }

      const isM4a = filePath.endsWith('.m4a');
      mp3tag.save({
        id3v2: { padding: isM4a ? 0 : 2048 },
      });

      if (mp3tag.error) {
        console.error('[DownloadService] 写入ID3标签失败:', mp3tag.error);
        return;
      }

      const outBuf = mp3tag.buffer instanceof ArrayBuffer
        ? Buffer.from(mp3tag.buffer)
        : mp3tag.buffer;
      fs.writeFileSync(filePath, outBuf);
      console.log('[DownloadService] ID3元数据写入成功:', filePath);
    } catch (err) {
      console.error('[DownloadService] 写入ID3标签异常:', err);
    }
  }

  initialize(options: DownloadOptions): void {
    this.downloadPath = options.downloadPath;
    this.callbacks = options;

    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
    }
  }

  updateDownloadPath(newPath: string): void {
    this.downloadPath = newPath;
    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
    }
  }

  getDownloadPath(): string {
    return this.downloadPath;
  }

  addDownload(song: Song): DownloadTask {
    const id = `${song.id}_${Date.now()}`;
    const task: DownloadTask = {
      id,
      song,
      progress: 0,
      status: 'pending'
    };

    this.tasks.set(id, task);
    this.queue.push(id);

    this.processQueue();

    return task;
  }

  addBatchDownloads(songs: Song[]): DownloadTask[] {
    const tasks: DownloadTask[] = [];
    const now = Date.now();

    songs.forEach((song, index) => {
      try {
        // 验证歌曲数据
        if (!song.id || !song.name || !song.url) {
          console.error(`歌曲数据不完整，跳过下载: ${song.name || '未知'}`);
          return;
        }

        const id = `${song.id}_${now}_${index}`;
        const task: DownloadTask = {
          id,
          song,
          progress: 0,
          status: 'pending'
        };

        this.tasks.set(id, task);
        this.queue.push(id);
        tasks.push(task);
      } catch (error) {
        console.error(`创建下载任务失败 [${song.name}]:`, error);
      }
    });

    if (tasks.length > 0) {
      this.processQueue();
      console.log(`批量下载任务创建成功: ${tasks.length}/${songs.length} 个任务`);
    } else {
      console.warn('没有有效的下载任务被创建');
    }

    return tasks;
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.activeDownloads.size < this.maxConcurrentDownloads) {
      const taskId = this.queue.shift();
      if (!taskId) continue;

      const task = this.tasks.get(taskId);
      if (!task || task.status === 'completed' || task.status === 'error') {
        continue;
      }

      this.activeDownloads.add(taskId);

      // 添加错误处理和重试机制
      this.downloadFileWithRetry(task).finally(() => {
        this.activeDownloads.delete(taskId);
        this.processQueue();
      });
    }
  }

  private async downloadFileWithRetry(task: DownloadTask, maxRetries: number = 3): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.downloadFile(task);
        return; // 成功则返回
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          // 指数退避重试
          const delay = Math.pow(2, attempt) * 1000;
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          console.log(`下载失败 [${task.song.name}], ${attempt + 1}/${maxRetries} 重试, ${delay}ms后重试:`, errorMessage);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // 所有重试都失败
    if (lastError) {
      task.status = 'error';
      task.error = `下载失败 (重试 ${maxRetries} 次后): ${lastError.message}`;
      this.tasks.set(task.id, task);

      // 通知错误
      this.notifyError(task, lastError);
    }
  }

  private async downloadFile(task: DownloadTask): Promise<void> {
    task.status = 'downloading';
    this.tasks.set(task.id, task);

    try {
      let realUrl: string;

      if (task.song.sourceType === 'soda') {
        if (task.song.url) {
          realUrl = task.song.url;
        } else {
          try {
            realUrl = await musicApi.getSodaAudioUrl(task.song.id);
          } catch (urlError) {
            console.error('[DownloadService] 获取汽水音乐音频 URL 失败:', urlError);
            realUrl = '';
          }
        }
      } else {
        if (!task.song.url) {
          console.error('[DownloadService] 歌曲URL为空, song:', task.song);
          throw new Error('歌曲URL为空');
        }
        realUrl = task.song.url;
        try {
          realUrl = await musicApi.getAudioUrl(task.song.url);
        } catch (urlError) {
          console.error('[DownloadService] 获取真实音频 URL 失败:', urlError);
        }
      }

      if (!realUrl) {
        throw new Error('无法获取音频 URL');
      }

      const apiClient = getApiClient();
      const response = await axios({
        method: 'GET',
        url: realUrl,
        httpAgent: apiClient.defaults.httpAgent,
        httpsAgent: apiClient.defaults.httpsAgent,
        responseType: 'stream',
        timeout: 60000,
        onDownloadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            task.progress = progress;
            this.tasks.set(task.id, task);
            this.callbacks.onProgress?.(task);
            this.notifyProgress(task);
          }
        }
      });

      const ct = response.headers['content-type'] || '';
      let ext = '.mp3';
      if (ct.includes('audio/mpeg')) ext = '.mp3';
      else if (ct.includes('audio/mp4') || ct.includes('video/mp4')) ext = '.m4a';
      else if (ct.includes('audio/flac')) ext = '.flac';
      else if (ct.includes('audio/ogg')) ext = '.ogg';

      const fileName = this.sanitizeFileName(`${task.song.name} - ${task.song.artist}${ext}`);
      const filePath = path.join(this.downloadPath, fileName);

      // 检查下载路径是否存在
      if (!fs.existsSync(this.downloadPath)) {
        try {
          fs.mkdirSync(this.downloadPath, { recursive: true });
        } catch (dirError) {
          throw new Error(`无法创建下载目录: ${dirError instanceof Error ? dirError.message : '未知错误'}`);
        }
      }

      // 检查文件路径长度限制
      if (filePath.length > 240) {
        const shortName = this.sanitizeFileName(`${task.song.name.substring(0, 50)} - ${task.song.artist.substring(0, 30)}${ext}`);
        const newFilePath = path.join(this.downloadPath, shortName);
        task.filePath = newFilePath;
      } else {
        task.filePath = filePath;
      }

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', () => {
          console.log('[DownloadService] 下载完成:', filePath);
          task.status = 'completed';
          task.progress = 100;
          task.filePath = filePath;
          this.tasks.set(task.id, task);
          this.callbacks.onComplete?.(task);
          this.notifyComplete(task);
          resolve();
        });

        writer.on('error', (error) => {
          console.error('[DownloadService] 写入文件失败:', error);
          task.status = 'error';
          task.error = error.message;
          this.tasks.set(task.id, task);
          this.callbacks.onError?.(task, error);
          this.notifyError(task, error);
          reject(error);
        });
      });

      // 写入ID3元数据（title/artist/album/封面等）
      await this.writeMetadata(task.song, filePath);

    } catch (error) {
      console.error('[DownloadService] 下载失败:', error);
      task.status = 'error';
      task.error = error instanceof Error ? error.message : '下载失败';
      this.tasks.set(task.id, task);
      this.callbacks.onError?.(task, error instanceof Error ? error : new Error('下载失败'));
      this.notifyError(task, error instanceof Error ? error : new Error('下载失败'));
    }
  }

  cancelDownload(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const queueIndex = this.queue.indexOf(taskId);
    if (queueIndex > -1) {
      this.queue.splice(queueIndex, 1);
    }

    if (task.status === 'downloading') {
      task.status = 'error';
      task.error = '已取消';
      this.tasks.set(taskId, task);
    }

    return true;
  }

  getTask(taskId: string): DownloadTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): DownloadTask[] {
    return Array.from(this.tasks.values());
  }

  getPendingTasks(): DownloadTask[] {
    return this.getAllTasks().filter(t => t.status === 'pending');
  }

  getDownloadingTasks(): DownloadTask[] {
    return this.getAllTasks().filter(t => t.status === 'downloading');
  }

  getCompletedTasks(): DownloadTask[] {
    return this.getAllTasks().filter(t => t.status === 'completed');
  }

  clearCompleted(): void {
    const completedIds = this.getCompletedTasks().map(t => t.id);
    completedIds.forEach(id => this.tasks.delete(id));
  }

  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[<>:"/\\|?*]/g, '_');
  }

  private notifyProgress(task: DownloadTask): void {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('download:progress', task);
    });
  }

  private notifyComplete(task: DownloadTask): void {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('download:complete', task);
    });
  }

  private notifyError(task: DownloadTask, error: Error): void {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('download:error', { task, error: error.message });
    });
  }
}

export const downloadService = new DownloadService();
