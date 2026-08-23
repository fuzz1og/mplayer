import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { spacing, textVariants } from '../theme/tokens';
import { lightColors, darkColors } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import ScalePress from './ScalePress';

/**
 * 文字 tabs + 选中下划线——Apple Music「资料库」式次级选择器。
 * 未选中次级色常规字重；选中加粗变深 + 2dp accent 下划线。
 * 零底色零圆角，视觉层级低于分段控件（SegmentedTabs），
 * 用于二级分类（发现页曲风/地区、搜索页歌曲/歌手）。
 *
 * scrollable：条目多时横向滑动（分类行）；固定两三项用同行布局（搜索页）。
 */
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  scrollContent: {
    flexDirection: 'row',
    gap: spacing[1],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
  },
  rowContent: {
    flexDirection: 'row',
    gap: spacing[1],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
  },
  item: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    alignItems: 'center',
  },
  /* 固定行形态：各项 flex 等分满宽（iOS 分段式等分，非横滑形态专用） */
  itemFixed: {
    flex: 1,
  },
  label: {
    ...textVariants.footnote,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  labelActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  underline: {
    height: 2,
    borderRadius: 1,
    alignSelf: 'stretch',
    marginTop: 3,
    opacity: 0,
  },
  underlineActive: {
    backgroundColor: colors.accent,
    opacity: 1,
  },
});

const STYLES = {
  light: makeStyles(lightColors),
  dark: makeStyles(darkColors),
};

export default function TextTabs({ tabs, activeKey, onSelect, scrollable = true }: {
  tabs: { key: string; label: string }[];
  activeKey: string;
  onSelect: (key: string) => void;
  scrollable?: boolean;
}) {
  const { isDark } = useTheme();
  const styles = isDark ? STYLES.dark : STYLES.light;

  const items = tabs.map((t) => {
    const active = t.key === activeKey;
    return (
      <ScalePress key={t.key} style={[styles.item, !scrollable && styles.itemFixed]} onPress={() => onSelect(t.key)}>
        <Text style={[styles.label, active && styles.labelActive]}>{t.label}</Text>
        <View style={[styles.underline, active && styles.underlineActive]} />
      </ScalePress>
    );
  });

  if (scrollable) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
        <View style={styles.scrollContent}>{items}</View>
      </ScrollView>
    );
  }
  return <View style={styles.rowContent}>{items}</View>;
}
