import type { Song } from '../types/index.js';
import { findExactMatch } from '../utils/songMatcher.js';

/**
 * 「补一个可播版本」（#639 C3）：**缺播放地址时按歌名+歌手补一个**的单一实现。列表页的歌常无 `Song.url`（直连守卫只做零请求
 * 判定、不预取直链）；此前四处页面各写一遍，三处直接取 `results[0]` 整首顶替，排序差的源（酷我）会播同名不同歌手的歌。
 * 判据 = GLOSSARY「跨源录音身份」：**只靠歌名 + 歌手文本精确匹配**（core `findExactMatch`），时长只作护栏、不能作证明。
 */

/** 宿主提供的搜索端口。**必须**走路由搜索（直连 + tier3 兜底）而不是某条腿。 */
export interface PlayableVersionDeps {
  /**
   * 搜索候选：入参是「歌名 歌手」的查询与**歌曲自身来源**，返回原始候选列表。
   * core 不关心它内部怎么搜——两端各自接 `searchSongsRouted`。
   */
  search: (song: Song) => Promise<Song[]>;
  /** 可选诊断（未命中时给候选摘要，便于定位「为什么没匹配上」）。 */
  log?: (level: 'warn', message: string) => void;
}

export interface PlayableVersionResult {
  /**
   * 可播版本：原本就有地址 → 原歌（不搜索）；命中精确匹配 → **只回填 `url`** 的新对象（歌名/歌手/封面保持点击的那首）；
   * 未命中 / 搜索失败 → 原歌（**不**用候选顶替，交给播放链的归因与护栏）。
   */
  song: Song;
  /** 是否真的发起过搜索（已有地址、或歌无名时为 `false`）。 */
  searched: boolean;
  /** 是否命中精确匹配（`searched` 为 false 时无意义）。 */
  matched: boolean;
}

/**
 * 搜索并取**精确匹配**的候选（#639 C3 的内核）。返回命中的候选**本体**（不是回填后的歌）——桌面只回填 url，
 * 移动端资源兜底同时回填 url 与 lrc，故回填什么由宿主决定。**未命中 / 搜索失败一律 null**——绝不退回 `results[0]`。
 */
export async function searchPlayableMatch(
  song: Song,
  deps: PlayableVersionDeps,
): Promise<Song | null> {
  if (!song.name) return null;

  let candidates: Song[];
  try {
    candidates = await deps.search(song);
  } catch (error) {
    // 搜索失败 = 没有可播版本可用；不抛给调用方（播放链自己有失败归因）
    deps.log?.('warn', `可播版本搜索失败: 《${song.name}》${song.artist} ${error instanceof Error ? error.message : error}`);
    return null;
  }

  const hit = findExactMatch({ name: song.name, artist: song.artist }, candidates) as Song | undefined;
  if (!hit) {
    const summary = candidates.slice(0, 5).map((c) => `《${c.name}》${c.artist}`).join(' | ');
    deps.log?.('warn', `可播版本未匹配: 《${song.name}》${song.artist} ${song.sourceType}（候选${candidates.length}首: ${summary || '空'}）`);
    return null;
  }
  return hit;
}

/**
 * 补一个可播版本（契约，双端同此）：**已有可播地址 → 原样返回、不发任何请求**；缺地址 → 按 `song.name + song.artist`
 * 路由搜索取**精确匹配**；命中 → 只填地址，**歌名/歌手/封面一律保持原样**（不能用候选整首顶替）；未命中 → 原样返回，
 * **绝不**退回 `results[0]`。搜索源用歌曲自身的 `sourceType`（歌手页曾写死 `'netease'`，换源后的歌会被拿去网易搜）。
 */
export async function resolvePlayableVersion(
  song: Song,
  deps: PlayableVersionDeps,
): Promise<PlayableVersionResult> {
  // 已有地址：不搜索（这是 #639 C3 的完成标准之一——省掉一次必然多余的请求）
  if (song.url && song.url.trim() !== '') {
    return { song, searched: false, matched: false };
  }
  if (!song.name) return { song, searched: false, matched: false };

  const hit = await searchPlayableMatch(song, deps);
  if (!hit?.url) {
    // 命中但候选无 url 也算未命中（不返回半成品：url 才是本动作的产物）
    return { song, searched: true, matched: false };
  }

  // 只回填地址：歌名/歌手/封面保持用户点的那份（**不**整首顶替）
  return { song: { ...song, url: hit.url }, searched: true, matched: true };
}
