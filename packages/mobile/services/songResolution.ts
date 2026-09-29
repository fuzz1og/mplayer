import { musicApi } from '@mplayer/core';
import type { Song } from '@mplayer/core';

/**
 * 播放地址解析（**播放 URL 解析的唯一出口**）。
 *
 * 从 `audioPlayer.ts` 抽出来是为了打断循环依赖：`nativePlayer.ts`（原生引擎）
 * 与 `audioPlayer.ts`（expo-audio 回落引擎）都要用它，但它不能再反向依赖任一引擎。
 *
 * 解析链本身 0 改动（规格 §1.3）：`resolvePlayableSongRouted` = 预取命中 → 直连 → tier3。
 * 抛错交给调用方按「解析链穷尽」处理（no playable URL → 换源提示/跳歌）。
 * 返回 {url, lrc, nonFull}（nonFull=试听版/片段，驱动「可换源」提示与 preview 徽标）。
 */
export async function resolvePlayableUrlMobile(
  song: Song
): Promise<{ url: string; lrc: string; nonFull: boolean }> {
  const routed = await musicApi.resolvePlayableSongRouted(song);
  return {
    url: routed?.url?.startsWith('http') ? routed.url : '',
    lrc: song.lrc || '',
    nonFull: !!routed?.nonFull,
  };
}
