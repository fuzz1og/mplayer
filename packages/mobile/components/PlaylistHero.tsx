/**
 * 歌单详情页 Hero — 折叠方案（原型 D 变体定稿）的私人歌单适配层。
 * 通用结构在 CollapsingHero；这里只负责封面来源与列表行。
 */

import React from 'react';
import { Pressable } from 'react-native';
import type { Playlist } from '../stores/playlistStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';
import { useRefreshedCover } from '../hooks/useRefreshedCover';
import { useResolvedCover } from '../hooks/useResolvedCover';
import CollapsingHero from './CollapsingHero';
import SongRow from './SongRow';
import type { Song } from '@mplayer/core';

function playAll(playlist: Playlist) {
  if (playlist.songs.length === 0) return;
  usePlayerStore.getState().setQueue(playlist.songs, 0);
  playSong(playlist.songs[0]);
}

export default function PlaylistHero({
  playlist,
  onRemoveSong,
  onSwap,
  navRight,
}: {
  playlist: Playlist;
  onRemoveSong: (song: Song) => void;
  onSwap: (original: Song, swapped: Song) => void;
  /** 悬浮导航栏右侧动作插槽（透传 CollapsingHero） */
  navRight?: React.ReactNode;
}) {
  // 自建歌单封面 = 第一首歌封面；过期则占位等待重新搜索后的最新封面
  const { cover, handleError } = useRefreshedCover(playlist.songs[0] || null);
  // 封面 URL 可能是 api.php?get=pic 会话保护端点（原生 <Image> 无法带 cookie，
  // 直接加载必失败 → 占位图）。解析成 CDN 直链后再渲染——否则歌单详情页
  // 永远只显示占位/搜索兜底的错误封面（"封面不是第一首歌的图片"）。
  const resolvedCover = useResolvedCover(cover);

  return (
    <CollapsingHero
      cover={resolvedCover}
      onCoverError={handleError}
      navTitle={playlist.name}
      navRight={navRight}
      title={playlist.name}
      meta={`${playlist.songs.length} 首`}
      actionLabel="播放全部"
      onAction={() => playAll(playlist)}
      data={playlist.songs}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        // 长按删除的行包装：SongRow 自带 ScalePress 按压反馈，这里只承接
        // 手势不做视觉（原 activeOpacity={1} 语义），故用无动画 Pressable
        <Pressable onLongPress={() => onRemoveSong(item)}>
          <SongRow song={item} showSource queueSongs={playlist.songs} onSwap={onSwap} onRemove={onRemoveSong} />
        </Pressable>
      )}
    />
  );
}
