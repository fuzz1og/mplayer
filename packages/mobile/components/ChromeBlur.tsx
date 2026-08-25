import { createRef } from 'react';
import { View, Platform, type View as RNView, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme/ThemeProvider';
import { useReducedTransparency } from '../hooks/useReducedTransparency';

interface Props {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * 页面级模糊目标（ADR-0010）：tabs 布局把内容区包进 BlurTargetView，
 * ChromeBlur 的 BlurView 在 Android 上通过 blurTarget 指向它实现「模糊背后内容」。
 * 全局单例 ref（移动端单实例），多个 BlurView（TopBar/PlayerBar/PlayerOverlay）共享。
 */
export const chromeBlurTargetRef = createRef<RNView>();

/**
 * 悬浮 chrome 毛玻璃容器（ADR-0005 / ADR-0010）：
 * - iOS：BlurView 模糊背后内容（传统行为，无需 blurTarget）
 * - Android：必须 blurTarget 指向页面 BlurTargetView（expo-blur 57 新 API，
 *   无 target 原生侧静默回退 none，ADR-0010 实锤）
 * - 系统「减弱透明度」开启 / web / Android 且内容区 target 未挂载：回退纯半透明底
 */
export default function ChromeBlur({ style, children }: Props) {
  const { colors, isDark } = useTheme();
  // 真机反馈根因：isReduceTransparencyEnabled 是异步 API，render 期同步调用拿到
  // Promise（恒 truthy）→ 恒走降级分支、BlurView 从未挂载。必须用 hook 异步消费。
  const reduceTransparency = useReducedTransparency();

  if (reduceTransparency || Platform.OS === 'web') {
    return (
      <View style={[{ backgroundColor: colors.bgPlayer }, style]}>{children}</View>
    );
  }

  // 注意：不能在这里用 `chromeBlurTargetRef.current == null` 做 render 期降级——
  // ref 在 React commit 阶段才挂到 BlurTargetView 宿主节点，render 期恒为 null，
  // 会导致 ChromeBlur 永远渲染半透明降级、BlurView 从不挂载。BlurTargetView 在
  // Tabs 布局中排在 TopBar/PlayerBar 之前渲染，BlurView 的 componentDidMount
  // 读取 blurTarget.current 时 ref 已就绪；target 缺失时原生侧自动回退 none。
  return (
    <BlurView
      intensity={90}
      tint={isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
      blurTarget={Platform.OS === 'android' ? chromeBlurTargetRef : undefined}
      blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
      style={style}
    >
      {children}
    </BlurView>
  );
}
