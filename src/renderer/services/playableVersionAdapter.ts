import { resolvePlayableVersion } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { callMusicApi } from '@/renderer/services/callMusicApi';

/**
 * 桌面侧「补一个可播版本」适配器（#639 C3）：判据与编排在 core（`shared/playableVersion.resolvePlayableVersion`），
 * 本文件只提供**搜索端口**（musicApi 单通道的路由搜索：直连 + tier3 兜底）。此前四处页面各自内联、三处直接取
 * `results[0]` 整首顶替（换掉歌名/歌手/封面），会把同名不同歌手的歌当成目标播放；现为桌面唯一实现。
 */
export async function resolvePlayableVersionForDesktop(song: Song): Promise<Song> {
  const { song: playable } = await resolvePlayableVersion(song, {
    search: (target) =>
      callMusicApi('searchSongsRouted', `${target.name} ${target.artist}`, 1, target.sourceType),
    log: (level, message) => console.warn(`[playableVersion] ${level}: ${message}`),
  });
  return playable;
}
