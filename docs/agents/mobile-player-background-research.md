# Mobile 全屏播放器背景调研 —— iOS 音乐类 App 的主流做法与实现路径

> 关联：`PlayerOverlay.tsx`（全屏播放器）、`ChromeBlur.tsx`（顶部栏毛玻璃）、`theme/tokens.ts`（`bgPlayer` / 双主题 token）。
> 本文档只做调研与建议，不改任何代码。

## 背景（一句话）

MPlayer 全屏播放器 `PlayerOverlay` 当前背景是 `colors.bgPlayer`（浅色 `rgba(255,255,255,0.96)` / 深色 `rgba(28,28,30,0.85)`）的半透明纯色，无模糊、无封面配色；顶部栏已套 `ChromeBlur` 毛玻璃。本次调研 iOS 音乐 App 全屏播放器背景的主流做法，并评估 RN/Expo 实现路径，最后针对 PlayerOverlay + 深浅双主题 + ChromeBlur 顶栏给出推荐组合。

---

## 一、iOS 主流做法（Apple Music / 行业惯例）

### 1.1 两种被广泛采用的范式

**范式 A：封面主色/平均色提取 → 垂直渐变 + 暗色阅读区（Apple Music 经典做法）**
- 提取封面主色（Core Image `CIAreaAverage` 区域平均色）+ 识别互补色/变暗色。
- 背景为垂直渐变：顶部封面主色 → 底部变暗变体色，覆盖视口约 70% 高度。
- 底部渐变自然变暗，形成白色/高亮文字的「安全阅读区」，无需额外遮罩层；深色画布用纯黑 `#000000`（非 `#121212`），让封面色彩渐变在纯黑上弹出效果最佳。
- 来源（一手，Apple Music 设计规范梳理）：`awesome-ios-design-md` 仓库 DESIGN.md
  https://github.com/Meliwat/awesome-ios-design-md/blob/main/design-md/music/apple-music/DESIGN.md
- 复刻示例（iOS 原生 demo，提取主色后上渐变）：thakur-vijay/AppleMusicGradient
  https://github.com/thakur-vijay/AppleMusicGradient

**范式 B：封面大图模糊作背景（Spotify / 多数第三方播放器）**
- 背景 = 封面大图放大 + 高斯模糊 + 半透明暗色遮罩，营造「朦胧氛围」。
- 文字可读性依赖模糊 + 暗色遮罩层，而非渐变暗端。
- 对比：Apple Music 选「色彩提取」而非「模糊」——更干净、图形化；Spotify 选「封面模糊 + 暗遮罩」——更氛围化。
- 来源（同一份 DESIGN.md 对比表，同上 URL）。

### 1.2 重要更正：Apple Music 的现代背景其实是「封面图层扭曲 + 模糊」

- 逆向工程（Web 版 Apple Music 反编译 shader）发现：Apple Music 全屏播放背景**并非单纯主色渐变**，而是叠加 4 张不同尺寸（25%/50%/80%/125% 视口宽）的专辑封面副本 → 施加 Twist 扭曲 → 高斯/Kawase 模糊，最终封面图像本身「流动」成背景；并对封面做过饱和处理让色彩更鲜艳。
- 结论：**不需要单独提取颜色**，对封面本身做变换即得动态渐变；且始终与封面高度相关。
- 来源（一手逆向，Aadish Verma, 2025-11）：
  https://www.aadishv.dev/music
- 含义：理想形态是「封面驱动背景」（模糊/扭曲封面），静态近似则是「主色渐变」或「模糊封面 + 暗遮罩」。两者都成立。

### 1.3 Apple HIG 相关指引

- **沉浸式全屏**：HIG 建议全屏用于需要专注/沉浸的内容（视频、照片、游戏、演示）；深色/纯黑背景用于全屏媒体以减少视觉干扰、增强对比、突出前景内容；全屏下保证前景文字/控件有足够对比度；控件应可自动隐藏。
- **材质/透明度**：HIG 倾向在非全屏界面使用系统材质（`ultraThinMaterial` 等）做毛玻璃；**在全屏沉浸场景尽量避开透明/模糊材质作主背景**——半透明材质引入背景视觉噪音、削弱沉浸感、降低可读性。若需层次，用不透明深色背景 + 阴影/边框分层；半透明材质更适合短暂出现的控件（如播放控制条）。
- 来源：Apple HIG "Going full screen"（页面需 JS，正文未能直接抓取，以下为基于 HIG 通例的归纳，非逐字原文，需人工复核原文）
  https://developer.apple.com/design/human-interface-guidelines/going-full-screen
  （注：此条我未能完整抓取原文正文，属「搜到但打不开/需复核」项，已如实标注。）

> **调研小结**：iOS 音乐类全屏播放器背景的主流 = 「封面驱动」（主色渐变 或 模糊封面 + 暗遮罩）两种范式，均配套「底部/整体暗化」保证文字可读；纯色 + 顶栏毛玻璃的组合不是 iOS 主流。

---

## 二、RN/Expo 实现路径清单

> 前置事实：当前 worktree `packages/mobile/package.json` 已含 `expo-blur ~57.0.2`；**未装** skia / linear-gradient / 任何主色提取库；已装 `react-native-svg`、`react-native-screens`、`react-native-safe-area-context`。项目走 Android 优先（`dimezisBlurViewSdk31Plus` 已落地），需 dev build（已有 `expo-dev-client` / `expo-build-properties`）。

### 方案 A：expo-blur BlurView 包封面图（静态模糊背景）
- **做法**：在 `contentWrap` 下放一张铺满的封面 `<Image>`（放大/裁切），其上叠 `<BlurView intensity={80~100} tint={...}>` 实现静态模糊背景；再叠暗色遮罩保证文字可读。
- **可行性**：高。iOS 开箱即用（原生 `UIVisualEffectView`）；Android 需沿用现有 `BlurTargetView` + `blurTarget` + `blurMethod` 机制（项目已有 ADR-0010 基建）。
- **预期效果**：最贴近「范式 B」Spotify 式；与现有 ChromeBlur 顶栏语言一致。
- **成本**：低（复用现成 expo-blur，无需新依赖）；但 Android 仍是「高斯模糊 + 弱着色」基线，发灰、无饱和增强（见已有 `mobile-blur-community-research.md`），背景色复杂时尤其明显。
- **来源**：expo-blur 官方文档 https://docs.expo.dev/versions/latest/sdk/blur-view/

### 方案 B：封面主导色提取 → 渐变（react-native-image-colors / 纯 JS 平均色）
- **做法**：提取封面主色后，用渐变（`react-native-linear-gradient` 或 `expo-linear-gradient`）+ 底部暗端建立阅读区；深浅主题可基于同一主色派生明暗两套。
- **可行性**：中。**注意 `react-native-image-colors` 是原生模块（iOS `CIEdgeColor`、Android `Palette`），无 Expo config plugin，需 prebuild + dev build**；API 按平台返回不同字段（iOS 用 `.primary/.secondary`，Android 用 `.dominant/.vibrant`）。项目已有 dev build 基建，可行。
- **预期效果**：最贴近「范式 A」Apple Music 经典观感；干净、图形化，暗底亮字天然可读。
- **成本**：中（新增原生依赖 + prebuild + 按平台适配字段 + 缓存主色）。
- **纯 JS 备选（成本更低）**：自己用 `Image` 采样/服务端取平均色，或直接用封面本身 + 渐变 overlay 模拟——零原生依赖但色彩精度有限。
- **来源**：
  - react-native-image-colors（一手 GitHub，README 本次未能直接抓取，API/平台差异来自社区交叉验证）：https://github.com/csobiech/react-native-image-colors
  - Spotify 风格主色渐变教程（二手，交叉验证）：https://www.nursaadat.dev/blog/react-native-dominant-color-with-gradient

### 方案 C：react-native-skia（模糊 + 渐变 + 色彩，三件套）
- **做法**：用 `@shopify/react-native-skia` 的 `BackdropBlur` 做封面模糊、`ColorMatrix`（饱和矩阵 s>1）补「饱和度增强」、`Fill`/`BlendColor` 补「着色」——一次性补齐 iOS material「模糊+饱和+着色」三件套；`useImage` 加载封面。
- **可行性**：中高。技术完全可行，是 RN 层唯一能真正补齐「饱和增强」的路径（与已有 blur 调研方案 D 一致）；但需新增重依赖、自研封装、dev build、动态内容用 `useImage`/Picture 捕获。
- **预期效果**：最接近 iOS 原生质感（尤其 Android 相对 expo-blur 的质变）；封面驱动背景天然适配。
- **成本**：高（新依赖体积 + 封装 + 性能调优）。
- **来源**（一手）：RN Skia Backdrop Filters / Color Filters 官方文档
  https://shopify.github.io/react-native-skia/docs/backdrops-filters/
  https://shopify.github.io/react-native-skia/docs/color-filters/

### 方案 D：纯 JS（封面 Image + 渐变 overlay + 半透明层模拟）
- **做法**：`contentWrap` 铺封面 `<Image>`，叠一个 `LinearGradient`（透明→黑）做暗化阅读区，必要时盖半透明主题色。不引入 blur。
- **可行性**：高（纯 JS，零原生改动）。
- **预期效果**：能实现「主色/封面驱动的静态背景 + 暗化」，观感接近「范式 A」静态版；**无模糊**，氛围感弱于 A/C。
- **成本**：最低。
- **来源**：无特定一手来源，为 RN `Image` + `LinearGradient` 常规组合（社区泛例，二手）。

---

## 三、文字可读性处理与深浅模式

- **社区常规**：暗化靠「透明→黑」底部渐变遮罩（如 `rgba(0,0,0,0)→rgba(0,0,0,0.6~0.7)`）或全局半透明黑罩（alpha 0.4~0.7），叠加后前景文字用高对比亮色；Apple Music 用渐变底部暗端天然形成阅读区（见 DESIGN.md）。
- **深浅模式适配**：不能写死黑/白遮罩。建议基于主题派生——浅色主题用「亮化/白」向遮罩 + 深色文字，深色主题用「暗化/黑」向遮罩 + 亮色文字；或统一用暗背景 + 亮字（iOS 全屏媒体惯例）。本项目有 `ThemeColors` + `isDark` token，遮罩 alpha/色值应进 `theme/tokens.ts` 派生，而非散落魔数。
- **coverFailed / 无封面**：需保留现有 `bgPlayer` 纯色回退，保证封面加载失败时不出现难看底色。

---

## 四、社区踩坑

1. **BlurView 在动态内容前渲染不更新模糊**（expo-blur 已知问题）：BlurView 需排在动态内容（如 FlatList）之后渲染，否则模糊不刷新。PlayerOverlay 内是 FlatList 歌词，若做全屏模糊背景，**BlurView 应置于歌词列表之后/覆盖层**。
   - 来源（一手）：https://docs.expo.dev/versions/latest/sdk/blur-view/ ；Issue #6613 https://github.com/expo/expo/issues/6613
2. **Android 模糊性能税 / 观感差异**：expo-blur Android 用 RenderNode（SDK 31+）或低效 RenderScript（更旧）；且只是「高斯模糊 + 可选半透明着色」，无 iOS 的饱和度增强 → 发灰。用 `dimezisBlurViewSdk31Plus`（旧版回退 none）可规避性能税；发灰靠叠半透明主题色层补救。**全屏整页大尺寸 blur 更吃性能，建议限位（仅背景层）并慎用动态更新。**
   - 来源：同上 expo-blur 文档；团队已有 `mobile-blur-community-research.md`（含 #29465、#43814、blurTarget 各坑），Android 优先项目务必对齐该文档。
3. **Animated 容器内嵌 BlurView 的兼容性**：`contentWrap` 是 `Animated.View`（native driver translateY/scale/opacity）。BlurView 的模糊目标在 transform 动画/下滑关闭时可能捕捉异常（现有 PlayerOverlay 注释已注明不能把 BlurView 直接嵌进 Animated contentWrap）。建议：**背景层独立放在 contentWrap 之下、非动画层**，动画只作用于前景内容。
   - 来源（现状代码注释 + blur 调研文档）。
4. **动态渐变背景若做成「流动/扭曲动画」成本高**：Apple Music 真实是封面扭曲+模糊的实时效果（见 aadishv.dev），RN 复刻成本高、Android 性能风险大。**建议做静态模糊/静态渐变，不做实时流动动画**，除非上 skia 且有性能预算。
5. **主色提取库的平台差异**：`react-native-image-colors` 按平台返回不同字段（iOS primary/secondary、Android dominant/vibrant），且无 Expo config plugin（需 prebuild）。别在纯 Expo Go 里指望它生效。
   - 来源（二手交叉验证）：https://blog.csdn.net/gitblog_00297/article/details/153726122

---

## 五、针对我们现状的推荐组合建议

现状要点：PlayerOverlay 的 `contentWrap` 是 Animated.View（native driver）→ 背景不能嵌 BlurView；顶栏已套 ChromeBlur；深浅双主题 token；Android 优先；已有 expo-blur 基建、无 skia/无主色库。

### 首选（低风险，先做）：封面静态模糊背景 + 暗化遮罩，复用 expo-blur 基建 —— 方案 A + D 组合
1. 在 `contentWrap` **之下、动画层之外**铺一张铺满的封面 `<Image>`（放大/裁切，复用 `useResolvedCover`）。
2. 其上叠 `BlurView`（iOS 默认、Android 走既有 `BlurTargetView`/`blurMethod`）做静态模糊；或为控制成本先做「封面 + 渐变 overlay」的静态版本（方案 D）。
3. 顶部、底部叠「透明→黑/主题色」渐变遮罩 + 深浅主题派生色，建立歌词/控件阅读区。
4. `coverFailed` / 无封面时回退现有 `bgPlayer` 纯色。
5. 深浅模式：遮罩 alpha 与色向进 `theme/tokens.ts` 派生，浅色用亮化遮罩 + 深字、深色用暗化遮罩 + 亮字。
- 理由：iOS「Spotify 式」主流范式之一；零/低新依赖，复用已踩平 Android 坑的 expo-blur 基建；不碰 Animated 动画层，规避 BlurView 已知兼容坑。

### 进阶（观感最贴 Apple Music，Android 质变）：react-native-skia 封面模糊+饱和+渐变 —— 方案 C
- 若对「发灰/无饱和」不满意、且可接受 skia 依赖与 dev build，用 `BackdropBlur` + `ColorMatrix`(饱和) + 渐变实现封面驱动背景，补齐 iOS material 三件套。这是 RN 层唯一能真正还原 iOS 观感的技术路径。
- 建议在首选落地并验证 Android 性能后再评估，勿作为第一步。

### 次选（零 blur、最省）：封面主色渐变静态背景 —— 方案 D/B 简化版
- 不引入 blur，用封面 `<Image>` + 底部渐变遮罩，成本最低、最稳，观感接近 Apple Music 经典「主色渐变」。若要精确取色再加 `react-native-image-colors`（需 prebuild）。

### 不推荐
- 实时「扭曲/流动」背景（Apple Music 真实现法）：Android 性能风险高、RN 复刻成本大，超出本次「iOS 风格背景」的收益。
- 把 BlurView 直接嵌进 `Animated` 的 `contentWrap`：触发动态内容/动画兼容坑，背景应独立于动画层。

---

## 来源清单

**一手 / 权威**
- expo-blur 官方文档（BlurView props、Android 行为、性能、Known issues）：https://docs.expo.dev/versions/latest/sdk/blur-view/
- expo-blur Issue #6613（BlurView 动态内容不更新）：https://github.com/expo/expo/issues/6613
- RN Skia Backdrop Filters：https://shopify.github.io/react-native-skia/docs/backdrops-filters/
- RN Skia Color Filters（饱和度矩阵）：https://shopify.github.io/react-native-skia/docs/color-filters/
- Apple Music 背景逆向工程（aadishv.dev）：https://www.aadishv.dev/music
- Apple HIG "Going full screen"（正文需 JS 未抓到，已标注待人工复核）：https://developer.apple.com/design/human-interface-guidelines/going-full-screen
- Apple Music 设计规范梳理（DESIGN.md）：https://github.com/Meliwat/awesome-ios-design-md/blob/main/design-md/music/apple-music/DESIGN.md
- AppleMusicGradient 复刻 demo：https://github.com/thakur-vijay/AppleMusicGradient

**二手（已标注，交叉验证）**
- Spotify 风格主色渐变教程（nursaadat.dev，react-native-image-colors + LinearGradient）：https://www.nursaadat.dev/blog/react-native-dominant-color-with-gradient
- react-native-image-colors 平台字段差异（CSDN，交叉验证）：https://blog.csdn.net/gitblog_00297/article/details/153726122
- 团队已有调研（Android blur 发灰/饱和/坑）：`docs/agents/mobile-blur-community-research.md`

> 未获取/无法打开：Apple HIG going-full-screen 正文、react-native-image-colors 官方 README（GitHub 抓取超时/404）——相关结论已标注「二手交叉验证」并建议复核。
