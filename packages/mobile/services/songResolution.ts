import { musicApi } from '@mplayer/core';
import type { Song } from '@mplayer/core';

/**
 * 播放地址解析（**播放 URL 解析的唯一出口**）。
 * 从 `audioPlayer.ts` 抽出来是为了打断循环依赖：`nativePlayer.ts`（原生引擎）与 `audioPlayer.ts`（
 * expo-audio 回落引擎）都要用它，但它不能再反向依赖任一引擎。
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
