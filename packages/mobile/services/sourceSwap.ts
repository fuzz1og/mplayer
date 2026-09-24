import { searchSwapCandidates as coreSearchSwapCandidates, applySwap as coreApplySwap, musicApi } from '@mplayer/core';
import type { Song, SourceKey, SwapCandidate, SourceSwapDeps } from '@mplayer/core';
import { useLogsStore } from '../stores/logsStore';

export type { SwapCandidate };
export type { SourceSwapDeps };

/** 移动端换源依赖：搜索走路由入口（直连 + tier3 兜底；旧 searchSongs 已随自建 API 退役恒空） */
const sourceSwapDeps: SourceSwapDeps = {
  searchSongs: (keyword, page, source) => musicApi.searchSongsRouted(keyword, page, source),
  log: (level, message) => {
    const addLog = useLogsStore.getState().addLog;
    addLog(level, message);
  },
};

export function searchSwapCandidates(song: Song, source: SourceKey): Promise<SwapCandidate[]> {
  return coreSearchSwapCandidates(song, source, sourceSwapDeps);
}

export function applySwap(song: Song, source: SourceKey, candidate: SwapCandidate): Song | null {
  return coreApplySwap(song, source, candidate);
}
