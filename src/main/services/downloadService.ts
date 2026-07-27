import fs from 'fs';
import path from 'path';
import axios from 'axios';
import MP3Tag from 'mp3tag.js';
import { BrowserWindow } from 'electron';
import { musicApi } from '../api/musicApi';
import { getHttpAgent, getHttpsAgent } from '../proxy';
import type { Song } from '@mplayer/core';

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
  private abortControllers: Map<string, AbortController> = new Map();
  private maxConcurrentDownloads: number = 3;
  private downloadPath: string = '';

  private async fetchCoverAsBuffer(coverUrl: string): Promise<{ buffer: Buffer; mime: string } | null> {
    if (!coverUrl) return null;
    try {
      const url = new URL(coverUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    } catch {
      return null;
    }
    try {
      const res = await axios.get(coverUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
      });
      return { buffer: Buffer.from(res.data), mime: String(res.headers['content-type'] || 'image/jpeg') };
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
    } catch (err) {
      console.error('[DownloadService] 写入ID3标签异常:', err);
    }
  }

  initialize(options: DownloadOptions): void {
    this.downloadPath = options.downloadPath;

    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
    }
  }

  updateDownloadPath(newPath: string): void {
    // 验证路径不包含 .. 遍历，且是绝对路径
    const resolved = path.resolve(newPath);
    if (resolved.includes('..') || !path.isAbsolute(resolved)) {
      throw new Error('下载路径无效');
    }
    this.downloadPath = resolved;
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

      const controller = new AbortController();
      this.abortControllers.set(task.id, controller);

      const response = await axios({
        method: 'GET',
        url: realUrl,
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        responseType: 'stream',
        timeout: 60000,
        signal: controller.signal,
        onDownloadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            task.progress = progress;
            this.tasks.set(task.id, task);
            this.notifyProgress(task);
          }
        }
      });

      const ct = String(response.headers['content-type'] || '');
      if (ct.includes('text/html') || ct.includes('application/json')) {
        throw new Error('服务器返回了非音频内容，可能链接已失效');
      }
      let ext = '.mp3';
      if (ct.includes('audio/mpeg')) ext = '.mp3';
      else if (ct.includes('audio/mp4') || ct.includes('video/mp4')) ext = '.m4a';
      else if (ct.includes('audio/flac')) ext = '.flac';
      else if (ct.includes('audio/ogg')) ext = '.ogg';

      let fileName = this.sanitizeFileName(`${task.song.name} - ${task.song.artist}${ext}`);
      let filePath = path.join(this.downloadPath, fileName);
      // 重复文件名防覆盖：追加序号
      let counter = 1;
      while (fs.existsSync(filePath)) {
        fileName = this.sanitizeFileName(`${task.song.name} - ${task.song.artist} (${counter})${ext}`);
        filePath = path.join(this.downloadPath, fileName);
        counter++;
      }

      // 检查下载路径是否存在
      if (!fs.existsSync(this.downloadPath)) {
        try {
          fs.mkdirSync(this.downloadPath, { recursive: true });
        } catch (dirError) {
          throw new Error(`无法创建下载目录: ${dirError instanceof Error ? dirError.message : '未知错误'}`);
        }
      }

      // 检查文件路径长度限制
      let actualFilePath = filePath;
      if (filePath.length > 240) {
        const shortName = this.sanitizeFileName(`${task.song.name.substring(0, 50)} - ${task.song.artist.substring(0, 30)}${ext}`);
        actualFilePath = path.join(this.downloadPath, shortName);
      }
      task.filePath = actualFilePath;

      const writer = fs.createWriteStream(actualFilePath);
      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', () => {
          task.status = 'completed';
          task.progress = 100;
          this.tasks.set(task.id, task);
          this.notifyComplete(task);
          resolve();
        });

        writer.on('error', (error) => {
          console.error('[DownloadService] 写入文件失败:', error);
          task.status = 'error';
          task.error = error.message;
          this.tasks.set(task.id, task);
          this.notifyError(task, error);
          reject(error);
        });
      });

      // 写入ID3元数据（title/artist/album/封面等）
      await this.writeMetadata(task.song, actualFilePath);

    } catch (error) {
      console.error('[DownloadService] 下载失败:', error);
      task.status = 'error';
      task.error = error instanceof Error ? error.message : '下载失败';
      this.tasks.set(task.id, task);
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

    // 中止 HTTP 流
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }

    if (task.status === 'downloading' || task.status === 'pending') {
      task.status = 'error';
      task.error = '已取消';
      this.tasks.set(taskId, task);
      this.notifyError(task, new Error('已取消'));
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
    return fileName
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\.\./g, '_')
      .trim();
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
