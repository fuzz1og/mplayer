import { parsePlaylistUrl, getQqPlaylistSongs, getDirectClient } from '@mplayer/core';
import type { Song } from '@mplayer/core';

/**
 * 歌单链接 → 歌曲列表（导入向导的取歌腿，wayfinder #382 定案）。
 *
 * 与 core 的 importFromLink 同构：编排只依赖注入的取歌能力，宿主决定真实实现，
 * 因此这一段可以脱离网络单测。三条腿：
 * - 网易完整链接：直连 getPlaylistSongs(id, 0, 0)（limit<=0 = 全量）
 * - 网易短链：先跟重定向拿落地 URL，再重新识别（桌面走主进程，RN 用 fetch）
 * - QQ 直链 / 分享短链：getQqPlaylistSongs（短链由 core 内部跟 302）
 *
 * 歌曲自带来源 ID，播放地址由播放链路路由解析，导入阶段不做搜索。
 */
export interface PlaylistLinkDeps {
  /** QQ 歌单（id 或分享短链） */
  fetchQqPlaylist: (source: string | number) => Promise<Song[]>;
  /** 网易歌单全量 */
  fetchNeteasePlaylist: (id: number) => Promise<Song[]>;
  /** 跟随重定向返回落地 URL（RN 用 fetch；桌面走主进程解析腿） */
  resolveRedirect: (url: string) => Promise<string>;
}

/** 移动端默认取歌腿：QQ/网易都走 core 直连客户端，短链用 RN fetch 跟随重定向 */
export function defaultPlaylistLinkDeps(): PlaylistLinkDeps {
  return {
    fetchQqPlaylist: (source) => getQqPlaylistSongs(source),
    fetchNeteasePlaylist: async (id) => {
      const client = getDirectClient('netease');
      if (!client?.getPlaylistSongs) {
        throw new Error('网易歌单能力不可用');
      }
      const full = await client.getPlaylistSongs(id, 0, 0);
      return full.songs;
    },
    resolveRedirect: async (url) => {
      const res = await fetch(url);
      return res.url || '';
    },
  };
}

/** 识别链接并取回歌曲；识别失败 / 落地不是歌单 / 空歌单都抛语义化错误（宿主直接透出） */
export async function fetchPlaylistSongsFromLink(url: string, deps: PlaylistLinkDeps): Promise<Song[]> {
  const info = parsePlaylistUrl((url || '').trim());
  if (!info) {
    throw new Error('请输入有效的歌单链接（支持网易云和 QQ 音乐）');
  }

  let songs: Song[];
  if (info.type === 'qq') {
    songs = await deps.fetchQqPlaylist(info.id ?? info.url!);
  } else {
    let target = info;
    if (info.type === 'netease-short') {
      const finalUrl = await deps.resolveRedirect(info.url!);
      const reparsed = parsePlaylistUrl(finalUrl);
      if (!reparsed || reparsed.type !== 'netease') {
        throw new Error('短链解析失败，未能定位到网易云歌单');
      }
      target = reparsed;
    }
    songs = await deps.fetchNeteasePlaylist(Number(target.id));
  }

  if (songs.length === 0) {
    throw new Error('歌单不存在或没有歌曲');
  }
  return songs;
}
