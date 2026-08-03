import { probeSongs } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { useAudioTagStore } from '../stores/audioTagStore';
import { useLogsStore } from '../stores/logsStore';

/**
 * 对一组歌曲跑音频质量探测（30 秒片段/无效标记），结果写入 audioTagStore，
 * SongRow 按 id 订阅自动显示徽标。各页面（专辑/歌单/歌手/发现榜单）共用。
 * 非阻塞：探测完成逐首更新，仅重渲染标签变化的行。
 */
export async function probeSongsWithTags(songs: Song[]): Promise<void> {
  if (songs.length === 0) return;
  const t0 = Date.now();
  const { setTag } = useAudioTagStore.getState();
  const byId = new Map(songs.map((s) => [s.id, s]));
  let preview = 0;
  let invalid = 0;
  let valid = 0;
  await probeSongs(songs, {
    concurrency: 20,
    onResult: (id, tag) => {
      const song = byId.get(id);
      if (!song) return;
      setTag(song, tag);
      if (tag === 'preview') preview++;
      else if (tag === 'invalid') invalid++;
      else valid++;
    },
  });
  useLogsStore.getState().addLog('info', `探测完成: 共${songs.length}首, 完整${valid} 片段${preview} 无效${invalid}, 耗时 ${Date.now() - t0}ms`);
}
