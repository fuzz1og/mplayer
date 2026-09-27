/**
 * 专辑详情页 Hero —— 折叠方案的专辑适配层（#406 二期）。
 *
 * 与 `PlaylistHero` 同一取向：通用结构全在 `CollapsingHero`，这里只做「数据与行」——
 * 指标行（年份 · N 首 · 总时长）、章节头、行徽章语义、播放全部、缺省态下的列表替身。
 * 专辑级动作（收藏/下载/分享）按 #406 的分期属三期，本层预留 `CollapsingHero.actions` 槽但不填。
 */

import React, { useCallback, useMemo } from 'react';
import { CircleAlert, Disc3, Music2 } from 'lucide-react-native';
import type { Album, Song } from '@mplayer/core';
import { radius, spacing, textVariants, typography } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';
import CollapsingHero from './CollapsingHero';
import SongRow from './SongRow';
import SongListSkeleton from './SongListSkeleton';
import EmptyState from './EmptyState';
import ScalePress from './ScalePress';
import { StyleSheet, Text } from 'react-native';

export type AlbumListState = 'loading' | 'ready' | 'error' | 'empty';

interface Props {
  album: Album | null;
  songs: Song[];
  state: AlbumListState;
  /** 列表区失败文案（core 的 unsupported / failed 已区分，页面给文案） */
  errorMessage: string;
  onRetry: () => void;
  onSwap: (original: Song, swapped: Song) => void;
  /** 路由参数兜底：加载期/失败态的标题、封面、歌手都来自这里（失败态不得显示「0 首」） */
  fallbackName: string;
  fallbackPic: string;
  fallbackArtist: string;
}

/** 总时长文案（与桌面同一口径：秒求和后按小时/分钟渲染）。 */
function formatTotalDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  return `${Math.max(minutes, 1)} 分钟`;
}

export default function AlbumHero({
  album, songs, state, errorMessage, onRetry, onSwap,
  fallbackName, fallbackPic, fallbackArtist,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const title = album?.name || fallbackName;
  const cover = album?.picUrl || fallbackPic;
  const artist = album?.artist || fallbackArtist;
  // 专辑默认源（#407）：整张专辑同源是常态，逐行挂同色徽章等于零信息量
  const defaultSource = album?.sourceType;

  const year = (() => {
    const t = Number(album?.publishTime || 0);
    return t > 0 ? String(new Date(t).getFullYear()) : '';
  })();

  const metaItems = useMemo(() => {
    if (state !== 'ready') return [];
    const duration = formatTotalDuration(songs.reduce((sum, s) => sum + (s.duration || 0), 0));
    return [artist || '', year, `${songs.length} 首`, duration].filter(Boolean);
  }, [state, songs, year, artist]);

  const playAll = useCallback(() => {
    if (songs.length === 0) return;
    usePlayerStore.getState().setQueue(songs, 0);
    playSong(songs[0]);
  }, [songs]);

  // renderItem 稳定引用（#411）：内联箭头会让 SongRow 的 memo 逐帧失效
  const renderItem = useCallback(
    ({ item }: { item: Song }) => (
      <SongRow
        song={item}
        showSource={defaultSource ? item.sourceType !== defaultSource : true}
        queueSongs={songs}
        onSwap={onSwap}
      />
    ),
    [defaultSource, songs, onSwap],
  );

  const listEmpty = useMemo(() => {
    if (state === 'loading') return <SongListSkeleton rows={6} showSource={false} />;
    if (state === 'error') {
      return (
        <EmptyState
          icon={CircleAlert}
          title={errorMessage || '专辑加载失败'}
          subtitle="稍后重试，或先播放其他内容"
          action={(
            <ScalePress style={styles.retryBtn} onPress={onRetry}>
              <Text style={styles.retryText}>重试</Text>
            </ScalePress>
          )}
        />
      );
    }
    return <EmptyState icon={Music2} title="暂无歌曲" subtitle="这张专辑里没有可展示的曲目" />;
  }, [state, errorMessage, onRetry, styles]);

  return (
    <CollapsingHero
      cover={cover}
      fallbackIcon={<Disc3 size={72} color={colors.textInverse} />}
      navTitle={title}
      title={title}
      subtitle={artist || undefined}
      metaItems={metaItems}
      surface
      sectionHeader={state === 'ready' ? `歌曲 · ${songs.length} 首` : undefined}
      actionLabel="播放全部"
      onAction={playAll}
      data={songs}
      keyExtractor={(item, i) => `${item.id}-${i}`}
      renderItem={renderItem}
      ListEmptyComponent={listEmpty}
    />
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  retryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
  },
  retryText: { ...textVariants.callout, color: colors.textInverse, fontWeight: typography.weights.semibold },
});
