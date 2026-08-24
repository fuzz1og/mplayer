# MPlayer UI 重构指南 —— 「安静材质」方向（iOS 式高级感）

> 目标读者：本仓库的所有 agent 与人类协作者。
> 适用范围：mobile（`packages/mobile/`）为**当前主线**；desktop renderer（`src/renderer/`）章节全部保留但延后执行（见 §8/§10 优先级）。
> 配套流程：先写 ADR（跨端设计契约变更），按 Phase 开 issue，每个 Phase 一个 worktree，`./scripts/verify.sh` 全绿后 PR。
>
> **理论依据**：移动端动效章节基于 apple-design skill（WWDC《Designing Fluid Interfaces》提炼），
> 其原则与 React Native 的 Animated 弹簧模型一一对应——RN 能做出比 CSS 更接近 iOS 原生的物理动效。

---

## 0. 一句话结论

**方向已经对了，不要推翻重来。** 双端 token 架构（Primitive→Semantic）、灰阶、字号层级都已是 Apple HIG 血统。
"高级感"的差距不在配色，而在四件事：**一致性、材质、动效、纪律**。重构是收敛，不是重设计。

### 现状诊断（2025 审计数据）

| 维度 | 现状 | 判定 |
|---|---|---|
| Token 架构 | 双端两层结构一一对应，命名映射有 README | ✅ 保留 |
| 排版 | 桌面 `--text-*` ↔ 移动 `textVariants` 已对齐，无魔法字号 | ✅ 保留 |
| AntD 接入 | `ConfigProvider` 仅传 locale，无 theme → 默认蓝 `#1677ff` 泄漏 | ❌ P0 修 |
| 色彩纪律 | 组件内 187 处硬编码 hex（含 AntD 旧色板 `#f0f0f0`×32、`#ff4d4f`、`#52c41a`，野色 `#FF6B6B`×15、`#00B894`×8） | ❌ P2 清 |
| 暗色模式 | 移动端双主题完备；桌面端无 dark 分支，缺 gray750/825/850/950 表面阶 | ❌ P0 补 |
| 材质 | 仅 `--bg-player: rgba(255,255,255,.85)` 一处伏笔，无 backdrop-filter 体系 | ❌ P1 建 |
| 动效 | 仅 `--duration-*` + 基础 ease-out，无曲线语义、无弹簧、无 reduced-motion | ❌ P4 建 |
| 样式载体 | 内联 `style={{}}` 为主 + 全局 `.btn/.card/.input` 工具类 | ⚠️ 绞杀式迁移，不搞大爆破 |

---

## 1. 设计方向：「Quiet Material」（安静的材质）

iOS 式高级感的分解式，五根柱子，全部可验收：

1. **材质代替描边**——层级靠表面明度差和半透明材质表达，不靠到处画 1px 边框。这是 iOS 和"Bootstrap 感"最大的分水岭。
2. **一套严格的排版标尺**——字号少、字重对比强、时间数字一律等宽（tabular-nums）。排版本身就是装饰。
3. **极度克制的色彩**——全屏只有一个强调色（品牌蓝）。彩色只能来自内容本身（封面、源徽章），不能来自 UI 控件。
4. **物理感动效**——所有运动走统一曲线族，接近弹簧的减速曲线，绝不 linear；微交互 120ms，场景转场 300ms+。
5. **一致性即高级感**——高级不是加东西，是每个圆角、每段间距、每次转场都一模一样。不一致才是"廉价感"的唯一来源。

### 签名元素（唯一的美学冒险）

**「环境感」播放面**：全屏播放器 / 歌词页背景从当前封面提取主色，生成低饱和的环境光晕渐变（Apple Music 的招牌时刻）。这是唯一允许大面积出现颜色的地方——因为颜色来自音乐内容本身，符合第 3 条柱子。其余一切保持安静。

### 反目标（明令禁止）

- ❌ 全屏毛玻璃化（backdrop-filter 只给 chrome 层和浮层）
- ❌ 渐变按钮、发光描边、霓虹强调色
- ❌ 纯黑背景（`#000`）；暗色最深层是 `gray950 #121214`
- ❌ 虚拟列表行内用 backdrop-filter（性能事故）
- ❌ 八个音乐源的品牌色渗入 UI 控件——它们只活在 `SourceBadge` 里，且暗色下降饱和

---

## 2. Design Tokens v2

在现有两层架构上**增量扩展**四个组，不动既有命名。

### 2.1 补齐中性色阶（desktop 对齐 mobile）

`global.css` Primitive 区新增（值与 mobile `tokens.ts` 逐字一致）：

```css
--gray-750: #38383A;
--gray-825: #2A2A2C;
--gray-850: #2C2C2E;
--gray-950: #121214;
```

### 2.2 材质组（新增 Semantic）

```css
/* 浅色 */
--material-chrome:   rgba(255, 255, 255, 0.72);  /* Sidebar/TopBar/PlayerBar */
--material-overlay:  rgba(255, 255, 255, 0.85);  /* Modal/Dropdown 浮层 */
--blur-chrome:       saturate(180%) blur(20px);
--blur-overlay:      saturate(180%) blur(40px);

/* 深色 */
[data-theme="dark"] {
  --material-chrome:  rgba(28, 28, 30, 0.68);
  --material-overlay: rgba(44, 44, 46, 0.85);
}
```

用法：`background: var(--material-chrome); backdrop-filter: var(--blur-chrome);`
兜底：`@supports not (backdrop-filter: blur(1px))` 时回退到不透明 `--bg-surface`。

### 2.3 发丝线分隔组（替代边框）

```css
/* 浅色 */
--separator:        rgba(60, 60, 67, 0.18);
--separator-strong: rgba(60, 60, 67, 0.29);
/* 深色 */
[data-theme="dark"] {
  --separator:        rgba(84, 84, 88, 0.45);
  --separator-strong: rgba(84, 84, 88, 0.65);
}
```

规则：卡片默认**无边框**，靠 `bg-base → bg-surface → bg-elevated` 明度差分层；
只有行间分隔、表头基线允许发丝线。

### 2.4 动效组（升级现有 transition token）

```css
--ease-out:        cubic-bezier(0.16, 1, 0.3, 1);      /* 保留：微交互 */
--ease-emphasized: cubic-bezier(0.32, 0.72, 0, 1);     /* 新增：iOS 弹簧感，布局/转场 */
--duration-fast:   120ms;   /* hover / press */
--duration-normal: 200ms;   /* 展开 / 颜色 */
--duration-slow:   300ms;   /* 页面内容过渡 */
--duration-scene:  400ms;   /* 全屏播放器开合等场景级 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}
```

移动端对应预设（RN Animated）：按压 `{ stiffness: 300, damping: 30 }`，
浮层开合 `{ stiffness: 280, damping: 32 }`，全部 `useNativeDriver: true`。

### 2.5 圆角色义分配（值不变，用法收紧）

| Token | 用途 |
|---|---|
| `sm 6` | 按钮、输入框、小控件 |
| `md 10` | 行卡片、SourceBadge、缩略封面 |
| `lg 16` | 大卡片、Hero 封面、分组容器 |
| `xl 20` | Modal、全屏播放器浮层 |

### 2.6 排版工具类（desktop 对齐 mobile textVariants）

global.css 新增，命名与移动端逐字对应，跨端心智一致：

```css
.t-largeTitle { font-size: var(--text-2xl); font-weight: 700; letter-spacing: -0.01em; }
.t-titleLg    { font-size: var(--text-xl);  font-weight: 700; }
.t-title      { font-size: var(--text-lg);  font-weight: 700; }
.t-sectionHeader { font-size: 16px; font-weight: 700; }
.t-body    { font-size: var(--text-base); font-weight: 500; }
.t-subhead { font-size: 14px; font-weight: 500; }
.t-footnote { font-size: var(--text-sm); font-weight: 400; }
.t-caption { font-size: var(--text-xs); font-weight: 400; }
.t-micro   { font-size: 11px; font-weight: 600; }
.tnum { font-variant-numeric: tabular-nums; }  /* 进度时间/时长必须挂这个 */
```

---

## 3. P0 · 地基：AntD 桥接 + 暗色模式（杠杆最高，先做）

### 3.1 AntD 主题桥（消灭第二套设计语言）

新建 `src/renderer/theme/antdTheme.ts`，核心决策：
**我们的 CSS 变量是唯一事实源，AntD 只是引用者。**
开启 `cssVar` 后让 AntD token 直接指向 `var(--…)`，暗色切换只需翻 `<html data-theme>`，两个体系同时翻转，不需要维护 `darkAlgorithm` 双份逻辑。

```tsx
// src/renderer/main.tsx
<ConfigProvider locale={zhCN} theme={{
  cssVar: true,          // AntD 6 支持，token 值可以是任意 CSS 值
  hashed: false,
  token: {
    colorPrimary: 'var(--accent)',
    colorInfo: 'var(--accent)',
    colorLink: 'var(--text-link)',
    colorSuccess: 'var(--success)',
    colorError: 'var(--danger)',
    colorWarning: 'var(--warning)',
    colorBgContainer: 'var(--bg-surface)',
    colorBgElevated: 'var(--bg-elevated)',
    colorBgLayout: 'var(--bg-base)',
    colorBorder: 'var(--border-default)',
    colorBorderSecondary: 'var(--separator)',
    colorText: 'var(--text-primary)',
    colorTextSecondary: 'var(--text-secondary)',
    colorTextTertiary: 'var(--text-tertiary)',
    borderRadius: 6,
    controlHeight: 32,
    fontFamily: 'inherit',
  },
}}>
```

注意：cssVar 模式下 AntD 无法从主色派生 hover 态，需显式补
`colorPrimaryHover: 'var(--accent-hover)'`、`colorPrimaryActive: 'var(--accent-active)'` 等。

### 3.2 桌面暗色模式管线

1. `useThemeStore`：`'system' | 'light' | 'dark'`，默认 `'system'`（与移动端 ThemeMode 契约一致）。
2. 解析结果写 `document.documentElement.dataset.theme`，同时 `ipcRenderer.send` 给主进程同步 `nativeTheme.themeSource`（保证原生菜单/标题栏一致）。
3. Semantic 层补 `[data-theme="dark"]` 整套映射——**直接抄 mobile `darkColors` 的值**，两边本来就是一张映射表。
4. 设置页加外观入口（跟随系统/浅色/深色）。
5. Electron 加分项（可后置）：macOS `vibrancy: 'sidebar'`、Win11 `backgroundMaterial: 'mica'`，设置里开关，关了就纯 CSS 材质。

### 3.3 P0 验收

- [ ] 全仓库 grep 不到 AntD 默认蓝 `#1677ff` / `#f0f0f0` / `#e0e0e0` / `#ff4d4f` / `#52c41a` 出现在自绘 UI 中
- [ ] 设置页可切三态主题；暗色下所有 17 个页面肉眼过一遍无"白块残留"
- [ ] Modal/Switch/Table/Tag 与自绘组件放同一屏看不出是两家

---

## 4. P1 · 骨架 Chrome：四面体改造

对象：`TitleBar` / `Sidebar` / `TopBar` / `PlayerBar`——用户永远盯着的地方，材质感收益最大。

| 区域 | 改造 |
|---|---|
| Sidebar | `--material-chrome` + blur；激活项从"蓝色块"改为 **fill 激活**（`--bg-active` 圆角块 + 图标着色）；分区标题用 `t-micro` + `text-tertiary` |
| TopBar | 透明融入 chrome，滚动内容时底部出现一条 `--separator` 发丝线（滚动联动才显形） |
| PlayerBar | `--material-chrome`；进度条重画：4px 圆角轨道 + 拖拽时热区放大到 8px 并浮出手柄；时间戳 `tnum` |
| TitleBar | 保持极简；交通灯区域留白遵守 macOS 节奏 |

规则：chrome 三层之间**不画边框**，全靠材质明度差 + 发丝线。

---

## 5. P2 · 内容表面：清账 + 全页面过检

### 5.1 清理 187 处硬编码 hex

分类处置，建一张审计 issue 清单（grep 导出，逐条销号）：

| 类别 | 例 | 处置 |
|---|---|---|
| AntD 旧色板 | `#f0f0f0` `#e0e0e0` `#ff4d4f` `#52c41a` | 换语义 token，机械替换 |
| 野色 | `#FF6B6B` `#00B894` | 判断原意图 → 收编进 token 或换语义色 |
| 源品牌色 | `#E74C3C` `#1DB954` … | 收敛到唯一出口：`SourceBadge`（从 core/shared 引一处常量）；暗色下降饱和 |
| 封面占位/特殊艺术 | 个别装饰 | 白名单注释豁免 |

顺手项：`DiscoverPage` vs `DiscoverPageV2` 二选一删旧页（重构时最容易漏的死角）。

### 5.2 「iOS 感」检查表（每个页面过一遍）

1. 同屏 ≤1 个强调色；源色只存在于徽章
2. 卡片无边框，靠表面明度差分层；分隔只用发丝线
3. 阴影最多三级（xs/sm/md）；暗色下基本不可见，层级靠明度
4. 圆角、间距、字号全部来自 token，无魔法数
5. 时间/计数 `tnum`
6. 空态是邀请不是句号："没有歌单"→「创建第一个歌单」+ 主操作按钮
7. 键盘 Tab 走一圈，focus-visible 清晰可见
8. 双主题下正文对比度 ≥ 4.5:1

样式载体采用**绞杀式迁移**：改哪个文件就把那个文件的内联样式收编为 CSS Modules 或工具类，不做专项大爆破。

---

## 6. P3 · 播放器体验：签名元素落地

1. **环境感背景**：封面进缓存时（`coverCacheService`）顺带提取主色存入缓存元数据——24px 降采样 + 饱和度加权取众数即可，零依赖，别引 vibrant 库；运行时只读缓存，不在渲染线程算图。
2. 全屏播放器 / 歌词页：`radial-gradient(120% 90% at 50% 0%, 主色@35%, var(--bg-base))`，文字仍走标准 token 色，环境光只是氛围层。
3. PlayerBar → 全屏播放器做**共享元素展开**（封面位移动画，`--ease-emphasized` + `--duration-scene`），这是整个应用记忆点最深的一帧。
4. 歌词页排版：当前行 `t-titleLg` 700，非当前行 `t-body` 40% 透明度，滚动居中吸附。

---

## 7. P4 · 动效系统

| 场景 | 规格 |
|---|---|
| 悬停/按压 | `--duration-fast` + `--ease-out`；按压 `scale(0.97)` |
| Modal/下拉 | `scale(0.96)→1` + fade，`--ease-emphasized` 200ms；scrim 纯 fade |
| 路由切换 | 内容层 fade + 上移 8px，240ms；**不做左右滑动**（桌面范式） |
| 列表入场 | 仅首屏一次，12ms 级联步进，超过一屏立即放弃级联 |
| 全局开关 | `prefers-reduced-motion` 一刀切（token 层已内置） |

原则：一次编排胜过满天散点。动效只在"层级变化"处发生（进入、浮起、展开），静态元素永远静止。

---

## 8. 移动端主路线 M0–M3（当前优先）

移动端 token/双主题/textVariants 底子最好，真正的短板是**交互物理**——按 apple-design skill 审计 `PlayerOverlay` / 全局手势代码的结果：

| skill 原则 | 现状 | 证据 |
|---|---|---|
| §3 可中断性 | ❌ | 关闭用固定 200ms `Animated.timing`，进行中无法抓住改道 |
| §5 速度继承 | ❌ | 全仓库未读过一次 `gs.vy`；甩得再快也匀速滑走 |
| §6 动量投影 | ❌ | 松手只看位置阈值 `dy > 80`：快甩 60px 不关、慢拖 100px 反而关——与物理直觉相反 |
| §9 橡皮筋 | ❌ | 上滑越界被硬钳制（`if (gs.dy > 0)`），到顶像撞墙 |
| §1 响应 | ⚠️ | `activeOpacity` 即时但只有"变淡"；iOS 手感是 scale 按压 |
| §12 材质 | ⚠️ | 无 expo-blur；`bgPlayer rgba(…,0.85)` 半透明伏笔已备而未用 |
| §13 触感 | ❌ | 无 expo-haptics，落定/提交无触觉反馈 |
| §14 减弱动效 | ❌ | 无 AccessibilityInfo 监听；唱机 8s 循环旋转不随系统设置停 |
| §15 排版细节 | ⚠️ | textVariants 无 per-size 字距；时间戳未开 tabular-nums |

### M0 · 物理动效地基（~1 天）

**决策：留在 core Animated，不引 reanimated/gesture-handler。**
理由：`Animated.spring` 自带 `velocity` 参数；中断模式 `stopAnimation(current => …)` 能读到呈现值再重启——正是 skill §3 的"从当前值动画"。reanimated 的 additive spring 更优雅但要重建 dev-client，收益不足以现在付。

新增 `theme/motion.ts` 弹簧预设（Apple 的 damping ζ / response → RN stiffness/damping 换算，mass=1：
`k = (2π/response)²`，`c = 2ζ·(2π/response)`）：

| 预设 | 用途 | stiffness | damping |
|---|---|---|---|
| `uiDefault`（ζ1.0, resp 0.4） | 默认 UI，临界阻尼无过冲 | ≈247 | ≈31 |
| `sheet`（ζ0.8, resp 0.3） | 浮层开合、有动量的拖拽释放 | ≈439 | ≈34 |
| `pressScale`（ζ1.0, resp 0.25） | 按压缩放回弹 | ≈632 | ≈50 |

规则同桌面 §2.4：**默认无弹跳，只有手势本身带动量时才允许 ζ<1**。

### M1 · PlayerOverlay 手势物理重写（~2 天，skill 核心落地）

集中改 `components/PlayerOverlay.tsx`（574 行）一处文件：

1. **速度驱动判定**：release 时读 `gs.vy`（PanResponder 单位是 px/ms，×1000 转 px/s），
   用投影公式判断落点：`projected = current + (v/1000)·d/(1−d)`（d≈0.998），
   投影越过半屏高即 dismiss。快甩必关、慢拖必回。
2. **速度继承**：dismiss 改 `Animated.spring(panY, { toValue: 屏高, velocity: vy*1000, ...sheet })`，替换 `timing(200ms)`——手指松开多快，面板就多快地飞出去。
3. **可中断**：`onPanResponderGrant` 时先 `stopAnimation(current => panY.setValue(current))` 抓住当前值再接管；关闭途中能抓回，入场途中能打断。
4. **橡皮筋**：上滑越界（dy<0）套 rubber-band 渐进阻力公式（skill §9 代码可直接移植），替换硬钳制。
5. **入场弹簧**换 `sheet` 预设（现为 tension 50/friction 10）。
6. **触感**：expo-haptics——浮层落定、播放/暂停 commit 处 light impact；视觉/触觉必须同帧触发（§13 harmony），且只加在有意义处（§13 utility）。

### M2 · 表面与材质（~2–3 天）

- **半透明 chrome**：`BottomSafePlayerBar` / `TopBar` 用 `bgPlayer` 材质让内容从下面滚过。
  Android 真时 blur（expo-blur `experimentalBlurMethod`）在滚动区上有性能税——先用纯半透明材质上线，blur 只许在静态小面积 chrome 上真机验证后再开。
- **滚动边缘效果替代硬边框**：`CollapsingHero` 已有 scroll-linked nav 底色渐变，扩展成"内容与浮动层交界处渐隐 mask"，删掉残余的 1px 分隔线。
- **按压反馈组件化**：封装 `ScalePress`（Pressable + onPressIn scale 0.97 + `pressScale` 弹簧回弹），逐步替换散落的 TouchableOpacity——opacity 变淡是 web 手感，scale 才是 iOS 手感。
- 并入原 P5 内容：源色纪律审计（`sourceColors` 只出现在徽章）、暗色对比度全页面过检。

### M3 · 细节与无障碍（~1 天）

- textVariants 加 per-size 字距：largeTitle/titleLg 加负字距（22px 约 -0.4dp），body 归零，行高随字号反向（§15：字距永远跟字号走，没有全局值）。
- 时间戳统一 `fontVariant: ['tabular-nums']`（RN 双平台原生支持），进度时间不再跳宽。
- reduced motion：`AccessibilityInfo.isReduceMotionEnabled` + `reduceMotionChanged` 监听 → 浮层开合退化为 cross-fade、唱机旋转停止（§14：减弱动效≠没反馈）。
- 主题切换避免亮度跳变（根背景色随主题平滑过渡）。

**依赖注意**：expo-haptics 是 native module，需要 dev-client rebuild（`expo run:android`）；真机验收走 `mobile-device-debugging` skill 流程。core 无改动，无需 `core:build`。

---

## 9. 质量门与防回归

- **design-lint**：`scripts/` 新增 grep 门禁，扫描 desktop renderer 与 mobile 组件内的遗留 hex 黑名单（P2/M2 结束后入 `verify.sh`），命中即 fail
- **PR 要求**：双主题截图各一张（移动端真机截图）；涉及动效附录屏或 GIF，动效评审用慢速播放看帧间内容
- **ADR 先行**：本文档落地前先写 `docs/adr/00XX-design-tokens-v2.md`（跨端契约：材质/动效/dark 表面阶三组新 token 的双端映射）
- **Issue 拆分**：P0–P5 各一个 issue，验收清单直接抄上文对应章节，打 `ready-for-agent`

## 10. 排期参考（单人兼职节奏，按当前优先级排序）

**主线：移动端 M0–M3**

| Phase | 内容 | 规模 | 依赖 |
|---|---|---|---|
| M0 | motion.ts 弹簧预设 + expo-haptics | ~1 天 | 无 |
| M1 | PlayerOverlay 手势物理（速度继承/投影/可中断/橡皮筋） | ~2 天 | M0 |
| M2 | 半透明 chrome + ScalePress + 源色纪律 + 暗色过检 | 2–3 天 | M0 |
| M3 | 字距/tabular-nums/reduced motion | ~1 天 | M0 |

**延后：桌面端 P0–P5**（章节内容仍然有效，等移动端收尾后再启动）

| Phase | 内容 | 规模 | 依赖 |
|---|---|---|---|
| P0 | AntD 桥 + dark 管线 + token v2 + t-* 类 | 1–2 天 | 无 |
| P1 | 四面 chrome 材质化 | 2 天 | P0 |
| P2 | 清账 187 hex + 全页面检查表 | 3–5 天 | P0 |
| P3 | 环境感 + 共享元素转场 | 3 天 | P1 |
| P4 | 动效系统 | 2 天 | P0 |

两端共享的只有 token 值与命名契约（ADR 管），动效/材质实现各走各的平台方案——所以移动端先行不会给桌面返工埋雷。
