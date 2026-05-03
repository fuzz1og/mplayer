import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { ipcMain, BrowserWindow } from 'electron';
import { musicApi } from '../api/musicApi';
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

  initialize(options: DownloadOptions): void {
    this.downloadPath = options.downloadPath;
    this.callbacks = options;

    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
    }

    this.setupIpcHandlers();
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

  private setupIpcHandlers(): void {
    ipcMain.handle('download:start', async (_event, song: Song) => {
      console.log('[DownloadService] 收到下载请求:', song);
      return this.addDownload(song);
    });

    ipcMain.handle('download:startBatch', async (_event, songs: Song[]) => {
      console.log('[DownloadService] 收到批量下载请求, 歌曲数量:', songs.length);
      return this.addBatchDownloads(songs);
    });

    ipcMain.handle('download:cancel', async (_event, taskId: string) => {
      return this.cancelDownload(taskId);
    });

    ipcMain.handle('download:getTasks', () => {
      return this.getAllTasks();
    });

    ipcMain.handle('download:clearCompleted', () => {
      return this.clearCompleted();
    });
  }

  addDownload(song: Song): DownloadTask {
    console.log('[DownloadService] addDownload 被调用, song:', song);
    const id = `${song.id}_${Date.now()}`;
    const task: DownloadTask = {
      id,
      song,
      progress: 0,
      status: 'pending'
    };

    this.tasks.set(id, task);
    this.queue.push(id);
    console.log('[DownloadService] 任务已添加到队列, taskId:', id, '队列长度:', this.queue.length);

    this.processQueue();

    return task;
  }

  addBatchDownloads(songs: Song[]): DownloadTask[] {
    const tasks: DownloadTask[] = [];
    const now = Date.now();

    songs.forEach((song, index) => {
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
    });

    this.processQueue();

    return tasks;
  }

  private async processQueue(): Promise<void> {
    console.log('[DownloadService] processQueue 被调用, 队列长度:', this.queue.length, '活动下载数:', this.activeDownloads.size);
    while (this.queue.length > 0 && this.activeDownloads.size < this.maxConcurrentDownloads) {
      const taskId = this.queue.shift();
      if (!taskId) continue;

      const task = this.tasks.get(taskId);
      console.log('[DownloadService] 处理任务:', taskId, '任务状态:', task?.status);
      if (!task || task.status === 'completed' || task.status === 'error') {
        console.log('[DownloadService] 任务跳过:', taskId);
        continue;
      }

      this.activeDownloads.add(taskId);
      console.log('[DownloadService] 开始下载文件:', taskId);
      this.downloadFile(task).finally(() => {
        this.activeDownloads.delete(taskId);
        this.processQueue();
      });
    }
  }

  private async downloadFile(task: DownloadTask): Promise<void> {
    console.log('[DownloadService] downloadFile 开始, task:', task.id, 'song.url:', task.song.url);
    task.status = 'downloading';
    this.tasks.set(task.id, task);

    try {
      if (!task.song.url) {
        console.error('[DownloadService] 歌曲URL为空, song:', task.song);
        throw new Error('歌曲URL为空');
      }

      // 获取真实的音频 URL（处理重定向）
      console.log('[DownloadService] 正在获取真实音频 URL...');
      let realUrl = task.song.url;
      try {
        realUrl = await musicApi.getAudioUrl(task.song.url);
        console.log('[DownloadService] 真实音频 URL:', realUrl);
      } catch (urlError) {
        console.error('[DownloadService] 获取真实音频 URL 失败:', urlError);
        // 使用原始 URL 继续
      }

      if (!realUrl) {
        throw new Error('无法获取音频 URL');
      }

      const fileName = this.sanitizeFileName(`${task.song.name} - ${task.song.artist}.mp3`);
      const filePath = path.join(this.downloadPath, fileName);
      console.log('[DownloadService] 下载路径:', filePath);

      const response = await axios({
        method: 'GET',
        url: realUrl,
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
