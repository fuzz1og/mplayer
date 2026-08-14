/**
 * MPlayer mobile 设计系统 — desktop 同款浅色蓝调 token 体系
 *
 * 与 desktop 的 src/renderer/styles/global.css 两层 token 架构一一对应：
 *   Primitive（palette / spacing / radius / shadow / typography）
 *   Semantic（colors）
 *
 * 命名约定：mobile 用 camelCase，desktop 用 kebab-case（如 bgSurface ↔ --bg-surface）。
 * 完整映射表见同目录 README.md。
 *
 * 使用方式：
 *   import { colors, spacing, radius, typography, sourceColors } from '../theme/tokens';
 */

import type { SourceKey } from '@mplayer/core';

/* ════════════════════════════════════════════════════════════
   Primitive Tokens（基础值）
   ════════════════════════════════════════════════════════════ */

/** 中性色阶 — Apple HIG + Spotify 混合（与 desktop --gray-* 一致） */
export const palette = {
  gray50: '#FAFAFA',
  gray100: '#F5F5F7',
  gray200: '#E8E8ED',
  gray300: '#D1D1D6',
  gray400: '#AEAEB2',
  gray500: '#8E8E93',
  gray600: '#636366',
  gray700: '#48484A',
  gray800: '#3A3A3C',
  gray900: '#1C1C1E',

  /** 品牌色 — 经典蓝（与 desktop --blue-* 一致） */
  blue50: '#E7EDFB',
  blue100: '#C9D7F4',
  blue400: '#3D7BD9',
  blue500: '#2F5FD0',
  blue600: '#264FB8',
  blue700: '#1F4399',

  /** 危险色 */
  red50: '#FEF2F2',
  red400: '#F87171',
  red500: '#EF4444',
  red600: '#DC2626',

  /** 警告色 */
  amber400: '#FBBF24',
  amber500: '#F59E0B',

  /** 成功色 */
  emerald500: '#10B981',
} as const;

/**
 * 音乐源品牌色 — 对齐 desktop TopBar SOURCE_CONFIG 的 accent：
 * 全部 #8B5CF6 / 网易 #E74C3C / QQ #1DB954 / 酷狗 #FF8C00 /
 * 酷我 #FF6F00 / 咪咕 #FF5A00 / 千千 #00A1D6 / 汽水 #1E90FF / 本地 #10B981
 */
export const sourceColors: Record<SourceKey | 'all', string> = {
  all: '#8B5CF6',
  netease: '#E74C3C',
  qq: '#1DB954',
  kugou: '#FF8C00',
  kuwo: '#FF6F00',
  migu: '#FF5A00',
  qianqian: '#00A1D6',
  soda: '#1E90FF',
  local: '#10B981',
};

/**
 * 唱机深色点缀 — 全屏播放器「浅色主体 + 唱机局部深色」的深色基准。
 * 值取自现有 PlayerOverlay 唱机配色，播放器 ticket 可在此基础上微调。
 */
export const turntable = {
  plinth: '#222240',
  platter: '#111111',
  platterBorder: '#333333',
  coverBorder: '#1A1A1A',
  tonearm: '#999999',
  tonearmPivot: '#888888',
  tonearmPivotBorder: '#BBBBBB',
} as const;

/** 间距 — 8px 网格（与 desktop --space-* 一致） */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

/** 圆角 — Apple 形状系统（与 desktop --radius-* 一致） */
export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

/**
 * 阴影 — 克制的深度（2025 趋势）。
 * desktop 为多层 CSS box-shadow，RN 仅支持单层，按主层近似；
 * iOS 用 shadow*，Android 用 elevation。与 desktop --shadow-* 对应。
 */
export const shadow = {
  xs: {
    shadowColor: '#000000',
    shadowOpacity: 0.03,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  sm: {
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  md: {
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  lg: {
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  xl: {
    shadowColor: '#000000',
    shadowOpacity: 0.07,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 20 },
    elevation: 8,
  },
} as const;

/** 字体 — Apple HIG 排版层级（与 desktop --text-* / --weight-* 一致） */
export const typography = {
  sizes: {
    '2xs': 10,
    xs: 11,
    sm: 13,
    base: 15,
    lg: 17,
    xl: 20,
    '2xl': 24,
    '3xl': 28,
  },
  weights: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  /** 行高为倍数，RN 需要绝对像素时用 fontSize * 倍数 */
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.625,
  },
} as const;

/* ════════════════════════════════════════════════════════════
   Semantic Tokens（语义映射）
   ════════════════════════════════════════════════════════════ */

export const colors = {
  /* 背景层级 */
  bgBase: palette.gray50,
  bgSurface: '#FFFFFF',
  bgElevated: '#FFFFFF',
  bgSidebar: '#FFFFFF',
  bgPlayer: 'rgba(255, 255, 255, 0.85)',
  bgHover: palette.gray100,
  bgActive: palette.gray200,
  bgOverlay: 'rgba(0, 0, 0, 0.4)',

  /* 文字层级 */
  textPrimary: palette.gray900,
  textSecondary: palette.gray600,
  textTertiary: palette.gray400,
  textDisabled: palette.gray300,
  textInverse: '#FFFFFF',
  textLink: palette.blue600,

  /* 边框 */
  borderDefault: palette.gray200,
  borderSubtle: palette.gray100,
  borderStrong: palette.gray300,

  /* 交互色 */
  accent: palette.blue500,
  accentHover: palette.blue600,
  accentActive: palette.blue700,
  accentSubtle: palette.blue50,
  accentText: palette.blue600,

  danger: palette.red500,
  dangerHover: palette.red600,
  dangerSubtle: palette.red50,
  dangerText: palette.red600,

  warning: palette.amber500,
  warningSubtle: '#FFFBEB',
  success: palette.emerald500,

  /* 输入框 */
  inputBg: palette.gray50,
  inputBgFocus: '#FFFFFF',
  inputBorder: palette.gray200,
  inputBorderFocus: palette.blue500,
  inputPlaceholder: palette.gray400,

  /* 骨架屏 */
  skeletonBase: palette.gray100,
  skeletonShine: palette.gray200,
} as const;

/** 浅色主题下的系统状态栏文字色（深色文字配浅色背景） */
export const statusBarStyle: 'light' | 'dark' = 'dark';
