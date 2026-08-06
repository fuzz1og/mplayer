import { File, Directory, Paths } from 'expo-file-system';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { Song } from '@mplayer/core';
import { musicApi, md5 } from '@mplayer/core';
import { useDownloadStore } from '../stores/downloadStore';
import { useLogsStore } from '../stores/logsStore';
import { useSettingsStore } from '../stores/settingsStore';

// 下载目录：应用文档目录（系统不会自动清理）。公共下载目录通过 SAF 授权后同步一份。
const downloadDir = new Directory(Paths.document, 'mplayer-downloads');

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
 * 注：expo-file-system 原生 copyAsync 不支持 file → SAF 写入，base64 读写是官方路径；
 * MP3 体积下（数 MB~十几 MB）一次读入 JS 内存可接受。
 */
export async function writePublicCopy(privateUri: string, fileName: string, dirUri: string): Promise<string> {
  const publicUri = await StorageAccessFramework.createFileAsync(dirUri, fileName, 'audio/mpeg');
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

/** 未设置目录时自动弹一次授权（方便起见）；取消则本次仅存私有目录，下次下载再询问 */
async function promptPublicDirOnce(): Promise<string> {
  if (Platform.OS !== 'android') return '';
  const ok = await pickDownloadDirectory().catch(() => false);
  return ok ? useSettingsStore.getState().downloadDirUri : '';
}

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
  // addItem 会替换旧记录，旧公共文件 uri 需在替换前捕获（重新下载时清理旧文件用）
  const prevPublicUri = useDownloadStore.getState().items.find((i) => i.key === itemKey)?.publicUri;
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

    // 已授权公共目录时同步一份到系统下载目录；失败不阻断（私有副本仍可播放）
    const dirUri = useSettingsStore.getState().downloadDirUri || (await promptPublicDirOnce());
    let publicUri: string | undefined;
    if (dirUri) {
      if (await isDirGrantValid(dirUri)) {
        try {
          // 重新下载时先清掉旧公共文件，避免同名堆积（系统会自动改名 song (1).mp3）
          if (prevPublicUri) {
            await StorageAccessFramework.deleteAsync(prevPublicUri, { idempotent: true }).catch(() => {});
          }
          publicUri = await writePublicCopy(file.uri, fileName, dirUri);
          log.addLog('info', `已同步到公共下载目录《${song.name}》`);
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
    log.addLog('info', `下载完成《${song.name}》- ${song.artist}`);
    return file;
  } catch (e: any) {
    // 只清理本次新建的文件：已有文件（上次下载成功）失败时保留，避免丢离线副本
    if (!existedBefore) await removeFileIfExists(file);
    updateStatus(itemKey, { status: 'error', error: toErrorMessage(e) });
    log.addLog('error', `下载失败《${song.name}》: ${toErrorMessage(e)}`);
    throw e;
  }
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
