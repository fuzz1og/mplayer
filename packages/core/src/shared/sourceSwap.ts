import type { Song, SourceKey, AudioTag } from '../types/index.js';
import { calculateSimilarity, isExactMatch } from '../utils/songMatcher.js';
import { stripSourceIdPrefix } from './resolvePlayableUrl.js';

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

/** 换源服务的外部依赖：搜索/探测是平台边界（桌面走 IPC、移动端直调），
 *  core 只负责排序、筛选、可播性判定与 applySwap；log 为可选诊断钩子 */
export interface SourceSwapDeps {
  searchSongs: (keyword: string, page: number, source: SourceKey) => Promise<Song[]>;
  probeSongs: (songs: Song[]) => Promise<{ songId: string; tag: AudioTag }[]>;
  log?: (level: 'info' | 'warn', message: string) => void;
}

/**
 * 搜索目标源的候选版本（最多 3 个）：精确匹配（同名同歌手）排最前，
 * 其余按相似度降序（Live/remix/翻唱也会展示，用户自己决定是否接受）。
 * 识别失败的诊断日志：候选为空/请求异常通过 deps.log 上报。
 */
export async function searchSwapCandidates(
  song: Song,
  source: SourceKey,
  deps: SourceSwapDeps
): Promise<SwapCandidate[]> {
  if (song.sourceType === source || !song.name) return [];
  try {
    const candidates = await deps.searchSongs(`${song.name} ${song.artist}`, 1, source);
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
      deps.log?.('warn', `换源候选为空: 《${song.name}》${song.artist} → ${source}`);
    } else {
      deps.log?.(
        'info',
        `换源候选: 《${song.name}》${song.artist} → ${source} ${ranked.length}个 (${ranked
          .map((c) => `《${c.song.name}》${c.song.artist}${c.exact ? '[完整]' : ''} url=${c.song.url?.slice(0, 80)}`)
          .join(' | ')})`
      );
    }
    return ranked;
  } catch (e: any) {
    deps.log?.('warn', `换源搜索失败: 《${song.name}》 → ${source} ${e?.message || e}`);
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
    if (urlId && song.id) {
      const a = String(urlId).trim();
      const b = String(stripSourceIdPrefix(song.id)).trim();
      // 仅双方都是纯数字 id 时才可靠比较：kugou 等源是 hash 格式，
      // 格式不同不能判定为错位（否则合法候选被误标失效）
      if (/^\d+$/.test(a) && /^\d+$/.test(b) && a !== b) return false;
    }
  } catch {
    // URL 无法解析（非 302 端点/直链）不做此校验
  }
  return true;
}

/**
 * 批量探测候选可播性（探测实现由平台注入：桌面批量 IPC / 移动端并发直调）。
 * 坏的候选标失效（红色），用户选之前就知道；无 URL 或 URL-ID 错位的候选
 * 直接标失效，不浪费探测请求；探测结果按 song.id 匹配候选。
 */
export async function probeSwapCandidates(
  candidates: SwapCandidate[],
  deps: SourceSwapDeps
): Promise<SwapCandidate[]> {
  // URL-ID 错位（源数据错位）仍直接标失效——仅针对**已有 url** 的候选。
  // 无 url 候选不再预标失效：路由时代候选天生无 url（直连/tier3 搜索都不
  // 回填 url），探测器（probeSongsBatch）自带直连解析并写预取缓存，
  // 探测通过即播放时 0 等待命中；旧逻辑把无 url 一律标失效等于全灭。
  const mismatched = new Set(
    candidates.filter((c) => c.song.url && !urlIdMatchesSong(c.song.url, c.song)).map((c) => c.song.id)
  );
  for (const c of candidates) {
    if (mismatched.has(c.song.id)) {
      deps.log?.('warn', `换源候选可疑: 《${c.song.name}》链接 ID 与歌曲不符（源数据错位）`);
    }
  }

  const toProbe = candidates.filter((c) => !mismatched.has(c.song.id));
  let tags = new Map<string, AudioTag>();
  if (toProbe.length > 0) {
    try {
      const results = await deps.probeSongs(toProbe.map((c) => c.song));
      tags = new Map(results.map((r) => [r.songId, r.tag]));
    } catch (e: any) {
      deps.log?.('warn', `换源候选探测失败: ${e?.message || e}`);
    }
  }

  return candidates.map((c) => {
    if (mismatched.has(c.song.id)) {
      return { ...c, playable: false, tag: 'invalid' as AudioTag };
    }
    const tag = tags.get(c.song.id) ?? null;
    if (!tag) return c;
    deps.log?.(
      tag !== 'invalid' ? 'info' : 'warn',
      `换源候选探测: 《${c.song.name}》${c.song.artist} → ${tag === 'preview' ? '短时长' : tag === 'invalid' ? '失效' : '可播'}`
    );
    return { ...c, playable: tag !== 'invalid', tag };
  });
}

/**
 * 应用用户选中的候选版本：构造换源后的歌曲。
 * **完全采用用户选中版本的信息**——歌名/歌手/封面/专辑/ID 全部换成
 * 匹配到的歌曲（用户选翻唱就用翻唱的名字和封面），只把 sourceType
 * 换成目标源、id 加单层源前缀（源站真实 ID，防嵌套）。
 */
export function applySwap(_song: Song, source: SourceKey, candidate: SwapCandidate): Song | null {
  const matched = candidate.song;
  // 候选必须有真实 ID：否则 url 与 id 错配，持久化后按 ID 识别/
  // URL-ID 一致性校验都会指向错误的歌（换源的核心保证是"真实 ID"）。
  // url 允许为空：路由时代候选天生无 url，播放时经
  // resolvePlayableSongRouted 现解析（探测已把直链写进预取缓存，命中秒播）。
  if (!matched?.id) return null;
  return {
    ...matched,
    sourceType: source,
    id: `${source}:${stripSourceIdPrefix(matched.id)}`,
    // 换源后的行立即反映候选探测结果（短时长/失效徽标）
    audioTag: candidate.tag ?? matched.audioTag,
  } as Song;
}
