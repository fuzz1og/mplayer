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
  // 自建歌单封面 = 第一首歌封面；过期则占位等待重新搜索后的最新封面。
  // 原生 <Image> 直连 CDN 直链渲染
  const { cover, handleError } = useRefreshedCover(playlist.songs[0] || null);

  return (
    <CollapsingHero
      cover={cover}
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
