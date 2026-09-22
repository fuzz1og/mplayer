import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * 悬浮 chrome 表面（TopBar / 底部 tab 栏 + 迷你播放栏 / 全屏播放页顶栏）。
 *
 * 历史：这里曾是 expo-blur 的毛玻璃（ADR-0005 / ADR-0010）。Android 上它依赖
 * `BlurTargetView` + `blurTarget` 的实时背景采样，在**栈页**（react-native-screens
 * 的 Screen 子树内）原生始终采不到内容，表现为「一片平的半透明」；为它维护
 * 每页 target 与兄弟层级成本高、双端还不一致。
 *
 * 现改为与全屏播放页背景同语言的**主题纯色 + 线性渐变**：双端一致、无原生依赖、
 * 不随背后滚动内容重采样（因此也没有「模糊快照不同步」这类问题）。
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
