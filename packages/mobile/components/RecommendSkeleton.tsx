import { View, Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight, SECTION_TAIL_PADDING } from './chromeMetrics';
import { GRID_GAP, gridCardWidth } from './gridMetrics';
import { GRID_CARD } from './gridCardMetrics';
import SongRowSkeleton from './SongRowSkeleton';
import { useAnimatedBg } from '../theme/AnimatedBg';
import { usePlayerStore } from '../stores/playerStore';
import { radius, spacing } from '../theme/tokens';
import SkeletonBlock from './SkeletonBlock';
import { RECOMMEND_BATCH_SIZE, RECOMMEND_GRID_COLS } from './recommendMetrics';

/**
 * 推荐页冷启动骨架屏（#318）：**逐段镜像真实布局**。
 * 背景必须自己画（`animatedBg`）：loading 分支是**早退**，不经过页面的`Animated.ScrollView`——而页
 * 面底色恰恰挂在它身上。
 */
export default function RecommendSkeleton() {
  const insets = useSafeAreaInsets();
  const animatedBg = useAnimatedBg();
  // ADR-0008：首次播放前迷你播放栏隐藏，让位随之缩小（与真实页同一判定）
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  const cardW = gridCardWidth({ cols: RECOMMEND_GRID_COLS });

  return (
    <Animated.View testID="recommend-skeleton" style={[styles.container, { backgroundColor: animatedBg }]}>
      <View
        style={{
          paddingTop: topChromeHeight(insets.top),
          paddingBottom: bottomChromeHeight(insets.bottom, true, playerVisible) + SECTION_TAIL_PADDING,
        }}
      >
        {/* 今日推荐：节标题 + 右侧「播放全部 / 换一批」两个动作位 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SkeletonBlock style={styles.titleBlock} />
            <View style={styles.headerActions}>
              <SkeletonBlock style={styles.actionBlock} />
              <SkeletonBlock style={styles.actionBlock} />
            </View>
          </View>
          {/* 今日推荐的行就是 SongRow（含收藏/更多两列），故直接复用同一行的骨架（#416）：
              此前这里手写且漏了右侧动作列，歌名可用宽度与真实行不同 → 数据到达时位移 */}
          {Array.from({ length: RECOMMEND_BATCH_SIZE }, (_, i) => (
            <SongRowSkeleton key={i} showActions />
          ))}
        </View>

        {/* 猜你喜欢：节标题 + 2 列卡片（封面 + 两行文字） */}
        <View style={styles.section}>
          <SkeletonBlock style={[styles.titleBlock, styles.gridTitle]} />
          <View style={styles.grid}>
            {Array.from({ length: RECOMMEND_GRID_COLS }, (_, i) => (
              <View key={i} style={{ width: cardW }}>
                <SkeletonBlock style={[styles.gridCover, { width: cardW, height: cardW }]} />
                <SkeletonBlock style={styles.gridName} />
                <SkeletonBlock style={[styles.gridName, styles.gridMeta]} />
              </View>
            ))}
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// 本骨架不含任何取色（骨架块自己带主题色，歌曲行在 SongRowSkeleton），故是模块级常量
const styles = StyleSheet.create({
  container: { flex: 1 },
  // 与真实页 styles.section 同值
  section: { paddingHorizontal: spacing[4], marginTop: spacing[4] },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  // 节标题字高（textVariants.sectionHeader）与两个动作按钮的文字量级
  titleBlock: { width: 72, height: 18, borderRadius: radius.sm },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionBlock: { width: 52, height: 14, borderRadius: radius.sm },
  // 歌曲行的度量在 SongRowSkeleton/songRowMetrics；这里只留网格卡片
  gridTitle: { marginBottom: spacing[3] },
  // 与真实页 styles.grid 同值（flex-wrap，gap 两轴都算）
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  gridCover: { borderRadius: GRID_CARD.coverRadius },
  gridName: {
    height: GRID_CARD.nameLineHeight,
    borderRadius: radius.xs,
    width: '80%',
    marginTop: GRID_CARD.nameGap,
  },
  gridMeta: { height: GRID_CARD.metaLineHeight, borderRadius: radius.xs, width: '45%', marginTop: GRID_CARD.metaGap },
});
