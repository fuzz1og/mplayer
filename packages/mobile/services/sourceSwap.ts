import { searchSwapCandidates as coreSearchSwapCandidates, probeSwapCandidates as coreProbeSwapCandidates, applySwap as coreApplySwap, musicApi, probeAudioUrl } from '@mplayer/core';
import type { Song, SourceKey, SwapCandidate, SourceSwapDeps } from '@mplayer/core';
import { useLogsStore } from '../stores/logsStore';

export type { SwapCandidate };
export type { SourceSwapDeps };

/** 移动端换源依赖：搜索/探测直调 core API（并发探测，带会话级缓存） */
const sourceSwapDeps: SourceSwapDeps = {
  searchSongs: (keyword, page, source) => musicApi.searchSongs(keyword, page, source),
  probeSongs: async (songs) =>
    Promise.all(songs.map(async (song) => ({ songId: song.id, tag: await probeAudioUrl(song.url) }))),
  log: (level, message) => {
    const addLog = useLogsStore.getState().addLog;
    addLog(level, message);
  },
};

export function searchSwapCandidates(song: Song, source: SourceKey): Promise<SwapCandidate[]> {
  return coreSearchSwapCandidates(song, source, sourceSwapDeps);
}

export function probeSwapCandidates(candidates: SwapCandidate[]): Promise<SwapCandidate[]> {
  return coreProbeSwapCandidates(candidates, sourceSwapDeps);
}

export function applySwap(song: Song, source: SourceKey, candidate: SwapCandidate): Song | null {
  return coreApplySwap(song, source, candidate);
}
