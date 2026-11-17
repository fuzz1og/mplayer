import { useMemo } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight, SECTION_TAIL_PADDING } from './chromeMetrics';
import { GRID_GAP, gridCardWidth } from './gridMetrics';
import { GRID_CARD } from './gridCardMetrics';
import SongRowSkeleton from './SongRowSkeleton';
import { useAnimatedBg } from '../theme/AnimatedBg';
import { usePlayerStore } from '../stores/playerStore';
import { radius, spacing } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
        {/* 每日推荐卡：卡头封面叠放 + 标题 / meta + 两个动作 + 5 行歌曲 */}
        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.coverStack}>
                <SkeletonBlock style={[styles.stackCover, styles.stackBack]} />
                <SkeletonBlock style={[styles.stackCover, styles.stackMid]} />
                <SkeletonBlock style={[styles.stackCover, styles.stackFront]} />
              </View>
              <View style={styles.cardInfo}>
                <SkeletonBlock style={styles.radioTitle} />
                <SkeletonBlock style={styles.radioMeta} />
              </View>
            </View>
            <View style={styles.cardActions}>
              <SkeletonBlock style={styles.playBtn} />
              <SkeletonBlock style={styles.shuffleBtn} />
            </View>
            <View style={styles.cardRows}>
              {Array.from({ length: RECOMMEND_BATCH_SIZE }, (_, i) => (
                <SongRowSkeleton key={i} showActions separator="bottom" />
              ))}
            </View>
          </View>
        </View>

        {/* 猜你喜欢：两列网格，骨架出首屏一行两张 */}
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

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },
  // 与真实页 styles.radioSection 同值
  section: { paddingHorizontal: spacing[4], marginTop: spacing[4] },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
  },
  coverStack: { width: 70, height: 48, marginRight: spacing[3] },
  stackCover: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: radius.sm,
  },
  stackBack: { left: 24, top: 4 },
  stackMid: { left: 12, top: 4 },
  stackFront: { left: 0, top: 4 },
  cardInfo: { flex: 1 },
  radioTitle: { width: 72, height: 18, borderRadius: radius.sm },
  radioMeta: { width: 96, height: 13, borderRadius: radius.xs, marginTop: 6 },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  playBtn: { width: 92, height: 32, borderRadius: radius.full },
  shuffleBtn: { width: 64, height: 16, borderRadius: radius.xs },
  cardRows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  // 猜你喜欢（与真实页网格同源）
  titleBlock: { width: 72, height: 18, borderRadius: radius.sm },
  gridTitle: { marginBottom: spacing[3] },
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
