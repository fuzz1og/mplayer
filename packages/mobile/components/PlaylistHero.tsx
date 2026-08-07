/**
 * 歌单详情页 Hero — 折叠方案（原型 D 变体定稿）的私人歌单适配层。
 * 通用结构在 CollapsingHero；这里只负责封面来源与列表行。
 */

import React from 'react';
import { TouchableOpacity, StyleSheet, View, Text } from 'react-native';
import type { Playlist } from '../stores/playlistStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';
import { useRefreshedCover } from '../hooks/useRefreshedCover';
import { colors } from '../theme/tokens';
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
}: {
  playlist: Playlist;
  onRemoveSong: (song: Song) => void;
  onSwap: (original: Song, swapped: Song) => void;
}) {
  // 自建歌单封面 = 第一首歌封面；过期则占位等待重新搜索后的最新封面
  const { cover, handleError } = useRefreshedCover(playlist.songs[0] || null);

  return (
    <CollapsingHero
      cover={cover}
      onCoverError={handleError}
      navTitle={playlist.name}
      title={playlist.name}
      meta={`${playlist.songs.length} 首`}
      actionLabel="播放全部"
      onAction={() => playAll(playlist)}
      data={playlist.songs}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <TouchableOpacity activeOpacity={1} onLongPress={() => onRemoveSong(item)}>
          <SongRow song={item} showSource queueSongs={playlist.songs} onSwap={onSwap} />
        </TouchableOpacity>
      )}
      listHeader={
        <View style={listHeaderStyles.row}>
          <Text style={listHeaderStyles.song}>歌曲</Text>
          <Text style={listHeaderStyles.ops}>操作</Text>
        </View>
      }
    />
  );
}

const listHeaderStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  song: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 56, // 对齐行内封面（44）+ 间距（12）
  },
  ops: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
  },
});
