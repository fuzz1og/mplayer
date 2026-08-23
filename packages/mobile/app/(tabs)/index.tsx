import { useMemo } from 'react';
import { StyleSheet, Animated } from 'react-native';
import DiscoverTabs from '../../components/DiscoverTabs';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useAnimatedBg } from '../../theme/AnimatedBg';

export default function DiscoverPage() {
  const { colors } = useTheme();
  const animatedBg = useAnimatedBg();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Animated.View style={[styles.container, { backgroundColor: animatedBg }]}>
      <DiscoverTabs />
    </Animated.View>
  );
}

const makeStyles = (_colors: ThemeColors) => StyleSheet.create({
  // 主题切换平滑过渡（M3）：根部应用共享 Animated 背景色
  container: { flex: 1 },
});
