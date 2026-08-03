import { musicApi, calculateSimilarity, isExactMatch, stripSourceIdPrefix } from '@mplayer/core';
import type { Song, SourceKey } from '@mplayer/core';
import { useLogsStore } from '../stores/logsStore';

/** 换源候选：exact=精确匹配（同名同歌手原版）；score=相似度（0~1） */
export interface SwapCandidate {
  song: Song;
  exact: boolean;
  score: number;
}

/**
 * 搜索目标源的候选版本（最多 3 个）：精确匹配（同名同歌手）排最前，
 * 其余按相似度降序（Live/remix/翻唱也会展示，用户自己决定是否接受）。
 * 识别失败的诊断日志：候选为空/请求异常可见。
 */
export async function searchSwapCandidates(song: Song, source: SourceKey): Promise<SwapCandidate[]> {
  const log = useLogsStore.getState();
  if (song.sourceType === source || !song.name) return [];
  try {
    const candidates = await musicApi.searchSongs(`${song.name} ${song.artist}`, 1, source);
    const target = { name: song.name, artist: song.artist };
    const ranked = candidates
      .map((c) => ({
        song: c,
        exact: isExactMatch(target, c),
        score: calculateSimilarity(target, c),
      }))
      .filter((c) => c.exact || c.score > 0)
      .sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || b.score - a.score)
      .slice(0, 3);
    if (ranked.length === 0) {
      log.addLog('warn', `换源候选为空: 《${song.name}》${song.artist} → ${source}`);
    } else {
      log.addLog(
        'info',
        `换源候选: 《${song.name}》${song.artist} → ${source} ${ranked.length}个 (${ranked
          .map((c) => `《${c.song.name}》${c.song.artist}${c.exact ? '[完整]' : ''}`)
          .join(' | ')})`
      );
    }
    return ranked;
  } catch (e: any) {
    log.addLog('warn', `换源搜索失败: 《${song.name}》 → ${source} ${e?.message || e}`);
    return [];
  }
}

/**
 * 应用用户选中的候选版本：构造换源后的歌曲。
 * **完全采用用户选中版本的信息**——歌名/歌手/封面/专辑/ID 全部换成
 * 匹配到的歌曲（用户选翻唱就用翻唱的名字和封面），只把 sourceType
 * 换成目标源、id 加单层源前缀（源站真实 ID，防嵌套）。
 */
export function applySwap(song: Song, source: SourceKey, candidate: SwapCandidate): Song | null {
  const matched = candidate.song;
  if (!matched?.url) return null;
  const baseId = stripSourceIdPrefix(song.id);
  return {
    ...matched,
    sourceType: source,
    id: `${source}:${matched.id || baseId}`,
  } as Song;
}
