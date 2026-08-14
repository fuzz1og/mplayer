# Mobile 主题 token（wayfinder #108 资产）

Mobile 浅色主题重构（[wayfinder map #108](https://github.com/fuzz1og/mplayer/issues/108)）的地基：`tokens.ts` 把 desktop 的设计系统（`src/renderer/styles/global.css`）移植为 React Native 可用的常量模块。

## 使用

```ts
import { colors, spacing, radius, shadow, typography, sourceColors, turntable } from '../theme/tokens';
```

- 所有新代码与后续重构 ticket 一律引用 token，禁止硬编码色值。
- 语义色优先（`colors.bgSurface`），基础色次之（`palette.gray100`），仅在语义表达不清时直接用 palette。
- 阴影用 `shadow.sm` 这类 RN 对象（iOS `shadow*` + Android `elevation`），直接展开到 style。
- 行高用 `typography.lineHeights.normal` 等倍数，RN 需要像素时 `fontSize * lineHeight`。

## desktop CSS 变量 ↔ mobile token 映射

| desktop（global.css） | mobile（tokens.ts） | 值 |
|---|---|---|
| `--gray-50 ~ 900` | `palette.gray50 ~ gray900` | `#FAFAFA` … `#1C1C1E` |
| `--blue-50/100/400~700` | `palette.blue50 … blue700` | `#E7EDFB` … `#1F4399` |
| `--red-50/400/500/600` | `palette.red50 … red600` | `#FEF2F2` … `#DC2626` |
| `--amber-400/500` | `palette.amber400/500` | `#FBBF24` / `#F59E0B` |
| `--emerald-500` | `palette.emerald500` | `#10B981` |
| `--space-0/1/2/3/4/5/6/8/10/12` | `spacing[0] … spacing[12]` | 8px 网格 |
| `--radius-xs/sm/md/lg/xl/full` | `radius.xs … radius.full` | 4/6/10/16/20/9999 |
| `--shadow-xs … xl` | `shadow.xs … shadow.xl` | RN 单层近似 |
| `--text-2xs … 3xl` | `typography.sizes['2xs'] … ['3xl']` | 10 … 28 |
| `--weight-*` | `typography.weights.*` | 400/500/600/700 |
| `--bg-base/surface/elevated/sidebar/player` | `colors.bgBase/bgSurface/bgElevated/bgSidebar/bgPlayer` | 浅色层级 |
| `--bg-hover/active/overlay` | `colors.bgHover/bgActive/bgOverlay` | `#F5F5F7` / `#E8E8ED` / `rgba(0,0,0,.4)` |
| `--text-primary/secondary/tertiary/disabled/inverse/link` | `colors.textPrimary … textLink` | gray900/600/400/300/白/blue600 |
| `--border-default/subtle/strong` | `colors.borderDefault/borderSubtle/borderStrong` | gray200/100/300 |
| `--accent/-hover/-active/-subtle/-text` | `colors.accent … accentText` | blue500/600/700/50/600 |
| `--danger* / --warning* / --success` | `colors.danger* / warning* / success` | 红/琥珀/翠绿 |
| `--input-*` | `colors.inputBg … inputPlaceholder` | 输入框状态 |
| `--skeleton-base/shine` | `colors.skeletonBase/skeletonShine` | gray100/200 |
| `SOURCE_CONFIG accent` | `sourceColors` | 见下 |

## 音乐源配色（对齐 desktop TopBar）

| 源 | 旧值（mobile） | 新值（sourceColors，desktop 同款） |
|---|---|---|
| all | — | `#8B5CF6` |
| netease | `#e74c3c` | `#E74C3C`（不变） |
| qq | `#3498db` | `#1DB954` |
| kugou | `#9b59b6` | `#FF8C00` |
| kuwo | `#1abc9c` | `#FF6F00` |
| qianqian | `#95a5a6` | `#00A1D6` |
| soda | `#2ecc71` | `#1E90FF` |
| local | `#7f8c8d` | `#10B981` |

旧值分布在 `components/SongRow.tsx` 的 `SOURCE_COLORS` 与 `components/SourceSwapModal.tsx` 的源数组，重构时直接换 `sourceColors[sourceType]`。

## 旧深色值 → 新 token 对照（重构 ticket 直接查）

以下为重构前全部硬编码色的语义去向（浅色主题下）：

| 旧值 | 用途 | 新 token |
|---|---|---|
| `#1a1a2e` | 页面/弹层背景 | `colors.bgBase` |
| `#16213e` | 卡片/Sheet/播放条背景 | `colors.bgSurface` |
| `#2a2a4a` | 输入框/胶囊/悬停底 | `colors.bgHover`（输入框用 `colors.inputBg`） |
| `#3a3a5e` | 次级胶囊/来源按钮底 | `colors.bgActive` |
| `#e74c3c` | 全局红色 accent | 网易源色 `sourceColors.netease`；通用 active 态用 `colors.accent` |
| `#fff` | 深色底上的文字/图标 | 浅色下反转为 `colors.textPrimary`（按钮上保留 `colors.textInverse`） |
| `#888` | 次级文字 | `colors.textSecondary` |
| `#666` | 三级文字/占位 | `colors.textTertiary`（占位符用 `colors.inputPlaceholder`） |
| `#555` / `#aaa` / `#bbb` / `#ccc` | 弱化文字/图标 | `colors.textDisabled`（按对比度需要可回落 gray400/500） |
| `#27ae60` | 成功/完整版标记 | `colors.success` |
| `#c0392b` | 危险/删除 | `colors.danger`（hover 级用 `colors.dangerHover`） |
| `#e67e22` | 「短时长」警告 | `colors.warning` |
| `rgba(0,0,0,0.5)` / `(0,0,0,0.6)` | Modal 遮罩 | `colors.bgOverlay`（深浅按上下文微调） |
| `rgba(231,76,60,0.08)` | 选中行底色 | `colors.accentSubtle` |
| `rgba(20,20,40,0.95)` | Toast 深色底 | 浅色 Toast：`colors.bgSurface` + 边框 `colors.borderDefault`/`colors.danger` |
| `#222240`/`#111`/`#333`/`#1a1a1a`/`#999`/`#888`/`#bbb` | 唱机深色点缀 | `turntable.*`（播放器 ticket 可微调） |

## 全局适配要点（供「导航骨架」ticket）

- 状态栏文字：`statusBarStyle = 'dark'`（浅色底深色字），替换现有 `StatusBar style="light"`。
- 根布局背景、安全区底色统一 `colors.bgBase` / `colors.bgSurface`，保证 Android 15 edge-to-edge 下无白条/黑条。
- 播放错误 Toast 由深色底改为浅色底（见上表）。
