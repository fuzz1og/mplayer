# Mobile 毛玻璃（Blur）社区调研 —— 如何让 Android 接近 iOS 观感

## 背景（一句话）

MPlayer 移动端用 `expo-blur@~57.0.2` 的 `BlurView`（`blurMethod="dimezisBlurViewSdk31Plus"` + `blurTarget` + `intensity=90` + `tint=systemThinMaterial*` + `blurReductionFactor=2`）做 TopBar/PlayerBar/底部 tab 栏毛玻璃，但 Android 侧观感不如 iOS：发灰、模糊弱、无饱和度增强、像半透明面板。

本文档为社区调研笔记，聚焦「Android 模糊差/发灰」的成因与可行调教/替代方案。调研以一手来源（GitHub issue/PR、官方文档、AOSP、npm）优先，二手来源（CSDN/火山引擎等）均交叉验证并标注。

---

## 一、先确认现状与已知坑（expo-blur 官方行为）

### 1.1 Android 与 iOS 是两套完全不同的底层实现（这是发灰的根因）

- iOS 用系统原生 `UIVisualEffectView`（Apple material，自带模糊+饱和+着色三件套）。
- Android 在 SDK 55+ 之后稳定，但需 `BlurTargetView` + `blurTarget` 才能工作；底层是 `dimezis/BlurView`（RenderScript / RenderNode 采样模糊）或旧设备纯半透明回退。
- 官方文档明确：**每种 tint 都会在模糊效果上叠加一层半透明颜色层；不传 tint 时只有纯模糊**。
- 来源（一手）：
  - expo-blur 官方文档 Android 支持与属性说明：https://docs.expo.dev/versions/latest/sdk/blur-view/
  - GitHub Issue #29465（"How to fix android blur does not looks like iOS blur"）——**官方关闭为 invalid/问答题，明确这是平台预期差异而非 bug**：https://github.com/expo/expo/issues/29465

> 结论：Android 达不到 iOS 观感不是配置写错，而是 expo-blur 在 Android 上只提供「高斯模糊 + 可选半透明着色」，没有 iOS 那种「模糊 + 饱和度增强 + 着色」的材质渲染管线。这是需要接受的基线，改进只能靠参数调教或换实现。

### 1.2 已知坑（与当前配置直接相关）

- **blurReductionFactor 初始值 bug（已修复）**：PR #43814 指出在 sdk-55 分支中「初始模糊设置阶段没有把 `blurReductionFactor` 考虑进去」，导致首次渲染模糊强度过高、刷新 prop 后才恢复。已合并进 SDK 55 并发布。**如果你的 `blurReductionFactor=2` 是 0.x/旧版，建议确认是否落在含此修复的版本**。
  - 来源：https://github.com/expo/expo/pull/43814
- **BlurTargetView 的代理缺陷**：`indexOfChild`/`startViewTransition`/`endViewTransition` 未正确代理，会导致 react-native-screens 转场动画期间内容消失、gesture-handler 手势被取消（#47402/#47404/#48139/#48141）；与 RN Modal 无法跨边界（#44165）；与 ScrollView 粘性头部冲突（#48785，仍开启）。这些主要影响「容器内嵌模糊」的场景，Tab/Bar 全屏覆盖场景影响较小。
  - 来源：GitHub 检索 `repo:expo/expo blur android in:title`，https://api.github.com/search/issues?q=repo:expo/expo+blur+android+in:title
- **borderRadius 不会生效**：BlurView 显式传 `borderRadius` 无效，需用 `overflow:'hidden'`（官方文档 Known issues）。
  - 来源：https://docs.expo.dev/versions/latest/sdk/blur-view/
- **动态内容先于 BlurView 渲染时模糊不更新**：BlurView 需在动态内容之后渲染（官方 Known issues）。
  - 来源：https://docs.expo.dev/versions/latest/sdk/blur-view/

### 1.3 blurReductionFactor / intensity / tint 官方语义（当前配置核对）

| 属性 | 官方默认 | 作用 |
|------|---------|------|
| `intensity` | 50（1–100） | 模糊强度，可在 Android 上被 `blurReductionFactor` 相除 |
| `blurReductionFactor` | 4 | Android 上将模糊强度除以该值，用于拉近与 iOS 的观感差异 |
| `tint` | `'default'` | 在模糊上叠加半透明颜色层 |
| `blurMethod` | `'none'` | `none`=纯半透明视图；`dimezisBlurView`=原生模糊（旧系统性能差）；`dimezisBlurViewSdk31Plus`=仅 Android 12+ 模糊、旧系统回退 `none` |

来源：https://docs.expo.dev/versions/latest/sdk/blur-view/

> 当前 `intensity=90`、`blurReductionFactor=2`：实际 Android 模糊强度 ≈ 90/2 = 45，而 iOS 端同样传 90（iOS 不除 reductionFactor）。这解释了「Android 看起来更弱」。**把 blurReductionFactor 调低（如 1）或调高 intensity 可提升 Android 模糊强度**——但代价是发灰/过曝会更明显，需配合着色。

---

## 二、方案清单（逐条：做法 / 来源 / 可行性 / 预期效果 / 成本）

### 方案 A：纯参数调教（留在 expo-blur，零改架构）

**做法**
- 调低 `blurReductionFactor`（1–2）或调高 `intensity`，让 Android 模糊强度追平 iOS。
- 调整 `tint` 的明暗方向（light/dark）与厚度（thin/regular/thick/chrome），并配合主题 `colorScheme` 动态切换。
- 这是 Folo 项目的做法：`intensity={100}` + 按 colorScheme 切换 `systemChromeMaterialLight/Dark`（而不是 thinMaterial）。
- 来源（二手，交叉验证过官方文档属性）：Folo 模糊实现分析，https://blog.csdn.net/gitblog_00701/article/details/152385290 ；官方属性定义，https://docs.expo.dev/versions/latest/sdk/blur-view/

**可行性**：高（零风险，不动架构）
**预期效果**：能消除「模糊弱」的部分观感差异，但**无法补齐「饱和度增强」**，发灰问题仍存。
**成本**：低（仅改参数）

### 方案 B：模糊层上叠加「半透明 + 饱和增强色」层（社区最常见 hack）

**做法**
- 在 `BlurView`（或模糊内容）之上再叠一层半透明、带主题色的 `<View>`（如 `rgba(品牌色, 0.1~0.2)`），用颜色层补「着色」；饱和度增强则靠「低 alpha 白/品牌色 + 高对比文本」间接模拟 iOS 的提亮观感。
- 社区（火山引擎、CSDN）把这种「Blur + Overlay 多层叠加 + Mask」作为实现毛玻璃/局部模糊的标准套路，并明确指出把 overlay 从纯黑改成品牌/主题半透明色即可得到「模糊+着色」的 Material 质感。
- 来源（二手，交叉验证）：
  - 火山引擎《如何在RN中实现局部模糊效果》（方案一 MaskedView + 半透明 overlay 换色模拟 Material）：https://www.volcengine.com/article/411219
  - 火山引擎《模糊视图终极指南》（BlurView 叠加遮罩）：https://www.volcengine.com/article/866691

**可行性**：高（纯 JS/RN 层，无原生改动）
**预期效果**：可补「着色」一环，观感明显接近 iOS 的彩色毛玻璃；但**只能近似「提亮」，不能做真正的像素级饱和度增强**。
**成本**：低（多一层 View），需按主题维护 overlay 颜色。

### 方案 C：react-native-blur / @react-native-community/blur（现由 margelo 维护）

**做法**
- 换用原生驱动库：iOS 用 `UIVisualEffectView`，Android 用 RenderScript/高斯模糊；提供显式 `blurRadius`、`downsampleFactor`、`tint` 属性，比 expo-blur 的 0–100 强度更「像素级可控」。
- 来源（一手）：margelo/react-native-blur 仓库，https://github.com/margelo/react-native-blur

**可行性**：中（需 prebuild/dev build；@react-native-community/blur 在新架构 Fabric 下支持度是 ⚠️，社区对比文档有标注）
**预期效果**：Android 模糊半径/降采样可控性更好，能精确调 blurRadius；但**仍只是高斯模糊 + 可选 tint 颜色层，没有 iOS 的饱和度增强**——发灰问题不根治。
**成本**：中（替换组件、需 dev build、适配 expo 的 blurTarget 机制）
- 参考对比：React Native Liquid Glass 对比页，https://himanshu-lal4.github.io/react-native-liquid-glassmorphism/react-native-blur-alternative/

### 方案 D：自绘 —— react-native-skia 的 `BackdropBlur` + `ColorMatrix`（饱和）

**做法**
- 用 `@shopify/react-native-skia` 的 `BackdropBlur` 对背景做高斯模糊，再用 `ColorMatrix`（饱和度矩阵，s>1 增强）叠加在模糊之上，可同时做「模糊 + 饱和 + 着色」三件套（着色可用 `Fill color="rgba(...)"` 或 BlendColor）。
- 官方文档明确支持：`BackdropFilter` + `ColorMatrix` + `Blur` 可嵌套组合；给出标准饱和度矩阵公式（s=1.5 即增强 1.5 倍）。
- 来源（一手）：RN Skia Backdrop Filters 官方文档，https://shopify.github.io/react-native-skia/docs/backdrops-filters/ ；Color Filters（饱和度矩阵）官方文档，https://shopify.github.io/react-native-skia/docs/color-filters/

**可行性**：中高（技术完全可行，能真正补齐「饱和」环；但需引入 skia 依赖、自己维护 blur target 采样与性能）
**预期效果**：**这是唯一能在 RN 层真正补齐「模糊 + 饱和 + 着色」三件套的方案**，最接近 iOS 观感。
**成本**：高（新依赖 + 自研封装 + 性能调优；需 dev build；动态内容需用 `useImage`/Picture 捕获）。

### 方案 E：Android 原生自封装（RenderEffect.createBlurEffect + ColorMatrixColorFilter 饱和）

**做法**
- 在 Android 原生侧用 `RenderEffect.createBlurEffect(radius, radius, tileMode)` 做模糊，再用 `RenderEffect.createColorFilterEffect` + `ColorMatrixColorFilter`（饱和矩阵）叠加饱和度，封装成自定义 View 给 RN 用。
- AOSP 官方文档确认：RenderEffect 支持 `createColorFilterEffect` 组合 `ColorMatrixColorFilter` 做饱和度调整。
- 来源（一手）：AOSP 窗口模糊文档（含 RenderEffect 与跨窗口模糊区别、ColorMatrixColorFilter 说明），https://source.android.google.cn/docs/core/display/window-blurs?hl=zh-cn ；Android RenderEffect 类（微软 .NET 绑定，列出 ColorMatrix/ColorMatrixColorFilter），https://learn.microsoft.com/zh-cn/dotnet/api/android.graphics.rendereffect.createblureffect

**可行性**：中（技术上最「正道」，能同时补模糊+饱和；但需写原生模块、维护双端、成本高，且与 expo-blur 的 blurTarget 机制不兼容）
**预期效果**：最接近 iOS 原生质感，且性能好（GPU 层）。
**成本**：高（原生开发 + prebuild + 维护），不建议作为第一步。

### 方案 F：expo-glass-effect / liquid-glass 类库（iOS 26 Liquid Glass）

**做法**
- `expo-glass-effect` 的 `GlassView` 提供原生 Liquid Glass（iOS 26+）；`react-native-liquid-glassmorphism` 提供 Android 上基于 AGSL 折射着色器的真玻璃效果（含折射/边缘透镜/色散，非仅模糊）。
- 来源（一手）：expo-glass-effect 官方文档（**明确仅 iOS/tvOS，Android 不支持，回退为普通 View**），https://docs.expo.dev/versions/latest/sdk/glass-effect/ ；RN Liquid Glass 对比页，https://himanshu-lal4.github.io/react-native-liquid-glassmorphism/react-native-blur-alternative/

**可行性**：低（Android 场景不可用/依赖很重）
**预期效果**：iOS 26 上极佳；**Android 无收益**（expo-glass-effect 直接回退；liquid-glass 需要 AGSL + 大体积）。
**成本**：高（依赖体积/维护），本项目 Android 优先，**不推荐**。

---

## 三、社区踩过的坑汇总

1. **平台差异是预期行为，不是 bug**——官方把「Android 模糊不像 iOS」类 issue 直接关闭为问答题（#29465）。不要指望升级 expo-blur 自动解决。
2. **blurReductionFactor 初始值 bug**——旧版首次渲染强度异常，需保证 SDK 55+（#43814）。
3. **blurTarget / BlurTargetView 的坑**：Modal 无法跨边界（#44165）、ScrollView 粘性头冲突（#48785 仍开）、手势/转场被取消（#47402/#47404）。Tab/Bar 全屏覆盖场景风险低，但若用模糊做「容器内嵌」要警惕。
4. **expo-glass-effect 不能救 Android**——Android 直接回退为普通 View，别指望它。
5. **调高模糊强度会让发灰/过曝更明显**——很多团队发现「模糊够了但发灰」，于是叠加半透明主题色层来补救（方案 B），这是社区主流解法。
6. **@react-native-community/blur 在新架构（Fabric）支持度存疑**，迁移有坑。

---

## 四、Apple material 三件套在 Android 的可补性

iOS `UIBlurEffectStyle.material` = **模糊 + 饱和度增强 + 着色**，逐环看 Android：

| 环节 | Android 原生能力 | expo-blur 现状 | 能否补齐 |
|------|-----------------|----------------|---------|
| **模糊** | RenderEffect / RenderScript 高斯模糊 | ✅ 已有（dimezisBlurViewSdk31Plus） | 已具备，可调强 |
| **饱和度增强** | 需 `ColorMatrixColorFilter`（原生）或 skia ColorMatrix（JS） | ❌ 无 | **能补**（方案 D/E），expo-blur 自身补不了 |
| **着色** | 半透明色层 / tint | ⚠️ 仅半透明色层（`tint`），非「材质色彩调节」 | **能补**（方案 B 颜色叠层 / tint） |

**结论**：
- **能补的**：模糊（已有）、着色（半透明主题色层即可，方案 B 最省事）。
- **补不了的（在 expo-blur 内）**：**饱和度增强**。这是 Android 发灰感的直接来源之一（高斯模糊采样天然会稀释/压暗色彩，iOS 材质靠额外饱和补偿，expo-blur 没有这一环）。
- 要补「饱和」，必须在 RN 层走 **skia（方案 D）** 或原生 **RenderEffect+ColorMatrix（方案 E）**，这两条是唯一能真正还原 iOS 观感的技术路径。

---

## 五、推荐组合建议（针对 blurReductionFactor=2 + intensity=90 + thin material 现状）

### 首选（零/低风险，先做）：参数调教 + 颜色叠层（方案 A + B）

1. **保持** `dimezisBlurViewSdk31Plus` + `blurTarget` 架构不动。
2. **确认 expo-blur 落在含 #43814 修复的版本（SDK 55+）**，避免初始模糊强度 bug。
3. **调教模糊强度**：当前 Android 实际 ≈90/2=45。可把 `blurReductionFactor` 降到 **1**，或把 `intensity` 提到 **100+**，让 Android 模糊强度追上 iOS。
4. **换 tint 为更厚的材质或提升着色**：Folo 用 `systemChromeMaterialLight/Dark`（而非 thinMaterial）+ `intensity=100` 更接近系统观感；按 `colorScheme` 动态切换 light/dark 端。
5. **叠加半透明主题色层**：在 BlurView 上叠一层 `rgba(品牌色/主题色, 0.1~0.2)`，补「着色」、压住发灰。
6. 预期：能明显缩小与 iOS 的差距（模糊强度、着色、明暗），**但饱和度增强仍缺**。

### 进阶（若要求高度还原 iOS 质感）：skia 三件套（方案 D）

用 `BackdropBlur` + `ColorMatrix`（饱和 s≈1.2–1.5）+ 着色层，一次性补齐「模糊+饱和+着色」。成本最高，建议在低风险调教后仍不满意再评估，且需 dev build。

### 不推荐（本项目 Android 优先）

- 方案 F（expo-glass-effect 不支持 Android）。
- 方案 E（原生自封装）成本最高，仅在 skia 方案也扛不住性能时才考虑。

---

## 来源清单

**一手（GitHub / 官方文档 / AOSP / npm）**
- expo-blur 官方文档（Android 支持 / blurReductionFactor / intensity / tint / blurMethod / Known issues / borderRadius）：https://docs.expo.dev/versions/latest/sdk/blur-view/
- expo-blur Issue #29465（Android 不像 iOS 被关闭为问答题）：https://github.com/expo/expo/issues/29465
- expo-blur PR #43814（blurReductionFactor 初始值 bug 修复，SDK 55）：https://github.com/expo/expo/pull/43814
- expo-blur 相关 issue 检索：https://api.github.com/search/issues?q=repo:expo/expo+blur+android+in:title
- margelo/react-native-blur（@react-native-community/blur 现状）：https://github.com/margelo/react-native-blur
- dimezis/BlurView（Android 底层实现：blurRadius/blurSampling/overlayColor）：https://github.com/dimezis/BlurView
- RN Skia Backdrop Filters（BackdropBlur/BackdropFilter+ColorMatrix）：https://shopify.github.io/react-native-skia/docs/backdrops-filters/
- RN Skia Color Filters（饱和度/对比度矩阵）：https://shopify.github.io/react-native-skia/docs/color-filters/
- expo-glass-effect 官方文档（仅 iOS/tvOS，Android 回退）：https://docs.expo.dev/versions/latest/sdk/glass-effect/
- AOSP 窗口模糊文档（RenderEffect / createColorFilterEffect / ColorMatrixColorFilter）：https://source.android.google.cn/docs/core/display/window-blurs?hl=zh-cn
- Android RenderEffect（.NET 绑定，ColorMatrix/ColorMatrixColorFilter）：https://learn.microsoft.com/zh-cn/dotnet/api/android.graphics.rendereffect.createblureffect

**二手（已标注，交叉验证）**
- Folo ThemedBlurView 模糊优化（intensity=100 + 按主题切换 chrome material）：https://blog.csdn.net/gitblog_00701/article/details/152385290
- 火山引擎《如何在RN中实现局部模糊效果》（Blur + Overlay 多层叠加 / 换色模拟 Material）：https://www.volcengine.com/article/411219
- 火山引擎《React Native模糊视图终极指南》：https://www.volcengine.com/article/866691
- React Native Liquid Glass 对比页（expo-blur / @react-native-community/blur / 饱和度 / 模糊半径）：https://himanshu-lal4.github.io/react-native-liquid-glassmorphism/react-native-blur-alternative/
