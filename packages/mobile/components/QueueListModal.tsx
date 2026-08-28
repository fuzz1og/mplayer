import { useMemo } from 'react';
import { FlatList, Text, View, StyleSheet } from 'react-native';
import { X, Play } from 'lucide-react-native';
import { spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayerStore } from '../stores/playerStore';
import { playSong } from '../services/audioPlayer';
import BottomSheet from './BottomSheet';
import ScalePress, { pressScale } from './ScalePress';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * 播放队列弹层（#186 #5）：迷你播放栏与全屏播放器共用，基于 BottomSheet 壳
 * （把手 + radius.sheet + 拖拽关闭）。当前播放项高亮，点击切换播放。
 */
export default function QueueListModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const queue = usePlayerStore(s => s.queue);
  const currentSong = usePlayerStore(s => s.currentSong);
  const setQueue = usePlayerStore(s => s.setQueue);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.title}>播放队列 ({queue.length})</Text>
        <ScalePress onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={24} color={colors.textSecondary} />
        </ScalePress>
      </View>
      <FlatList
        data={queue}
        keyExtractor={(item, i) => `${item.id}-${i}`}
        renderItem={({ item, index }) => {
          const isCurrent = currentSong?.id === item.id;
          return (
            <ScalePress
              style={styles.item}
              pressScaleTo={pressScale.row}
              onPress={() => {
                // 真机反馈（#186）：点歌换歌不关闭弹层，由用户决定何时关闭
                setQueue(queue, index);
                playSong(item);
              }}
            >
              <View style={styles.itemInfo}>
                <Text style={[styles.itemName, isCurrent && styles.itemActive]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.itemArtist}>{item.artist}</Text>
              </View>
              {isCurrent && <Play size={16} color={colors.accent} />}
            </ScalePress>
          );
        }}
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
  empty: { ...textVariants.footnote, color: colors.textTertiary, textAlign: 'center', marginTop: spacing[10] },
});
