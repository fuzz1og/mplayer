import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { IpcClient } from '@/renderer/services/IpcClient';
import { isThemeMode, resolveTheme, type ThemeMode } from './theme';

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  isDark: false,
  setMode: () => {},
});

export const useThemeMode = (): ThemeContextValue => useContext(ThemeContext);

const getSystemDark = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;

/**
 * 应用主题根组件：启动读持久化模式（默认跟随系统）、跟随系统深浅色、写 html[data-theme] 驱动
 * global.css 的深浅 token。1.9.0 起不再包 ConfigProvider——antd 已移除，主题只有一套语义 token。
 */
export const ThemeManager: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [systemDark, setSystemDark] = useState(getSystemDark);

  useEffect(() => {
    let cancelled = false;
    void IpcClient.invoke<string>('settings:getThemeMode')
      .then((saved) => {
        if (!cancelled && isThemeMode(saved)) setModeState(saved);
      })
      .catch(() => {});
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => {
      cancelled = true;
      mq.removeEventListener('change', onChange);
    };
  }, []);

  const { isDark, dataTheme } = useMemo(() => resolveTheme(mode, systemDark), [mode, systemDark]);

  useEffect(() => {
    const root = document.documentElement;
    if (dataTheme) root.dataset.theme = dataTheme;
    else delete root.dataset.theme;
  }, [dataTheme]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void IpcClient.invoke<string>('settings:setThemeMode', next).catch(() => {});
  }, []);

  const value = useMemo(() => ({ mode, isDark, setMode }), [mode, isDark, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
