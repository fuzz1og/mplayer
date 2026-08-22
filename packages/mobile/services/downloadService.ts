import { File, Directory, Paths } from 'expo-file-system';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { Song, AudioContainer } from '@mplayer/core';
import {
  musicApi,
  md5,
  detectAudioContainer,
  extensionForContainer,
  lrcSidecarName,
  looksLikeLyrics,
  estimateDownloadProgress,
  retryBackoffMs,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_CONCURRENT,
  makeSongFileName,
} from '@mplayer/core';
import { useDownloadStore } from '../stores/downloadStore';
import { useLogsStore } from '../stores/logsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { resolvePlayableUrlMobile } from './audioPlayer';

// 共享下载文件名生成器（T19，core）：来源前缀 + 组合哈希防跨源覆盖，URI/Windows 安全
const buildSongFileName = makeSongFileName({ hash: md5 });

// 下载目录：应用文档目录（系统不会自动清理）。公共下载目录通过 SAF 授权后同步一份。
const downloadDir = new Directory(Paths.document, 'mplayer-downloads');

/** 容器 → SAF 公共文件 MIME（音频下载用真实容器 MIME，而非一律 audio/mpeg） */
function mimeForContainer(container: AudioContainer): string {
  switch (container) {
    case 'm4a':
      return 'audio/mp4';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
      return 'audio/ogg';
    default:
      return 'audio/mpeg';
  }
}

/**
 * 选择公共下载目录（Android SAF）：授权成功后持久化，后续下载直接写入。
 * 未授权/非 Android 返回 false，下载仍保存在应用私有目录。
 */
export async function pickDownloadDirectory(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (result.granted) {
    useSettingsStore.getState().setDownloadDirUri(result.directoryUri);
    return true;
  }
  return false;
}

/**
 * 将私有副本写入 SAF 公共目录，返回公共文件 content:// uri；失败抛错由调用方降级。
 * mime 默认 audio/mpeg（兼容无容器识别的调用方）。
 */
export async function writePublicCopy(
  privateUri: string,
  fileName: string,
  dirUri: string,
  mime: string = 'audio/mpeg'
): Promise<string> {
  const publicUri = await StorageAccessFramework.createFileAsync(dirUri, fileName, mime);
  const base64 = await StorageAccessFramework.readAsStringAsync(privateUri, { encoding: 'base64' });
  await StorageAccessFramework.writeAsStringAsync(publicUri, base64, { encoding: 'base64' });
  return publicUri;
}

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 目录授权是否仍有效（授权可能被系统/用户撤销） */
async function isDirGrantValid(dirUri: string): Promise<boolean> {
  try {
    await StorageAccessFramework.readDirectoryAsync(dirUri);
    return true;
  } catch {
    return false;
  }
}

/** 播放失败时清理失败的下载文件 */
async function removeFileIfExists(file: File): Promise<void> {
  try {
    if (file.exists) await file.delete();
  } catch { /* 忽略清理失败 */ }
}

/**
 * 下载文件全名：来自 core 共享生成器（T19），来源前缀 + 组合哈希防跨源同名覆盖；
 * 分隔符用 `()` 且清理 URI/Windows 非法字符（expo File API 的 file:// 遇到 `[]` 会抛 URISyntaxException）。
 */
function buildFileName(song: Song): string {
  return buildSongFileName({
    source: song.sourceType || 'netease',
    name: song.name,
    artist: song.artist,
  });
}

/**
 * 下载后按字节头嗅探真实容器。若扩展名与容器不符（如 FLAC 被存为 .mp3），
 * 重命名为正确扩展名并返回 { fileName, container }；否则原样返回。
 */
async function correctContainerName(
  file: File,
  fileName: string
): Promise<{ fileName: string; container: AudioContainer }> {
  let head = new Uint8Array(0);
  try {
    const buf = await file.slice(0, 16).arrayBuffer();
    head = new Uint8Array(buf);
  } catch { /* 读头失败则沿用默认容器 */ }
  const container = detectAudioContainer(head);
  const correctExt = extensionForContainer(container);
  const fileExt = file.extension;
  if (correctExt === fileExt) return { fileName, container };
  // 需要重命名：去掉原扩展名，换成正确扩展名
  const base = fileName.replace(/\.[^.]*$/, '');
  const newName = base + correctExt;
  const newFile = new File(downloadDir, newName);
  try {
    await file.move(newFile);
    return { fileName: newName, container };
  } catch {
    // 重命名失败不阻断：沿用原名（至少播放仍可用）
    return { fileName, container };
  }
}

// 进行中的下载去重：重复点击同一首歌复用同一 promise，避免并发写同一文件
const inFlight = new Map<string, Promise<File>>();

/** 下载歌曲到本地：解析直链 → 下载 → 更新下载列表。重复点击同一首自动复用进行中的下载。 */
// 下载并发门控（T16 移动端）：同时进行的下载受 DEFAULT_MAX_CONCURRENT 约束，
// 单首失败只影响自身（调用方各自 catch/提示），不阻塞其他任务。槽位在释放时
// 直接转移给最早的等待者，避免惊群。
let activeDownloads = 0;
const downloadWaiters: (() => void)[] = [];

async function acquireDownloadSlot(): Promise<void> {
  if (activeDownloads < DEFAULT_MAX_CONCURRENT) {
    activeDownloads++;
    return;
  }
  await new Promise<void>((resolve) => downloadWaiters.push(resolve));
  activeDownloads++;
}

function releaseDownloadSlot(): void {
  activeDownloads--;
  const next = downloadWaiters.shift();
  if (next) next();
}

export async function downloadSong(song: Song): Promise<File> {
  const fileName = buildFileName(song);
  const existing = inFlight.get(fileName);
  if (existing) return existing;
  const promise = (async () => {
    await acquireDownloadSlot();
    try {
      return await doDownload(song, fileName);
    } finally {
      releaseDownloadSlot();
    }
  })();
  inFlight.set(fileName, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(fileName);
  }
}

async function doDownload(song: Song, fileName: string): Promise<File> {
  const log = useLogsStore.getState();
  const { addItem, updateStatus } = useDownloadStore.getState();

  const file = new File(downloadDir, fileName);
  // 目标文件已存在（此前下载成功过）：本次失败不能删它，否则离线副本丢失
  const existedBefore = file.exists;
  const itemKey = `${song.sourceType || 'netease'}:${song.id}`;
  // addItem 会替换旧记录，旧公共文件 uri 需在替换前捕获（重新下载时清理旧文件用）
  const prevPublicUri = useDownloadStore.getState().items.find((i) => i.key === itemKey)?.publicUri;
  addItem({
    key: itemKey,
    songId: song.id,
    name: song.name,
    artist: song.artist,
    fileName,
    status: 'downloading',
    progress: 0,
    addedAt: Date.now(),
  });

  try {
    // 与播放同一套解析（路由链：直连→tier3→api 兜底，含预取缓存），拿 CDN 直链下载。
    // 不能用 song.url 原值：移动端歌的 url 字段常为空/过期（播放也是现解析的），
    // 直接下载会抛「无法解析下载地址」。
    const { url: realUrl } = await resolvePlayableUrlMobile(song);
    if (!realUrl?.startsWith('http')) throw new Error('无法解析下载地址');

    await downloadDir.create({ intermediates: true, idempotent: true });
    await downloadWithRetry(song, realUrl, file, itemKey, updateStatus);

    // 按字节头嗅探真实容器，修正扩展名（FLAC/M4A 不再被错标成 .mp3）
    const corrected = await correctContainerName(file, fileName);
    if (corrected.fileName !== fileName) {
      updateStatus(itemKey, { fileName: corrected.fileName });
    }

    // 写入 .lrc 歌词侧车（与音频同名同目录）；歌词不可用/获取失败不影响下载结果
    await writeLyricsSidecar(song, corrected.fileName, corrected.container);

    // 已授权公共目录时同步一份到系统下载目录；失败不阻断（私有副本仍可播放）。
    // 未授权时不弹系统目录选择器：默认保存在应用私有目录，用户可在下载页「保存位置」卡主动授权。
    const dirUri = useSettingsStore.getState().downloadDirUri;
    let publicUri: string | undefined;
    if (dirUri) {
      if (await isDirGrantValid(dirUri)) {
        try {
          // 重新下载时先清掉旧公共文件，避免同名堆积（系统会自动改名 song (1).mp3）
          if (prevPublicUri) {
            await StorageAccessFramework.deleteAsync(prevPublicUri, { idempotent: true }).catch(() => {});
          }
          publicUri = await writePublicCopy(file.uri, corrected.fileName, dirUri, mimeForContainer(corrected.container));
          log.addLog('info', `已同步到公共下载目录《${song.name}》`);
          // 歌词侧车同样同步到公共目录（失败不阻断音频）
          await writePublicLyrics(song, corrected.fileName, dirUri).catch(() => {});
        } catch (e: unknown) {
          // 写入中途失败时清掉半成品公共文件，避免留下空文件
          if (publicUri) {
            await StorageAccessFramework.deleteAsync(publicUri, { idempotent: true }).catch(() => {});
          }
          log.addLog('error', `公共目录写入失败（保留应用内副本）《${song.name}》: ${toErrorMessage(e)}`);
        }
      } else {
        useSettingsStore.getState().setDownloadDirUri('');
        log.addLog('error', '下载目录授权已失效，本次仅保存在应用内');
      }
    }

    updateStatus(itemKey, { status: 'done', progress: 100, publicUri });
    log.addLog('info', `下载完成《${song.name}》- ${song.artist}`);
    return new File(downloadDir, corrected.fileName);
  } catch (e) {
    // 只清理本次新建的文件：已有文件（上次下载成功）失败时保留，避免丢离线副本
    if (!existedBefore) await removeFileIfExists(file);
    const err = e as Error;
    if (existedBefore) {
      // 旧文件仍可播放：回退 done，避免失败状态挡住播放/列表残留
      updateStatus(itemKey, { status: 'done', progress: 100 });
    } else {
      // 全新下载失败：不残留失败条目（失败原因已在 Alert/日志展示，重试 = 再点下载）
      useDownloadStore.getState().removeItem(itemKey);
    }
    log.addLog('error', `下载失败《${song.name}》: ${toErrorMessage(e)}`);
    throw err;
  }
}

/**
 * 下载文件（含失败有限重试）。进度通过 onProgress 上报 core 估算（未知总量软进度，
 * 不再卡 0%）；超过最大重试后抛错（单首失败不影响其他任务）。
 */
async function downloadWithRetry(song: Song, realUrl: string, file: File, itemKey: string, updateStatus: (k: string, p: any) => void): Promise<void> {
  // 重试次数统一消费 core 常量（评审修复：两端不再各自硬编码）
  const maxRetries = DEFAULT_MAX_RETRIES;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await File.downloadFileAsync(realUrl, file, {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
          const progress = estimateDownloadProgress({
            loaded: bytesWritten,
            total: totalBytes >= 0 ? totalBytes : null,
          });
          updateStatus(itemKey, { progress });
        },
      });
      return;
    } catch (e) {
      lastError = e;
      const delay = retryBackoffMs(attempt, maxRetries);
      if (delay < 0) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`下载失败《${song.name}》`);
}

/** 写入 .lrc 歌词侧车（私有目录，与音频同名）。获取失败/非可用 LRC 时跳过。 */
async function writeLyricsSidecar(song: Song, fileName: string, _container: AudioContainer): Promise<void> {
  const lrcUrl = song.lrc?.trim();
  if (!lrcUrl) return;
  let content: string;
  try {
    content = await musicApi.getLyrics(lrcUrl);
  } catch {
    return;
  }
  if (!looksLikeLyrics(content)) return;
  const lrcName = lrcSidecarName(fileName);
  const lrcFile = new File(downloadDir, lrcName);
  try {
    await lrcFile.create({ overwrite: true, intermediates: true });
    await lrcFile.write(content);
  } catch { /* .lrc 写失败不影响音频结果 */ }
}

/** 将 .lrc 侧车同步到 SAF 公共目录（失败向下游静默）。 */
async function writePublicLyrics(song: Song, fileName: string, dirUri: string): Promise<void> {
  if (!song.lrc?.trim()) return;
  const content = await musicApi.getLyrics(song.lrc.trim()).catch(() => '');
  if (!looksLikeLyrics(content)) return;
  const lrcName = lrcSidecarName(fileName);
  const privateUri = new File(downloadDir, lrcName).uri;
  await writePublicCopy(privateUri, lrcName, dirUri, 'text/plain');
}

/** 已下载歌曲的本地 file:// 播放 URI（未下载/文件丢失返回 null） */
export function getLocalUri(fileName: string): string {
  return new File(downloadDir, fileName).uri;
}

/** 删除下载项对应的文件（私有 + SAF 公共，文件不存在时静默）；状态记录删除由调用方处理 */
export async function removeDownloadedFile(fileName: string, publicUri?: string): Promise<void> {
  await removeFileIfExists(new File(downloadDir, fileName));
  if (publicUri) {
    try {
      await StorageAccessFramework.deleteAsync(publicUri, { idempotent: true });
    } catch {
      // 公共文件清理失败不阻塞删除操作
    }
  }
}
