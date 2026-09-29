# 移动端拖拽跟手卡顿：复现协议（#430）

> 类型：复现协议 + 已核实事实 · 关联 **#430**（Spike）· 日期 2026-09-29
> 依据：票面 · 本仓源码实测（master `19c385a`）· RN 0.86.2 自带源码 · AOSP / Android 官方文档（链接见正文）
> 前置结论：本票**第一步是复现，不是迁移**。这份文档把「怎么复现、怎么算复现成立、复现不出怎么关票」钉死；
> 迁移方案只在复现成立之后才谈。

## 0. 一句话

**要回答的问题不是「迁到 UI 线程值不值」，而是「跟手卡顿今天还复现得出来吗」**——因为票面点名的两个 JS 占用源
（#409 歌词不再列表内联、出网治理）都已消解，票价可能已经掉到零。所以先建仪器、再拿数据，最后才决定动不动手。

## 1. 票面事实校正：接入点是 **2** 个，不是 4 个

`useDragToDismiss` 全仓只有两个接入点：

| 票面说法 | 实际 | 说明 |
|---|---|---|
| 弹层把手 | `components/BottomSheet.tsx` | 壳，一个接入点覆盖 ~10 处弹层（队列 / 更多 / 来源选择 / 换源 / 加歌单 / 歌单导入 / 歌曲操作 / 歌单页操作 …） |
| 全屏播放器 | `components/PlayerOverlay.tsx` | 全屏面板，**不是** sheet（`SafeAreaView` 叠层） |
| 横向分页 | **不属于本链路** | `ScrollView horizontal pagingEnabled`（`PlayerOverlay.tsx`），吸附物理已在原生侧 |
| 更多面板 | 已在「弹层把手」里算过 | `PlayerOverlay` 的一个 `BottomSheet` 实例 |

⇒ 迁移的收益面比票面写的小一半，成本面不变。另外**两个接入点的可平台化程度不同**：
`BottomSheet` 壳有平台对应物（原生 modal sheet），**全屏播放器没有**——
它是铺满屏幕的自绘面板，换成原生 sheet 会得到「能甩到一半停住的播放器」。

## 2. 为什么不能靠 `services/perfMonitor.ts`

它量的是 **JS 线程 rAF 帧率**（`perfMonitor.ts:15,17`），且要求**连续 2 个 2s 窗口**低于 30fps 才上报（`:19,:95`），
前台长窗口卡死分支的下限是 `3×2000ms`（`:26,:74`）。
**一次一两秒的拖拽在它眼皮底下结构性不可见**——路径跑完，它连一个窗口都没结算完。
`mobile-device-debugging` skill 里那句「零 `[perf]` warn 什么也证明不了」正是这件事的注释。

而它的现场也只有 `route=… player=open|closed`（`app/_layout.tsx:85`），**不知道当时在不在拖**。
本 PR 给它补上了 `drag=` 现场：`on`（正在拖）/ `recent-janky` / `recent-clean`（刚拖过，10s 窗口）/ `off`。
**它必须覆盖「刚拖过」**——帧率分支要连续 2 个 2s 窗口达标才落盘，
也就是最早在拖拽结束后 4s 才报；只报瞬时状态的话，那行告警永远显示「没在拖」，等于没接。

## 3. 判据：两个量必须一起看

**关键且反直觉**：本 App 的拖拽跟手跑在 JS 线程（`PanResponder` move 回调 → `Animated.Value.setValue`）。
JS 被占住时，面板是**冻住**，不是**画得慢**——UI 线程根本没被要求出新帧，
那一刻系统侧帧统计可能反而很健康（帧少但每帧都准时）。所以：

| 量 | 工具 | 回答的问题 |
|---|---|---|
| **App 侧** `[drag]` 行 | `gestures/dragJank.ts` + `services/dragJankProbe.ts`（本 PR 新增） | JS 线程被占了吗？跟手断没断？ |
| **系统侧** 帧计时 | `scripts/mobile-frame-stats.sh`（本 PR 新增）→ `dumpsys gfxinfo` / `SurfaceFlinger --latency` | 用户看得见吗？ |

**只看前者是拿仪器自证；只看后者不知道是不是拖拽这条路。**

### 3.1 App 侧 `[drag]` 行怎么读

每次手势收口时打一行（掉帧必打 warn；干净手势只在 dev 构建打 info——
A/B 需要「没掉帧」也有**正证据**，否则无法区分「真没卡」与「探针没跑」）：

```
[player] [drag] 面板=player 样本=24 时长=812ms p50=16ms p95=41ms max=118ms 超帧=9/23(39%) 尾距=22ms → 跟手掉帧
```

- **面板** = 拖拽接入点（`sheet` / `player`）：两个接入点的宿主与内容结构不同，没有它就没法按面归因；
- **样本** = move 回调次数；**时长** = 首个 move → 末个 move；
- **超帧 x/y** = 相邻 move 回调间隔超过一帧预算（16.7ms）的数量 / 间隔总数；
- **尾距** = 末个 move → 松手回调，**不进判语**（里面混着「拖到位后停顿再抬手」的正常延迟，用来判会误报），只供人工看；
- **判语** = 单次间隔 ≥50ms（≈3 帧）**或** 超帧占比 ≥20%，任一成立即「跟手掉帧」。两个判据都要：
  只看最大值会被偶发一次 GC 误伤，只看占比会漏掉「卡死 300ms 再恢复」。
- 间隔数不足 5 个（轻点 / 微拖）**不给结论**——不给结论，也不冒充「正常」。

### 3.2 系统侧帧计时怎么读

`scripts/mobile-frame-stats.sh` 先 `gfxinfo reset` + `SurfaceFlinger --latency-clear`，
手势跑完再抓 `framestats` / `--latency`。窗口天然 ≈2s（gfxinfo 环形缓冲约 120 帧 / SurfaceFlinger 128 帧 ≈ 2.13s@60Hz），
且是**系统侧**采集：release 构建可用、不需要 App 配合。

| 现象 | 解读 |
|---|---|
| 帧数少 + 每帧都准时 | 与「JS 卡住 → 面板冻住」一致，回去看 `[drag]` 行 |
| 帧数正常 + 帧耗时长 / 最大间隔大 | 渲染侧真有掉帧，可能与 JS 占用无关 |

## 4. 怎么跑（A/B' 协议）

**A/B' 而非 A/B**：忙的那一臂在 **dev / 内测构建**上跑。理由是 release 会把 JS 日志剥掉、
release manifest 也没有 `<profileable android:shell="true"/>`（app 进程的 Perfetto/atrace 默认关），
而本步要回答的是「JS 忙时拖拽会不会卡」这条**因果**，不是「release 上到底多卡」——不值得为此在 release 里埋可脚本触发的忙循环入口。
代价：dev 构建的性能剖面与 release 不同，**结论按方向解读，不按绝对值外推**。

1. 设备在位（`adb devices`），装 dev/内测构建，Metro 连上；
2. 开两个采集：logcat（`adb logcat -s ReactNativeJS`）+ `scripts/mobile-frame-stats.sh`；
3. **A 臂（空载）**：连续做 7 次下滑关闭手势（同一面板、同一路径），每次一条 `[drag]` 行 + 一份帧计时；
4. **B 臂（造忙）**：手势进行中同时制造 JS 占用——**主场景用真实负载**（连点切歌 + 强制歌词请求），
   人造 busy loop 只用于**仪器灵敏度校验**（确认探针真能测到卡）；
5. 两臂交替跑（A,B,A,B…）抵消热漂移；
6. 每臂取 `[drag]` 的 p95 / max / 超帧占比分布，以及帧计时的最大间隔分布。

一条命令就能起系统侧采集：

```bash
# 注入式（坐标按参考机 OPPO PKB110 1256x2760；先从全屏播放器起手）
MOBILE_FRAME_SWIPE='628 900 628 1900 2000' MOBILE_FRAME_LABEL=busy scripts/mobile-frame-stats.sh
# 或留出手拖窗口
MOBILE_FRAME_WAIT=8 MOBILE_FRAME_LABEL=idle scripts/mobile-frame-stats.sh
# 复算已有 dump（不连设备）
MOBILE_FRAME_PARSE_DIR=e2e/artifacts/frame-idle-20260929-120000 scripts/mobile-frame-stats.sh
```

⚠ `adb shell input swipe` 是 120Hz 线性 MOVE 流（AOSP `InputShellCommand.SWIPE_EVENT_HZ_DEFAULT = 120`），
有真实事件密度但没有真实手指速度曲线。**两臂用同一种注入即可自洽**；要判「真实手指手感」必须人工上机。

## 5. 判语与关票标准

- **复现成立** = 真实负载下拖拽出现可见卡顿，**且** `[drag]` 判「跟手掉帧」，**且**帧计时能自圆其说
  （至少不与之矛盾）→ 才进入迁移方案讨论。
- **复现不成立** = 先把 JS 忙拉**到不低于历史最坏档**（票面记的「帧率暴降到 2fps」那一档）仍测不出 → 关票。
  「没造那么重的忙」下的阴性结果**不算证伪**。
- **关票时必须写死重开触发**：任何一次带 `drag=on` 现场的 `[perf]` warn、或用户报「拉不动 / 卡住」，即重开。

## 6. 已核实的迁移边界（复现成立后才有用）

### 6.1 零新依赖改法：**封死**（源码级）

「`Animated.event` + `useNativeDriver: true` 挂到 `onPanResponderMove`」在 RN core 内不可能：

1. **`onPanResponderMove` 不是 view prop** —— 它是 `PanResponder.create()` 的配置键（`PanResponder.js:503-505`），
   原生驱动只扫**动画组件自己的 props**（`createAnimatedPropsHook.js:193-201` → `AnimatedProps.js:182-196` →
   `addAnimatedEventToView(viewTag, eventName, mapping)`，`eventName` 就是 prop 名）。挂上去什么都不会绑。
2. **responder 事件没有对应原生事件** —— `onResponderMove` 规范化成 `topResponderMove`，而原生只发 `topTouchMove`；
   `gestureState.dx/dy` 是 **JS 侧累加**出来的（`PanResponder.js:330-366`），原生没有这个字段可读。
3. **触摸事件本来就异步过 JS 队列** —— Fabric `JSTouchDispatcher` → `dispatchUnique` → `EventQueue` 在 JS 线程 flush。
   **JS 线程不跑 = 没有触摸事件 = 没有手势。**

⇒ 想换线程只有 `react-native-gesture-handler`（原生手势识别器）+ `react-native-reanimated`（UI 线程 worklet）一条路，
或**换平台原生 sheet 把手势整个删掉**。

### 6.2 SDK 57 上的依赖成本（已读源）

`expo/bundledNativeModules.json` 锁定：`react-native-reanimated@4.5.1`（**要求 New Arch**，本仓已开）、
`react-native-worklets@0.10.1`（4.x 必需的独立包）、`react-native-gesture-handler@~2.32.0`。
- **Babel 不用改**：`babel-preset-expo` 已自动注入 `react-native-worklets/plugin`；
- **Android 不用手改**：autolinking 自动、无 config plugin、RNGH 2.x 无需 entry 处 import；真正的接线是根组件套 `GestureHandlerRootView`；
- **但官方文档的验证路径是 `npx expo prebuild`，恰恰是本仓不能跑的那一步** ⇒ 必须真跑一次 `./gradlew assembleRelease`；
  且 R8 + `shrinkResources` 都开着，三个包的 consumer ProGuard 规则**没能从一手源确认**（未验证项）。

### 6.3 `dragSession` 搬进 worklet ≠ 加个注解

`createDragSession()` 是闭包持有 7 个 `let` 并返回**函数对象**；worklet 按值捕获并**深冻结**捕获到的对象，
且 `grab()` / `calibrate()` 与 `move()` 不在同一次 worklet 调用里——闭包里的变更不会跨调用保持。
⇒ 状态必须挪进 `useSharedValue` / `makeMutable`，`move` / `release` 改成自由函数。**这是一次真重构。**

顺带的好消息：RNGH `Gesture.Pan()` 的 `event.velocityY` 由**原生**计算 ⇒ 内核里那套 EMA 自采样速度、
`MIN_SAMPLE_DT` / `MAX_SAMPLE_DT` 以及 Fabric 三坑的注释可以**整段删掉而不是搬过去**。

### 6.4 与「明确不做」的历史决策冲突 ⚠

`docs/research/2026-09-10-mobile-bottom-sheet-drag-research.md:283` 的越界项写着：

> 不把整个面板设为可拖（ADR-0007 与 #186 已否决：**会点内容误关、与 FlatList 抢滚动**）；
> 不改成 `@expo/ui` 的原生 bottom sheet（会改变弹层形态与既有 6 个消费方，且需要新的原生构建面）。

而本仓已决定（2026-09-29）：**接受平台化的「整块面板可拖」语义**。两处需要显式对齐：

- **冲突的实质**是「谁跟内容滚动抢响应者」。手写壳里让整块面板可拖确实会误关 / 抢滚动——
  平台原生 sheet 由**系统**协调「sheet 拖拽 vs 内容滚动」，这正是 Material 3 敢放开整块拖动的前提。
  所以两条并不在同一前提下对立，但**必须由平台 sheet 承担协调责任**，不能是「手写壳 + 整块可拖」。
- 该处「不改成 `@expo/ui`」的理由之一是「需要新的原生构建面」。现状已变：`@expo/ui` **57.0.12 已在依赖树里**
  （`expo-router` 的依赖，且 peer 已列 `react-native-worklets`），SDK 57 同时提供 Jetpack Compose `ModalBottomSheet`、
  SwiftUI `BottomSheet` 与一个 `@gorhom/bottom-sheet` 兼容的 `BottomSheet`。
  **但「已在依赖树」不等于「已进 Android 构建」——需要一次 release 构建确认。**

## 7. 未验证清单（不要当结论用）

1. 真实设备上 `dumpsys gfxinfo <pkg> framestats` 在 **release** 构建上是否总有数据（系统版本差异 / 是否被丢）；
   脚本已把原始 dump 全量留档，格式不符时可人工看。
2. Android 14-16 的 `SurfaceFlinger --latency` 输出格式与层名（脚本按「三列取第三列 = 上屏时刻」解析，
   并对 sentinel 做了过滤，但**没在真机上核过**）。
3. 三个新原生包的 consumer ProGuard/R8 规则（R8 + shrinkResources 都开着）。
4. `@expo/ui` 是否已经进了当前 Android 构建。
5. worklets UI runtime 上 `Date` 是否可用（若迁移，时钟应改 `performance.now()`）。

## 相关文件

- `packages/mobile/gestures/dragJank.ts` —— 跟手统计纯内核（零 RN 依赖，node 可测）
- `packages/mobile/services/dragJankProbe.ts` —— 日志与 perf 现场接线
- `packages/mobile/hooks/useDragToDismiss.ts` —— 两个接入点共用的适配器
- `scripts/mobile-frame-stats.sh` —— 系统侧帧计时取证
- `docs/research/2026-09-10-mobile-bottom-sheet-drag-research.md` —— 把手拖拽的历史根因分析
