import { probeSongs, musicApi } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { setCachedUrl } from './cacheService';
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
    // 并发控制在低位：高并发解析会把 jbsou 服务端打到限流（Network Error），
    // 用户点击播放的解析请求也会被一起拖死（实测 70s 才就绪）
    concurrency: 6,
    // 302 摄取端点（api.php?get=url）先解析成 CDN 直链再探测：
    // 探测顺带预热音频直链缓存——用户点击播放时缓存命中秒开。
    // 用轻量解析：单次请求、2s 超时、失败不重试（重试留给点击播放的正式解析）。
    resolver: async (song) => {
      if (!song.url) return '';
      if (song.url.startsWith('http') || song.url.startsWith('file://')) return song.url;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        try {
          const direct = await musicApi.getAudioUrl(song.url, controller.signal);
          if (direct?.startsWith('http')) {
            // 顺带写持久缓存：点击播放先查 AsyncStorage，命中即秒开
            if (song.id) void setCachedUrl(song.id, song.sourceType || 'netease', direct);
            return direct;
          }
          return song.url;
        } finally {
          clearTimeout(timer);
        }
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
