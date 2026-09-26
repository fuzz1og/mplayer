import { memo, useCallback, useMemo } from 'react';
import { FlatList, Text, View, StyleSheet } from 'react-native';
import { X, Play } from 'lucide-react-native';
import { spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';
import { listWindowProps } from './listWindow';
import BottomSheet from './BottomSheet';
import ScalePress, { pressScale } from './ScalePress';
import type { Song } from '@mplayer/core';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** 队列行：memo + 稳定回调（#411）。此前 renderItem 内联箭头，且 key 拼了 index。 */
const QueueRow = memo(function QueueRow({
  song,
  isCurrent,
  onSelect,
  styles,
}: {
  song: Song;
  isCurrent: boolean;
  onSelect: (song: Song) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <ScalePress
      style={styles.item}
      pressScaleTo={pressScale.row}
      // 真机反馈（#186）：点歌换歌不关闭弹层，由用户决定何时关闭
      onPress={() => onSelect(song)}
    >
      <View style={styles.itemInfo}>
        <Text style={[styles.itemName, isCurrent && styles.itemActive]} numberOfLines={1}>
          {song.name}
        </Text>
        <Text style={styles.itemArtist}>{song.artist}</Text>
      </View>
      {isCurrent && <Play size={16} color={styles.itemActive.color as string} />}
    </ScalePress>
  );
});

/**
 * 播放队列弹层（#186 #5）：迷你播放栏与全屏播放器共用，基于 BottomSheet 壳
 * （把手 + radius.sheet + 拖拽关闭）。当前播放项高亮，点击切换播放。
 */
export default function QueueListModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const queue = usePlayerStore(s => s.queue);
  const currentSong = usePlayerStore(s => s.currentSong);

  /**
   * 稳定回调（#411）：用**对象身份**而不是 id 找下标 —— 队列里可以合法地出现同一首歌两次
   * （用户手动重复点播），按 id 找会永远命中第一份。
   */
  const handleSelect = useCallback((song: Song) => {
    const state = usePlayerStore.getState();
    const index = state.queue.indexOf(song);
    if (index < 0) return;
    state.setQueue(state.queue, index);
    playSong(song);
  }, []);

  /**
   * key 不含 index（#411）：`${id}-${index}` 会让「删掉一项」把它后面所有行重新挂载。
   * 同一首歌在队列里出现多次时用出现序号消歧，普通队列（无重复）等价于纯 id。
   */
  const rows = useMemo(() => {
    const seen = new Map<string, number>();
    return queue.map((song) => {
      const nth = (seen.get(song.id) ?? 0) + 1;
      seen.set(song.id, nth);
      return { song, key: nth === 1 ? song.id : `${song.id}#${nth}` };
    });
  }, [queue]);

  const renderItem = useCallback(
    ({ item }: { item: { song: Song; key: string } }) => (
      <QueueRow song={item.song} isCurrent={currentSong?.id === item.song.id} onSelect={handleSelect} styles={styles} />
    ),
    [currentSong?.id, handleSelect, styles],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.title}>播放队列 ({queue.length})</Text>
        <ScalePress onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={24} color={colors.textSecondary} />
        </ScalePress>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderItem}
        {...listWindowProps}
        ListEmptyComponent={<Text style={styles.empty}>队列为空</Text>}
      />
    </BottomSheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[1],
    marginBottom: spacing[1],
  },
  title: { ...textVariants.title, color: colors.textPrimary },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderDefault,
  },
  itemInfo: { flex: 1, marginRight: 12 },
  itemName: { ...textVariants.body, fontWeight: '400', color: colors.textPrimary },
  itemActive: { color: colors.accent },
  itemArtist: { ...textVariants.caption, color: colors.textSecondary, marginTop: 2 },
  empty: { ...textVariants.footnote, color: colors.textSecondary, textAlign: 'center', marginTop: spacing[10] },
});
