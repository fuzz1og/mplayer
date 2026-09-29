# ADR: 原生持队列 + 原生推进（方案 C）

- 状态：已接受
- 日期：2026-09-29
- 关联：**#405**（根因票）、#433 / #436（本 ADR 取代其结论）、#435（dev 变体）、实施规格 `docs/specs/2026-09-29-mobile-native-playback.md`

## 背景

移动端后台/锁屏曲末不接下一首（#405）。**根因已实测钉死**：App 在后台时 expo-audio 的
`playbackStatusUpdate`（含 `didJustFinish`）不投递给 JS —— 探针后台 45s 零事件、同期
JS 对网络回调仍有反应、原生确实发了事件、FGS 全程 `isForeground=true`。
机制在 RN 0.86.2 的 `JavaTimerManager`：`onHostPause()` 把 `isPaused` 置 true 后定时器
回调不再投递（只有活跃 headless 任务时才继续投递）。

结论：**JS 侧任何机制都修不了**；播放推进必须下沉到原生。

## 决策

1. **原生持队列 + 原生推进**：自写 Kotlin Expo Module
   `packages/mobile/modules/native-player/`（`expo.modules.mplayerplayer`），
   用 media3 ExoPlayer 的播放列表做权威队列，曲末推进是 ExoPlayer 的原生行为。
   `PlayerService : MediaLibraryService` 承载媒体会话与通知。
2. **JS 只做「解析 + 喂窗口」**：core 解析链 0 改动；JS 活着时预解析并把已解析直链
   通过 `loadQueue`/`patchQueue` 投喂给原生（窗口 N=3）。后台补窗走 **in-process
   headless 任务**（`HeadlessJsTaskContext.startTask`），与前台共用同一条 `feedWindow()`。
3. **事件只当通知**（不变量 I1/I2）：事件出口在 JS 对象丢失时静默 return；
   回前台用同步的 `getState()` **单向**对账进 `playerStore`，禁止双向写。
4. **绝对过期时间**（I4）：队列项带 `expiresAtEpochMs`（0 = 不适用）；禁止相对 TTL
   （InnerTune 的反面教材：相对 TTL 与当前时间比较 → 条件恒真 → URL 被无限复用 → 曲末 403）。
5. **策略单一来源**（I5）：core `shared/skipGuard` 仍是唯一语义来源；原生只做
   「分级 / 陈旧守卫 / 每曲 3 次上限 / 无网等待」这四条最小可参数化兜底。
6. **播放推进不得依赖 JS 定时器**（I6）：推进由原生事件驱动；补窗只由
   「原生事件 / `getState()` 对账 / headless 任务」触发。
7. **禁止 `exitProcess` / `Runtime.halt`**（I7）：RN 宿主同进程，杀进程会连 JS 上下文一起销毁。
8. **不跑 `npx expo prebuild`**（I8，反向 CNG）：原生目录提交进 git，CI 直接 `gradlew`。
9. **一个 app 只有一个 `MediaSessionService`**（I3）：expo-audio 的
   `AudioControlsService` 从 app manifest 移除；JS 侧不再发通知（原生 media3 通知唯一）。

### 随机播放语义（原「需 ADR 拍板」项）

**随机由 JS 定序，原生只顺序推进。** JS 在补窗时按 core 规则（`getNextSongIndex`，
每次随机且 ≠ 当前）生成「接下来 N 个 index 的有序序列」再 `append`，
`loopMode='all'`、不使用 media3 的 `setShuffleModeEnabled`。

理由：① core 仍是唯一语义来源；② 预取窗口天然知道下一首是谁（可预解析）；
③ 锁屏 `next` 与 UI `next` 语义一致（有序队列）；④ 避免 media3 置换式 shuffle 的语义漂移
（`setShuffleModeEnabled(true)` 不外露顺序，会让窗口算不出下一首）。
代价：随机序列在窗口内是「预定的」，用户切歌后按新位置重排（已列入 P6 验收项）。

## 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| 继续在 JS 侧绕过（微任务/定时器/后台任务） | **不可行**：根因是 expo-audio 的 `playbackStatusUpdate` 在后台不投递给 JS（探针后台 45s 零事件），JS 里做什么都收不到信号 |
| 用 media3 的 `setShuffleModeEnabled(true)` 做随机 | 置换式且不外露顺序 → 预取窗口算不出「下一首是谁」、锁屏 next 与 UI next 语义漂移 |
| 引入 RNTP V5（react-native-track-player） | `TASK_TIMEOUT_MS = 5_000` 装不下我们的「直连 3s 墙 + 整链 9s 预算」（#424 / ADR `2026-09-28-resolution-chain-deadline.md`）；且策略语义无法复用 core `skipGuard` 单一来源 |
| 跨进程播放服务（`android:process`） | 会让 `PlayerBridge` 失效，必须改走 media3 `MediaController`（成本 +150 行，推断） |
| `onTaskRemoved` 里无条件 `stopSelf()` / `exitProcess(0)` | 前者与「后台续播」正面冲突；后者（I7）会连 RN 宿主同进程的 JS 上下文一起销毁 |
| 手写 MediaStyle 通知 | `setShowActionsInCompactView` 是 action 下标硬编码（顺序一变静默错位）；media3 默认 provider 已满足「上/播/下」三键 |

## 后果

- **得到**：后台/锁屏曲末自动接下一首；原生媒体会话带来锁屏上一首/下一首；
  进程被杀后可恢复队列与进度（`onPlaybackResumption`，恢复后不自动续播）；
  签名直链过期有分级重试与计数上限。
- **代价**：移动端新增 ~1,100 行 Kotlin（Expo Module 生命周期、ProGuard keep、
  真机验收成本）；**iOS 保留 expo-audio 老路径**（`packages/mobile/ios` 未入库，
  `expo-module.config.json` 只声明 android；跨端不一致**显式接受**，
  iOS 继续保留 #405 的后台不切歌行为）。
- **替代方案与否决**：继续在 JS 侧绕过（不可行，根因是事件不投递）；
  用 media3 shuffle（语义漂移，见上）；引入 RNTP V5（其 `TASK_TIMEOUT_MS=5000` 装不下
  我们 3s 直连墙 + 9s 整链预算，且无法复用 core 的 `skipGuard` 单一来源）。

## 参考

- 实施规格：`docs/specs/2026-09-29-mobile-native-playback.md`
- 三份调研：`docs/research/2026-09-27-android-background-playback.md`、
  `docs/research/2026-09-28-mobile-native-playback-options.md`、
  `docs/research/2026-09-28-android-oss-background-playback.md`
