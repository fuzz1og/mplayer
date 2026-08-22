/**
 * 桌面端主题三态解析（纯逻辑，可单测）。
 * 深浅色 token 在 global.css：跟随系统走 prefers-color-scheme，
 * 手动指定写 html[data-theme='light'|'dark'] 覆盖。
 */
export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

export const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'system' || value === 'light' || value === 'dark';

/**
 * 解析生效主题：
 * - system：跟随系统偏好，dataTheme 留空（交给 CSS prefers-color-scheme）
 * - light/dark：强制指定并写 data-theme 覆盖
 */
export function resolveTheme(
  mode: ThemeMode,
  systemPrefersDark: boolean
): { isDark: boolean; dataTheme: '' | 'light' | 'dark' } {
  if (mode === 'light') return { isDark: false, dataTheme: 'light' };
  if (mode === 'dark') return { isDark: true, dataTheme: 'dark' };
  return { isDark: systemPrefersDark, dataTheme: '' };
}

/** antd 主色（与 global.css --accent 浅/深取值对齐） */
export const ANTD_ACCENT = { light: '#2F5FD0', dark: '#3D7BD9' } as const;
