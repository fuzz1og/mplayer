# 移动端毛玻璃悬浮 chrome（expo-blur）

移动端 TopBar / PlayerBar 原为纯 rgba 半透明材质（`bgPlayer: 'rgba(255,255,255,0.96)'`，浅色下与白底明度差为零、近乎隐形）。按 iOS HIG「毛玻璃（UIBlurEffect）」要求引入 `expo-blur` 的 `BlurView`，TopBar/PlayerBar 的悬浮 chrome 改为 `ChromeBlur` 容器（浅色 `systemThinMaterialLight`、深色 `systemThinMaterialDark`，intensity 90）；`AccessibilityInfo.isReduceTransparencyEnabled` 时回退纯 rgba，Android 原生开 dimezisBlurView 真 blur、Expo Go 回退半透明。桌面端暂不动（本次 PR 仅移动端）。

**实施边界**：底部 tab 栏（`(tabs)/_layout.tsx`）与 PlayerOverlay 因处于 Animated 收起/渐变覆盖层内、blur 有性能与视觉问题，本次保持 `bgPlayer` 半透明，不套 ChromeBlur。

**Status**: accepted

**Considered Options**: 保持纯 rgba（被否：浅色下 chrome 隐形是已记录的真机问题）；每端自绘 blur 近似（被否：expo-blur 是标准库，自绘成本高且 Android 同样受限）。

**Consequences**: 新增 expo-blur 依赖，需真机（Expo Go）验证 iOS 材质观感；reduced-transparency 用户的 chrome 回退纯色后布局不变（只换背景）；Android 观感维持现状。

## 更新（2026-09-10，架构评审候选 07 / Q7b=B2）

「实施边界」中「底部 tab 栏……不套 ChromeBlur」一条已被 ADR-0010 第三阶段取代：tab 栏移出 `BlurTargetView` 后套上了 `ChromeBlur`，但仍处于两层 `Animated.View` 内（外层为 JS 驱动的 height 收起动画）。真机验证过「拿到有效 blurTarget、无回退警告」，但**动画过程中的模糊快照同步性未单独验证**。

本次评审决定（B2）：**保留现状**，不改动工作正常的渲染结构；把纪律精确化为「BlurView 不得作为自身 blurTarget 的后代；不得让 JS 驱动的尺寸/布局动画跨过 BlurView（收起用固定尺寸裁剪 + transform）」，并在 `docs/agents/mobile-ios-design-guide.md` 标注本处为已知例外与残留风险。若日后真机复现动画期模糊不同步，按下述 B1 重构：固定高度 + `overflow:hidden` 裁剪宿主，只保留 `translateY`（native driver），blur 表面尺寸恒定。
