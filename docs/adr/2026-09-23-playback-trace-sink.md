# 播放解析链结构化 trace：core 出 trace，宿主落 sink

日期：2026-09-23 · 状态：已接受 · 关联：#363（实现票）、#329（t5 基线与形态决策）、#361（护栏，trace 需带 via/guard）、#362（交付口径）、#335（下游决策） ·
依据：`docs/wayfinder/2026-09-21-t5-playback-chain-baseline.md` §3（形态决策）、ADR-0014（tier3 调度与预算）、`2026-09-23-tier3-failure-attribution.md`

## 背景

t5 基线（#329）证明播放解析链的时延与失败**无法从既有设施回答**：`tier3Stats` 只有每源次数
（且 #362 之前还会虚报命中），宿主层只能测到「点歌 → URL 就绪」的总时长，拆不出
「预取命中 / 直连 / tier3」三段，也拿不到每源成败与护栏等级。基线用一次性探针量出了
P50 3120ms、27% 硬失败、坏源饿死好源等结论，但探针**未入库**，每次要重写。

同时有三条已落地的语义必须能被观测：

1. **护栏（#361）**：tier3 候选按 L1–L5 取证，交付时带 `guard` 等级；
2. **交付口径（#362）**：`hits` 只在路由层真正采纳时计，迟到命中是 `discarded`；
3. **试听版换完整版（#361 后）**：预取命中不再是天然的 0 等待——试听版命中仍会进 tier3。

这些语义散落在 `sourceRouter` / `tier3Api`（早期还有 `probeSongs` 探测腿）的接缝上，只有 core 知道；
宿主（桌面主进程 / 移动端 service）负责 I/O 与展示。核心问题是：**埋点写在哪一层、以什么
形态常驻、用户能看到什么**。

## 决策

1. **core 出结构化 trace，宿主落 sink。** 新增 `setPlaybackTraceSink(sink | null)`，与既有
   接缝同构（`setSourceModePersister` / `setTier3Persister` / `setCookiePersister` /
   `setTier3Deps`）。core 内**零 I/O** 的规则不破：core 只把一次解析的语义交给宿主注册的
   sink，不写文件、不落盘、不外传。
2. **trace 是 side-channel，不改 `resolvePlayableSongRouted` 的返回契约。** 沿用 ADR-0012
   的可播资源值（`RoutedPlayable` 只加过 `via`/`guard`），trace 不塞进返回值，避免又一次
   跨端契约改动。
3. **trace 记录**：
   - `PlaybackTrace`（一次 `resolvePlayableSongRouted`）：`totalMs`、`layer`
     （`prefetch|direct|tier3|fail`）、`nonFull`、`prefetchHit`、`tier3Engaged`、`reason`、
     `via`、`guard`、`directMs`/`directMethod`/`directSource`、`directTimedOut`、
     `validateMs`、`tier3Ms`/`tier3TimedOut`，
     以及**每源一条** `sources[]`：`{ sourceId, ms, outcome: hit|miss|error|skipped|rejected|discarded, errorClass?, guard? }`。
   - ~~`PlaybackProbeTrace`（`probeSongsBatch` 单曲）~~：**已随探测链删除（#391）**——
     探测判据反向且产物无消费者，预解析改由 `prefetchPlayableSong` 门面承担；
     `onProbe` / `emitPlaybackProbeTrace` / ring 的 `listProbes` 全部移除。
     直连腿的时长取证成本改用 `PlaybackTrace.validateMs` 观测（#392）。
4. **常驻：内存环形缓冲，会话内、不落盘、不外传。** core 导出 `createPlaybackTraceRing(capacity = 200)`
   给宿主复用（快照 list / clear）。只在用户点「导出诊断」时写文件。与 `tier3Stats` 的
   「仅会话内、不持久化」同取向，避免昨日状态污染今日判断。
5. **开销：sink 为空时热路径零构造零计时。** 调用方先 `isPlaybackTraceEnabled()`，关闭时连
   `traceNow()` 都不调用，也不给 tier3 resolver 传 collector；禁止在热路径做字符串拼接。
6. **用户可见：双端设置页各加「播放诊断」区 + 手动导出。** 展示最近 N 次解析的
   `layer / totalMs / 各段 ms / guard / 失败原因 / 每源 outcome`；桌面经 IPC
   `playbackTrace:list` / `playbackTrace:clear` / `playbackTrace:export`，移动端在 service
   层直接调用并导出文件。播放中不加任何新 UI。
7. **tier3 每源 leg 通过 `Tier3Resolver` 的可选 collector 回传。** resolver 签名扩为
   `(song, collect?) => …`；同歌并发共享同一条解析时，leg 只回给发起者的 trace，与「同歌
   只打一次上游」的既有语义一致。

## 后果

- 双端共享同一份 trace schema（core 单一事实源），设置页文案与字段不漂移。
- 后续「按数据优化」（#335）可以直接采真实会话的 trace，不必再写一次性探针。
- **边界**：trace 只覆盖「点歌 → URL 就绪」，**不含最后一跳「URL 就绪 → 出声」**（桌面需在
  Howler `onload`/`onplay` 补宿主侧埋点，移动端已有 `[耗时]` 日志），该跳仍属 HITL 待办。
- **边界**：不引入遥测/外传；导出是用户主动行为。移动端导出不新增依赖
  （`expo-file-system` 已有 + React Native 内置 `Share`）。
- **边界**：collector 是可选参数，测试/宿主自定义 resolver 可忽略，既有调用不受影响。
