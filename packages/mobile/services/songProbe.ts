import { probeSongs, musicApi } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { useAudioTagStore } from '../stores/audioTagStore';
import { useLogsStore } from '../stores/logsStore';

/**
 * 对一组歌曲跑音频质量探测（30 秒片段/无效标记），结果写入 audioTagStore，
 * SongRow 按 id 订阅自动显示徽标。各页面（专辑/歌单/歌手/发现榜单）共用。
 * 非阻塞：探测完成逐首更新，仅重渲染标签变化的行。
 * @param missingAsInvalid 无 url 的歌直接标「无效」不探测（专辑页用：
 *   无版权歌 url 为空且搜索兜底已严格校验，标无效引导用户单曲换源）
 */
export async function probeSongsWithTags(
  songs: Song[],
  options: { missingAsInvalid?: boolean } = {},
): Promise<void> {
  if (songs.length === 0) return;
  const { missingAsInvalid = false } = options;
  const t0 = Date.now();
  const { setTag } = useAudioTagStore.getState();
  const byId = new Map(songs.map((s) => [s.id, s]));
  let preview = 0;
  let invalid = 0;
  let valid = 0;
  const toProbe: Song[] = [];
  for (const s of songs) {
    if (missingAsInvalid && !s.url?.startsWith('http')) {
      setTag(s, 'invalid');
      invalid++;
      continue;
    }
    toProbe.push(s);
  }
  await probeSongs(toProbe, {
    concurrency: 20,
    // 302 摄取端点（api.php?get=url）先解析成 CDN 直链再探测：
    // 探测顺带预热 getAudioUrl 缓存——搜索结果返回后几秒内全部歌曲的
    // 直链都已就绪，用户点击任意一首播放时缓存命中，点击到出声秒开。
    resolver: async (song) => {
      if (!song.url) return '';
      if (song.url.startsWith('http') || song.url.startsWith('file://')) return song.url;
      try {
        const direct = await musicApi.getAudioUrl(song.url);
        return direct?.startsWith('http') ? direct : song.url;
      } catch {
        return song.url;
      }
    },
    onResult: (id, tag) => {
      const song = byId.get(id);
      if (!song) return;
      setTag(song, tag);
      if (tag === 'preview') preview++;
      else if (tag === 'invalid') invalid++;
      else valid++;
    },
  });
  useLogsStore.getState().addLog('info', `探测完成: 共${songs.length}首, 完整${valid} 短时长${preview} 无效${invalid}, 耗时 ${Date.now() - t0}ms`);
}
