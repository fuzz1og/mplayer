import { musicApi, calculateSimilarity, isExactMatch, stripSourceIdPrefix, probeAudioUrl } from '@mplayer/core';
import type { Song, SourceKey, AudioTag } from '@mplayer/core';
import { useLogsStore } from '../stores/logsStore';

/** 换源候选：exact=精确匹配（同名同歌手原版）；score=相似度（0~1）；
 *  playable=可播性（null=未探测/检测中，true=可播，false=失效）；
 *  tag=探测结果（'valid' 完整 / 'preview' 短时长片段 / 'invalid' 失效） */
export interface SwapCandidate {
  song: Song;
  exact: boolean;
  score: number;
  playable: boolean | null;
  tag: AudioTag | null;
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
        playable: null as boolean | null,
        tag: null as AudioTag | null,
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
          .map((c) => `《${c.song.name}》${c.song.artist}${c.exact ? '[完整]' : ''} url=${c.song.url?.slice(0, 80)}`)
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
 * 302 端点 id 参数与歌曲 ID 一致性校验：
 * 源数据可能错位（url 指向另一首歌，如 DJ 版链接实际是纯音乐）——
 * api.php?get=url&id=XXX 的 id 与候选 song.id 不符时标记为可疑（失效）。
 */
function urlIdMatchesSong(url: string, song: Song): boolean {
  try {
    const u = new URL(url);
    const urlId = u.searchParams.get('id');
    // 都转字符串比较：API 部分源 id 是数字，严格比较会误判
    if (urlId && song.id && String(urlId) !== String(stripSourceIdPrefix(song.id))) return false;
  } catch {
    // URL 无法解析（非 302 端点/直链）不做此校验
  }
  return true;
}

/**
 * 并行探测候选可播性（HEAD 跟随 302 → CDN 直链，不下载 body）：
 * 坏的候选标失效（红色），用户选之前就知道；探测结果渐进更新 UI。
 * 探测有会话级缓存（同 URL 不重复请求）。
 * 附带 URL-ID 一致性校验：302 端点的 id 与歌曲 id 不符 → 标失效
 * （源数据错位：链接内容可能是另一首歌）。
 */
export async function probeSwapCandidates(candidates: SwapCandidate[]): Promise<SwapCandidate[]> {
  return Promise.all(
    candidates.map(async (c) => {
      if (!c.song.url?.startsWith('http')) return { ...c, playable: false, tag: 'invalid' };
      if (!urlIdMatchesSong(c.song.url, c.song)) {
        useLogsStore.getState().addLog(
          'warn',
          `换源候选可疑: 《${c.song.name}》链接 ID 与歌曲不符（源数据错位）`
        );
        return { ...c, playable: false, tag: 'invalid' };
      }
      const tag = await probeAudioUrl(c.song.url);
      const playable = tag !== 'invalid';
      useLogsStore.getState().addLog(
        playable ? 'info' : 'warn',
        `换源候选探测: 《${c.song.name}》${c.song.artist} → ${tag === 'preview' ? '短时长片段' : playable ? '可播' : '失效'}`
      );
      return { ...c, playable, tag };
    })
  );
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
