/**
 * 主题切换平滑过渡背景（M3）：根级共享的 Animated 背景色。
 *
 * 背景：RN 导航容器（expo-router 内部）默认以 React Navigation DefaultTheme
 * 的 background rgb(242,242,242) 绘制各屏 SceneView 容器——屏容器一旦透明，
 * 深色主题下会露出浅色底。因此不做「根 Animated + 全透明」链路，改为：
 * 根级 provider 持有动画插值与过渡逻辑，各 tab 屏根部 Animated.View 应用
 * 同一插值（不透明，盖住 SceneView 浅底，同时随主题 200ms 平滑渐变）。
 *
 * 局限：栈页面（settings 等）自带底色仍瞬切；chrome（TopBar/PlayerBar）
 * 为 bgPlayer 材质随主题瞬切，不参与本过渡。
 */
import React, { createContext, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { Animated } from 'react-native';
import { useTheme } from './ThemeProvider';

type AnimatedBg = Animated.AnimatedInterpolation<string | number>;

const AnimatedBgContext = createContext<AnimatedBg | null>(null);

export function AnimatedBgProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(1)).current;
  const prevBg = useRef(colors.bgBase);

  // useLayoutEffect：绘制前把动画值归零，避免提交帧先闪新色再回旧色渐变
  useLayoutEffect(() => {
    if (prevBg.current === colors.bgBase) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: false }).start();
    prevBg.current = colors.bgBase;
  }, [colors.bgBase, anim]);

  // outputRange 在 colors 变更后的那次渲染捕获 [旧色, 新色]
  const bg = useMemo<AnimatedBg>(
    () => anim.interpolate({
      inputRange: [0, 1],
      outputRange: [prevBg.current, colors.bgBase],
    }),
    [anim, colors.bgBase],
  );

  return <AnimatedBgContext.Provider value={bg}>{children}</AnimatedBgContext.Provider>;
}

export function useAnimatedBg(): AnimatedBg {
  const bg = useContext(AnimatedBgContext);
  if (!bg) throw new Error('useAnimatedBg 必须在 AnimatedBgProvider 内使用');
  return bg;
}
