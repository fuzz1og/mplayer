import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { IpcClient } from '@/renderer/services/IpcClient';
import { ANTD_ACCENT, isThemeMode, resolveTheme, type ThemeMode } from './theme';

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
 * 应用主题根组件（挂载在 App 根部，取代 main.tsx 里的 ConfigProvider）：
 * - 启动读取持久化的主题模式（默认跟随系统）
 * - 监听系统深浅色变化（system 模式下实时跟随）
 * - 写 html[data-theme] 驱动 global.css 深浅 token
 * - 按生效主题切换 antd darkAlgorithm / defaultAlgorithm
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

  return (
    <ThemeContext.Provider value={{ mode, isDark, setMode }}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: { colorPrimary: isDark ? ANTD_ACCENT.dark : ANTD_ACCENT.light },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
};
