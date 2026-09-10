# 移动端 BottomSheet 把手拖拽调研 —— 标准做法、本仓库差异与根因

> 背景：MPlayer 的底部弹层壳 `BottomSheet` 在 `Modal` 内用 `PanResponder` 实现「按住把手下滑关闭」。真机反馈「把手拖不动」，且 `adb shell input swipe` 驱动的自动化用例表现反常（弹层像被点了一下就关闭，而非走拖拽路径）。本文调研 RN 官方 responder 语义、官方 Expo / 主流库的实现姿势、Android Material 与 iOS 的**原生基准**，逐条比对仓库实现，给出根因判断与受 ADR-0004 约束的最小修法。
>
> 调研员：mobile-bottom-sheet-drag-research · 日期：2026-09 · 状态：仅文档，未改代码
>
> **代码定位提示**：本文描述的 `useDragToDismiss.ts` / `gestures/dragSession.ts` 不在主 checkout，而在 worktree `.claude/worktrees/mobile-drag-session`（分支 `refactor/mobile-drag-session`，HEAD `12602ee`，issue #301）。该 worktree 在调研期间有**未提交**改动（新增 `claimMode`），详见 §4。
>
> 证据口径：凡标「一手（本地源码）」者，均可在本机 `node_modules/react-native`（版本 0.86.2，`packages/mobile/package.json` 声明 `react-native: 0.86.2`）中逐行核对；同时给出上游 tag `v0.86.2` 的 GitHub URL。二手来源单独标注。

> **落地状态（2026-09-10，父代理核对）**：M1（把手 DOWN 即认领 + 拒绝让出）已在 PR #303 的 c8cb719 落地并经真机验证——面板中速下拉 → release basis=194px ratio=0.4 vy=168px/s → dismiss（面板关、播放器保留）；轻拖 → vy=31px/s → snapBack；快甩 → vy=868px/s → dismiss；播放器自身 → basis=616px ratio=0 → dismiss。诊断日志已在 5efdf56 删除，错误归因注释已按 §2.1 源码更正。M2（把手热区 ≥44–48dp + hitSlop）本文件入库后随即排期；M3（遮罩位移闸）属产品取舍，未做；M5 经核对：scripts/mobile-e2e.sh 既有 swipe 均为列表滚动，并无把手拖拽用例（如需新增，起点取「面板顶部 + 热区一半」并用 [drag] 日志断言）。

---

## 一、背景 / 一句话结论

**一句话结论：「把手拖动不响应」最可能的根因不是「Modal 吞掉了 move 事件」，而是 RN 在 Android 上于 `ACTION_DOWN` 时刻锁定 touch target、后续 `ACTION_MOVE` 只派发给该 target 及其祖先；而 MPlayer 把拖拽手势挂在一个 40dp 的叶子 View（`grabberZone`）上、却只在 move 阶段认领（`onMoveShouldSetPanResponder`）。两者相乘的结果是：只要手指落点不在那 40dp 内，move 认领在结构上永远不会被问到。** 这也正是「同一条 adb 注入在播放器上有效」的原因——`PlayerOverlay` 的 PanResponder 挂在根节点，是任何 touch target 的祖先，永远在协商链路上。

第二句话（同样重要，且是一个**反向证据**）：**「遮罩 Pressable 像被点了一下就关闭」不是「事件丢失」的旁证，恰恰是「落点在遮罩上」的证据。** 遮罩的响应区是整个屏幕，滑动不会离开按压区（`Pressability` 只在离开响应区时才不触发 `onPress`），所以松手即 `onPress`。若落点在把手上而 move 真的丢了，结果是**什么都不发生**（把手没有任何 `onPress`），不会关闭——与观察到的现象矛盾。

⚠️ 但必须同时承认：社区确有一个**切题的历史 issue** —— RN#14295「panResponder doesn't work with Modal」（CLOSED，2017 开 / 2018 关，原报告 RN 0.44.2 + iOS，评论区扩到 Android），正文就是「`onMoveShouldSetPanResponder` is not triggered inside the `Modal` component」。因此**「Modal 吞 move」（R2）不能排除**；只是它解释不了「弹层为什么会关」。两者靠 §四 的一次打点实验判决。

---

## 二、标准实现怎么做的

### 2.1 RN 官方：responder 协商的语义与**边界**

官方文档（一手）：https://reactnative.dev/docs/gesture-responder-system

原文（一手，逐字）：

- 「`View.props.onStartShouldSetResponder: evt => true,` - Does this view want to become responder on the start of a touch?」
- 「`View.props.onMoveShouldSetResponder: evt => true,` - Called for every touch move **on the View** when it is not the responder: does this view want to "claim" touch responsiveness?」
- 「`onStartShouldSetResponder` and `onMoveShouldSetResponder` are called with a bubbling pattern, where the deepest node is called first.」
- 「Before the responder system bubbles up from the deepest component, it will do a capture phase, firing `on*ShouldSetResponderCapture`.」
- 「`View.props.onResponderTerminationRequest: evt => true` - Something else wants to become responder. Should this view release the responder? **Returning true allows release**」
- 「`View.props.onResponderTerminate: evt => {}` - The responder has been taken from the View. Might be taken by other views after a call to `onResponderTerminationRequest`, **or might be taken by the OS without asking**」

注意第一组引文里的 **"on the View"**：文档说的就是「被问到的 View」，而不是「任意 View」。**这是理解本 bug 的钥匙**：move 认领不是广播，候选集是有限的。

`PanResponder` 的 `gestureState` 语义（一手，本地源码）——`Libraries/Interaction/PanResponder.js`：

- 「`dx` - accumulated distance of the gesture **since the touch started**」「`dy` - accumulated distance of the gesture since the touch started」
- 「`dx/dy`: Cumulative touch distance … **Only valid when currently responder (otherwise, it only represents the drag distance below the threshold).**」
- `onPanResponderGrant` 文档注释：「`gestureState.d{x,y}` will be **set to zero** now」
- `onPanResponderTerminationRequest`：`config.onPanResponderTerminationRequest == null ? true : …`（**默认 true = 默认愿意让出**）
- `onShouldBlockNativeResponder`：「Returns whether this component should block native components from becoming the JS responder. Returns **true** by default. Is currently only supported on android.」

源码：https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/Libraries/Interaction/PanResponder.js

⇒ 推论（对应提问 1）：**「只在 move 阶段认领」本身是合法用法，但它有两个硬约束**：(a) 认领判定里的 `dy` 从触摸起点算，不是从认领点算；(b) 一旦 grant，`dy` 归零重新累计，且此后 `onResponderMove` 必然持续送达（哪怕手指移出该 View 的 bounds）——**「认领后能否持续收 move」不是问题，「move 阶段能否被问到」才是问题**。缺省 `onPanResponderTerminationRequest` 返回 true 意味着系统/其他 view 可以中途把响应者收走。

**move 事件的候选集是「DOWN 时刻的 touch target + 其祖先」——一手证据（Android 派发链 + JS 渲染器两层）：**

第一层，Android 原生派发（一手，本地源码）`ReactAndroid/src/main/java/com/facebook/react/uimanager/JSTouchDispatcher.kt`：

- `ACTION_DOWN`：`targetTag = findTargetTagAndSetCoordinates(ev)`，随后以该 tag 派发 `TouchEventType.START`。
- `ACTION_MOVE`：只调 `findTargetTagAndSetCoordinates(ev)` **更新坐标**，派发时用的仍是**旧的 `targetTag`**：`TouchEvent.obtain(surfaceId, targetTag, TouchEventType.MOVE, ev, …)`。
- 注释亦明示：`targetTag` 在 `ACTION_UP`/`ACTION_CANCEL` 才被重置为 −1。

源码：https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/JSTouchDispatcher.kt

第二层，JS 侧协商路径（一手，本地源码）`Libraries/Renderer/implementations/ReactFabric-dev.js` 的 `ResponderEventPlugin`：以事件的 `targetInst`（即上面那个 tag）为起点做两阶段收集——`traverseTwoPhase$1` 先 push 从 inst 到 root 的整条 path，再对整条 path 依次 `"captured"`、再依次 `"bubbled"`；仅当「responder 与 target 的公共祖先 == 当前 responder」时才改用 `…SkipTarget` 变体。

源码（同一文件的上游位置）：https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/Libraries/Renderer/implementations/ReactFabric-dev.js

⇒ **结论：`onMoveShouldSetResponder` 只会在这条链路上被问到。手指 DOWN 落在 A 视图，之后无论滑到哪里，move 认领都只可能由 A 及其祖先作出；A 的兄弟分支（例如同一父节点下另一个子树的 `grabberZone`）结构上收不到这次协商。** 官方文档从未承诺「move-only claim 可以在任意位置生效」。

**顺带修正仓库里的一条错误注释**：worktree 的 `dragSession.ts` 注释写「responder 协商的 capture 阶段只覆盖 root → 目标的父级，PanResponder 挂在目标自身时 capture 不触发」。按上面 `traverseTwoPhase$1` 的实现，**capture 阶段包含 target 自身**；只有「公共祖先 == 当前 responder」时才 skip target。这条注释需要真机打点复核，别当成定论沉淀（它正在被用作「`begin()` 必须挂两处」的理由）。

### 2.2 RN 的 core `Modal` 在 Android 上到底怎么接触摸（一手，本地源码）

`ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt`：

- `DialogRootViewGroup` 实现 `RootView`，**自己持有一个 `JSTouchDispatcher`**，并同时覆写 `onInterceptTouchEvent` 与 `onTouchEvent`，两处都把事件喂给 `jSTouchDispatcher.handleTouchEvent(event, eventDispatcher, reactContext)`。
- `onTouchEvent` 末尾 `return true`，注释：「In case when there is no children interested in handling touch event, we return true from the root view in order to receive subsequent events related to that gesture」。
- Dialog 本体是 `ComponentDialog`；`FLAG_NOT_FOCUSABLE` 在 `show()` **之前**设置、在 `show()` **之后**清掉（`window.setFlags(FLAG_NOT_FOCUSABLE, …)` → `newDialog.show()` → `window.clearFlags(FLAG_NOT_FOCUSABLE)`）。

源码：https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt

⇒ **在 0.86.2 的源码里找不到「Modal 的 Dialog 窗口收不到 move 事件」的支持证据**：它复用与主窗口同一套 `JSTouchDispatcher` 机制（同样在 DOWN 锁 tag）。因此「Modal 吞 move」这一假设应当**降级为待验证**，而不是既定结论（见 §4 的判定实验）。

另外，**RNGH 官方文档明确把 Modal 当作特例**（一手）：https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/getting-started —— 「Keep in mind that **if you want to use gestures in Modals you need to wrap Modal's content with `GestureHandlerRootView`**」。这佐证「Modal 是独立原生 root/window」这一前提本身成立，但不等于「JS responder 链在 Modal 内失效」。

**但「Modal 内 move 认领不触发」确实是一个真实存在过的 RN bug**——本仓库 worktree 注释引用的 **RN#14295** 经核实存在且切题（一手，issue 原文）：

- 标题：「panResponder doesn't work with Modal」；状态：**CLOSED**（2017-06-01 开，2018-03-09 关）；链接：https://github.com/react/react-native/issues/14295
- 正文逐字：「`onMoveShouldSetPanResponder ` is not triggered inside the `Modal` component, when used outside is triggered just fine.」
- 报告环境：**React Native 0.44.2、Platform: iOS**（原报告是 **iOS**！）；后续评论补充到 0.41.2/0.45.1/0.47.1/0.49 且「Platform iOS & android」；评论里给出的 workaround 是「I try to wrap TouchableOpacity outside of the view, it works」。
- **引用纪律**：可以据它说「这是社区报告过的真实问题」，但**不能**据它断定「RN 0.86.2 / Fabric / Android 上机制相同」——它关在 2018 年（新架构之前），原报告平台是 iOS，且线程里没有权威的机制解释。落地为结论前必须有本版本的打点证据（见 §四 判定实验）。

### 2.3 官方 Expo（SDK 57）：把手与拖拽**交给平台**，JS 侧不写手势

这是本题最直接的「官方标准答案」，而且它就在**本仓库的依赖树里**：`packages/mobile/node_modules/expo-router/node_modules/@expo/ui@57.0.12`。

`src/community/bottom-sheet/README.md`（一手，包内文档）：

- 「A **drop-in replacement for `@gorhom/bottom-sheet`** using **native platform bottom sheets**.」
- 「**iOS**: SwiftUI sheet presentation with detents」「**Android**: Material 3 ModalBottomSheet with `expand()`/`partialExpand()` native methods」「**Web**: [vaul](https://github.com/emilkowalski/vaul) drawer with spring-physics gestures」
- 导出表里 **`BottomSheetHandle` = No**，理由栏写「**Native/vaul handles drag indicator**」。
- 兼容表中 `enablePanDownToClose` = Yes；而 `enableContentPanningGesture`、`enableHandlePanningGesture`、`enableOverDrag`、`handleStyle`、`handleIndicatorStyle` 全部「**Accepted, no effect**」。
- 「`GestureHandlerRootView` (from `react-native-gesture-handler`) is unrelated to `@gorhom/bottom-sheet` and can be left in place or removed — **this implementation does not require it**.」

平台侧实现（一手，包内源码）：

- iOS：`src/community/bottom-sheet/BottomSheet.ios.tsx` —— `presentationDragIndicator(handleComponent === null ? 'hidden' : 'visible')`、`interactiveDismissDisabled(!enablePanDownToClose)`、`presentationDetents(detents, …)`。**没有任何手势代码**，拖拽/关闭是系统 sheet 的行为。
- Android：`src/community/bottom-sheet/BottomSheet.android.tsx` —— 把 `handleComponent !== null` 映射为 `showDragHandle`、`enablePanDownToClose` 映射为 `sheetGesturesEnabled`；prop 文档写「Whether to show the **default drag handle** at the top of the bottom sheet. `@default true`」「Whether gestures (**swipe to dismiss**) are enabled on the bottom sheet. `@default true`」（`src/jetpack-compose/ModalBottomSheet/index.tsx`）。**同样没有手势代码**，拖拽是 Compose Material3 `ModalBottomSheet` 的原生行为。

⇒ **官方姿势：把手是平台绘制的一个视觉指示器，拖拽由原生手势实现；应用侧只声明「开/关」「可不可滑关」，不实现 handle gesture。**

### 2.4 主流库：@gorhom/bottom-sheet / react-native-gesture-handler / Vaul

**@gorhom/bottom-sheet（社区事实标准）**——一手，项目 README：https://github.com/gorhom/react-native-bottom-sheet/blob/master/README.md

- v5「written with **Reanimated v3 & Gesture Handler v2**」；v4（已停止维护）「written with Reanimated v2」。
- 关键含义：**gorhom 的把手拖拽跑在 react-native-gesture-handler 的原生手势识别器上，不是 RN core 的 JS responder 链**；动画跑在 Reanimated 的 UI 线程上。它导出的 `BottomSheetHandle` 是一个**独立组件**，与内容滚动的协调靠 RNGH 的手势组合（`simultaneousHandlers`/`waitFor`）完成——这正是它比 `PanResponder` 强的地方。`@expo/ui` 的兼容表（§2.3）反过来给出了 gorhom 的 API 形状（`enableHandlePanningGesture` / `enableContentPanningGesture` / `handleComponent` / `handleIndicatorStyle`），可作为其把手与内容「分而治之」设计意图的旁证。

**react-native-gesture-handler（RNGH）**——一手文档：

- Pan 手势语义：https://docs.swmansion.com/react-native-gesture-handler/docs/legacy-gestures/pan-gesture
  - 「The gesture **activates when a finger is placed on the screen and moved some initial distance**.」
  - `minDistance(value)`：「Minimum distance the finger (or multiple fingers) need to travel before the gesture **activates**.」
  - `activeOffsetX/Y`：「Range along X/Y axis (in points) where fingers travel **without activation** of gesture. Moving outside of this range implies activation of gesture.」→ 这就是「先横后竖」「先竖后横」的方向闸，且它是**在识别器层面**生效的。
  - `failOffsetX/Y`：越界则**判失败**（而不是判成功）。
  - `shouldCancelWhenOutside`：「**Most handlers' shouldCancelWhenOutside property defaults to false**」→ Pan 一旦激活，手指移出该 View 仍继续跟踪（与 `PanResponder` 认领后的行为一致，但激活前的候选集问题在 RNGH 不存在）。
  - 文档还写明「On Android, the default behavior for native components like scroll view, pager views or drawers is different…」——即 RNGH 专门处理了与原生滚动组件的互斥。
- 起点配置：https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/getting-started
  - 「Keep `GestureHandlerRootView` as close to the actual root of the app as possible. It's the entry point for all gestures and all gesture relations. **The gestures won't be recognized outside of the root view**, and relations only work between gestures mounted under the same root view.」
  - Modal 特例（见 §2.2）。
  - 「Another approach is to use React Native's **Animated API**.」→ RNGH 并不强制 Reanimated（对本仓库 ADR-0004 有参考意义，但 ADR-0004 同时也不引 gesture-handler）。

⇒ **RNGH 存在的意义**：把「手势激活/失败/互斥」下沉到**原生识别器**，与 JS responder 链（以及它的 touch-target 锁定、逐 move 协商）解耦；因此「手指落在哪」不再是「谁被问到」的唯一决定因素——识别器挂在一个 view 上，只要该 view 在原生命中链上，激活逻辑由原生统一裁决。

**Vaul（web 底部抽屉）**——一手：https://github.com/emilkowalski/vaul
本文只取其**交互模型**，其「把手/内容/滚动」的分工由 `@expo/ui` 的官方 README 转述为「vaul drawer with spring-physics gestures」，并且 `@expo/ui` 把 `vaul` 直接列为依赖（`@expo/ui@57.0.12` 的 `dependencies` 含 `vaul: ^1.1.2`）。vaul 的核心决策（`dismissible` / `handleOnly` / `scrollLockTimeout` / 依据内容是否可滚动决定「先滚动还是先拖抽屉」）**本仓库没有对应物**：MPlayer 采用「只有把手可拖、内容区零接管」，这反而是 ADR-0007 明确选择的更简单模型（规避 #186 的「点内容误关 / 与 FlatList 抢滚动」）。**这一条属于刻意的差异，不是缺陷。**

### 2.5 Android Material：拖拽面是**整个 sheet**，handle 只是视觉

- 官方 Android 实现（Compose Material3）暴露的开关就是 MPlayer 缺的那一层抽象：`showDragHandle`（默认 true，另有「`ModalBottomSheet.DragHandle` slot for a custom drag handle」）与 `sheetGesturesEnabled`（默认 true，「Whether gestures (swipe to dismiss) are enabled」）——一手证据见 §2.3 的 `@expo/ui` `src/jetpack-compose/ModalBottomSheet/index.tsx`。
- 视图体系实现（`com.google.android.material.bottomsheet.BottomSheetBehavior`）用 `onInterceptTouchEvent` **在父层拦截**触摸流、并以 `ViewConfiguration.getScaledTouchSlop()` 作为「算不算拖动」的阈值——这正是「手势挂在祖先/父层」的范式：**父层拦截不会遇到 touch target 锁定问题，因为它本来就在链路上。**

**源码级证据（一手，Material Components for Android 仓库）：** `lib/java/com/google/android/material/bottomsheet/BottomSheetBehavior.java`
https://github.com/material-components/material-components-android/blob/master/lib/java/com/google/android/material/bottomsheet/BottomSheetBehavior.java

- **父层拦截 + ViewDragHelper**：`viewDragHelper = ViewDragHelper.create(parent, dragCallback);`（:633）；`onInterceptTouchEvent(... CoordinatorLayout parent, V child, MotionEvent event)`（:685）在 `ACTION_DOWN` 记录 `initialY`、`activePointerId`，并先问 `viewDragHelper.shouldInterceptTouchEvent(event)`（:735-739）。
- **阈值 = 系统 touch slop**（不是自定义常数）：`onInterceptTouchEvent` 末尾 `return action == MotionEvent.ACTION_MOVE && hasScrollingChild() && !ignoreEvents && state != STATE_DRAGGING && !isTouchingScrollingChild(parent, event) && … && Math.abs(initialY - event.getY()) > viewDragHelper.getTouchSlop();`（:744-751）。`ViewDragHelper.getTouchSlop()` 即 `ViewConfiguration.getScaledTouchSlop()` 的封装。
- **显式夺取（"起点即接管"的原生写法）**：`onTouchEvent` 里注释「The ViewDragHelper tries to capture only the top-most View. We have to explicitly tell it to capture the bottom sheet in case it is not captured and the touch slop is passed.」，随后 `viewDragHelper.captureChildView(child, event.getPointerId(...))`（:798-803）。**这与本笔记 §五 M1 的 JS 侧修法同构：都是「不依赖被动协商，主动把拖动权拿过来」。**
- **nested scrolling 协作**：`onStartNestedScroll` 只对垂直轴返回 true（`:818 return (axes & ViewCompat.SCROLL_AXIS_VERTICAL) != 0;`）；`onNestedPreScroll` 对 `TYPE_NON_TOUCH`（fling）直接 return、其余按 `child.getTop() - dy` 与滚动子项分账（:830-850）。含义：**当 sheet 内有可滚动子项时，拖动权在「滚内容」与「拖 sheet」之间按嵌套滚动协议分账**——这正是 MPlayer 用「只有把手可拖」规避掉的那部分复杂度（ADR-0007 的刻意选择）。
- **drag handle 是一等公民的"命中豁免区"**：`onInterceptTouchEvent` 在 DOWN 时 `if (!isTouchingDragHandle(parent, initialX, initialY)) { touchingScrollingChild = true; }`（:722-726）；`isTouchingDragHandle` = `dragHandleView != null && parent.isPointInChildBounds(dragHandleView, x, y)`（:1699-1704），由 `setDragHandleView(BottomSheetDragHandleView)` 注入（:2541）。
  ⇒ **原生语义是：handle 区域的作用是"在这里滚动子项不许赢"，而拖拽面本身仍是整个 sheet。MPlayer 把 handle 当成"唯一可拖区"是把原生的两件事合成了一件。**

> ⚠️ 仍未验证（UNVERIFIED）：「M3 drag handle 触控目标 48dp」与「iOS 44pt」的**官方原文数值**。`m3.material.io` 为前端渲染，抓取到的正文为空；Android 无障碍支持页抓取失败。**本节其余论断均有一手源码行号支撑**；48dp/44pt 仅作为「把手热区应大于 40dp」的方向性依据，落地前请人工复核 https://m3.material.io/components/bottom-sheets/specs 。

### 2.6 iOS：grabber 是**视觉附件**，交互由系统提供

Apple 官方文档 `UISheetPresentationController.prefersGrabberVisible`（一手，Apple 文档 JSON 正文）：

- 「A Boolean value that determines whether the sheet shows a grabber at the top.」
- 「A grabber is a **visual affordance** that indicates that a sheet is resizable. Showing a grabber may be useful when it isn't apparent that a sheet can resize or when the sheet can't dismiss interactively.」
- 「Set [true] for the **system** to draw a grabber in the standard system-defined location. The system automatically hides the grabber at appropriate times…」

来源：https://developer.apple.com/documentation/uikit/uisheetpresentationcontroller/prefersgrabbervisible

⇒ 两层含义（对应提问 3）：(1) **grabber 本身不是手势目标**——它是视觉提示，拖拽作用于 sheet 整体，由系统实现；(2) 报错语义上「有 grabber」与「能交互式 dismiss」是**两件独立的事**（原文甚至提示「当 sheet 不能交互式 dismiss 时，显示 grabber 反而有用」），这与 MPlayer 把「把手」和「拖拽关闭」耦合成一个手势目标的做法在**概念模型上就不同**。SwiftUI 对等物见 §2.3 的 `presentationDragIndicator` + `interactiveDismissDisabled`。

**最小触控目标的官方原文（一手，Apple HIG）**——https://developer.apple.com/design/human-interface-guidelines/buttons ：

- 「As a general rule, a button needs a **hit region of at least 44x44 pt** — in visionOS, 60x60 pt — to ensure that people can select it」
- 补充（一手，HIG Accessibility https://developer.apple.com/design/human-interface-guidelines/accessibility ）：「Include enough padding between elements to reduce the chance that someone taps the wrong control. In general, it works well to add **about 12 points of padding around elements that include a bezel**. For elements **without a bezel, about 24 points of padding** works well around the element's visible edges.」

对照 MPlayer：handle 是 **36×4 的裸色条（无 bezel）**，当前 `grabberZone` 的 padding 垂直合计约 `spacing[2]+2 + spacing[2]` ≈ 18dp、总高 40dp。按上面两条官方口径，**「热区高度」与「视觉元素四周留白」两个维度都还差一点**（40 < 44；≈18 < 24）——这与「手指命中率低、拉不到把手」的真机体感一致，也是 §五 M2 的直接依据。

> ⚠️ 仍未验证：`UIScrollView` 与 sheet 手势的优先级（「先滚到顶再拖 sheet」）未取到一手引用，标记 UNVERIFIED（不影响本笔记结论：MPlayer 的把手区没有可滚动子项）。

---

## 三、与本仓库实现的逐条差异

对照实现（worktree `refactor/mobile-drag-session`）：

- `packages/mobile/components/BottomSheet.tsx`：`<Modal transparent animationType="none" statusBarTranslucent navigationBarTranslucent>` → `grabberZone`（`minHeight: spacing[10]` = 40dp，居中含 36×4 的 `handle`）挂 `{...panHandlers}`；`claimMode` **未传**（默认 `'move'`，见 §4）；`claimThreshold: 10`。
- `packages/mobile/hooks/useDragToDismiss.ts`：`onStartShouldSetPanResponder` 只 `sequence.begin()` 并 **return false**；`onMoveShouldSetPanResponder` = `isVerticalDragClaim(gs.dx, gs.dy, 10, sequence.allows(enabled))`。
- `packages/mobile/gestures/dragSession.ts`：`isVerticalDragClaim = enabled && |dy| > threshold && |dy| > |dx|`；`createTouchSequenceGate` 要求「本层见过 DOWN」。

| # | 维度 | 标准实现 | MPlayer | 影响 |
|---|---|---|---|---|
| D1 | **拖拽面** | Android Material：整个 sheet 可拖（handle 只视觉，§2.5）；iOS：系统手势作用于 sheet 整体（§2.6）；`@expo/ui`：平台原生（§2.3） | 只有 40dp 的 `grabberZone` 叶子 View 可拖 | **最致命**：候选集会随落点排除把手；有效命中区仅 40dp 高 |
| D2 | **手势载体** | 原生手势识别器（RNGH / Material / UIKit），与 JS responder 链解耦（§2.4） | RN core `PanResponder`，跑在 JS responder 链上 | 受 touch-target 锁定与逐 move 协商约束（§2.1） |
| D3 | **认领时机** | RNGH Pan「activates when a finger is placed and moved some initial distance」，但**识别器挂上即参与原生裁决**（§2.4）；原生实现则根本不需要认领（父层 intercept） | 仅 move 阶段认领，且 `|dy| > 10 && |dy| > |dx|` | 一旦落点不在把手上，认领不可达（根因候选 R1） |
| D4 | **响应者让渡** | RNGH 用 `failOffsetX/Y`、`simultaneousHandlers`、`blocksExternalGesture` 声明式编排互斥 | 依赖 `onPanResponderTerminationRequest` 默认 **true**（愿意让出） | 拖动途中可能被系统/其他 view 收走；`'start'` 模式未接线时没有防护 |
| D5 | **遮罩点按语义** | Material：点击 scrim 关闭（`shouldDismissOnClickOutside`）；iOS：backdrop tap（`enablePanDownToClose` 一并接管） | 全屏 `Pressable`，**响应区 = 整个屏幕** → 屏幕内任意滑动松手都算 `onPress` | 这是「滑动被当成点按」的真机制（§四 R1b），且会让 e2e 断言失真 |
| D6 | **把手尺寸** | Apple HIG：hit region **≥44×44 pt**，无 bezel 元素四周留白 **≈24 pt**（§2.6，一手）；Material 48dp（仍 UNVERIFIED） | 40dp 高、垂直留白 ≈18dp（真机第三轮从 22dp 提到 40dp） | 两个维度都还差一点；且 `hitSlop` 能扩原生命中区（§五 M2） |
| D7 | **序列归属闸** | 标准实现无此概念 | `createTouchSequenceGate` 要求「本层见过 DOWN」 | 设计意图（防 Modal 卸载后残余事件连带关闭）合理；但它与 move 认领叠加后**掩盖诊断**：日志上分不清「没被问到」与「被闸门拒了」 |
| D8 | **capture 语义注释** | `traverseTwoPhase` 含 target 自身（§2.1） | 注释断言「capture 不会问到 target 自身」 | 注释与源码不符，可能误导后续改动（建议实测后修正文字） |

---

## 四、根因判断

### R1（最可能，源码级可证）：「DOWN 落点不在 grabberZone」——move 认领**结构上不可达**

两条互相独立、又刚好叠加的机制：

- **R1a**：`JSTouchDispatcher` 在 `ACTION_DOWN` 锁定 `targetTag`，后续 `ACTION_MOVE` 全部派发给该 tag（§2.1 一手源码）；`ResponderEventPlugin` 只从该 targetInst 出发做两阶段收集。落点在遮罩/面板内容上时，`grabberZone` 不在链路上 → `onMoveShouldSetPanResponder` **一次都不会被调用**（不是返回值 false，是根本没被问）。
- **R1b**：若落点在遮罩上，遮罩 `Pressable` 在 DOWN 时按 `onStartShouldSetResponder` 成为 responder，其响应区 = 遮罩自身 bounds（整屏）± `hitSlop` ± `pressRectOffset`（默认 top/left/right 20、bottom 30）。`Pressability` 的 `onResponderMove` 只在**离开响应区**时才 `LEAVE_PRESS_RECT`；而 `onPress` 的触发条件是 `isPressInSignal(prevState) && signal === 'RESPONDER_RELEASE'`，`isPressInSignal` 不含 `RESPONDER_ACTIVE_PRESS_OUT`。**整屏响应区意味着屏内滑动永远不离开，于是 800px 的 swipe 与一次 tap 在语义上完全等价 → 松手即 `onPress` → `requestClose()`。**

源码（一手）：`Libraries/Pressability/Pressability.js` —— https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/Libraries/Pressability/Pressability.js

**为什么「同样的 adb 注入在播放器上能用」**：`PlayerOverlay` 的 PanResponder 挂在**根节点**，是任何 touch target 的祖先 → 永远在协商链路上 → move 认领照常生效（且 `claimThreshold: 24` + `|dy| > |dx|` 只是筛选条件，不影响可达性）。这不是「Modal 特殊」，而是**挂载位置**的差异。

### R2（真实存在过、但在本版本仍需实测确认）：Modal 内 move 认领不触发

**支持它的证据（一手 issue）**：RN#14295「panResponder doesn't work with Modal」正文即「onMoveShouldSetPanResponder is not triggered inside the Modal component, when used outside is triggered just fine」，多版本多平台复现（§2.2）。**这不是空穴来风的假设**，且本仓库 worktree 的注释正是引用它来引入 `claimMode: 'start'`。

**削弱它的证据（一手源码 + 行为逻辑）**：

- 源码：`DialogRootViewGroup` 自己持 `JSTouchDispatcher`，在 `onInterceptTouchEvent` **与** `onTouchEvent` 两处转发（§2.2）；0.86.2 里 Modal 与主窗口走同一套派发机制。
- 行为逻辑（关键）：**若落点在把手上而 move 确实丢了，结果应该是「什么都不发生」**——`grabberZone` 没有任何 `onPress`，不会关闭弹层。观察到的「关闭了」与该假设矛盾；「关闭」恰是 R1b 的预期结果。
- 版本落差：#14295 关在 2018-03（新架构/Fabric 之前），原报告平台为 iOS。

⇒ **结论：R1 与 R2 都仍然可能，但两者对「弹层为什么会关」的解释力不同——只有 R1b 能解释「关闭」。** 判定实验（下表）是唯一能定分止争的手段；在拿到打点证据前，笔记与代码注释都应把 #14295 写成「历史 issue，本版本待复现」，而不是既成机制。

### R3（过程性，不是根因）：`'start'` 修法在 committed 状态**没有接线**

worktree 有未提交改动（调研期间出现/变化，三文件 +50/−4）：新增 `DragClaimMode = 'start' | 'move'`、`claimsOnTouchStart`、`allowsTerminationRequest`，`useDragToDismiss` 支持 `claimMode`，`BottomSheet.tsx` 传入 `claimMode: 'start'`。**但 HEAD `12602ee`（committed）里 `BottomSheet.tsx` 并未传 `claimMode`，默认 `'move'`** —— 也就是说，如果 e2e 是在 committed 状态或未热更的 bundle 上跑的，那么「DOWN 即认领」这条修法**根本没生效**。这本身足以解释一轮「修了还是不行」。

### 判定实验（一次跑完给出唯一答案）

在三处打点（dev-only，`console.log` 走 logcat，与现有 `[drag] release` 同一通道）：

1. `onStartShouldSetPanResponder`（bubble）与 `onStartShouldSetPanResponderCapture`：各记 `gs.dy/dx`。
2. `onMoveShouldSetPanResponder`：记 `gs.dy/dx` 与 `sequence.allows()` 的取值。
3. `onPanResponderGrant`：确认是否 grant。

读法：

| 观测 | 结论 |
|---|---|
| start 命中 + move 从未命中 | **R2**：Modal 内 move 真的没到 JS（此时应能复现「把手 DOWN → 松手无反应」） |
| start 从未命中（两条都没打印） | **R1**：DOWN 落点不在把手热区 |
| start/move 命中但 `allows=false` | **R3**：序列归属闸把认领拒了 |
| grant 命中但 `onPanResponderMove` 不跟手 | 才是 `dragSession`/`Animated` 的问题（当前证据不支持） |

**同时必须核对 e2e 的注入坐标**：`scripts/mobile-e2e.sh` 现用 `adb shell input swipe 628 2100 628 1300 300` / `628 2200 628 700 400`（一手，仓库内文件）。这些 y 是否落在「面板顶部 + 0..40dp」区间需要实测确认（面板高度随内容变化；`BottomSheet` 的 `maxHeight` 是 70%，而短面板由内容决定）。**建议先在测试里 dump 面板顶部 y（uiautomator 或截图），再用「面板顶部 + 20dp」作为 swipe 起点**，否则 R1 会稳定复现且看起来像「随机不灵」。

---

## 五、建议的修法（最小改动，仍受 ADR-0004 约束：只用 RN core Animated，不引 reanimated / gesture-handler）

按性价比排序：

**M1（核心，必须做）：把手在 DOWN 即认领响应者，并拒绝让出。**

- `BottomSheet.tsx` 传 `claimMode: 'start'`（worktree 已有该实现，只需接线 + 提交）。
- 语义：`onStartShouldSetPanResponder` 返回 true → 触摸一开始 `grabberZone` 就是 responder → **后续所有 move 必然送达**（responder 保证，与 §2.1 一致），彻底绕开「move 协商可达性」问题。
- 配套：`onPanResponderTerminationRequest` 返回 false（`'start'` 模式），防止系统/其他 view 中途收走响应者（注意官方文档明示「响应者也可能被 OS 直接收走，不问 `onPanResponderTerminationRequest`」，所以 `onPanResponderTerminate` 的回弹兜底必须保留）。
- 把手区没有其他交互（无 `onPress`），DOWN 即认领**没有副作用**；这也正是标准实现的做法（Android 父层 intercept / iOS 系统手势，本质都是「起点即接管」）。
- **但 M1 不能救「DOWN 不在把手热区」的用例**（R1 的 R1a 部分仍然成立）。

**M2（配套，扩大并澄清命中区）：把手热区 ≥48dp，并显式声明 `hitSlop`。**

- `hitSlop` **确实能扩原生命中区**（一手证据）：`TouchTargetHelper.isTouchPointInView` 读 `(view as? ReactHitSlopView)?.hitSlopRect`，有则用 `[-left, width+right] × [-top, height+bottom]` 判定，无则退回 bounds。源码：https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/TouchTargetHelper.kt
- 现状 40dp `minHeight` 已接近下限；建议 `minHeight: 48`（Android 触控目标惯例；**48dp 的官方原文本轮 UNVERIFIED**，见 §2.5）＋ `hitSlop={{ top: 8, bottom: 8 }}`，让「落点差几个 dp」不再直接判死。
- 注意 `hitSlop` 只能扩**本 view** 的命中，**不能**覆盖遮罩（兄弟节点）——所以 M2 是 M1 的补充，不是替代。

**M3（配套，让遮罩只认真点按）：遮罩点按增加位移闸。**

- 现状：遮罩全屏 `Pressable` 的响应区就是整屏，屏内滑动 = 点按（§四 R1b）。对「滑遮罩也该关」的产品语义而言这**未必是 bug**，但它有真实代价：**e2e 无法用「弹层消失」区分「拖拽生效」与「遮罩被点」**。
- 最小改动（纯 JS，无新依赖）：`onPressIn` 记 `pageX/pageY`，`onPress` 时若位移超过阈值（如 10dp）则不关闭；或用 `onPress` 事件的 `nativeEvent` 自行判定。
- **若产品接受「滑遮罩即关」**，则不改代码，改为修断言（见 M5）。

**M4（保持不动）：`PlayerOverlay` 继续用 `'move'` 模式。**

- 它挂在根节点，是任何 touch target 的祖先，move 认领可达且「不抢点按/不抢横向」的收益真实存在。**不要为了统一而把它改成 `'start'`**，否则会吃掉子级的点按与横向滑动。

**M5（验证纪律，否则修了也不知道修没修好）：**

- e2e 不要用「弹层消失」当作「拖拽生效」的断言（遮罩点按同样会消失）。改用 `[drag] release basis=… vy=… → dismiss` 这条 dev-only 日志（已存在）作为「拖拽路径真的跑到判关」的证据；或在拖动中截图比对面板顶部 y。
- swipe 起点改为「面板顶部 + 20dp」并且**先断言该点确实落在把手热区内**（可临时在 `onStartShouldSetPanResponder` 打点验证）。
- 真机验证时同时覆盖：面板短（内容少）与面板高（内容多）两种形态——判关基准在 worktree 已从 `winH` 改为 `sheetHeight`，两者行为不同。

**明确不做（越界项）：** 不引 `react-native-gesture-handler` / `reanimated`（ADR-0004 载体条款：core Animated 的 `velocity` + `stopAnimation` 已覆盖需求）；不把整个面板设为可拖（ADR-0007 与 #186 已否决：会点内容误关、与 FlatList 抢滚动）；不改成 `@expo/ui` 的原生 bottom sheet（会改变弹层形态与既有 6 个消费方，且需要新的原生构建面）。

---

## 六、来源清单

### 一手：本机源码（版本精确，可逐行核对）

本地根：`node_modules/react-native/`（react-native 0.86.2）

| 文件 | 位置 | 支撑的论断 |
|---|---|---|
| `ReactAndroid/src/main/java/com/facebook/react/uimanager/JSTouchDispatcher.kt` | DOWN 锁 `targetTag`；MOVE 用旧 tag 派发 | §2.1 R1a |
| `ReactAndroid/src/main/java/com/facebook/react/uimanager/TouchTargetHelper.kt` | `isTouchPointInView` 读 `ReactHitSlopView.hitSlopRect` | §五 M2 |
| `ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt` | `DialogRootViewGroup` 转发触摸；`FLAG_NOT_FOCUSABLE` 时序 | §2.2 R2 |
| `Libraries/Interaction/PanResponder.js` | `dy` 语义、grant 归零、termination 默认 true、`onShouldBlockNativeResponder` 默认 true | §2.1 |
| `Libraries/Pressability/Pressability.js` | 响应区/按压区、`LEAVE_PRESS_RECT`、`onPress` 触发条件 | §四 R1b |
| `Libraries/Renderer/implementations/ReactFabric-dev.js` | `traverseTwoPhase$1`（含 target）、`ResponderEventPlugin` 两阶段收集 | §2.1；D8 |
| `packages/mobile/node_modules/expo-router/node_modules/@expo/ui/src/community/bottom-sheet/README.md`（@expo/ui 57.0.12） | drop-in for gorhom；三平台原生实现；`BottomSheetHandle`=No；`enable*PanningGesture`=no effect | §2.3 §2.4 |
| `…/@expo/ui/src/community/bottom-sheet/BottomSheet.ios.tsx` / `BottomSheet.android.tsx` | `presentationDragIndicator` / `interactiveDismissDisabled`；`showDragHandle` / `sheetGesturesEnabled` | §2.3 |
| `…/@expo/ui/src/jetpack-compose/ModalBottomSheet/index.tsx` | `showDragHandle`(default true) / `sheetGesturesEnabled`(default true) / `DragHandle` slot | §2.3 §2.5 |
| `.claude/worktrees/mobile-drag-session/packages/mobile/{components/BottomSheet.tsx,hooks/useDragToDismiss.ts,gestures/dragSession.ts}` | 本仓库实现与未提交改动 | §三 §四 R3 |
| `packages/mobile/components/PlayerOverlay.tsx`、`packages/mobile/theme/motion.ts`、`scripts/mobile-e2e.sh`、`docs/adr/0004-design-motion-presets.md`、`docs/adr/0007-mobile-bottom-sheet-shell.md`、issue #301 | 对照基准、约束、e2e 注入坐标 | §三 §四 §五 |

### 一手：上游源码 URL（tag `v0.86.2`，均已验证 200）

- JSTouchDispatcher.kt：https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/JSTouchDispatcher.kt
- TouchTargetHelper.kt：https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/TouchTargetHelper.kt
- ReactModalHostView.kt：https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt
- PanResponder.js：https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/Libraries/Interaction/PanResponder.js
- Pressability.js：https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/Libraries/Pressability/Pressability.js
- ReactFabric-dev.js：https://github.com/facebook/react-native/blob/v0.86.2/packages/react-native/Libraries/Renderer/implementations/ReactFabric-dev.js

### 一手：官方文档

- RN Gesture Responder System：https://reactnative.dev/docs/gesture-responder-system
- RN PanResponder：https://reactnative.dev/docs/panresponder
- RNGH Getting started（含 **Modal 需 wrap `GestureHandlerRootView`**）：https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/getting-started
- RNGH Pan gesture（`minDistance` / `activeOffsetX/Y` / `failOffsetX/Y` / `shouldCancelWhenOutside`）：https://docs.swmansion.com/react-native-gesture-handler/docs/legacy-gestures/pan-gesture
- @gorhom/bottom-sheet README（v5 = Reanimated v3 + Gesture Handler v2）：https://github.com/gorhom/react-native-bottom-sheet/blob/master/README.md
- Apple `UISheetPresentationController.prefersGrabberVisible`（grabber 是 visual affordance）：https://developer.apple.com/documentation/uikit/uisheetpresentationcontroller/prefersgrabbervisible
- Apple HIG **Buttons**（hit region ≥44×44 pt 的官方原文）：https://developer.apple.com/design/human-interface-guidelines/buttons
- Apple HIG **Accessibility**（无 bezel 元素四周 ≈24 pt 留白）：https://developer.apple.com/design/human-interface-guidelines/accessibility
- Vaul：https://github.com/emilkowalski/vaul
- Android `BottomSheetBehavior` 源码（视图体系实现：父层 intercept、ViewDragHelper、touch slop、drag handle 命中豁免）：https://github.com/material-components/material-components-android/blob/master/lib/java/com/google/android/material/bottomsheet/BottomSheetBehavior.java
- Material 3 Bottom sheets：https://m3.material.io/components/bottom-sheets/guidelines（页面为前端渲染，本轮未取到可引用正文；48dp 数值见 §2.5 的 UNVERIFIED 标注）

### 一手：issue tracker（历史报告）

- RN#14295「panResponder doesn't work with Modal」（CLOSED；RN 0.44.2 / iOS 原报告，评论区扩到 Android）：https://github.com/react/react-native/issues/14295

### 二手 / 交叉验证

- `@expo/ui` 的兼容表（§2.3）被用作 gorhom API 形状与「把手/内容手势分离」设计意图的**交叉验证**（一手来源是 gorhom 自身仓库，但其 handle 手势的源码级细节本轮未逐行引用）。
- §2.5 的「Material 48dp 触控目标」**仍为 UNVERIFIED**（`m3.material.io` 前端渲染、Android 无障碍页抓取失败）。§2.6 的「44pt / 24pt 留白」已由 Apple HIG 一手原文闭合（见上）。
- 「`adb shell input swipe` 注入与真手指在 Dialog 窗口内的差异」：**本轮未找到一手来源**。现有源码证据（§2.2）倾向「不存在 Modal 特有的 move 丢失」，故本笔记把该问题归入「用 §四 判定实验证伪/证实」，不预设结论。

---

## 附：一句话给 reviewer

**先把「把手 DOWN 即认领」接线并提交（M1），同时把 e2e 的 swipe 起点钉在把手热区正中（M5）**；若打点显示 `onStartShouldSetPanResponder` 都没被调用，问题就只是「脚本点歪了」；若 start 命中而 move 从不命中，才需要认真对待「Modal/Dialog 吞 move」这条假设。
