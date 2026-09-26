import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { radius } from '../theme/tokens';

/**
 * 歌词加载占位 —— 预览区与全屏歌词页**共用同一个**组件（#416）。
 *
 * 为什么必须共用：这两处此前是两套口径——预览区有 3 条骨架线，全屏歌词页**没有加载分支**，
 * 加载中直接落进空态显示「这首歌暂无歌词」。歌词没加载完 ≠ 这首歌没有歌词，
 * 那是一句**假陈述**；#409 把歌词改成播放期按 ID 直取后，这段窗口从「列表已就绪」
 * 变成一次网络往返（真机实测 P50 ≈ 227ms），暴露得更明显。
 *
 * 形状与真实歌词行对齐：每行占 `lineHeight`（与 FlatList 的 `getItemLayout` 同值），
 * 条高 `barHeight`（≈ 该档字号），居中（真实歌词是 `textAlign: 'center'`）。
 * 宽度用固定的确定序列（不随机，避免每次渲染跳动）。
 *
 * 颜色由调用方给：播放器有自己的前景/背景体系（`fg.skeleton`），
 * 不走页面骨架屏的 `colors.skeletonBase`。
 */
// as const：元素类型收窄成 '%' 模板字面量，才能直接当 DimensionValue 用
const WIDTH_PATTERN = ['72%', '86%', '58%', '80%', '64%', '90%', '52%', '76%'] as const;

interface Props {
  rows: number;
  /** 每行占据的高度 —— 与真实列表的固定行高同值（保证加载完成不跳版）。 */
  lineHeight: number;
  /** 占位条高度（≈ 该档字号）。 */
  barHeight: number;
  /** 占位条颜色（播放器前景体系，如 `fg.skeleton`）。 */
  color: string;
  style?: StyleProp<ViewStyle>;
}

export default function LyricsSkeleton({ rows, lineHeight, barHeight, color, style }: Props) {
  return (
    <View style={style}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.row, { height: lineHeight }]}>
          <View
            style={[styles.bar, { height: barHeight, backgroundColor: color, width: WIDTH_PATTERN[i % WIDTH_PATTERN.length] }]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { justifyContent: 'center' },
  bar: { alignSelf: 'center', borderRadius: radius.full },
});
