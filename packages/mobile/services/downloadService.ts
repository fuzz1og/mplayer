import { File, Directory, Paths } from 'expo-file-system';
import type { Song } from '@mplayer/core';
import { musicApi, md5 } from '@mplayer/core';
import { useDownloadStore } from '../stores/downloadStore';
import { useLogsStore } from '../stores/logsStore';

// 下载目录：应用文档目录（系统不会自动清理；后续子步可加 SAF 导出到公共目录）
const downloadDir = new Directory(Paths.document, 'mplayer-downloads');

/** 摄取端点 302 跳转地址特征（与 audioPlayer 一致）：这类地址要先解析成 CDN 直链才能下载 */
function isRedirectEndpoint(url: string): boolean {
  return url.includes('api.php?get=url');
}

function sanitizeFileName(name: string): string {
  return (name || 'unknown')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** 播放失败时清理失败的下载文件 */
async function removeFileIfExists(file: File): Promise<void> {
  try {
    if (file.exists) await file.delete();
  } catch { /* 忽略清理失败 */ }
}

/**
 * 下载文件全名：来源前缀 + 歌曲 ID 哈希，避免跨源同名/同歌手同名歌曲互相覆盖
 * （纯名字文件名会被后下载的覆盖，下载列表记录也会被顶掉）
 */
function buildFileName(song: Song): string {
  const src = song.sourceType && song.sourceType !== 'local' ? song.sourceType : 'netease';
  const name = sanitizeFileName(song.name);
  const artist = sanitizeFileName(song.artist);
  const digest = song.id ? md5(song.id).slice(0, 6) : '';
  const full = `[${src}] ${name} - ${artist}${digest ? ` [${digest}]` : ''}.mp3`;
  // 超长组合（长歌手名）整体截断，防文件名超限
  return full.length > 120 ? full.slice(0, 117) + '.mp3' : full;
}

// 进行中的下载去重：重复点击同一首歌复用同一 promise，避免并发写同一文件
const inFlight = new Map<string, Promise<File>>();

/** 下载歌曲到本地：解析直链 → 下载 → 更新下载列表。重复点击同一首自动复用进行中的下载。 */
export async function downloadSong(song: Song): Promise<File> {
  const fileName = buildFileName(song);
  const existing = inFlight.get(fileName);
  if (existing) return existing;
  const promise = doDownload(song, fileName);
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
  addItem({
    key: itemKey,
    songId: song.id,
    name: song.name,
    artist: song.artist,
    fileName,
    status: 'downloading',
    addedAt: Date.now(),
  });

  try {
    // 仅 302 跳转端点需要先解析成 CDN 直链；已是直链的直接下载
    // （对直链再调 getAudioUrl 会整包下载一遍，双倍流量）
    const realUrl = song.url?.startsWith('http') && isRedirectEndpoint(song.url)
      ? await musicApi.getAudioUrl(song.url)
      : (song.url || '');
    if (!realUrl?.startsWith('http')) throw new Error('无法解析下载地址');

    await downloadDir.create({ intermediates: true, idempotent: true });
    await File.downloadFileAsync(realUrl, file, { idempotent: true });

    updateStatus(itemKey, { status: 'done' });
    log.addLog('info', `下载完成《${song.name}》- ${song.artist}`);
    return file;
  } catch (e: any) {
    // 只清理本次新建的文件：已有文件（上次下载成功）失败时保留，避免丢离线副本
    if (!existedBefore) await removeFileIfExists(file);
    updateStatus(itemKey, { status: 'error', error: e?.message || String(e) });
    log.addLog('error', `下载失败《${song.name}》: ${e?.message || String(e)}`);
    throw e;
  }
}

/** 已下载歌曲的本地 file:// 播放 URI（未下载/文件丢失返回 null） */
export function getLocalUri(fileName: string): string {
  return new File(downloadDir, fileName).uri;
}

/** 删除下载项对应的本地文件（文件不存在时静默）；状态记录删除由调用方处理 */
export async function removeDownloadedFile(fileName: string): Promise<void> {
  await removeFileIfExists(new File(downloadDir, fileName));
}
