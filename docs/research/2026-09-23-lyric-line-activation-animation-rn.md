# 歌词「逐行激活动画」RN 实现调研报告

> 调研日期: 2026（MPlayer 移动端歌词跳动问题）
> 调研目标: Apple Music 歌词行激活动画的官方效果细节 + React Native 下「行激活状态平滑过渡 / 不跳变 / 快速换行不闪烁」的成熟实现模式，供 MPlayer 移动端修复
> 调研方法: 官方源码（amll-dev/applemusic-like-lyrics）、复刻项目源码（HuangRunHua/Apple-Music-Lyric-Animation）、RN/Reanimated 官方文档与 Issue、社区逆向分析文章 + 本地阅读 MPlayer 移动端现行代码
> 范围: 只调研不改代码。本文件即交付物，落地改动由 MPlayer 团队另行进行。

---

## 0. TL;DR（结论先行）

1. **Apple Music 官方效果**：当前行放大 + 高亮色，其他行缩小 + 变暗/轻微模糊。行与行之间是**弹簧补间**（`UIViewPropertyAnimator` + `UISpringTimingParameters`），**不是**“逐行硬切”。Apple 从未公开过内部实现/参数（无官方文档），社区复刻 + 逆向分析是唯一权威来源。
2. **RN 正确模式**：**每行一个独立、常驻的动画值**（RN `Animated.Value` 或 Reanimated `SharedValue`），行组件 `React.memo` + 稳定 `key`；激活状态变化时，**只有那一行**把它的值 animate 到目标（active → 1.12，inactive → 1）。旧激活行“回落”不需要特殊处理——它自己的动画值换一个目标继续跑即可，天然平滑。**绝不要**“全局共享一个值 + 每行插值”。
3. **“跳变两次”的最大嫌疑**（对照 MPlayer 现状代码，见 §6）：激活行目前是 **`fontSize`/`lineHeight` 静态样式切换**（15→16、18→20）——字体大小是**布局属性**，切换瞬间行高突变、列表瞬时重排（第 1 跳），随后 `scrollToIndex(animated)` 又滚一次（第 2 跳）；且两个列表（三行预览 + 全屏）各自触发。快速换行时连续打断，跳变加倍。
4. **说唱快词**：行间隔 < ~400ms 时自动把弹簧调“硬”（更快到位）或只改颜色不动缩放；同索引重复激活去重；seek/回跳时**直接 snap**（`stopAnimation` + `setValue`），不做过渡动画。
5. **虚拟化陷阱**：行复用/卸载重挂会让动画值错乱或从初始值重新开始。歌词行数通常 ≤ 100，**用 ScrollView 全量渲染（AMLL 同款做法）可彻底绕开虚拟化问题**；若坚持 FlatList，必须 memo 行组件 + 稳定 key + 行内按 index 变化重置值。

---

## 1. Apple Music 歌词行激活的官方效果细节

### 1.1 观测到的效果（社区一致描述）

- **当前行**：放大（scale 略大于 1）+ 高亮色（一般跟随主题强调色）+ 轻微“发光/强调”效果。
- **其它行**：缩小（略小于 1）+ 变淡 + 轻微模糊，形成“景深”（depth-of-field）层次——已唱过的行沉在“水下”，未来的行浮在“浅水”（HuangRunHua README 的原话比喻）。
- **行间过渡**：不是整行闪切，而是**弹簧补间**——位置、缩放、透明度都连续变化；行切换的时刻看不出“硬切”，只看到焦点平滑移交。

### 1.2 实现机制（社区逆向分析，非 Apple 官方文档）

- 行缩放/位移用 spring：`UIViewPropertyAnimator` + `UISpringTimingParameters`（damping ratio / initial velocity），慢歌偏“重”，快歌偏“快”。
- 歌词同步用 `AVPlayer` 的 boundary time observer 在**每个时间戳**触发回调，seek 时二分重算当前行——同步与动画解耦。
- **重要事实**：Apple **从未发布**过歌词动画的官方技术文档，上述全部来自社区抓包/观察/逆向（dev.to / Medium / conzit 的同名文章；三篇内容相同，疑似同一作者多平台分发，权威性应按“社区分析”看待）。弹簧是否按 BPM 动态调参、具体参数值，**无权威出处**。
- 因此第 2、3 节的“权威实现”全部落在**复刻项目的源码**上（AMLL 被 GitHub 2000+ star、被大量音乐播放器引用，源码即文档）。

---

## 2. 复刻项目实现：amll-dev/applemusic-like-lyrics（AMLL）

> 来源：`github.com/amll-dev/applemusic-like-lyrics`（AGPLv3，DOM 原生实现 + React/Vue 绑定；核心在 `packages/core/src/lyric-player/`）。以下均为直接读源码得到的结论。

### 2.1 核心模型：每行 = 一组“常驻弹簧对象”，永远在追目标值

每个歌词行组（`LyricLineGroupBase`，`base/group.ts`）持有：

- `posY: Spring` —— 纵向位置弹簧；
- `bgSlideY: Spring` —— 背景行滑入弹簧；
- 每个行对象（`LyricLineBase`，`base/line.ts`）持有 `lineTransforms.scale: Spring = new Spring(100)` —— **缩放弹簧**（单位是百分数）。

`Spring`（`utils/spring.ts`）是一个**持续运行的物理求解器**：

```ts
// 结构（伪代码，源自 utils/spring.ts）
class Spring {
  currentPosition; targetPosition; currentTime; params;
  setTargetPosition(to) {
    // 关键：不把 currentPosition 重置为 to！
    // 而是用「当前值 + 当前速度」重启求解器
    this.targetPosition = to;
    this.resetSolver(); // resetSolver 里: curV = getV(currentTime)，从当前位置继续
  }
  update(delta) { currentPosition = solver(currentTime += delta); }
}
```

**“不跳变”的奥妙全在这一句**：换行时（例如旧行从 active 变 inactive），不是“把动画值归零重放”，而是给该行的弹簧**换一个新的目标值**，弹簧从**当前值 + 当前速度**继续物理演化。中途连续改目标也不会跳——因为位移/速度始终连续。这就是为什么 AMLL 快速换行（说唱）不闪烁。

### 2.2 换行时发生了什么（组级视角，`base/group.ts`）

每帧/每次换行调用 `group.setTransform(top, force, delay, isActive, opacity, blur)`：

- active 行 scale 目标 = `100`；非激活行（且播放中）= `97`（缩放幅度小，AMLL 更靠 blur/opacity 分层，见下）。
- `force=true`（seek / 初始 / 尺寸变化）→ `posY.setPosition(top)` **直接到位，不做动画**，避免长距离弹簧乱飞。
- 否则 → `posY.setTargetPosition(top, delay)` / `scale.setTargetPosition(...)`，弹簧自行补间。
- **旧行回落 = 无特殊代码**：它自己那根弹簧的目标从 100 变成 97，自然平滑缩回去。这正是 §3.2 要回答的“旧激活行怎么平滑降级”的标准答案。

### 2.3 主循环与速度自适应（`base/index.ts` 的 `calcLayout` / `update`）

- 组件用 rAF 每帧调用所有行的 `update(delta)`，所有弹簧统一推进一帧（AMLL 要求 CPU 3GHz+ 才能 60fps，说明它是 JS 线程逐帧求解的——RN 里对应 native driver 就是“免逐帧 JS”的升级版）。
- **按行间隔动态调弹簧刚度**（`base/spring.ts` 的 `getPosYSpringPolicy`）：

```ts
// 行间隔 100..800ms → 刚度 170..220 反比映射；间隔越小（说唱）弹簧越“硬”越快到位
const clamped = clamp(intervalMs, 100, 800);
const ratio = 1 - (clamped - 100) / 700;
const stiffness = 170 + (ratio ** 0.2) * 50;
const damping = Math.sqrt(stiffness) * 2.2;
```

- seek / 间奏 / 首尾行：回退到慢参数（stiffness 90 / damping 15），避免大幅跳转时弹簧狂抖。
- `setEnableSpring(false)`：回退到 CSS `transition` 过渡（低性能机器兜底）——RN 对应 reducedMotion / 性能开关直接关动画。

### 2.4 与虚拟化无关：AMLL 渲染所有行，不回收

AMLL 把所有行都渲染进 DOM，只对**视口外**的行做隐藏（`isInSight` 判断 + `hide()`），从源头杜绝“行复用导致动画值错乱”这一类 RN FlatList 问题（见 §4）。缩放的“当前行放大”效果在 AMLL 里幅度很小（97↔100），主要视觉是位置 + blur/opacity 景深；MPlayer 想要的 1→1.12 大缩放是把同一套“每行一根弹簧”机制套到更大的输出区间上，机制完全通用。

### 2.5 第二个复刻项目：HuangRunHua/Apple-Music-Lyric-Animation（SwiftUI）

- 结构：`List` + `ScrollViewReader`，激活行 `scrollTo(id, anchor: .top)` 包在 `withAnimation(.linear)` 里；cell 的激活样式是 `fontSize 25→30` + `blur 2→0` 随状态切换（`LyricCell.swift`）。
- 结论：这个项目**没有**精细弹簧，是 SwiftUI 隐式动画在接管过渡；它的价值是印证了 Apple 效果的“观感目标”（放大 + 景深模糊），**不是** RN 可直接照抄的机制参考。RN 没有 SwiftUI `withAnimation` 那种内建隐式过渡，必须自己做 per-row 动画值——所以它只作为观感参考，机制参考以 AMLL 为准。

---

## 3. RN 中“行激活状态平滑过渡”的正确模式

### 3.1 每行独立 Animated.Value，还是共享一个值？—— 必须每行独立

**共享值方案在数学上就不成立**：用共享值 `v∈[0,1]` 加每行插值（旧行 `scale=interpolate(v,[0,1],[1,1.12])`，新行 `scale=interpolate(v,[0,1],[1.12,1])`），两个映射对同一个 `v` 的输入输出是**互斥的**——`v=0` 时旧行是 1、新行却已经是 1.12，必然有一端跳变。AMLL 也是每行一根弹簧。**结论：每行一个独立、常驻的动画值**（RN `Animated.Value` 或 Reanimated `SharedValue`）。

共享值唯一合理用途是**滚动进度**（scrollY 驱动所有行的位移插值），与激活动画无关。

### 3.2 旧激活行怎么平滑降级？—— 换目标继续跑，不重启不硬切

- **正确**：旧行收到 `active: false` 后，用**同一根动画值** spring 到 1（回落）。它手里那跟动画正在 1.12 上（或在途中），直接 `Animated.spring(scale, { toValue: 1 })` 继续即可，位移/速度连续，没有“跳”。
- **错误**：把激活样式作为条件样式硬切（`style={active ? scale1.12 : scale1}`）——那是瞬时替换，不是动画；或者每次 render 新建 `Animated.Value`——等于每次换行把全列表动画状态清零重放，正是“跳变两次”的经典来源。
- Reanimated 下拉（100ms 淡入淡出）的最小示例已在真实 RN 歌词项目里出现（akshayjadhav4/lyrics-animation，见 §7）：`useEffect(() => { viewOpacity.value = withTiming(isActiveLine ? 1 : 0.1, ...) }, [isActiveLine])` —— **每一行自己响应自己的 `isActiveLine` 变化**，就是标准姿势。

### 3.3 快速连续切行（说唱 0.5s 一行）怎么防互相打断

- **每行独立值 = 天然免疫**：A 行的 spring 和 B 行的 spring 互不相干，不存在“新 start 打断旧 start”。共享值 + 每次重启才会互相踩。
- 如果某行在动画中又收到**相同目标**（同索引重复激活）：`Math.abs(scale._value - target) < ε` 时直接 no-op（不重启）——防“闪烁”。
- **间隔自适应**（AMLL `getPosYSpringPolicy` 同款）：行间隔 < ~400ms → 刚度调大/时长缩短，让动画“追得上”换行节奏；间隔 < ~200ms → 只切颜色不做缩放，或直接 snap。见 §5 代码。
- 额外纪律：动画全部走 `Animated` 值 + `useNativeDriver: true`（transform/opacity），**绝不让 style 三元参与动画属性**（双写 = 跳两次）。

### 3.4 经典组件模式与 FlatList 行复用问题

**RN Animated 版**（每行一个 memo 组件）：见 §6.3 完整代码。要点：

- `const scale = useRef(new Animated.Value(1)).current` —— ref 稳定，不会随 render 重建；
- `useEffect([active, intervalMs])` 目标驱动，`Animated.spring(scale, {...}).start()`；
- 行组件 `React.memo`，只有 `active` 变化才重渲染该行；
- `keyExtractor = (_, i) => String(i)` —— 歌词列表只追加不重排，**index 即稳定身份**；绝不要在 renderItem 里内联创建行组件类型（每次换行全部 remount，是放大的“跳变”来源）。

**已知坑（必须防）**：

| 坑 | 现象 | 解法 |
|---|---|---|
| FlatList 行复用（回收池把 A 行的组件实例给 B 行） | 动画状态串行：B 行带着 A 行的 1.12 出现 | index 稳定 key + memo；行内 `useEffect` 里检测 index 变化并 `setValue` 归位（Reanimated 官方 Issue #6276 的 `cachedIndexRef` 做法）；或用 ScrollView 全量渲染绕开回收 |
| 行卸载重挂（滚出视口又被滚回） | 新实例新 ref 从初始值 1 开始 → 激活行闪一下“回落” | 初始值 = 非激活态值（1）；激活行在视口内基本不会被卸载 |
| 行内联创建组件（renderItem 里写函数） | 每次父级 setState 全列表 remount，动画全被打断 | 抽成文件级 memo 组件，`renderItem` 只引用 |
| 运行中动画阻塞虚拟列表渲染更多行 | 滚动卡顿/帧率低 | 动画配置加 `isInteraction: false`（RN 官方文档明确警告） |
| Reanimated `entering/exiting/layout` 用在列表项 | 布局动画与回收打架 → 跳变/卡顿（多个官方 Issue + software-mansion-labs rn-best-practices 明确禁止） | 列表项只用 `useAnimatedStyle` + SharedValue 的手动动画 |

**Reanimated 版本**（若已引入）：`useSharedValue` + `useEffect([isActiveLine])` + `withTiming/withSpring` + `useAnimatedStyle`。注意 Reanimated 曾在 v3.9.0–3.13.x 有“**回收组件动画状态不重置**”的回归（Issue #6203，`enter/exit` 相关 PR #5268 引起，3.14.0 修复）——若锁旧版本，行回收后必须显式重置 SharedValue。

---

## 4. FlatList 虚拟化下的陷阱与解法（汇总）

1. **行卸载重挂 → 动画值丢失**：新挂载的行组件是新 ref，从初始值起步；若初始值不是“非激活态”，就会闪。解法：初始值恒为 1（非激活态）；激活行（视口中心）不会卸载，出视口的非激活行重挂也无感知。
2. **行复用 → 动画值串行**：回收池把组件实例连同动画值一起给新 index。解法：index 稳定 key（歌词数据不重排，`key=index` 是安全且稳定的）；行内检测 index 变化重置；或干脆不用 FlatList。
3. **renderItem 内联创建行组件**（MPlayer 现状，见 §6）：`renderItem` 每次渲染创建新组件函数 → React 每次换行都把整列表行**卸载重挂**，动画状态整体清零——所有“跳变”被放大。**必须**抽文件级 memo 组件。
4. **最干净的解法：放弃虚拟化**。歌词一屏几十行、全曲 ≤ 100 行，AMLL 全量渲染 + 视口外隐藏；RN 里用 ScrollView 全量渲染（react-native-lyric / react-native-lrc 等成熟 RN 歌词库全是 ScrollView，根本不虚拟化），或更进一步学 AMLL 做“容器 translateY + 每行 targetY 弹簧”（无 ScrollView 滚动动画，跳变彻底消失）。代价是要自己算行高 offset，但换来零虚拟化问题 + 行高变化（放大行会撑高）也不会让 FlatList 的 index 定位漂移（FlatList 无 `getItemLayout` 时 `scrollToIndex` 用估算行高，行高一变定位就错——这也是现状跳变放大器之一）。
5. **RN 官方文档备忘**：`Animated` 只支持 transform/opacity 等非布局属性走 native driver；运行中动画会阻止 `VirtualizedList` 渲染更多行，用 `isInteraction: false`（来源：reactnative.dev/docs/animations）。

---

## 5. 说唱类高频短行的专用处理（guard 模式）

```ts
// 伪代码：换行“加速 / 去抖 / 去重”三板斧
const lineInterval = nextLine.time - line.time; // ms

function onActiveChanged(row: Row, active: boolean, intervalMs: number | undefined) {
  if (active === row.isActiveRef.current) return;        // ① 同索引重复激活 → no-op，防闪烁
  row.isActiveRef.current = active;

  if (intervalMs != null && intervalMs < 200) {           // ② 超快词：跳过缩放只切颜色（或直接 snap）
    row.scale.setValue(active ? 1.12 : 1);
    row.color.setValue(active ? 1 : 0);
    return;
  }
  const stiffness =
    intervalMs == null ? 247                          // 首尾行/未知 → 默认
    : intervalMs < 400 ? 900                         // ③ 快词 → 更硬（AMLL getPosYSpringPolicy 同思路）
    : 247;
  Animated.spring(row.scale, { toValue: active ? 1.12 : 1, stiffness, damping: 50, useNativeDriver: true }).start();
  Animated.timing(row.color, { toValue: active ? 1 : 0, duration: intervalMs == null ? 300 : Math.min(intervalMs, 300), useNativeDriver: false }).start();
}

// ④ seek / 回跳 / 相邻来回跳：直接到位，不做过渡
// （在 seekTo 路径上，对所有行 stopAnimation + setValue 到目标值；AMLL 的 force 布局同语义）
```

要点：**索引推进必须单调 guard**（`idx !== prevIdx`，MPlayer 已有）+ **同目标 no-op** + **间隔感知的刚度/时长** + **seek 走 snap 不走动画**。另外暂停 (`isPlaying=false`) 时应停止触发动画、保持行最后状态（AMLL：非播放时背景行不再隐藏、动画收敛到静止）。

---

## 6. 对照 MPlayer 现状（读了本仓库代码，落地建议）

> 本地阅读：`packages/mobile/components/PlayerOverlay.tsx`（行 199–213、330–415、606–619）、`packages/mobile/components/ScalePress.tsx`、`packages/mobile/theme/motion.ts`、`packages/core/src/utils/lyricsParser.ts:40-56`。

### 6.1 现状事实

- 激活行是**静态样式切换**，无任何 per-line 动画值：
  - 预览区 `lyricLine`（fontSize 15）↔ `lyricLineActive`（fontSize 16 + color accent + weight 600）；
  - 全屏 `lyricsFullLine`（fontSize 18, lineHeight 28）↔ `lyricsFullLineActive`（fontSize 20, lineHeight 30）。
- 高亮由 `currentLineIdx` state 驱动：`useEffect([currentTime,...])` 里 `findCurrentLyricIndex`（二分，core 实现没问题）→ `setCurrentLineIdx` → **两个**列表各 `scrollToIndex({index, animated:true, viewPosition:0.5})`。
- `renderItem` 内联在 JSX 里（ScalePress 上挂 `key={index}`，但**组件类型每次 render 重建**）。
- 仓库已有规范的弹簧预设（`theme/motion.ts`：`uiDefault` ζ1.0/0.4s、`sheet` ζ0.8/0.3s、`pressScale` ζ1.0/0.25s）与 `useReducedMotion()` 契约，可直接复用。

### 6.2 “跳变两次 / 说唱行切换 bug”的根因定性

1. 激活行 `fontSize`/`lineHeight` 突变 → **行高瞬时重排**（第 1 跳；fontSize 是布局属性，native driver 无法动画，JS 跑也白搭）；
2. 随后 `scrollToIndex(animated)` → 又一次滚动动画（第 2 跳）；且预览/全屏两个列表各滚一次；
3. FlatList 无 `getItemLayout`，`scrollToIndex` 按估算行高算目标，行高一变定位就漂（try/catch 吞掉的正是这类异常）；
4. 快速换行时以上过程持续互相打断；renderItem 内联造成整列表 remount，动画状态每帧清零 —— 说唱场景全部叠满。

> 若当前分支与本文描述的“scale 1→1.12 动画”有出入（本次读到的是静态样式切换），结论不变：只要激活态由**布局属性或条件样式**表达，跳变就不可避免；统一改走 per-row transform scale + opacity 动画（§6.3）。

### 6.3 建议落地：每行独立 spring 的 memo 行组件

```tsx
// LyricLineRow.tsx —— 抽为文件级组件，React.memo
import { memo, useEffect, useRef } from 'react';
import { Animated, Text, Pressable, type StyleProp, type TextStyle } from 'react-native';

interface Props {
  text: string;
  active: boolean;
  intervalMs?: number;          // 本行到下一行的时间差（说唱加速用）
  onPress: () => void;
  baseStyle: StyleProp<TextStyle>; // 行距/字号等**静态**样式（字号恒定，不再随激活切换）
  colors: { inactive: string; active: string };
}

export const LyricLineRow = memo(function LyricLineRow({
  text, active, intervalMs, onPress, baseStyle, colors,
}: Props) {
  // 每行一根常驻弹簧：ref 稳定，不随 render 重建（这是“不跳变”的根基）
  const scale = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    // 同目标 no-op（防同索引重复激活闪烁）
    if (active === (progress as any).__lastTarget) return;
    (progress as any).__lastTarget = active;

    const fast = intervalMs != null && intervalMs < 250; // 说唱：跳过缩放只切色
    if (fast) {
      scale.setValue(active ? 1.12 : 1);
    } else {
      const stiffness = intervalMs != null && intervalMs < 450 ? 900 : 247; // 快词更硬（AMLL 同思路）
      Animated.spring(scale, { toValue: active ? 1.12 : 1, stiffness, damping: 50, useNativeDriver: true }).start();
    }
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: fast ? 0 : Math.min(intervalMs ?? 300, 300),
      useNativeDriver: false, // color 走 JS；scale/opacity 走 native
    }).start();
  }, [active, intervalMs, scale, progress]);

  const color = progress.interpolate({ inputRange: [0, 1], outputRange: [colors.inactive, colors.active] });

  return (
    <Pressable onPress={onPress}>
      <Animated.Text style={[baseStyle, { color, transform: [{ scale }] }]}>{text}</Animated.Text>
    </Pressable>
  );
});
```

```tsx
// PlayerOverlay.tsx 中改动点
- renderItem={({ item, index }) => (
-   <ScalePress key={index} onPress={...}>
-     <Text style={[styles.lyricLine, index === currentLineIdx && styles.lyricLineActive]}>{item.text}</Text>
-   </ScalePress>
- )}
+ renderItem={({ item, index }) => (
+   <LyricLineRow
+     text={item.text}
+     active={index === currentLineIdx}
+     intervalMs={lyricLines[index + 1]?.time - item.time}
+     onPress={() => seekTo(item.time)}
+     baseStyle={styles.lyricLine}                // fontSize 恒定（去掉 lyricLineActive 的字号切换）
+     colors={{ inactive: colors.textTertiary, active: colors.accent }}
+   />
+ )}
+ keyExtractor={(_item, index) => String(index)}  // 歌词只追加不重排，index 即稳定身份
```

配套改动：

- **字号铁定恒定**（删除 `lyricLineActive`/`lyricsFullLineActive` 的 fontSize/lineHeight 覆盖）；放大效果交给 `transform: [{ scale }]`（GPU、不动布局）。全屏行高放大导致行距变宽可接受（Apple 也这样）或补偿固定行高 + `textAlignVertical: 'center'`。
- **滚动**：三行预览区根本不需要 `scrollToIndex`（内容少，直接钳制 offset 或干脆不滚动，由高亮表达）；全屏区 `scrollToIndex` 改 `animated: false`（激活动画由行自己跑，滚动动画和行动画叠加才是“第二跳”的正主）或给 FlatList 补 `getItemLayout` 让定位精确（行高固定后即可提供）。
- **seek 防抖**：`seekTo` 路径上对当前激活行和旧行 `stopAnimation()` + `setValue(终值)`（AMLL `force=true` 同语义），避免横幅回跳动画。
- **reducedMotion**：`useEffect` 里直接 `setValue(active ? 1.12 : 1)`，不启动动画（仓库已有该 hook 契约）。
- 预览与全屏的行组件可共用 `LyricLineRow`，仅传不同 `baseStyle`。
- 可选进阶（彻底消灭虚拟化问题）：两处列表改 ScrollView 全量渲染 + 手动 offset（先估高度，行高固定后即可精确）。

---

## 7. 来源清单

**官方/一手文档**

- React Native Animated 官方文档（`isInteraction`、native driver 限制、LayoutAnimation）：https://reactnative.dev/docs/animations
- react-native-reanimated 文档：`useAnimatedStyle`、shared value 语义（改 `.value` 不触发 React 重渲染）：https://docs.swmansion.com/react-native-reanimated/docs/core/useAnimatedStyle/
- Reanimated List Layout Animations 文档（`itemLayoutAnimation` 注意事项）：https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/list-layout-animations/

**复刻项目源码（权威机制来源）**

- amll-dev/applemusic-like-lyrics：README + `packages/core/src/lyric-player/base/{spring,line,group,index,layout}.ts`、`utils/spring.ts`、`lyric-player/dom-slim/lyric-line.ts`（spring 常驻目标值模型、group 换行目标切换、`getPosYSpringPolicy` 间隔自适应、`calcLayout(force)` seek 直达）
- HuangRunHua/Apple-Music-Lyric-Animation（SwiftUI 观感复刻）：`MusicLyrics.swift` / `LyricCell.swift` / `PlayView.swift`

**RN/Reanimated 社区实践与已知坑**

- software-mansion/react-native-reanimated Issue #6203（v3.9–3.13 回收组件动画不重置，3.14 修复）、Issue #6276（FlatList 行 index 变化时重置 SharedValue 的 `cachedIndexRef` 模式）、Issue #1219（虚拟列表 + 动画值重建性能）、PR #5333（`useAnimatedStyle` 引用稳定）
- software-mansion-labs/rn-best-practices（repo: Lykhoyda/rn-dev-agent 同文）：列表项禁用 `entering/exiting/layout`，改用 `useAnimatedStyle` 手动动画
- akshayjadhav4/lyrics-animation（RN + Reanimated ELRC 歌词组件：每行 `useSharedValue` + `useEffect([isActiveLine])`，含 AutoScroll 结构）
- react-native-lyric / react-native-lrc（成熟 RN 歌词库，ScrollView 不虚拟化 + `lineRenderer` 回调模式）
- dev.to / medium / conzit《How Apple Music Maps Audio to Lyrics…》（社区逆向分析：spring、boundary observer、TTML/LRC；**非官方，Apple 未公开内部实现**）

**本地代码（MPlayer 现状）**

- `packages/mobile/components/PlayerOverlay.tsx`（高亮 effect、双列表 scrollToIndex、renderItem 内联、`lyricLineActive`/`lyricsFullLineActive` 静态样式）
- `packages/mobile/components/ScalePress.tsx`、`packages/mobile/theme/motion.ts`、`packages/mobile/hooks/useReducedMotion.ts`（可复用弹簧预设与减弱动效契约）
- `packages/core/src/utils/lyricsParser.ts` 的 `findCurrentLyricIndex`（二分查找，本身没问题）

**无权威做法的点（已明确标注）**：Apple 歌词弹簧的具体参数与是否按 BPM 调参——无官方文档；RN 无任何官方“歌词逐行动画”模式——本文建议综合 AMLL 范式 + RN 官方文档 + 社区实践推导，若团队需要更保守的方案可先按 §6.3 的 per-row spring 落地验证。