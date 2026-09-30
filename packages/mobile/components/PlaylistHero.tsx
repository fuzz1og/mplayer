/**
 * 歌单详情页 Hero — 折叠方案（原型 D 变体定稿）的私人歌单适配层。
 * 通用结构在 CollapsingHero；这里只负责封面来源、列表行与本页的选择模式（#490）：
 *   - 长按任意歌曲行进入选择模式并选中该行（旧的「长按 = 直接移除」退休——
 *     同手势不能既表示危险删除又表示选择；移除仍在行「更多」菜单里，因为页面传了 onRemove）；
 *   - 选择模式下的顶部 sticky 条钉在悬浮导航栏正下方（左完成 / 中已选 N 项 / 右全选）。
 */

import React, { useCallback, useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Song } from '@mplayer/core';
import type { Playlist } from '../stores/playlistStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';
import { useRefreshedCover } from '../hooks/useRefreshedCover';
import CollapsingHero from './CollapsingHero';
import { NAV_H } from './collapsingChrome';
import PlaylistSelectionBar from './PlaylistSelectionBar';
import SongRow from './SongRow';
import { areAllSelected, pickSelected, type PlaylistSelection } from './playlistSelection';

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
  selection,
  onExitSelection,
  onLongPressSong,
  onToggleSong,
  onToggleAll,
}: {
  playlist: Playlist;
  onRemoveSong: (song: Song) => void;
  onSwap: (original: Song, swapped: Song) => void;
  /** 悬浮导航栏右侧动作插槽（透传 CollapsingHero） */
  navRight?: React.ReactNode;
  /** 选择模式状态（#490；状态由页面持有，行与顶部条都从这里取） */
  selection: PlaylistSelection;
  /** 顶部条「完成」：退出选择模式 */
  onExitSelection: () => void;
  /** 长按任意行：进入选择模式并选中该行；已在模式内则并入（不退出） */
  onLongPressSong: (song: Song) => void;
  /** 选择模式下的常规点击：切换选中（不再播放） */
  onToggleSong: (song: Song) => void;
  /** 顶部条右按钮：全选 / 取消全选（作用于完整列表） */
  onToggleAll: () => void;
}) {
  const insets = useSafeAreaInsets();
  // 自建歌单封面 = 第一首歌封面；过期则占位等待重新搜索后的最新封面。
  // 原生 <Image> 直连 CDN 直链渲染
  const { cover, handleError } = useRefreshedCover(playlist.songs[0] || null);
  const { mode: selectionMode, ids: selectedIds } = selection;

  // 计数取「列表交集」而不是 ids.size：外部删歌后可能残留陈旧 id
  const selectedCount = useMemo(
    () => (selectionMode ? pickSelected(playlist.songs, selection).length : 0),
    [playlist.songs, selection, selectionMode],
  );
  const allSelected = useMemo(
    () => selectionMode && areAllSelected(selection, playlist.songs),
    [playlist.songs, selection, selectionMode],
  );

  // renderItem 提 useCallback（#411）：行组件的 prop（queueSongs / onSwap / onRemove）
  // 都来自 props 或 playlist，引用稳定，行组件的 memo 才真正生效。
  // selection/selectedIds 变化时重建是有意的——勾选圈必须跟着重渲染。
  const renderItem = useCallback(
    ({ item }: { item: Song }) => (
      // 长按进入选择模式（#490）。SongRow 自带 ScalePress 按压反馈，
      // 这里只承接长按手势不做视觉（原 activeOpacity={1} 语义），故用无动画 Pressable
      <Pressable onLongPress={() => onLongPressSong(item)}>
        <SongRow
          song={item}
          showSource
          queueSongs={playlist.songs}
          onSwap={onSwap}
          onRemove={onRemoveSong}
          selectionMode={selectionMode}
          selected={selectedIds.has(item.id)}
          onPress={selectionMode ? onToggleSong : undefined}
        />
      </Pressable>
    ),
    [onLongPressSong, onRemoveSong, onSwap, onToggleSong, playlist.songs, selectedIds, selectionMode],
  );

  return (
    <View style={styles.root}>
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
        renderItem={renderItem}
      />
      {/* 顶部 sticky 条：钉在悬浮导航栏（NAV_H + insets.top）正下方，压在列表之上 */}
      {selectionMode ? (
        <View style={[styles.selectionBar, { top: insets.top + NAV_H }]}>
          <PlaylistSelectionBar
            count={selectedCount}
            allSelected={allSelected}
            onExit={onExitSelection}
            onToggleAll={onToggleAll}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // 悬浮导航栏自带 zIndex: 5（在 CollapsingHero 内部），本条画在它之后、位于其下缘
  selectionBar: { position: 'absolute', left: 0, right: 0, zIndex: 5 },
});
