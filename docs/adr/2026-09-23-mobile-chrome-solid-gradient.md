# 悬浮 chrome 去毛玻璃：改主题纯色 + 线性渐变

日期：2026-09-23 · 状态：已接受 · 取代：ADR-0005（移动端毛玻璃 Chrome）、ADR-0010（Android BlurView blurTarget）

## 背景

ADR-0005 定了「悬浮 chrome 用毛玻璃」，ADR-0010 分三阶段把 Android 真模糊落地（`BlurTargetView` + `blurTarget`），前提是「页面内容包进 `BlurTargetView`、chrome 在其外作为兄弟节点渲染」。

该前提**只在 tabs 布局（根布局层）成立**。栈页（排行榜 / 歌单 / 专辑 / 歌手 / 收藏 / 历史 / 发现歌单）由 `react-native-screens` 的 Screen 渲染：target 与 BlurView 同处 Screen 子树内时，原生始终采不到目标内容（模拟器与真机一致），表现为「一片平的半透明」。

2026-09-22 加了临时探针实测，栈页 BlurView 挂载时为 `hasScreenTarget=true refReady=true`（接线与时机都正常）却仍无模糊 —— 据此排除「接线/时机」，确认是**跨 Screen 边界的结构问题**。

修法只有一条：把栈页的 target 与播放栏一起提到根布局（tabs 形态）。代价是 7 个屏移除播放栏、全列表补底部内边距、并长期维护「target 与 chrome 的兄弟层级」这一脆弱约束；而 ADR-0005 的更新节本就已把「动画期模糊快照同步性」列为**未验证的残留风险**。

## 决策

1. **移除毛玻璃**：删除 expo-blur 的 `BlurView` / `BlurTargetView` / `blurTarget` 用法，以及「系统减弱透明度」降级分支（`useReducedTransparency`）。
2. **悬浮 chrome 统一为主题纯色 + 线性渐变**：新增 `packages/mobile/components/ChromeSurface.tsx`（`LinearGradient`，`colors.bgPlayer → colors.bgSurface`，上浅下深）。TopBar / 底部 tab 栏 + 迷你播放栏 / 全屏播放页顶栏全部改用它，与全屏播放页背景同语言。
3. **双端一致**：不再有 iOS material 与 Android blur 的差异，也不再需要 Android 着色补偿层（`blurScrim` 的模糊补偿用途）。
4. ADR-0005 / ADR-0010 中与 BlurView 相关的渲染纪律（「BlurView 不得作为自身 blurTarget 的后代」「JS 驱动的尺寸动画不得跨过 BlurView」等）随 blur 一并作废。

## 备选与否决

- **按 tabs 形态把栈页 target/chrome 提到根布局（保留真毛玻璃）**：否决。改动面大（7 屏播放栏外移 + 全列表底部内边距），且把「模糊能否工作」继续绑在原生层级约束上；一旦 `react-native-screens` 或 expo-blur 行为变化就会再次**静默**退化（本次即是）。
- **只在栈页降级为半透明、tabs 保留毛玻璃**：否决。同一 app 两种材质、观感割裂，且要维护两套代码路径。
- **保留毛玻璃但加大不透明度**：否决。等于放弃模糊本身，却仍背着原生依赖与层级约束。

## 后果

- 悬浮 chrome 的观感完全由主题 token 决定：可预期、可单测、不依赖原生采样；栈页与 tabs 观感一致。
- 删除三处实现：`components/ChromeBlur.tsx`、`components/ScreenBlur.tsx`、`hooks/useReducedTransparency.ts`；`app/(tabs)/_layout.tsx` 去掉 `BlurTargetView` 包裹。
- `expo-blur` 依赖仍留在 package.json（本次只去用法，彻底移除依赖另开清理）。
- 若将来要在 Android 上重新引入真模糊：必须先给出「跨 Screen 边界可采样」的原生验证，并重新评估本决策。
