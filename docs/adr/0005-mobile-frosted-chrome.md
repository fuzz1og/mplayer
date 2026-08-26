# 移动端毛玻璃悬浮 chrome（expo-blur）

移动端 TopBar / PlayerBar 原为纯 rgba 半透明材质（`bgPlayer: 'rgba(255,255,255,0.96)'`，浅色下与白底明度差为零、近乎隐形）。按 iOS HIG「毛玻璃（UIBlurEffect）」要求引入 `expo-blur` 的 `BlurView`，TopBar/PlayerBar 的悬浮 chrome 改为 `ChromeBlur` 容器（浅色 `systemThinMaterialLight`、深色 `systemThinMaterialDark`，intensity 90）；`AccessibilityInfo.isReduceTransparencyEnabled` 时回退纯 rgba，Android 原生开 dimezisBlurView 真 blur、Expo Go 回退半透明。桌面端暂不动（本次 PR 仅移动端）。

**实施边界**：底部 tab 栏（`(tabs)/_layout.tsx`）与 PlayerOverlay 因处于 Animated 收起/渐变覆盖层内、blur 有性能与视觉问题，本次保持 `bgPlayer` 半透明，不套 ChromeBlur。

**Status**: accepted

**Considered Options**: 保持纯 rgba（被否：浅色下 chrome 隐形是已记录的真机问题）；每端自绘 blur 近似（被否：expo-blur 是标准库，自绘成本高且 Android 同样受限）。

**Consequences**: 新增 expo-blur 依赖，需真机（Expo Go）验证 iOS 材质观感；reduced-transparency 用户的 chrome 回退纯色后布局不变（只换背景）；Android 观感维持现状。
