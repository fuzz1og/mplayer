import type { ThemeMode } from './theme';

/**
 * 外观偏好走 localStorage（仅渲染层），以 html[data-*] 生效；Token 覆盖在 global.css。
 * 主题仍以主进程 db（ThemeManager）为事实源，这里只镜像 theme 字段。
 */
export const APPEARANCE_STORAGE_KEY = 'mplayer.appearance';

export type Density = 'standard' | 'compact';
export type Material = 'on' | 'off';
export type FontScale = 'small' | 'standard' | 'large';
export type Motion = 'on' | 'off';
export type LyricsSize = 'standard' | 'large';

export interface AppearancePrefs {
  density: Density;
  material: Material;
  fontScale: FontScale;
  reduceMotion: Motion;
  lyricsSize: LyricsSize;
  /** ThemeManager 的只读镜像（true source = 主进程 db 的 themeMode）。 */
  theme?: ThemeMode;
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  density: 'standard',
  material: 'on',
  fontScale: 'standard',
  reduceMotion: 'off',
  lyricsSize: 'standard',
};

const DENSITIES: Density[] = ['standard', 'compact'];
const MATERIALS: Material[] = ['on', 'off'];
const FONT_SCALES: FontScale[] = ['small', 'standard', 'large'];
const MOTIONS: Motion[] = ['on', 'off'];
const LYRICS_SIZES: LyricsSize[] = ['standard', 'large'];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const listeners = new Set<(prefs: AppearancePrefs) => void>();

export function readPrefs(): AppearancePrefs {
  let raw: Record<string, unknown> = {};
  try {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (stored) raw = JSON.parse(stored) as Record<string, unknown>;
  } catch {
    // 坏数据按默认值重来，不阻塞渲染
  }
  return {
    density: pick(raw.density, DENSITIES, DEFAULT_APPEARANCE.density),
    material: pick(raw.material, MATERIALS, DEFAULT_APPEARANCE.material),
    fontScale: pick(raw.fontScale, FONT_SCALES, DEFAULT_APPEARANCE.fontScale),
    reduceMotion: pick(raw.reduceMotion, MOTIONS, DEFAULT_APPEARANCE.reduceMotion),
    lyricsSize: pick(raw.lyricsSize, LYRICS_SIZES, DEFAULT_APPEARANCE.lyricsSize),
    theme: raw.theme === 'system' || raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : undefined,
  };
}

/** 写 html[data-*]：五项总是写（含默认值），global.css 只需覆盖非默认分支。 */
export function applyAppearance(prefs: AppearancePrefs): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.dataset;
  root.density = prefs.density;
  root.material = prefs.material;
  root.fontScale = prefs.fontScale;
  root.reduceMotion = prefs.reduceMotion;
  root.lyricsSize = prefs.lyricsSize;
}

export function writePrefs(patch: Partial<AppearancePrefs>): AppearancePrefs {
  const next: AppearancePrefs = { ...readPrefs(), ...patch };
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式/配额失败：内存里仍然生效，仅不持久化
  }
  applyAppearance(next);
  for (const listener of listeners) listener(next);
  return next;
}

/** ThemeManager 的 db 值镜像入口（不进 data 属性，主题由 data-theme 走 ThemeManager）。 */
export function mirrorTheme(theme: ThemeMode): void {
  writePrefs({ theme });
}

export function subscribeAppearance(listener: (prefs: AppearancePrefs) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 应用入口调用：装载存档并落到 documentElement（模块导入时也会执行一次，双保险）。 */
export function initAppearancePrefs(): AppearancePrefs {
  const prefs = readPrefs();
  applyAppearance(prefs);
  return prefs;
}

initAppearancePrefs();
