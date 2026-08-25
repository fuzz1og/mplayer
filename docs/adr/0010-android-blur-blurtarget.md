# Android 毛玻璃不生效：expo-blur SDK 55+ 需 blurTarget

## 问题

`ChromeBlur.tsx` 用 expo-blur 的 `BlurView`，传了 `experimentalBlurMethod="dimezisBlurView"` + Android 叠加 `bgPlayer` 半透明底，但在 Expo Go（Android 模拟器）上几乎无模糊效果，背景文字清晰透出。

## 根因（非 Expo Go 限制，而是 API 用法错误）

安装的 `expo-blur@57.0.2` 已切换到 **SDK 55+ 的新 BlurView API**：Android 上要真正 blur，**必须**把待模糊内容包进 `<BlurTargetView>`，并把其 ref 通过 `blurTarget` 传给 `BlurView`。

本地原生源码印证（`node_modules/expo-blur/android/src/main/java/expo/modules/blur/ExpoBlurView.kt`）：

```kotlin
val safeMethod = if (blurTarget != null) method else BlurMethod.NONE
...
private fun configureBlurView() {
  if (blurTarget == null || blurMethod == BlurMethod.NONE) {
    blurView.setBlurEnabled(false)   // ← 无 blurTarget 一律禁用 blur
    blurConfiguration = BlurViewConfiguration.NONE
    return
  }
  ...
}
```

即：`blurTarget == null` 时原生侧直接回退 `none` blur method，只渲染半透明覆盖层（当前代码里的 `bgPlayer`），**从不会发生真模糊**。JS 侧也会 `console.warn` 提示未配置 `blurTarget` 会回退到 `none`。

另外 `experimentalBlurMethod` 在 57.x 已 **deprecated**，应改用 `blurMethod`。

## Expo Go 可用性

Expo Go 内**内置** expo-blur（官方文档标注 "Included in Expo Go"），Android 12+（SDK 31）走 RenderNode API 高效模糊、更低版本走已弃用的 RenderScript。**因此毛玻璃在 Expo Go 下天然可用**——之前「几乎无模糊」的真正原因是没有配置 `blurTarget`，而非 Expo Go 限制。

## 正确启用方式

```tsx
import { BlurView, BlurTargetView } from 'expo-blur';

const targetRef = useRef<View | null>(null);

<View>
  {/* ① 待模糊的动态内容包进 BlurTargetView，取 ref */}
  <BlurTargetView ref={targetRef} style={{ flex: 1 }}>
    {动态内容}
  </BlurTargetView>
  {/* ② BlurView 用 blurTarget 指向它 */}
  <BlurView blurTarget={targetRef} blurMethod="dimezisBlurView" ...>
    {悬浮内容}
  </BlurView>
</View>
```

- `blurMethod="dimezisBlurView"`（或推荐 `dimezisBlurViewSdk31Plus` 避开旧系统性能损耗）。
- 多个 `BlurView` 可共享同一 `BlurTargetView`，效率更高。
- 已知坑：`BlurView` 需在动态内容（如 FlatList）**之后**渲染，否则模糊不更新；Android 上 `borderRadius` 可能不生效，需 `overflow: 'hidden'`。

## 本 PR 落地（P0-1 范围约束）

`PlayerOverlay.tsx` 的 `contentWrap` 是 `Animated.View`（`translateY`/`scale`/`opacity` 均走 native driver），BlurView 无法直接嵌入 Animated 节点（与开合动画冲突）。故采取折中：

- `contentWrap` 背景由 `colors.bgSurface`（纯实底）改为 `colors.bgPlayer`（半透明），下滑关闭时底下内容透出材质。
- 顶部栏 `customHeader` 单独套 `ChromeBlur`，与 TopBar/PlayerBar 语言一致。
- `ChromeBlur` 本身的 `blurTarget` 适配（TopBar/PlayerBar/PlayerOverlay 共用）涉及把各容器内容整体包进 `BlurTargetView`，结构改动较大，属后续独立 PR 范围；本 PR 仅做半透明降级 + 顶部栏 ChromeBlur。

## 第二阶段（真 blur）追加：render 期 ref 判空 + PlayerBar 在 target 子树内

首版落地后模拟器仍无真模糊。追加两处根因：

### 根因一：`ChromeBlur` 里用 `chromeBlurTargetRef.current == null` 做 render 期降级
`chromeBlurTargetRef.current` 只在 **React commit 阶段**挂到 `BlurTargetView` 宿主节点；`ChromeBlur` 组件 **render 期**取值恒为 `null`。于是 ChromeBlur 首帧就渲染半透明 `<View>` 降级，且 ref 挂载不会触发重渲染，`<BlurView>` 永远不挂载 → 顶部 chrome 恒为纯半透明、从不模糊。

修复：**删除该 render 期判空降级**。`BlurTargetView` 在 Tabs 布局中排在 TopBar/PlayerBar 之前渲染，`BlurView` 的 `componentDidMount` 读 `blurTarget.current` 时 ref 已就绪（ref 在 mutation 阶段先于兄弟节点的 componentDidMount 挂载）；target 缺失时原生侧自动回退 none，无需 JS 提前拦截。

### 根因二：PlayerBar 嵌在自身 blurTarget 的子树内
PlayerBar 原由 `AnimatedTabBar`（Tabs 的 `tabBar` prop）渲染，而 `<Tabs>` 被包在 `<BlurTargetView>` 内 → PlayerBar 的 BlurView 是自身 blurTarget 的后代。`ExpoBlurTargetView` 会把所有子节点代理进其内部 blur 目标视图，BlurView 试图模糊包含自身的视图 → dimezis 自包含失效/降级。

修复：把 PlayerBar 从 `AnimatedTabBar` 拆出，放到 `(tabs)/_layout.tsx` 顶层、`BlurTargetView` **之外**渲染，保留搜索页 tab 收起时的底部安全区逻辑（`isSearch ? 0 : tabBarHeight` 定位 + `isSearch` 时 `paddingBottom: insets.bottom`）。

### 验证
`npm run typecheck:mobile` + `npm run lint`（零警告）通过；Expo Go 冷启后 logcat **无** `blurTarget has not been configured` 回退警告、无 React 运行时错误（原 `playerVisible` ReferenceError 已消），说明 BlurView 已拿到有效 blurTarget。

## 第三阶段（tab 栏真 blur）：把整个底部 chrome 移出 BlurTargetView

tab 栏与 PlayerBar 同因——原由 expo-router Tabs 的 `tabBar` prop（AnimatedTabBar）渲染，而 `<Tabs>` 被包在 `<BlurTargetView>` 内 → 自包含失效，tab 栏只能半透明（`bgPlayer`）。

调查结论：
- `BottomTabView`（expo-router 内置 react-navigation bottom-tabs）把 `tabBar` 与 scenes 渲染为 **SafeAreaProviderCompat 下的兄弟节点**，无任何 prop 可让 `BlurTargetView` 只包 scenes 而不包 tabBar。
- 各 tab 屏的滚动让位 padding 走 `chromeMetrics.bottomChromeHeight`（唯一事实源），**不依赖** react-navigation 的 `BottomTabBarHeightContext`——故移除 Tabs 内置 tabBar 不会破坏内容底部让位。
- 因此采用与 PlayerBar 一致的方案：**`tabBar={() => null}` 移除内置 tabBar，把「tab 栏 + 迷你播放栏」合并成一个 `BottomChrome` 组件，在 TabLayout 顶层、`BlurTargetView` 之外渲染**；tab 切换改用 `router.navigate(href)`（TABS 静态清单，href 走 Href 类型），当前 tab 用 `usePathname()` 判定；搜索页 tab 收起动画保留。tab 栏与 PlayerBar 均套 `ChromeBlur`，Android 真 blur。

### PlayerOverlay 结论（不实施真 blur）
PlayerOverlay 实际是 `RootLayout` 里**同窗口的绝对定位全屏覆盖视图**（非 RN Modal），其 customHeader 的 ChromeBlur blurTarget 指向 tabs 内容（同窗口、有效）。但 `contentWrap` 用 `bgPlayer`（浅 0.96 / 深 0.85）近实底覆盖全屏，全屏播放器语义上「模糊底下 tabs」价值有限，且 Animated contentWrap 与 BlurView 冲突（ADR-0005 原边界）。**保持半透明降级**，仅 customHeader 套 ChromeBlur 提供材质深度。

### bgPlayer 深色不调
TopBar/PlayerBar/tab 栏现已真 blur，BlurView 覆盖 bgPlayer，故改 `bgPlayer` 0.85→0.9x 对这些毛玻璃表面**不可见**（这正是「观感没变化」的原因）。bgPlayer 仅影响 reduced-transparency/web 降级与 contentWrap/playerWrap。**不调高**——真正的观感修复是 blur（已落地），而非提高降级不透明度。

## Status

accepted（三阶段落地）

## Consequences

- Android（含 Expo Go）上 TopBar / PlayerBar / 底部 tab 栏三处悬浮 chrome 均真 blur。
- tab 栏从 Tabs `tabBar` prop 改为 TabLayout 顶层手动渲染（`router.navigate` 驱动，路径与 `<Tabs.Screen>` 一致）；如需改 tab 清单需同步 TABS 常量。
- PlayerOverlay 保持 bgPlayer 半透明 + customHeader ChromeBlur，为既有设计边界。
