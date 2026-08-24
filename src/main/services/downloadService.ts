import fs from 'fs';
import path from 'path';
import axios from 'axios';
import MP3Tag from 'mp3tag.js';
import { BrowserWindow } from 'electron';
import { musicApi } from '../api/musicApi';
import { getHttpAgent, getHttpsAgent } from '../proxy';
import {
  type Song,
  buildID3Frames,
  containerFromContentType,
  detectAudioContainer,
  estimateDownloadProgress,
  extensionForContainer,
  looksLikeLyrics,
  lrcSidecarName,
  resolvePlayableSongRouted,
  retryBackoffMs,
  sanitizeFileNameFragment,
  tagStrategyForContainer,
  takeNextQueued,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_RETRIES,
} from '@mplayer/core';

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

export class DownloadService {
  private tasks: Map<string, DownloadTask> = new Map();
  private queue: string[] = [];
  private activeDownloads: Set<string> = new Set();
  private abortControllers: Map<string, AbortController> = new Map();
  private maxConcurrentDownloads: number = DEFAULT_MAX_CONCURRENT;
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

  /**
   * 写入音频元数据（title/artist/album/封面/真实时长）。按容器类型选择标签写入
   * 方式（见 core download/tagging）：MP3 走 mp3tag.js ID3；M4A 走 mp3tag.js 的
   * MP4/ID32 容器写入；FLAC/Ogg 等 mp3tag.js 不支持容器 → 明确跳过，不错灌 ID3。
   */
  private async writeMetadata(song: Song, filePath: string): Promise<void> {
    try {
      const buffer = fs.readFileSync(filePath);
      const container = detectAudioContainer(buffer);
      const strategy = tagStrategyForContainer(container);
      if (strategy === 'skip') {
        console.log(
          `[DownloadService] 容器(${container})不支持写 ID3，跳过标签写入（避免错灌）: ${filePath}`
        );
        return;
      }

      const coverInfo = await this.fetchCoverAsBuffer(song.cover);
      const frames = buildID3Frames({
        title: song.name || '',
        artist: song.artist || '',
        album: song.album || '',
        // 真实时长（秒 → 毫秒）；song.duration 缺失/为 0 时 core 自动跳过 TLEN
        durationMs: (song.duration || 0) * 1000,
        cover: coverInfo ? { format: coverInfo.mime, bytes: Array.from(coverInfo.buffer) } : undefined,
      });

      const mp3tag = new MP3Tag(buffer);
      mp3tag.read();
      if (mp3tag.error) {
        console.error('[DownloadService] 读取音频标签失败:', mp3tag.error, '(跳过标签写入)');
        return;
      }

      mp3tag.tags.title = song.name || '';
      mp3tag.tags.artist = song.artist || '';
      mp3tag.tags.album = song.album || '';
      if (!mp3tag.tags.v2) {
        (mp3tag.tags as unknown as Record<string, unknown>).v2 = {};
      }
      mp3tag.tags.v2!.TIT2 = frames.v2.TIT2;
      mp3tag.tags.v2!.TPE1 = frames.v2.TPE1;
      mp3tag.tags.v2!.TALB = frames.v2.TALB;
      if (frames.v2.TLEN != null) mp3tag.tags.v2!.TLEN = frames.v2.TLEN;
      if (frames.v2.APIC) {
        mp3tag.tags.v2!.APIC = frames.v2.APIC.map((apic) => ({
          format: apic.format,
          type: apic.type,
          description: apic.description,
          data: apic.data,
        }));
      }

      const isM4a = container === 'm4a';
      mp3tag.save({
        id3v2: { padding: isM4a ? 0 : 2048 },
      });

      if (mp3tag.error) {
        console.error('[DownloadService] 写入标签失败:', mp3tag.error);
        return;
      }

      const outBuf = mp3tag.buffer instanceof ArrayBuffer
        ? Buffer.from(mp3tag.buffer)
        : mp3tag.buffer;
      fs.writeFileSync(filePath, outBuf);
    } catch (err) {
      console.error('[DownloadService] 写入标签异常:', err);
    }
  }

  /**
   * 按文件字节头修正扩展名（Content-Type 不可靠时的二次校验，评审修复）。
   * 真实容器与当前扩展名不一致时重命名并更新任务；检测失败/无需修正则原样返回。
   */
  private correctContainerFileName(filePath: string, task: DownloadTask): string {
    try {
      const container = detectAudioContainer(fs.readFileSync(filePath));
      if (container === 'unknown') return filePath;
      const correctExt = extensionForContainer(container);
      const currentExt = path.extname(filePath);
      if (!currentExt || currentExt === correctExt) return filePath;
      const correctedPath = filePath.slice(0, filePath.length - currentExt.length) + correctExt;
      fs.renameSync(filePath, correctedPath);
      task.filePath = correctedPath;
      this.tasks.set(task.id, task);
      console.log(`[DownloadService] 按字节头修正扩展名: ${path.basename(filePath)} → ${path.basename(correctedPath)}`);
      return correctedPath;
    } catch (err) {
      console.error('[DownloadService] 修正扩展名失败（保留原文件名）:', err);
      return filePath;
    }
  }

  /**
   * 写入 .lrc 歌词侧车文件（与音频同目录同名）。源站有歌词（song.lrc 为歌词 URL）
   * 时才尝试；抓取失败/内容非可用 LRC（非法请求页等）则跳过，不影响音频下载结果。
   */
  private async writeLyricsSidecar(song: Song, filePath: string): Promise<void> {
    const lrcUrl = song.lrc?.trim();
    if (!lrcUrl) return;
    let content: string;
    try {
      content = await musicApi.getLyrics(lrcUrl);
    } catch (err) {
      console.error('[DownloadService] 获取歌词失败，跳过 .lrc 写入:', err);
      return;
    }
    if (!looksLikeLyrics(content)) {
      console.log('[DownloadService] 歌词内容不可用（可能为非法请求页），跳过 .lrc 写入');
      return;
    }
    const sidecarPath = path.join(path.dirname(filePath), lrcSidecarName(path.basename(filePath)));
    try {
      fs.writeFileSync(sidecarPath, content, 'utf-8');
      console.log(`[DownloadService] 已写入歌词侧车: ${sidecarPath}`);
    } catch (err) {
      console.error('[DownloadService] 写 .lrc 文件失败:', err);
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

  /**
   * 批量下载（下载前可播性预检 #181）：先批量探测直连可播性，
   * 死链（invalid）直接跳过不进队列，避免对失效链接发起下载。
   * 探测走 probeSongsBatch（直连-only，短超时，不触发 tier3）。
   */
  async addBatchDownloads(songs: Song[]): Promise<DownloadTask[]> {
    const tasks: DownloadTask[] = [];
    const now = Date.now();

    let playable = songs;
    if (Array.isArray(songs) && songs.length > 0) {
      try {
        const tags = await musicApi.probeSongsBatch(songs);
        const deadIds = new Set(tags.filter((t) => t.tag === 'invalid').map((t) => t.songId));
        if (deadIds.size > 0) {
          console.warn(`[DownloadService] 批量下载预检跳过 ${deadIds.size} 首死链`);
          playable = songs.filter((s) => !deadIds.has(s.id));
        }
      } catch (probeError) {
        // 预检失败不阻断下载：仍按原列表入队（下载时逐首解析仍会拦截死链）
        console.error('[DownloadService] 批量下载预检失败，按原列表入队:', probeError);
        playable = songs;
      }
    }

    playable.forEach((song, index) => {
      try {
        // 验证歌曲数据：url 由下载时按身份懒解析（#171 后列表歌 url 恒空），不作前置要求
        if (!song.id || !song.name) {
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
    while (true) {
      // 并发受控：active 未达上限时从队首取下一个任务（core 判定）
      const { next, remaining } = takeNextQueued(this.queue, this.activeDownloads.size, this.maxConcurrentDownloads);
      this.queue = remaining;
      if (!next) break;

      const task = this.tasks.get(next);
      if (!task || task.status === 'completed' || task.status === 'error') {
        continue; // 跳过无效任务，继续推进队列
      }

      this.activeDownloads.add(next);
      this.downloadFileWithRetry(task).finally(() => {
        this.activeDownloads.delete(next);
        this.processQueue(); // 单首完成/失败后自动续下一首
      });
    }
  }

  private async downloadFileWithRetry(task: DownloadTask, maxRetries: number = DEFAULT_MAX_RETRIES): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.downloadFile(task);
        return; // 成功则返回
      } catch (error) {
        lastError = error as Error;

        // 指数退避（core 判定，超过最大重试返回 -1 表示不再等待）
        const delay = retryBackoffMs(attempt, maxRetries);
        if (delay < 0) break;
        await new Promise(resolve => setTimeout(resolve, delay));
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
      } else if (task.song.sourceType === 'local') {
        // 本地歌曲的 url 即文件路径，直接使用
        realUrl = task.song.url;
      } else {
        // 按身份解析（预取缓存 → 直连 → tier3）：#171 后列表歌 url 恒空，
        // 旧签名死链（api.php?get=*）由解析链按歌曲 id 重取，绝不再交给下载流
        try {
          const resolved = await resolvePlayableSongRouted(task.song);
          realUrl = resolved?.url || '';
        } catch (urlError) {
          console.error('[DownloadService] 按身份解析音频 URL 失败:', urlError);
          realUrl = '';
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
          // Content-Length 缺失/chunked 时 total 为 0/undefined：改走 core 软进度估算，不再卡 0%
          const total = progressEvent.total;
          const progress = estimateDownloadProgress({
            loaded: progressEvent.loaded,
            total: total != null && total > 0 ? total : null,
          });
          task.progress = progress;
          this.tasks.set(task.id, task);
          this.notifyProgress(task);
        }
      });

      const ct = String(response.headers['content-type'] || '');
      if (ct.includes('text/html') || ct.includes('application/json')) {
        throw new Error('服务器返回了非音频内容，可能链接已失效');
      }
      // 按真实 Content-Type 推断容器并取正确扩展名（替代硬编码 .mp3）
      const container = containerFromContentType(ct);
      const ext = extensionForContainer(container ?? 'unknown');

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

      // 写入标签元数据（title/artist/album/封面/真实时长）与 .lrc 歌词侧车
      // 先按字节头修正扩展名：源站 Content-Type 不可靠（FLAC 报 audio/mpeg 等）时，
      // 按真实容器重命名，避免 FLAC/M4A 错标成 .mp3（对齐移动端 correctContainerName）
      actualFilePath = this.correctContainerFileName(actualFilePath, task);
      await this.writeMetadata(task.song, actualFilePath);
      await this.writeLyricsSidecar(task.song, actualFilePath);

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
    return sanitizeFileNameFragment(fileName);
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
