import { searchSwapCandidates as coreSearchSwapCandidates, applySwap as coreApplySwap } from '@mplayer/core';
import type { Song, SourceKey, SwapCandidate, SourceSwapDeps } from '@mplayer/core';
import { callMusicApi } from './callMusicApi';

export type { SwapCandidate };
export type { SourceSwapDeps };

/** 桌面端换源依赖：搜索走现有歌曲搜索 IPC。
 *  #391：探测（probeSongs）已删除——判据反向且产物无消费者，只剩零请求的错位检查。 */
export const sourceSwapDeps: SourceSwapDeps = {
  searchSongs: (keyword, page, source) => callMusicApi('searchSongsRouted', keyword, page, source),
  log: (level, message) => {
    if (level === 'warn') console.warn(message);
    else console.info(message);
  },
};

export function searchSwapCandidates(
  song: Song,
  source: SourceKey,
  deps: SourceSwapDeps = sourceSwapDeps
): Promise<SwapCandidate[]> {
  return coreSearchSwapCandidates(song, source, deps);
}

export function applySwap(song: Song, source: SourceKey, candidate: SwapCandidate): Song | null {
  return coreApplySwap(song, source, candidate);
}
