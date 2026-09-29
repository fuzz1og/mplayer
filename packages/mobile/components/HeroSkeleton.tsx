/**
 * Hero 页骨架（#465）：与真实 Hero **同源**的占位形状。
 *
 * 此前四个 Hero 页的加载态各写各的：歌单详情页只画列表骨架、Hero 是数据到了才插进来
 * （封面占屏约 40%，必然跳一次布局）；专辑页一个 Skeleton 都没 import。
 *
 * 纪律（同 CoverGridSkeleton #318/#416）：**骨架与真实同源**——封面块高度取
 * collapsingChrome() 算出的同一个 coverH，而不是各页手抄一个魔法数。
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { collapsingChrome, COVER_FOG_H } from './collapsingChrome';
import SkeletonBlock from './SkeletonBlock';
import SongRowSkeleton from './SongRowSkeleton';
import { useTheme } from '../theme/ThemeProvider';

export default function HeroSkeleton({
  rows = 6,
  showRank = false,
  showSource = false,
  showActions = true,
}: {
  rows?: number;
  showRank?: boolean;
  showSource?: boolean;
  showActions?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { coverH } = collapsingChrome(insets.top);

  return (
    <View style={[styles.container, { backgroundColor: colors.bgBase }]}>
      {/* 封面块：与真实 Hero 同一个 coverH */}
      <View style={{ height: coverH, backgroundColor: colors.bgSurface }}>
        <View style={[styles.fog, { height: COVER_FOG_H, backgroundColor: colors.bgBase }]} />
      </View>
      {/* 信息区：大标题 + 副标题 + 指标行 */}
      <View style={styles.info}>
        <SkeletonBlock style={styles.title} />
        <SkeletonBlock style={styles.subtitle} />
        <SkeletonBlock style={styles.meta} />
      </View>
      {Array.from({ length: rows }).map((_, i) => (
        <SongRowSkeleton
          key={i}
          showRank={showRank}
          showSource={showSource}
          showActions={showActions}
          separator={i > 0 ? 'top' : 'none'}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fog: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  info: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 10 },
  title: { width: '58%', height: 26, borderRadius: 6 },
  subtitle: { width: '34%', height: 14, borderRadius: 4 },
  meta: { width: '46%', height: 12, borderRadius: 4 },
});
