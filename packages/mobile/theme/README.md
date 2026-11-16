# Mobile 主题 token（wayfinder #108 资产，#173 起双主题）

Mobile 主题重构（[wayfinder map #108](https://github.com/fuzz1og/mplayer/issues/108)）的地基：`tokens.ts` 把 desktop 的设计系统（`src/renderer/styles/global.css`）移植为 React Native 可用的常量模块。[issue #173](https://github.com/fuzz1og/mplayer/issues/173) 起语义层拆为 `lightColors` / `darkColors` 双套，运行时经 `ThemeProvider` 注入。

## 使用（组件内取色一律走 useTheme）

```tsx
import { spacing, radius, shadow, typography, sourceColors, turntable } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

function Foo() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]); // makeStyles 定义在文件底部
}
```

- **禁止**在组件里静态 `import { colors }`——`tokens.ts` 已不再导出单例 `colors`/`statusBarStyle`。
- 所有新代码与后续重构 ticket 一律引用 token，禁止硬编码色值。
- 语义色优先（`colors.bgSurface`），基础色次之（`palette.gray100`），仅在语义表达不清时直接用 palette。
- 阴影用 `shadow.sm` 这类 RN 对象（iOS `shadow*` + Android `elevation`），直接展开到 style。
- 行高用 `typography.lineHeights.normal` 等倍数，RN 需要像素时 `fontSize * lineHeight`。
- 状态栏图标色：浅色主题 `'dark'`、深色主题 `'light'`，即 `style={isDark ? 'light' : 'dark'}`。
- 多子组件共享一套大样式表的例外模式：模块级预构建两份（参考 `components/DiscoverTabs.tsx` 的 `STYLES`），组件内按 `isDark` 取用。

## 视觉方向：A×C（2026-11-16）

发现页改版确立、其余屏只对齐 token 的基线，详见 `docs/specs/2026-11-16-mobile-discover-visual-refresh.md`。

| 角色 | 深色 | 浅色 |
|---|---|---|
| 页面底 | `palette.indigo950` `#0F0F23` | `palette.paper` `#F4F1EA` |
| 卡片/面 | `palette.indigo900` `#1B1B30` | `bgSurface` `#FFFFFF` |
| 交互色 | `palette.signal400` `#FFB86B` | `palette.rust600` `#9A3412` |
| 主文字 | `#F7F8FC` | `palette.ink900` `#1B1B2A` |

- 琥珀/锈色只用于激活态、播放键、进度与少数强调；图标默认 `textSecondary`/`textPrimary`，不做彩色图标墙。
- `textTertiary` 是装饰/占位语义（`themeContrast.test.ts` 有断言），有效 meta（歌手、时长、名次）用 `textSecondary`。
- 禁止在滚动内容、列表行、全屏背景上用实时 `BlurView`/`backdrop-filter`；封面氛围光用静态渐变 + 一次性取色。
- 图像/封面上固定用 `playerForeground.dark` 前景 + 固定深色遮罩，不随主题翻转。

## 文字变体（#175）

Text 样式一律用语义变体，禁止裸写 `fontSize`/`fontWeight` 魔法数：

| 变体 | 值 | 用途 |
|---|---|---|
| `largeTitle` | 24/700 | 页面大标题 |
| `titleLg` | 20/700 | 全屏播放器歌曲名 / 发现页 hero |
| `title` | 17/700 | 弹层/对话框标题 / 页内标题 |
| `sectionHeader` | 17/700 | 区块标题 |
| `callout` | 16/400 | 正文级说明/空态文案 |
| `body` | 15/500 | 列表主行文字 |
| `subhead` | 14/500 | 次级行文字/输入框/tab 标签 |
| `footnote` | 13/400 | 辅助说明/meta |
| `caption` | 12/400 | 副行文字（歌手名/时间） |
| `micro` | 10/600 | 徽章/角标 |

用法（makeStyles 工厂内展开，weight 特例在展开后覆盖）：

```ts
import { textVariants } from '../theme/tokens';

name: { ...textVariants.body, color: colors.textPrimary },
playAllText: { ...textVariants.caption, fontWeight: '600', color: colors.textInverse },
```

归一约定：18→`title`、10→`micro`（±1px 级视觉差）。例外不套变体：歌词等带 lineHeight 的成对样式、一次性展示字形（如歌手占位字母）。

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
| `--bg-base/surface/elevated/sidebar/player` | `colors.bgBase/bgSurface/bgElevated/bgSidebar/bgPlayer` | `#F4F1EA` / `#FFFFFF` / `#FBF8F2` / `#FFFFFF` / 半透明白 |
| `--bg-hover/active/overlay` | `colors.bgHover/bgActive/bgOverlay` | `#ECE7DD` / `#E3DDD1` / `rgba(15,15,35,.42)` |
| `--text-primary/secondary/tertiary/disabled/inverse/link` | `colors.textPrimary … textLink` | `#1B1B2A` / `#5E6272` / gray400（仅装饰）/ `#C9C3B8` / 白 / rust700 |
| `--border-default/subtle/strong` | `colors.borderDefault/borderSubtle/borderStrong` | ink900 的 12% / 7% / 20% |
| `--accent/-hover/-active/-subtle/-text` | `colors.accent … accentText` | rust600/700/800 + 10% 底 / rust700 |
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

## 全局适配要点

- 状态栏：`app.json` `userInterfaceStyle: "automatic"`，各屏用 `isDark ? 'light' : 'dark'`（见上）。
- 根布局背景、安全区底色统一 `colors.bgBase` / `colors.bgSurface`，保证 Android 15 edge-to-edge 下无白条/黑条。
- 唱机硬件色（`turntable.*`）双主题共用不翻转；深色下 surface 层级靠 gray950→900→850 明度差表达。
