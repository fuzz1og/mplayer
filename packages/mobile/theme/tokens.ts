/**
 * MPlayer mobile 设计系统 — A×C 视觉方向（深靛蓝 + 暖琥珀；#173 起支持双主题）
 * 使用方式（组件内取色一律走 useTheme，禁止再静态 import colors）：const { colors } = 
 * useTheme();const styles = useMemo(() => makeStyles(colors), [colors]);
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

  /** 经典蓝阶 — 与 desktop `--blue-*` 对齐保留；2026-11-16 起不再是移动端 accent
   *  （改深靛蓝 + 暖琥珀），新代码别再用它当品牌色。 */
  blue50: '#E7EDFB',
  blue100: '#C9D7F4',
  blue300: '#6FA3EF',
  // #318 审计：暗色 accent 用。原 blue400 对最差面 bgElevated(#2C2C2E) 只有 3.34:1；
  // 取「刚好 ≥4.5:1」的最暗档（bgElevated 4.65 / bgSurface 5.68），不整片提亮
  blue350: '#5C96EA',
  blue400: '#3D7BD9',
  blue500: '#2F5FD0',
  blue600: '#264FB8',
  blue700: '#1F4399',

  /** 危险色 */
  red50: '#FEF2F2',
  red400: '#F87171',
  red500: '#EF4444',
  red600: '#DC2626',
  // #318 审计：亮色 dangerText 用。原 red600 对亮色页底(#F2F2F7) 4.33:1 → red650 4.72:1
  red650: '#D31F1F',

  /** 警告色 */
  amber400: '#FBBF24',
  amber500: '#F59E0B',

  /** 成功色（emerald400 供暗底提亮用） */
  emerald400: '#34D399',
  emerald500: '#10B981',

  /** A×C 视觉方向（2026-11-16）：深靛蓝 + 暖琥珀；浅色为暖纸日光版 */
  paper: '#F4F1EA',
  paper100: '#FBF8F2',
  ink900: '#1B1B2A',
  inkInverse: '#2A1B10',
  indigo950: '#0F0F23',
  indigo900: '#1B1B30',
  indigo800: '#242440',
  indigo700: '#2A2A48',
  indigo600: '#32325A',
  signal300: '#FFD9AE',
  signal350: '#FFC98A',
  signal400: '#FFB86B',
  rust600: '#9A3412',
  rust700: '#7C2D12',
  rust800: '#6B2410',
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
 * 音乐源文字变体（ADR-0006 源色纪律）：文字徽章用色必须达 WCAG AA 4.5:1。
 * 圆点徽章仍用 sourceColors（色块无对比度要求）。
 * 键与 sourceColors 完全对齐。
 */
export const sourceTextLight: Record<SourceKey | 'all', string> = {
  all: '#7C3AED',
  netease: '#C0392B',
  qq: '#128A4A',
  kugou: '#C75B00',
  kuwo: '#C75300',
  migu: '#C44B00',
  qianqian: '#0B7AA0',
  soda: '#1565C0',
  local: '#0E8A5F',
};
export const sourceTextDark: Record<SourceKey | 'all', string> = {
  all: '#B79DF5',
  netease: '#F08080',
  qq: '#54D689',
  kugou: '#FFB054',
  kuwo: '#FFA052',
  migu: '#FF8A52',
  qianqian: '#6BC8E8',
  soda: '#7FB3F5',
  local: '#63D9A8',
};

/**
 * 唱机深色点缀 — 全屏播放器「唱机局部深色」的深色基准。
 * 硬件本体双主题共用（唱片机本来就是黑的），不随主题翻转。
 */
export const turntable = {
  plinth: '#1B1B30',
  platter: '#0B0B14',
  platterBorder: '#2A2A50',
  coverBorder: '#15152B',
  tonearm: '#9AA0B5',
  tonearmPivot: '#7C8199',
  tonearmPivotBorder: '#B9BED1',
} as const;

/**
 * 全屏播放器前景色（iOS 全屏惯例：暗背景→亮前景 / 浅背景→深前景）。
 * PlayerOverlay 的 makeFg 以此为单一来源，不散落魔数。
 */
export const playerForeground = {
  dark: {
    primary: '#FFFFFF',
    secondary: 'rgba(255,255,255,0.74)',
    tertiary: 'rgba(255,255,255,0.64)',
    icon: 'rgba(255,255,255,0.88)',
    iconSoft: 'rgba(255,255,255,0.82)',
    badgeBg: 'rgba(255,255,255,0.14)',
    badgeText: 'rgba(255,255,255,0.82)',
    skeleton: 'rgba(255,255,255,0.18)',
    lyricFull: 'rgba(255,255,255,0.72)',
  },
  light: {
    primary: '#16181E',
    secondary: 'rgba(22,24,30,0.78)',
    tertiary: 'rgba(22,24,30,0.62)',
    icon: 'rgba(22,24,30,0.88)',
    iconSoft: 'rgba(22,24,30,0.82)',
    badgeBg: 'rgba(22,24,30,0.08)',
    badgeText: 'rgba(22,24,30,0.82)',
    skeleton: 'rgba(22,24,30,0.12)',
    lyricFull: 'rgba(22,24,30,0.72)',
  },
} as const;
/** 全屏播放器固定渐变背景（双端，方案 C：不随封面防白封面跳变） */
export const playerBackground: Record<'dark' | 'light', [string, string, string]> = {
  dark: ['#20203A', '#15152B', '#0A0A16'],
  light: ['#E8E1D5', '#F1ECE3', '#F7F3EA'],
};

/**
 * 发现页 hero 固定深色遮罩（不随主题）：封面颜色不可控，浅色主题也不能用浅遮罩，
 * 否则白字对比度随机失效；半透明保留封面下缘的氛围光。
 */
export const heroScrim: [string, string, string] = [
  'rgba(8, 8, 20, 0)',
  'rgba(8, 8, 20, 0.58)',
  'rgba(8, 8, 20, 0.88)',
];

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
  /** 底部弹层统一圆角（对齐 iOS sheet 解剖，ADR-0007）；原 xl=20 偏 Android */
  sheet: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

/**
 * 阴影 — 克制的深度（2025 趋势）。
 * desktop 为多层 CSS box-shadow，RN 仅支持单层，按主层近似；iOS 用 shadow*，Android 用 elevation。
 * 与 desktop --shadow-* 对应；深色主题下层级主要靠 surface 与底色的明度差表达，阴影保持克制。
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
 * 归一约定：18→title、10→micro（±1px 级视觉差）。
 * 不套变体的例外：歌词等带 lineHeight 的成对样式、一次性展示字形（如歌手占位字母）。
 */
export const textVariants = {
  /** 页面大标题（字距跟字号走：大字收紧，apple-design §15） */
  largeTitle: { fontSize: 24, fontWeight: '700', letterSpacing: -0.6, lineHeight: 29 },
  /** 全屏播放器歌曲名 */
  titleLg: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, lineHeight: 24 },
  /** 弹层/对话框标题 */
  title: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, lineHeight: 21 },
  /** 区块标题 */
  sectionHeader: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, lineHeight: 22 },
  /** 正文级说明/空态文案 */
  callout: { fontSize: 16, fontWeight: '400', lineHeight: 21 },
  /** 列表主行文字 */
  body: { fontSize: 15, fontWeight: '500', lineHeight: 20 },
  /** 次级行文字/输入框/tab 标签 */
  subhead: { fontSize: 14, fontWeight: '500', lineHeight: 18 },
  /** 辅助说明/meta */
  footnote: { fontSize: 13, fontWeight: '400', lineHeight: 17 },
  /** 副行文字（歌手名/时间） */
  caption: { fontSize: 12, fontWeight: '400', lineHeight: 16 },
  /** 徽章/角标 */
  micro: { fontSize: 10, fontWeight: '600', lineHeight: 13 },
  /** iOS 设置页 Inset Grouped 三档层级（17/15/13，见 docs/specs/2026-08-26-mobile-ios-design-guide.md） */
  settingsPrimary: { fontSize: 17, fontWeight: '400', lineHeight: 22 },
  settingsSecondary: { fontSize: 15, fontWeight: '400', lineHeight: 20 },
  settingsTertiary: { fontSize: 13, fontWeight: '400', lineHeight: 17 },
  /** iOS 设置节标题（配 textTransform: uppercase 使用） */
  settingsHeader: { fontSize: 13, fontWeight: '600', lineHeight: 16 },
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
  /** iOS 分段控件轨道底（rgba(120,120,128) 0.12 浅 / 0.24 深，iOS 13+ 默认） */
  segmentTrack: string;
  /** Android 毛玻璃材质着色补偿层（浅白 0.12 / 深黑 0.18） */
  blurScrim: string;

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
  /** 语义色当文字时的达标变体（ADR-0006 纪律：彩色文字一律走 *Text） */
  warningText: string;
  success: string;
  successText: string;

  /* 音乐源文字徽章用色（ADR-0006；键对齐 sourceColors） */
  sourceText: Record<SourceKey | 'all', string>;

  /* 榜单前三名排名强调色（#186 #8：红/橙/琥珀三档，独立于 danger/warning 语义色避免撞车） */
  rankText: readonly [string, string, string];

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

/**
 * 不透明度语义值（#318 审计）：组件里不再写裸 `0.x`，与主题无关，双端共用。
 * 门禁由 scripts/design-lint.mjs 守着（components/app 内出现 `opacity: 0.x` 即 fail）。
 */
export const opacity = {
  /** 禁用/不可操作内容（歌单重命名按钮等） */
  disabled: 0.4,
  /** 次要的未就绪主操作（「立即更新」按钮禁用态） */
  disabledStrong: 0.55,
  /** 空闲态容器（播放栏无播放内容时整体压暗） */
  idle: 0.6,
  /** 骨架屏 shimmer 扫光条 */
  shimmer: 0.6,
  /** 减弱动效下的按压反馈（替代缩放） */
  pressDim: 0.75,
} as const;

/** 浅色主题（默认，与 desktop 浅色一致） */
export const lightColors: ThemeColors = {
  /* 背景层级：暖纸日光版（A×C，2026-11-16） */
  bgBase: palette.paper,
  bgSurface: '#FFFFFF',
  bgElevated: palette.paper100,
  bgSidebar: '#FFFFFF',
  bgPlayer: 'rgba(255, 255, 255, 0.94)',
  bgHover: '#ECE7DD',
  bgActive: '#E3DDD1',
  bgOverlay: 'rgba(15, 15, 35, 0.42)',
  segmentTrack: 'rgba(27, 27, 42, 0.08)',
  blurScrim: 'rgba(255, 255, 255, 0.15)',

  /* 文字层级：tertiary 只作装饰/提示；有效 meta 用 secondary */
  textPrimary: palette.ink900,
  textSecondary: '#5E6272',
  textTertiary: palette.gray400,
  textDisabled: '#C9C3B8',
  textInverse: '#FFFFFF',
  textLink: palette.rust700,

  /* 边框 */
  borderDefault: 'rgba(27, 27, 42, 0.12)',
  borderSubtle: 'rgba(27, 27, 42, 0.07)',
  borderStrong: 'rgba(27, 27, 42, 0.20)',

  /* 交互色：暖琥珀的浅色版（深锈色保证 4.5:1） */
  accent: palette.rust600,
  accentHover: palette.rust700,
  accentActive: palette.rust800,
  accentSubtle: 'rgba(154, 52, 18, 0.10)',
  accentText: palette.rust700,

  danger: palette.red500,
  dangerHover: palette.red600,
  dangerSubtle: palette.red50,
  dangerText: palette.red650,

  warning: palette.amber500,
  warningSubtle: '#FFFBEB',
  warningText: palette.rust600,
  success: palette.emerald500,
  successText: '#047857',

  /* 音乐源文字徽章（ADR-0006：浅色加深） */
  sourceText: sourceTextLight,

  /* 榜单前三名：暖琥珀色阶 */
  rankText: ['#9A3412', '#A16207', '#8A5A12'] as const,

  /* 输入框 */
  inputBg: '#F7F3EA',
  inputBgFocus: '#FFFFFF',
  inputBorder: 'rgba(27, 27, 42, 0.12)',
  inputBorderFocus: palette.rust600,
  inputPlaceholder: '#6E6E73',

  /* 骨架屏：暖纸底上可见 */
  skeletonBase: '#D8D1C4',
  skeletonShine: '#EDE8DF',
};

/**
 * 深色主题 — 中性色沿用同一 gray 阶反转（iOS 暗色语义面）：
 * 页面底 gray950 → 卡片 gray900 → 悬浮 gray850；文字整体提亮一档保对比。
 * 品牌蓝在暗底用 blue400（accent）/ blue300（accentText），避免发闷。
 */
export const darkColors: ThemeColors = {
  /* 背景层级：深靛蓝夜航（A×C，2026-11-16） */
  bgBase: palette.indigo950,
  bgSurface: palette.indigo900,
  bgElevated: palette.indigo800,
  bgSidebar: palette.indigo900,
  bgPlayer: 'rgba(27, 27, 48, 0.92)',
  bgHover: palette.indigo700,
  bgActive: palette.indigo600,
  bgOverlay: 'rgba(4, 4, 12, 0.62)',
  segmentTrack: 'rgba(255, 255, 255, 0.08)',
  blurScrim: 'rgba(0, 0, 0, 0.10)',

  /* 文字层级 */
  textPrimary: '#F7F8FC',
  textSecondary: '#98A2B8',
  textTertiary: palette.gray500,
  textDisabled: '#5D6178',
  textInverse: palette.inkInverse,
  textLink: palette.signal400,

  /* 边框 */
  borderDefault: 'rgba(255, 255, 255, 0.09)',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',

  /* 交互色：暖琥珀（暗底高对比） */
  accent: palette.signal400,
  accentHover: palette.signal350,
  accentActive: '#F0A85A',
  accentSubtle: 'rgba(255, 184, 107, 0.12)',
  accentText: palette.signal300,

  danger: palette.red400,
  dangerHover: palette.red500,
  dangerSubtle: 'rgba(248, 113, 113, 0.14)',
  dangerText: palette.red400,

  warning: palette.amber400,
  warningSubtle: 'rgba(251, 191, 36, 0.12)',
  warningText: palette.amber400,
  success: palette.emerald400,
  successText: palette.emerald400,

  /* 音乐源文字徽章（ADR-0006：深色提亮） */
  sourceText: sourceTextDark,

  /* 榜单前三名：暖琥珀色阶 */
  rankText: ['#FFB86B', '#E8B27A', '#C9A27A'] as const,

  /* 输入框 */
  inputBg: palette.indigo800,
  inputBgFocus: palette.indigo700,
  inputBorder: 'rgba(255, 255, 255, 0.10)',
  inputBorderFocus: palette.signal400,
  inputPlaceholder: '#A8B0C2',

  /* 骨架屏 */
  skeletonBase: '#2A2A50',
  skeletonShine: '#3A3A70',
};

/** 用户可选主题模式：system 跟随系统（默认），其余手动指定 */
export type ThemeMode = 'system' | 'light' | 'dark';
