import { searchSwapCandidates as coreSearchSwapCandidates, probeSwapCandidates as coreProbeSwapCandidates, applySwap as coreApplySwap } from '@mplayer/core';
import type { Song, SourceKey, SwapCandidate, SourceSwapDeps } from '@mplayer/core';
import { callMusicApi } from './callMusicApi';

export type { SwapCandidate };
export type { SourceSwapDeps };

/** 桌面端换源依赖：搜索走现有歌曲搜索 IPC，探测走 core 批量探测 IPC */
export const sourceSwapDeps: SourceSwapDeps = {
  searchSongs: (keyword, page, source) => callMusicApi('searchSongs', keyword, page, source),
  probeSongs: (songs) => callMusicApi('probeSongsBatch', songs),
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

export function probeSwapCandidates(
  candidates: SwapCandidate[],
  deps: SourceSwapDeps = sourceSwapDeps
): Promise<SwapCandidate[]> {
  return coreProbeSwapCandidates(candidates, deps);
}

export function applySwap(song: Song, source: SourceKey, candidate: SwapCandidate): Song | null {
  return coreApplySwap(song, source, candidate);
}
