# 移动端：横向分页 / 无限旋转动画调研

> 背景：RN 全屏播放器目前用 **PanResponder 做词/封两页横向切换**（pageX 平移，范围 `[-winW, 0]`，松手按 `pageX` 绝对值位置 30% 阈值判定），以及用 **JS rAF 自增角度驱动唱片旋转**。本文调研 iOS 分页判定机制与 RN 无限旋转最佳实践，给出可落地数值与适配建议。
>
> 日期：2026-08 · 调研员：pager-rotation-research

---

## 主题 A：iOS 横向分页 / 滑动切换的交互规范与实现机制

### A1. iOS `UIScrollView.pagingEnabled` 的分页判定机制

**结论：`pagingEnabled` 的落点判定是「位移（距离）主导」，阈值是页宽的一半（50%）；速度只影响减速动画的时长/手感，不改变最终落点。** 只有当手势位移超过页面宽度一半时，才会吸附到下一页；否则回弹到当前页。这一判定遵循「四舍五入到最近页边界」的规则：`targetPage = round(contentOffset.x / pageWidth)`。

- Apple 官方：`UIScrollView.pagingEnabled` 会把滚动视图 bounds 的尺寸当作一页，停止拖动时吸附到最近的整数页边界。
  - https://developer.apple.com/documentation/uikit/uiscrollview （`isPagingEnabled` 说明；页面需 JS 渲染，正文描述见官方类文档）
  - https://developer.apple.com/documentation/uikit/uipageviewcontroller/ （UIPageViewController 按页管理，切换由系统滚动/翻页手势驱动）
- 社区对系统行为的一致描述：阈值 = `pageWidth / 2`，大于则进下一页、小于则回当前页；速度只改减速动画曲线不改落点。
  - https://stackguides.com/questions/28145185/modify-uiscrollview-to-have-a-stronger-paging-retainance-for-the-user （系统 `pagingEnabled` 位移超过 50% 才翻页）
  - https://stackguides.com/questions/11561992/sensitivity-scroll-speed-of-uiscrollview-with-paging （paging 下是「一页一页」翻，快速滑动也不会跨多页）

**补充（更高阶，来自 WWDC）：现代 iOS 手感的判定其实是「速度投影 + 就近吸附」**。`scrollViewWillEndDragging(_:withVelocity:targetContentOffset:)` 允许你把初速度投影出惯性落点，再吸附到最接近的页/锚点。Apple 在 WWDC 里强调：**用手指的离开速度来预测静止位置，再 snap 到最近的目标**，而不是只看位移。

- WWDC 2024 “Create fluid and interactive interfaces”（滚动位置锚点 / snapping 与物理）：
  - 间接来源（抓取到的该 session 要点转录）：https://tool.lu/skill/s/hFo
  - 该 session 相关 SwiftUI `scrollPosition` / snapping 的解读：https://cloud.tencent.cn/developer/article/2451552
- WWDC 2018 “Designing Fluid Interfaces”（速度/惯性/弹性边界的设计原则，被广泛引用）：
  - 二手整理：https://surfskills.surf/s/emilkowalski/skills/apple-design

**可落地数值（iOS 标准）：**
- 距离阈值：**页面宽度的 50%**（`pagingEnabled` 内置）。
- 现代实现（WWDC 推荐）：**距离 OR 速度** 双条件，速度优先投影落点（见 A3 社区/官方数值）。

### A2. iOS 全屏媒体/照片分页（Apple Music、Photos）的手感

Apple Music 与 Photos 的横向照片/页面浏览本质上就是系统 `UIScrollView`/`UIPageViewController` 的 paging，因此：
- **跟手比例 = 1:1**（手指移动多少，内容移动多少，无阻尼、无滞后）。
- **松手判定 = 位移阈值 + 速度的组合**：慢速拖动看「是否过半」（50%）；快速甩动看速度，快速滑（flick）即使位移不过半也会切页。
- **边界 bounce/阻尼**：首尾页有弹性回弹（`bounces`），页间切换带平滑惯性减速（deceleration），结束时有轻微过冲再回正（弹性落位）。
- 具体到“滑动过半自动跳”的系统内置阈值就是 `pageWidth / 2`；速度阈值没有公开硬数字，但社区与 RN 生态常用的等效阈值约为 **500 px/s 量级**（见 A3）。
- 来源：Apple 类文档（同上 A1 的 UIScrollView/UIPageViewController 链接）+ WWDC 2018/2024（速度投影、惯性、弹性边界）二手转录 https://surfskills.surf/s/emilkowalski/skills/apple-design

> 说明：Apple 官方未公开 Apple Music/Photos 内部的确切 px 阈值与阻尼参数（属于私有实现，文档不披露）。能确证的是“使用系统 paging + 速度投影 + 弹性边界”这套机制。

### A3. 社区对 RN 自实现 pager 的推荐（PanResponder / reanimated / pager-view）

**核心结论：不要在 PanResponder + JS 线程上自造分页逻辑，尽量用原生方案。** 但若保留 PanResponder（贴合现状），社区给出的判定与动画参数如下。

**官方/权威参考：**
- **react-native-pager-view**（callstack，iOS 用原生 `UIPageViewController`、Android 用 `ViewPager`）——把手势分页交给原生，最流畅，规避 JS 线程卡顿。RN Tab View 在 iOS/Android 上底层就是它。
  - https://github.com/callstack/react-native-pager-view
  - https://www.npmjs.com/package/react-native-pager-view
- **react-native-tab-view 的 PanResponder 实现（`PanResponderAdapter`）** —— 这是 RN 生态里最接近“用 PanResponder 做分页”的成熟开源实现，可直接参考它的判定与动画常量：
  - 源码：https://github.com/satya164/react-native-tab-view/blob/master/src/PanResponderAdapter.tsx
  - 实际常量（抓取自源码）：
    - 速度阈值 `swipeVelocityThreshold = 0.15`（单位 px/ms，≈ 150 px/s 量级，注意它配合“OR 距离”使用）
    - 距离阈值 `swipeDistanceThreshold = layout.width / 1.75 ≈ 57%` 屏宽
    - 判定：`|dx|>|dy|` 且 `(|dx| > 距离阈值 || |vx| > 速度阈值)` —— **OR 关系**（位移过半 OR 甩动够快都算翻页）
    - 落位动画：`Animated.spring`，`stiffness: 1000, damping: 500, mass: 3, overshootClamping: true`
    - 用 `useNativeDriver: false`（因为 PanResponder 驱动 JS 值）
- **Reanimated 官方文档（Handling Gestures）** —— 官方给的分页判定示例更激进、更现代：
  - https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/handling-gestures/
  - 示例判定：`translationX < -width * 0.2 || velocityX < -500`（**距离 20% OR 速度 500 px/s**），落位用 `withSpring`。

**社区通用建议区间：**
- 距离阈值：**25%–40%**（比系统的 50% 更轻快，避免“滑 70% 才回一页”的笨重感）；对两页切换，推荐 **30%–40%**。
- 速度阈值：**约 500 px/s**（快甩即使位移不够也切页）。
- 跟手：**1:1**（手指跟到底，无阻尼）。
- 弹簧落位：`stiffness ~ 1000`、`damping ~ 500`、`mass ~ 3`（tab-view 参数），或 reanimated `withSpring` 默认 + `overshootClamping` 视需要。

### A4. 对我们现状的适配建议（PanResponder 词/封两页切换）

现状：跟手 1:1 是合理的；问题是**只按 `pageX` 绝对值位置判 30% 阈值，没看速度**，导致“从第二页切回第一页要滑 70% 屏宽”。这正是“只做位移判定、缺速度判定”的症状。

**推荐调整（保持 PanResponder，改动最小、立竿见影）：**
1. **判定条件改成「位移 OR 速度」**，且两者都是绝对值判断：
   - 位移阈值：**30% 屏宽**（两页场景；比系统 50% 轻、比 tab-view 57% 轻），即 `Math.abs(pageX) > winW * 0.3`。
   - 速度阈值：**500 px/s**（用 `gestureState.vx`，PanResponder 直接给到，无需自算），即 `Math.abs(vx) > 500`。
   - 任一条满足即翻页；否则回弹当前页。这样从第 2 页快速往右甩，哪怕只滑 30% 屏宽也会回第 1 页。
2. **落位动画用弹簧而非硬切**：目标 `offset` 为 `0`（词页）或 `-winW`（封页），用 `Animated.spring(translationX, { toValue, stiffness: 1000, damping: 500, mass: 3, overshootClamping: true, useNativeDriver: true })`。（`translationX` 若已用于跟手且由 PanResponder 驱动，注意弹簧阶段可切回 native driver；或整体保持 JS 驱动如 tab-view。）
3. **跟手保持 1:1**，不要引入阻尼/滞后，否则丢失 iOS 手感。
4. **可选升级**：两页场景极简，可用 `react-native-pager-view` 包一个原生横向 pager（iOS 原生 UIPageViewController），彻底消除 JS 线程跟手卡顿；代价是引入原生依赖。若只是词/封两页，成本低、收益高。

---

## 主题 B：RN 旋转动画（无限旋转）最佳实现

### B1. 为什么 `Animated.loop` 的 0°→360° 会出现“跳回 0° 断裂”

**机制澄清：** `rotate` 本质是一个带单位的字符串（`'0deg'→'360deg'`），由 `interpolate` 映射：

```jsx
value.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });
```

`Animated.loop` 每轮把 `value` 从 0 走到 360，然后在下一轮**硬重置回 0**。因为 **360° ≡ 0°（圆是周期的）**，只要重置是“离散瞬时”的，视觉上应当是**无缝**的——这取决于驱动方式：

- **原生驱动（`useNativeDriver: true`）**：动画在 UI 线程跑，重置是硬跳，360→0 在视觉上无差，**本应是无缝的**。
- **JS 驱动（默认/`false`，即你们之前 rAF 或未开 native driver 的情形）**：每帧通过 JS 桥重算 rotate 字符串。在 360 跳回 0 的那一帧，插值在边界处可能算出中间值、或该帧 transform 短暂缺失/重算，出现**肉眼可见的“闪断/回跳”**。此外 JS 线程任何阻塞都会放大这类跳变。

**你们之前“Animated.loop 每圈结束跳回 0° 断裂”的最可能原因：**
1. 使用了 **JS 驱动**（`useNativeDriver: false` 或没开），360→0 重置在 JS 线程上发生，帧间出现过渡/缺失。
2. 或 `interpolate` 的 `outputRange` 写成了带余量的范围（如 `['0deg','720deg']`）而 `toValue` 又循环回 0，导致落点不一致。
3. 或旋转值 `toValue` 是 `360` 但循环 `iterations` 设置/复用时数值没归零衔接好。

- React Native 官方文档（native driver 支持 transform/rotate、仅非布局属性、Android `rotateX/Y` 需 `perspective`、JS 线程阻塞会掉帧）：
  - https://reactnative.cn/docs/0.76/animations
  - https://reactnative.cn/docs/animated
  - https://rn.nodejs.cn/docs/animated
- Reanimated 官方 `withRepeat` 文档（0°→360° + `reverse:false` 才是无缝连续旋转；`reverse:true` 会来回摆）：
  - https://docs.swmansion.com/react-native-reanimated/docs/animations/withRepeat/

**正确写法要点：**
- 转一圈就用 `0deg → 360deg`，**不要**用 `0 → 720` 再回 0 的多圈方案（回 0 那下若不是整数圈会在中途断）。
- 循环单位必须是**整圈**（360°），才能保证每圈结束状态 == 下一圈开始状态。
- **尽量 `useNativeDriver: true`**，让 360→0 的重置发生在原生端、无 JS 帧闪烁。

### B2. reanimated 方案（withRepeat + withTiming）vs Animated 方案

| 维度 | `Animated.loop` + `useNativeDriver` | reanimated `withRepeat(withTiming(360), -1, false)` |
|---|---|---|
| 执行线程 | UI 线程（开 native driver 时） | UI 线程（共享值 + worklet） |
| 无限循环 | `Animated.loop(anim, {iterations: -1})` | `withRepeat(anim, -1)`（`numberOfReps=-1/0` 无限） |
| 360° 无缝 | 原生驱动下本应无缝；JS 驱动易闪断 | UI 线程下 360→0 无缝，官方示例即此写法 |
| 播放/暂停控制 | `anim.stop()` / `.reset()` / `.start()`，需小心从当前值续 | `cancelAnimation()` / 直接再 `withTiming` 赋值续转，更自然 |
| 与手势/其它 worklet 联动 | 弱（Animated 与 reanimated 值不互通） | 强（共享值可被手势 worklet 直接读） |
| 依赖 | RN 内置 | 需装 `react-native-reanimated` |

**推荐：** 若项目已（或可）装 `react-native-reanimated`，用 `withRepeat(withTiming(360,...), -1, false)` + `useAnimatedStyle` 是最干净、最无跳变的无限旋转写法。若不想加依赖，则 **`Animated.loop` + `useNativeDriver: true`**（注意 Android 上 `rotateX/rotateY` 需 `perspective: 1000`，普通 `rotate`/`rotateZ` 不需要）。

### B3. 播放/暂停/续播时保持当前角度（不跳变）

**正确模型：旋转角度是一个“连续累积”的状态量，暂停时冻结当前值，续播时从当前值继续增长，绝不重置。**

要点：
1. 用一个 `sharedValue`/`Animated.Value` 保存“当前已转总角度”。
2. **播放**：用 `withRepeat(withTiming(当前值 + 360, {duration}), -1, false)`（reanimated）或 `Animated.loop(Animated.timing(angle, {toValue: 当前值 + 360, useNativeDriver: true}))`（Animated）。关键：`toValue` 基于**当前累积值**增量加一圈，而不是固定写死 `360`——这样暂停再续播不会跳回 0。
3. **暂停**：`cancelAnimation()`（reanimated）或 `angle.stopAnimation()`（Animated）——立即冻结当前角度，不丢进度。
4. **续播**：再从冻结的当前值继续加一圈（同上），即可“续转不跳变”。
5. 直接改曲目/重置时，才把角度值归零。

- 参考：reanimated `withRepeat` 文档（`-1` 无限、`reverse:false`、回调区分 finished/cancelled）：https://docs.swmansion.com/react-native-reanimated/docs/animations/withRepeat/
- React Native `Animated.stopAnimation`/`loop`（暂停/续播由 stop/start 管理）：https://reactnative.cn/docs/animated

### B4. 为什么 JS rAF 驱动旋转会卡，native driver 为什么流畅

**结论：JS rAF 每帧都要“读当前值 → JS 线程重算 → 过 JS 桥写到原生 transform”，整个链路受 JS 线程占用与 Bridge 吞吐限制；一旦 JS 线程被其它工作（渲染、网络、其它动画、setState）占用，单帧超 16ms 就掉帧，表现为“一卡一卡”。** 原生驱动则把动画曲线一次性下发到原生，由 UI 线程逐帧更新 transform，完全不经过 JS 线程，因此 JS 再忙也不掉帧。

- RN 官方文档明确建议：动画掉帧时**优先把动画放到 UI 线程（`useNativeDriver: true`）**，并将计算密集工作推迟（`requestIdleCallback`/`InteractionManager`），用 FPS Monitor 监控。
  - https://reactnative.cn/docs/0.76/animations
  - https://reactnative.cn/docs/animations
- reanimated 官方把手势/动画放 UI 线程、共享值不触发 JS 通信，就是为规避 JS 线程瓶颈：https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/handling-gestures/

**推荐实现（含代码要点）：**

*方案一（无新依赖，改最少）—— `Animated.loop` + native driver：*
```jsx
const angle = useRef(new Animated.Value(0)).current;

const play = () => {
  angle.stopAnimation();                      // 从当前值续，不跳变
  Animated.loop(
    Animated.timing(angle, {
      toValue: 360,                            // 一圈；loop 会自动在 360→0 无缝重置
      duration: 60000,                         // 每圈时长（按 rpm 换算）
      useNativeDriver: true,                   // 关键：原生驱动，消除 JS 卡顿
      isInteraction: false,                    // 避免阻塞列表渲染
    }),
    { iterations: -1 }
  ).start();
};
const pause = () => angle.stopAnimation();     // 冻结当前角度
// ...
<Animated.Image
  style={{ transform: [{ rotate: angle.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }) }] }}
  source={...}
/>
```
> 注意：若此前“跳回 0 断裂”是 JS 驱动造成的，`useNativeDriver: true` 即可修复大部分问题（360→0 在原生端瞬时、无缝）。

*方案二（推荐，若可加 reanimated）—— `withRepeat(withTiming)` 连续角：*
```tsx
const angle = useSharedValue(0);
const spin = () => {
  cancelAnimation(angle);
  angle.value = withRepeat(withTiming(angle.value + 360, { duration: 60000 }), -1, false);
};
const pause = () => cancelAnimation(angle);   // 冻结
const resume = () => spin();                   // 从 angle.value 继续 +360
const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));
```
> `toValue: angle.value + 360` 是“连续累积不归零”的关键——彻底规避任何 0° 回跳，续播不跳变。

---

## 附：关键来源汇总

**主题 A（分页）：**
- Apple `UIScrollView`：https://developer.apple.com/documentation/uikit/uiscrollview
- Apple `UIPageViewController`：https://developer.apple.com/documentation/uikit/uipageviewcontroller/
- 系统 paging 50% 阈值（社区）：https://stackguides.com/questions/28145185/modify-uiscrollview-to-have-a-stronger-paging-retainance-for-the-user
- paging 一页一页不跨页：https://stackguides.com/questions/11561992/sensitivity-scroll-speed-of-uiscrollview-with-paging
- WWDC 2018 “Designing Fluid Interfaces” 二手整理：https://surfskills.surf/s/emilkowalski/skills/apple-design
- WWDC 2024 “Create fluid and interactive interfaces” 要点转录：https://tool.lu/skill/s/hFo ；解读 https://cloud.tencent.cn/developer/article/2451552
- react-native-pager-view：https://github.com/callstack/react-native-pager-view
- react-native-tab-view PanResponder 实现：https://github.com/satya164/react-native-tab-view/blob/master/src/PanResponderAdapter.tsx
- reanimated 手势分页示例：https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/handling-gestures/

**主题 B（旋转）：**
- RN 官方动画文档（native driver / rotate / 线程）：https://reactnative.cn/docs/0.76/animations 、https://reactnative.cn/docs/animated 、https://rn.nodejs.cn/docs/animated
- reanimated `withRepeat`：https://docs.swmansion.com/react-native-reanimated/docs/animations/withRepeat/
- reanimated 手势/UI 线程原理：https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/handling-gestures/

**未能获取（如实说明）：** Apple 官方未公开 Apple Music/Photos 的确切内部 px 阈值与阻尼参数（私有实现）；`developer.apple.com` 类文档页需 JS 渲染，正文阈值取自社区对系统行为的一致验证；`react-native-reanimated` 关于旋转的 GitHub Discussion #3918 抓取超时未取到正文。
