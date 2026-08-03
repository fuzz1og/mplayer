import { musicApi, findExactMatch } from '@mplayer/core';
import type { Song, SourceKey } from '@mplayer/core';
import { useLogsStore } from '../stores/logsStore';

// 已知源前缀：换源后的歌再换源时剥离，防止 id 无限嵌套（kugou:123 → kuwo:kugou:123）
const SOURCE_ID_PREFIX = /^(netease|qq|kugou|kuwo|qianqian|soda|local):/;

/**
 * 单曲换源：用其他音乐源搜索这首歌的完整版。
 * 网易云 VIP 歌经 API/weapi 只能拿 30 秒片段；QQ/酷狗等其他源通常有完整版。
 * findExactMatch 精确匹配（name+artist 归一化后完全相等）：Live/remix/翻唱版
 * 歌名带后缀一律拒绝，宁可匹配失败也不播错歌；匹配失败返回 null（保留原歌）。
 */
export async function swapSongToSource(song: Song, source: SourceKey): Promise<Song | null> {
  const log = useLogsStore.getState();
  if (song.sourceType === source || !song.name) return null;
  try {
    const candidates = await musicApi.searchSongs(`${song.name} ${song.artist}`, 1, source);
    const matched = findExactMatch({ name: song.name, artist: song.artist }, candidates) as Song | undefined;
    if (!matched?.url) {
      // 识别失败诊断：候选摘要（API 返回了什么 → 是空、错歌还是 Live 版）
      const summary = candidates.slice(0, 5).map((c) => `《${c.name}》${c.artist}`).join(' | ');
      log.addLog('warn', `换源未找到精确匹配: 《${song.name}》${song.artist} → ${source} (候选${candidates.length}首: ${summary || '空'})`);
      return null;
    }
    log.addLog('info', `换源命中: 《${matched.name}》${matched.artist} (${source}) url=${matched.url.slice(0, 60)}`);
    return {
      ...matched,
      sourceType: source,
      // 剥离已有源前缀：换源后的歌再换源，id 保持单层前缀（kuwo:1303464858）
      id: `${source}:${song.id.replace(SOURCE_ID_PREFIX, '')}`,
      name: song.name,
      artist: song.artist,
    } as Song;
  } catch (e: any) {
    log.addLog('warn', `换源失败: 《${song.name}》 → ${source} ${e?.message || e}`);
    return null;
  }
}
