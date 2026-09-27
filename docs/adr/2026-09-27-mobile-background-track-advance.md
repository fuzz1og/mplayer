# 移动端后台曲末推进：同步换源、不留 STATE_ENDED、预取提前到剩余 15s

日期：2026-09-27 · 状态：已接受 · 关联：**#405**（本决策票）· #327（Expo Go 后台播放/锁屏天花板）· ADR `2026-09-25-playback-skip-guard.md`（失败处置仍委托 core）· 依据：`docs/wayfinder/2026-08-03-expo-57-verification.md`（Expo Go 限制实测）

## 背景

现象（#405）：移动端**后台/锁屏**播放时，曲末不接下一首——播完即停；前台播放正常。

改动前的链路（`packages/mobile/services/audioPlayer.ts`）：

- 后台播放开关 `setAudioModeAsync({ shouldPlayInBackground: true })`；
- 永远只有一个 `AudioPlayer`，切歌走 `player.replace(source)`（避免两首同播）；
- 锁屏/媒体会话 `setActiveForLockScreen(true, …)` + `updateLockScreenMetadata(…)`；
- **曲末推进完全在 JS**：`playbackStatusUpdate` → `status.didJustFinish` → `store.next()`
  → `setTimeout(() => playSong(next, 0, false), 0)`；
- 下一首 URL 预取 `prefetchNextSong()` 只有「播放成功后」**一个**触发点，没有任何「剩余时间」触发点。

两条应用层事实决定了这件事的天花板：

1. **通知栏的上一首/播放暂停/下一首是 expo-notifications 的 JS 回调**
   （`services/notificationService.ts:64-80` 注册分类按钮、`app/_layout.tsx:122-140` 的
   `addNotificationResponseReceivedListener`）。expo-audio 原生侧主动移除了 prev/next 媒体会话命令
   （`node_modules/expo-audio/android/.../AudioMediaSessionCallback.kt:27-31`），
   `AudioLockScreenOptions` 也只有 seek 开关。→「通知栏上/下一首可用」**等价于**「JS 在那一刻必须活着」。
2. **曲末推进也在 JS。** 所以「后台能自动接下一首」= 「曲末那一刻 JS 还活着 + 解析链已在 JS 还活着时跑完」。

核心假设（本票要治的机制；最终归属由 #405 真机「30 秒判别法」判定）：

> ExoPlayer 进 `STATE_ENDED` → 原生 `intendedPlayingState = false`
> （`node_modules/expo-audio/android/src/main/java/expo/modules/audio/BaseAudioPlayer.kt:100-107`）
> → Media3 会话不再需要前台服务 → expo-audio 的 `AudioControlsService` 撤下前台提升
> （`…/service/AudioControlsService.kt:319-321` `onUpdateNotification`、`:422`
> `stopForeground(STOP_FOREGROUND_REMOVE)`）→ 进程失去 `FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK`
> 优先级 → 被系统冻结 → 曲末推进（完全在 JS）永远不发生，表现为「播完即停」。
> 停在 ENDED 的时间越长，这条链越容易走完。

已知环境天花板（本决策不解决）：Expo Go 下 `setActiveForLockScreen` 被 `if (!isExpoGo)` 跳过、
`enableBackgroundPlayback` 插件不生效（`docs/wayfinder/2026-08-03-expo-57-verification.md:17` 记了
「未启用锁屏控制时后台播放约 3 分钟后被系统停止」），#327 已登记为已知限制。**验收一律走 dev client。**

## 决策

1. **曲末推进同步化**：删掉推进路径上的 `setTimeout(…, 0)`——多一跳就多一个「JS 被挂起/进程被降权」
   时整段丢掉的点。`didJustFinish` 回调用同一同步 tick 调 `usePlayerStore.next()` 并起播下一首。
2. **重入守卫 `finishAdvancePending`**：原生 `didJustFinish` 是 ENDED 边沿，但从「已决定推进」到
   「新源上报常规状态」之间到达的状态一律属于已在 ENDED 的旧源——`didJustFinish` / `playbackState==='ended'`
   直接吞掉（否则一次曲末会连跳多首），其余（新源的 buffering/ready/error）视为新源已接管并解除守卫。
   守卫在 `stopAllPlayers()` 里一并作废。
3. **绝不停在 ENDED**：下一首直链**已经在手**时（歌自带 url / 本地 file:// / 曲末预取交接槽
   `immediateSources`），在**同一同步 tick** 完成 `replace(source) + play()`。
   `playSong` 新增可选 `immediate` 参数走同步快路径：跳过 `isOffline()`、缓存探活等**一切 await**
   （NetInfo 查询本身就可能耗时，正是 ENDED 窗口的来源之一）。换源只有一个同步出口
   `startSourceOnPlayer`，**单播放器复用（replace 换源）不变**，不会出现两首同播。
4. **预取提前**：状态更新里按 `status.duration - status.currentTime ≤ 15s` 补一次 `prefetchNextSong()`
   （保留「播放成功后」那一发）。去重三层：在飞去重 + 成功窗口（`PREFETCH_SKIP_FRESH_MS` 同量级，5min）
   + 失败冷却 30s（状态更新 250ms 一次，失败不冷却会在曲末前反复重烧整条解析链）。
   预取仍走既有 `resolvePlayableUrlMobile` → `setCachedResource` 路径（**不新造缓存**），
   并同步写一份交接槽供同步换源用。
5. **推进后立即刷新通知与锁屏元数据**：`updateLockScreenMetadata` 在换源同一 tick 调用
   （`startSourceOnPlayer` 内），`updateNotification` 在同一同步尾段 fire-and-forget，
   保证锁屏/通知栏显示的是当前这首。
6. **四种模式与队列收尾仍由既有单一来源决定**：下一首走 `usePlayerStore.next()` → core
   `getNextSongIndex`（单曲循环 / 随机播放 / 列表循环语义不变）；队列播完（store 给不出下一首）
   → `stopAllPlayers()` + `pause()` + 常驻日志。**失败/跳歌处置继续全部委托 core `shared/skipGuard`**
   （`handleTerminalPlaybackFailure`），本次不新增任何决策分支。
7. **常驻诊断日志**（不是临时调试代码）：`[推进] 曲末: 《A》→ 《B》（同步换源，无 ENDED 停留 |
   需解析，先离开 ENDED）` 与 `[推进] 曲末: 《A》→ 队列播放结束，停止播放`，
   用于回答「后台 `didJustFinish` 到底有没有到、推进走到哪一步」；不含 URL/凭据等敏感信息。

## 备选与否决

- **改用 expo-audio 的 `AudioPlaylist`（原生队列，issue 修复方向 1）——否决**：
  1. 锁屏元数据 API（`setActiveForLockScreen` / `updateLockScreenMetadata`）**只在 `AudioPlayer` 上**，
     `AudioPlaylist` 没有 → 换过去直接丢掉锁屏/通知栏元数据与封面；
  2. Android 侧 `AudioPlaylist` 的 `didJustFinish` 是**硬编码 `false`**
     （`node_modules/expo-audio/android/.../AudioPlaylist.kt:191`）→ 曲末事件根本不会到 JS，
     队列播完收尾、失败跳歌、`[耗时]` 诊断全线失效；
  3. 现有「单播放器 replace + 复用 URL 缓存」的模型要整体重写。
  **换过去会把「曲末不切歌」升级成「3 分钟一到整段停」，是倒退**，本票明确不做。
- **媒体会话接管（让原生持有队列、直接响应通知栏按钮）——否决**：expo-audio 原生侧已主动移除
  prev/next（`AudioMediaSessionCallback.kt:27-31`），`AudioLockScreenOptions` 只有 seek 开关，
  应用层没有任何挂载点；要做只能自持原生媒体会话或 fork expo-audio，属独立议题。
- **只在 JS 侧加保活（唤醒锁 / 长循环 timer）——否决**：不改变「ENDED 后失去前台优先级」的机制，
  只是掩盖，而且烧电；与「尽快离开 ENDED」相比是治标。
- **曲末用 `seekTo(0)` 软重播而不换源——否决**：只能覆盖单曲循环，跨歌必须换媒体源，
  而「换源」正是离开 ENDED 的正解。
- **预取改成「提前解析 N 首」——暂不做**：本轮只补一个触发点 + 去重；多首预热涉及队列编辑、
  内存与带宽预算，需要单独的量级评估。

## 后果

- 曲末推进不再有「等一个 timer」的窗口；下一首直链在手时（预取命中 / 歌自带 url）`replace+play`
  与 `didJustFinish` 在**同一同步 tick** 完成，ENDED 停留趋近 0。
- 预取提前到剩余 15s，给解析链留出时间，显著降低「曲末当场解析」的概率。
- 新增会话内模块级状态（`immediateSources` / `prefetchInFlight` / `prefetchLastResult` /
  `finishAdvancePending`），均不落盘；`immediateSources` 写入时顺手清理超期条目。
- **本轮不解决（如实记录）**：
  1. **JS 被系统冻结时，通知栏上一首/下一首仍然不可用**——那三个按钮是 expo-notifications 的 JS 回调，
     JS 不跑就没有反应。本决策只做到「应用层能触及的天花板」：让曲末推进尽量早、尽量少依赖后台存活的 JS。
  2. 若真机判别表判定为「事件根本没到（H1）」或「进程被冻结、回调被推迟到前台（H3）」，
     则本轮改动只是**缩小窗口**而非根治；**根治需自持原生媒体会话或 fork expo-audio**，属独立议题。
  3. 非同步路径（预取未命中、必须当场解析）下 ExoPlayer 仍会在 ENDED 上停留到解析返回——
     这是「不留 ENDED」的覆盖边界。
  4. Expo Go 下的锁屏/后台限制（#327）不变，验收必须走 dev client。

## 落地

`packages/mobile/services/audioPlayer.ts`（推进 / 换源 / 预取 / 日志）+
`packages/mobile/__tests__/audioPlayer.test.ts`（`#405 曲末推进` 一组 11 条）。
文档同步：`docs/adr/README.md` 索引行、`AGENTS.md` Mobile 指针。
真机验收（dev client）按 #405 的「30 秒判别法」单独执行，本 PR 未上真机。
