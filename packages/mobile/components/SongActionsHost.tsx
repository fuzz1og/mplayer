import { useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import { ArrowLeftRight, Download, ListMusic, Trash2, User } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { Song } from '@mplayer/core';
import { radius, spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { configureSongActions, useSongActionsStore } from '../stores/songActionsStore';
import { nativeSongActionEffects } from '../services/songActionEffects';
import BottomSheet from './BottomSheet';
import AddToPlaylistModal from './AddToPlaylistModal';
import SourceSwapModal from './SourceSwapModal';
import ScalePress from './ScalePress';

// 平台效果必须在任何行被点击前绑定：模块顶层执行（与 app/_layout 注册直连客户端同款约束）
configureSongActions(nativeSongActionEffects);

interface ActionItem {
  key: string;
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}

/**
 * 歌曲行弹层宿主（#304）：全应用单实例，替所有 SongRow 承担三套弹层
 * （操作面板 / 加入歌单 / 换源）与它们的动效资源。
 *
 * 旧形态每行挂 3 个 BottomSheet + 3 个 ScalePress：一屏 15 行 ≈ 45 个隐藏
 * BottomSheet（各跑 useSafeAreaInsets/useWindowDimensions/useReducedMotion）
 * 与 90 个 reduced-motion 订阅。现在行只调 openActions(song, handlers)，
 * 弹层与动画资源只剩这一份，可见流程不变。
 */
export default function SongActionsHost() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const actionSheet = useSongActionsStore((s) => s.actionSheet);
  const playlist = useSongActionsStore((s) => s.playlist);
  const swap = useSongActionsStore((s) => s.swap);
  const closeActions = useSongActionsStore((s) => s.closeActions);
  const openAddToPlaylist = useSongActionsStore((s) => s.openAddToPlaylist);
  const openSwap = useSongActionsStore((s) => s.openSwap);
  const closeAddToPlaylist = useSongActionsStore((s) => s.closeAddToPlaylist);
  const closeSwap = useSongActionsStore((s) => s.closeSwap);
  const selectSwapSource = useSongActionsStore((s) => s.selectSwapSource);
  const selectSwapCandidate = useSongActionsStore((s) => s.selectSwapCandidate);
  const swapBack = useSongActionsStore((s) => s.swapBack);

  const song: Song | null = actionSheet?.song ?? null;
  const onRemove = actionSheet?.handlers.onRemove;

  // 动作集合与顺序与旧行内一致：加入歌单 / 下载 / 换源完整版 / 搜索歌手 /（可选）移除
  const actions = useMemo<ActionItem[]>(() => {
    if (!song) return [];
    const items: ActionItem[] = [
      { key: 'playlist', icon: ListMusic, label: '加入歌单', onPress: () => openAddToPlaylist(song) },
      { key: 'download', icon: Download, label: '下载', onPress: () => { closeActions(); nativeSongActionEffects.download(song); } },
      { key: 'swap', icon: ArrowLeftRight, label: '换源完整版', onPress: () => openSwap(song, actionSheet?.handlers) },
      { key: 'artist', icon: User, label: '搜索歌手', onPress: () => { closeActions(); nativeSongActionEffects.searchArtist(song); } },
    ];
    if (onRemove) {
      items.push({ key: 'remove', icon: Trash2, label: '移除', onPress: () => { closeActions(); onRemove(song); } });
    }
    return items;
  }, [song, onRemove, actionSheet?.handlers, openAddToPlaylist, openSwap, closeActions]);

  return (
    <>
      {/* key 随歌曲切换：换行开面板时旧实例直接卸载（与旧「每行各持一个 BottomSheet」一致） */}
      <BottomSheet key={song?.id ?? 'none'} visible={actionSheet?.visible === true} onClose={closeActions}>
        <Text style={styles.actionSheetTitle} numberOfLines={1}>{song?.name}</Text>
        {actions.map((a) => (
          <ScalePress key={a.key} style={styles.actionItem} onPress={a.onPress}>
            <a.icon size={22} color={colors.textPrimary} />
            <Text style={styles.actionLabel}>{a.label}</Text>
          </ScalePress>
        ))}
        <ScalePress style={styles.actionCancel} onPress={closeActions}>
          <Text style={styles.cancelText}>取消</Text>
        </ScalePress>
      </BottomSheet>
      <AddToPlaylistModal
        visible={playlist?.visible === true}
        song={playlist?.song ?? null}
        onClose={closeAddToPlaylist}
      />
      <SourceSwapModal
        visible={swap.visible}
        songName={swap.song?.name}
        currentSource={swap.song?.sourceType}
        candidates={swap.candidates}
        loading={swap.loading}
        success={swap.success}
        onSelectSource={(source) => { void selectSwapSource(source); }}
        onSelectCandidate={selectSwapCandidate}
        onBack={swapBack}
        onClose={closeSwap}
      />
    </>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  actionSheetTitle: {
    ...textVariants.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing[4],
    textAlign: 'center',
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  actionLabel: {
    ...textVariants.callout,
    color: colors.textPrimary,
    marginLeft: spacing[3],
  },
  actionCancel: {
    marginTop: spacing[3],
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
  },
  cancelText: {
    ...textVariants.callout,
    color: colors.textSecondary,
  },
});
