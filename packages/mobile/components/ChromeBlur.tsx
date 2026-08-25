import { View, Platform, AccessibilityInfo, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * 悬浮 chrome 毛玻璃容器（ADR-0005 / issue #186 N1）：
 * - iOS：BlurView（浅色 systemThinMaterialLight / 深色 systemThinMaterialDark）
 * - Android 原生：BlurView 开启 dimezisBlurView（Expo SDK 57 支持真 blur）
 * - 系统「减弱透明度」开启 / Android Expo Go（无真 blur）：回退纯半透明底（等原 bgPlayer）
 */
export default function ChromeBlur({ style, children }: Props) {
  const { colors, isDark } = useTheme();
  const reduceTransparency = AccessibilityInfo.isReduceTransparencyEnabled
    ? AccessibilityInfo.isReduceTransparencyEnabled()
    : false;

  // Android Expo Go 无法真 blur：直接用半透明底（保持布局与降级观感一致）
  if (Platform.OS === 'android' && !reduceTransparency) {
    return (
      <View style={[{ backgroundColor: colors.bgPlayer }, style]}>{children}</View>
    );
  }

  if (reduceTransparency || Platform.OS === 'web') {
    return (
      <View style={[{ backgroundColor: colors.bgPlayer }, style]}>{children}</View>
    );
  }

  return (
    <BlurView
      intensity={90}
      tint={isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
      style={style}
    >
      {children}
    </BlurView>
  );
}
