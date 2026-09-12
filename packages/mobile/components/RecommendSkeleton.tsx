import { useMemo } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topChromeHeight, bottomChromeHeight, SECTION_TAIL_PADDING } from './chromeMetrics';
import { gridCardWidth } from './gridMetrics';
import { useAnimatedBg } from '../theme/AnimatedBg';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayerStore } from '../stores/playerStore';
import { radius, spacing } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import SkeletonBlock from './SkeletonBlock';
import { RECOMMEND_BATCH_SIZE, RECOMMEND_GRID_COLS } from './recommendMetrics';

/**
 * 推荐页冷启动骨架屏（#318）：**逐段镜像真实布局**。
 *
 * 与 `app/(tabs)/recommend.tsx` 共用同一套度量：chrome 让位
 * （topChromeHeight/bottomChromeHeight/SECTION_TAIL_PADDING）、节标题 + 两个动作位、
 * `SongRow` 行高与分隔线、猜你喜欢 2 列卡片（`gridCardWidth` 单一公式、列数取
 * recommendMetrics）。行数取 RECOMMEND_BATCH_SIZE，数据到达时不跳版。
 *
 * 背景必须自己画（`animatedBg`）：loading 分支是**早退**，不经过页面的
 * `Animated.ScrollView`——而页面底色恰恰挂在它身上。不画就会露出 expo-router
 * 导航容器自带的浅色默认底 rgb(242,242,242)（`theme/AnimatedBg.tsx` 头注释记录过
 * 同一坑），暗色模式下表现为「骨架屏没适配暗色」。真机冷启动连拍确认：
 * 修前白底 + 深色骨架块，修后与真实页面同底（含主题切换过渡）。
 */
export default function RecommendSkeleton() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const animatedBg = useAnimatedBg();
  // ADR-0008：首次播放前迷你播放栏隐藏，让位随之缩小（与真实页同一判定）
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
          {Array.from({ length: RECOMMEND_BATCH_SIZE }, (_, i) => (
            <View key={i} style={styles.row}>
              <SkeletonBlock style={styles.cover} />
              <View style={styles.info}>
                <SkeletonBlock style={styles.line} />
                <SkeletonBlock style={[styles.line, styles.lineShort]} />
              </View>
            </View>
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

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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
  // 行度量与 SongRow.container 逐项对齐（16 横距 / 10 纵距 / 44 封面 / hairline 分隔线 / bgSurface）
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: 10,
    backgroundColor: colors.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  cover: { width: 44, height: 44, borderRadius: radius.sm, marginRight: spacing[3] },
  info: { flex: 1 },
  // 名称行（textVariants.subhead）与歌手行（caption + marginTop 2）
  line: { height: 13, borderRadius: radius.sm, width: '55%' },
  lineShort: { width: '32%', marginTop: 8 },
  gridTitle: { marginBottom: spacing[3] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  gridCover: { borderRadius: radius.md },
  gridName: { height: 12, borderRadius: radius.sm, width: '80%', marginTop: spacing[2] },
  gridMeta: { width: '45%', marginTop: 6 },
});
