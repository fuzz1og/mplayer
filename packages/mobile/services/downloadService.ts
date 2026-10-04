import { File, Directory, Paths } from 'expo-file-system';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import MP3Tag from 'mp3tag.js';
import type { Song, AudioContainer } from '@mplayer/core';
import {
  md5,
  BROWSER_UA,
  buildID3Frames,
  COVER_SIZE,
  coverThumbUrl,
  detectAudioContainer,
  extensionForContainer,
  lrcSidecarName,
  looksLikeLyrics,
  refererForSourceKey,
  tagStrategyForContainer,
  estimateDownloadProgress,
  retryBackoffMs,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_CONCURRENT,
  makeSongFileName,
} from '@mplayer/core';
import { resolveLyricsText } from './lyrics';
import { useDownloadStore } from '../stores/downloadStore';
import { useDownloadProgressStore } from '../stores/downloadProgressStore';
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

/** 内嵌封面字节上限（对齐桌面 downloadService）：超限则只写文本标签，不撑爆内存 */
const MAX_EMBEDDED_COVER_BYTES = 1024 * 1024;

/** ID3v2 padding：预留便于后续改标签（m4a 不写，见 ADR 2026-10-04） */
const ID3V2_PADDING = 2048;

/** mp3tag 在 node/CJS 下回 Buffer、在 RN（无 Buffer）下回 ArrayBuffer —— 统一成 Uint8Array */
function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  const view = value as { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number } | null;
  if (view?.buffer) return new Uint8Array(view.buffer, view.byteOffset ?? 0, view.byteLength ?? 0);
  return new Uint8Array(0);
}

/**
 * 抓封面字节用于内嵌：按源带 Referer，超过 MAX_EMBEDDED_COVER_BYTES 或失败返回 undefined
 * （只写文本标签）。**列表封面不经过这里**——那是远端直链（见 GLOSSARY「列表封面」）。
 */
async function fetchEmbeddableCover(song: Song): Promise<{ format: string; bytes: number[] } | undefined> {
  const coverUrl = song.cover?.trim();
  if (!coverUrl) return undefined;
  try {
    const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
    const referer = refererForSourceKey(song.sourceType || 'netease');
    if (referer) headers.Referer = referer;
    // 按源 CDN 机制要 embed 档缩略图（core 单点，ADR 2026-09-30）：内嵌体积直接等于
    // 每个下载文件变大的量，原图动辄 540KB；不认识的源原样返回，仍受 1MB 上限兜底。
    const res = await fetch(coverThumbUrl(coverUrl, COVER_SIZE.embed), { headers });
    if (!res.ok) return undefined;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_EMBEDDED_COVER_BYTES) return undefined;
    return { format: res.headers.get('content-type') || 'image/jpeg', bytes: Array.from(buf) };
  } catch {
    return undefined;
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
    // 局部读必须走 FileHandle#readBytes：expo File 的 slice() 返回 RN Blob，RN 的 Blob
    // 没有 arrayBuffer()，实测读头静默失败 → 容器恒判 unknown（FLAC/M4A 从不会被改名）。
    const handle = file.open();
    try {
      head = handle.readBytes(16);
    } finally {
      handle.close();
    }
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
    cover: song.cover || undefined,
    addedAt: Date.now(),
  });
  // 重新下载：清掉上一次残留的瞬时进度（进度不落盘，状态才落盘）
  useDownloadProgressStore.getState().clearProgress(itemKey);

  try {
    // 与播放同一套解析（路由链：直连→tier3→api 兜底，含预取缓存），拿 CDN 直链下载。
    // 不能用 song.url 原值：移动端歌的 url 字段常为空/过期（播放也是现解析的），
    // 直接下载会抛「无法解析下载地址」。
    const { url: realUrl } = await resolvePlayableUrlMobile(song);
    if (!realUrl?.startsWith('http')) throw new Error('无法解析下载地址');

    await downloadDir.create({ intermediates: true, idempotent: true });
    await downloadWithRetry(song, realUrl, file, itemKey);

    // 按字节头嗅探真实容器，修正扩展名（FLAC/M4A 不再被错标成 .mp3）
    const corrected = await correctContainerName(file, fileName);
    if (corrected.fileName !== fileName) {
      updateStatus(itemKey, { fileName: corrected.fileName });
    }

    // 内嵌元数据（ADR 2026-10-04：只写 MP3；失败静默）——必须在同步公共目录之前，
    // 否则公共副本没有标签。
    await writeMetadata(file, song, corrected.container);

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

    updateStatus(itemKey, { status: 'done', publicUri });
    useDownloadProgressStore.getState().clearProgress(itemKey);
    log.addLog('info', `下载完成《${song.name}》- ${song.artist}`);
    return new File(downloadDir, corrected.fileName);
  } catch (e) {
    // 只清理本次新建的文件：已有文件（上次下载成功）失败时保留，避免丢离线副本
    if (!existedBefore) await removeFileIfExists(file);
    const err = e as Error;
    if (existedBefore) {
      // 旧文件仍可播放：回退 done，避免失败状态挡住播放/列表残留
      updateStatus(itemKey, { status: 'done' });
      useDownloadProgressStore.getState().clearProgress(itemKey);
    } else {
      // 全新下载失败：不残留失败条目（失败原因已在 Alert/日志展示，重试 = 再点下载）
      useDownloadStore.getState().removeItem(itemKey);
      useDownloadProgressStore.getState().clearProgress(itemKey);
    }
    log.addLog('error', `下载失败《${song.name}》: ${toErrorMessage(e)}`);
    throw err;
  }
}

/**
 * 下载文件（含失败有限重试）。进度通过 onProgress 上报 core 估算（未知总量软进度，
 * 不再卡 0%）——只进瞬时进度 store，不落 AsyncStorage；超过最大重试后抛错
 * （单首失败不影响其他任务）。
 */
async function downloadWithRetry(song: Song, realUrl: string, file: File, itemKey: string): Promise<void> {
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
          useDownloadProgressStore.getState().reportProgress(itemKey, progress);
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

/**
 * 把元数据内嵌进音频文件（ADR 2026-10-04：**只承诺 MP3**）。
 *
 * 容器决策走 core `tagStrategyForContainer`：m4a 经 mp3tag 写的是 ID32 box（非 iTunes
 * ilst/covr），media3/ExoPlayer 与 Apple 系读不到，属假达标，故本端不写；
 * FLAC/Ogg 灌 ID3 会毁文件，必须 skip。写回走「临时文件 + 覆盖 move」原子替换，
 * 失败时原文件保持完好；整体静默——元数据写失败不得影响下载结果。
 */
async function writeMetadata(file: File, song: Song, container: AudioContainer): Promise<void> {
  const log = useLogsStore.getState();
  if (tagStrategyForContainer(container) !== 'id3') return;
  let tmp: File | null = null;
  try {
    const bytes = await file.bytes();
    // mp3tag 只接受 ArrayBuffer/Buffer：Uint8Array 会直接抛 TypeError（实测）
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const cover = await fetchEmbeddableCover(song);
    const frames = buildID3Frames({
      title: song.name || '',
      artist: song.artist || '',
      album: song.album || '',
      durationMs: (song.duration || 0) * 1000,
      cover,
    });

    const tag = new MP3Tag(ab);
    tag.read();
    if (tag.error) {
      log.addLog('warn', `内嵌元数据：读取标签失败（跳过）《${song.name}》: ${tag.error}`);
      return;
    }
    tag.tags.title = song.name || '';
    tag.tags.artist = song.artist || '';
    tag.tags.album = song.album || '';
    if (!tag.tags.v2) {
      (tag.tags as unknown as Record<string, unknown>).v2 = {};
    }
    tag.tags.v2!.TIT2 = frames.v2.TIT2;
    tag.tags.v2!.TPE1 = frames.v2.TPE1;
    tag.tags.v2!.TALB = frames.v2.TALB;
    if (frames.v2.TLEN != null) tag.tags.v2!.TLEN = frames.v2.TLEN;
    if (frames.v2.APIC) {
      tag.tags.v2!.APIC = frames.v2.APIC.map((apic) => ({
        format: apic.format,
        type: apic.type,
        description: apic.description,
        data: apic.data,
      }));
    }

    tag.save({ id3v2: { padding: ID3V2_PADDING } });
    if (tag.error) {
      log.addLog('warn', `内嵌元数据：写入标签失败（跳过）《${song.name}》: ${tag.error}`);
      return;
    }

    const out = toUint8Array(tag.buffer);
    // 临时文件 + 覆盖 move：同目录 rename，写坏也只坏临时文件
    tmp = new File(downloadDir, `${file.name}.tmp`);
    await tmp.create({ overwrite: true, intermediates: true });
    await tmp.write(out);
    await tmp.move(file, { overwrite: true });
    tmp = null;
  } catch (e) {
    log.addLog('warn', `内嵌元数据失败（不影响下载）《${song.name}》: ${toErrorMessage(e)}`);
  } finally {
    if (tmp) {
      try {
        if (tmp.exists) await tmp.delete();
      } catch { /* 忽略清理失败 */ }
    }
  }
}

/** 写入 .lrc 歌词侧车（私有目录，与音频同名）。取词决策走 core 单点，不可用/失败时跳过。 */
async function writeLyricsSidecar(song: Song, fileName: string, _container: AudioContainer): Promise<void> {
  const content = await resolveLyricsText(song);
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
  const content = await resolveLyricsText(song);
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
