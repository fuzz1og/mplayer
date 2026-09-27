# Android 后台播放机制调研（平台特性 / 同类 App 实现与 UI / 本仓库映射）

> 调研日期：2026-09-27 · 类型：调研（research skill，三个并行 subagent 独立取证后合并） · 关联：#405（后台曲末不切歌，本报告的直接消费者）、#385（播放失败处置，已真机验收）、#431（进度条拖动，暂缓）、ADR docs/adr/2026-09-27-playback-budget-layers.md
>
> **口径**：回答「Android 上后台播放这道机制是什么、同类 App 怎么实现（含通知/锁屏 UI）、我们仓库差在哪、#405 有哪几条修法」。平台部分取官方文档 + AOSP/Media3 源码；产品部分取官方文档/帮助中心与开源仓库源码；仓库部分取 worktree `playback-budgets` 的当前代码（file:line）。
> **不裁决**：#405 走哪条修法属产品/架构决策（见下面第 6 条），本报告只给依据与代价。
> **结构**：三部分各自带 TL;DR 与「参考」小节（不合并参考，便于按部分核对来源）。

## 一页结论（决策相关）

1. **平台基线**（第一部分）：后台播放唯一合法底座是**前台服务**（`android:foregroundServiceType="mediaPlayback"` + `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` 三件套）；播放/通知按钮/蓝牙按键/锁屏/车机的唯一正确入口是 `MediaSessionService` 里的 `MediaSession` + `Player`（命令自动下推，Media3 里 `onPlayerCommandRequest` 已 deprecated）；Android 13+ 系统媒体区动作最多 5 个、compact 只取前 3 个；**曲末推进与队列持久化平台不代劳**，属应用侧责任；Android 15 起「非顶层应用且无 FGS」不得请求音频焦点。
2. **同类 App 的正解**（第二部分）：把 `Player`+`MediaSession` 放进 `MediaSessionService`，Media3 自动维护 MediaStyle 通知（Metrolist：media3 1.10.1 的 `MusicService : MediaLibraryService` + `DefaultMediaNotificationProvider`；Retro Music：旧 `MediaBrowserServiceCompat` + 自建 MediaStyle，compact 三键 = 上一首/播放暂停/下一首）。队列恢复有两条路线：Metrolist 的 `persistent_queue` 开关（重开恢复上次队列）vs Symfonium 官方明确「被 OS 杀后台后不恢复队列，只保证 resume point 最新」。省电白名单是一等问题（Symfonium 有专门 FAQ、AIMP 会检测并提示、Salt Player 官方 OEM 矩阵逐机型标红）。
3. **我们差在哪**（第三部分）：#405 的曲末推进是**纯 JS 时序**（`audioPlayer.ts:108` → `:167-178` 的 `didJustFinish` → `setTimeout(…,0)` → `playSong()`），**全链路没有任何前后台判断**（`AppState` 只出现在 `perfMonitor.ts:118`）；expo-audio 官方要求 Android 调 `setActiveForLockScreen` 才有持续后台播放（否则约 3 分钟被系统停），而本仓库在 **Expo Go 下主动跳过**它（`audioPlayer.ts:528-535`），`notificationService.ts:17-33` 在 Expo Go 整块禁用通知（比官方限制更严）；expo-audio 57.0.4 的原生媒体通知只有播放/暂停（+可选 ±10s seek），**没有上一首/下一首**（PR #46020 未进 57.x）；`AudioPlaylist` 有原生曲末推进但 57.0.4 **无锁屏/FGS API**；`playerStore` 无 `persist` → 进程被杀无法自愈。
4. **本次实测补充（决定 #405 的归因）**：手机上的 `com.mplayer.mobile` 是 **release 构建 1.8.4（versionCode 25，`flags=[HAS_CODE …]` 不可调试、无 dev-launcher）**，其中 `isExpoGo === false` → **FGS/锁屏媒体会话路径是开的**；而本轮所有真机验收都跑在 **Expo Go**（无 FGS）。所以：① **#405 是 release 路径下的真实问题**，不能归因为「Expo Go 的能力边界」；② **用 Expo Go 验收后台播放不成立**——这是要先拍板的产品决策。
5. **要「像同类 App 那样」需要三件套**：Media3 `MediaSessionService`（或等价的原生前台服务）+ manifest 三件套 + 队列/进度持久化。其中 manifest 与持久化代价低（`packages/mobile/android/` 已入库，可直接改）；会话层要么等 expo-audio 补齐（57.x 无 timeline/切歌），要么自写 Expo Module 或用 react-native-track-player（两者都意味着**放弃 Expo Go** 作为后台播放的验收环境）。
6. **#405 候选路径（便宜 → 彻底）**：**A** 先在 release/dev build 上判别（本次已确认 release 环境成立，判别脚本与判据见第三部分 §3）→ **B** JS 加固（去掉 `setTimeout`、剩余 <15s 提前预取、回前台补推进；1 个文件，风险可控）→ **C** 原生队列 `AudioPlaylist`（原生曲末推进，但 57.0.4 无锁屏/FGS，价值有限）→ **D** react-native-track-player 4.x 或自写 Media3 模块（最彻底，重写播放链）。

---

## 第一部分 · Android 平台机制（FGS / MediaSession / 通知 / 音频焦点 / 省电）


> 范围：Android 平台机制本身（官方文档 + AOSP 源码）。桌面端与 expo-audio 的封装细节不在本文件范围，但会标注 MPlayer 移动端（RN/Expo）需要自己兜住的部分。

## TL;DR（≤6 条）

1. 后台播放的唯一合法底座是**前台服务**：`android:foregroundServiceType="mediaPlayback"` + `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` 三个声明缺一不可（Android 14+ 强制），且 FGS 必须显示通知。
2. `startForegroundService()` 后服务必须在「几秒」内调用 `startForeground()`；官方排障页把它归类为 `ForegroundServiceDidNotStartInTimeException`，而 AOSP 里真实窗口是 `DEFAULT_FGS_START_FOREGROUND_TIMEOUT_MS` = **10s**（另有一个 30s 的 ANR 延迟计时器），所以「5 秒」不是官方数字。
3. Android 12+ 限制后台启动 FGS，违规抛 `ForegroundServiceStartNotAllowedException`；播放场景唯一稳的走法是「用户可见时（Activity / 通知 / 媒体按键）就起 FGS」，Media3 的 `MediaSessionService` 已替你处理这套提升与异常。
4. 后台切歌、通知按钮、蓝牙按键、锁屏、车机的**唯一正确入口**是 `MediaSessionService` 里的 `MediaSession`/`Player`（命令自动下推）；`MediaSession.Callback.onPlayerCommandRequest` 在当前 Media3 里已 **deprecated**，应由 `onSetMediaItems`/`onAddMediaItems`/`onConnect` 接管数据侧。
5. Android 13 起系统媒体区（Quick Settings 旁的媒体播放器，AOSP `MediaControlsPanel`）的动作按钮由 `PlaybackState` 的 action state 生成（最多 5 个、compact 3 个），不再依赖 MediaStyle 通知的 action；媒体会话通知**豁免** `POST_NOTIFICATIONS`，但 FGS 通知不豁免。
6. 丢音频焦点必须暂停/止损：Android 12+ 系统会主动淡出并静音抢占者；Android 15 (targetSdk 35+) 起**不是顶层应用且没有 FGS 就根本不能请求音频焦点**——FGS、MediaSession、音频焦点三者互相咬合。

## 1. 为什么后台播放必须用前台服务

- 官方前台服务页开宗明义地把「音乐播放器在 FGS 里播歌、通知显示当前歌曲」列为首要例子，并说明 FGS 会显示状态栏通知让用户知道应用在耗资源。[Foreground services](https://developer.android.com/develop/background-work/services/foreground-services)
- 不使用 FGS 的进程只是普通后台进程，低内存时会被优先回收；官方对 App Standby 的描述里也把"播放音乐即使用户没在用该 app"当成前台服务的正当用途。[Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
- FGS 通知优先级必须是 `PRIORITY_LOW` 或更高，否则系统会在通知抽屉里加一条"该应用正在使用前台服务"的提示。[Launch a foreground service](https://developer.android.com/develop/background-work/services/fgs/launch)

### 1.1 mediaPlayback 类型的四个坐标（Android 14+）

| 项 | 值 |
| --- | --- |
| `android:foregroundServiceType` | `mediaPlayback` |
| Manifest 权限 | `FOREGROUND_SERVICE_MEDIA_PLAYBACK`（另加通用的 `FOREGROUND_SERVICE`） |
| `startForeground()` 常量 | `ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK` |
| 运行时前置条件 | 无 |

来源：[Foreground service types § Media](https://developer.android.com/develop/background-work/services/fgs/service-types)。注意该页的 Android 15 说明：**targetSdk ≥ 35 的应用不允许从 `BOOT_COMPLETED` 广播接收器启动 mediaPlayback 类型 FGS**（违规抛 `ForegroundServiceStartNotAllowedException`）。

两个容易踩的异常：

- 给 `startForeground()` 传了 Manifest 里没声明的类型 → `IllegalArgumentException`。
- targetSdk ≥ 34 缺权限 → 提升 FGS 时抛 `SecurityException`。

均见 [Launch a foreground service](https://developer.android.com/develop/background-work/services/fgs/launch)。`startForeground()` 本身"必须在服务启动后调用，否则服务会被停止并触发 ANR"，见 [Service#startForeground](https://developer.android.com/reference/android/app/Service#startForeground(int,%20android.app.Notification))。

### 1.2 提升窗口到底几秒

- 官方排障页写法：`context.startForegroundService()` 之后服务有 "a few seconds" 去调用 `ServiceCompat.startForeground()`，否则抛出内部异常 `ForegroundServiceDidNotStartInTimeException`（Logcat 文案 `Context.startForegroundService() did not then call Service.startForeground()`）。[Troubleshoot foreground services](https://developer.android.com/develop/background-work/services/fgs/troubleshooting)
- AOSP 实测数字：`ActivityManagerConstants.DEFAULT_FGS_START_FOREGROUND_TIMEOUT_MS = 10 * 1000`、`DEFAULT_SERVICE_START_FOREGROUND_TIMEOUT_MS = 30 * 1000`（[ActivityManagerConstants.java:236 / :304](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/main/services/core/java/com/android/server/am/ActivityManagerConstants.java)）；超时后崩溃路径见 [ActiveServices.java 约 7653 行 serviceForegroundCrash](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/main/services/core/java/com/android/server/am/ActiveServices.java)。
- **结论：把"5 秒内必须 startForeground()"当成民间经验而不是规范；规范只说"几秒"，实现是 10s / 30s 两档。**

### 1.3 Android 12+ 后台启动限制与媒体场景的例外

- targetSdk ≥ 31 时应用在后台不能启动 FGS，否则抛 `ForegroundServiceStartNotAllowedException`；豁免清单包括：从用户可见状态（Activity）迁移过来、能从后台启动 Activity、收到高优先级 FCM、**用户对与你应用相关的 UI 元素执行了操作（气泡/通知/小部件/Activity）**、精确闹钟、当前输入法、companion device 相关、用户关闭了电池优化、持有 `SYSTEM_ALERT_WINDOW` 等。[Restrictions on starting foreground services from the background](https://developer.android.com/about/versions/12/foreground-services)
- 对音乐 App 的实际落点：**"用户点了播放/切歌"本身就是豁免条件**，所以要在 Activity 内、通知按钮回调内、媒体按键回调内去起/提升 FGS，而不是等进程进了后台才起。
- 另外注意：需要 while-in-use 权限的类型（camera/location/microphone）另有更严限制，但 mediaPlayback **没有运行时权限前置条件**，所以不受这条影响（同上 service-types 页）。

## 2. MediaSession / MediaSessionService / MediaController（Media3）

- 职责划分：**`MediaSessionService` 是那个前台服务**，`Player` 与 `MediaSession` 都住在里面；系统媒体控件、Assistant、蓝牙设备、Wear OS、车机等外部客户端通过 `MediaController` 发现并连接，全程不需要你的 Activity。[Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback)
- 服务里在 `onCreate()` 构建 `Player` 与 `MediaSession`，在 `onDestroy()` 释放，是官方推荐的生命周期位置（同上）。
- Manifest 需要 `<intent-filter>` 声明 `androidx.media3.session.MediaSessionService`（兼容旧客户端再加 `android.media.browse.MediaBrowserService`），并加 `android:foregroundServiceType="mediaPlayback"`（同上）。
- **谁提升 FGS**：Media3 替你调。`MediaSessionService` 源码里用 `Util.setForegroundServiceNotification(..., FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK, "mediaPlayback")` 提升，并捕获 `ForegroundServiceStartNotAllowedException` 转成 `onForegroundServiceStartNotAllowedException()` 回调：[MediaSessionService.java 约 588 行](https://raw.githubusercontent.com/androidx/media/release/libraries/session/src/main/java/androidx/media3/session/MediaSessionService.java)。

### 2.1 「后台切歌」的正确入口

- `MediaController` 发出的播放/列表命令，`MediaSession` 会自动下推给 `Player`："Playback and playlist commands defined in the `Player` interface are automatically handled by the session." [Control and advertise playback using a MediaSession](https://developer.android.com/media/media3/session/control-playback)
- 因此后台切歌 = 系统 UI 按钮 → 系统 `MediaController` → 你的 `MediaSession` → `Player.pause()/seekToNextMediaItem()/...`；**不要**在 Activity 里监听通知点击再自己切歌。
- 你要接管的是"拦截点"：
  - `MediaSession.Callback.onSetMediaItems` / `onAddMediaItems`：控制器只想给 `mediaId`（没有 URI）时，你要把它解析成可播放的 `MediaItem`；默认实现只在每个 item 都有 `MediaItem.LocalConfiguration`（如 URI）时原样返回，否则返回 `UnsupportedOperationException`。[MediaSession.Callback](https://developer.android.com/reference/androidx/media3/session/MediaSession.Callback)
  - `onConnect`：按 `ControllerInfo` 决定接受/拒绝客户端与可用命令集（同上，及 control-playback 页）。
  - `onPlayerCommandRequest` 在当前 Media3 引用页已标注 **deprecated**，建议改为"调整 player 可用命令 / `setAvailableCommands`"（同上引用页）。**所以题目里"onPlay/onPause/onSkipToNext/onSeekTo 是唯一入口"这个说法在 Media3 下不成立**：这些方法名属于**平台旧 API** `android.media.session.MediaSession.Callback`（`onPlay()`、`onPause()`、`onSkipToNext()`、`onSeekTo()`，见 [android.media.session.MediaSession.Callback](https://developer.android.com/reference/android/media/session/MediaSession.Callback)）；Media3 里对应的是"会话自动下推 + 数据侧回调"。
- `setSessionActivity(PendingIntent)`：给会话挂一个"回到正在播放界面"的入口。API < 33 时它被用作通知的 content intent（点通知即打开该 Activity）；API ≥ 33 起，媒体通知**直接从 session 读取**这个 pending intent，所以点击通知、媒体播放器、锁屏面板都能回到 App。[MediaSession.Builder#setSessionActivity](https://developer.android.com/reference/androidx/media3/session/MediaSession.Builder)

### 2.2 `MediaSessionService.onTaskRemoved` 的语义

- 官方 JavaDoc：默认行为是"**正在播放**（服务已在前台，且至少有一个会话在播放）就保持服务运行；否则暂停播放并调用 `pauseAllPlayersAndStopSelf()`，触发 `onDestroy`"。可以安全地不调 `super` 覆盖，例如无条件 `pauseAllPlayersAndStopSelf()`；但"如果播放没有在进行，服务必须被终止，否则服务会崩溃并被系统重启"。[MediaSessionService](https://developer.android.com/reference/androidx/media3/session/MediaSessionService)
- 该页还强调：**在所有 MediaController 解绑前服务无法停止**，所以 Activity 里连的 controller 要在 `Activity.onStop()` 释放。
- 源码实现即上述判断（[MediaSessionService.java 约 753 行](https://raw.githubusercontent.com/androidx/media/release/libraries/session/src/main/java/androidx/media3/session/MediaSessionService.java)）；`onStartCommand` 返回 `START_STICKY`（同文件约 584 行）。

## 3. 通知与系统媒体 UI

- Media3 的 `MediaSessionService` 默认自动发布并续更一条 `MediaStyle` 通知（`DefaultMediaNotificationProvider`），展示标题/艺人/封面 + 播放控制（[Background playback](https://developer.android.com/media/media3/session/background-playback)；[DefaultMediaNotificationProvider](https://developer.android.com/reference/androidx/media3/session/DefaultMediaNotificationProvider)）。
- 平台侧 `Notification.MediaStyle` 的三条硬约束：
  - 附加 `android.media.session.MediaSession.Token`（`setMediaSession`）后 System UI 才能识别"这条通知代表一个活跃媒体会话"（例如在锁屏显示封面）。
  - 展开视图最多 5 个 action 以图标按钮呈现；`setShowActionsInCompactView(int...)` **最多 3 个** action 可提升到标准紧凑视图。
  - Android O 起附加会话的通知会被着色；Android V 起有效 MediaStyle 通知会被设置 `NO_CLEAR` 标志（不易被划掉）。
  以上见 [Notification.MediaStyle](https://developer.android.com/reference/android/app/Notification.MediaStyle)；Media3 侧的对应默认值：`addMediaButtons` 默认把 `seekToPreviousMediaItem`、play/pause、`seekToNextMediaItem` 放进 compact view，可用 extras 键 `COMMAND_KEY_COMPACT_VIEW_INDEX`（`androidx.media3.session.command.COMPACT_VIEW_INDEX`）指到最多 3 个命令。[DefaultMediaNotificationProvider](https://developer.android.com/reference/androidx/media3/session/DefaultMediaNotificationProvider)
- **Android 13 起动作按钮的来源变了**：System UI 的媒体区根据 `PlaybackState` 的 action state 生成按钮（AOSP `MediaDataManager#createActionsFromState`），而不是像 Android 12 那样读 MediaStyle 通知的 action；对未适配的应用保留兼容布局。[Media controls in System UI (AOSP)](https://source.android.com/docs/core/display/media-control)
  - 官方同时给出正表：系统最多展示 5 个动作槽，**compact 模式只显示前 3 个**；槽 1 = Play/Pause（依据 `playWhenReady` 与 `STATE_ENDED`/`STATE_BUFFERING`/`STATE_READY`），槽 2 = Previous 或 `CommandButton.SLOT_BACK` 自定义，槽 3 = Next 或 `CommandButton.SLOT_FORWARD`；进度条要求 `PlaybackState.Builder#setActions` 含 `ACTION_SEEK_TO`。[Media controls](https://developer.android.com/media/implement/surfaces/mobile)
  - 实践含义：**要让系统媒体区显示什么按钮，靠的是 `setMediaButtonPreferences` + `PlaybackState` 的 action，而不是你自己拼通知 action**（同上）。
- 通知权限：Android 13+ 的 `POST_NOTIFICATIONS` 是运行时权限，新安装应用通知默认关闭；但**媒体会话通知明确豁免**该变更；FGS 通知不豁免——用户拒绝后，"与前台服务相关的通知在通知栏看不到、只在任务管理器里看得到"。[Notification runtime permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)
  - 另一种说法（同样是官方页）："应用不需要 `POST_NOTIFICATIONS` 也能启动 FGS，但启动 FGS 时必须带通知"（同上）。所以媒体 App 的正确姿势仍是主动申请该权限，但即使被拒，系统媒体区仍能显示你的会话（属官方行为，非旁路）。
- Android 11 起媒体控制位于快速设置附近，多个会话组成可滑动的 carousel，顺序为"本地播放 → 远程/投播 → 可恢复的历史会话"，用户可以从 carousel 重启上一次会话而不启动 App。[Media controls](https://developer.android.com/media/implement/surfaces/mobile)、[Android 11 features § Media Controls](https://developer.android.com/about/versions/11/features)
- 媒体恢复（media resumption）：可在 设置 > 声音 > 媒体 里开关；Media3 侧用 `MediaSession.Callback.onPlaybackResumption` 提供"控制器要求播放但没有当前 MediaItem 时应该准备什么列表"（通知/媒体按键触发的恢复走这里）。（[Media controls](https://developer.android.com/media/implement/surfaces/mobile)、[MediaSession.Callback](https://developer.android.com/reference/androidx/media3/session/MediaSession.Callback)）
- 锁屏控制：属于同一套 System UI 媒体区，会话出现即可用（上面 MediaStyle 的 `setMediaSession(Token)` 说明即为官方依据）。

## 4. 音频焦点（Audio Focus）

- 官方推荐流程：在媒体会话的 `onPlay()` 回调里 `requestAudioFocus()`；另一应用取得焦点时暂停或降音量；播放结束（无内容可播）时 abandon 焦点；用 `AudioAttributes` 描述内容类型（语音类用 `CONTENT_TYPE_SPEECH`）。[Audio focus](https://developer.android.com/media/optimize/audio-focus)
- 三个关键常量语义（[AudioManager](https://developer.android.com/reference/android/media/AudioManager)）：
  - `AUDIOFOCUS_LOSS`：时长未知的焦点丢失；
  - `AUDIOFOCUS_LOSS_TRANSIENT`：**暂时**丢失焦点（应暂停、可恢复）；
  - `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK`：新焦点持有者不要求静音，可以"压低音量继续播"；
  - `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`：请求者只短暂占用，允许别人继续播（系统自动 duck）。
- `AudioFocusRequest.Builder`：`setAudioAttributes`、`setAcceptsDelayedFocusGain`、`setOnAudioFocusChangeListener`、`setWillPauseWhenDucked(boolean)`。[AudioFocusRequest.Builder](https://developer.android.com/reference/android/media/AudioFocusRequest.Builder)
- `setWillPauseWhenDucked(true)` 的语义：声明"宁暂停不降音量"，系统会改为回调焦点监听器而不自动 duck；**语音内容（`CONTENT_TYPE_SPEECH`）系统本来就不自动 duck**，会回调 `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK` 让你自己暂停。[AudioFocusRequest](https://developer.android.com/reference/android/media/AudioFocusRequest)
- 为什么"丢焦点必须暂停"：
  - Android 12+ **音频焦点由系统强制管理**：别的应用请求焦点时系统会让你的播放淡出，来电时直接静音；继续硬播没有意义还要跟系统对抗（[Audio focus](https://developer.android.com/media/optimize/audio-focus)）。
  - Android 15 (targetSdk ≥ 35) 起：**不是顶层应用、也没有运行前台服务时不能请求音频焦点**（同上页）。这条把"播放放 FGS"从最佳实践变成硬前置。
- Media3/ExoPlayer 可以替你管：给 `ExoPlayer` 调 `setAudioAttributes(attrs, /* handleAudioFocus= */ true)` 后官方建议"不要再自己写请求/响应音频焦点的代码"（同页顶部 Note）。**RN 的 expo-audio 不暴露这层时，需要在原生/JS 侧自己接 `AudioManager`（推断，无一手依据：Expo 官方文档未描述音频焦点策略）。**

## 5. 省电与后台存活

- **Doze**：设备未插电、屏幕关闭且静止一段时间后进入，系统推迟应用的网络与 CPU 密集访问（媒体串流会受影响）。[Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
- **App Standby / bucket**：系统按使用习惯把应用分到 active / working_set / frequent / rare / restricted；"有前台服务"本身算"应用没闲着"的证据之一。restricted bucket 的限制包括**不能启动前台服务、已有 FGS 会被移出前台**。[Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)、[Android 13 behavior changes](https://developer.android.com/about/versions/13/behavior-changes-all)
- **屏幕熄灭后还能不能播**：
  - 后台播放的官方定式就是 FGS（见 §1），`MediaSessionService` 会在播放期间维持前台状态；配合音频输出本身即可持续播放，通常**不需要**手写 `WakeLock`。
  - `MediaPlayer.setWakeMode(Context, int)` 的官方描述是"设置该 MediaPlayer 的底层电源管理行为"，且可在任意状态调用、不改变对象状态。[MediaPlayer](https://developer.android.com/reference/android/media/MediaPlayer) —— 这是**旧平台播放器**的 API，Media3/ExoPlayer 里没有等价必需项（推断，无一手依据：Media3 文档未把 WakeLock 列为播放前提；ExoPlayer 内部用 AudioTrack，音频播放期间系统保持 CPU 唤醒）。
  - `PowerManager.PARTIAL_WAKE_LOCK`：保证 CPU 运行、允许屏幕与键盘背光关闭。[PowerManager](https://developer.android.com/reference/android/os/PowerManager)。若确实要自己持锁，最稳的实践是"只在播放中持有、暂停即释放"，但官方文档对音乐播放场景并不要求你这么做（推断，无一手依据）。
  - `WifiLock`：本文件未在一手来源中找到"后台播放必须持 WifiLock"的官方表述，**标注为无依据**；离线/本地播放本身不需要。
- **为什么"说了 FGS 仍会被杀"**：官方**没有任何 API 或文案承诺"前台服务=永不被杀"**。技术上能拿到的最强保障只有 `isIgnoringBatteryOptimizations()` 报告的电源白名单：在名单上的应用可在 Doze/App Standby 期间使用网络并持有 partial wake lock，但其他限制依然生效（jobs/sync 仍被推迟、普通 Alarm 不触发）。[PowerManager#isIgnoringBatteryOptimizations](https://developer.android.com/reference/android/os/PowerManager)、[Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
- 白名单怎么申请：多数应用引导用户去 `Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`；符合"可接受用途"的应用才可用 `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 直接弹窗；官方同时警告 **Google Play 政策禁止核心功能未受影响的 App 直接请求电源管理豁免**。[Optimize for Doze and App Standby（Exemptions）](https://developer.android.com/training/monitoring-device-state/doze-standby)、[Google Play Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/9888379)
- **国产 ROM 额外清理**：没有任何 AOSP / developer.android.com 一手文档规定"厂商可杀 FGS"或提供规避 API；从一手来源只能得到边界——**应用侧能做的只有"标准 FGS + 通知 + MediaSession + 白名单/自启动引导"，剩下的属于 OEM 定制策略，Supervisor/白名单设置页面因 ROM 而异**（推断，无一手依据）。

## 6. 进程被杀与状态恢复

- `Service` 的 `onStartCommand()` 返回值语义：`START_STICKY` 用于"显式启动/停止"的服务（被杀后系统倾向重建服务，但不保证重投 Intent）；`START_NOT_STICKY`/`START_REDELIVER_INTENT` 用于"只为处理命令而活"的服务；进程在内存压力下随时可能被杀、之后系统会尝试重启服务。[Service](https://developer.android.com/reference/android/app/Service)
- Media3 的 `MediaSessionService` 在 `onStartCommand` 里返回 `START_STICKY`（[MediaSessionService.java 约 584 行](https://raw.githubusercontent.com/androidx/media/release/libraries/session/src/main/java/androidx/media3/session/MediaSessionService.java)）。**注意：这只保证服务可能被重建，队列与播放位置不会自动回来。**
- `onTaskRemoved(Intent)`：官方语义是"服务正在运行且用户移除了来自该服务所属应用的 task"时被调用；**不会**帮你保存状态。[Service#onTaskRemoved](https://developer.android.com/reference/android/app/Service)
- 官方给的恢复路线分两层：
  1. **媒体恢复（media resumption）**：系统媒体播放器保留一个可重启的上次会话入口，用户点击后系统把播放请求发到你的应用；Media3 里实现 `MediaSession.Callback.onPlaybackResumption` 返回上次的 `MediaSession.MediaItemsWithStartPosition`（列表 + 起始位置），随后 Media3 会自动 `setMediaItems` / `prepare` / `play`。[MediaSession.Callback](https://developer.android.com/reference/androidx/media3/session/MediaSession.Callback)、[Media controls](https://developer.android.com/media/implement/surfaces/mobile)
  2. **应用自己的持久化**：队列、当前项、位置必须自己落盘。官方文档没有"官方推荐用某某存储"的规定（推断，无一手依据）；但 Media3 的恢复回调要求你**主动返回**这些数据，这本身说明保存责任在应用侧。[Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback)
- 另外要分清"系统恢复"与"用户主动打开"：应用自己发的 Activity PendingIntent 会带 `getIntent()`，可通过它区分冷启动/恢复请求，这是官方 Playback resumption 示例的常规做法（推断，无一手依据：该页当前在本环境的抓取返回 404，未能引用原文）。

## 7. 曲末行为（STATE_ENDED / repeat / 列表末）

- 官方三态之外，`Player.STATE_ENDED` 的定义是"the player finished playing all media"；`Player.Listener.onPlaybackStateChanged(@State int state)` 是接收播放状态变化的接口。[Listening to player events](https://developer.android.com/media/media3/exoplayer/listening-to-player-events)
- `Player.setRepeatMode` 决定列表末尾发生什么（[Playlists](https://developer.android.com/media/media3/exoplayer/playlists)）：
  - `REPEAT_MODE_OFF`：不重复，播完最后一项后进入 `STATE_ENDED`；
  - `REPEAT_MODE_ONE`：当前项无限循环；
  - `REPEAT_MODE_ALL`：整个列表无限循环；
  - 可叠加 `setShuffleModeEnabled(true)`。
- `onMediaItemTransition(mediaItem, reason)`：每次切换到新 item（自动、seek、重复、列表变更）都会回调，`reason` 说明原因（同上 listening-to-player-events 页）。这是把"当前曲目"同步到通知/会话元数据的地方。
- **列表末尾在后台时应发生什么**：平台/Media3 的默认就是 `STATE_ENDED`，此时：
  - 系统媒体区的槽 1 会切回 Play 图标（官方槽位表把 `STATE_ENDED` 归入显示 Play 的分支），[Media controls](https://developer.android.com/media/implement/surfaces/mobile)；
  - 播放器自身保持 `STATE_ENDED`，`MediaSessionService` **不会**因此自动停止（它只看"是否有会话在播"），要不要停服务/停通知由你在 `onPlaybackStateChanged(STATE_ENDED)` 里决定；若希望继续听就设 `REPEAT_MODE_ALL`，两条路都符合官方语义。
- 后台切歌（含自动切下一首）依然走 `Player`/`MediaSession`：见 §2.1；音频焦点请求则应绑定在播放真正开始的地方（§4）。

## 8. Android 11 → 16 版本差异速查表

| 版本 | 与后台播放/媒体通知相关的关键变化 | 一手来源 |
| --- | --- | --- |
| 11 (API 30) | 媒体控制移到快速设置附近的 carousel（本地播放 / 远程 / 可恢复历史会话）；可从 carousel 重启上次会话；`MediaControlsPanel` 形态确立 | [A11 features](https://developer.android.com/about/versions/11/features)、[Media controls](https://developer.android.com/media/implement/surfaces/mobile) |
| 12 (API 31) | 应用在后台禁止启动 FGS（有豁免清单，违规抛 `ForegroundServiceStartNotAllowedException`）；FGS 通知可延迟最多 10s 显示；系统强制音频焦点（淡出/来电静音）；restricted standby bucket 默认生效 | [A12 FGS](https://developer.android.com/about/versions/12/foreground-services)、[A12 behavior changes](https://developer.android.com/about/versions/12/behavior-changes-all)、[Audio focus](https://developer.android.com/media/optimize/audio-focus) |
| 13 (API 33) | 系统媒体区动作按钮改由 `PlaybackState` action 生成（通知 action 退为兼容路径）；`POST_NOTIFICATIONS` 运行时权限（媒体会话通知豁免、FGS 通知不豁免）；Task Manager 让用户一键停掉带 FGS 的应用；`setSessionActivity` 的 pending intent 由媒体通知直接读取 | [AOSP media control](https://source.android.com/docs/core/display/media-control)、[Notif permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)、[A13 behavior changes](https://developer.android.com/about/versions/13/behavior-changes-all)、[MediaSession.Builder](https://developer.android.com/reference/androidx/media3/session/MediaSession.Builder) |
| 14 (API 34) | 每个 FGS 必须声明类型 + 对应权限（mediaPlayback → `FOREGROUND_SERVICE_MEDIA_PLAYBACK`），缺权限抛 `SecurityException` | [A14 target changes](https://developer.android.com/about/versions/14/behavior-changes-14)、[FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types) |
| 15 (API 35) | targetSdk ≥ 35 不得从 `BOOT_COMPLETED` 启动 mediaPlayback FGS（抛 `ForegroundServiceStartNotAllowedException`）；新增 mediaProcessing 类型与 6h/24h FGS 超时（**不含 mediaPlayback**，超时后 `Service.onTimeout()`）；非顶层应用且无 FGS 不能请求音频焦点 | [A15 behavior changes](https://developer.android.com/about/versions/15/behavior-changes-15)、[FGS timeout](https://developer.android.com/develop/background-work/services/fgs/timeout)、[Audio focus](https://developer.android.com/media/optimize/audio-focus) |
| 16 (API 36) | 官方行为变更页未列出后台播放/媒体通知的新增限制；与本域相关的只有 JobScheduler 运行配额（"与前台服务并发执行的 Job 也要受配额约束"）——如果切歌/预取用了 WorkManager 需注意 | [A16 behavior changes](https://developer.android.com/about/versions/16/behavior-changes-all)（"未列出新限制"为对官方页面的核对结论） |

## 参考

- [Foreground services（总览）](https://developer.android.com/develop/background-work/services/foreground-services)
- [Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Launch a foreground service](https://developer.android.com/develop/background-work/services/fgs/launch)
- [Troubleshoot foreground services](https://developer.android.com/develop/background-work/services/fgs/troubleshooting)
- [Foreground service timeout behavior](https://developer.android.com/develop/background-work/services/fgs/timeout)
- [Restrictions on starting foreground services from the background（Android 12）](https://developer.android.com/about/versions/12/foreground-services)
- [Android 14：foreground service types required / targetSdk 行为变更](https://developer.android.com/about/versions/14/behavior-changes-14)
- [Android 15 behavior changes（targetSdk 35）](https://developer.android.com/about/versions/15/behavior-changes-15)
- [Android 16 behavior changes（targetSdk 36）](https://developer.android.com/about/versions/16/behavior-changes-all)
- [Android 13 behavior changes（all apps）](https://developer.android.com/about/versions/13/behavior-changes-all)
- [Android 12 behavior changes（all apps）](https://developer.android.com/about/versions/12/behavior-changes-all)
- [Android 11 features § Media Controls](https://developer.android.com/about/versions/11/features)
- [Service](https://developer.android.com/reference/android/app/Service)
- [Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback)
- [Control and advertise playback using a MediaSession](https://developer.android.com/media/media3/session/control-playback)
- [MediaSession.Callback](https://developer.android.com/reference/androidx/media3/session/MediaSession.Callback)
- [MediaSession.Builder#setSessionActivity](https://developer.android.com/reference/androidx/media3/session/MediaSession.Builder)
- [MediaSessionService](https://developer.android.com/reference/androidx/media3/session/MediaSessionService)
- [DefaultMediaNotificationProvider](https://developer.android.com/reference/androidx/media3/session/DefaultMediaNotificationProvider)
- [android.media.session.MediaSession.Callback（平台旧 API）](https://developer.android.com/reference/android/media/session/MediaSession.Callback)
- [Notification.MediaStyle](https://developer.android.com/reference/android/app/Notification.MediaStyle)
- [Notification runtime permission（POST_NOTIFICATIONS）](https://developer.android.com/develop/ui/views/notifications/notification-permission)
- [Media controls（系统媒体 UI 与动作槽位）](https://developer.android.com/media/implement/surfaces/mobile)
- [Media controls in System UI（AOSP）](https://source.android.com/docs/core/display/media-control)
- [Audio focus](https://developer.android.com/media/optimize/audio-focus)
- [AudioFocusRequest](https://developer.android.com/reference/android/media/AudioFocusRequest) / [AudioFocusRequest.Builder](https://developer.android.com/reference/android/media/AudioFocusRequest.Builder) / [AudioManager](https://developer.android.com/reference/android/media/AudioManager)
- [Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [PowerManager（PARTIAL_WAKE_LOCK / isIgnoringBatteryOptimizations）](https://developer.android.com/reference/android/os/PowerManager)
- [MediaPlayer（setWakeMode）](https://developer.android.com/reference/android/media/MediaPlayer)
- [Google Play：Device and Network Abuse（电源管理豁免政策）](https://support.google.com/googleplay/android-developer/answer/9888379)
- [Listening to player events（STATE_ENDED / onMediaItemTransition）](https://developer.android.com/media/media3/exoplayer/listening-to-player-events)
- [Playlists（setRepeatMode）](https://developer.android.com/media/media3/exoplayer/playlists)
- AOSP 源码：[ActiveServices.java](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/main/services/core/java/com/android/server/am/ActiveServices.java)、[ActivityManagerConstants.java](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/main/services/core/java/com/android/server/am/ActivityManagerConstants.java)、[Service.java](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/main/core/java/android/app/Service.java)
- Media3 源码：[MediaSessionService.java](https://raw.githubusercontent.com/androidx/media/release/libraries/session/src/main/java/androidx/media3/session/MediaSessionService.java)、[MediaSession.java](https://raw.githubusercontent.com/androidx/media/release/libraries/session/src/main/java/androidx/media3/session/MediaSession.java)、[DefaultMediaNotificationProvider.java](https://raw.githubusercontent.com/androidx/media/release/libraries/session/src/main/java/androidx/media3/session/DefaultMediaNotificationProvider.java)
- 附（MPlayer 移动端相关，非本文主题）：[expo-audio 官方文档](https://docs.expo.dev/versions/latest/sdk/audio/)（`enableBackgroundPlayback` 会加 FGS + `FOREGROUND_SERVICE_MEDIA_PLAYBACK`；官方提示 Android 上不启用锁屏控制时后台播放约 3 分钟后停止）

## 第二部分 · 同类 App 后台播放的实现与 UI（11 个产品）

## TL;DR（≤6 条）

1. **平台基线**：后台播放的正解是把 `Player`+`MediaSession` 放进 `MediaSessionService`，manifest 声明 `android:foregroundServiceType="mediaPlayback"` 且申请 `FOREGROUND_SERVICE_MEDIA_PLAYBACK`；Media3 会自动替你发布并维护 MediaStyle 通知（[Android 官方：Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback)）。
2. **开源样板两代并存**：Metrolist 用 media3 **1.10.1** 的 `MusicService : MediaLibraryService` + `DefaultMediaNotificationProvider`（[MusicService.kt](https://github.com/MetrolistGroup/Metrolist/blob/main/app/src/main/kotlin/com/metrolist/music/playback/MusicService.kt)、[libs.versions.toml](https://github.com/MetrolistGroup/Metrolist/blob/main/gradle/libs.versions.toml)）；Retro Music 仍走 `MusicService : MediaBrowserServiceCompat` + 自建 `MediaStyle().setShowActionsInCompactView(1,2,3)`，compact 三键 = 上一首/播放暂停/下一首（[PlayingNotification.kt](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/java/code/name/monkey/retromusic/service/notification/PlayingNotification.kt)）。
3. **通知按钮是硬预算**：Android 13+ 系统媒体区最多渲染 5 个 action、compact 只取前 3 个槽位（[Android 官方：Media controls](https://developer.android.com/media/implement/surfaces/mobile)）；Symfonium 官方文档写实为「通知栏 4 个、Android Auto 5 个，上一首/下一首位置固定」（[文档](https://docs.symfonium.app/wiki/settings/settings-playback-notification-media-session-buttons/)）。
4. **队列恢复两条路线**：Metrolist 有开关 `persistent_queue`「Restore your last queue when the app starts」（[strings.xml](https://github.com/MetrolistGroup/Metrolist/blob/main/app/src/main/res/values/strings.xml)）；Symfonium 官方反其道而行——「被 OS 杀后台后不自动恢复当前队列，只保证 resume point 在暂停/停止时最新」（[文档](https://docs.symfonium.app/wiki/other/resuming-audiobook-album-playlist/)）。
5. **省电/白名单是一等问题**：Symfonium 有专门 battery optimization FAQ（[文档](https://docs.symfonium.app/faq/playback-stops-randomly-thumbnails-images-are-disappearing/)），AIMP changelog 有「检测并提示后台运行受限」条目（[changelog](https://aimp.ru/?do=changelog&merge=1&os=android&ver=400)），Salt Player 官方 OEM 矩阵里鸿蒙音乐控制中心、小米背屏均因白名单 🔴（[README-zh-hans](https://github.com/Moriafly/SaltPlayerSource/blob/main/README-zh-hans.md)）。
6. **闭源大厂普遍不公开后台细节**：Spotify 只在开发者文档说「客户端自己负责后台播放」（[Spotify for Developers](https://developer.spotify.com/documentation/android/tutorials/application-lifecycle)），YouTube Music 把后台播放定义为 Premium 权益（[帮助](https://support.google.com/youtubemusic/answer/6313552)），Apple Music(Android) 官方页只覆盖 Android Auto/Chromecast（[Apple 支持](https://support.apple.com/en-us/101645)）——通知控件、锁屏可见项一律「官方未说明」。

## 取证口径

- 一手来源限于：官方帮助中心/支持页、官方开发者文档、官方商店页与 changelog、开源仓库源码、官方论坛/官方社区中由维护者署名的答复。
- 闭源 App 只按其官方文字下结论；官方没写的能力一律标「官方未说明」，我的推测另标「（推断，无一手依据）」。
- 源码结论均给出文件级链接（阅读的是仓库 `main`/`dev`/`master` 分支当前内容），未引用二手博客或聚合站。

## 平台侧一手事实（所有产品共享的约束）

- **服务形态**：官方推荐 `MediaSessionService`；它被 `MediaController` 创建后即以前台服务运行，并需 `FOREGROUND_SERVICE`+`FOREGROUND_SERVICE_MEDIA_PLAYBACK` 权限、manifest 内 `foregroundServiceType="mediaPlayback"` 与 action `androidx.media3.session.MediaSessionService`（[官方](https://developer.android.com/media/media3/session/background-playback)、[API ref](https://developer.android.com/reference/androidx/media3/session/MediaSessionService)）。
- **系统媒体面板**：Android 13 起媒体控制由系统渲染，最多 5 个按钮，compact 模式只显示前 3 个；用 Media3 的 `MediaSession` 时 `PlaybackState` 自动同步，用 `MediaSessionService` 时通知也自动发布（[官方](https://developer.android.com/media/implement/surfaces/mobile)）。
- **老路仍可用**：`MediaBrowserServiceCompat` + `MediaStyle` + `setShowActionsInCompactView()` 是 Android 13 之前的派生路径，系统为未适配的 App 保留兼容布局（同上，[Media3 迁移指南](https://developer.android.com/media/media3/exoplayer/migration-guide)）。

## 逐产品

### Spotify（Android）

- **机制**：官方未说明技术栈。一手可证的只有行为边界——Spotify for Developers 明确「Spotify 客户端会自己负责后台播放，第三方集成方不需要自建服务保活」（[开发者文档](https://developer.spotify.com/documentation/android/tutorials/application-lifecycle)）。是否用 Media3/ExoPlayer 官方从未公布（推断，无一手依据）。
- **通知 UI**：官方文档未描述控件与 compact 布局。Spotify 官方社区里工作人员/版主给出的可操作事实是通知类别名为 **Playback**，关掉它可同时隐藏通知面板与锁屏上的媒体播放器（[社区帖](https://community.spotify.com/t5/Android/Disable-Playback-Controls/td-p/6096206)）；版主另称锁屏控件「无法在 App 内关闭，这是预期行为」（[社区帖](https://community.spotify.com/t5/Android/Lock-screen-controls-android-11/td-p/5149668)）。均为社区答复，非产品文档。
- **锁屏 / 系统媒体面板**：同上。官方支持站只有 iOS 的锁屏 widget 文章，Android 无对应文档（[Spotify 支持](https://support.spotify.com/us/article/spotify-iphone-widget/)）。
- **曲末与队列**：官方未说明。
- **省电**：Spotify 官方无 Android 白名单指引（未找到官方文章）。OEM 侧一手材料可参考三星支持页专门为「Spotify 锁屏后停播」写的关电池优化/睡眠应用步骤（[Samsung 支持](https://www.samsung.com/uk/support/mobile-devices/what-to-do-if-spotify-stops-playing-when-the-screen-is-locked/)）。
- **耳机/蓝牙、Android Auto/Wear**：官方车机页把 Android Auto、Bluetooth、Spotify Connect 并列（[支持](https://support.spotify.com/us/article/spotify-in-the-car/)）；Wear OS 需手表 Wear OS 2.2+/Android 9+（[支持](https://support.spotify.com/us/article/spotify-on-wear-os/)）；系统要求 Android 7.0+（[支持](https://support.spotify.com/us/article/supported-devices-for-spotify/)）。耳机线控的官方声明未见。

### YouTube Music（Android）

- **机制**：官方未说明。
- **通知 UI / 锁屏**：官方未说明控件细节；平台层面受 Android 13+ 系统媒体面板约束（推断其走系统媒体控制，无一手依据）。
- **曲末与队列**：官方未说明。
- **省电**：官方未说明。
- **后台播放本身是权益**：官方帮助页把 background play 列为 Premium 权益（「屏幕关闭仍继续听」），仅多数播客免会员可后台（[帮助](https://support.google.com/youtubemusic/answer/6313552)、[Premium 权益](https://support.google.com/youtubemusic/answer/9266556)）。
- **Android Auto / Wear**：官方明确支持——登录后 YouTube Music 出现在 Android Auto 的 music 标签；Wear OS 2+ 可脱离手机流播/下载，官方注明音频为 **128 kbps AAC**（[帮助](https://support.google.com/youtubemusic/answer/9231765)、[Wear OS 帮助](https://support.google.com/wearos/answer/11167087)）。

### Apple Music（Android）

- **机制 / 通知 / 锁屏 / 队列 / 省电 / 耳机**：官方未说明（官方页只讲安装、Cast、Android Auto）。
- **官方声明到的边界**：Android 5.0+ 或支持 Android 应用的 Chromebook；Android Auto 需 Apple Music for Android **2.6+**（[Apple 支持](https://support.apple.com/en-us/101645)）。

### Poweramp

- **机制**：官方 API 文档（作者维护）声明 **build 817+** 实现 `MediaSessionCompat` 与 `MediaBrowserServiceCompat`，可用 MediaBrowser/MediaBrowserCompat 取得会话并控制播放；除 `AddQueueItem`/`RemoveQueueItem`（其播放列表通常不可改）与 captioning 外全部支持（[powerampapi readme](https://github.com/maxmpz/powerampapi/blob/master/poweramp_api_lib/readme.md)）。
- **通知 UI**：Android 13+ 默认走系统媒体状态面板（播放中一般无法划掉，暂停/停止后自行消失），可在 **设置 → Look and Feel → Notifications** 改样式与显示的控件（含显示「X」直接关闭通知并停止播放）（[官方论坛维护者答复](https://forum.powerampapp.com/topic/28476-poweramp-in-notification-bar-as-it-was-before-android-13/)）。
- **锁屏 / 系统媒体面板**：官网把 Android Auto、Chromecast、Lockscreen、Widgets 并列为「到处都能控制」（[官网](https://powerampapp.com/)）。
- **曲末与队列**：官方 API 明确会话不支持增删队列项 → 队列由应用内维护（[readme](https://github.com/maxmpz/powerampapi/blob/master/poweramp_api_lib/readme.md)）；杀进程后是否恢复队列官方未说明。
- **省电**：官方站点未给白名单/电池优化指引（官方论坛在本环境被 Cloudflare 拦截，无法取证）→ 官方未说明。
- **耳机/蓝牙**：官网明确「headset buttons, and Bluetooth controls all work the way you expect」（[官网](https://powerampapp.com/)）。Wear OS 官方未见声明。

### Musicolet

- **机制**：官方未说明（闭源，官网与商店页只有功能描述）。
- **通知 UI**：官网可证「可从通知、小部件、锁屏把歌曲加入多个播放列表」、锁屏带**队列与歌词**（[官网](https://krosbits.in/musicolet/)）；compact 三键与 MediaStyle 细节官方未说明。
- **锁屏 / 系统媒体面板**：同上，官方只声明锁屏含队列与歌词。
- **队列**：官方商店页写「每个文件夹/专辑/艺术家/播单独立队列，可随时从上次位置恢复」（[Google Play](https://play.google.com/store/apps/details?hl=en&id=in.krosbits.musicolet)）——多队列 + 位置恢复是官方卖点。
- **省电**：官方未说明（官网无 FAQ 条目）。
- **耳机/蓝牙、Auto**：官网明示 **Works with Android Auto**；并声明**无网络权限**（纯本地曲库）（[官网](https://krosbits.in/musicolet/)）。睡眠定时有 hh:mm 与「N 首后」两种（同上）。

### AIMP for Android

- **机制**：官方未说明（闭源；changelog 只用功能语言描述，无 Media3/MediaSession 字样）。
- **通知 UI**：changelog 记录「通知区播放控制（Android 3.0+）」「睡眠定时可从通知栏取消」「通知可显示关闭按钮以终止应用」，以及近期新增「通知 / Android Auto 的自定义按钮」（[changelog 汇总](https://www.aimp.ru/?do=changelog&f=547&merge=1&os=android&s=84)、[v4.20 新闻](https://aimp.ru/?do=news&id=194)）。
- **曲末与队列**：v4.20 起 Android Auto 有「All Tracks」视图，并支持按文件系统文件夹快速建播单（[新闻](https://aimp.ru/?do=news&id=194)、[changelog](http://aimp.ru/?do=changelog&os=android)）；睡眠定时新增「等当前曲结束」选项。
- **省电**：changelog 出现过「检测并提示后台运行受限」（俄文：определение и уведомление об ограничении работы в фоновом режиме），即 App 会主动检测并告知用户被系统限制（[changelog](https://aimp.ru/?do=changelog&merge=1&os=android&ver=400)）。
- **耳机/蓝牙**：changelog 有针对「耳机断开时是否暂停」的修复条目，说明按耳机事件接管播放（[changelog](https://aimp.ru/?do=changelog&f=1467&os=android&s=40)）。
- **Android Auto**：多版本 changelog 反复出现（明确支持）；Wear OS 官方未见声明。

### VLC for Android（开源）

- **机制**：自研 libVLC 解码 + **AndroidX Media**（`androidx.media:media:1.6.0`，非 Media3）；`PlaybackService : MediaBrowserServiceCompat`，manifest 内 `android:foregroundServiceType="mediaPlayback"`，持有 `FOREGROUND_SERVICE_MEDIA_PLAYBACK`，intent-filter 只有 `android.media.browse.MediaBrowserService`（[build.gradle](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/build.gradle)、[根 build.gradle](https://github.com/videolan/vlc-android/blob/master/build.gradle)、[AndroidManifest.xml](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/AndroidManifest.xml)、[PlaybackService.kt](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/src/org/videolan/vlc/PlaybackService.kt)）。
- **通知 UI**：由 `PlaybackService` 持有 `MediaSessionCompat` + WakeLock 自行管理通知；会话自定义 action 含 **shuffle / repeat / speed / bookmark / rewind / fast-forward**（[MediaSessionCallback.kt](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/src/org/videolan/vlc/MediaSessionCallback.kt)）。compact 三键的具体取值官方未文档化（未逐行核对 → 官方未说明）。
- **锁屏 / 系统媒体面板**：走 MediaSessionCompat 的系统面板；服务内有 `sleepTimerJob`（睡眠定时）与 `detectHeadset`（[PlaybackService.kt](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/src/org/videolan/vlc/PlaybackService.kt)）。
- **耳机/蓝牙**：`onMediaButtonEvent` 专门处理 Android Auto 硬键的 ACTION_DOWN/ACTION_UP 差异，并有注释说明长按快进/快退要等 ACTION_UP（[MediaSessionCallback.kt](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/src/org/videolan/vlc/MediaSessionCallback.kt)）。
- **Android Auto**：manifest 内 `automotive_app_desc`（[AndroidManifest.xml](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/AndroidManifest.xml)）。
- **省电 / 队列恢复**：官方未说明。

### Metrolist（开源，YouTube Music 客户端）

- **机制**：media3 **1.10.1**；`MusicService : MediaLibraryService`（Media3 中 MediaLibraryService 即 MediaSessionService 的库版），manifest 声明 `foregroundServiceType="mediaPlayback"` 与三个 action（`androidx.media3.session.MediaSessionService`/`MediaLibraryService`/`android.media.browse.MediaBrowserService`），权限含 `FOREGROUND_SERVICE_MEDIA_PLAYBACK`、`POST_NOTIFICATIONS`、`WAKE_LOCK`、`RECEIVE_BOOT_COMPLETED`（[MusicService.kt](https://github.com/MetrolistGroup/Metrolist/blob/main/app/src/main/kotlin/com/metrolist/music/playback/MusicService.kt)、[AndroidManifest.xml](https://github.com/MetrolistGroup/Metrolist/blob/main/app/src/main/AndroidManifest.xml)、[libs.versions.toml](https://github.com/MetrolistGroup/Metrolist/blob/main/gradle/libs.versions.toml)）。
- **通知 UI**：使用 Media3 的 `DefaultMediaNotificationProvider`（自带 MediaStyle 通知），只覆盖小图标；ExoPlayer 侧 `setHandleAudioBecomingNoisy(true)`、`setWakeMode(C.WAKE_MODE_NETWORK)`、`setAudioAttributes(USAGE_MEDIA)`（同上 MusicService.kt）。
- **版本坑**：官方版本目录里给 media3 固定在 1.10.1 并注释「1.11.1 hides Android 17 media controls (#4404)」（[libs.versions.toml](https://github.com/MetrolistGroup/Metrolist/blob/main/gradle/libs.versions.toml)）。
- **曲末与队列**：有 `persistent_queue`「Restore your last queue when the app starts」，以及 `auto_load_more`「队列播到末尾时自动续加歌曲」（[strings.xml](https://github.com/MetrolistGroup/Metrolist/blob/main/app/src/main/res/values/strings.xml)）；README 声明的其他后台相关能力：Background playback、Sleep timer、离线下载与缓存（[README](https://github.com/MetrolistGroup/Metrolist/blob/main/README.md)）。
- **省电**：官方未说明。
- **Android Auto / Wear**：manifest 有 `automotive_app_desc`；Wear 官方未见声明。

### Retro Music Player（开源）

- **机制**：**没有**迁到 Media3 会话层——`MusicService : MediaBrowserServiceCompat`，用 `android.support.v4.media` 的 `MediaSessionCompat`/`PlaybackStateCompat`，只把播放器换成 `androidx.media3:media3-exoplayer:1.6.1`；manifest `foregroundServiceType="mediaPlayback"` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK`，另有 `MediaButtonIntentReceiver`（[MusicService.kt](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/java/code/name/monkey/retromusic/service/MusicService.kt)、[libs.versions.toml](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/gradle/libs.versions.toml)、[AndroidManifest.xml](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/AndroidManifest.xml)）。
- **通知 UI**（本项目最完整的一手样例）：`PlayingNotification : NotificationCompat.Builder` + `MediaStyle().setMediaSession(token).setShowActionsInCompactView(1, 2, 3)`，通知 channel `IMPORTANCE_LOW`、`VISIBILITY_PUBLIC`，大图标 = 加载后的专辑封面（Glide，先占位再替换）；action 顺序为 **[收藏, 上一首, 播放/暂停, 下一首, (Android 12+ 才加) 关闭]**，所以 compact 三键 = 上一首/播放暂停/下一首；点击内容打开 `MainActivity`，且偏好 `expand_now_playing_panel` 可让它直接进正在播放面板（[PlayingNotification.kt](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/java/code/name/monkey/retromusic/service/notification/PlayingNotification.kt)、[strings.xml](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/res/values/strings.xml)）。
- **锁屏 / 系统媒体面板**：设置项含「Fullscreen controls（自研全屏锁屏控件）」「锁屏显示专辑封面」「锁屏封面模糊」（[strings.xml](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/res/values/strings.xml)）。
- **曲末**：`CrossFadePlayer` + 偏好「Crossfade (Beta)」定义交叉淡入时长，`AudioFader` 负责淡入淡出（[service 目录](https://github.com/RetroMusicPlayer/RetroMusicPlayer/tree/dev/app/src/main/java/code/name/monkey/retromusic/service)、[strings.xml](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/res/values/strings.xml)）。
- **队列**：源码里的 `PersistentStorage` 只持久化「最近播放的那一首」供 Android Auto 的最近项使用（[PersistentStorage.kt](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/java/code/name/monkey/retromusic/service/PersistentStorage.kt)）；完整队列/进度能否在进程被杀后恢复，源码中未见（推断：不能恢复，无一手依据）。
- **省电**：官方未见白名单 FAQ → 官方未说明。
- **耳机/蓝牙、Auto**：偏好项「Auto-play：连接耳机 / 连接蓝牙后自动播放」（[strings.xml](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/res/values/strings.xml)）；manifest 的 `automotive_app_desc` + 代码里的 `AutoMusicProvider` 表明支持 Android Auto（[AndroidManifest.xml](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/AndroidManifest.xml)）。

### Symfonium

- **机制**：官方未公布实现（闭源）。
- **通知 UI**：官方文档明确「**Media session (Android 13+)** 在通知栏最多支持 4 个 action，且上一首/下一首的位置固定；Notification 同样 4 个；Android Auto 5 个（不足时三点菜单消失，四个按钮全直出）」，用户可配置自定义按钮映射（[文档](https://docs.symfonium.app/wiki/settings/settings-playback-notification-media-session-buttons/)）。
- **曲末与队列**：官方 FAQ 直说——「当应用被系统在后台杀掉时，当前队列**不会**自动恢复（因为重启后播放器/媒体源常常不同），但 resume point 在暂停/停止时始终最新」，提供 Resume 行/按钮/default action 三种恢复入口（[文档](https://docs.symfonium.app/wiki/other/resuming-audiobook-album-playlist/)）。
- **省电**：官方 FAQ 专章「Android battery optimization」，承认部分厂商会激进杀后台，要求用户手动调整（指向厂商白名单指引站点），并指出优化器会清缓存导致封面消失（华为尤其常见），用「Persistent image cache」缓解（[FAQ](https://docs.symfonium.app/faq/playback-stops-randomly-thumbnails-images-are-disappearing/)）。
- **Android Auto / Wear**：均有官方文档——Android Auto 专门设置页（要求 v7.2+）（[文档](https://docs.symfonium.app/wiki/settings/settings-android-auto/)）；Wear OS 伴随 App 可配下载质量、仅 Wi-Fi 下载、开发者模式开启表上播放、offload 开关（[文档](https://docs.symfonium.app/wiki/other/wear-os-application/)）。
- **耳机/蓝牙**：官方未见声明 → 官方未说明。

### 椒盐音乐 Salt Player（Android，本地音乐）

- **机制**：官方未公布主程序实现；但作者（Moriafly）开源了其媒体服务底座 **media-kit**，仓库自述为「Salt Player for Android media services, notification management foundation, including detailed handling of various OEM systems」（[media-kit](https://github.com/Moriafly/media-kit)）。
- **通知 UI**：media-kit 的 `MediaNotificationPost` 注释写明「自带前台服务管理，**参考 Media3 Notification**」，并解释为何用 `bindService` 而非 `startForegroundService`（避免 `stopSelf()` 在不当时机触发 `onDestroy`、减少要处理的 API、为未来无 UI 播放铺路）；同库另有 `WakeLockManager`、`oem/MiPlayAudioSupport`（[MediaNotificationPost.kt](https://github.com/Moriafly/media-kit/blob/main/media-kit-core/src/main/java/com/moriafly/mediakit/core/MediaNotificationPost.kt)、[源码树](https://github.com/Moriafly/media-kit/tree/main/media-kit-core/src/main/java/com/moriafly/mediakit/core)）。即：**自建通知层 + 逐 OEM 适配**，不是直接用 Media3 默认通知。
- **锁屏 / 系统媒体面板**：产品页写明「内置播放界面妙播快捷按钮，唤起椒盐音乐内置控制或是小米妙播、三星媒体控制或其他系统自带媒体控制界面」（[产品页](https://moriafly.com/program/salt-player)）。
- **OEM 集成矩阵（官方一手，最能说明白名单门槛）**：小米妙播🟢（需 MIUI 12+）、CarWith🟢（CarWith 3.3.6 起）、外屏（Mix Flip 等）🟢；**小米 17 Pro 系列背屏🔴（白名单，暂时沟通无果）**、**华为鸿蒙音乐控制中心🔴（白名单控制且未发现适配文档）**、**原子随身听🔴（疑似白名单，#749）**；Flyme 状态栏歌词🟢（2025-10-22 起）（[README-zh-hans](https://github.com/Moriafly/SaltPlayerSource/blob/main/README-zh-hans.md)、[issue #749](https://github.com/Moriafly/SaltPlayerSource/issues/749)）。
- **省电/白名单**：官方矩阵把「白名单」当作失败归因反复出现，说明厂商白名单是实际门槛（同上）。
- **队列恢复 / 耳机 / Wear**：官方未说明。

## 横向对照表

| 产品 | 播放内核 / 服务形态 | 通知 UI 做法 | 队列/进度恢复 | Android Auto | Wear |
| --- | --- | --- | --- | --- | --- |
| Spotify | 官方未说明（客户端自管后台播放） | 通知类别 Playback（社区口径） | 官方未说明 | 🟢 官方 | 🟢 官方 |
| YouTube Music | 官方未说明 | 官方未说明 | 官方未说明 | 🟢 官方 | 🟢 官方（128kbps AAC） |
| Apple Music (Android) | 官方未说明 | 官方未说明 | 官方未说明 | 🟢 官方（2.6+） | 官方未说明 |
| Poweramp | 官方 API 明示 MediaSessionCompat/MediaBrowserServiceCompat | 系统面板默认；设置内可换样式与控件 | 官方未说明 | 🟢 官网 | 官方未说明 |
| Musicolet | 官方未说明 | 通知/锁屏可加播单、锁屏带队列+歌词 | 🟢 多队列「从上次位置恢复」 | 🟢 官网 | 官方未说明 |
| AIMP | 官方未说明 | 通知区控制 + 睡眠定时可取消 + 自定义按钮 | 官方未说明 | 🟢 changelog | 官方未说明 |
| VLC | libVLC + androidx.media 1.6.0，MediaBrowserServiceCompat | 自管通知，自定义 action 含 shuffle/repeat/speed | 官方未说明 | 🟢 manifest | 官方未说明 |
| Metrolist | media3 1.10.1，MediaLibraryService | DefaultMediaNotificationProvider（换小图标） | 🟢 persistent_queue 开关 | 🟢 manifest | 官方未说明 |
| Retro Music | media3-exoplayer 1.6.1 + MediaBrowserServiceCompat | 自建 MediaStyle，compact=(1,2,3) | 🟡 仅持久化最近一首 | 🟢 manifest | 官方未说明 |
| Symfonium | 官方未说明 | 可配置按钮映射（通知 4 / Auto 5） | 🔴 明确不恢复队列，只保 resume point | 🟢 官方文档 | 🟢 官方文档 |
| Salt Player | 自建 media-kit 通知层 + OEM 适配 | MediaNotificationPost（参考 Media3 Notification） | 官方未说明 | 官方未说明（小米 CarWith🟢） | 官方未说明 |

## 可借鉴清单（≤12 条）

1. **换到 Media3 的 MediaSessionService 承载播放**（平台官方 + Metrolist 实证）→ 能抄：这是拿到系统媒体面板/锁屏/Auto 完整能力的唯一正路 → 代价：要写 Expo Module + Kotlin 前台服务，队列/播放态需在 JS 与 Kotlin 间双向同步（我们目前 expo-audio 的队列状态在 Zustand）。
2. **manifest 三件套**：`foregroundServiceType="mediaPlayback"` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` + `POST_NOTIFICATIONS`（Metrolist/VLC/Retro 一致）→ 能抄，且原生目录已入库可直接改 → 代价：低，注意 CNG 反向流程下改 `packages/mobile/android/` 要记得入库。
3. **compact 三键固定为「上一首 / 播放暂停 / 下一首」**（Retro `setShowActionsInCompactView(1,2,3)`；平台文档只显示前三个槽位）→ 能抄 → 代价：低。
4. **通知点击直达「正在播放」而非首页**（Retro 的 `expand_now_playing_panel` 偏好）→ 能抄（expo-router deep link + PendingIntent）→ 代价：低。
5. **队列与进度持久化 + 冷启恢复**（Metrolist `persistent_queue`：Restore your last queue when the app starts）→ 能抄：我们已有 Zustand persist，扩到「队列 + 播放位置」即可 → 代价：中，需处理解析失效（与 core 的 skipGuard/坏歌记忆协同，别恢复出一串必然失败的歌）。
6. **备选降级：只保 resume point，不承诺恢复完整队列**（Symfonium 官方策略，因其媒体源可能已失效）→ 能抄，且对我们多源解析的失效场景更现实 → 代价：低。
7. **主动检测并提示「后台运行受限」**（AIMP changelog；Symfonium FAQ）→ 能抄：设置页放「后台播放保活自检 + 厂商白名单引导」 → 代价：低-中（要按 OEM 跳不同设置页，文案维护）。
8. **按 Symfonium 的按钮预算做降级映射**：通知栏最多 4 个、上一首/下一首位置固定，其余按钮（循环/随机/喜欢）要按「先满足固定位再排自定义」的规则插空 → 能抄 → 代价：低（纯映射逻辑）。
9. **拔耳机自动暂停 + 连接耳机/蓝牙自动播放**（Metrolist `setHandleAudioBecomingNoisy(true)`；Retro 的 Bluetooth/Auto-play 偏好）→ 能抄 → 代价：低。
10. **睡眠定时做到「N 分钟后 / 当前曲结束后」两种**（AIMP v4.20「wait for track end」；Musicolet hh:mm 与 N 首两种；Retro 用精确闹钟权限）→ 能抄 → 代价：低。
11. **曲末切换：先保证「下一首已预解析」再谈无缝**（Metrolist `auto_load_more` 续队列；Retro 有 Crossfade(Beta)+CrossFadePlayer）→ 部分能抄：我们的 expo-audio 单实例做不了真 gapless，只能用「预取下一首 + 双实例交叉淡入」逼近 → 代价：中-高（双实例音频焦点与进度同步容易出 bug）。
12. **别把 OEM 专属面板写进承诺范围**（Salt Player 官方矩阵：小米背屏、鸿蒙音乐控制中心因白名单🔴）→ 抄的是预期管理 → 代价：无；反过来，Media3 版本也要钉住（Metrolist 注释：media3 1.11.1 会隐藏 Android 17 的媒体控制）。

## 参考

- Android Developers： [Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback) · [MediaSessionService API](https://developer.android.com/reference/androidx/media3/session/MediaSessionService) · [Media controls（按钮数量/compact）](https://developer.android.com/media/implement/surfaces/mobile) · [Media3 迁移指南](https://developer.android.com/media/media3/exoplayer/migration-guide)
- Spotify： [Android Application Lifecycle（后台播放由客户端负责）](https://developer.spotify.com/documentation/android/tutorials/application-lifecycle) · [Spotify in the car](https://support.spotify.com/us/article/spotify-in-the-car/) · [Spotify on Wear OS](https://support.spotify.com/us/article/spotify-on-wear-os/) · [Supported devices](https://support.spotify.com/us/article/supported-devices-for-spotify/) · [iPhone 锁屏 widget（无 Android 对应）](https://support.spotify.com/us/article/spotify-iphone-widget/) · 社区帖 [Disable Playback Controls](https://community.spotify.com/t5/Android/Disable-Playback-Controls/td-p/6096206) / [Lock screen controls](https://community.spotify.com/t5/Android/Lock-screen-controls-android-11/td-p/5149668)
- YouTube Music： [Play music or podcasts in the background](https://support.google.com/youtubemusic/answer/6313552) · [Premium 权益](https://support.google.com/youtubemusic/answer/9266556) · [Use YouTube Music on other apps & devices（Auto/Wear）](https://support.google.com/youtubemusic/answer/9231765) · [Wear OS：Listen to music on your watch](https://support.google.com/wearos/answer/11167087)
- Apple： [Use Apple Music with your Android devices](https://support.apple.com/en-us/101645)
- Poweramp： [官网](https://powerampapp.com/) · [powerampapi readme（MediaSessionCompat/MediaBrowserServiceCompat）](https://github.com/maxmpz/powerampapi/blob/master/poweramp_api_lib/readme.md) · [官方论坛：Android 13+ 通知样式设置](https://forum.powerampapp.com/topic/28476-poweramp-in-notification-bar-as-it-was-before-android-13/)
- Musicolet： [官网](https://krosbits.in/musicolet/) · [Google Play 商店页](https://play.google.com/store/apps/details?hl=en&id=in.krosbits.musicolet)
- AIMP： [Android changelog 汇总](http://aimp.ru/?do=changelog&os=android) · [含「后台运行受限检测」的 changelog](https://aimp.ru/?do=changelog&merge=1&os=android&ver=400) · [通知区控制/睡眠定时条目](https://www.aimp.ru/?do=changelog&f=547&merge=1&os=android&s=84) · [耳机断开行为修复条目](https://aimp.ru/?do=changelog&f=1467&os=android&s=40) · [v4.20 发布说明](https://aimp.ru/?do=news&id=194)
- VLC for Android： [PlaybackService.kt](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/src/org/videolan/vlc/PlaybackService.kt) · [MediaSessionCallback.kt](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/src/org/videolan/vlc/MediaSessionCallback.kt) · [AndroidManifest.xml](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/AndroidManifest.xml) · [application/vlc-android/build.gradle](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/build.gradle) · [根 build.gradle（mediaVersion）](https://github.com/videolan/vlc-android/blob/master/build.gradle)
- Metrolist： [MusicService.kt](https://github.com/MetrolistGroup/Metrolist/blob/main/app/src/main/kotlin/com/metrolist/music/playback/MusicService.kt) · [AndroidManifest.xml](https://github.com/MetrolistGroup/Metrolist/blob/main/app/src/main/AndroidManifest.xml) · [libs.versions.toml](https://github.com/MetrolistGroup/Metrolist/blob/main/gradle/libs.versions.toml) · [strings.xml（persistent_queue/auto_load_more）](https://github.com/MetrolistGroup/Metrolist/blob/main/app/src/main/res/values/strings.xml) · [README](https://github.com/MetrolistGroup/Metrolist/blob/main/README.md)
- Retro Music Player： [MusicService.kt](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/java/code/name/monkey/retromusic/service/MusicService.kt) · [PlayingNotification.kt](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/java/code/name/monkey/retromusic/service/notification/PlayingNotification.kt) · [PersistentStorage.kt](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/java/code/name/monkey/retromusic/service/PersistentStorage.kt) · [service 目录](https://github.com/RetroMusicPlayer/RetroMusicPlayer/tree/dev/app/src/main/java/code/name/monkey/retromusic/service) · [AndroidManifest.xml](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/AndroidManifest.xml) · [libs.versions.toml](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/gradle/libs.versions.toml) · [strings.xml](https://github.com/RetroMusicPlayer/RetroMusicPlayer/blob/dev/app/src/main/res/values/strings.xml)
- Symfonium： [通知/媒体会话按钮](https://docs.symfonium.app/wiki/settings/settings-playback-notification-media-session-buttons/) · [播放随机停止与电池优化 FAQ](https://docs.symfonium.app/faq/playback-stops-randomly-thumbnails-images-are-disappearing/) · [恢复专辑/播单/有声书](https://docs.symfonium.app/wiki/other/resuming-audiobook-album-playlist/) · [Android Auto 设置](https://docs.symfonium.app/wiki/settings/settings-android-auto/) · [Wear OS 应用](https://docs.symfonium.app/wiki/other/wear-os-application/)
- 椒盐音乐 Salt Player： [README-zh-hans（OEM 支持矩阵）](https://github.com/Moriafly/SaltPlayerSource/blob/main/README-zh-hans.md) · [issue #749（原子随身听）](https://github.com/Moriafly/SaltPlayerSource/issues/749) · [产品页](https://moriafly.com/program/salt-player) · [media-kit 仓库](https://github.com/Moriafly/media-kit) · [MediaNotificationPost.kt](https://github.com/Moriafly/media-kit/blob/main/media-kit-core/src/main/java/com/moriafly/mediakit/core/MediaNotificationPost.kt) · [media-kit-core 源码树](https://github.com/Moriafly/media-kit/tree/main/media-kit-core/src/main/java/com/moriafly/mediakit/core)

## 第三部分 · 本仓库现状与 expo-audio 映射（面向 #405）

## TL;DR（≤6 条）

1. 曲末自动切歌是**纯 JS 时序**：`playbackStatusUpdate` → `didJustFinish` → `store.next()` → `setTimeout(…, 0)` → `playSong()`（`packages/mobile/services/audioPlayer.ts:108`、`:167-178`），且**全文没有任何前后台判断**（`AppState` 只出现在 `services/perfMonitor.ts:118`）。
2. 本仓库在 **Expo Go 下主动关掉了 Android 前台服务与通知**：`if (!isExpoGo) player.setActiveForLockScreen(...)`（`audioPlayer.ts:528-535`），`notificationService.ts:17-33` 在 Expo Go 直接返回 null；而 expo-audio 官方写明「Android 必须 `setActiveForLockScreen` 才有持续后台播放，否则约 3 分钟后被系统停」。
3. Android 的 FGS/媒体通知由 expo-audio 的 `AudioControlsService`（media3 `MediaSessionService`）提供，只有 `setActiveForLockScreen(true)` 才 bind+startService（`AudioPlayer.kt:100-124`）；`didJustFinish` 是原生 `STATE_ENDED` 即时 emit（`BaseAudioPlayer.kt:99-108`、`AudioPlayer.kt:147-156`），周期性状态事件只在 `playing` 时发（`BaseAudioPlayer.kt:52-69`）。
4. 57.0.4 的媒体通知 = media3 `MediaStyle`，只有播放/暂停 +（可选）±10s seek，**没有上一首/下一首**（`AudioControlsService.kt:174-236`；next/previous 来自未进 57.x 的 PR #46020）；`AudioPlayer` 无曲末原生推进，`AudioPlaylist` 有（`AudioPlaylist.kt:107-126`），但 57.0.4 的 playlist **没有**锁屏/FGS API。
5. 队列/进度**不持久化**：`stores/playerStore.ts:31-85` 没有 `persist`（对比 `settingsStore.ts:50,73`），进程被杀即丢队列与进度，也没有恢复路径（`app/_layout.tsx:109-143`）。
6. 修法排序（详见 §3）：①dev build 排除 Expo Go 变量 → ②JS 侧加固（去 `setTimeout`、曲末零网络、回前台补账）→ ③原生队列 `AudioPlaylist` → ④react-native-track-player / 自写 Media3 模块。

## 1 本仓库现状（worktree `playback-budgets`，路径相对仓库根）

### 1.1 播放器创建

- 播放模式配置：`initAudio()` → `setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' })`（`packages/mobile/services/audioPlayer.ts:76-82`）。
- **单例播放器复用**：进程内最多一个 `AudioPlayer`，第一次 `createAudioPlayer(source, { updateInterval: 250 })`，之后切歌走 `player.replace(source)`（`audioPlayer.ts:520-536`）；`livePlayers` 只用于「暂停+释放所有播放器」（`audioPlayer.ts:28`、`:92-101`）。
- 请求头：每次播放带 `User-Agent` + 按源映射的 `Referer`（`audioPlayer.ts:509-520`）。
- 锁屏/媒体会话：仅在非 Expo Go 下 `setActiveForLockScreen(true, { title, artist, albumTitle, artworkUrl })`（`audioPlayer.ts:528-535`），换源后 `updateLockScreenMetadata(...)`（`:538-547`）；**没有传 `showSeekForward/showSeekBackward` 等 `AudioLockScreenOptions`**。

### 1.2 `playbackStatusUpdate` 里 `didJustFinish` 的处理路径（#405 关键）

- 监听只挂一次：`p.addListener('playbackStatusUpdate', (status) => …)`（`audioPlayer.ts:107-108`），当前歌曲从模块级 `playbackCtx` 读（`:61-68`），并用 `playId !== currentPlayId` 丢弃过期事件（`:110`）。
- 状态同步：`status.playing` 双向同步 store（`:152-157`）；seek 对账窗口（`:161-165`）；`setDuration`（`:165`）。
- **曲末推进**（`audioPlayer.ts:167-178`）：
  1. `playbackFinished` 去重（`:70`、`:167-168`）；
  2. `const nextSong = s.next()` —— `playerStore.next()` 里**同步**改掉 `currentSong/currentIndex/isPlaying`（`stores/playerStore.ts:46-53`）；
  3. `setTimeout(() => { if (ctx.playId === currentPlayId) void playSong(nextSong, 0, false); }, 0)`（`:169-172`）——推进被推迟到下一个宏任务；
  4. 无下一首才 `stopAllPlayers()` + `pause()`（`:173-177`）。
- `playSong()` 在后台要跑的真实开销：`isOffline()` 判定（`:402-409`）→ URL 缓存命中/探活（`:446-465`，高龄缓存先 `isUrlAlive` ≤1.5s）或整条路由解析（直连 3s 墙 + tier3 6s 预算，`:466-482`）→ `replace` → `play()`。下一首预取只在 `playSong` 末尾触发一次（`:562-564`、`:358-383`），**不在曲末前 15s 预热**。

### 1.3 后台/前台判断：不存在

- `audioPlayer.ts` 全文无 `AppState`、无任何前台/后台分支；全仓 `AppState` 只在 `services/perfMonitor.ts:1,118` 用于区分卡顿成因。
- 也就是说：曲末推进路径在前后台**走同一段 JS**，没有任何降级/补账逻辑。

### 1.4 通知怎么发的

- 实现是 **expo-notifications 的普通通知**，不是 media style：`scheduleNotificationAsync({ identifier: 'music-playback', content: { title, subtitle, body, data, categoryIdentifier, channelId } })`（`packages/mobile/services/notificationService.ts:93-114`），清理用 `dismissAllNotificationsAsync()`（`:116-121`）。
- 渠道：Android `music-playback`，`importance: HIGH`、`sound: null`（`:55-61`）；分类 `music-playback-controls` 注册三个按钮 上一首/播放暂停/下一首，全部 `opensAppToForeground: false`（`:64-81`）。
- **回跳动作在 JS 里**：`addNotificationResponseReceivedListener`（`:83-91`）→ `app/_layout.tsx:122-140` 里 `togglePlay()` / `store.next()+playSong()` / `store.prev()+playSong()`。所以这三个按钮同样依赖 JS 运行时，被冻结即失效。
- Expo Go 下**整套禁用**：`loadNotifications()` 只要 `isExpoGo` 就返回 `null`（`:14-33`）。注意 expo-notifications 官方口径是「Android SDK 53+ 在 Expo Go 只缺**推送**，本地通知仍可用」，本仓库的写法比官方限制更严。
- 副作用：非 Expo Go 下会**同时存在两条通知**——expo-audio 的原生媒体通知 + 这条 JS 通知。

### 1.5 原生配置（`app.json` + `AndroidManifest.xml`）

- `packages/mobile/app.json:26-33`：`["expo-audio", { "enableBackgroundPlayback": true }]`；`:35-47` 是 expo-build-properties（cleartext / 架构 / R8+shrink）。
- `packages/mobile/android/app/src/main/AndroidManifest.xml:2-3`：`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_MEDIA_PLAYBACK`；`:23-27`：`<service android:name="expo.modules.audio.service.AudioControlsService" android:foregroundServiceType="mediaPlayback">` + `androidx.media3.session.MediaSessionService` intent-filter —— 与 config plugin 生成的定义逐字一致（`plugin/src/withAudio.ts:117-128`）。
- manifest 里**没有** `POST_NOTIFICATIONS`；它来自 expo-notifications 的库 manifest（`node_modules/expo-notifications/android/src/main/AndroidManifest.xml:3`）经 manifest merger 合并（推断：合并后的产物未在本仓库核对）。
- 媒体会话通知不受 Android 13 通知权限限制（官方豁免），所以媒体通知与 `POST_NOTIFICATIONS` 拒授权无关。

### 1.6 队列/进度持久化

- `stores/playerStore.ts` 是**纯内存 store**：无 `persist`/`createJSONStorage`（对比 `settingsStore.ts:2-3,50,73`、`favoriteStore.ts:16,57`、`playlistStore.ts:30,99`、`historyStore.ts:16,39`、`downloadStore.ts:34,53`）。`queue/currentSong/currentIndex/currentTime` 全部不落盘。
- 没有恢复/续播路径：`app/_layout.tsx:109-143` 启动只做 `initAudio`、权限、渠道、通知响应监听；`setQueue` 的调用点全在用户点击入口（如 `components/DiscoverTabs.tsx:166`、`components/SongRow.tsx:109`），无「恢复上次队列」调用。
- 结论：进程被系统杀掉/回收后**没有可恢复的队列**，后台推进失败也不会自愈。

## 2 expo-audio 的能力边界（官方文档 / 官方源码）

### 2.1 Android 后台播放靠什么

- 官方文档：`enableBackgroundPlayback`「在 Android 上添加 media playback 前台服务、允许显示锁屏控件，并且是**持续后台播放的前提**」；运行时**必须**调 `setActiveForLockScreen`，「否则后台播放约 3 分钟后停止（OS 限制）」。
- 源码链路：`setActiveForLockScreen(true)` → `serviceConnection.bindWithService()`（`AudioPlayer.kt:100-124`）→ `startServiceAndBind(...)`（`AudioPlaybackServiceConnection.kt:32-51`）→ `AudioControlsService.onStartCommand` → `ensureForegroundNotification()` → `startForeground(..., FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)`（`AudioControlsService.kt:66-118`）；播放中由 media3 的 `onUpdateNotification(session, startInForegroundRequired)` 决定升/降前台（`:319-321`、`:281-317`）。
- 因此：**起 FGS 的是 expo-audio 自己**（不是 expo-notifications）；但**触发条件是应用层必须调 `setActiveForLockScreen`**。本仓库在 Expo Go 下恰好不调。

### 2.2 媒体通知/锁屏控件能自定义到什么程度

- 通知由 media3 `MediaSessionService` 自动生成，expo-audio 自建 `MediaStyle`：标题/歌手/专辑/大图（封面）、点按回 App（`packageManager.getLaunchIntentForPackage`）、动作 = 播放/暂停（SLOT_CENTRAL）+ ±10s seek（需 `showSeekBackward`/`showSeekForward`）（`AudioControlsService.kt:154-236`、`:239-279`）。
- `AudioLockScreenOptions` 在 57.0.4 只有 `showSeekForward`/`showSeekBackward`/`isLiveStream`（`src/AudioConstants.ts:5-19`）——**不能自定义通知布局，按钮集合里也没有曲目切换**。
- 57.0.4 的服务里没有任何 `COMMAND_SEEK_TO_NEXT/PREVIOUS`（源码 grep 无命中）；播放列表的锁屏控件 + `showNextTrack/showPreviousTrack` 来自 PR #46020（合入 main，未进 57.x）。

### 2.3 事件与 `updateInterval`

- `updateInterval` 只控制**周期性**状态事件频率（Android 默认 500ms，本仓库设 250ms）；Android 侧循环体是 `if (playing) sendStatusUpdate()`（`BaseAudioPlayer.kt:52-69`）——**暂停/结束后不再周期发**。
- `didJustFinish` 不走周期循环：`Player.Listener.onPlaybackStateChanged(STATE_ENDED)` → `onPlaybackStateUpdated(justFinished=true)` → 立即 `emit`（`BaseAudioPlayer.kt:99-108`、`AudioPlayer.kt:147-156`）。它是**原生→JS 事件**，后台能否被处理取决于 JS 运行时是否被挂起（进程冻结）；expo-audio 不提供「回调在原生侧接管」的钩子。

### 2.4 曲末原生自动前进

- `AudioPlayer`（本仓库在用）：无原生队列，曲末只发 `didJustFinish`，「下一首」必须由 JS 决策。
- `AudioPlaylist`（55.0.0 起可用）：原生 ExoPlayer 媒体项队列，`add/insert/remove/skipTo/next/previous`，曲末由 ExoPlayer 自己推进并 emit `trackChanged`（`AudioPlaylist.kt:18-46,107-126,195-199`）。**但 57.0.4 的 `AudioPlaylist` 没有任何锁屏/FGS API**（源码 grep 无 `LockScreen`/`serviceConnection`），因此 Android 上用 playlist 仍受「无 `setActiveForLockScreen` → 约 3 分钟停」的限制。

### 2.5 已知限制/相关官方 issue

- expo/expo#38317：Android 后台播放约 3 分钟停止，即便 `shouldPlayInBackground` 为 true（label `Issue accepted`；官方回复指向 PR #43015「Rework native audio service handling」，落在 55.0.6 段）。
- expo/expo#34301：Android 上 `didJustFinish` 不会自动复位（用 `createAudioPlayer` 且不用 hook 时），官方回复指向 `useAudioPlayerStatus` 会自动复位 —— 与本仓库用 `addListener` 直接读 `status.didJustFinish` 的用法相关。
- expo/expo#12261（expo-av 时代，症状一致）：「后台曲末调用的 `playAsync()` 看起来执行了，但直到 App 回到前台才真正播下一首」——同一根因族的历史证据。
- expo/expo#34089：`didJustFinish` 的引入 PR，官方原文「改进 Android 事件，使其**只在播放中**发送」。
- Expo Go vs dev build：官方把 dev build 描述为「自己的 Expo Go，可用任意原生库、改原生配置」；Expo Go 无法使用自定义原生配置（本仓库的 FGS 触发条件在 Expo Go 被代码跳过）。

### 2.6 若 expo-audio 做不到：替代方案与代价

| 方案 | 能力 | 代价/风险（结合本仓库） |
|---|---|---|
| expo-audio 单播放器 + `setActiveForLockScreen`（现状，但只在非 Expo Go 生效） | 原生 FGS + 媒体通知 + 锁屏播放/暂停，播放本身可在后台长期进行 | 曲末推进仍在 JS；通知无上一首/下一首；Expo Go 不可验证 |
| `AudioPlaylist`（57.0.4） | 曲末原生推进（不依赖 JS 时序） | 57.0.4 无锁屏/FGS（Android 后台仍 ~3min 停）；与「按需解析 + `replace` 单播放器 + fresh 重试 + skipGuard」模型冲突 |
| react-native-track-player 4.x | 原生播放服务常驻（官方原文：playback service「即使 App 在后台也继续运行」），锁屏/通知 remote events 在服务里处理 | 需 dev/prod build（Expo Go 不可用）；播放链要重写（解析→入队、headers/Referer、fresh 重试、seek 对账、坏歌记忆/skipGuard、播放诊断）；仓库已提交 `android/` + CI 直接 gradle，autolinking 可用 |
| 自写 native module + Media3（Kotlin 入库） | 完全可控：原生队列 + 原生切歌回调 + 自定义通知按钮 | 成本最高：Kotlin + iOS 侧 AVQueuePlayer 两套原生代码；CI 构建/签名/回归面扩大 |
| `expo-music-controls` | —— | npm 上**不存在**该包（E404），不是可选项 |
| `react-native-music-control` | 旧式媒体通知控件 | 最后发布 1.4.1 / 2022-06，已停止维护（推断：无一手声明，仅发布记录） |

## 3 #405 候选修法与判据（最便宜 → 最彻底）

### A. 先用 dev build 判定「是否 Expo Go 专属」（0 代码改动）

- 改哪里：不改代码。用 `npx expo run:android`（`expo-dev-client` 已在 `packages/mobile/package.json:45`）或 CI 的产物复现 `audioPlayer.ts:528`（`!isExpoGo` 分支会真正执行）。
- 预期行为：expo-audio 文档说明只有这里才会起 FGS；若 dev build 下曲末正常切歌，则 #405 是「Expo Go 缺 FGS」的能力边界，而非逻辑 bug。
- 怎么验（真机）：后台播完一首看是否自动接；`adb shell dumpsys activity services com.mplayer.mobile`（应看到 `AudioControlsService` 且前台）；`adb logcat -v time ReactNativeJS:V *:S` 看曲末后是否出现第二首 `[player] 直链URL`/`开始播放`。
- 代价/风险：0；若只在 Expo Go 复现，仍要补一条「Expo Go 不支持后台连播」的产品结论/提示。

### B. JS 侧最小加固：去 `setTimeout` + 曲末零网络 + 回前台补账

- 改哪里（全在 `packages/mobile/services/audioPlayer.ts`）：
  1. `:169-172` 去掉 `setTimeout(…, 0)`，直接 `void playSong(nextSong, 0, false)`（同一次事件回调内发起解析）；
  2. 在 `:161-165` 附近按 `status.duration - status.currentTime < 15` 触发一次 `prefetchNextSong()`（现在只有 `:562` 播完才预取），让曲末走 `:446-465` 的缓存命中分支（零网络）；
  3. 新增 `AppState` 监听（可放 `app/_layout.tsx:109-143`）：回到 `active` 时若 `usePlayerStore.isPlaying && player && !player.playing` 且队列有下一首 → 立即 `playSong(next, 0, false)`，补偿被冻结/推迟的回调。
- 预期行为：曲末推进不再依赖额外宏任务；后台曲末切歌只需一次 `replace`（无网络等待）。
- 怎么验（真机）：后台连续 ≥3 首；关 Wi-Fi 复测（应命中预取缓存）；日志看 `[耗时] 播放准备开始` 与曲末的时间差；曲末不应出现 `[耗时] 缓存直链已失效`。
- 代价/风险：小（1 个文件 + 1 处监听）；需注意 `playerStore.next()` 已同步改 store（`playerStore.ts:46-53`），失败路径必须继续走 `handleTerminalPlaybackFailure`/skipGuard（`:201-244`），不要在后台补账时绕过它。

### C. 改用 `AudioPlaylist`：曲末推进交给原生（结构性，v57 已具备一半）

- 改哪里：新建 `createAudioPlaylist({ sources: [...] })` 持有「当前 + 已解析的后续若干首」，预解析成功就 `playlist.add(source)`；曲末由 ExoPlayer 推进，JS 只监听 `trackChanged`/`playlistStatusUpdate` 同步 store 与写缓存；Android 侧若要锁屏/FGS，需评估是否保留一个 `AudioPlayer` 会话或接受 57.0.4 的限制。
- 预期行为：曲末切歌是原生行为，JS 被挂起也能切；不再依赖 `didJustFinish` 到达 JS。
- 怎么验（真机）：后台连续 ≥3 首 + 队列播完停；单曲/列表/随机/顺序四模式；死链场景（原生 error → 移除该项并跳下一首）；不出现两首同播。
- 代价/风险：中高——与现有「按需解析 + fresh 重试 + 试听版标记 + `replace` 单例 + skipGuard」需要重新对齐；`AudioPlaylist` 在 57.0.4 无锁屏/FGS，Android 长时后台仍受 ~3min 限制（PR #46020 未进 57.x）。

### D. 换 react-native-track-player（或自写 Media3 原生模块）——最彻底

- 改哪里：播放链下沉到原生播放服务（RNTP 的 `registerPlaybackService`），remote events（播放/暂停/上一首/下一首）在服务里处理并驱动队列；URL 解析结果通过 `add()` 入队，配合「预解析 N 首 + 死链移除」。
- 预期行为：后台/锁屏/通知控制与曲末推进都不再依赖前台 JS 时序；通知控件可自定义。
- 怎么验（真机）：`docs/agents` 的移动端验收 + #405 验收标准（≥3 首连播、四模式正确、通知栏上一首/下一首可用、不双播）；Expo Go 明确不再作为验收环境。
- 代价/风险：大——需要 dev/prod build（仓库已具备提交 `android/` + CI gradle 增量构建的条件）、播放链大改、回归面覆盖缓存/试听版/skipGuard/诊断 trace；自写 Media3 模块还要额外承担 iOS 侧实现。

### 真机判别与回归清单（H1/H2/H3 一轮分辨）

- 后台曲末停住后点通知栏「下一首」（JS 侧按钮，`_layout.tsx:128-131`）：无反应 ⇒ JS 运行时被冻结/挂起（H1/H3）；能切但无声 ⇒ 后台换源/解析失败（H2）。
- 曲末后回到前台是否**立刻**接上下一首 ⇒ 是则 H3 最像（回调被推迟到前台）。
- `dumpsys activity services` / `dumpsys notification`：确认 FGS 是否存活、通知是 expo-audio 的原生媒体通知（豁免通知权限）还是 JS 通知。
- 回归：单曲循环 / 列表循环 / 随机 / 队列播完；不出现两首同播（单例设计见 `audioPlayer.ts:28,92-101,520-548`）。

## 参考

- expo-audio 官方文档（后台播放、config plugin、`setActiveForLockScreen`、「约 3 分钟」注意）：https://docs.expo.dev/versions/latest/sdk/audio/
- expo-audio SDK 57 源码（本仓库安装版本 57.0.4 对应分支）：
  - `BaseAudioPlayer.kt`（周期事件只在 playing 时发；STATE_ENDED→didJustFinish）：https://github.com/expo/expo/blob/sdk-57/packages/expo-audio/android/src/main/java/expo/modules/audio/BaseAudioPlayer.kt
  - `AudioPlayer.kt`（`setActiveForLockScreen` → 绑定服务）：https://github.com/expo/expo/blob/sdk-57/packages/expo-audio/android/src/main/java/expo/modules/audio/AudioPlayer.kt
  - `AudioControlsService.kt`（startForeground / MediaStyle 通知 / 按钮）：https://github.com/expo/expo/blob/sdk-57/packages/expo-audio/android/src/main/java/expo/modules/audio/service/AudioControlsService.kt
  - `AudioPlaylist.kt`（原生队列推进；无锁屏 API）：https://github.com/expo/expo/blob/sdk-57/packages/expo-audio/android/src/main/java/expo/modules/audio/AudioPlaylist.kt
  - `Audio.types.ts`（`shouldPlayInBackground` 的「必须 setActiveForLockScreen」注释）：https://github.com/expo/expo/blob/sdk-57/packages/expo-audio/src/Audio.types.ts
  - `plugin/src/withAudio.ts`（`enableBackgroundPlayback` 插入的权限与服务）：https://github.com/expo/expo/blob/sdk-57/packages/expo-audio/plugin/src/withAudio.ts
- expo/expo#38317（Android 后台约 3 分钟停止，官方 accepted）：https://github.com/expo/expo/issues/38317
- expo/expo#34301（Android `didJustFinish` 不复位）：https://github.com/expo/expo/issues/34301
- expo/expo#12261（expo-av：后台曲末 `playAsync` 不生效，回前台才接上）：https://github.com/expo/expo/issues/12261
- expo/expo#34089（`didJustFinish` 引入；事件只在播放中发）：https://github.com/expo/expo/pull/34089
- expo/expo#43015（Android 音频服务处理重做，55.0.6）：https://github.com/expo/expo/pull/43015
- expo/expo#46020（播放列表锁屏控件 + 上一首/下一首，合入 main 未进 57.x）：https://github.com/expo/expo/pull/46020
- Expo 开发构建（dev build 才可用原生配置/自定义模块）：https://docs.expo.dev/develop/development-builds/introduction/
- expo-notifications 文档（Expo Go 仅缺推送、本地通知可用；`opensAppToForeground`）：https://docs.expo.dev/versions/latest/sdk/notifications/
- Android：媒体会话通知豁免通知权限：https://developer.android.com/develop/ui/views/notifications/notification-permission
- Media3 `MediaSessionService` 后台播放（FGS 权限/服务声明/通知生命周期）：https://developer.android.com/media/media3/session/background-playback
- Android 前台服务类型（`mediaPlayback` 与 `FOREGROUND_SERVICE_MEDIA_PLAYBACK`）：https://developer.android.com/develop/background-work/services/fgs/service-types
- AOSP Cached apps freezer（缓存进程被冻结；Android 14 起进入 cached 后 10s 冻结）：https://source.android.com/docs/core/perf/cached-apps-freezer
- react-native-track-player「Playback Service」（后台继续运行 / remote events）：https://rntp.dev/docs/basics/playback-service
- Apple：配置后台执行模式（audio 后台模式）：https://developer.apple.com/documentation/xcode/configuring-background-execution-modes
- 仓库 issue #405：https://github.com/fuzz1og/mplayer/issues/405

