import { musicApi, calculateSimilarity, isExactMatch } from '@mplayer/core';
import type { Song, SourceKey } from '@mplayer/core';
import { useLogsStore } from '../stores/logsStore';

// 已知源前缀：换源后的歌再换源时剥离，防止 id 无限嵌套（kugou:123 → kuwo:kugou:123）
const SOURCE_ID_PREFIX = /^(netease|qq|kugou|kuwo|qianqian|soda|local):/;

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
 * name/artist 沿用原歌（列表显示一致）；id 用目标源的**真实曲目 ID**
 * （matched.id，源站 ID 不过期——播放失败/歌词封面补全时可按 ID 重新识别），
 * 剥离已有源前缀防嵌套；matched 无 id 时回退原 id。
 */
export function applySwap(song: Song, source: SourceKey, candidate: SwapCandidate): Song | null {
  const matched = candidate.song;
  if (!matched?.url) return null;
  const baseId = song.id.replace(SOURCE_ID_PREFIX, '');
  return {
    ...matched,
    sourceType: source,
    id: `${source}:${matched.id || baseId}`,
    name: song.name,
    artist: song.artist,
  } as Song;
}
