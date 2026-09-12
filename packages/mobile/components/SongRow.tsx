import { useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, Image, StyleSheet, type GestureResponderEvent,
} from 'react-native';
import { Music, Heart, EllipsisVertical } from 'lucide-react-native';
import {radius, spacing, textVariants} from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { type Song, SourceKey } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useFavoriteStore } from '../stores/favoriteStore';
import { useAudioTagStore, tagKey } from '../stores/audioTagStore';
import { SOURCE_LABELS } from '../stores/sourceStore';
import { useSongActionsStore } from '../stores/songActionsStore';
import { usePressMutex } from '../hooks/usePressMutex';
import SourceBadge from './SourceBadge';
import { playSong } from '../services/audioPlayer';
import { searchStrictMatch } from '../services/songResources';
import { withCoverSearchSlot } from '../services/coverSearchSlot';
import ScalePress from './ScalePress';

interface SongRowProps {
  song: Song;
  rank?: number;
  onPress?: (song: Song) => void;
  showSource?: boolean;
  queueSongs?: Song[];
  /** 换源成功回调：父组件用它更新自己的列表 state（歌单页同时持久化） */
  onSwap?: (original: Song, swapped: Song) => void;
  /** 提供后「更多」菜单显示「移除」项（歌单/播放历史列表用；由父组件决定移除语义与确认） */
  onRemove?: (song: Song) => void;
}

/**
 * 歌曲行：只负责展示与行级按压反馈，「更多」面板 / 加入歌单 / 换源三套弹层
 * 交给全应用单实例的 components/SongActionsHost.tsx（状态在 stores/songActionsStore.ts）——
 * 旧形态每行挂 3 个 BottomSheet + 3 个 ScalePress，隐藏实例也在跑无障碍与
 * 尺寸订阅（#304）。
 *
 * 行内按钮（收藏 / 更多）与行自身的按压互斥：e.stopPropagation()（对齐
 * PlayerBar 纪律）+ hooks/usePressMutex 同步认领，替代旧的
 * `pressingAction` state + setTimeout(100)（读上一次渲染闭包值，JS 忙时漏判）。
 */
export default function SongRow({
  song,
  rank,
  onPress,
  showSource = false,
  queueSongs,
  onSwap,
  onRemove,
}: SongRowProps) {
  const isFav = useFavoriteStore((s) => s.isFavorite(song.id));
  const addFavorite = useFavoriteStore((s) => s.addFavorite);
  const removeFavorite = useFavoriteStore((s) => s.removeFavorite);
  const openActions = useSongActionsStore((s) => s.openActions);
  const pressMutex = usePressMutex();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // 按 (sourceType:id) 订阅探测标签:每批探测完成只重渲染对应的行,标签渐进式出现
  const audioTag = useAudioTagStore((s) => s.tags[tagKey(song)]);

  const favorited = isFav;

  // 封面失效兜底：缓存 URL 挂了 → 搜索重载（每行最多一次，严格匹配防翻唱封面）
  // 原生 <Image> 直连 CDN 直链渲染
  const [cover, setCover] = useState(song.cover);
  const coverFallbackUsed = useRef(false);
  useEffect(() => {
    setCover(song.cover);
    coverFallbackUsed.current = false;
  }, [song.cover]);

  const handleCoverError = () => {
    if (coverFallbackUsed.current || !song.name) return;
    coverFallbackUsed.current = true;
    setCover('');
    void withCoverSearchSlot(async () => {
      try {
        const fresh = await searchStrictMatch(song);
        if (fresh?.cover?.startsWith('http')) setCover(fresh.cover);
      } catch {
        // 封面兜底失败保留占位
      }
    });
  };

  /** 「更多」：认领本次手势 → 打开操作面板（弹层内容与状态在 SongActionsHost） */
  const handleMore = (e?: GestureResponderEvent) => {
    e?.stopPropagation();
    pressMutex.claimInner();
    openActions(song, { onSwap, onRemove });
  };

  const handlePress = () => {
    if (pressMutex.consumeRowPress()) return;
    if (onPress) {
      onPress(song);
    } else if (queueSongs) {
      const idx = queueSongs.findIndex(s => s.id === song.id);
      usePlayerStore.getState().setQueue(queueSongs, Math.max(0, idx));
      playSong(song);
    } else {
      usePlayerStore.getState().setQueue([song], 0);
      playSong(song);
    }
  };

  const handleFavorite = (e?: GestureResponderEvent) => {
    e?.stopPropagation();
    pressMutex.claimInner();
    if (favorited) {
      removeFavorite(song.id);
    } else {
      addFavorite(song);
    }
  };

  const sourceKey = song.sourceType as SourceKey;

  return (
    <ScalePress
      style={styles.container}
      pressScaleTo={0.98}
      onPress={handlePress}
    >
      {rank !== undefined && (
        <Text style={[styles.rank, rank <= 3 && { color: colors.rankText[rank - 1] }]}>{rank}</Text>
      )}

      {cover ? (
        <Image source={{ uri: cover }} style={styles.cover} onError={handleCoverError} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Music size={22} color={colors.textDisabled} />
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {song.name}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist}
        </Text>
      </View>

      {showSource && (
        <SourceBadge source={sourceKey} variant="badge">
          {SOURCE_LABELS[sourceKey] || sourceKey}
        </SourceBadge>
      )}

      {audioTag === 'preview' && (
        <View style={styles.tagBadgePreview}>
          <Text style={[styles.tagText, { color: colors.textSecondary }]}>短时长</Text>
        </View>
      )}
      {audioTag === 'invalid' && (
        <View style={styles.tagBadgeInvalid}>
          <Text style={[styles.tagText, { color: colors.dangerText }]}>无效</Text>
        </View>
      )}

      <ScalePress
        onPress={handleFavorite}
        style={styles.favoriteBtn}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}
      >
        <Heart
          size={20}
          color={favorited ? colors.accent : colors.textTertiary}
          fill={favorited ? colors.accent : 'none'}
        />
      </ScalePress>
      <ScalePress onPress={handleMore} style={styles.moreBtn} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
        <EllipsisVertical size={18} color={colors.textTertiary} />
      </ScalePress>
    </ScalePress>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: 10,
    backgroundColor: colors.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  rank: {
    ...textVariants.subhead,
    fontWeight: '600',
    color: colors.textSecondary,
    width: 28,
    textAlign: 'center',
    marginRight: spacing[1],
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    marginRight: spacing[3],
  },
  coverPlaceholder: {
    backgroundColor: colors.bgHover,
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    marginRight: spacing[2],
  },
  name: {
    ...textVariants.subhead,
    color: colors.textPrimary,
  },
  artist: {
    ...textVariants.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  tagBadgePreview: {
    borderRadius: radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: spacing[2],
    backgroundColor: colors.warningSubtle,
  },
  tagBadgeInvalid: {
    borderRadius: radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: spacing[2],
    backgroundColor: colors.dangerSubtle,
  },
  tagText: {
    ...textVariants.micro, // 归一：10 → micro(11)
  },
  favoriteBtn: {
    padding: spacing[1],
  },
  moreBtn: {
    padding: spacing[1],
    marginLeft: spacing[1],
  },
});
