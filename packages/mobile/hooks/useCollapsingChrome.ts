/**
 * 折叠头部的滚动联动驱动 —— 滚动 → chrome 映射全部交给 RN 原生驱动。
 *
 * 旧实现（CollapsingHero 内联）：onScroll + useNativeDriver:false，每帧在 JS 里
 * 结算导航条背景色 / 标题透明度 / 返回图标颜色三个插值；另有一个
 * scrollY.addListener 每帧 setStatusStyle。现在：
 *   - 视觉插值走 Animated.event({useNativeDriver:true})，滚动帧内不经过 JS；
 *   - JS 侧只剩状态栏 light/dark 的阈值**边沿**判定（纯函数见 components/collapsingChrome.ts），
 *     同侧连续帧只有一次比较、不 setState。
 *
 * 两个前提（都已按 RN 0.86 源码核对）：
 *   1. 颜色插值可以走原生驱动：NativeAnimatedAllowlist 的 SUPPORTED_COLOR_STYLES
 *      含 backgroundColor/color，三套原生实现都支持 outputType:'color'
 *      （C++/Android Kotlin/iOS ObjC）。所以背景色插值原样保留，观感与旧实现逐值相同。
 *   2. FlatList 必须换成 Animated.FlatList：VirtualizedList 明确要求
 *      native onScroll 的宿主组件由 Animated.createAnimatedComponent 包一层。
 *
 * 注意：JS 仍会收到原始滚动事件（ScrollView 的 onScroll 就是这个 handler），
 * 这是 RN 的机制；本模块保证它只做一次边沿比较，不做插值与 setState。
 */

import { useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  chromeRanges,
  collapsingChrome,
  createStatusBarEdge,
} from '../components/collapsingChrome';
import type { CollapsingChrome, StatusBarStyle } from '../components/collapsingChrome';
import { useTheme } from '../theme/ThemeProvider';

export interface CollapsingChromeDriver {
  /** 阈值常量（由 insets.top 推导，见 components/collapsingChrome.ts） */
  chrome: CollapsingChrome;
  /** 列表 onScroll：原生驱动 scrollY；JS 侧只做状态栏阈值边沿 */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** 导航条背景（透明 → bgSurface）：原生驱动的颜色插值 */
  navBg: Animated.AnimatedInterpolation<string | number>;
  /** 标题淡入 / 返回图标换色进度 0 → 1：原生驱动 */
  fade: Animated.AnimatedInterpolation<string | number>;
  /** 状态栏 light/dark：阈值边沿值（不是逐帧值） */
  statusStyle: StatusBarStyle;
}

/** 折叠头部 chrome 的滚动驱动：阈值、原生插值与状态栏边沿 */
export function useCollapsingChrome(): CollapsingChromeDriver {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const chrome = useMemo(() => collapsingChrome(insets.top), [insets.top]);
  const ranges = useMemo(() => chromeRanges(chrome), [chrome]);
  const scrollY = useRef(new Animated.Value(0)).current;
  const [statusStyle, setStatusStyle] = useState<StatusBarStyle>('light');

  // 边沿判定器只建一次（setState 稳定）：闩锁跨 insets 变化继续有效，
  // 不会因插值区间重建而重复上报。
  const edgeRef = useRef<((scrollY: number, chrome: CollapsingChrome) => void) | null>(null);
  if (edgeRef.current === null) edgeRef.current = createStatusBarEdge(setStatusStyle);

  const onScroll = useMemo(
    () =>
      Animated.event<NativeScrollEvent>([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (e) => edgeRef.current?.(e.nativeEvent.contentOffset.y, chrome),
      }),
    [chrome, scrollY],
  );

  const navBg = useMemo(
    () =>
      scrollY.interpolate({
        inputRange: [...ranges.solid],
        // 起点留半透明白：封面上的导航条由「透明」渐入，「白洗」是既有观感（勿改成纯 opacity 层）
        outputRange: ['rgba(255,255,255,0)', colors.bgSurface],
        extrapolate: 'clamp',
      }),
    [colors.bgSurface, ranges, scrollY],
  );

  const fade = useMemo(
    () =>
      scrollY.interpolate({
        inputRange: [...ranges.fade],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
    [ranges, scrollY],
  );

  return { chrome, onScroll, navBg, fade, statusStyle };
}
