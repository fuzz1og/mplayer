# ADR-0004: 桌面端深色模式 + 语义 token 全面化（纯 CSS 双主题方案）

- 状态：已接受（2026-08-23，经 grilling 设计会话 Q2=A「精修不换皮」定稿，spec 见 `docs/specs/2026-08-23-settings-download-ui-refine.md`）
- 关联：移动端 `packages/mobile/theme/tokens.ts`（light/dark 双主题，本次桌面深色 token 以其为镜像基准）；ADR-0002（缓存语义层，无直接关系）

## 背景

- 桌面端只有浅色主题，移动端已支持 light/dark 双主题（系统/浅色/深色三态）；两端视觉体系同源（同一套 Apple HIG 蓝调 token），桌面缺深色导致夜间使用不适、双端不对称。
- 桌面 renderer 的 token 基建不健康：组件里混用旧别名（`--content-bg`/`--border-color`/`--divider-color`/`--bg-color`/`--accent-color` 等，global.css 里以 1:1 别名兜底）+ 大量魔法色值（`#FF6B6B`/`#00B894`/`#FDCB6E`/`#E17055`/`#0984E3`/`#6C5CE7`/`#FFB800` 等，散落设置组件、页面骨架屏、弹窗），并有伪 token 魔法色（`--primary-color: #2D3436`）。改色不可预测，深色化无从下手。

## 决策

**方案 B：纯 CSS 双主题 + 语义 token 全面化。**

- **三态切换（纯 CSS，零 JS 主题库）**：深色语义 token 定义两份——`@media (prefers-color-scheme: dark)` 下 `:root:not([data-theme='light'])`（跟随系统）+ `:root[data-theme='dark']`（手动覆盖）。渲染进程只做两件事：启动/切换时读写持久化模式（IPC → 主进程 db），把 `data-theme` 写到 `<html>`（空值 = 跟随系统）。
- **深色 token 以移动端 darkColors 为镜像基准**：值一一对应（`#121214`/`#1C1C1E`/`#2C2C2E` 层级、`#3D7BD9` accent、`#FAFAFA` 文字等），保证双端观感一致。
- **语义 token 全面化**：全 renderer 旧别名替换为新语义 token 后移除别名块；魔法色归入语义 token（`--danger`/`--success`/`--warning`/新增 `--info` 与数据可视化 `--chart-1..4`，各带深色变体）；骨架屏、封面占位等装饰色收敛（`--skeleton-*`、固定值 `--cover-placeholder`）。
- **音乐源品牌色单一来源**：`src/renderer/constants/sourceConfig.ts` 一处定义（与移动端 sourceColors 对齐），SourceBadge/TopBar/SourceSwapModal/LinkPreviewTable/ImportPlaylistModal 统一引用。
- **antd 同步深色**：`ThemeManager` 按生效主题切 `darkAlgorithm`/`defaultAlgorithm` + `colorPrimary`（对齐 `--accent`），antd 组件（Switch/Tag/Modal 等）在深色下不突兀。
- **主题解析为纯函数**（`resolveTheme(mode, systemPrefersDark) → { isDark, dataTheme }`）——本次唯一新增的可自动化逻辑缝，单测覆盖三态与边界。

## 后果

- 深色跟随由 CSS 原生完成（`prefers-color-scheme`），手动覆盖只需改一个属性，几乎无 JS 开销；
- `--accent` 等 token 在深浅色下取值不同，组件内不再允许散写魔法色（lint/评审口径）；
- antd 与自定义 token 双体系在深色下都正确，双端主题语义对齐；
- 代价：新增 token 面（`--info`、`--chart-1..4`、`--success-subtle`、`--cover-placeholder` 等）需要维护深浅两套值；深色下部分装饰性固定色（封面占位黑胶色）不随主题变化，属有意设计。

## 回退选项

不采用：方案 A（仅设置页深色——单独一页深色会与全 App 浅色打架）；引入 JS 主题库（next-themes 类——渲染进程零依赖原则，纯 CSS 已满足）；移动端三态沿用系统/浅色/深色三态、桌面端只做跟随系统（用户明确要求三态手动切换，与移动端一致）。
