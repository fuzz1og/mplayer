import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * 悬浮 chrome 表面（TopBar / 底部 tab 栏 + 迷你播放栏 / 全屏播放页顶栏）。
 * 历史：这里曾是 expo-blur 的毛玻璃（ADR-0005 / ADR-0010）。
 */
export default function ChromeSurface({ style, children }: Props) {
  const { colors } = useTheme();
  return (
    <LinearGradient
      // 上浅下深：顶部略透出内容，贴底边收成实色，保证 tab 文案 / 播放栏对比度
      colors={[colors.bgPlayer, colors.bgSurface]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
