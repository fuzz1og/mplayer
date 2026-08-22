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

export interface ResolvedTheme {
  /** 最终生效的模式（system 会被解析为 light 或 dark） */
  effectiveMode: Exclude<ThemeMode, 'system'>;
  isDark: boolean;
  /** 写 <html data-theme> 的值；'' 表示跟随系统（交给 CSS prefers-color-scheme） */
  dataTheme: '' | 'light' | 'dark';
}

/**
 * 解析生效主题（spec 要求输出 effectiveMode + isDark + dataTheme）：
 * - system：跟随系统偏好，dataTheme 留空（交给 CSS prefers-color-scheme）
 * - light/dark：强制指定并写 data-theme 覆盖
 */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'light') return { effectiveMode: 'light', isDark: false, dataTheme: 'light' };
  if (mode === 'dark') return { effectiveMode: 'dark', isDark: true, dataTheme: 'dark' };
  return { effectiveMode: systemPrefersDark ? 'dark' : 'light', isDark: systemPrefersDark, dataTheme: '' };
}

/** antd 主色（与 global.css --accent 浅/深取值对齐） */
export const ANTD_ACCENT = { light: '#2F5FD0', dark: '#3D7BD9' } as const;
