/**
 * MPlayer mobile 设计系统 — desktop 同款浅色蓝调 token 体系（#173 起支持深色）
 *
 * 与 desktop 的 src/renderer/styles/global.css 两层 token 架构一一对应：
 *   Primitive（palette / spacing / radius / shadow / typography）
 *   Semantic（lightColors / darkColors 双套，运行时经 ThemeProvider 注入）
 *
 * 命名约定：mobile 用 camelCase，desktop 用 kebab-case（如 bgSurface ↔ --bg-surface）。
 * 完整映射表见同目录 README.md。
 *
 * 使用方式（组件内取色一律走 useTheme，禁止再静态 import colors）：
 *   const { colors } = useTheme();
 *   const styles = useMemo(() => makeStyles(colors), [colors]);
 */

import type { SourceKey } from '@mplayer/core';

/* ════════════════════════════════════════════════════════════
   Primitive Tokens（基础值）
   ════════════════════════════════════════════════════════════ */

/** 中性色阶 — Apple HIG + Spotify 混合（与 desktop --gray-* 一致）；
 *  750/825/850/950 为深色主题专用表面阶（对应 iOS 暗色语义面与页面底） */
export const palette = {
  gray50: '#FAFAFA',
  gray100: '#F5F5F7',
  gray200: '#E8E8ED',
  gray300: '#D1D1D6',
  gray400: '#AEAEB2',
  gray500: '#8E8E93',
  gray600: '#636366',
  gray700: '#48484A',
  gray750: '#38383A',
  gray800: '#3A3A3C',
  gray825: '#2A2A2C',
  gray850: '#2C2C2E',
  gray900: '#1C1C1E',
  gray950: '#121214',

  /** 品牌色 — 经典蓝（与 desktop --blue-* 一致）；blue300 供暗底提亮用 */
  blue50: '#E7EDFB',
  blue100: '#C9D7F4',
  blue300: '#6FA3EF',
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

  /** 成功色（emerald400 供暗底提亮用） */
  emerald400: '#34D399',
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
 * 唱机深色点缀 — 全屏播放器「唱机局部深色」的深色基准。
 * 硬件本体双主题共用（唱片机本来就是黑的），不随主题翻转。
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
 * iOS 用 shadow*，Android 用 elevation。与 desktop --shadow-* 对应；
 * 深色主题下层级主要靠 surface 与底色的明度差表达，阴影保持克制。
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

/**
 * 文字语义变体（#175）：role → 预设 TextStyle，消灭散落各屏的字号魔法数。
 *
 * 用法（在 makeStyles 工厂里展开，weight 特例展开后覆盖）：
 *   name: { ...textVariants.body, color: colors.textPrimary },
 *   playAllText: { ...textVariants.caption, fontWeight: '600', color: ... },
 *
 * 归一约定：18→title、10→micro（±1px 级视觉差）。
 * 不套变体的例外：歌词等带 lineHeight 的成对样式、一次性展示字形（如歌手占位字母）。
 */
export const textVariants = {
  /** 页面大标题（字距跟字号走：大字收紧，apple-design §15） */
  largeTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  /** 全屏播放器歌曲名 */
  titleLg: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  /** 弹层/对话框标题 */
  title: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  /** 区块标题 */
  sectionHeader: { fontSize: 16, fontWeight: '700' },
  /** 正文级说明/空态文案 */
  callout: { fontSize: 16, fontWeight: '400' },
  /** 列表主行文字 */
  body: { fontSize: 15, fontWeight: '500' },
  /** 次级行文字/输入框/tab 标签 */
  subhead: { fontSize: 14, fontWeight: '500' },
  /** 辅助说明/meta */
  footnote: { fontSize: 13, fontWeight: '400' },
  /** 副行文字（歌手名/时间） */
  caption: { fontSize: 12, fontWeight: '400' },
  /** 徽章/角标 */
  micro: { fontSize: 11, fontWeight: '600' },
} as const;

export type TextVariant = keyof typeof textVariants;

/* ════════════════════════════════════════════════════════════
   Semantic Tokens（语义映射，双主题）
   ════════════════════════════════════════════════════════════ */

/**
 * 语义色结构契约：显式接口而非 typeof 推导——palette 是 as const，
 * typeof 会把引用字段捕获成字面量类型，导致另一套配色赋值失败；
 * 显式接口同时约束两套配色的键完整与拼写。
 */
export interface ThemeColors {
  /* 背景层级 */
  bgBase: string;
  bgSurface: string;
  bgElevated: string;
  bgSidebar: string;
  bgPlayer: string;
  bgHover: string;
  bgActive: string;
  bgOverlay: string;

  /* 文字层级 */
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  textInverse: string;
  textLink: string;

  /* 边框 */
  borderDefault: string;
  borderSubtle: string;
  borderStrong: string;

  /* 交互色 */
  accent: string;
  accentHover: string;
  accentActive: string;
  accentSubtle: string;
  accentText: string;

  danger: string;
  dangerHover: string;
  dangerSubtle: string;
  dangerText: string;

  warning: string;
  warningSubtle: string;
  success: string;

  /* 输入框 */
  inputBg: string;
  inputBgFocus: string;
  inputBorder: string;
  inputBorderFocus: string;
  inputPlaceholder: string;

  /* 骨架屏 */
  skeletonBase: string;
  skeletonShine: string;
}

/** 浅色主题（默认，与 desktop 浅色一致） */
export const lightColors: ThemeColors = {
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
};

/**
 * 深色主题 — 中性色沿用同一 gray 阶反转（iOS 暗色语义面）：
 * 页面底 gray950 → 卡片 gray900 → 悬浮 gray850；文字整体提亮一档保对比。
 * 品牌蓝在暗底用 blue400（accent）/ blue300（accentText），避免发闷。
 */
export const darkColors: ThemeColors = {
  /* 背景层级 */
  bgBase: palette.gray950,
  bgSurface: palette.gray900,
  bgElevated: palette.gray850,
  bgSidebar: palette.gray900,
  bgPlayer: 'rgba(28, 28, 30, 0.85)',
  bgHover: palette.gray825,
  bgActive: palette.gray750,
  bgOverlay: 'rgba(0, 0, 0, 0.6)',

  /* 文字层级 */
  textPrimary: palette.gray50,
  textSecondary: palette.gray400,
  textTertiary: palette.gray500,
  textDisabled: palette.gray700,
  textInverse: palette.gray900,
  textLink: palette.blue300,

  /* 边框 */
  borderDefault: palette.gray750,
  borderSubtle: palette.gray850,
  borderStrong: palette.gray700,

  /* 交互色 */
  accent: palette.blue400,
  accentHover: palette.blue300,
  accentActive: palette.blue500,
  accentSubtle: 'rgba(61, 123, 217, 0.18)',
  accentText: palette.blue300,

  danger: palette.red400,
  dangerHover: palette.red500,
  dangerSubtle: 'rgba(248, 113, 113, 0.14)',
  dangerText: palette.red400,

  warning: palette.amber400,
  warningSubtle: 'rgba(251, 191, 36, 0.12)',
  success: palette.emerald400,

  /* 输入框 */
  inputBg: palette.gray825,
  inputBgFocus: palette.gray850,
  inputBorder: palette.gray750,
  inputBorderFocus: palette.blue400,
  inputPlaceholder: palette.gray600,

  /* 骨架屏 */
  skeletonBase: palette.gray825,
  skeletonShine: palette.gray750,
};

/** 用户可选主题模式：system 跟随系统（默认），其余手动指定 */
export type ThemeMode = 'system' | 'light' | 'dark';
