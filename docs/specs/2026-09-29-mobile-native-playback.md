# 实施规格 C：自写 Kotlin Expo Module —— 原生持队列 + 原生推进（#405）

> 规格日期：2026-09-29 · 类型：实施规格（可直接开工）· 关联：**#405**（根因票）、PR #433 / PR #436（将被关闭，本规格抢救其结论与不变量）、PR #435（已 CLOSED，其改动由 P0 重落）
> 依据（三份调研已含全部证据，本文件不重复论证）：`docs/research/2026-09-27-android-background-playback.md`（平台机制）、`docs/research/2026-09-28-mobile-native-playback-options.md`（B/C/C′ 选型 + 仓库改动面 + C 的 Kotlin/JS 量级）、`docs/research/2026-09-28-android-oss-background-playback.md`（16 个开源实现代码级对照）
> 口径：仓库结论给 `file:line`（master 实测，除注明外；工作副本 `D:\Playground\mplayer` master `9e6d321`）；外部结论给一手链接；拿不准的写「待定/推断」。**本文件不写实现代码**，只写接口签名、伪代码片段与验收判据。

## 1. 目标与不变量

### 1.1 根因（一句话，已实测钉死）
App 在后台时 expo-audio 的 `playbackStatusUpdate`（含 `didJustFinish`）**不投递给 JS**：探针后台 45s 零事件、同期 JS 对网络回调仍有反应、原生确实在 `BaseAudioPlayer.kt:99-108` / `AudioPlayer.kt:147-156` 发了事件、FGS 全程 `isForeground=true types=0x2` → **JS 侧任何机制都修不了** → 唯一正解是原生持队列 + 原生推进，JS 只在活着时预解析并喂窗口。

**机制（RN 0.86.2 自带源码 `ReactAndroid/src/main/java/com/facebook/react/modules/core/JavaTimerManager.kt`）**：`onHostPause()`（`:72-73`）把 `isPaused` 置 true → 定时器回调不再投递；而 `:125/:142/:291/:323` 在 `isPaused` 为真时仍会检查 `headlessJsTaskContext.hasActiveTasks()`。这既解释了「后台连微任务/定时器都没有执行机会」，也直接给出了 §5 的可行通道。

### 1.2 本规格修什么
- 后台/锁屏曲末不接下一首（#405）→ **原生 ExoPlayer 播放列表推进**（§4）。
- 通知栏/锁屏没有上一首/下一首 → **原生媒体会话 + media3 默认通知 provider**（§8）。
- 进程被杀丢队列与进度 → **原生落盘 + `onPlaybackResumption` 防御**（§9）。
- 签名直链过期导致曲末 403 → **绝对过期时间 + Metrolist 式分级重试**（§6）。
- 失败/跳歌两套策略分叉风险 → **policy 由 JS 下发，core `skipGuard` 唯一来源**（§7）。

### 1.3 本规格不修什么
1. **core 解析链 0 改动**：`resolvePlayableSongRouted` / `refreshPlayableUrl` / `skipGuard` / `explainPlaybackFailure` / `playbackTrace` 全部留在 JS（`packages/mobile/services/audioPlayer.ts:248-254,331-338,193-236,557-613`）。
2. **`services/audioPlayer.ts` 的 7 个导出签名不变**：`initAudio`(:76) / `fetchLrcInBackground`(:274) / `resolvePlayableUrlMobile`(:339) / `playSong`(:390) / `togglePlay`(:626) / `seekTo`(:655) / `cleanup`(:663) → **18 个消费方（17 个文件）基本不动**（清点见选型评估 §1.7）。
3. **不新增 core 预取缓存**：移动端预取走既有 12h `songResourcesCache`，`prefetchPlayableSong` 在移动端 0 调用点（调研 2026-09-28 清点 §5.1）。
4. **桌面端（Electron + Howler）零改动**；`packages/mobile/ios` 未入库，iOS 走 §11 的回落（跨端不一致显式接受）。
5. 不做跨进程（不设 `android:process`）、不做 Android Auto/Wear 的 browse 树、不手写 MediaStyle 通知。

### 1.4 不变量（实现与测试都必须守住）
- **I1 原生推进零依赖事件**：事件出口在 JS 对象丢失时静默 return（`SharedObject.kt:66-68`；`KModuleEventEmitterWrapper.kt:47-49`）→ 曲末推进、窗口耗尽判定、失败跳歌都不得以「事件送达 JS」为前提。
- **I2 事件只当通知**：JS 回前台用 `getState()` 对账（§4.3）。
- **I3 一个 app 只有一个 `MediaSessionService`**（media3 官方建议）→ expo-audio 的 `AudioControlsService` 必须停用 + 移除（§3.3）。
- **I4 队列元素带绝对过期时间** `expiresAtEpochMs`（禁止相对 TTL；InnerTune 的反面教材见 §6.1）。
- **I5 策略单一来源**：core `shared/skipGuard`；原生只做最小可参数化兜底（§7）。
- **I6 播放推进不得依赖 JS 定时器**（PR #436 的不变量，写成测试要求，§11.1）。
- **I7 禁止 `exitProcess` / `Runtime.halt`**（RN 宿主同进程，会连 JS 上下文一起销毁）。
- **I8 反向 CNG**：不跑 `npx expo prebuild`（`android/app/build.gradle:96,99-100` 的手写版本注入与 `:104-139` 的签名回退会被覆盖）。

### 1.5 已拍板的平台约束（来源：PR #433 的 ADR + expo-audio 源码）
- `AudioMediaSessionCallback.kt:27-31` **主动移除** `COMMAND_SEEK_TO_NEXT/PREVIOUS` → 现有原生媒体通知/锁屏结构上没有上一首/下一首。
- `AudioLockScreenOptions` 只有 `showSeekForward/showSeekBackward/isLiveStream`（`node_modules/expo-audio/src/AudioConstants.ts:5-19`）→ 应用层没有任何挂载点能做「通知栏切歌」。
- 通知栏三个按钮是 expo-notifications 的 JS 回调（`services/notificationService.ts:64-81` + `app/_layout.tsx:122-140`）→ 后台 JS 不跑即失效；且非 Expo Go 下**两条通知并存**（`docs/research/2026-09-27-android-background-playback.md:420`）。
- 结论：这三条正是 C 要一次性拿到的东西，也是 PR #433 的 ADR「备选与否决」里把「媒体会话接管」判为独立议题的原因——**本规格就是把那个独立议题做掉**。

## 2. 架构与模块边界

### 2.1 分层与所有权
```
JS（前台/后台 headless）                    原生（Kotlin，进程内）
core 解析链（0 改动）                        QueueStore（权威队列）
  → resolvePlayableUrlMobile                 PlaybackController（ExoPlayer）
  → Track{songId,url,expiresAtEpochMs,       PlayerService : MediaLibraryService
          headers,meta}                        ├ MediaLibrarySession（3 个 action）
  → loadQueue / patchQueue  ────────►          ├ DefaultMediaNotificationProvider
  ← getState() 对账 / 事件（尽力而为） ◄──────  └ 落盘快照 + onPlaybackResumption
playerStore（UI 唯一真相源，后台期间以原生为准）
```
- **权威队列在原生**；JS 侧 `playerStore.queue` 是 UI 视图（§4.3）。
- **原生永不发网络请求做解析**；解析权 100% 在 JS（core）。
- 原生唯一主动向 JS「要东西」的通道是 `needTracks` 事件 + in-process headless 任务（§5）。

### 2.2 Kotlin 侧文件清单（新建 `packages/mobile/modules/native-player/`）
| 文件（`android/src/main/java/expo/modules/mplayerplayer/`） | 类 / 职责 | LOC |
| --- | --- | --- |
| `PlayerService.kt` | `PlayerService : MediaLibraryService()`；`onCreate` 建 ExoPlayer+Session，`onGetSession`，`onUpdateNotification`（默认 provider），`onTaskRemoved`，`onTrimMemory`，`onDestroy`；内嵌 `SessionCallback : MediaLibrarySession.Callback` | 220–280 |
| `PlaybackController.kt` | ExoPlayer 装配（`AudioAttributes(MUSIC)`、`handleAudioFocus=true`、`setHandleAudioBecomingNoisy(true)`、`setWakeMode(C.WAKE_MODE_NETWORK)`、headers 注入 DataSource、`Player.Listener`→内部状态、错误→`PlayerError(code,httpStatus,message)` 映射 | 160–220 |
| `QueueStore.kt`（+`TrackRecord`） | 队列 + `revision` + `aheadCount` + per-key 重试计数；`load/patch/clear/current/peekNext/toSnapshot/fromSnapshot`；每项含 `url/expiresAtEpochMs/headers/meta` | 110–160 |
| `AdvancePolicy.kt` | 曲末决策：`loopMode`、窗口耗尽、`autoSkip`+`skipLimit`、死链跳过上限、终局暂停；**只消费 policy 参数，不持有默认语义** | 90–130 |
| `ErrorPolicy.kt` | HTTP 码分级（403/410=过期、416、ENOENT、AudioTrack）、`delay(1s)`、**陈旧守卫**（`(key,index,position,playWhenReady)` 未变才重试）、每曲 3 次上限 | 80–120 |
| `ExpiryGuard.kt` | 读前判 `expiresAtEpochMs`：已过期 → 不发起请求，抛可重试 `IOException`，交 `ErrorPolicy` | 40–70 |
| `PrefetchBridge.kt` | 原生→JS 的 headless 触发：持有 `HeadlessJsTaskContext` 引用、起任务、持 wakelock、硬超时、有界重试（§5） | 100–150 |
| `PlayerModule.kt` | Expo Module DSL：`Name("MPlayerNativePlayer")`、`Events(...)`、`loadQueue/patchQueue/play/pause/next/prev/seek/setLoop/setRate/setPolicy/getState/stop/registerHeadlessHost` | 180–240 |
| `PlayerBridge.kt` | `object`：Service 实例注册表（`@Volatile var service`）+ Module↔Service 唯一通道 + `HeadlessJsTaskContext` 寄存 | 40–60 |
| `Events.kt` / `ErrorCodes.kt` | 事件名/错误码/payload 构造 | 40–80 |
| `android/src/main/res/values/strings.xml` | 通知渠道名、通知标题模板 | 0–10 |
| **合计** | | **1,060–1,520** |

> 量级口径：选型评估第三部分 §四给 **750–1,050 行**；本规格把 `ErrorPolicy`/`ExpiryGuard`/`PrefetchBridge` 三块显式列成文件后为 **1,060–1,520 行**（仍低于 expo-audio 播放半区 2,800 行的 55%），**这是相对评估的增量，需在 P1 复盘确认可接受**。包名刻意选 `expo.modules.mplayerplayer`（白蹭 `android/app/proguard-rules.pro:15` 的 keep 规则，依据选型评估 §2 命名约定）；脚手架另约 40 行：`package.json`、`expo-module.config.json`、`android/build.gradle`、`android/src/main/AndroidManifest.xml`。

### 2.3 JS 桥接 API（`modules/native-player/src/index.ts`）
```ts
// iOS/Web 没有这个模块，必须用 Optional（选型评估 §4.5 的 R5）
const Native = requireOptionalNativeModule<NativePlayerModule>('MPlayerNativePlayer');

/** 队列元素（唯一数据模型；字段名按已拍板决定） */
type Track = {
  songId: string;                      // core Song.id —— 事件回传后 JS 反查 Song 的唯一依据
  url: string;                         // 已解析直链（http/https/file）
  expiresAtEpochMs: number;            // 绝对过期；0 = 不适用/未知（本地 file://、无签名长期直链）
  headers?: Record<string, string>;    // UA + 按源 Referer（core BROWSER_UA / refererForSourceKey）
  meta: {
    key: string;                       // core identityKey：原生侧主键与去重键
    title?: string; artist?: string; album?: string;
    artworkUrl?: string; durationMs?: number;
    nonFull?: boolean; sourceType?: string;  // 试听标记（ADR-0012）随事件回传，JS 写 audioTagStore
  };
};

type Policy = {
  autoSkip: boolean;        // settingsStore.autoSkipOnError（:37,60）
  skipLimit: number;        // core SKIP_LIMIT = 3（packages/core/src/shared/skipGuard.ts:24）
  stopWhenOffline: boolean; // core 离线即停（skipGuard.ts:27,75-77）
  prefetchAhead: number;    // 窗口 N（§12 R4，初值 3）
};

loadQueue(a: { revision: number; tracks: Track[]; startIndex: number; playWhenReady: boolean;
               loopMode: 'off' | 'all' | 'single'; policy: Policy }): Promise<{ accepted: boolean; state: PlayerState }>;
patchQueue(a: { baseRevision: number; append?: Track[]; upsert?: Track[]; removeKeys?: string[] })
  : Promise<{ accepted: boolean; revision: number; stale?: boolean }>;   // baseRevision 不符 → stale:true，JS 重 loadQueue
play(): void; pause(): void; next(): void; prev(): void; seek(seconds: number): void;
setLoop(mode: 'off'|'all'|'single'): void; setRate(rate: number): void; setPolicy(policy: Policy): void;
getState(): PlayerState;              // 同步快照（对账唯一权威）
stop(): void;                         // 用户显式停止 → 服务降级 + 撤通知
registerHeadlessHost(): void;         // JS 模块加载时调用一次：把 HeadlessJsTaskContext 寄存到 PlayerBridge（§5.2）
```

### 2.4 事件表（模块级 `Events(...)`，全部「通知」性质）
| 事件 | payload | 语义 | 驱动? |
| --- | --- | --- | --- |
| `trackChanged` | `{fromKey?, toKey, songId, index, reason: 'auto'\|'user'\|'errorSkip'\|'restore', revision}` | 原生切歌（**含曲末自动推进**） | 否（对账用） |
| `stateChanged` | `{revision, index, playing, positionMs, durationMs, bufferedAheadMs, loopMode, rate}` | 播放/暂停/seek 后快照 | 否 |
| `progress` | `{revision, index, positionMs, durationMs}` | 1s 粒度心跳（UI 250ms 契约见 §4.3） | 否 |
| `queueEnded` | `{reason: 'exhausted'\|'windowHole'\|'stopped', index, revision}` | 队列播完/窗口耗尽/用户停 | 否 |
| `needTracks` | `{currentIndex, remaining, reason: 'lowWater'\|'hole', revision}` | 原生要 JS 补歌（**同时也是 headless 触发的对外可见信号**） | 否 |
| `playbackError` | `{key, songId, code, httpStatus?, message, disposition: 'retrying'\|'skipped'\|'stopped'}` | 原生错误与其兜底决策 | 否 |
| `serviceState` | `{foreground: boolean, restoring: boolean}` | FGS/恢复态（诊断） | 否 |

## 3. 接线与构建

### 3.1 目录结构与注册文件
```
packages/mobile/modules/native-player/
├── package.json                 # name: @mplayer/native-player（gradle 工程名 mplayer-native-player）
├── expo-module.config.json      # {"platforms":["android"],"android":{"modules":["expo.modules.mplayerplayer.PlayerModule"]}}
├── index.ts / src/*.ts          # 桥接（§2.3）
└── android/
    ├── build.gradle             # com.android.library + expo-module-gradle-plugin + media3 1.9.0
    └── src/main/{AndroidManifest.xml, java/expo/modules/mplayerplayer/**, res/values/strings.xml}
```
- **必须只声明 `platforms: ["android"]`**（iOS 回落靠 `requireOptionalNativeModule`，决策 #11）。
- `nativeModulesDir` 默认 `./modules`（相对 app root = `packages/mobile`），autolinking 自动收；**实测探针**（选型评估 §3.1）证明无需写进 app 的 `dependencies`、无需改 `android/settings.gradle:32`（`useExpoModules()` 已在）。

### 3.2 依赖与 media3 pin
- 模块 `android/build.gradle`：`androidx.media3:media3-exoplayer:1.9.0`、`media3-session:1.9.0`、`media3-datasource-okhttp:1.9.0`（**仓库实际解析到的就是 1.9.0**：expo-audio `android/build.gradle:29-37` 与预编译 POM；本机 Gradle 缓存 13 个 artifact 全为 1.9.0）。
- **绝不上 1.10.x**（Gradle 取最高版本会把 expo-audio 预编译 AAR 一起顶到未验证版本；选型评估 R1）。
- 不写 `compileSdk/minSdk`（`expo-module-gradle-plugin` 自动注入 `ProjectConfiguration.kt:69-81`），不显式依赖 expo-modules-core（插件已加 `compileOnly`）。
- **已实测存在的 API（1.9.0，本机 AAR 探针）**：`MediaLibraryService`/`MediaLibrarySession`/`MediaLibrarySession.Callback`、`MediaSessionService.setMediaNotificationProvider`、`MediaSession.setMediaButtonPreferences`、`DefaultMediaNotificationProvider`（含 `setSmallIcon`、`COMMAND_KEY_COMPACT_VIEW_INDEX`）、`MediaSession.Callback.onPlaybackResumption`（含 `isForPlayback` 形参）、`DataSpec.withRequestHeaders`、`ResolvingDataSource.Factory/Resolver`。→ 本规格的 API 选择**不依赖 1.10.x 独有特性**。

### 3.3 库 manifest（承载 service 与权限，走 merger；不改 app manifest）
```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"/>
  <uses-permission android:name="android.permission.WAKE_LOCK"/>          <!-- setWakeMode + headless 补窗 -->
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/> <!-- 与 expo-notifications 合并结果一致 -->
  <application>
    <service android:name="expo.modules.mplayerplayer.PlayerService"
             android:exported="false" android:foregroundServiceType="mediaPlayback">
      <intent-filter><action android:name="androidx.media3.session.MediaSessionService"/></intent-filter>
      <intent-filter><action android:name="androidx.media3.session.MediaLibraryService"/></intent-filter>
      <intent-filter><action android:name="android.media.browse.MediaBrowserService"/></intent-filter>
    </service>
  </application>
</manifest>
```
- 库 manifest 被 merger 合入是**标准 manifest merging**（第一手先例：`POST_NOTIFICATIONS` 就是这样从 expo-notifications 库 manifest 进 merged manifest 的）；**落地时必须跑一次 `./gradlew :app:processDebugMainManifest` 核对**（选型评估 §3.3 标为高置信推断）。
- **必须删掉 app manifest 的 expo-audio 服务**：`packages/mobile/android/app/src/main/AndroidManifest.xml:23-27`（`expo.modules.audio.service.AudioControlsService` + 其 `MediaSessionService` intent-filter）。这是 I3 的物理保障（改 `app.json` 对 Android **无效**——CI 不 prebuild，见 I8）。
- **JS 侧同时停用**：Android 上永不调用 `setActiveForLockScreen`（现调用点 `services/audioPlayer.ts:528-535`）。
- `app.json:28-33` 的 `expo-audio` plugin **暂留**（决策 #11 的 iOS 回落需要它的后台音频声明；Android 侧它不再有任何生效路径）。若将来彻底移除 expo-audio，需同时为 iOS 手写 `UIBackgroundModes=audio`（待定，见 §12 R6）。

### 3.4 proguard / R8 keep
- app 侧已开 `minifyEnabled + shrinkResources`（`android/app/build.gradle:132-135`）。
- 主保险：Kotlin 包名落 `expo.modules.mplayerplayer` → 被 `android/app/proguard-rules.pro:15`（`-keep class expo.modules.** { *; }`）覆盖；expo-modules-core 的 consumer rules 另会 keep 所有 `expo.modules.kotlin.modules.Module` 子类。
- **仍要补的防御（P1 落地）**：模块 `android/build.gradle` 加 `consumerProguardFiles 'proguard-rules.pro'`（`-keep class expo.modules.mplayerplayer.** { *; }`）；service 类由 manifest 引用（AGP 自动 keep，**推断**）。**R8 只在 release 生效 → 必须用 release APK 验一次**（§10 P8、§11.3）。
- 通知小图标：新增 `res/drawable/ic_stat_mplayer.xml` + `res/raw/keep.xml`（`tools:keep="@drawable/ic_stat_mplayer"`），防止 `shrinkResources` 把只被「资源名字符串」引用的 drawable 裁掉（推断，Metrolist/SimpMusic 用资源 id 引用而无此问题）。

### 3.5 CI 不变的理由
- 构建入口只有 `./gradlew assembleRelease`（`.github/workflows/ci.yml:61-67`）与 `./gradlew assembleRelease bundleRelease --no-daemon`（`release.yml:246-250`）；新模块是 autolinking 自动 include 的 gradle 子工程 → **workflow 0 改动**。
- 成本：冷构建多一个子工程 compile+kotlin（推断 +2–4 min，靠 `org.gradle.caching=true` 与 `gradle/actions/setup-gradle@v6`），45 min 上限无压力；APK dex 增量推断 +20–80 KB（media3 ~4.9 MB 本来就在包里）。

## 4. 队列与推进

### 4.1 窗口 N 与补窗时机
- **初始 N = 3**（`policy.prefetchAhead`；与 core tier3 的 K=3 同量级，便于复用既有并发闸门）。语义：**从 `currentIndex` 起，原生手里至少有 N 条「已解析且未过期」的直链**。
- **低水位**：原生 `aheadCount <= 1` → 发 `needTracks{reason:'lowWater', remaining}`（同一水位只发一次，补进来后复位），后台同时触发 headless 任务（§5）。
- 前台时由 JS 主动补窗（`patchQueue({append})` 增量投喂，**不重发整表**）；后台时由 headless 任务补窗。两路都幂等（`baseRevision` 护栏）。
- **踩空（窗口耗尽）语义**：推进到「队尾且下一首还没来」时**不空转、不报错**：`pause()`（保持 session + 通知，显示暂停态）→ 发 `needTracks{reason:'hole'}` + `queueEnded{reason:'windowHole'}` → 等 `patchQueue`；等待超时（建议 60s，可配）仍无新歌 → `stopSelf()` + 撤通知。用户主动 next 时踩空 → 立即 `queueEnded`，不重试。

### 4.2 原生推进路径（#405 的正解）
```
ExoPlayer 播完一项 → onMediaItemTransition(item, reason=AUTO)   ← 原生，零 JS 参与
  → QueueStore 索引更新 + 落盘（§9.3）
  → trackChanged{reason:'auto'}（事件，可能丢）
  → 若 aheadCount<=1：needTracks + （后台）headless 补窗
```
- 判据与依据：media3 官方 `onMediaItemTransition`/playlist 语义（平台调研 §7）；结构范本为 NewPipe/Retro 的「原生持队列 + 原生推进」与 Metrolist「ExoPlayer 播放列表当权威队列」（OSS 调研 §2）。
- **与 PR #433 的关系（写清为什么作废）**：PR #433 的 `startSourceOnPlayer`（单一同步换源出口）与 `immediateSources`（预取命中交接槽，让 `replace+play` 在同一同步 tick 完成）是为「**JS 单播放器 + `replace()` 换源**」这个模型服务的——目标是「尽快离开 `STATE_ENDED`，避免失去 FGS 优先级后 JS 被冻结」。**C 下该模型整体不成立**：播放器由原生持有，曲末推进是 ExoPlayer 的原生行为，不再有「停在 ENDED 等 JS」的窗口，也不再有 `player.replace()`；因此 `startSourceOnPlayer` / `immediateSources` / `finishAdvancePending`（重入守卫）**全部作废**，其职责由「原生 QueueStore 推进」替代。它们对应的**问题意识**（不留 ENDED 空窗）在 C 下由 §4.4 的「窗口内必有下一首」承接。

### 4.3 `trackChanged` 通知 + JS `getState()` 对账（与 `playerStore` 的同步口径）
- **前台期间**：`trackChanged` 到达 → 用 `songId` 在 `playerStore.queue` 里反查 `Song` → 同步 `currentSong/currentIndex`（不调 core 的下一首计算，index 以原生为准）。
- **回前台（`AppState: active`）对账**（唯一权威）：
  ```ts
  const st = Native.getState();                 // 同步
  if (st.index !== usePlayerStore.getState().currentIndex) applyNativeState(st);
  if (st.aheadCount < N) void feedWindow();     // 立即补窗，并把 positionMs 写回 currentTime
  ```
- **口径声明**：`playerStore` 仍是 UI 的唯一真相源；但**后台期间队列索引的真相源是原生**，回前台以 `getState()` 单向覆盖 store（新增 `playerStore.setState`，+15~25 行）。**禁止双向写**（否则出现第二个真相源）。UI 的 250ms 进度契约（`components/PlayerOverlay.tsx:810-832`）由「原生 `progress` 1s + 前台时 JS 用 `getState()` 插值/本地推进」满足——**待定项见 §12 R7**。
- `prev`/`next` 的锁屏与通知按钮走原生；语义对齐见 §7.3。

### 4.4 队列不变量（原生侧断言，越界即降级而非崩）
1. 队列中每一项在被 ExoPlayer 读取时都必须满足 `expiresAtEpochMs == 0 || expiresAtEpochMs > now()`（违反 → `ExpiryGuard` 抛可重试错误，§6）。
2. `currentIndex` 永远指向一个「已解析」项；若某项 URL 连续失败到上限，该项被标记 `failed` 并**从 ExoPlayer 列表移除**（不留在队列里造成二次踩空）。
3. 原生永不自行解析、永不自行决定「解析哪首歌」；`autoSkip` 仅在 `policy.autoSkip=true && skippedThisSession < policy.skipLimit` 时生效。

## 5. 补窗：headless JS 任务（决策 #7 的落地）

### 5.1 机制选择与依据
- **用 in-process `HeadlessJsTaskContext.startTask()`，不用 `startService`**。依据：RNTP V5 的 `EventBroker` 就是这么做的（注释点名 `startService` 会撞 Android 12+ 的 `BackgroundServiceStartNotAllowedException`，issue #2670）；本仓库探针也证明「进程在 FGS 下、JS 对网络回调仍有反应」。
- **已实测的 RN 0.86.2 API**：`HeadlessJsTaskContext.getInstance(reactContext)`（`ReactAndroid/.../jstasks/HeadlessJsTaskContext.kt:186`）、`startTask(HeadlessJsTaskConfig)`（`:62`）、`addTaskEventListener`（`:41`）、`retryTask(taskId)`（`:110`）、`HeadlessJsTaskConfig(taskKey, data, timeout, isAllowedInForeground)`（`HeadlessJsTaskConfig.kt:29-35`）、JS 侧 `AppRegistry.registerHeadlessTask`（`Libraries/ReactNative/AppRegistryImpl.js:221`）。
- **RN 0.86 的 `HeadlessJsTaskContext` 自身不持 wakelock**（本机源码 grep 无 `WakeLock`）→ **wakelock 由我们自己持**：`PrefetchBridge` 在起任务时 `PowerManager.PARTIAL_WAKE_LOCK`（超时上限封顶），任务结束/超时/重试起手时释放。依据：RNTP `EventBroker` 的 `acquireWakeLock()` + 决策 #7 的「加 wakelock」。
- **为什么 headless 任务能让 JS 真的跑起来（一手依据）**：`JavaTimerManager` 把 `isPaused` 与 `headlessJsTaskContext.hasActiveTasks()` 联合判断（`JavaTimerManager.kt:125,142,291,323`；它自己在 `:69` 注册为 `addTaskEventListener`）→ **只要有活跃 headless 任务，即便宿主已 `onHostPause`，JS 定时器照常投递**。这正是「后台补窗能跑完 core 解析链（其 3s/9s 墙钟本身就是定时器，#424）」的机制依据；反过来说，**不在 headless 任务窗口内时，后台任何 setTimeout/微任务都不可依赖**（I1/I6 的来源）。
- **任务返回值不是回传通道**（RN 没有 result 通道）→ **回传走同一模块的 `patchQueue`**：headless JS 解析完直接调 `Native.patchQueue({baseRevision, append})`；原生在（a）收到 `patchQueue` 或（b）任务 `onHeadlessJsTaskFinish` 或（c）硬超时时释放 wakelock。

### 5.2 注册与引用获取（本规格最关键的一处工程风险）
- JS 侧在模块加载时做一次 `AppRegistry.registerHeadlessTask('MPlayerPrefetch', () => async (data) => { ... })`，并调用 `Native.registerHeadlessHost()`。
- 原生侧：Expo Module 的 `appContext.reactContext`（`expo-modules-core/.../kotlin/AppContext.kt:227`，底层是 `WeakReference<ReactApplicationContext>`，`:53`）取 ReactContext → `HeadlessJsTaskContext.getInstance(it)` → 存进 `PlayerBridge`，供 Service 使用。
- **待实现的校验点**：bridgeless（RN 0.86 新架构）下该对象是否可安全 cast 到 `ReactContext`（`BridgelessReactContext` 是 `internal` 类，`runtime/BridgelessReactContext.kt:47`）；若不可，退回「JS 侧把 `HeadlessJsTaskContext` 通过模块方法寄存」的同一条路（`registerHeadlessHost` 的入参由 JS 传，实际仍是原生拿）。**这是 P1 的第一个 spike，失败则 §5 整体降级为「窗口耗尽即暂停」**（仍满足 #405 的主判据，只是后台补窗能力受限）。
- 冷进程（服务被系统重建、JS 尚未加载）时无 ReactContext，也无法起 headless → 只从落盘快照恢复并 `playWhenReady=false`（§9.4）。

### 5.3 任务签名、超时、重试、失败语义
```ts
// 原生 → JS
HeadlessJsTaskConfig('MPlayerPrefetch',
  { revision: number, currentKey: string, currentIndex: number,
    need: number,            // 至少要几条
    reason: 'lowWater' | 'hole' },
  timeoutMs,                 // 见下
  /* isAllowedInForeground */ true)   // 前台也允许：与前台补窗天然幂等，避免状态机分叉
```
- **`timeoutMs = 12_000`**：必须装得下 core 的「直连 3s 墙 + 整链 9s 预算」（`#424` / ADR `2026-09-28-resolution-chain-deadline.md`）。对照：RNTP V5 的 `TASK_TIMEOUT_MS = 5_000`（选型评估 §3.2(b)），**装不下我们的解析链**——这是本规格与 RNTP 的差异点。取值待 P4 实测收敛（§12 R3）。
- **有界重试**：每个「水位事件」最多 2 次尝试（首次 + 1 次重试），退避 3s；可用 RN 的 `LinearCountingRetryPolicy`（`jstasks/LinearCountingRetryPolicy.kt:10`）+ `retryTask(taskId)`，也可在原生侧自己计时（更可控，推荐后者）。
- **失败语义**：任一尝试后窗口仍未补齐 → 原生**在缓冲边界停下**：`pause()` + 保持 session/通知（不 stopSelf，保留用户一键续播的入口）+ 发 `queueEnded{reason:'windowHole'}`；回前台由 JS 立即补窗并可由用户恢复播放。
- **降级顺序**：headless 不可用（无 ReactContext / 无 wakelock / 任务起不来）→ 退化为「预取窗口即缓冲边界」，绝不让原生去发网络请求。

### 5.4 与前台补窗的优先级
- 前台：JS 的 `feedWindow()` 优先（能跑整条 core 解析链、能写 12h 缓存、能更新 UI）。
- 后台：`needTracks` 到达且距上次补窗 > 2s → 起 headless。**原生不做「前台/后台」判断以外的调度**（不排队、不合并多次请求，靠 `revision` 幂等）。
- 两路共用同一条 JS 函数（`feedWindow()` 与 headless 任务体都调它），**避免两份解析逻辑**。

### 5.5 从 PR #433 抢救的预取去重设计（原样保留其参数）
PR #433 在 JS 侧给预取加的三层去重（其 diff 常量与语义）在 C 下**继续有效**，落到 `feedWindow()`/headless 任务体：
| 层 | 参数 | 作用 |
| --- | --- | --- |
| 在飞去重 | `prefetchInFlight: Set<key>` | 同一首不并发解析 |
| 成功窗口 | `PREFETCH_SKIP_FRESH_MS = 5 * 60 * 1000` | 5min 内已成功的 key 不重复解析（与既有 `audioPlayer.ts:54` 同量级） |
| 失败冷却 | `PREFETCH_FAIL_COOLDOWN_MS = 30 * 1000` | 失败后 30s 内不再重烧整条解析链 |
另保留 PR #433 的「**剩余 ≤ 15s 提前触发预取**」触发点（`PREFETCH_LEAD_SEC = 15`）——C 下它不再是「保命」机制（原生推进已接管），而是**降低窗口踩空概率**的优化：`progress` 事件里按 `duration - position <= 15s` 补一次 `feedWindow()`。

## 6. 过期与失效处置

### 6.1 绝对过期时间（硬性）
- 队列项必须存 `expiresAtEpochMs`（决策 #6 / I4）。**反面教材**：InnerTune 缓存写入存**相对 TTL**（`expiresInSeconds * 1000`）却与 `System.currentTimeMillis()` 比较 → 条件恒真 → URL 被无限期复用 → 曲末 403（`MusicService.kt:694` vs `:633`，OSS 调研 §5）。
- JS 填什么：源返回的过期秒数（如可解析）；解析链给不出时填 **`0 = 未知/不适用`**（本地 `file://`、无签名长期直链），原生对 0 **不做本地过期判断**，只靠 HTTP 码分级兜底。
- 保底：所有网络直链给一个**保守上限**（建议 30min，待定 §12 R8）——即使源没说过期，也避免「一路播到 403 才发现」。

### 6.2 403 / 410 与 Metrolist 式重试（抄粒度，不抄对象传递）
判据来源：Metrolist `onPlayerError`（`MusicService.kt:3010-3099`）、`isExpiredUrlError`（`:2918-2921`，403/410=过期）、`refreshStreamAndRetry`（`:3294-3347`）、`MAX_RETRY_PER_SONG = 3`（`:545`）、`waitOnNetworkError`（`:3073-3077`）。
原生 `ErrorPolicy` 行为（**最小可参数化兜底**，不复制决策语义）：
1. **分级**：403/410 → 过期；416 → 清缓存后从头 prepare（若适用）；`ENOENT`/`FileNotFound` → 本地文件缺失；`AudioTrack` 类 → `delay(3s)` 后重启渲染器；网络类 → 无网等待。
2. **过期处置**：标记该项 URL 失效（`invalidate(key)`）→ `delay(1s)` → **陈旧守卫**：校验 `(key, index, position, playWhenReady)` 与错误发生时**完全一致**才重试（否则丢弃，防陈旧重试）→ 重试前发 `playbackError{disposition:'retrying'}`，让 JS（若活着）用 `patchQueue({upsert})` 灌新 URL。
3. **计数上限**：每曲 3 次（`policy.skipLimit` 同源，core `SKIP_LIMIT=3`），超限 → 标记 `failed` + 从 ExoPlayer 列表移除 + 发 `trackChanged{reason:'errorSkip'}`；累计跳过达上限 → `pause()`（不 stopSelf，保留用户入口）。
4. **无网**：`policy.stopWhenOffline=true` 时**直接暂停不进重试**（对齐 core `OFFLINE_COPY`/`skipGuard.ts:27,75-77`）；否则等待网络恢复（Metrolist 的 `waitOnNetworkError` 形态）。
- **不抄**：Auxio 的「失败即无条件跳下一首」（OSS 调研 §3.9）；AntennaPod 的「只上报 UI 不重试」（后台无 UI 会卡死，OSS 调研 §9 必避）。

### 6.3 `ResolvingDataSource` 的边界（只做便宜的本地重写）
- **允许**：① 用 `DataSpec.withRequestHeaders(headersFor(songId))` 注入 per-item UA/Referer（1.9.0 实测存在 `DataSpec.withRequestHeaders`；media3 的 `DefaultHttpDataSource` 只有全局默认 headers，per-item 必须在这一层做）；② 读前判 `ExpiryGuard`（若已知过期 → 直接抛可重试 `IOException`，**不发起请求**）。
- **禁止**：在这一层做任何网络解析/刷新（我们的解析链在 JS/core，后台跑不了；这也是本规格与所有对照项目最本质的区别——OSS 调研一页结论 §2）。
- **若将来加本地缓存**（P8 之后可选）：必须抄 SimpMusic 的 `dataSpec.subrange(chunkLength)` 强制每个 chunk 边界重入 resolver（`Media3ServiceModule.kt:244-363`，OSS 调研 §4.3），因为 `CacheDataSource.read()` 在一次 `open()` 内不再回调 resolver；且注意「裸 mediaId 当 URI」只对一个 chunk 安全（无 scheme 会被路由到 `FileDataSource`）。
- **generation/防竞态**：若引入 URL 缓存，必须同时抄 Metrolist 的 `StreamUrlCache` TTL **+ generation**（`StreamUrlCache.kt:37-121`）——只抄 TTL 会在「解析进行中用户切歌/换源」时写回陈旧 URL（OSS 调研 §2.9 必避）。C 下更简单：`revision` 单调 + `patchQueue` 的 `baseRevision` 校验即可覆盖同一竞态。

## 7. 策略对齐（core `skipGuard` 唯一来源）

### 7.1 下发字段
| 字段 | 来源 | 原生用途 |
| --- | --- | --- |
| `autoSkip` | `settingsStore.autoSkipOnError`（`stores/settingsStore.ts:37,60`，默认 true） | 是否允许自动跳过失败项 |
| `skipLimit` | core `SKIP_LIMIT = 3`（`packages/core/src/shared/skipGuard.ts:24`） | 会话内跳过上限 / 每曲重试上限 |
| `stopWhenOffline` | core 离线即停（`skipGuard.ts:27,75-77`） | 无网时直接暂停 |
| `loopMode` | `settingsStore.playMode`（`:18,20,53`）+ `core getNextSongIndex`（`packages/core/src/utils/queue.ts:8-14`） | `off/all/single` 映射 |
| `prefetchAhead` | 本规格（初值 3） | 低水位阈值 |

### 7.2 原生兜底与 JS 决策的边界
- **JS 保留**：`decideAfterPlaybackFailure`（`skipGuard.ts:72`）、`registerTerminalFailure`（`:102`）、坏歌记忆 `isKnownBadSong`（`:121`）、`pickNextSongAfterFailure`（`:132`）、`explainPlaybackFailure` 文案、`playbackTrace`。
- **原生只做**：§6.2 的四条（分级 / 陈旧守卫 / 计数上限 / 无网等待）。**原生不做文案、不做坏歌记忆、不做「离线直连还是 tier3」这类判断。**
- **对齐与可诊断性**：原生每次跳过都发 `trackChanged{reason:'errorSkip'}` + `playbackError{disposition:'skipped'}`，带 `revision`/`key`/`httpStatus` → JS 落进现有 `playbackTrace` 环形缓冲（`services/playbackTrace.ts` + `app/_layout.tsx:11,28`），使「原生计数」与「core 计数」可对账（这是选型评估 R8「最该盯的一条」的缓解措施）。
- **可选增强（不在本期）**：AntennaPod 式的 `ForwardingPlayer` 注入业务规则（裁剪 `availableCommands` + 拦截 play/next）是「策略下沉 + 保留 media3 默认通知/车机行为」的最省力入口（OSS 调研 §7.9 抄 1）；C 下我们的 `PlayerService` 已能直接拦，**暂不引入**。

### 7.3 播放模式与随机语义（含待定项）
- `settingsStore` 的三档（`settingsStore.ts:18`：`'单曲循环' | '随机播放' | '列表循环'`，`:20` 的 `PLAY_MODES` 顺序）映射：单曲循环 → `REPEAT_MODE_ONE`；列表循环 → `REPEAT_MODE_ALL`；**随机播放 → 见下（待定）**。第「四态」是**队列播完收尾**（`playerStore.next()` 给不出下一首 → 现行为 `stopAllPlayers()+pause()`，`audioPlayer.ts:167-177`）→ C 下映射为 `queueEnded{reason:'exhausted'}` + `pause()`；**建议四态命名进 ADR 统一，避免「四种播放模式」在文档里各说各话（待定）**。
- **随机语义是待定项**（选型评估一页结论 §7）：core 是「每次随机且 ≠ 当前」（`queue.ts:29-36`，无记忆），media3 `setShuffleModeEnabled(true)` 是**置换式**且不外露顺序 → 会同时破坏「预取窗口能算出下一首」和「锁屏 next 与 UI next 一致」。
  **本规格的建议（需 ADR 拍板）**：**随机由 JS 定序，原生只顺序推进**——即 JS 在补窗时按 core 规则生成「接下来 N 个 index 的有序序列」并 `append`（`loopMode='all'`、`shuffle=false` 传给原生）。好处：① core 仍是唯一语义来源；② 预取窗口天然知道下一首是谁；③ 锁屏 `prev/next` 与 UI 语义一致（有序队列）；④ 避免 media3 shuffle 的语义漂移。代价：随机序列在窗口内是「预定的」，用户切歌后需重排（列入 P6 验收项）。
  **待定备选**：直接用 media3 shuffle（改动最小，但必须接受「预取窗口算不出下一首 → 只能预解析未知项」或「放弃预取」——**不推荐**）。

## 8. 通知与锁屏

### 8.1 默认 provider 与 3 个 action
- 用 `DefaultMediaNotificationProvider`（media3 默认 MediaStyle）+ `setSmallIcon(R.drawable.ic_stat_mplayer)`；**不手写 MediaStyle**（依据：6/8 开源实现这么做，OSS 调研一页结论；反例 Jellyfin-androidtv 手写 MediaStyle 却忘了 `startForeground`）。
- 3 个 action = **[上一首, 播放暂停, 下一首]**。media3 默认把 `seekToPreviousMediaItem` / play-pause / `seekToNextMediaItem` 放进 compact view（平台调研 §3），因此**默认行为已经是我们想要的**；如需固定顺序，用 `MediaSession.setMediaButtonPreferences`（1.9.0 实测存在）+ `CommandButton`（`Slot.SLOT_PREVIOUS/SLOT_CENTRAL/SLOT_NEXT`），不要用通知 action 下标。
- **注意**：expo-audio 是**故意摘掉** `COMMAND_SEEK_TO_NEXT/PREVIOUS` 的（`AudioMediaSessionCallback.kt:27-31`）→ 我们的 `SessionCallback` **必须不摘**，并确保 `PlaybackState` 的 action 集合含 `COMMAND_SEEK_TO_NEXT/PREVIOUS`（Android 13+ 系统媒体区的按钮来自 `PlaybackState`，平台调研 §3）。

### 8.2 compact 下标陷阱
- 手写 MediaStyle 时 `setShowActionsInCompactView(int...)` 是 **action 下标硬编码**，必须与 `addAction` 顺序严格绑定：Retro `(1,2,3)`；VLC `intArrayOf(1,2,3)` 或 `(0,2,4)`；NewPipe 在 Android 13+ **干脆不设** compact（交给系统）；且 Retro 用可变数组直接改下标（`mActions[2] = ...`）→ 增删 action 时静默错位（OSS 调研一页结论 + §1.4）。
- 本规格对策：**不手写**；若确需自定义，用 `CommandButton.DisplayConstraints` + `COMMAND_KEY_COMPACT_VIEW_INDEX`（1.9.0 的 `DefaultMediaNotificationProvider` 内含该 key）+ `Slot`，禁止下标。
- 按钮预算：Android 13+ 系统媒体区最多 5 个槽、compact 只取前 3 个（平台调研 §3）→ 我们的 3 个恰好在预算内，不做第 4/5 个（循环/随机/收藏不进通知）。

### 8.3 封面与元数据跟随
- 元数据随 `MediaItem.mediaMetadata`（title/artist/albumTitle/artworkUri）走；`artworkUri` 优先用 JS 已解析的 `meta.artworkUrl`（避免原生再发请求）。
- 封面加载：`MediaSession.Builder` 可挂 `setBitmapLoader`（Metrolist/SimpMusic 用 Coil）；**本规格不引入 Coil**，先用 media3 默认 loader 拉 `artworkUri`，**待定/推断**：1.9.0 默认 loader 对 `http(s)` 的支持与缓存行为需 P8 实测（§12 R9），无网时回落 App 图标（不要空白）。元数据在**换源同一 tick 刷新**（PR #433 的结论）在 C 下由「media3 从 `MediaItem` 读元数据」天然满足。
- 点击通知回 App：`MediaSession.Builder.setSessionActivity(PendingIntent)`；API ≥ 33 媒体通知直接读该 pending intent（平台调研 §2.1）→ 深链到「正在播放」页（现行为见 `app/_layout.tsx:136-139`）。

### 8.4 Android 13+ 与通知权限
- 动作按钮由系统从 `PlaybackState` 生成（AOSP `MediaDataManager`），不再依赖通知 action；`POST_NOTIFICATIONS` 被拒时**媒体会话通知仍可见**（官方豁免），但 **FGS 通知不豁免** → 仍应主动申请（`notificationService.ts:40` 的 `requestNotificationPermission` 保留）。
- **渠道**：**新建独立渠道** `music-playback-native`（`IMPORTANCE_LOW`，与 media3 默认一致），**不要复用**现有 `music-playback`（`notificationService.ts:6,56-61` 是 `IMPORTANCE.HIGH`；渠道属性以先创建者为准属推断）→ 避免「通知突然变安静/变吵」的体感差异与迁移风险。
- **必须撤掉 JS 那条通知**：`notificationService.ts:93-121`（`updateNotification`/`clearNotification`）与调用点 `audioPlayer.ts:562,643,650,653`；`app/_layout.tsx:122-140` 的按钮监听同样撤掉（否则双通知 + 失效按钮，平台调研 §3/§1.5）。

## 9. 生命周期与恢复

### 9.1 FGS 类型与权限
- `foregroundServiceType="mediaPlayback"` + `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` 三件套（库 manifest 承载，§3.3）；merged manifest 实测 `minSdk 24 / targetSdk 36`。
- **mediaPlayback 不受 FGS 6h/24h 超时约束**（官方 FGS timeout 页只含 `dataSync`/`mediaProcessing`）→ 长时后台播放不会被系统掐。
- 前台提升由 media3 负责；`startForeground` 失败（`ForegroundServiceStartNotAllowedException`）→ 捕获后 `stopSelf()`（Metrolist `startForegroundSafely:4212-4242` 的做法），**不要吞掉后继续跑**（避免 ANR 与半死状态）。

### 9.2 `onTaskRemoved` 选型与理由
- **选型：不重写（继承 media3 默认）** —— 播放中保活，未播放时暂停并 `pauseAllPlayersAndStopSelf()`（`MediaSessionService` 官方 JavaDoc 语义）。AntennaPod 即「不重写」（OSS 调研 §7），Metrolist 也默认保活。
- **理由（逐条否决替代方案）**：
  1. `exitProcess(0)`/`Runtime.halt(0)`（SimpMusic `SimpleMediaService.kt:174-182`；NewPipe `PlayerService.java:195-204`）**绝对禁止**（I7）：RN 宿主同进程，会连 JS 上下文一起销毁，冷启后 JS 侧状态全丢。
  2. 无条件 `stopSelf()`（InnerTune `MusicService.kt:784-787`）→ 用户划掉任务卡即停播，与「后台续播」目标正面冲突。
  3. uamp 的「滑动清任务就停播」同理否决。
- **可选**：设置项「划掉任务卡时停止播放」（Metrolist 的 `StopMusicOnTaskClearKey` 模式）留待产品定，默认关。

### 9.3 落盘（`onTrimMemory` + 周期）
- 落盘内容：`{revision, tracks(key/songId/url/expiresAtEpochMs/headers 摘要/meta), index, positionMs, playWhenReady, loopMode}`。**headers 里的凭据不入盘**（若 headers 含敏感值，落盘时置空并在恢复时要求 JS 重灌）。
- 触发点：`onMediaItemTransition` 尾部、`onDestroy`、**每 60s 定时器**（Metrolist `:1260-1268`）、**`onTrimMemory`**（SimpMusic `SimpleMediaService.kt:169-172`；比纯定时器更抗 OEM 杀进程——OSS 调研抄点）。
- 实现建议：`SharedPreferences` 存小状态 + 队列 JSON 文件（Metrolist 用 `ObjectOutputStream` 写 `persistent_queue.data`；用 JSON 更易演进，**待定**）。

### 9.4 进程死恢复 `onPlaybackResumption`（必须抄的防御）
- **AntennaPod 的原话**：`If there is no media to resume, media3 crashes`（`MediaLibrarySessionCallback.java:365-366`）→ **没有可恢复内容时必须返回非空**（返回「暂停的队列」或「最近一集」兜底），否则 media3 崩。
- 我们的实现口径：`onPlaybackResumption` 从落盘快照恢复 → **`playWhenReady=false`（不自动续播）**，因为 URL 很可能已过期（Symfonium 官方也明确「被 OS 杀后台后不恢复队列，只保 resume point」）。
- 1.9.0 实测：`MediaSession.Callback` 内含 `onPlaybackResumption` 与 `isForPlayback` 形参 → 需按 1.9.0 的签名覆写；如需区分「真播放恢复 vs 车机展示最近播放」，参考 SimpMusic `SimpleMediaSessionCallback.kt:211-229`（**不是所有 resumption 都该恢复队列**）。
- **恢复后必须保证前台可发现**：ViMusic 的教训是「恢复队列后没 `startForeground` → 立刻又被杀」（`PlayerService.kt:455-457`，OSS 调研 §6）；恢复后 `playWhenReady=false` 时必须有用户可见入口（点通知/开 App）。冷进程（JS 未加载、无 ReactContext）只恢复队列与位置、**不主动起 headless**，等 JS 加载后 `initAudio()` → `getState()` 对账（§12 R11）。

### 9.5 其他
- `onDestroy`：释放 session/player + 落盘 + 释放 wakelock。
- 不设 `android:process`（跨进程会让 `PlayerBridge` 失效，需改走 media3 `MediaController`，成本 +150 行——推断）。
- `START_STICKY` vs `START_NOT_STICKY`：media3 `MediaSessionService` 自身返回 `START_STICKY`（平台调研 §6）→ **不覆盖**；恢复仍靠落盘（`START_STICKY` 不保证队列回来）。

## 10. 实施分期 P0–P8

每期的「回滚点」= 上一期通过后的 commit（每期独立可 revert）。

### P0 —— dev build 包名后缀（PR #435，**现为 OPEN，合它或 cherry-pick**；见验收手册）
- **改动文件**：`packages/mobile/android/app/build.gradle:123-126` 的 `debug` 块加 `applicationIdSuffix '.dev'` + `versionNameSuffix '-dev'`；`.agents/skills/mobile-device-debugging/SKILL.md` 补一节「何时必须用 dev build + 出包/拉起命令」。
- **为什么是 P0**：Expo Go 不可用（`audioPlayer.ts:24,528` 的 `isExpoGo` 分支 + 插件不生效），没有与 release 共存的 dev build 就**无法验收任何后续期**。
- **验收判据（真机）**：`./gradlew assembleDebug` 出包 → 安装后 `adb shell pm list packages | grep mplayer` 同时出现 `com.mplayer.mobile` 与 `com.mplayer.mobile.dev`；两个包都能启动；dev 包走 `adb reverse tcp:8081` + dev-client 深链连上 Metro。
- **回滚点**：仅一个 gradle 文件的 4 行，revert 即回到 master 行为（不影响 release 变体，CI 只跑 release）。

### P1 —— 模块骨架 + 会话能起来
- **改动文件**：新增 `modules/native-player/{package.json,expo-module.config.json,android/build.gradle,android/src/main/AndroidManifest.xml}` + `PlayerService.kt`（仅 `onCreate` 建 ExoPlayer/Session + `onGetSession` + 默认 notification provider）+ `PlayerBridge.kt` + `PlayerModule.kt`（只有 `getState` 与 `registerHeadlessHost`）；删 app manifest 的 expo-audio service（`:23-27`）。
- **验收判据（真机）**：① `./gradlew :app:processDebugMainManifest` 输出的 merged manifest 里**只有一个** `foregroundServiceType="mediaPlayback"` 的 service（且是 `PlayerService`）；② dev build 启动后 `adb shell dumpsys media_session` 能看到 `MPlayerNativePlayer` 会话；③ **spike：拿到 `HeadlessJsTaskContext` 并成功起一次空 headless 任务**（§5.2 的校验点；失败则按 §5.2 降级并回写规格）。
- **回滚点**：P0。

### P2 —— 队列 + 原生推进（#405 主判据）
- **改动文件**：`QueueStore.kt`、`AdvancePolicy.kt`、`PlaybackController.kt`、`PlayerModule` 的 `loadQueue/patchQueue/play/pause/next/prev/getState`；JS 侧**临时**用固定测试直链（本地 `file://` 或长 TTL URL）验证。
- **验收判据（真机）**：后台（锁屏）连续自动推进 **≥ 5 首**不中断；`trackChanged` 在回前台后与 `getState()` 一致；不出现两首同播。
- **回滚点**：P1。

### P3 —— JS 换引擎（7 导出签名不变）
- **改动文件**：新增 `services/nativePlayer.ts`（桥封装 + 事件订阅 + 对账 + iOS 回落）、`services/nativeAudioEvents.ts`；改写 `services/audioPlayer.ts` 的「建/换源/锁屏/通知/listener」段（`≈450 行改写`，保留 290–430 行解析与失败处置）；`stores/playerStore.ts` 加 `setState`；`app/_layout.tsx` 的 `initAudio` 与通知监听收敛。
- **验收判据（真机）**：UI 播放/暂停/切歌/seek 与原生一致；进度条与歌词仍以 250ms 级刷新（§4.3）；`downloadService` 与 `songActionEffects`（换源续播）不回归；`playbackTrace` 不断链。
- **回滚点**：P2。

### P4 —— 窗口预取 + headless 补窗
- **改动文件**：`services/queuePrefetch.ts`（窗口 N + 三层去重 + 15s 提前触发，§5.5）、`modules/native-player` 的 headless 注册与 `PrefetchBridge.kt`（wakelock/超时/有界重试）。
- **验收判据（真机）**：后台跨曲边界**不需要回前台**即可继续（≥5 首连续，且日志显示 headless 任务起止）；断网时「在缓冲边界停下」而不是空转/崩；后台解析是否真的跑完（含 core 墙钟定时器是否触发——本规格新发现的风险，§12 R3）。
- **回滚点**：P3（退回「窗口即边界」的降级形态）。

### P5 —— 过期与失效处置
- **改动文件**：`ExpiryGuard.kt`、`ErrorPolicy.kt`、`PlaybackController` 的错误映射、`playbackError` 事件。
- **验收判据（真机）**：构造过期 URL（或短 TTL）→ 后台**自动跳过**且不卡死；陈旧守卫生效（重试前用户切歌则丢弃重试）；每曲 3 次上限后标记失败；403/410 与非过期错误走不同分支（日志可辨）。
- **回滚点**：P4。

### P6 —— 策略对齐（含随机语义定案）
- **改动文件**：`AdvancePolicy.kt` 接 `policy`；`PlayerModule.setPolicy`；JS 侧 `settingsStore.playMode/autoSkipOnError` → `policy` 的下发与热更新；随机定序（§7.3 的建议方案）。
- **验收判据（真机）**：后台验证四种情形的正确性——单曲循环 / 列表循环 / 随机（不重复当前、且锁屏 next 与 UI 一致）/ 队列播完收尾；`autoSkipOnError` 关时失败**不跳**；离线即停。
- **回滚点**：P5。
- **前置**：随机语义需先写 ADR 拍板（§7.3）。

### P7 —— 生命周期与恢复
- **改动文件**：`onTaskRemoved`（默认）/ `onTrimMemory` / 落盘与还原 / `onPlaybackResumption`；module 的 `restoreOnColdStart`。
- **验收判据（真机）**：① `adb shell am kill com.mplayer.mobile.dev` 杀进程后由通知/媒体区恢复会话不崩（`onPlaybackResumption` 返回非空）；② 划掉任务卡后仍在播（默认保活）；③ 恢复后不自动续播、URL 已过期时不静默失败；④ `dumpsys` 确认恢复后仍在 FGS。
- **回滚点**：P6。

### P8 —— 通知/锁屏打磨 + 清理 + 文档
- **改动文件**：小图标 drawable + `res/raw/keep.xml` + `consumerProguardFiles`；删 `services/notificationService.ts` 的通知体（保留 `requestNotificationPermission`，待定 §12 R10）与 `_layout.tsx:122-140`；`scripts/mobile-e2e.sh` 改造（`:37` 的 `EXP_PKG="host.exp.exponent"` → dev build 包名；`:348-356` 的 `exp://localhost` 冷启 → dev-client 深链/显式组件）；`app.json` 的 expo-audio plugin 注释或移除（§3.3）；新 ADR + `docs/adr/README.md` 索引 + `AGENTS.md:25,39` + `docs/agents/architecture.md:60` + `CONTEXT.md` 词条 + `docs/wayfinder/*` 的锁屏验收条款改写（共 6 处，清单见选型评估 §4.2）。
- **验收判据（真机 + release APK）**：锁屏上一首/下一首可用；封面/标题跟随；**release APK（R8 全开）** 上复跑 P2/P5/P7 的关键判据（R8 只在 release 生效）；`npm run mobile:e2e` 在 dev build 上跑通。
- **回滚点**：P7。

## 11. 验证计划

### 11.1 JS 单测面（vitest；`packages/mobile/__tests__/`）
| 动作 | 对象 | 说明 |
| --- | --- | --- |
| **换 mock 面** | `audioPlayer.test.ts`（938 行/42 例） | `:92-96` 的 `vi.mock('expo-audio')` 换成假的原生模块（可手动注入 `trackChanged/playbackError/needTracks` 事件）；`createAudioPlayer` 调用次数断言（`:283,345,625,653,676`）、`players[0].seekTo` spy（`:634`）、`setActiveForLockScreen` 用例全废。估算：保留 ~12-18 例、改写 ~20-24 例 |
| 新增 | `nativePlayer.test.ts` | 窗口管理、`patchQueue` 拒绝 stale、踩空语义、`getState()` 对账（+200~350 行） |
| 新增/改写 | `nativeQueue.test.ts` | 原生推进语义（不依赖事件/定时器）、队列耗尽、失败项移除（120~260 行） |
| **I6 守卫（PR #436 的不变量，必须保留）** | 新 `backgroundTrackAdvance.test.ts` | 原 4 条断言（PR #436 的实现：剥注释后断言 `services/audioPlayer.ts` 无 `setTimeout/setInterval`）在 C 下**语义升级**为：① 播放推进链路（`nativePlayer.ts` + `audioPlayer.ts` + `queuePrefetch.ts`）**不得用 `setTimeout/setInterval` 驱动推进**；② 推进必须是「原生事件/对账」或微任务；③ 反面断言：把 `setTimeout` 注入 mock 后，推进仍必须发生（证明不依赖定时器）。**注意 PR #436 的「微任务替代」在 C 下多半作废**（推进不再在 JS），但其不变量必须留下 |
| 删除/收缩 | `notificationService.test.ts`（2 例） | 通知下沉后原语义消失 |

- 不受影响：其余 **31 个测试文件**（`downloadService.test.ts` 只 mock `resolvePlayableUrlMobile`，只要该导出保留即绿）。运行方式不变（`vitest.config.ts:10-16`，`ci.yml:36`）。

### 11.2 原生：只能真机
原生行为（队列推进、踩空、FGS、通知、R8 keep）**无法被 vitest 覆盖**；必须用 **dev build**（`com.mplayer.mobile.dev`）与 **release APK**（R8 全开）在真机上验。

### 11.3 真机判据清单（≥8 条；每条都要能给出取证命令与结论）
| # | 前置 | 操作 | 判据（Pass） | 取证 |
| --- | --- | --- | --- | --- |
| T1 | dev build，队列 ≥6 首 | 播放 → 锁屏 → 不动 → 回前台 | **后台连播 ≥5 首**（无「播完即停」）；回前台 UI 立即对账到当前曲/位置、**不重复解析**、不两首同播 | `adb logcat` + `dumpsys media_session` |
| T2 | 同上 | 锁屏界面按下一首/上一首 | 切歌正确，元数据/封面跟随 | 截图 + logcat |
| T3 | 构造过期 URL（短 TTL 或手工改 URL） | 后台等该项播放 | **过期跳歌**：自动跳过并在 1s 内重试一次，不卡死；3 次后标记失败 | logcat（`playbackError{disposition}` + `reason:'errorSkip'`） |
| T4 | 播放中 | `adb shell am kill <pkg>` | 通知/媒体区可恢复会话**不崩**；恢复后不自动续播；URL 过期时不静默挂住 | logcat + `dumpsys media_session` |
| T5 | 播放中 | 断开网络（飞行模式） | **断网即停**（`pause`），不进解析链、不空转、不崩 | logcat |
| T6 | 播放中 | 展开通知/系统媒体区 | 标题/艺人/封面正确且随曲切换；只有**一条**媒体通知（无 JS 双通知） | 截图 + `dumpsys notification` |
| T7 | 后台播放中 | 划掉任务卡 | **仍继续播放**（默认保活），通知仍在 | logcat + 通知栏 |
| T8 | 队列只剩 1 首未播 | 等跨窗口边界 | 后台能补窗续播（headless 起止日志）；若补窗失败则在缓冲边界**暂停而非崩** | logcat（`MPlayerPrefetch` 起止 + `needTracks`） |
| T9 | 四种播放模式 | 后台各跑一段 | 单曲循环 / 列表循环 / 随机 / 队列播完收尾各自正确（随机不重复当前、锁屏 next 与 UI 一致） | logcat + 截图 |
| T10 | release APK（R8 + shrink） | 复跑 T1/T3/T6 | 全通过（证明 keep 规则足够）；小图标可见 | 截图 + APK 安装记录 |

## 12. 风险与未决

| # | 风险/未决 | 依据 | 处置 |
| --- | --- | --- | --- |
| R1 | **R8 把模块/服务反射项裁掉** | R8 只在 release 生效（`app/build.gradle:132-135`） | 包名落 `expo.modules.*` + 模块 `consumerProguardFiles` + **release APK 实测**（T10） |
| R2 | **OEM 杀进程（MIUI/EMUI/ColorOS）** | AOSP cached-freezer 十秒冻结；国产 ROM 无一手文档（平台调研 §5） | 保留/补齐「省电白名单引导」（Symfonium/AIMP/Salt Player 做法）；预取窗口让**网络尽量不在后台发生** |
| R3 | **headless 任务在后台能否跑完解析链（含墙钟定时器）** | `JavaTimerManager.kt:72-73` 证明 `onHostPause` 会停投定时器；但 `:125,142,291,323` 又证明**有活跃 headless 任务时定时器继续投递** → 机制上**支持**补窗跑完（core 的 3s/9s 墙钟也是定时器，#424）。残余不确定：① 经 `startTask` 起的任务是否计入 `hasActiveTasks()`；② expo-modules 的事件投递是否同样恢复（**不需要**——事件只作通知，I2） | **P4 判据**：在 headless 任务内让 core 墙钟打点，确认 3s/9s 墙真的触发、解析跑完；原生 12s 硬超时 + 显式 `finishTask` 兜底；若实测仍挂住 → 降级「窗口即边界」并回写 ADR；冷进程无 ReactContext 时只恢复队列、不补窗（R11 并入此条） |
| R4 | **窗口 N 取值** | 选型评估一页结论 §7 明确「未定」 | 初值 N=3（与 tier3 K=3 同量级）；由 T1/T8 的「后台连播成功率 vs 内存/带宽」在 P4 收敛 |
| R5 | **随机模式语义** | core 每次随机≠当前（`queue.ts:29-36`）vs media3 置换式 shuffle | §7.3 的建议（JS 定序、原生顺序推进）；**需 ADR 拍板**（P6 前置） |
| R6 | **iOS 回落** | `packages/mobile/ios` 未入库；`expo-module.config.json` 只声明 android | iOS 走 `requireOptionalNativeModule` 回落 expo-audio 老路径 → **iOS 继续保留 #405 的后台不切歌行为**（跨端不一致**显式接受**）；将来补 iOS 需另评估 `UIBackgroundModes` 与 Swift 400–900 行（推断） |
| R7 | **250ms 进度契约** | `components/PlayerOverlay.tsx:810-832` 按 250ms 订阅 `currentTime` | 方案：原生 `progress` 1s + 前台 JS 本地插值/推进；**若 UI 抖动不可接受**，改原生 250ms 上报（增加 JS 唤醒开销）→ P3 实测定 |
| R8 | **无过期信息的直链** | 多源里存在不声明过期的源 | 给保守上限（建议 30min，值待定）；0 表示不适用（本地文件） |
| R9 | **封面加载路径** | media3 默认 `BitmapLoader` 对 `http(s)` 的支持/缓存未实测 | P8 实测；不行再引入 Coil `BitmapLoader`（Metrolist 先例），或退化为「不显示封面」 |
| R10 | **媒体通知 vs expo-notifications 的取舍** | 现在 `notificationService.ts` 混着「通知权限 + 渠道 + 通知体 + 按钮」 | 通知体/按钮**必删**；`requestNotificationPermission`/`setupNotificationChannel` 保留（权限仍要申请）；**待定**：渠道是否换成新 id（§8.4 建议换） |
| R11 | **策略分叉（选型评估标注为「最该盯的一条」）** | core `skipGuard` 在 JS，原生必须自带最小兜底 | policy 下发 + 原生跳过一次 `playbackError{disposition:'skipped'}` + 进 `playbackTrace`，使两侧计数可对账 |

## 13. 工作量与文件清单

### 13.1 总量（引用选型评估第三部分 §四 的数字，并标注本规格增量）
| 面 | 评估数字 | 本规格 |
| --- | --- | --- |
| Kotlin 新增 | 750–1,050 行（+40 脚手架） | **1,060–1,520 行**（新增 `ErrorPolicy`/`ExpiryGuard`/`PrefetchBridge` 三块） |
| JS 新增（桥接 + 窗口） | +350–600 行 | 同量级（`nativePlayer.ts` 180–260 + `queuePrefetch.ts` 80–120 + 模块 types/index 60–90） |
| JS 改写 | `audioPlayer.ts` ≈450 行改写（保留 290–430） | 同 |
| 删除 | 91–116 行（notificationService 通知体） | 同 |
| 测试 | 换 mock 150–250 行 + 新增 200–350 行 | 另加 I6 守卫（§11.1） |
| APK / CI | dex 推断 +20–80 KB（media3 ~4.9 MB 本来在包里）；**CI 0 处改动** | 同（`ci.yml:61-67` / `release.yml:246-250` 不变） |

### 13.2 文件级清单
| 文件 | 动作 | 预估 | 期 |
| --- | --- | --- | --- |
| `packages/mobile/android/app/build.gradle` | 改写 | ±4（debug 的 `.dev` 后缀） | P0 |
| `.agents/skills/mobile-device-debugging/SKILL.md` | 改写 | +15~25 | P0 |
| `packages/mobile/modules/native-player/package.json` | 新增 | 10~20 | P1 |
| `packages/mobile/modules/native-player/expo-module.config.json` | 新增 | 8~15 | P1 |
| `.../native-player/android/build.gradle` | 新增 | 30~60 | P1 |
| `.../native-player/android/src/main/AndroidManifest.xml` | 新增 | 15~25 | P1 |
| `.../android/src/main/res/{values/strings.xml,drawable/ic_stat_mplayer.xml,raw/keep.xml}` | 新增 | 10~25 | P1/P8 |
| `.../java/expo/modules/mplayerplayer/PlayerService.kt` | 新增 | 220~280 | P1/P7 |
| `.../PlaybackController.kt` | 新增 | 160~220 | P2 |
| `.../QueueStore.kt` | 新增 | 110~160 | P2 |
| `.../AdvancePolicy.kt` | 新增 | 90~130 | P2/P6 |
| `.../ErrorPolicy.kt` / `ExpiryGuard.kt` | 新增 | 120~190 | P5 |
| `.../PrefetchBridge.kt` | 新增 | 100~150 | P4 |
| `.../PlayerModule.kt` | 新增 | 180~240 | P1–P6 |
| `.../PlayerBridge.kt` / `Events.kt` / `ErrorCodes.kt` | 新增 | 80~140 | P1 |
| `packages/mobile/modules/native-player/{index.ts,src/*.types.ts}` | 新增 | 60~90 | P1/P3 |
| `packages/mobile/services/nativePlayer.ts` | 新增 | 180~260 | P3 |
| `packages/mobile/services/nativeAudioEvents.ts` | 新增 | 60~140 | P3 |
| `packages/mobile/services/queuePrefetch.ts` | 新增（`prefetchNextSong` 26 行迁入） | 80~120 | P4 |
| `packages/mobile/services/audioPlayer.ts`（666 行） | 改写 | 改写 ≈450；保留 290~430 | P3 |
| `packages/mobile/stores/playerStore.ts`（85 行） | 改写 | +15~25（`setState` 对账入口） | P3 |
| `packages/mobile/app/_layout.tsx`（215 行） | 改写 | −20~−30（通知按钮监听收敛） | P3/P8 |
| `packages/mobile/services/notificationService.ts`（121 行） | 改写（净删） | −80~−100 | P8 |
| `.../app/src/main/AndroidManifest.xml`（42 行）+ `app/proguard-rules.pro`（21 行） | 改写 / 不改 | −5~−8（删 expo-audio service） / 0（靠 `expo.modules.*` keep，可选 +3~8） | P1 |
| `scripts/mobile-e2e.sh`（`:37,348-356`） | 改写 | ±15 | P8 |
| `packages/mobile/__tests__/{audioPlayer,nativePlayer,nativeQueue,backgroundTrackAdvance,notificationService}.test.ts` | 改写/新增/删除 | 见 §11.1 | P2–P8 |
| `docs/adr/<新>.md` + `docs/adr/README.md` 索引 | 新增 | 80~140 + 1 | P6（随机语义）/P8 |
| `AGENTS.md:25,39`、`docs/agents/architecture.md:60`、`CONTEXT.md`、`docs/wayfinder/*` | 改写 | 各 1~8 行 | P8 |

### 13.3 参考（外部一手，均为规格内已引用结论的来源）
- Media3：[MediaSessionService](https://developer.android.com/reference/androidx/media3/session/MediaSessionService)（单一 service 建议 / `onTaskRemoved` 语义 / `setMediaNotificationProvider`）· [Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback) · [MediaSession.Callback](https://developer.android.com/reference/androidx/media3/session/MediaSession.Callback)（`onPlaybackResumption`）· [DefaultMediaNotificationProvider](https://developer.android.com/reference/androidx/media3/session/DefaultMediaNotificationProvider)
- Android：[Foreground service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout)（不含 mediaPlayback）· [FGS service types](https://developer.android.com/develop/background-work/services/fgs/service-types) · [Media controls（5 槽/compact 3 槽）](https://developer.android.com/media/implement/surfaces/mobile) · [Cached apps freezer](https://source.android.com/docs/core/perf/cached-apps-freezer) · [Media controls in System UI (AOSP)](https://source.android.com/docs/core/display/media-control)
- Expo：[Autolinking](https://docs.expo.dev/modules/autolinking/)（`nativeModulesDir=./modules`）· [Get started（已有原生目录则跳过 prebuild）](https://docs.expo.dev/modules/get-started/) · [Module API](https://docs.expo.dev/modules/module-api.md) · [expo-module.config.json](https://docs.expo.dev/modules/module-config.md)
- 结构范本（commit-pinned，见 OSS 调研 §参考）：NewPipe `MediaSourceManager.java`（WINDOW_SIZE=1 / 30s / 2s / 400ms debounce）· Metrolist `MusicService.kt`（`onPlayerError` 分级、`StreamUrlCache` TTL+generation）· SimpMusic `Media3ServiceModule.kt`（`subrange` 每 chunk 重入、`onTrimMemory` 落盘）· AntennaPod `MediaLibrarySessionCallback.java:359-401`（`onPlaybackResumption` 必须返回非空）· RNTP V5 `EventBroker.kt`（in-process headless + wakelock + `TASK_TIMEOUT_MS=5000`）
