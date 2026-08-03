import { File, Directory, Paths } from 'expo-file-system';
import type { Song } from '@mplayer/core';
import { musicApi } from '@mplayer/core';
import { useDownloadStore } from '../stores/downloadStore';
import { useLogsStore } from '../stores/logsStore';

// 下载目录：应用文档目录（系统不会自动清理；后续子步可加 SAF 导出到公共目录）
const downloadDir = new Directory(Paths.document, 'mplayer-downloads');

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
 * 下载歌曲到本地：解析直链 → 下载 → 更新下载列表。
 * 并发下载由调用方控制（当前单曲入口，天然串行）。
 */
export async function downloadSong(song: Song): Promise<File> {
  const log = useLogsStore.getState();
  const { addItem, updateStatus } = useDownloadStore.getState();

  const fileName = `${sanitizeFileName(song.name)} - ${sanitizeFileName(song.artist)}.mp3`;
  const file = new File(downloadDir, fileName);
  addItem({
    songId: song.id,
    name: song.name,
    artist: song.artist,
    fileName,
    status: 'downloading',
    addedAt: Date.now(),
  });

  try {
    // 解析真实音频直链（thirdparty.cn 的 302 端点不能直接下载）
    const realUrl = song.url?.startsWith('http')
      ? await musicApi.getAudioUrl(song.url)
      : '';
    if (!realUrl?.startsWith('http')) throw new Error('无法解析下载地址');

    await downloadDir.create({ intermediates: true, idempotent: true });
    await File.downloadFileAsync(realUrl, file, { idempotent: true });

    updateStatus(song.id, { status: 'done' });
    log.addLog('info', `下载完成《${song.name}》- ${song.artist}`);
    return file;
  } catch (e: any) {
    await removeFileIfExists(file);
    updateStatus(song.id, { status: 'error', error: e?.message || String(e) });
    log.addLog('error', `下载失败《${song.name}》: ${e?.message || String(e)}`);
    throw e;
  }
}

/** 已下载歌曲的本地 file:// 播放 URI（未下载/文件丢失返回 null） */
export function getLocalUri(fileName: string): string {
  return new File(downloadDir, fileName).uri;
}
