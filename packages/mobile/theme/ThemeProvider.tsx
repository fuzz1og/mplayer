/**
 * 主题上下文（#173）：把 lightColors / darkColors 按用户设置注入组件树。
 *
 * themeMode 存 settingsStore（AsyncStorage 持久化）；system 跟随系统深浅色。
 * 组件内用法：
 *   const { colors, isDark } = useTheme();
 *   const styles = useMemo(() => makeStyles(colors), [colors]);
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useSettingsStore } from '../stores/settingsStore';
import { darkColors, lightColors } from './tokens';
import type { ThemeMode, ThemeColors } from './tokens';

interface ThemeValue {
  colors: ThemeColors;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeValue>({ colors: lightColors, isDark: false });

/** 解析最终主题：system 跟随系统，否则手动指定（独立导出便于测试） */
export function resolveIsDark(themeMode: ThemeMode, systemScheme: string | null | undefined): boolean {
  if (themeMode === 'system') return systemScheme === 'dark';
  return themeMode === 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const systemScheme = useColorScheme();
  const isDark = resolveIsDark(themeMode, systemScheme);
  const value = useMemo<ThemeValue>(
    () => ({ colors: isDark ? darkColors : lightColors, isDark }),
    [isDark],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
