import { musicApi } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { useLogsStore } from '../stores/logsStore';

/**
 * 对一组歌曲跑直连探测（musicApi.probeSongsBatch，仅直连、无 tier3/api 腿）：
 * 解析出的直链写入 core 预取缓存（TTL 30min），播放时
 * resolvePlayableSongRouted 命中缓存 0 等待秒播。
 * 探测职责 = 预取，**不写列表徽标**（对齐桌面 68844b5：探测预测与实际
 * 播放常不符；徽标改为播放后按实际结果回写，见 audioPlayer.playSong）。
 * 非阻塞、失败打开：探测失败不影响列表渲染。
 */
export async function probeSongsPrefetch(songs: Song[]): Promise<void> {
  if (songs.length === 0) return;
  const t0 = Date.now();
  try {
    await musicApi.probeSongsBatch(songs);
    useLogsStore.getState().addLog('info', `探测预取完成: ${songs.length}首, 耗时 ${Date.now() - t0}ms`);
  } catch {
    // 失败打开：探测永不阻断列表
  }
}
