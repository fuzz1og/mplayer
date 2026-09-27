# 移动端原生播放层选型评估（B RNTP / C 自写 Kotlin 模块 / C′ fork expo-audio）

> 评估日期：2026-09-28 · 类型：评估（三个并行 subagent 独立取证后合并） · 关联：**#405**（本评估服务的票）、PR #433（并行会话的 JS 侧方案）、PR #435（dev build 的 .dev 包名后缀，仍未合并）、PR #436（微任务加固）、`docs/research/2026-09-27-android-background-playback.md`（平台机制调研）
>
> **口径**：回答「要让移动端做到后台连续播，B/C 两条路各要改多少、代价是什么」。仓库结论带 file:line，外部结论带一手链接。
> **前提**：#405 的根因已定位为「后台 JS 跑不了 + 曲末推进在 JS」（证据见 #405 评论：后台 45s 状态事件零投递、同段时间网络回调仍活、FGS 正常、回前台立刻补跑）→ **正解必须让原生持队列并原生推进**，因此本评估只比较「由谁来持」。
> **结构**：一页结论 + 三部分（仓库改动面清点 / B RNTP / C 自写 Kotlin 模块），各自带 TL;DR 与参考小节。

## 一页结论（决策相关）

1. **变更面很小**：唯一 import expo-audio 的生产文件是 `services/audioPlayer.ts`（654 行，与 expo-audio 直接耦合仅 **35 行**），接缝是 **7 个导出函数**，**18 个消费方**签名不变即不用动 → 两条路都是「只换引擎」。
2. **B（RNTP）建议排除**：V4 在本栈**不可用**（新架构下原生→JS 事件全丢 #2593、RN 0.83+/Expo 55 启动即崩 #2603、Kotlin 2.1.x 编译失败且修复 PR #2535 未合并）；V5（`@rntp/player` 5.9.2）技术可行（#2670 有同栈生产用户）但**商业许可**（仅私人个人/教育免费，营利/非营利/政府需 €999–2,499/年起，禁止再分发与白标）、**部分闭源**（npm 5.8.0+ 的 gitHead 在公开仓库 422）、公开 release 停更在 v5.7.0。
3. **C（自写 Kotlin 模块）**：Kotlin **750–1,050 行**（+40 脚手架）+ JS **350–600 行**；**基础设施成本经实测 ≈0**——模块放 `packages/mobile/modules/native-player/` 即被 autolinking 收（`settings.gradle:32` 已有 `useExpoModules()`，app 的 package.json 都不用加依赖），service/权限写模块自己的库 manifest 走 merger，**CI 0 处改动**；APK 增量 dex +20–80 KB（推断；media3 那 ~4.9 MB 本来就在包里）。
4. **C′（fork/patch expo-audio）**：Kotlin **~150–300 行**（patch）+ JS **~250–400 行**；锁屏/FGS/媒体通知/封面**原样保留**（锁屏绑定是**播放器实例级**：`AudioPlayer.kt:100-124` → `service.setPlayerOptions(this, …)`，与媒体源条数无关）；代价是每次 expo-audio/SDK 升级要**重放 patch**。
5. **三条不随选型改变的硬约束**：① **事件只能当通知、不能当驱动**（`SharedObject.kt:66-68`、`KModuleEventEmitterWrapper.kt:47-49` 在 JS 对象丢失时静默 return）→ 原生推进零依赖事件 + 回前台 `getState()` 对账；② **一个 app 只能有一个 `MediaSessionService`**（media3 官方）→ 必须停用 expo-audio 的 `AudioControlsService`；③ **必须预解析 N 首窗口**（后台既收不到事件也发不出请求）。
6. **验收环境**：Expo Go 不可用 → 需先合并 **PR #435**（`.dev` 后缀）才能出与正式包共存的 dev build；`scripts/mobile-e2e.sh:37,348-356` 写死了 Expo Go 路径，需改。
7. **未定**：预解析窗口 **N 的取值**；**随机模式语义**（core `getNextSongIndex` 是「每次随机≠当前」，media3 shuffle 是置换且不外露顺序）。
8. **推荐**：不接受在仓库维护 fork/patch → **C**；追求最小改动且接受 patch → **C′**。B 只在「愿意付许可费且接受部分闭源」时才选。

| 维度 | B RNTP V5 | C 自写模块 | C′ fork expo-audio |
|---|---|---|---|
| Kotlin | 0（引入 media3-cast/mediarouter 1.7.0 + kotlinx-serialization，与 expo-audio 的 media3 1.9.0 存在版本线冲突面） | 750–1,050 | ~150–300（patch） |
| JS 改写 | ~900–1,400（测试重写 ~1,000 行） | +350–600 | +250–400 |
| 接线/CI/Manifest | merger 自带 service；手工 4 处；CI 不变 | **≈0**（实测） | 加 patch 机制 |
| 许可/治理 | **商业许可 + 部分闭源 + 停更** | 无 | 无（自持 patch） |
| 保留锁屏/通知/封面 | 自带（它的实现） | 自己实现 | **原样保留** |
| APK | 推断 +0.6–1.5 MB/ABI | 推断 dex +20–80 KB | 更小 |

---

## 第一部分 · 仓库改动面清点（两条路共同的事实基础）


范围：仅清点 `D:\Playground\mplayer`（master `d4897fe`）的**仓库改动面**——哪些文件、哪些行、动多少。
本文件不评价两条路线的优劣（那是 B/C 评估正文的事），只给「要动哪些文件」的可核对事实。
所有行号均来自 master 工作副本实测；未落地的推断一律标注「（不确定/推断）」。

## TL;DR（≤8 条）

1. 业务代码里**直接 import `expo-audio` 的文件只有 1 个**：`packages/mobile/services/audioPlayer.ts`（654 行），其中与 expo-audio 直接交互的行只有 **41~44 行（6%~7%）**，但语义绑定的代码块有 **159 行（24%）**；另有 **17 个文件**经它的导出面间接依赖。
2. **必须保留的 JS 播放链共 9 块 ≈ 1,860 行**（解析 2 处、缓存 3 文件、失败处置 2 处、队列 85 行、下载 349 行、通知动作 19 行、换源 23 行、诊断 1 处），B/C 两条路线都不能改这些语义。
3. `prefetchPlayableSong` 在移动端**调用点 0 个**（全库仅桌面 4 处 + core 定义 1 处）——移动端预取走的是自己的 12h `songResourcesCache`，这一点必须先纠正。
4. 路线 B 在**本栈（RN 0.86.2 + newArch）上实际只有 V5 可选**：npm `@rntp/player@5.9.2`，**商业许可 €99/月起**；V4 `4.1.2` 不支持新架构、RN ≥0.80 构建失败（官方 issue #2443 / #2540）。
5. 路线 B 改动面：**新增 255~520 行 / 3 个新文件，删除 81~106 行，改写 716~1,198 行**；其中 `__tests__/audioPlayer.test.ts`（938 行 / 42 例）要重写 400~650 行。
6. 路线 C 改动面：**Kotlin 新增 500~1,400 行**（锚定 expo-audio 自带 Android playback 子集 1,627 行 × 45%~85%）、**JS 桥接新增 420~870 行**、删除 91~116 行、改写 734~1,254 行。
7. 两条路线共同必改的 committed 原生文件是 **3 个**：`AndroidManifest.xml`（删 expo-audio 的 `AudioControlsService`）、`proguard-rules.pro`（R8 keep）、`app.json`（删 expo-audio plugin）；C 另加模块自带 `android/build.gradle`。
8. 测试面：**必须改写的现有测试 2 个**（`audioPlayer.test.ts` 42 例、`notificationService.test.ts` 2 例）、**新增 1~2 个**（120~260 行），其余 **31 个测试文件不受影响**；文档需同步 **6 处**。

---

## 1. 所有依赖 expo-audio 的地方（file:line）

### 1.1 唯一的直接导入点

| 位置 | 内容 |
|---|---|
| `packages/mobile/services/audioPlayer.ts:1` | `import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'` |
| `.../audioPlayer.ts:2` | `import type { AudioStatus } from 'expo-audio'` |
| `.../audioPlayer.ts:3` | `import type { EventSubscription } from 'expo-modules-core'` |
| `packages/mobile/package.json:20` | `"expo-audio": "~57.0.4"`（实测安装 `node_modules/expo-audio/package.json` version = **57.0.4**） |

除测试 mock 外，`packages/mobile` 内**没有第二个文件 import expo-audio**（`grep -r "expo-audio" packages/mobile` 命中 10 处：本文件 6 处、测试 4 处）。

### 1.2 播放器创建 / 复用 / 释放

| 位置 | 职责 |
|---|---|
| `audioPlayer.ts:17` | `type Player = ReturnType<typeof createAudioPlayer>`（全局只有一个播放器类型） |
| `audioPlayer.ts:27` | `livePlayers = new Set<Player>()`——追踪历史实例，因为**expo-audio 的原生 `remove()` 是异步的**，`remove()` 后旧实例可能仍在出声 |
| `audioPlayer.ts:28-29` | `player` 单例 + `playerStatusSubscription`（listener 只挂一次） |
| `audioPlayer.ts:89-98` | `stopAllPlayers()`：`await p.pause()` → `p.remove()` → `player = null` → `subscription.remove()` |
| `audioPlayer.ts:510` | `const source = { uri: audioUrl, headers: playerHeaders }`（UA + 按源 Referer，见 `:499-505`） |
| `audioPlayer.ts:511-517` | `player.replace(source)`（复用单实例）否则 `createAudioPlayer(source, { updateInterval: 250 })` |
| `audioPlayer.ts:538` | `player.play()` |
| `audioPlayer.ts:645-649` | `seekTo()` → `await player.seekTo(timeSec)` |
| `audioPlayer.ts:651-654` | `cleanup()` → `stopAllPlayers()` + `clearNotification()` |

### 1.3 状态事件与去重标志

| 位置 | 职责 |
|---|---|
| `audioPlayer.ts:104-105` | `attachPlaybackListener(p)` → `p.addListener('playbackStatusUpdate', (status: AudioStatus) => …)`（唯一状态入口） |
| `audioPlayer.ts:107` | playId 守卫：`if (!ctx \|\| ctx.playId !== currentPlayId) return`（丢弃过期事件） |
| `audioPlayer.ts:67` | `playbackCtx`（song/playId/t0/fresh/retryCount，事件里读 ctx 而非闭包） |
| `audioPlayer.ts:69-71` | 三个 per-player 去重标志：`playbackFinished` / `playbackFailed` / `playbackReadyLogged` |
| `audioPlayer.ts:111-136` | `!status.isLoaded` + `status.error` 分支：加载失败去重 → 清缓存 + fresh 重试（`:119-128`）或终局处置（`:133`） |
| `audioPlayer.ts:139-147` | 就绪（出声）归零：`resetFailureStreak()` + `[耗时] 播放器就绪(出声)` 日志（注释明确「不能放在 `player.play()` 后，因为 expo-audio 的加载错误是异步事件」） |
| `audioPlayer.ts:149-157` | store 同步：`status.playing` → `resume()/pause()`（`!status.didJustFinish` 才 pause）；`setCurrentTime(status.currentTime)`、`setDuration(status.duration)` |
| `audioPlayer.ts:159-170` | 曲末：`status.didJustFinish` → `store.next()` → `setTimeout(() => playSong(next, 0, false), 0)`；队列耗尽 → `stopAllPlayers()+pause()` |

> 250ms 心跳（`updateInterval: 250`）是 UI 的隐含契约：`components/PlayerOverlay.tsx:810-832` 的进度条与 `:775` 的歌词高亮都按这个节奏订阅 `currentTime`。任何替换方案都必须保住这个上报频率。

### 1.4 锁屏 / 媒体会话

| 位置 | 职责 |
|---|---|
| `audioPlayer.ts:518-525` | `setActiveForLockScreen(true, { title, artist, albumTitle, artworkUrl })`，由 `if (!isExpoGo)` 守卫 |
| `audioPlayer.ts:528-537` | `player.updateLockScreenMetadata({...})`（`replace` 换源后同步标题） |
| `audioPlayer.ts:23` | `isExpoGo = Constants.appOwnership === AppOwnership.Expo`（唯一判定口径，注释记了 #93 的判定坑） |
| `audioPlayer.ts:76-77` | 后台播放开关：`shouldPlayInBackground: true` |
| 原生侧（node_modules，版本 57.0.4） | `node_modules/expo-audio/android/.../AudioModule.kt:510,516,522`——`setActiveForLockScreen` / `updateLockScreenMetadata` / `clearLockScreenControls` 的接收者类型是 `AudioPlayer`；`AudioPlayer.kt:100-124` 才会 `serviceConnection.bindWithService()` |
| 原生侧 | `.../service/AudioMediaSessionCallback.kt:27-31` **主动删除** prev/next 命令（`remove(COMMAND_SEEK_TO_NEXT…)`）→ 系统媒体面板/通知栏没有上一首/下一首 |

### 1.5 通知（JS 侧 expo-notifications，与 expo-audio 原生媒体通知**并存**）

| 位置 | 职责 |
|---|---|
| `services/notificationService.ts:6-8` | `CHANNEL_ID='music-playback'` / `NOTIFICATION_ID` / `CATEGORY_ID` |
| `services/notificationService.ts:14-33` | `isExpoGo` 守卫 + `require('expo-notifications')` 懒加载 + handler |
| `services/notificationService.ts:51-81` | channel（IMPORTANCE.HIGH）+ 三个动作按钮 `prev / play-pause / next` |
| `services/notificationService.ts:93-121` | `updateNotification(song, isPlaying)` / `clearNotification()` |
| `audioPlayer.ts:552` | 播放成功 → `updateNotification(song, true)` |
| `audioPlayer.ts:633,640` | 暂停/继续 → `updateNotification(song,false/true)` |
| `audioPlayer.ts:653` | `cleanup()` → `clearNotification()` |
| `app/_layout.tsx:7,115-116` | 启动请求权限 + 建 channel |
| `app/_layout.tsx:122-140` | 通知动作路由：`play-pause → togglePlay()`、`next → store.next()+playSong()`、`prev → store.prev()+playSong()`、点正文 → 打开播放器 |

> **双通知事实**：非 Expo Go 下同时存在 expo-audio 的原生媒体通知（`setActiveForLockScreen`）与上面这条 JS 通知（`docs/research/2026-09-27-android-background-playback.md:420` 同结论）。B/C 两条路线都会重构这一层。

### 1.6 试听版标记 / 错误处理（事件驱动，标签在 JS store）

| 位置 | 职责 |
|---|---|
| `audioPlayer.ts:203` | 加载失败 → `setTag(song, 'invalid')`（离线/本地源跳过） |
| `audioPlayer.ts:474-480` | `playbackNonFull` → `setTag(song,'preview')` + `setNotice('info','当前为试听版，可换源获取完整版')` |
| `audioPlayer.ts:542-550` | 缓存写入保留 `nonFull`；非试听 → `setTag(song,'valid')` |
| `stores/audioTagStore.ts:23-37` | 标签 store（上限 2000，`tagKey` = core `identityKey`）；`components/SongRow.tsx:69` 消费徽标 |
| `audioPlayer.ts:557-613` | `playSong` 的 catch：`ResolutionChainError` 归一 → core `explainPlaybackFailure`（`:572`）与缓存回查捷径（`:584-596`）→ 终局处置 |

### 1.7 间接依赖（只读 `playerStore`，字段由 expo-audio 事件填充）

`components/PlayerBar.tsx:7,20,24,95,111`（togglePlay/next/prev/preparing）、`components/PlayerOverlay.tsx:16,72-73,775,810-832`（seekTo / currentTime / duration / isPlaying）、`components/QueueListModal.tsx:77`、`services/downloadService.ts:22`（只借用 `resolvePlayableUrlMobile`）、`services/songActionEffects.ts:8`、`app/{favorites,history,hotlist,album/[id],artist/[id],discover-playlist/[id],(tabs)/download,(tabs)/recommend}.tsx`、`components/{SongRow,PlaylistHero,DiscoverTabs}.tsx`——**全部只依赖 `audioPlayer.ts` 的导出面**（`playSong/togglePlay/seekTo/fetchLrcInBackground/resolvePlayableUrlMobile/initAudio/cleanup`），这是两条路线可以«只换实现、不动 UI»的前提。

### 1.8 committed 原生工程（CNG 反向，必须手改而不是 prebuild 生成）

| 位置 | 内容 |
|---|---|
| `packages/mobile/android/app/src/main/AndroidManifest.xml:2-3` | `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK` 权限 |
| `.../AndroidManifest.xml:23-27` | `<service android:name="expo.modules.audio.service.AudioControlsService" foregroundServiceType="mediaPlayback">` + `androidx.media3.session.MediaSessionService` intent-filter |
| `packages/mobile/app.json:26-33` | `plugins: [["expo-audio", { "enableBackgroundPlayback": true }]]` |
| `packages/mobile/android/app/proguard-rules.pro:15` | `-keep class expo.modules.** { *; }`（R8 + shrinkResources 已开，见 `app/build.gradle:132-135`） |
| `packages/mobile/android/app/build.gradle:9,99-100` | 版本号从 `app.json` 读（**prebuild 会覆盖这个自定义**，所以「跑一次 prebuild 让 CNG 生成」是不可接受的选项） |
| `packages/mobile/android/settings.gradle:20-23,32,36` | `expo-autolinking-settings` + `expoAutolinking.useExpoModules()` + `useExpoVersionCatalog()`（新增 Expo Module 的接入口就在这里，不需要改文件） |

---

## 2. 必须保留的 JS 播放链（file:line + 职责）

| # | 链路 | 位置 | 一句话职责 |
|---|---|---|---|
| 1 | 路由解析（唯一入口） | `audioPlayer.ts:331-338` → core `packages/core/src/shared/sourceRouter.ts:851` | `resolvePlayableUrlMobile`：直连 → tier3 兜底，返回 `{url,lrc,nonFull}`；下游 `downloadService.ts:22,208` 也靠它 |
| 2 | fresh 重解析 | `audioPlayer.ts:248-254` | `refreshPlayableUrl`：同曲换全新 URL（`resolvePlayableSongRouted`），失败上抛给 `playSong` |
| 2b | core 预取门面 | core `packages/core/src/api/musicApi.ts:540`；桌面 `src/main/ipc/musicApiHandlers.ts:37`、`src/renderer/store/playerStore.ts:208,236` | **移动端零调用**（`CONTEXT.md:80` 明确「移动端不写这一份」）→ 移动端预取是 #3 |
| 3 | URL 缓存（语义层） | `services/cacheService.ts:24,62-87,90-93`；`cache/fileBackend.ts` | `songResources` 12h TTL 的 `get/set/deleteCachedResource` + `urlAgeMs`；身份键来自 core `identityKey` |
| 4 | 播放前探活 | `audioPlayer.ts:436-448`（core `isUrlAlive`） | 「高龄缓存」先探活（<10min 免探活，`:50`），死链删除重解析而不是交给播放器死等 |
| 5 | 预取下一首 | `audioPlayer.ts:350-375`（触发点 `:554`） | `prefetchNextSong`：按播放模式取下一首 → 解析 → 写缓存（>5min 才重解析，`:53`）；**这就是将来要给原生队列预解析 N 首的挂点** |
| 6 | 失败处置（core 单一决策） | `audioPlayer.ts:193-236`（终局）+ `:557-613`（catch）；core `packages/core/src/shared/skipGuard.ts:23,26,57,87,97,101,117` | 离线即停（`OFFLINE_COPY`）→ 同曲 fresh 一次 → 固定上限 **3 首** → 坏歌会话内记忆（跳歌跳过）→「失败即跳」偏好（`settingsStore.ts:37,60`）→ 文案取 `decision.copy` |
| 7 | 离线判定 | `services/networkState.ts:14-21` | NetInfo 明确否定态才算离线；注入 core 零 I/O 的 skipGuard |
| 8 | 试听版标记 | `audioPlayer.ts:474-480,542-550` + `stores/audioTagStore.ts` | `nonFull` 全链不得被收窄成 string（ADR-0012）（`cacheService.ts:58-75` 的 normalize 也要保留） |
| 9 | 播放模式与队列 | `stores/playerStore.ts:42-84` + `settingsStore.ts:18-24,53` + core `packages/core/src/utils/queue.ts:8` | `getNextSongIndex(queue, currentIndex, playMode)` 是四模式（单曲/列表/随机）的唯一实现，`next()/prev()/setQueue()` 被 20+ 处 UI 调用 |
| 10 | 本地文件/下载播放 | `downloadService.ts:22,208,335-337`；`app/(tabs)/download.tsx:60`；`audioPlayer.ts:119,201,394,578` | `file://` 直连播放（不走解析链）、下载复用解析链 → **`resolvePlayableUrlMobile` 导出契约不能破** |
| 11 | 通知动作 | `app/_layout.tsx:122-140` | 三个动作的 JS 回调（后台 JS 冻结即失效——B/C 都要把这一层下沉到原生） |
| 12 | 换源续播 | `services/songActionEffects.ts:23-45` | 换源成功 → `setQueue` + `playSong(swapped)` |
| 13 | 解析链诊断 | `services/playbackTrace.ts` + `app/_layout.tsx:11,28` | 注册 core `setPlaybackTraceSink`；播放链重构后 trace 不能断 |

---

## 3. 两张文件级改动表

### 3.0 估算方法（先说清口径）

1. **基线行数 = master 实测**：`(Get-Content <file>).Count` / `read.totalLines`，本文所有「现状」列都是实测值，不引用分支或历史版本。
2. **`audioPlayer.ts` 的 expo-audio 绑定面**用两个口径夹逼：
   - 口径 A（词法）：正则并集 `createAudioPlayer|setAudioModeAsync|AudioStatus|EventSubscription|\bplayer\b|\bPlayer\b|livePlayers|playerStatusSubscription|status\.` 命中 **44 行**，剔除 3 行纯日志/注释误报 → **41 行（6.3%）**；
   - 口径 B（语义块）：listener 体 `104-172`（69 行）+ 创建/锁屏 `509-538`（30 行）+ 传输控制 `616-649`（34 行）+ 初始化/清理 `73-98`（26 行）= **159 行（24.3%）**。
   - **取口径 B 作为重写量基准**（口径 A 只是确定「哪些行会被删掉」），因为调用 `player.play()` 的那一行背后是整套状态机。改写量按 159 行的 **1.3~2.0 倍**给区间（换 API 后通常要多写适配/事件映射，不会更少）。→ **`audioPlayer.ts` 改写 200~320 行，保留 330~450 行**。
3. **新增 Kotlin 的规模用 expo-audio 自带 Android 实现做锚**（实测，`node_modules/expo-audio/android/src/main/java/expo/modules/audio/`）：
   - 全模块 Kotlin **4,020 行**（含录音 844 行、流 214、preload 55、模块注册 `AudioModule.kt` 952）；
   - **播放子集 1,627 行** = `AudioPlayer.kt` 292 + `BaseAudioPlayer.kt` 167 + `AudioPlaylist.kt` 205 + `service/*` 963（`AudioControlsService.kt` 564 + `AudioPlaybackServiceConnection.kt` 103 + `BaseServiceConnection.kt` 141 + `MetadataInjectingPlayer.kt` 93 + `AudioMediaSessionCallback.kt` 62）。
   - 我们只需要**单播放器 + 原生队列 + 一个 MediaSessionService + 通知 + MediaItem 映射**（不要录音/流/preload/多实例注册）→ 取播放子集的 **45%~85% = 730~1,380 行**；与逐文件自下而上加总（480~1,050，见 3.2）的并集 → **500~1,400 行**。
4. **JS 桥接层**按「导出面 + 事件面」估：每个 `Function/AsyncFunction` 5~10 行、每个事件订阅 15~25 行，模块 API 约 12~18 个方法 + 4~6 个事件。
5. **测试改写量**按「mock 骨架重写 + 断言替换」估，不按整文件行数。
6. 一律给**区间**不给单点；区间宽窄反映的是实现风格差异（是否抽适配层、是否复刻 expo-audio 的宽松语义），不是精度不足的托词。

### 3.1 路线 B（换 react-native-track-player）

**先决事实（决定这张表能不能落地）**

| 事实 | 依据 |
|---|---|
| V4 = `react-native-track-player@4.1.2`（npm latest，Apache-2.0），**不支持新架构**——维护者原话「new arch will eventually be supported, but currently is not」 | https://github.com/doublesymmetry/react-native-track-player/issues/2443 |
| V4 `4.1.2` 在 RN ≥0.80（含 0.82+）Android 构建失败，需 patch-package；社区结论「4.1.2 is dead and won't be maintained AT ALL」 | https://github.com/doublesymmetry/react-native-track-player/issues/2540 |
| V5 = `@rntp/player`（npm latest **5.9.2**），要求 RN ≥0.74 + 新架构，**商业许可**（个人/教育免费，商用 €99/月起；白标/平台另议） | 官方 README：https://github.com/doublesymmetry/react-native-track-player ；定价：https://rntp.dev/pricing |
| RNTP 的原生播放服务「即使 App 在后台也继续运行」，remote events 应在 playback service 里处理 | https://rntp.dev/docs/basics/playback-service |
| Expo 接入需要一个**自定义 entry point**（改 `package.json` 的 `main`），Expo Go 不支持 | https://doublesymmetry.github.io/react-native-track-player/docs/next/guides/with-expo |
| V5 的 aar 自带 `AndroidManifest.xml`（`TrackPlayerPlaybackService` + `foregroundServiceType="mediaPlayback"` + `WAKE_LOCK`/`FOREGROUND_SERVICE*` 权限）→ manifest 靠 merger 合入，**不需要手写 service** | `unpkg.com/@rntp/player@5.9.2/android/src/main/AndroidManifest.xml`（实测拉取） |

**改动表**

| 文件 | 现状 | 动作 | 预估 LOC | 依据/说明 |
|---|---|---|---|---|
| `packages/mobile/package.json` | 49 | 改写 | ±3（`main` 由 `expo-router/entry` 改指向新 entry；`+@rntp/player`） | Expo 指南要求自定义 entry |
| `packages/mobile/index.js` | — | **新增** | 15~30 | `registerRootComponent`/`import 'expo-router/entry'` + `registerPlaybackService` |
| `packages/mobile/services/playbackService.ts` | — | **新增** | 40~90 | remote events（play/pause/next/prev/seek）+ 队列状态回调 |
| `packages/mobile/services/audioPlayer.ts` | 654 | **改写** | 改写 200~320；保留 330~450 | 口径 B 的 159 行 × 1.3~2.0；`livePlayers/stopAllPlayers/attachPlaybackListener/锁屏块` 删除或换实现 |
| `packages/mobile/services/notificationService.ts` | 121 | **改写（净删）** | 删 70~90；留 30~50（`requestNotificationPermission`） | 通知改由 RNTP 的 MediaStyle 提供（含 prev/next）+ `strings.xml` channel 名 |
| `packages/mobile/app/_layout.tsx` | 215 | 改写 | 30~60 | `initAudio`→`setupPlayer`；`:122-140` 的 prev/next 交给原生，点正文仍开播放器 |
| `packages/mobile/stores/playerStore.ts` | 85 | 改写 | +40~90 | 队列所有权二选一（Zustand 主导 → 同步进 RNTP；或 RNTP 主导 → store 镜像），需新增 sync 动作 |
| `packages/mobile/services/cacheService.ts` | 93 | 保留 | 0 | 解析侧不变 |
| `packages/mobile/services/songResources.ts` | 51 | 保留 | 0 | — |
| `packages/mobile/services/downloadService.ts` | 349 | 保留 | 0 | 只要 `resolvePlayableUrlMobile` 导出还在 |
| `packages/mobile/services/networkState.ts` | 21 | 保留 | 0 | — |
| `packages/mobile/components/{PlayerBar,PlayerOverlay,QueueListModal,SongRow}.tsx` | 1,726 | 保留 | 0 | 只依赖 `audioPlayer.ts` 导出面与 store 字段 |
| `packages/mobile/app/**`（20 个页面） | — | 保留 | 0 | 同上 |
| `packages/mobile/app.json` | 53 | 改写 | −6~−8（删 expo-audio plugin） | 否则 FGS 服务与 RNTP 服务并存 |
| `packages/mobile/android/app/src/main/AndroidManifest.xml` | 42 | 改写 | −5~−8（删 `AudioControlsService` 块） | RNTP 的 service 由 library manifest merge 进来 |
| `packages/mobile/android/app/src/main/res/values/strings.xml` | 5 行 | 改写 | +3~6 | `playback_channel_name`（官方文档给的自定义方式） |
| `packages/mobile/android/app/proguard-rules.pro` | 21 | 改写 | +3~8 | R8+shrinkResources 已开（`app/build.gradle:132-135`）；RNTP 是否自带 consumer rules**未核实**（不确定） |
| `packages/mobile/android/app/build.gradle` | 198 | 保留 | 0 | 版本注入/签名逻辑不动 |
| `packages/mobile/android/settings.gradle` | 39 | 保留 | 0 | RN 依赖 autolink 走 `ReactSettingsExtension` |
| `packages/mobile/__tests__/audioPlayer.test.ts` | 938 / 42 例 | 改写 | 400~650 改写，另删 100~200 | mock 目标由 `expo-audio`（`:92-96`）换成 RNTP；`createAudioPlayer×N`/`players[]`/`seekSpy` 类断言全废 |
| `packages/mobile/__tests__/notificationService.test.ts` | 64 / 2 例 | 删除或改写 | −40~−64 | 语义整体转移 |
| `packages/mobile/__tests__/nativeQueue.test.ts`（新） | — | **新增** | 120~260 | 原生队列推进/预解析 N 首入队/队列耗尽 |
| `docs/adr/<新>.md` + `docs/adr/README.md` 索引行 | — | **新增** | 80~140 + 1 | 换播放内核是架构决策（四节必填，见 `docs/adr/README.md:58-63`） |

**总计（B）**：新增 **255~520 行 / 3 个新文件（+1 ADR）**；删除 **81~106 行**（notificationService 70~90 + app.json 6~8 + manifest 5~8）；改写 **716~1,198 行**（audioPlayer 200~320 + _layout 30~60 + playerStore 40~90 + audioPlayer.test 400~650 + notificationService.test 40~64 + proguard 3~8 + strings 3~6）。

### 3.2 路线 C（自写 Kotlin Expo Module）

**先决事实**

| 事实 | 依据 |
|---|---|
| 本地模块脚手架 = `npx create-expo-module@latest --local`，产物 `modules/<name>/{android,ios,src,expo-module.config.json,index.ts}` | https://docs.expo.dev/modules/get-started/ |
| 原生导出面 = `Function`/`AsyncFunction`/`Property`/`Events` DSL；事件、Promise、常量都有标准写法 | https://docs.expo.dev/modules/module-api/ |
| autolinking 默认扫描 `<appRoot>/modules`（不需要改 `settings.gradle`） | 实测 `node_modules/expo-modules-autolinking/build/commands/autolinkingOptions.js:172`（`nativeModulesDir` 默认 `'./modules'`） |
| 现有 Media3 版本锚点 = **1.9.0**，且 `media3-datasource-okhttp` 是「带自定义 headers 的音频请求」的关键依赖 | `node_modules/expo-audio/android/build.gradle:29-37` |
| R8 规则目前只 keep `expo.modules.**` → **自写模块（不在 `expo.modules` 包下）必须补 keep** | `packages/mobile/android/app/proguard-rules.pro:15` |
| **不要跑 `npx expo prebuild`**：`app/build.gradle:9,99-100` 的「从 app.json 读版本」和 `:113-121` 的签名回退是手写自定义，prebuild 会覆盖 | 上表 1.8 |

#### C-1 Kotlin 原生侧（新目录 `packages/mobile/modules/mplayer-audio/`）

| 文件 | 动作 | 预估 LOC | 职责 |
|---|---|---|---|
| `expo-module.config.json` | 新增 | 8~15 | 声明 android 平台 + 模块类名 |
| `android/build.gradle` | 新增 | 30~60 | `com.android.library` + `expo-module-gradle-plugin` + media3 1.9.0（session/exoplayer/datasource-okhttp） |
| `android/src/main/AndroidManifest.xml` | 新增 | 10~20 | `<service foregroundServiceType="mediaPlayback">` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` + `WAKE_LOCK` |
| `android/src/main/java/com/mplayer/audio/MPlayerAudioModule.kt` | 新增 | 180~320 | Module DSL：`setQueue/addToQueue/play/pause/seekTo/setQueueMode/skipNext/skipPrevious/setNowPlaying/setPlaybackRate` + `Events("onTrackChanged","onPlaybackState","onProgress","onQueueEnded","onError")` |
| `.../MPlayerPlaybackService.kt` | 新增 | 150~320 | `MediaSessionService` + `MediaSession` + MediaStyle 通知（prev/play-pause/next/±10s seek）+ `startForeground(MEDIA_PLAYBACK)`。对照参考：expo-audio 的 `AudioControlsService.kt` **564 行** |
| `.../MPlayerQueue.kt` | 新增 | 70~150 | 原生队列 + `STATE_ENDED`/`onMediaItemTransition` 时**原生推进**（#405 的核心）+ 失败项移除 |
| `.../MediaItemMapper.kt` | 新增 | 40~90 | Song → `MediaItem`（含 `User-Agent`/`Referer` headers、artwork、extras 回传 songId/sourceType） |
| `.../AudioFocusHandler.kt`（可选） | 新增 | 0~80 | 替代 `interruptionMode: 'doNotMix'`（audio focus 语义） |
| `android/src/main/res/values/strings.xml` | 新增 | 0~10 | 通知 channel 名 |
| **小计（逐文件）** | | **488~1,055** | 与 3.0 口径 3 的锚定估算 730~1,380 取并集 → **500~1,400 行** |

#### C-2 JS 桥接层

| 文件 | 现状 | 动作 | 预估 LOC | 依据 |
|---|---|---|---|---|
| `packages/mobile/modules/mplayer-audio/index.ts` | — | 新增 | 60~120 | `requireNativeModule` + 类型化包装 + `addListener` |
| `packages/mobile/modules/mplayer-audio/src/*.types.ts` | — | 新增 | 40~80 | Song/队列/事件 payload 类型 |
| `packages/mobile/services/nativeAudio.ts` | — | 新增 | 60~130 | 薄适配层：模块 API ↔ 现有语义（`setQueue`/`play`/`seek`/事件注册） |
| `packages/mobile/services/nativeAudioEvents.ts` | — | 新增 | 60~140 | `onProgress→setCurrentTime/setDuration`、`onTrackChanged→store`、`onQueueEnded→pause`、`onError→handleTerminalPlaybackFailure` |
| `packages/mobile/services/audioPlayer.ts` | 654 | 改写 | 改写 220~360；保留 290~430 | 同 3.0 口径 2；`attachPlaybackListener` 整块换成原生事件订阅 |
| `packages/mobile/stores/playerStore.ts` | 85 | 改写 | +40~100 | 原生主导队列 → store 镜像（或 Zustand 主导 → 入队同步） |
| `packages/mobile/app/_layout.tsx` | 215 | 改写 | 30~70 | `initAudio` → `MPlayerAudio.initialize()`；`:122-140` 通知动作改走原生（`addNotificationResponseListener` 变成原生按钮回调或保留作兜底） |
| `packages/mobile/services/notificationService.ts` | 121 | 改写（净删） | 删 80~100；留 20~40 | 通知下沉到 `MPlayerPlaybackService` |
| `packages/mobile/package.json` | 49 | 改写 | ±3 | 可选显式 `expo.autolinking.nativeModulesDir`（默认已可用） |
| `packages/mobile/android/app/src/main/AndroidManifest.xml` | 42 | 改写 | −5~−8 | 删 `AudioControlsService` 块（我们自己的 service 从模块 manifest merge） |
| `packages/mobile/android/app/proguard-rules.pro` | 21 | 改写 | +4~10 | keep `com.mplayer.audio.**` + media3（现规则只 keep `expo.modules.**`） |
| `packages/mobile/android/app/build.gradle` | 198 | 保留 | 0 | media3 版本可经 `expoLibs`/直接版本号引入，不必改 app 模块 |
| `packages/mobile/android/settings.gradle` | 39 | 保留 | 0 | `modules/` 由 autolinking 自动发现 |
| `packages/mobile/__tests__/{nativeAudio,nativeQueue}.test.ts`（新） | — | 新增 | 120~260 | 模块 mock + 原生队列推进语义（与 `backgroundTrackAdvance` 类守卫同构） |
| `packages/mobile/__tests__/audioPlayer.test.ts` | 938 / 42 例 | 改写 | 400~650 改写，另删 100~200 | mock 由 expo-audio 换成自写模块 |
| `packages/mobile/__tests__/notificationService.test.ts` | 64 / 2 例 | 删除或改写 | −40~−64 | — |
| `docs/adr/<新>.md` + 索引行 | — | 新增 | 80~140 + 1 | 同上 |
| iOS（`packages/mobile/ios/` **未入库**） | — | 暂不涉及 | 0（将来 400~900 Swift，推断） | 仓库只有 `android/` 入库；`app.json:10-13` 仍有 iOS 标识 |

#### C-3 保留不动的 JS 解析链（两条路线共用）

| 文件 | 行数 | 为什么不能动 |
|---|---|---|
| `packages/mobile/services/cacheService.ts` | 93 | 语义层 key/TTL 内聚（ADR-0002/0012），预取与播放共用同一份 |
| `packages/mobile/services/songResources.ts` | 51 | core 刷新编排适配器（搜索端口），与播放器无关 |
| `packages/mobile/services/downloadService.ts` | 349 | 只借用 `resolvePlayableUrlMobile` 的 URL，不碰播放器 |
| `packages/mobile/services/networkState.ts` | 21 | 注入 core skipGuard 的 predicate |
| `packages/mobile/services/songActionEffects.ts` | 71 | 换源落到队列的唯一接缝（调 `playSong` 的导出面） |
| `packages/mobile/cache/fileBackend.ts` | 231 | L2 文件后端 |
| `packages/mobile/components/**` | 1,726（4 个播放相关文件） | 只订阅 store 字段 |
| `packages/mobile/app/**` | ~20 屏 | 同上 |
| `packages/core/src/shared/skipGuard.ts` 等 core 全部 | — | 双端共用决策，B/C 都不应改 core |

**总计（C）**：Kotlin 新增 **500~1,400 行**；JS 桥接新增 **360~610 行**（含新测试 120~260、ADR 80~140）→ 新增合计 **860~2,010 行**；删除 **91~116 行**；改写 **734~1,254 行**。

### 3.3 两条路线的「共同项 / 差异项」

- **共同必改**（不论 B/C）：`services/audioPlayer.ts`（200~320 改写）、`stores/playerStore.ts`（队列所有权重新分配，+40~100）、`app/_layout.tsx`（30~70）、`services/notificationService.ts`（净删 70~100）、`android/.../AndroidManifest.xml`（删 expo-audio service）、`android/app/proguard-rules.pro`（R8 keep）、`app.json`（删 plugin）、`__tests__/audioPlayer.test.ts`（400~650 重写）。
- **B 独有**：新 entry（`index.js`）+ RNTP playback service + `strings.xml` channel 名 + **引入商业许可依赖**；Kotlin 行数为 0（写在外面的库）。
- **C 独有**：`modules/mplayer-audio/` 全套 Kotlin（500~1,400）+ JS 桥接（240~470，不含测试/ADR）+ media3 依赖与版本对齐 + iOS 未来成本。
- **`audioPlayer.ts` 的相对稳定面**：解析（`248-375`）、歌词/封面懒刷新（`266-323`）、失败处置（`193-236`、`557-613`）合计约 330~430 行**两条路线都应当保留**——它们是「JS 还活着时预解析未来 N 首喂给原生」的落点（`350-375` 的 `prefetchNextSong` 是唯一现成挂点）。

---

## 4. 受影响的测试与文档

### 4.1 `packages/mobile/__tests__/`（现 33 个文件，全部实测例数）

**会红 / 必须改写（2 个）**

| 文件 | 现有例数 | 影响 | 说明 |
|---|---|---|---|
| `audioPlayer.test.ts` | **42 例 / 938 行** | 大面积红 | `:92-96` `vi.mock('expo-audio', …)` 是整份测试的地基；`createAudioPlayer` 调用次数断言（`:283,345,625,653,676`）、`audioMocks.players[0].seekTo` spy（`:634`）、`setActiveForLockScreen` 相关用例全部需要重写；`playback lifecycle races`（`:288-396`）与 `#385 跳歌护栏`（`:846-937`）两组语义仍有效但要换 mock 载体。预估：**保留 ~12-18 例、改写 ~20-24 例、新增 8-15 例** |
| `notificationService.test.ts` | **2 例 / 64 行** | 红或删除 | 只测 `requestNotificationPermission` 的 Expo Go guard；若该函数保留则 2 例可留，`updateNotification/clearNotification` 的语义转移后原文件无意义 |

**不受影响（31 个）**：`downloadService.test.ts`（10 例，`:113-116` 只 mock 了 `resolvePlayableUrlMobile`，**只要该导出保留就绿**）、`songResources.test.ts`（6）、`cacheService.test.ts`（10）、`networkState.test.ts`（5）、`songActionsStore.test.ts`（6）、`settingsStore.test.ts`（8）、`playbackTrace.test.ts`（3）、以及 UI/metric 类 24 个文件（`dragSession` 44、`songList` 15、`collapsingChrome` 15 等）。

**需要新增（1~2 个）**

| 建议文件 | 预估 | 覆盖 |
|---|---|---|
| `__tests__/nativeQueue.test.ts` | 120~260 行 / 8~15 例 | 原生队列推进（不依赖 JS 定时器/事件）、预解析 N 首入队、队列耗尽停止、失败项移除 |
| `__tests__/nativeAudio.test.ts`（路线 C 专属） | 60~140 行 / 4~8 例 | 模块 API ↔ store 映射、`onProgress` 心跳节流 |

**测试基建**：`__tests__/setup.ts`（9 行）只 mock AsyncStorage；新原生模块的 mock 需要按 `audioPlayer.test.ts` 现有写法各自 `vi.mock`（不需要改 setup）；`vitest.config.ts:14-15` 的 `include`/`setupFiles` 无需改。

### 4.2 文档 / AGENTS.md / CONTEXT.md 同步（6 处）

| 位置 | 现状 | 动作 |
|---|---|---|
| `AGENTS.md:25` | Mobile 段写「expo-audio」 | 改写 1 行 |
| `AGENTS.md:39` | `- Audio: expo-audio（非 Howler）…` | 改写 1 行 |
| `docs/agents/architecture.md:60` | `services/ audioPlayer(expo-audio), notificationService, …` | 改写 1 行 +（C）新增「原生模块/服务」说明 3~8 行 |
| `CONTEXT.md` | 无 expo-audio / 原生播放会话词条（仅 `:80` 提到 `prefetchCache` 移动端不写） | **新增 1 条词条**（如「原生播放会话」）5~10 行 |
| `docs/adr/README.md:41-56` 索引表 | 目前 14 条（最后 ADR-0014） | 同一 PR 加 1 行索引（规则见 `:58-63`） |
| `docs/wayfinder/2026-08-03-expo-57-verification.md:14-21,40-51` + `2026-08-03-manual-regression-checklist.md:92` + `…-light-theme.md:110` | 锁屏控制 `setActiveForLockScreen` 的验收条款 | 改写 4~8 行（换成 RNTP/自写模块的锁屏与通知验收项）**且必须补「Expo Go 不再是验收环境」** |

> `.agents/skills/` 与 `e2e/` 目前**没有** expo-audio / 锁屏相关条款（实测 grep 零命中），不需要同步。

---

## 5. 清点过程中发现的、会改变评估前提的三条事实

1. **`prefetchPlayableSong` 与移动端无关**。题面把它列为「解析链调用」之一，但全库 grep 显示移动端 0 调用点；移动端预取 = `audioPlayer.ts:350-375` + `songResourcesCache`（12h TTL，`CONTEXT.md:80`）。B/C 的「预解析未来 N 首」应当**复用这条链**（`resolvePlayableUrlMobile` → `setCachedResource`），而不是引入 core 预取缓存。
2. **「expo-audio 后台不投递事件」这个表述与源码有张力**：`AudioPlayer.kt:147-156` 在 `STATE_ENDED`（`justFinished`）时**同步** `sendStatusUpdate`，即原生侧确实发了一次 `didJustFinish`；只有周期性心跳（`BaseAudioPlayer.kt:52-69`，`if (playing)`）会在停止后归零。因此后台「零事件」更可能是**JS 运行时被冻结 / 事件在 JSI 队列里积压**（与 `docs/research/2026-09-27-android-background-playback.md:452` 的 H1/H3 假说同族），而不是原生不发（推断；需要 `adb shell am set-inactive` 类实验或前台补跑日志来区分）。**但结论不变**：JS 被冻结时任何 JS 侧推进都不可能，原生持队列仍是正解。
3. **master 上已存在两条针对 #405 的分支**（未合入）：
   - `fix/background-advance`（`bf00cea`，worktree `.claude/worktrees/background-advance`）：JS 侧同步换源 + 预取提前到剩余 15s，改 `audioPlayer.ts` +335 行，并写了 ADR `docs/adr/2026-09-27-mobile-background-track-advance.md`（其「备选与否决」一节已否决「媒体会话接管（让原生持有队列）」为**独立议题**）。
   - `fix/background-track-advance`（`911d0cd`）：只把两处 `setTimeout(…,0)` 换成微任务，理由写的是「新架构下宿主侧 timer 在 `onHostPause` 被暂停」。
   - 两者都**没有**引入原生队列，与本评估的 B/C 不重叠，但它们的真机结论/ADR 是 B/C 必须引用或反转的既有决策（推断：至少需要在新 ADR 的「备选与否决」里回应）。

---

## 参考

**仓库内（一手）**

- `packages/mobile/services/audioPlayer.ts`（654 行，1.1~1.7 全部行号）
- `packages/mobile/services/notificationService.ts`、`packages/mobile/cache/fileBackend.ts`
- `packages/mobile/app/_layout.tsx`、`packages/mobile/stores/{playerStore,audioTagStore,settingsStore}.ts`、`packages/mobile/services/{cacheService,songResources,downloadService,networkState,songActionEffects}.ts`
- `packages/mobile/android/app/src/main/AndroidManifest.xml`、`packages/mobile/android/app/{build.gradle,proguard-rules.pro}`、`packages/mobile/android/settings.gradle`、`packages/mobile/app.json`
- `packages/mobile/__tests__/audioPlayer.test.ts`（938 行 / 42 例）、`__tests__/notificationService.test.ts`（2 例）、`__tests__/downloadService.test.ts:113-116`
- `docs/research/2026-09-27-android-background-playback.md`（本仓库既有调研：#405 候选路径 A~D、expo-audio 能力边界）
- `docs/wayfinder/2026-08-03-expo-57-verification.md`、`docs/agents/architecture.md:60`、`docs/adr/README.md`、`CONTEXT.md:80`、`AGENTS.md:25,39`
- 分支（未合入）：`fix/background-advance`（`bf00cea`、ADR `docs/adr/2026-09-27-mobile-background-track-advance.md`）、`fix/background-track-advance`（`911d0cd`）
- 本机 node_modules（版本锚点）：`node_modules/expo-audio/package.json`（57.0.4）、`node_modules/expo-audio/android/build.gradle:29-37`（media3 1.9.0）、`node_modules/expo-audio/android/src/main/java/expo/modules/audio/**`（Kotlin 4,020 行；播放子集 1,627 行）

**外部（一手：官方文档 / 官方源码 / issue / 包元数据）**

- [Expo Modules API: Get started（`create-expo-module --local` 与 `modules/` 目录结构）](https://docs.expo.dev/modules/get-started/)
- [Module API Reference（Function / AsyncFunction / Events DSL）](https://docs.expo.dev/modules/module-api/)
- [expo-modules-autolinking：`nativeModulesDir` 默认 `./modules`](https://github.com/expo/expo/blob/sdk-57/packages/expo-modules-autolinking/src/commands/autolinkingOptions.ts)
- [npm registry：`react-native-track-player` latest = 4.1.2 / Apache-2.0](https://registry.npmjs.org/react-native-track-player/latest)
- [npm registry：`@rntp/player` latest = 5.9.2 / commercial license](https://registry.npmjs.org/@rntp/player/latest)
- [RNTP README：V5 起商业许可、V4 留在 `v4` 分支、要求 RN ≥0.74 + 新架构](https://github.com/doublesymmetry/react-native-track-player)
- [RNTP 定价页（€99/月起）](https://rntp.dev/pricing)
- [RNTP issue #2443：V4 目前不支持新架构](https://github.com/doublesymmetry/react-native-track-player/issues/2443)
- [RNTP issue #2540：V4.1.2 在 RN ≥0.80 构建失败 / 已停止维护](https://github.com/doublesymmetry/react-native-track-player/issues/2540)
- [RNTP 官方文档：Playback Service 在后台继续运行 / remote events 放服务里](https://rntp.dev/docs/basics/playback-service)
- [RNTP 官方文档：Expo 接入需要自定义 entry point](https://doublesymmetry.github.io/react-native-track-player/docs/next/guides/with-expo)
- [RNTP V5 aar 自带的 `AndroidManifest.xml`（service + FGS 权限）](https://unpkg.com/@rntp/player@5.9.2/android/src/main/AndroidManifest.xml)
- [expo-audio 官方文档（`enableBackgroundPlayback` 与 `setActiveForLockScreen` 的必要性）](https://docs.expo.dev/versions/latest/sdk/audio/)

## 第二部分 · B：react-native-track-player 落地评估


> 评估日期 **2026-09-28** · 对象：`react-native-track-player`（V4，Apache-2.0）与 `@rntp/player`（V5，商业许可） · 目标栈：Expo SDK 57（expo ~57.0.15）/ **RN 0.86.2** / 新架构（Fabric + bridgeless）/ CNG 反向（`packages/mobile/android/` 已入库，CI 直接 gradlew）
> 口径：每条结论给一手依据 —— 仓库结论给 `file:line`，外部结论给可点链接（官方文档 / npm 元数据 / 上游源码 / issue）；拿不准的显式标「（不确定/推断）」。本文件只评估 RNTP，不改仓库任何文件。

## TL;DR（≤8 条）

1. **V4 在我们这套栈上不可用**：4.1.2 是最后一个发布版（npm 时间 2025-08-12，距今 13 个月），它在 bridgeless 下原生→JS 事件**全部静默丢失**（issue #2593），在 RN 0.83/Expo 55 上**启动即崩**（#2603），在 Kotlin 2.1.x 上**编译失败**（#2530，修复 PR #2535 被关闭未合并）；而 RN 0.86.2 已删除旧架构退路（`newArchEnabled=false` 自 RN 0.82 起不再支持）。
2. **唯一可能落地的是 V5**：新包名 `@rntp/player`，最新 **5.9.2**（2026-08-26），要求 **RN ≥ 0.74 + 新架构**，TurboModule/JSI 全新实现；官方安装文档明确写 Android「**No additional steps required**」。
3. **V5 是商业许可、不是开源**：仅"个人用途/教育用途"免费，**非营利、自由职业、任何营利应用都要付费**（Pro €99/月、Studio €249/月，≤5 个 App），且条款禁止再分发与白标 —— 对公开分发 APK 的 MPlayer 是**决策级阻塞**，不是工程量问题。
4. **#405 的正解恰好就是 V5 的原生队列**：曲末推进由 media3 playlist 在原生完成（不依赖 JS 事件投递），但队列里每一项的**直链必须先由 JS 解析好**。
5. **V5 的后台 JS 确实还在跑**（EventBroker 在进程内起 headless task 并持 wakelock），但窗口只有 **5s**（`TASK_TIMEOUT_MS = 5_000`），装不下"直连 3s + tier3 6s"的解析 → 必须**预解析 N 首**、后台只做缓存命中入队。
6. **CNG 反向仓库的接入改动很小**：库自带 AndroidManifest（manifest merger 自动合并），**无需 config plugin、无需 expo prebuild**；真正要手工做的是「删掉 expo-audio 的 AudioControlsService」「加通知小图标 drawable + shrinkResources keep」「补 R8 规则」这三件事。
7. **改动量估算**：约 **10 个 JS 文件**、改写 **~900–1400 行**（`audioPlayer.ts` 654 行整段重写）、删除 `notificationService.ts`（121 行），测试约 **1000 行**重写；committed `android/` 4 个文件约 ±40 行。
8. **维护风险偏高**：V5 自 5.8.0 起的 npm 产物 gitHead 在**公开仓库查无此 commit**（开发部分闭源），公开示例只到 RN 0.83.9，GitHub `main` 自 2026-06-01 起无提交，当前 18 个 open issue。

---

## 1. 兼容性判定（最关键）

### 1.1 判定结论（先给答案）

| 候选 | 对本仓库（RN 0.86.2 + 新架构 + Expo 57） | 一句话依据 |
|---|---|---|
| `react-native-track-player` **4.1.2**（V4） | **不可用（三处硬阻塞）** | bridgeless 事件全丢 #2593 / RN 0.83+ 启动崩 #2603 / Kotlin 2.1.x 编译失败 #2530（PR #2535 closed 未 merge） |
| `@rntp/player` **5.9.2**（V5） | **技术上可用**（RN 0.74+ 新架构即可；有第三方在 RN 0.86.2 + Expo SDK 57 上跑 5.8.0 的生产报告） | 官方 requirements + npm 元数据 + issue #2670 评论 |
| V5 的**许可** | **决策级阻塞**（商业授权） | `license.txt` 原文 + rntp.dev/pricing |
| 「等 V4 出新版修好」 | **不可能**：V4 已冻结，v4 分支自 4.1.2 起零提交 | `v4` 分支 HEAD = `94fe2c20`（= v4.1.2 tag）+ 官方文档「V4 is frozen … will not receive further updates」 |

### 1.2 依赖方基线：RN 0.86.2 已经没有"旧架构"这条路

这是我们这个评估里最硬的一条前提（也是"能不能继续用 V4"的决定性事实），三处源码级证据（读自本仓库已安装的 RN 0.86.2）：

- `node_modules/@react-native/gradle-plugin/.../utils/ProjectUtils.kt:34`：`internal fun Project.isNewArchEnabled(): Boolean = true` —— **写死 true**，`newArchEnabled` 属性已不再被读取。
- `.../ReactRootProjectPlugin.kt:61-85`：设置了 `newArchEnabled=false` 时只打印 `WARNING: Setting newArchEnabled=false … is not supported anymore since React Native 0.82`，并把所有子项目强制置回 true（`:31-41`）。
- `node_modules/react-native/ReactAndroid/.../defaults/DefaultNewArchitectureEntryPoint.kt:160-173`：`isConfigurationValid()` 在 `!turboModulesEnabled || !fabricEnabled || !bridgelessEnabled` 时返回 `false to "You cannot load React Native with the New Architecture disabled"`。

即：**RN 0.82 起新架构是唯一形态，0.86 上不存在"退回旧架构"的选项**。本仓库本来也没退路：`packages/mobile/gradle.properties:39` 是 `newArchEnabled=true`，`packages/mobile/app.json:9` 同样是 `true`，运行时 fabric/bridgeless（与题目给的前置一致）。

RN 版本时间线（GitHub Releases API）：`v0.86.2` = 2026-07-27、`v0.86.3` = 2026-08-24、`v0.87.1` = 2026-08-26，`v0.88.0-rc.2` = 2026-09-22 —— 也就是说 0.86 线在评估当日仍在维护，但**新架构限制不会回退**。

### 1.3 V4（react-native-track-player 4.x）

**发布足迹**（npm registry `react-native-track-player`）：`dist-tags.latest = 4.1.2`（2025-08-12T12:59:09Z）、`dist-tags.next = 4.0.0-rc09`、`dist-tags.nightly = 5.0.0-alpha0-nightly-…`（2025-09-24）。**13 个月无新版本**。v4 分支 HEAD `94fe2c200ab620a4ddcc66d1b7484ab747d73e2b` 与 v4.1.2 的 gitHead 完全一致 → 分支上没有任何后续修复。

**官方立场**（rntp.dev/docs/introduction）：原文「V5 is a complete rewrite and is not backwards-compatible with V4… **V4 is frozen on the v4 branch under Apache-2.0 and will not receive further updates.** All new development happens in V5.」维护者在 #2425 / #2443 里对新架构的答复是「new arch will eventually be supported, but **currently is not**」；2026-05-06 V5 发布当天，维护者把 v4 的 open issue **批量关闭**（#2593、#2603、#2530、#2557 等，见各 issue 里 dcvz 的同一段评论）。

**三处硬阻塞（每一条都足以否决 V4）**：

1. **bridgeless 下事件全丢（#2593）**。V4 的 `MusicService.kt:743-757` 用 legacy 链路发事件：`reactNativeHost.reactInstanceManager.currentReactContext?.getJSModule(...)` —— 新架构下 `currentReactContext` 为 null，`?.` 静默 no-op，"playback state、track changes、remote media controls、progress、metadata、errors"全部不到 JS（issue 原文）。指示：即便它能编译，**通知按钮、锁屏控制、曲末事件都不会进 JS**，与 #405 要解决的问题正面冲突。
2. **RN 0.83 / Expo SDK 55 上启动即崩（#2603）**。报错 `TurboModuleInteropUtils$ParsingException: Unable to parse @ReactMethod annotations from native module: TrackPlayerModule. Details: TurboModule system assumes returnType == void iff the method is synchronous`（RN 0.83.2 + Expo 55 生产构建）；RN 0.86 只会更严（新架构互操作层解析逻辑同源）。报告者最后「moved in the end to another library」。
3. **Kotlin 2.1.x 编译失败（#2530）**。`MusicModule.kt:548 / :588` 把 `Bundle?` 传给了要求非空的 `Arguments.fromBundle`；修复 PR **#2535 状态 closed 且 merged_at = null（未合并）**，且 v4 分支文件至今未改（我直接读 v4 分支的 `MusicModule.kt`，仍是 `Arguments.fromBundle(musicService.tracks[index].originalItem)`）。而**本仓库的 Kotlin 就是 2.1.20**（`node_modules/react-native/gradle/libs.versions.toml`：`kotlin = "2.1.20"`、`agp = "8.12.0"`）。

**顺带澄清一个"看着像阻塞、其实不是"的点**（避免误判）：V4 的 `android/build.gradle` 里写 `implementation "com.facebook.react:react-native:+"`，而 Maven Central 上该坐标最新只到 `0.71.0-rc.0`（且该版本目录 404）。这**不会**导致构建失败，因为 RN 的 Gradle 插件专门为旧库做了坐标替换：`@react-native/gradle-plugin/.../utils/DependencyUtils.kt:132-139,156-166` 把 `com.facebook.react:react-native` 替换为 `com.facebook.react:react-android`（注释原文就是「libraries using implementation("com.facebook.react:react-native:+") 也能解析到正确的依赖」）。所以 V4 的否决理由是上面三条，不是这条。（V4 其余工具链：AGP 4.2.2 / Kotlin 1.8.10 / `com.github.doublesymmetry:kotlinaudio:v2.1.0`（JitPack，本仓库 root `build.gradle:19` 已声明 jitpack，可解析）。）

### 1.4 V5（@rntp/player 5.x）

**版本足迹**（npm registry `@rntp/player`）：latest **5.9.2**（2026-08-26T23:12:23）、beta 5.0.0-beta.6；5.0.0 GA 在 2026-05-06（GitHub release `v5.0.0` 2026-05-06T16:44:52Z），此后 5.1.2→5.9.2 共 **12 个版本 / 约 3 个月**（05-20 至 08-26），发版节奏是月级。

**官方要求**（rntp.dev/docs/installation）：

- React Native **0.74 or later**、**New Architecture enabled (Fabric + TurboModules)**、iOS 16.0+、Android API 21+。
- iOS：`Info.plist` 需 `UIBackgroundModes = audio`；**Android：「No additional steps required. The package auto-links with React Native's new architecture.」**
- README「Requirements」同口径（RN 0.74+ 与 New Architecture）。

**实现形态**（npm tarball `@rntp/player@5.9.2` 实读）：`package.json` 带 `codegenConfig.name = "RNTrackPlayerSpec", type "modules"`，Android 侧有 `android/src/newarch/TrackPlayerSpec.kt`，JS 侧 `src/NativeTrackPlayer.ts` 用 `TurboModuleRegistry.getEnforcing<Spec>('TrackPlayer')` —— **纯 TurboModule，无旧架构分支**。native 依赖 media3 **1.9.2**（exoplayer/session/cast + mediarouter 1.7.0）+ kotlinx-serialization-json 1.6.3。

**对 RN 0.86 的实测信号**：V5 的公开 `example` 只编到 **RN 0.83.9**（main 分支 `example/package.json`），`devDependencies` 用 RN 0.83.0 —— **0.86 未被上游示例覆盖（不确定/推断：未见官方 0.86 兼容声明）**。但有一条强一手旁证：issue #2670 里一个生产用户明确写「Environment: @rntp/player 5.8.0, **RN 0.86.2 (New Architecture), Expo SDK 57**, Android targetSdk 36」（2026-08-30 评论）——即**与我们完全相同的栈上有人真在跑 V5**（他们报的是两处后台事件投递崩溃，5.9.2 已修）。

**Expo 集成现状**：tarball 的 `files` 里**没有** `app.plugin.js`（只有 src/lib/android/ios/cpp/license.txt/*.podspec）→ **无官方 config plugin**；社区也没有：npm 上 `@config-plugins/react-native-track-player` 返回 **404**（该包不存在）。Android 侧不需要 plugin 的原因是库自带 manifest（见 §2.2）。

### 1.5 维护活跃度（数字）

| 指标 | V4 `react-native-track-player` | V5 `@rntp/player` |
|---|---|---|
| 最新版本 / 时间 | **4.1.2 / 2025-08-12**（13 个月前） | **5.9.2 / 2026-08-26**（约 1 个月前） |
| 近 3 个月发版数 | 0 | 6+（5.5.0→5.9.2） |
| 源码可见性 | v4 分支公开、冻结 | **main HEAD = 2be767dd（2026-06-01，= v5.7.0）**；5.8.0+ 的 npm `gitHead = bef3c2ebd317ac91f4aa8c9bf5e4f041e8ce17da` 在公开仓库 **HTTP 422 No commit found** → 后续版本源码不在公开仓库 |
| GitHub Releases | 最新 v4.1.2 | 公开 release 最新 **v5.7.0**（2026-07-16），5.8/5.9 只有 npm 没有 GitHub release |
| issue / PR | v4 issue 于 2026-05-06 批量关闭 | open issue **18**；open PR **9**（其中 8 个 dependabot；功能向的只有 #2674 legacy ICY 标点归一化、#2681 iOS 控制中心复现） |
| 其他 | Apache-2.0 | `license.txt`：SEE LICENSE（商业）；仓库 license 字段 NOASSERTION；stars 3706；archived=false |

> 关键治理事实：**V5 是"单一厂商（Double Symmetry GmbH）+ 商业授权 + 部分闭源"的依赖**。npm tarball 仍包含 `android/src` 与 `ios/` 源码（`files` 列表里有 src、android、ios），所以 **patch-package 仍能改 Kotlin/Swift 源码**（Gradle 从源码编库），但失去了"公开仓库可对照/可提 PR"的能力。（推断：5.8.0 之后的开发在私有仓库进行。）

---

## 2. 在 CNG 反向仓库里的接入步骤

### 2.1 需要手工改的 committed packages/mobile/android/（清单）

| 文件 | 改什么 | 依据 |
|---|---|---|
| `android/app/src/main/AndroidManifest.xml` | **删掉** `:23-27` 的 `<service android:name="expo.modules.audio.service.AudioControlsService" …>`（连带其 `androidx.media3.session.MediaSessionService` intent-filter） | 见 §2.3 双媒体会话冲突 |
| 同上 | **不需要加** RNTP 的 service 与权限：库自带 manifest 会自动合并进来（TrackPlayerPlaybackService 带 `foregroundServiceType="mediaPlayback"` + WAKE_LOCK/FOREGROUND_SERVICE/FOREGROUND_SERVICE_MEDIA_PLAYBACK）；现有 `:2-3` 的两条权限与库声明重复，留着也无害 | tarball `android/src/main/AndroidManifestNew.xml`（AGP ≥ 7.3 时由 `android/build.gradle` 的 `supportsNamespace()` 分支选用）；本仓库 AGP 8.12.0 |
| `android/app/src/main/res/drawable/ic_stat_music_note.xml`（**新增**） | 通知小图标；`setupPlayer({ android: { notification: { channelId, channelName, smallIcon: 'ic_stat_music_note' } } })` 里的 smallIcon 是**按资源名查找**的 | 上游 `TrackPlayerPlaybackService.kt:450-455`：`resources.getIdentifier(iconName, "drawable", packageName)`，取到 0 就静默忽略 |
| `android/app/src/main/res/raw/keep.xml`（**新增，强烈建议**） | `<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@drawable/ic_stat_music_note" />`：release 走 shrinkResources（`gradle.properties:61`、`app/build.gradle:132-135`），而该 drawable 只被"名字字符串"引用，**可能被资源裁剪器删掉**（推断：未实测） | 同上一行 + 本仓库 R8/shrinkResources 配置 |
| `android/app/proguard-rules.pro` | 补 keep：`com.doublesymmetry.trackplayer.**`（保守）+ Kotlin 序列化 @Serializable 类（PlayerConfig/PlayerCommand/BrowseTree，见 `PlayerConfig.kt:11`、`PlayerCommand.kt:10`、`BrowseTree.kt:20`）；现有 `:12` 只保了 `com.facebook.react.turbomodule.**` | **V5 不提供 consumerProguardFiles**（`android/build.gradle` 里只有 `buildTypes.release.minifyEnabled false`，tarball 内无任何 proguard 文件）——相对 V4 的一个回归点 |
| `android/app/build.gradle` | **不需要改**（autolinking 由 `settings.gradle:25-31` 的 `autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)` 自动 include；库的 Kotlin 版本取 `rootProject.ext.kotlinVersion`，compileSdk 取 `rootProject.ext.compileSdkVersion`） | 库 `android/build.gradle` 的 getExtOrDefault/getExtOrIntegerDefault + 本仓库 `app/build.gradle:88-98` 用同一批 ext |
| `android/build.gradle`（root） | **不需要**：V5 只用 google()/mavenCentral()；jitpack 已在 `:19`（V4 才需要它拉 kotlinaudio） | tarball `android/build.gradle` 的 repositories |

**R8/打包的额外风险**：V5 的 `build.gradle` 声明 `apply plugin: "kotlinx-serialization"` 并依赖 `kotlinx-serialization-json:1.6.3`（jar 265,019 B）；Kotlin 序列化在 R8 full mode 下需要 keep 规则，上游**没带**。release 包必须实测 `setupPlayer` 与 `setBrowseTree`/`extras` 路径（推断：可能不需要额外规则，因为序列化器由代码显式引用；但这是最值得先验的一项）。

### 2.2 不需要 expo prebuild、不需要 config plugin（为什么）

- **库自带你需要的原生声明**：Android 侧所有 service/权限都在 npm 包的 `android/src/main/AndroidManifest*.xml` 里，Gradle 的 manifest merger 在构建期合并进最终 manifest —— 这正是官方文档敢写 Android「No additional steps required」的原因（rntp.dev/docs/installation）。
- **autolinking 覆盖 gradle 接线**：Expo 的 `expo-modules-autolinking` 会把 RN 社区库（非 Expo 模块）一并吐进 RN config 命令（`node_modules/expo-modules-autolinking/android/expo-gradle-plugin/.../ExpoAutolinkingSettingsExtension.kt:23-27`：`command("react-native-config")`），本仓库 `settings.gradle:25-31` 正是这样接的 → **新增依赖不需要改 settings.gradle**。
- **没有 config plugin 可用**（npm 404），所以"靠 plugin 改 manifest"这条路本来也不存在。
- **代价对比**：如果为了 RNTP 去跑 `expo prebuild`，会**重写整个 committed android/**（CNG 反向失效、CI 的"直接 gradlew 增量构建"前提被破坏、PR #435 的 .dev 变体手工改动被抹掉）。结论：**在本仓库里必须走"手工改 manifest + 库 manifest 合并"，坚决不 prebuild**。这也与仓库既有约定一致（`AGENTS.md` 移动端段：新增原生依赖时 committed `android/` 需相应改动，而不是自动 prebuild 生成）。

### 2.3 必须清掉 expo-audio 的媒体服务（否则两条 MediaSession 打架）

- 现在 committed manifest `:23-27` 有 `expo.modules.audio.service.AudioControlsService`（intent-filter `androidx.media3.session.MediaSessionService`，`foregroundServiceType="mediaPlayback"`），它由 `app.json:28-33` 的 expo-audio plugin（`enableBackgroundPlayback: true`）在 prebuild 时写入。
- RNTP V5 的 `TrackPlayerPlaybackService` 也是媒体服务（intent-filter `androidx.media3.session.MediaLibraryService` + `android.media.browse.MediaBrowserService`，`foregroundServiceType="mediaPlayback"`）。
- 两个 FGS 媒体服务 + 两套 MediaSession 并存会争系统媒体区/锁屏控制权，并多一条常驻通知；`audioPlayer.ts:518-537` 的 `setActiveForLockScreen` 也会继续绑 expo-audio 的服务。
- 因此要**同时**：删 `app.json` 的 expo-audio plugin（`:28-33`）、删 `package.json:20` 的依赖、**手工删** manifest 里那三行 service。注意「改 app.json 不会自动同步 manifest」——因为 CI 不再 prebuild（`release.yml:246-250` 的注释明说不再 prebuild）。

### 2.4 工具链版本要求 vs 本仓库（结论：无需升级）

| 项 | V5 要求 / 上游默认 | 本仓库实际 | 判定 |
|---|---|---|---|
| RN | ≥ 0.74 + 新架构 | 0.86.2 + `newArchEnabled=true` | 通过 |
| Kotlin | `rootProject.ext.kotlinVersion`（库内默认属性 1.7.0 只作兜底） | RN 0.86.2 目录 `kotlin = 2.1.20` | 通过（第三方已在 0.86.2/Expo 57 跑通） |
| AGP | 库内 buildscript 声明 7.2.1（root 已解析同名插件时被 root 覆盖，create-react-native-library 常规形态；推断） | 8.12.0 | 通过（不确定：建议先做一次真机构建验证） |
| compileSdk / minSdk | 库取 `rootProject.ext`（默认 31/21） | 由 Expo 提供（高于 31） | 通过 |
| Java | CI 用 temurin **17**（`release.yml:210-213`） | 同 | 通过 |
| media3 | **1.9.2** + mediarouter 1.7.0 + media3-cast | expo-audio 57.0.4 用 media3 **1.9.0**（`node_modules/expo-audio/android/build.gradle`） | 注意：小版本抬升 1.9.0→1.9.2，同 major，风险低 |

### 2.5 一个前置阻塞：dev build 的 .dev 后缀还没进 master

题目给的前置是「PR #435 引入 `com.mplayer.mobile.dev`」。实测：**PR #435 状态仍是 OPEN（merged_at = null）**，改动为 `.agents/skills/mobile-device-debugging/SKILL.md` + `packages/mobile/android/app/build.gradle`；而当前 master 的 `android/app/build.gradle` 我通读过 `buildTypes { debug { signingConfig signingConfigs.debug } … }`（`:123-139`），**没有 applicationIdSuffix '.dev'**，`defaultConfig.applicationId 'com.mplayer.mobile'`（`:101`）。
影响：在 master 上出 dev build 会**与已安装的 release 同包名**（覆盖正式包），这正是 PR #435 要解决的问题。RNTP 落地必须先把 #435 合了或本地带上。

---

## 3. API 面与映射

### 3.1 V5 拥有什么（以源码为准）

| 类别 | 内容（V5 源码） |
|---|---|
| 队列（**原生持有**） | setMediaItem(s) / addMediaItem(s) / insertMediaItem(s) / removeMediaItem(s) / replaceMediaItem / moveMediaItem / clear / getQueue()（**同步**，JSI）—— `src/NativeTrackPlayer.ts:29-70` |
| 播放控制 | play / pause / stop / seekTo / seekBy / skipToNext / skipToPrevious / skipToIndex / retry / setPlaybackSpeed / setVolume（全同步 void） `src/NativeTrackPlayer.ts:11-27` |
| 播放模式 | `setRepeatMode('off'|'one'|'all')` + `setShuffleEnabled(bool)` `src/NativeTrackPlayer.ts:83-85`；native 映射见 `TrackPlayerModule.kt:439-475` |
| 通知 / 锁屏 / 车机 | media3 `MediaLibraryService` + `DefaultMediaNotificationProvider`（`TrackPlayerPlaybackService.kt:446-457`）、`setCommands({capabilities, handling:'native'|'js'|'hybrid'})`、`setBrowseTree`（Android Auto / MediaBrowser） |
| 预加载 / 缓存（**字节级**，不是 URL 解析） | `preload(item, duration)` / `cancelPreload`；`setupPlayer({cache:{maxSizeBytes, preloading:{window}}})` —— `src/interfaces/PlayerConfig.ts` |
| 其他 | sleep timer（`sleepAfterTime` 带 fadeOut / `sleepAfterMediaItemAtIndex`）、`progressSync`（HTTP 上报播放位置）、Cast/AirPlay 按钮组件、hooks（usePlaybackState / useIsPlaying / useProgress / useActiveMediaItem） |
| 事件（17 个） | PlaybackStateChanged, IsPlayingChanged, MediaItemTransition, MediaMetadataChanged, MetadataReceived, PlaybackError, PlaybackProgressUpdated, QueueChanged, Remote{Play,Pause,Next,Previous,Stop,Seek,SkipForward,SkipBackward}, SleepTimerTriggered —— `src/events/index.ts` |

**两个"没有"必须记住**：

1. **V5 没有 V4 的 Event.PlaybackQueueEnded**。队列播完 = `PlaybackStateChanged { state: 'ended' }`（`src/events/PlaybackStateChanged.ts:7-14`；native 把 `STATE_ENDED → "ended"`：`TrackPlayerPlaybackService.kt:97`、`TrackPlayerModule.kt:352`），且 payload 只有 state，**没有 track/position**；逐曲切换看 `MediaItemTransition { item, index }`（`src/events/MediaItemTransition.ts`）。要还原 V4 的 PlaybackQueueEnded(track, position) 语义，得自己 `getActiveMediaItemIndex()` + `getProgress()` 补。
2. **V5 不自动跳坏歌**。官方 `/docs/playback` 的「Error recovery」段：曲目加载失败进入 error 态，`retry()` 只 "re-prepares the current media item"，且 "Does not auto-play"。→ **失败处置（skipGuard）必须我们自己接**（这正是它该待的地方）。

### 3.2 重点核实：PlaybackService 里的 JS 在后台是否真的继续运行？它是不是修好 #405 的根本原因？

分两层回答，避免把两个机制混为一谈。

**(a) "Android 后台 JS 是否还能跑"本身不是 RNTP 的独有能力。** Android 只在进程进入 **cached/empty** 状态时才冻结（AOSP cached apps freezer），而带 mediaPlayback 前台服务的进程处在 `PROCESS_STATE_FOREGROUND_SERVICE` 之上，不会被冻结 —— 这与我们探针观察到的"后台 45s 零事件但 JS 仍对网络回调有反应"一致（JS 活着，缺的是 expo-audio 的事件）。所以：**RNTP 的价值不是"让 JS 活着"，而是"让队列推进不依赖 JS"**。

**(b) 投递机制：V4 与 V5 完全不同，V4 在新架构上是坏的。**

- **V4**：`MusicService : HeadlessJsTaskService`（`MusicService.kt:44`），`onStartCommand` 返回 `START_STICKY`（`:96-99`），`getTaskConfig` 用 `HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true)`（`:759-760`，timeout 0 = 不限、allowedInForeground = true）；JS 侧 `registerPlaybackService(factory)` → `AppRegistry.registerHeadlessTask('TrackPlayer', factory)`（V4 `src/trackPlayer.ts`）。**机制成立的前提是那个 emit 能拿到 ReactContext** —— 而它在 bridgeless 下拿不到（§1.3 的 #2593）。所以 V4 的"后台 JS 继续运行"在我们栈上**是坏投递**。
- **V5**：单一投递点 `EventBroker`（`android/.../EventBroker.kt`）。策略写得很明确：① 上下文 RESUMED → 直接 `DeviceEventManagerModule.RCTDeviceEventEmitter` emit；② 上下文活着但后台 → **在进程内**用 `HeadlessJsTaskContext.startTask(HeadlessJsTaskConfig("TrackPlayerServiceBridge", data, 5_000, true))` 起 headless task（**不再走 startService**，注释点名这就是 #2670 `BackgroundServiceStartNotAllowedException` 的根因规避），并 `acquireWakeLock()` 直到任务结束；③ 完全没有 React 上下文（冷进程）→ 有界 backlog（CAP 64 / TTL 5min，progress 只留最新，remote 事件直接丢弃）。JS 侧在模块加载时就注册了 `AppRegistry.registerHeadlessTask('TrackPlayerServiceBridge', …)`（`src/audio.ts:116-149`），并把事件分发给 `registerPlaybackSession` 或 `addEventListener` 的监听器（`src/audio.ts:218-305`）；文档承诺「在 Android 后台，返回 promise 的监听器会被 await，且有保证的执行窗口；库会持 wakelock 直到它 settle」（`src/audio.ts:270-275`）。

**结论**：V5 的后台 JS **确实会跑**，且是库主动兜住的（in-process headless + wakelock）——但**它不是 #405 的根本解**。根本解是 `setMediaItems([...])` 把**已解析好的直链**交给原生 media3 playlist：曲末推进变成 ExoPlayer 的原生行为，JS 冻结/事件丢失都不影响"这一首播完接下一首"。JS 在新架构里只负责两件事：**把未来 N 首塞进原生队列**、**把状态镜像回 UI**。

### 3.3 模块映射表（本仓库 → RNTP V5）

| 本仓库现状（file:line） | RNTP V5 对应物 | 说明 / 代价 |
|---|---|---|
| 解析链 `resolvePlayableUrlMobile` → core `resolvePlayableSongRouted`（`audioPlayer.ts:331-338`） | **无对应物，原样保留在 JS** | RNTP 只管"已解析 URL 的播放"；解析（直连 3s 墙 + tier3 6s 预算）仍是 core 的活 |
| 预取 `prefetchNextSong()`（`audioPlayer.ts:350-375`，5min 新鲜窗口 `:53`；core `prefetchPlayableSong`） | `addMediaItems([...])` 填充原生队列 + `cache.preloading.window`（字节级预载） | **两层预取**：URL 解析（我们的）+ 音频字节（RNTP 的）。RNTP 的 preload 只对已入队项生效 |
| `didJustFinish` → `store.next()` → `setTimeout(…,0)` → `playSong()`（`audioPlayer.ts:159-170`，**#405 的病灶**） | **原生 media3 playlist 自动前进** + `MediaItemTransition` 事件 | 曲末不再需要 JS 回调；JS 只在事件里补队列、镜像 store |
| 队列播完 → `stopAllPlayers()+pause()`（`audioPlayer.ts:165-169`） | `PlaybackStateChanged{state:'ended'}`（无 V4 的 PlaybackQueueEnded） | 需要在 5s 窗口内追加；追加不到就 `stop()` |
| skipGuard 处置：同曲 fresh 重试一次 → 终局跳歌上限 3 → 坏歌记忆（core `skipGuard.ts:57/87/117`；调用点 `audioPlayer.ts:193-236`、`:578-610`） | `PlaybackError` + `PlaybackStateChanged('error')` → `replaceMediaItem(index, 新URL)` + `retry()`；跳歌 = `removeMediaItem(index)` / `skipToIndex` | **决策仍在 core**（`decideAfterPlaybackFailure`），RNTP 只是执行器。retry() 不自动播、不自动跳，语义正好够用 |
| 试听标记 nonFull 回写（`audioPlayer.ts:474-480`，ADR-0012；时长取证 #389/#392 在 core） | `MediaItem.extras = { songId, nonFull, sourceType }`（5.1.0+，`src/interfaces/MediaItem.ts:71-88`），从 `getActiveMediaItem()`/MediaItemTransition 读回 | extras 是"应用私有、原样回传"的槽位，适合放 Song 引用（保持 payload 小，只放 id + 标记） |
| `playerStore`（`playerStore.ts:31-85`，85 行、无 persist） | **仍是 UI 的唯一真相源**；新增"原生队列镜像层" | 风险：出现第二个真相源（原生队列）。必须单向写（JS→RNTP）+ 事件回填，并在回前台对账 |
| 通知：expo-notifications 普通通知 + 3 个 action（`notificationService.ts:93-114`、`:64-81`）、Expo Go 禁用（`:14-33`） | `setCommands({capabilities:[Play,Pause,SkipToNext,SkipToPrevious,SeekTo], handling:'native'})` + `setupPlayer({android:{notification:{channelId,channelName,smallIcon}}})` | **整块删除** JS 通知；media3 DefaultMediaNotificationProvider 自带 MediaStyle。注意 Android 13+ 系统媒体区最多 5 槽 / compact 3 槽（见 `docs/research/2026-09-27-android-background-playback.md` 第 3 节） |
| 锁屏：`setActiveForLockScreen(true, {title,artist,albumTitle,artworkUrl})` + `updateLockScreenMetadata`（`audioPlayer.ts:518-537`），Expo Go 判定（`:23`） | 原生默认（媒体会话），元数据随 MediaItem 的 title/artist/albumTitle/artworkUrl | 不再需要 Expo Go 分支判断 |
| 播放模式：`settingsStore.ts:18/53`（单曲循环/列表循环/随机播放）+ core `getNextSongIndex`（`core/src/utils/queue.ts:8-14`：单曲 = 同 index、随机 = **防重复随机** `:29-36`、列表 = (i+1)%len） | `RepeatMode.One` / `RepeatMode.All` / `setShuffleEnabled(true)` | 注意：**语义漂移** —— media3 shuffle 是"置换式"（一轮内不重复、记住顺序），core 是"每次随机且不等于当前"；RNTP 也不暴露 shuffle order → 随机模式的预取/下一首预知会变难（决策点：要么保留 JS 随机，要么接受语义变化） |
| 本地文件：`downloadService.ts:22,208`（`resolvePlayableUrlMobile` 取直链后自行下载） | `MediaUrl` 支持 `file://`、裸绝对路径、`require()` 资源、`{uri, headers}`（`src/interfaces/MediaItem.ts:5-34`） | 本地文件播放路径可用；下载流程不动 |
| 请求头 UA/Referer（`audioPlayer.ts:499-505`，core `refererForSourceKey`） | `url: { uri, headers: { 'User-Agent': …, Referer: … } }`；native `HeaderInjectingDataSourceFactory` + `MediaHeaders` 全局表（`TrackPlayerMediaItem.kt:90`） | 通过：防盗链需求被原生支持（这是选 RNTP 而不是自写模块的主要省力点之一） |
| 播放进度/时长：expo-audio `updateInterval: 250`（`audioPlayer.ts:514`）+ 状态事件 | `PlaybackProgressUpdated` 事件 + `getProgress()` 同步读取（JSI） | 进度条实现可从"事件驱动"改成"同步读 + 事件补"，抖动更低 |
| 播放诊断 trace（core `playbackTrace` + `services/playbackTrace.ts`） | 解析链 trace 不变；新增 RNTP 事件日志（MediaItemTransition / PlaybackError / PlaybackStateChanged） | 失败归因链路（#357/#385）继续可用 |
| Expo Go 分支（`audioPlayer.ts:19-23`、`notificationService.ts:10-14`） | 全部删除：RNTP 在 Expo Go 里**直接抛错**（`src/trackPlayerModule.ts` 的 Proxy 文案含 "You are not using Expo Go"） | 见 §4.5 |

---

## 4. 改动量

> 全部为**估算区间**（依据：现有文件行数 + 需要保留/替换的行为面），未实做，故不写单点值。

### 4.1 JS 文件与 LOC

| 文件（现状行数） | 动作 | 估算 |
|---|---|---|
| `services/audioPlayer.ts`（**654 行**） | 整段重写为 RNTP 适配层，但**保留导出面**（playSong / togglePlay / seekTo / initAudio / cleanup / fetchLrcInBackground / resolvePlayableUrlMobile）让 18 个 import 点不动 | 改写 **~600–900 行**（净 +0 ~ +150） |
| `services/trackPlayerQueue.ts`（新） | 窗口填充器：预解析未来 N 首 + 与原生队列同步 + 事件→store + 失败处置（接 core skipGuard） | **+250–400** |
| `services/trackPlayerService.ts`（新） | `registerPlaybackSession`/`addEventListener` 注册与事件分派 | **+120–220** |
| `stores/playerStore.ts`（85 行） | 加队列-原生同步字段 + persist（对比 `settingsStore.ts:50,73`） | **+60–120** |
| `services/notificationService.ts`（121 行） | 删除（仅保留 `requestNotificationPermission`，可并入新文件） | **-121（+~20）** |
| `app/_layout.tsx` | 去通知响应监听（`:122-140`）、`initAudio` → `setupPlayer` + 服务注册（`:110`） | **-40/+30** |
| `components/PlayerBar.tsx` / `PlayerOverlay.tsx` | 播放态改读镜像/RNTP hooks（`PlayerOverlay.tsx:356,637,822` 等 togglePlay/seekTo 调用点可不动） | **+20–60** |
| `app.json`（去 expo-audio plugin `:28-33`）/ `package.json` | 依赖与插件替换 | **-8 / ±1** |
| `__tests__/audioPlayer.test.ts`（**938 行**） | 现有 expo-audio mock（`:92` 起）与断言几乎全废 → 重写为新 mock（TurboModule + 事件） | 重写 **~700–1000 行** |
| `__tests__/notificationService.test.ts`（64 行） | 删除或改写为权限测试 | **-64/+30** |
| `__tests__/downloadService.test.ts`（`:114` 处 mock expo-audio） | 跟着改 mock | **±10** |
| 新增测试（窗口填充 / 失败处置 / 队列同步） | — | **+200–400** |

**合计**：改写/新增 JS **约 900–1400 行**（不含测试），删除约 200 行；测试面重写约 1000 行。

### 4.2 新增 / 删除文件

- 新增：`services/trackPlayerQueue.ts`、`services/trackPlayerService.ts`（或合并成一个）、`android/app/src/main/res/drawable/ic_stat_music_note.xml`、`android/app/src/main/res/raw/keep.xml`、2–3 个测试文件。
- 删除/大幅收缩：`services/notificationService.ts`（121 行）。
- 修改（原生）：`AndroidManifest.xml`（删 expo-audio service）、`proguard-rules.pro`（补 keep）、`app.json`、`package.json`。
- 需要额外核对的**入口注册点**：V5 文档要求 `registerPlaybackSession`/`registerBackgroundEventHandler` 在 `index.js` 里、`AppRegistry.registerComponent` 之前调用（`src/audio.ts:205-207, 234`）；本仓库入口是 `expo-router/entry`（`package.json:5`），`App.tsx` 只是个 `<Slot/>` 壳（`App.tsx:1-11`）→ 注册点应该放在哪（自定义 entry 文件 / `app/_layout.tsx` 顶层副作用）**需要实做时验证**（不确定；headless task 走的是模块加载时的副作用，只要模块被求值过就注册上了，风险可控）。

### 4.3 受影响的测试

- `packages/mobile/__tests__/audioPlayer.test.ts`（938 行）：全部与 expo-audio 播放器 mock 绑定 → 重写。
- `notificationService.test.ts`（64 行）：JS 通知消失 → 删除。
- `downloadService.test.ts:114`、`playbackTrace.test.ts`（涉及播放链路 mock）：跟随调整。
- CI 的 test 门槛：`package.json` 的 `test:run`（vitest）会跑这些，所以**必须先绿再合**（`.githooks/pre-commit` 强制 typecheck）。

### 4.4 CI / 发布影响

- **构建路径不变**：`release.yml:248-250` 就是 `./gradlew assembleRelease bundleRelease --no-daemon`（`build-mobile`，ubuntu-latest，Java 17，timeout 45min，`gradle/actions/setup-gradle@v6` 缓存）。新增一个带 codegen 的 TurboModule → 首次构建多出 codegen + Kotlin 编译（推断 **+2–4 分钟**），有 Gradle Build Cache（`gradle.properties:66` `org.gradle.caching=true`）后增量构建影响小；45 分钟上限压力不大。
- **APK 体积（估算，未实测）**：expo-audio 57.0.4 已经引入 media3 **1.9.0** 的 session/exoplayer/hls/dash/smoothstreaming + ui + datasource-okhttp（`node_modules/expo-audio/android/build.gradle`），RNTP V5 额外引入 **media3-cast 1.9.2 + mediarouter 1.7.0** + `kotlinx-serialization-json-jvm`（265,019 B）+ 自身 Kotlin 类与 media3 小版本抬升 → 推断 **+0.6–1.5 MB/ABI**（release 有 R8 + shrinkResources 再压）。若**同时保留** expo-audio，则是两套媒体栈并存（更贵，且 §2.3 的会话冲突）。
- **签名/版本号**：不受影响（`app/build.gradle:104-139` 的 env keystore 回退 + `:9,99-100` 从 app.json 读 version）。

### 4.5 「放弃 Expo Go 验收」的连带影响

1. **Expo Go 里根本起不来**：RNTP 用 `TurboModuleRegistry.getEnforcing('TrackPlayer')`（`src/NativeTrackPlayer.ts:97-110`），Expo Go 没有这个原生模块 → 抛错（文案里专门写了「You are not using Expo Go」）。任何 import 到播放链的页面在 Expo Go 下直接炸。
2. **仓库现有真机 e2e 脚本会失效**：`scripts/mobile-e2e.sh:37` 写死 `EXP_PKG="host.exp.exponent"`，`:348-356` 用 `am start -a android.intent.action.VIEW -d "exp://localhost:$PORT"` 冷启 —— 这正是 Expo Go 路径，RNTP 生效后必须改成 dev build 的显式组件 + dev-client deep link（PR #435 的 SKILL 文档已给出范例命令）。
3. **必须用 dev build / release APK 验收**：dev build 需要 PR #435 的 .dev 后缀（§2.5，当前未合并）；release APK 路径（R8 全开）才是**唯一能验证小图标/通知/序列化 keep 规则**的环境。
4. 与 #405 既有结论一致：`docs/research/2026-09-27-android-background-playback.md:15,473,504-509` 已经写明"用 Expo Go 验收后台播放不成立"、RNTP 属"最彻底但要重写播放链"那一档 —— 本次评估把它的**可行性与代价**量化了。

---

## 5. 风险清单

### 5.1 许可（最高优先级，非工程问题）

V5 的 `license.txt` 原文：免费仅限 "use by a private individual solely for personal, non-professional purposes (Personal Use), or … a qualified academic institution strictly for instructional or non-commercial research activities (Educational Use)"；**"Any use that does not strictly and entirely qualify … requires a commercial license, including any use within a for-profit company, non-profit organization, or government entity."** 商业许可条款还包含 ① 非竞争 ② **"Redistribution: This software may not be shared, distributed, or sub-licensed to third parties without explicit written permission"** ③ 违约即终止。

价格（rntp.dev/pricing）：**RNTP Pro €99/月 或 €999/年（1 个商用 App）**、**Studio €249/月 或 €2,499/年（≤5 个 App）**；白标/客户交付需另谈；"White-label & resale not permitted"。

对 MPlayer 的具体含义：仓库本身是 **PolyForm-Noncommercial-1.0.0**，但项目**公开分发 APK/AAB**、且使用者可能包含营利场景 —— 按 V5 条款，只要不是"私人个人非职业用途"，就要买商业许可；"再分发"条款与公开分发产物之间是否冲突，需要法务判断（**不确定**：这属于许可解释，不是技术事实）。相对地，V4 是 Apache-2.0 免费，但在我们栈上不可用（§1.3）。

### 5.2 维护与治理

- **单一厂商 + 部分闭源**：5.8.0 起的 npm 产物 gitHead 在公开仓库不存在（`bef3c2eb…` → GitHub 422），公开示例停在 RN 0.83.9，`main` 自 2026-06-01 无提交；GitHub Releases 停在 v5.7.0（5.8/5.9 只发 npm）。→ 我们**无法审阅最新实现的源码 diff**（只能看 npm tarball 里打包进去的 `android/src`）。
- **缓解**：tarball 含 Kotlin/Swift 源码，`patch-package` 仍可改（Gradle 从源码编库）；但这是一条"自己养 fork"的路，与许可条款（禁止再分发/需授权）也需要一起考虑。
- **issue 现状**：18 open；与后台最相关的一条 **#2662**（CarPlay/Android Auto 冷启动、进程被杀后 headless task 从未启动，事件投递不到 JS）仍 **open** —— 注意它描述的是"冷进程"，与我们"后台存活"场景不同，但说明这套投递实现仍在收敛中（5.9.2 才刚重建）。

### 5.3 升级漂移

- 5 个月内 12 个版本（5.1.2→5.9.2），且 **5.9.2 同时修了两处后台事件投递崩溃**，其中一处（`IllegalStateException: Tried to start task TrackPlayerServiceBridge while in foreground`）在报告方是 **83% 的崩溃量**（#2670 评论）—— 说明这条路径的稳定性只有"一个月量级"的验证。
- API 面演进快（extras 5.1.0、audioMixing 5.5.0、play-not-permitted 5.6.0、liveResumeBehavior 5.7.0、registerPlaybackSession 5.9.1）→ 锁版本 + 每次升级跑一遍 #405 验收清单是必须的。

### 5.4 与 @mplayer/core 解析链的关系

- **解析链本身不动**：`resolvePlayableSongRouted`（直连 3s 墙 → tier3 6s 预算 → 失败归因 `explainPlaybackFailure`）、`prefetchPlayableSong`、tier3 健康度定序（sourceSchedule）、试听版标记（#389/#392/ADR-0012）、`skipGuard`（#385）、`playbackTrace` 全部留在 JS/core。
- RNTP 替换的是**播放执行层**（expo-audio → 原生队列），因此"预取命中 → 秒开"的收益路径**依然成立**（甚至更好：命中后入队，切歌由原生完成，零 JS 时序）。
- 新增的耦合点：core 的 `Song` ↔ RNTP `MediaItem.extras`（只放 songId / nonFull / sourceType，Song 实体留在 Zustand）；以及"原生队列顺序"与 `playerStore.queue/currentIndex` 的一致性 —— 这是**新的、必须测试覆盖的不变量**（现有 `playerStore.next()` 的同步语义 `playerStore.ts:46-53` 会被"原生先动、JS 后补"取代）。

### 5.5 「后台不能解析 → 必须预解析 N 首」在 RNTP 里怎么落地

**前提**：原生队列里**只有已经被解析成直链的项**。因此设计目标是把"能不能切下一首"变成"队列里有没有已解析的下一首"，而把"解析"全部限定在 JS 还活着、且有时间的时刻。

1. **权威队列**：`playerStore.queue`（+ persist）是真相源；RNTP 原生队列是它的**窗口投影**：`[current, current+N)`。
2. **窗口填充**：`playSong` 成功后 + 收到 `MediaItemTransition` 时，若窗口 < N → 用**缓存命中优先**的路径取 URL（`cacheService.getCachedResource`，12h TTL + 5min 新鲜窗口 `audioPlayer.ts:50-53`），命中就 `addMediaItems([...])`；未命中则**只在前台**发起解析（直连 3s + tier3 6s 预算）。
3. **后台窗口只有 5 秒**：`EventBroker.TASK_TIMEOUT_MS = 5_000`（`EventBroker.kt`）。所以"在后台解析一首歌"基本必然超时 → **后台只做"入队已解析项/追加缓存命中项"**，绝不发网络解析请求（这条正好呼应 core 的"离线直接暂停不进解析链"）。
4. **队列耗尽续排**：V5 没有 PlaybackQueueEnded → 监听 `PlaybackStateChanged{state:'ended'}`；在 5s 窗口内尝试 `addMediaItems` 续排，续不上就 `stop()` + 镜像 store（对应现在的 `audioPlayer.ts:165-169`）。
5. **死链**：ExoPlayer 不自动跳 → `PlaybackError` → 走 core `decideAfterPlaybackFailure`：先 `replaceMediaItem(index, {url: 新解析})` + `retry()`（同曲 fresh 重试一次），仍失败则 `removeMediaItem(index)` + `skipToIndex(next)`（会话内坏歌记忆 + 上限 3 首）。**注意**：fresh 重试要发解析请求，因此它只在前台有把握完成（后台可先 skipToIndex，把重试留到回前台补）。
6. **N 取多少**：受"每首解析最坏 3s（直连墙）或 6s（tier3 预算）"与内存/带宽约束影响；建议 N = 3（与 skipGuard 上限 3 首同量级）并在实现时用真机测（**不确定：需要实测确定 N 与 tier3 命中率的关系**）。
7. **随机模式**是这条约束的最难点：core 的随机是"每次算一个不等于当前的 index"（`core/src/utils/queue.ts:29-36`），它**无法提前知道下一首是谁**，也就无法预解析；而 media3 shuffle 有确定的置换顺序但不外露。三条可选路：① 随机模式退化为"每次切歌时 JS 指定 skipToIndex"（牺牲后台推进）；② 自管"随机但不与当前重复"的本地置换（可预解析）；③ 接受 media3 shuffle 语义（预加载窗口对不上）。**这是落地时必须先拍板的设计点**。

### 5.6 R8 / shrinkResources（release 专有风险）

- 通知 smallIcon 按名字查（`TrackPlayerPlaybackService.kt:450-455`）+ shrinkResources（`gradle.properties:61`）→ 必须 tools:keep（§2.1）。
- V5 **不提供 consumerProguardFiles**（V4 有 `consumerProguardFiles 'proguard-rules.txt'`）→ kotlinx-serialization 的 @Serializable 类与 TurboModule 解析是 release-only 崩溃的高概率来源；现有 `proguard-rules.pro:12` 只保了 `com.facebook.react.turbomodule.**`。
- 验证动作：release 包上跑一遍「冷启 → 播放 → 锁屏图标/通知三键 → extras 读回 → browse tree（若用）」，这是**唯一**能暴露 keep 规则缺失的路径。

### 5.7 其他工程风险

- **两个真相源**（Zustand 队列 vs 原生队列）：必须单向写 + 事件回填 + 回前台对账；Bug 形态会从"曲末不切歌"变成"UI 与正在播的那首对不上"。
- **通知渠道重复**：现有 JS 通知用 `music-playback` 渠道（`notificationService.ts:56-60`），RNTP 的 `setupPlayer.android.notification.channelId` 若复用同名渠道，语义/重要度不同（现有 HIGH，RNTP 侧 `IMPORTANCE_LOW`，见 `TrackPlayerPlaybackService.kt:441`）→ 用户会有"通知突然变安静"的体感差异（**推断**：需真机确认渠道属性以先创建者为准）。
- **EventBroker 的反射兼容路径**：`EventBroker.kt` 为 RN 0.74 兼容用反射调 `addReactInstanceEventListener`；RN 升级若改动该方法签名，冷进程 backlog 刷新会失效（丢事件，不崩）—— 低概率、低影响（推断）。
- **iOS 不在本仓库**：`packages/mobile/ios` **不存在**（Android-only，CNG 反向）→ V5 的 iOS 要求（UIBackgroundModes、iOS 16+）当前不阻塞；将来补 iOS 时要另行处理（expo-build-properties 或手工 Info.plist）。
- **@rntp/player 的 web 构建**：包内 `src/web/*` 存在且 peerDep `shaka-player` 可选；本仓库移动端没有 web 目标，忽略即可（但 `react-native-web` 依赖在 `package.json:39`，若有人跑 `expo start --web` 会需要 shaka-player，**不确定**是否会报错）。

---

## 6. 结论（给决策的一句话）

- **技术上**：只有 `@rntp/player`（V5）可行，且它确实能一次解决 #405（原生队列推进）+ 通知上一首/下一首 + 锁屏元数据；接入的**原生改动极小**（无需 prebuild/config plugin），主要成本在 JS 播放链重写（~900–1400 行）与测试重写（~1000 行）。
- **商业上**：V5 的商业许可（€999–2,499/年起，或自定义平台授权）与"禁止再分发/白标"条款，对一个公开分发、非商业许可的仓库是**必须先做的决策**；V4 免费但在 RN 0.86 + 新架构上不可用。
- **如果要走自研路**：本次评估顺带确认了自研 Media3 模块需要补的正是 RNTP V5 已经实现的那几件（in-process headless 事件投递 + wakelock、per-URI headers、MediaLibraryService 通知、extras 透传、preload/cache），可以把 §3 的映射表当成自研模块的接口清单。

---

## 参考

**上游 / 官方（RNTP）**

- 官方文档：[Introduction](https://www.rntp.dev/docs/introduction)（V4 冻结声明 / V5 许可口径）、[Installation](https://www.rntp.dev/docs/installation)（RN 0.74+、新架构、Android「no additional steps」、iOS UIBackgroundModes）、[Playback](https://www.rntp.dev/docs/playback)（同步 API、repeat/shuffle、sleep timer、Error recovery / retry()、Background playback）、[Queue](https://www.rntp.dev/docs/queue)（MediaItem 字段、{uri, headers}、file://、extras、队列增删改）、[Events](https://www.rntp.dev/docs/events)、[Pricing](https://www.rntp.dev/pricing)（€99/€249 月费档）
- npm：[react-native-track-player](https://www.npmjs.com/package/react-native-track-player)（4.1.2 / 2025-08-12）、[@rntp/player](https://www.npmjs.com/package/@rntp/player)（5.9.2 / 2026-08-26）；registry 元数据：https://registry.npmjs.org/react-native-track-player 、https://registry.npmjs.org/@rntp/player（dist-tags、各版本发布时间、gitHead）
- 仓库：[doublesymmetry/react-native-track-player](https://github.com/doublesymmetry/react-native-track-player)；`v4` 分支 HEAD 94fe2c20（= v4.1.2）、`main` HEAD 2be767dd（2026-06-01，= v5.7.0）；公开 release 最新 [v5.7.0](https://github.com/doublesymmetry/react-native-track-player/releases/tag/v5.7.0)（2026-07-16）
- issues：[#2425 新架构支持跟踪](https://github.com/doublesymmetry/react-native-track-player/issues/2425)、[#2443 New Architecture Support](https://github.com/doublesymmetry/react-native-track-player/issues/2443)、[#2593 bridgeless 下 MusicService.emit() 全丢](https://github.com/doublesymmetry/react-native-track-player/issues/2593)、[#2603 RN 0.83/Expo 55 启动崩（TurboModule 解析）](https://github.com/doublesymmetry/react-native-track-player/issues/2603)、[#2530 Kotlin 2.1.x 编译失败](https://github.com/doublesymmetry/react-native-track-player/issues/2530)、[PR #2535（closed，未合并）](https://github.com/doublesymmetry/react-native-track-player/pull/2535)、[#2670 后台事件投递崩溃（5.9.2 修复）](https://github.com/doublesymmetry/react-native-track-player/issues/2670)、[#2662 冷启事件不投递](https://github.com/doublesymmetry/react-native-track-player/issues/2662)
- 源码（取自 npm tarball `@rntp/player@5.9.2` / `react-native-track-player@4.1.2`，路径为包内相对路径）：
  - V5 JS：`src/audio.ts`（registerPlaybackSession 205-225、registerBackgroundEventHandler 227-262、addEventListener 264-305、headless 注册 116-149）、`src/NativeTrackPlayer.ts`（TurboModule spec）、`src/trackPlayerModule.ts`、`src/events/index.ts`、`src/events/PlaybackStateChanged.ts`、`src/events/MediaItemTransition.ts`、`src/interfaces/MediaItem.ts`、`src/interfaces/PlayerConfig.ts`、`src/backgroundEvents.ts`
  - V5 Android：`android/build.gradle`（media3 1.9.2、kotlinx-serialization、codegen）、`android/src/main/AndroidManifest.xml` / `AndroidManifestNew.xml`、`.../trackplayer/EventBroker.kt`（TASK_TIMEOUT_MS = 5_000、in-process headless + wakelock、backlog）、`TrackPlayerTaskService.kt`（已 deprecated，改由 EventBroker 进程内投递）、`TrackPlayerPlaybackService.kt`（通知 provider 435-458、STATE_ENDED→"ended"）、`TrackPlayerModule.kt`（队列 API、MediaHeaders.clear()）、`HeaderInjectingDataSourceFactory.kt`、`models/TrackPlayerMediaItem.kt`（per-URI headers）
  - V4：`android/build.gradle`（AGP 4.2.2 / Kotlin 1.8.10 / kotlinaudio v2.1.0 / com.facebook.react:react-native:+）、`android/src/main/java/.../service/MusicService.kt`（:44 HeadlessJsTaskService、:96-99 START_STICKY、:743-757 legacy emit、:759-760 HeadlessJsTaskConfig）、`src/trackPlayer.ts`（registerPlaybackService）、`android/src/main/AndroidManifest.xml`

**RN / Expo / 平台**

- 本仓库：`packages/mobile/gradle.properties:39`（newArchEnabled）、`packages/mobile/app.json:9,26-33`（新架构 + expo-audio plugin）、`packages/mobile/android/app/src/main/AndroidManifest.xml:23-27`（expo-audio 服务）、`packages/mobile/android/app/build.gradle:101-139`（applicationId / R8 / keystore）、`packages/mobile/android/build.gradle:19`（jitpack）、`packages/mobile/android/settings.gradle:25-31`（Expo autolinking）、`.github/workflows/release.yml:191-286`（build-mobile）、`scripts/mobile-e2e.sh:37,348-356`（Expo Go 冷启路径）
- 已安装 RN 0.86.2 工具链：`node_modules/react-native/gradle/libs.versions.toml`（agp = 8.12.0、kotlin = 2.1.20）、`node_modules/@react-native/gradle-plugin/.../utils/ProjectUtils.kt:34`、`.../ReactRootProjectPlugin.kt:61-85`、`node_modules/react-native/ReactAndroid/.../defaults/DefaultNewArchitectureEntryPoint.kt:160-173`、`.../utils/DependencyUtils.kt:132-139,156-166`；`node_modules/expo-audio/android/build.gradle`（media3 1.9.0）
- [React Native Releases](https://github.com/facebook/react-native/releases)（0.86.2 = 2026-07-27；0.82 起旧架构不受支持）
- [expo-audio 官方文档](https://docs.expo.dev/versions/latest/sdk/audio/)（setActiveForLockScreen 与后台播放；本仓库 `audioPlayer.ts:518-537` 的用法）
- 本仓库既有调研：`docs/research/2026-09-27-android-background-playback.md`（第一部分平台机制、第三部分仓库映射、:473 / :504-509 的 RNTP 定位与取舍）

## 第三部分 · C：自写 Kotlin Expo Module 落地评估


> 评估对象：**#405「App 在后台时曲末不自动切下一首」的正解路径 D——自写 Kotlin Expo Module，由原生持有队列并原生推进**。
> 口径：平台/Expo 结论取官方文档与官方源码；仓库结论取当前工作副本 `D:\Playground\mplayer`（master `d4897fe`）与已安装依赖源码，全部给 `file:line`；能实测的都实测了（autolinking 探针、Gradle 缓存核查、RN autolinking 输出）。
> 不裁决：本文件只回答「这条路的落地足迹有多大、怎么接、风险在哪」，不评价它是否该走（见 `docs/research/2026-09-27-android-background-playback.md` 的候选路径对比）。
> 前提（沿用三份评估共用背景，不再重复论证）：expo-audio 后台不向 JS 投递状态事件 → **任何 JS 侧推进都不可能**，必须原生持有队列 + JS 活着时预解析 N 首直链喂原生。

## TL;DR（≤8 条）

1. expo-audio 的「播放半区」共 14 个 Kotlin 文件、**2800 行**（全部 19 个文件 4020 行），其中我们要抄的**最小内核只有 5 处、约 350 行**。
2. 自写模块 Kotlin 新增量估计 **750–1050 行**（≈ expo-audio 播放半区的 27%–38%），脚手架约 **40 行**（`package.json`/`expo-module.config.json`/`build.gradle`/`AndroidManifest.xml`）。
3. JS 侧净增 **350–600 行**（`services/audioPlayer.ts` 现 654 行需改写 ≈450 行），core 解析链（`resolvePlayableSongRouted`/`prefetchPlayableSong`/`skipGuard`/`explainPlaybackFailure`）**100% 保留、0 行改动**。
4. **接线成本接近 0 处 gradle 改动**：模块放进 `packages/mobile/modules/native-player/` 即被 autolinking 收走（实测 `resolve` 输出 gradle 工程名 `mplayer-native-player`、`sourceDir=<module>/android`），`settings.gradle`/`app/build.gradle` **都不用改**。
5. **AndroidManifest 也不用手工改 app 的**：`<service>`+FGS 权限写在模块自己的库 manifest，走 manifest merger 自动合入（第一手证据：`POST_NOTIFICATIONS` 就是这样从 expo-notifications 库 manifest 进 merged manifest 的）。
6. **media3 零冲突**：本仓库解析到的就是 **media3 1.9.0**（Gradle 缓存 13 个 `1.9.0` 产物 + expo-audio 预编译 POM 的 8 条 1.9.0 依赖）；新模块 pin 1.9.0 即可，**绝不要上 1.10.x**（会把 expo-audio 的 AAR 一起顶到未编译验证的版本）。
7. **一个 app 只能有一个 `MediaSessionService`**（media3 官方明文建议）→ 必须让 expo-audio 的 `AudioControlsService` 不再被激活（或直接移除 expo-audio），否则锁屏/车机里会出现两个 MPlayer。
8. 最大风险不是 Kotlin 行数，而是**策略分叉**：下移到原生后 core 的 `skipGuard`/失败归因/播放诊断 trace 无法原生复用，必须由 JS 在 `loadQueue` 时把 `policy`（autoSkip/上限/loopMode）推给原生、原生只做**最小可参数化兜底**，否则会出现两套跳歌策略。

---

## 一、以 expo-audio 自己的实现为模板

### 1.1 文件清单与职责（行数 = `read` 工具全文行数）

安装版本 `expo-audio 57.0.4`（`node_modules/expo-audio/package.json:5`）。**注意：本仓库用的不是这份源码编译出来的**——`expo-module.config.json:8-13` 声明了 `android.publication`，autolinking 走 `shouldUsePublication`，实际链接的是 `node_modules/expo-audio/local-maven-repo/expo/modules/audio/expo.modules.audio/57.0.4/expo.modules.audio-57.0.4.aar`；node_modules 里的 `.kt` 只是「同版本的源」，作为模板读它是对的，但**别指望改它能生效**。

播放链路（我们要抄的部分）：

| 文件（`node_modules/expo-audio/android/src/main/java/expo/modules/audio/`） | 行数 | 职责 |
|---|---|---|
| `AudioModule.kt` | **952** | 唯一的 Module 入口：`Name("ExpoAudio")`(:204)、音频焦点/静音模式/后台策略(:211-332)、`Class(AudioPlayer)`(:353)、`Class(AudioPlaylist)`(:663)；含 MediaSource 工厂 `:861-937` 与 `runOnMain`(:939) |
| `BaseAudioPlayer.kt` | **167** | ExoPlayer 的事件适配层：周期状态推送 `startUpdating`(:52-69，**只在 playing 时发**)、`installPlayerListeners`(:77-130)、`STATE_ENDED→didJustFinish`(:99-108)、`SharedObject.emit` 出口(:71-75) |
| `AudioPlayer.kt` | **292** | 单曲播放器：`ExoPlayer.Builder`(:37-56)、basic `MediaSession`(:67)、`AudioPlaybackServiceConnection`(:68)、`setActiveForLockScreen`(:100-124)、锁屏元数据(:126-139)、状态字典 `currentStatus`(:194-220) |
| `AudioPlaylist.kt` | **205** | 原生队列播放器：`ExoPlayer` 持有 mediaItem 列表，`add/insert/remove/next/previous/skipTo`(:107-164)、曲末由 ExoPlayer 推进并 `emit("trackChanged")`(:87-94,:195-204)；**57.0.4 无任何锁屏/FGS API** |
| `Playable.kt` | **48** | 播放对象公共接口（play/pause/seekTo/setVolume/currentStatus） |
| `AudioUtils.kt` | **38** | `buildBasicMediaSession(context, player)`(:34-38)：没接服务时用的裸 session |
| `service/AudioControlsService.kt` | **564** | `MediaSessionService` 子类：`onStartCommand`(:66-98)、`ensureForegroundNotification`→`startForeground(..., FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)`(:100-118)、**自建 MediaStyle 通知** `buildNotification`(:174-237)、`setCustomLayout`(:239-279)、`onUpdateNotification`(:319-321)、`MediaSession.Builder(context, MetadataInjectingPlayer(...)).setCallback(AudioMediaSessionCallback())`(:373-375)、`onGetSession`(:425-427)、`onBind`(:429-432) |
| `service/AudioMediaSessionCallback.kt` | **62** | `MediaSession.Callback`：`onConnect` 里**显式摘掉** `COMMAND_SEEK_TO_NEXT/PREVIOUS`(:28-31)，自定义 ±10s 命令(:36-37,:52-59) |
| `service/AudioPlaybackServiceConnection.kt` | **103** | JS/播放器 ↔ 服务的绑定：`bindWithService`(:32-51)、`onServiceConnected` 里把 `appContext` 塞进服务(:69) |
| `service/BaseServiceConnection.kt` | **141** | 绑定状态机(`ServiceBindingState` :16-22) 与 `startServiceAndBind`(:117-139，`BIND_AUTO_CREATE|BIND_INCLUDE_CAPABILITIES` :130-135) |
| `service/MetadataInjectingPlayer.kt` | **93** | `ForwardingPlayer` 包一层，让锁屏元数据能独立于 mediaItem 更新(:39-49,:51-80) |
| `AudioPreloadManager.kt` | **55** | 整段字节预载到内存 + `InMemoryDataSourceFactory`(:13-55) |
| `AudioExceptions.kt` | **65** | 错误类型与文案装配 |
| `RingerModeReceiver.kt` | **15** | 铃声模式广播（静音模式下是否出声） |

合计（播放半区 14 文件）= **2800 行**。与之无关的录音/流媒体半区：`AudioRecorder.kt` 489、`AudioStream.kt` 214、`AudioRecordingService.kt` 202、`AudioRecordingServiceConnection.kt` 153、`AudioRecords.kt` 162 = 1220 行；全部 19 文件 **4020 行**。

### 1.2 「我们要抄的最小内核」= 5 处（约 350 行）

| 抄什么 | 模板位置 | 我们要做的差异 |
|---|---|---|
| **① ExoPlayer 创建**（looper/audio attributes/seek 增量/DataSource 工厂） | `AudioPlayer.kt:37-56`；headers 走 OkHttp 的工厂 `AudioModule.kt:883-889`；按 scheme/类型选 MediaSource `AudioModule.kt:925-937` | 直链几乎都是 `progressive`，可只留 `ProgressiveMediaSource.Factory` + `DefaultDataSource`（DASH/HLS/SS 三支可删）→ 省 ~40 行 |
| **② `MediaSessionService` 绑定**（startService + bindService、绑定状态机） | `BaseServiceConnection.kt:117-139`、`AudioPlaybackServiceConnection.kt:32-51`；服务端 `onGetSession`/`onBind` `AudioControlsService.kt:425-432` | **我们要反过来**：不是「JS 对象去 bind 服务」，而是「模块向已存在的服务拿控制器」。绑定状态机保留，方向反转 |
| **③ `MediaSession`**（Builder + Callback + Controller 授权） | `AudioControlsService.kt:373-375`、`AudioMediaSessionCallback.kt:14-44` | 我们要**加回** `COMMAND_SEEK_TO_NEXT/PREVIOUS`（expo-audio 是故意摘掉的，:28-31），因为原生队列才是正解 |
| **④ 通知 provider** | expo-audio **自己写**了 564 行的 MediaStyle 通知；media3 官方是 `MediaNotification.Provider`（`setMediaNotificationProvider`，默认实现即可） | **不要抄 `buildNotification`**：用 media3 默认 provider（自带上一首/播放暂停/下一首 + 进度条），只保留「通知点按回 App」的 `PendingIntent`（模板 `AudioControlsService.kt:154-162`）→ 省 ~170 行（`AudioControlsService.kt:120-127,154-237,281-317`） |
| **⑤ 事件 emit 方式** | 模块级 `sendEvent(name, Map)`（`Module.kt:46-52`）；SharedObject 级 `emit`（`SharedObject.kt:44-81`） | **必须用模块级 `Events(...)`+`sendEvent`**，理由见 1.3 与 2.4 |

### 1.3 不能抄的三处（原位扩展为什么不行）

1. **播放器挂在 JS 对象上**：`ExoPlayer` 是在 `AudioPlayer`（`SharedRef<ExoPlayer>`，`BaseAudioPlayer.kt:32-37`）构造时创建的（`AudioPlayer.kt:37-56`），而 `sharedObjectDidRelease()` 会 `releasePlayer()`（`BaseAudioPlayer.kt:153-160`）；`AudioModule.OnDestroy` 直接 `players.values.forEach { it.ref.stop() }`（`AudioModule.kt:338-340`）。**JS 运行时一销毁，播放器就没了**——与「原生自持队列」的目标完全相反。
2. **服务依赖 AppContext**：`AudioControlsService.appContext` 由 JS 侧连接塞进来（`AudioPlaybackServiceConnection.kt:69`），`startForeground` 的通知投递走 `appContext.mainQueue`（`AudioControlsService.kt:286-291,368-393`）。**没有 JS 就没有 appContext**，服务无法自持。
3. **事件出口会静默丢弃**：`SharedObject.emitInternal` 在拿不到 JS 对象或 `jsiContext` 时直接 `return`（`SharedObject.kt:66-68`）；模块级 `sendEvent` 在 `moduleHolder.safeJSObject == null` 时也直接 `return`（`KModuleEventEmitterWrapper.kt:47-49`）。→ **原生推进绝不能以「事件送达 JS」为前提**。

---

## 二、最小模块设计（只到接口层）

命名约定：目录 `packages/mobile/modules/native-player/`，包名 `@mplayer/native-player`（→ gradle 工程名 `mplayer-native-player`，由 `android.js:133-135` 的 `convertPackageToProjectName` 决定）；Kotlin 包 **`expo.modules.mplayerplayer`**（刻意落在 `expo.modules.*` 下，白蹭 `app/proguard-rules.pro:15` 的 keep 规则）。

### 2.1 Kotlin 侧文件/类（含 LOC 估计）

| 文件 | 类/职责 | LOC |
|---|---|---|
| `PlayerService.kt` | `class PlayerService : MediaSessionService()`：`onCreate` 建 ExoPlayer+MediaSession、`onGetSession`、`onTaskRemoved`、`onUpdateNotification`（用 media3 默认 provider）、`onDestroy`；内嵌 `SessionCallback : MediaSession.Callback`（授权 + 自定义命令） | 200–260 |
| `PlaybackController.kt` | ExoPlayer 装配（AudioAttributes+`handleAudioFocus=true`、`setHandleAudioBecomingNoisy(true)`）、`DataSource.Factory`（OkHttp + 每首 headers）、`Player.Listener`→内部状态、错误→`PlayerError(code,message)` 映射 | 150–200 |
| `QueueStore.kt`（+`TrackRecord`） | 原生队列：`trackKey/songId/uri/headers/title/artist/album/artworkUrl/durationMs`，`revision`（JS 推来的队列版本号）、`aheadCount`、`append/upsert/clear/current/peekNext` | 90–130 |
| `AdvancePolicy.kt` | 曲末决策：`loopMode(single/all/off)`、窗口耗尽判定、`autoSkip`+`skipLimit`（默认 3，与 core `SKIP_LIMIT` 对齐）、死链跳过上限、终局暂停 | 80–120 |
| `PlayerModule.kt` | Expo Module DSL：`Name("MPlayerNativePlayer")`、`Events(...)`、`loadQueue/patchQueue/play/pause/next/prev/seek/setLoop/setRate/getState/stop` | 160–220 |
| `PlayerBridge.kt` | `object`：服务实例注册表（`@Volatile var service`）+ 模块↔服务的唯一通道（**不依赖 AppContext**） | 30–50 |
| `Events.kt` / `ErrorCodes.kt` | 事件名常量、错误码枚举、payload 构造 | 40–80 |
| **合计** | | **750–1050** |

脚手架（≈40 行）：`package.json`、`expo-module.config.json`（`{"platforms":["android"],"android":{"modules":["expo.modules.mplayerplayer.PlayerModule"]}}`）、`android/build.gradle`、`android/src/main/AndroidManifest.xml`。模块的 `build.gradle` 里**不需要**写 `compileSdk/minSdk`（`expo-module-gradle-plugin` 自动注入，`ProjectConfiguration.kt:69-81`），也**不需要**显式依赖 expo-modules-core（插件加了 `compileOnly`，`ProjectConfiguration.kt:59-67`）。

### 2.2 JS 桥接 API（`src/index.ts` + `src/NativePlayer.types.ts`）

```ts
// 用 requireOptionalNativeModule：iOS/Web 没有这个模块时必须能优雅降级（expo-audio 的 JS 侧
// 用的是 requireNativeModule，见 node_modules/expo-audio/src/AudioModule.ts:8）
const Native = requireOptionalNativeModule<NativePlayerModule>('MPlayerNativePlayer');

type Track = {
  key: string;        // 稳定主键（用 core 的 song.id；无 id 时用 url hash）
  songId?: string;
  uri: string;        // 已解析好的直链（http/https/file）
  headers?: Record<string, string>;  // UA / Referer —— 由 JS 侧按源算好（core refererForSourceKey）
  title?: string; artist?: string; album?: string; artworkUrl?: string;
  durationMs?: number; nonFull?: boolean;
};

// 全量装载（切队列/换歌单/恢复）
loadQueue(args: {
  revision: number;            // 单调递增；原生只接受 >= 当前 revision
  tracks: Track[];
  startIndex: number;
  playWhenReady: boolean;
  loopMode: 'off' | 'all' | 'single';
  policy: { autoSkip: boolean; skipLimit: number; prefetchAhead: number };
}): Promise<{ accepted: boolean; state: PlayerState }>;

// 增量补齐（预解析窗口喂进来的新歌）— 幂等，可重复投递
patchQueue(args: {
  baseRevision: number;        // 必须等于原生当前 revision，否则拒绝（返回 stale:true，JS 重新 loadQueue）
  append?: Track[];            // 追加到队尾
  upsert?: Track[];            // 按 key 覆盖/插入（新 URL 重试场景）
  removeKeys?: string[];
}): Promise<{ accepted: boolean; revision: number; stale?: boolean }>;

play(): void; pause(): void; next(): void; prev(): void;
seek(seconds: number): void;
setLoop(mode: 'off' | 'all' | 'single'): void;
setRate(rate: number): void;
getState(): PlayerState;       // 同步取快照（回前台对账用）
stop(): void;                  // 用户显式停止 → 服务降为后台 + 撤通知
```

事件（模块级 `Events(...)`）：

| 事件 | payload | 语义 |
|---|---|---|
| `trackChanged` | `{ fromKey?, toKey, index, reason: 'auto'\|'user'\|'errorSkip', revision }` | 原生切歌（**曲末自动推进也走这里**）→ JS 用 songId 反查 `Song` 并同步 store / 写缓存 |
| `stateChanged` | `{ revision, index, playing, positionMs, durationMs, bufferedAhead, loopMode, rate }` | 播放/暂停/seek 后的状态快照；与周期进度分开（进度建议 1s 粒度，由原生 timer 推） |
| `ended` | `{ reason: 'queueExhausted'\|'windowExhausted'\|'stopped', index, revision }` | 队列播完 / 窗口耗尽 / 用户停 |
| `needMoreTracks` | `{ currentIndex, remaining, reason: 'lowWater'\|'hitHole' }` | 原生要 JS 补歌（**低水位或踩空**） |
| `error` | `{ key, code, message, willSkip: boolean }` | 原生播放错误；`willSkip=false` 时 JS 可覆盖决策（仅前台） |

**事件只做「通知」，不做「驱动」**：所有事件都可能因 JS 运行时不在而丢失（`KModuleEventEmitterWrapper.kt:47-49`）。因此每一条状态推进都必须同时反映到 `getState()` 的可轮询快照里，JS 侧的回前台对账逻辑（`AppState → 'active'`）以 `getState()` 为准。

### 2.3 原生队列消费 + 预解析窗口的接口约定

- **窗口语义**：JS 保证「从 `currentIndex` 起，原生手里已有 **N=3** 条已解析直链」（N 来自 `policy.prefetchAhead`；3 与 core tier3 的 K=3 同量级，便于复用已有并发闸门）。JS 用 `patchQueue({append})` 增量投喂，**不重发整表**。
- **低水位**：原生在 `aheadCount <= 1` 时发 `needMoreTracks{reason:'lowWater', remaining}`；同一水位只发一次（去重），补进来后复位。
- **踩空（窗口耗尽）**：原生推进到「队尾且下一首还没来」时**不空转、不报错**：
  1. `player.pause()`（保持 session + 通知，通知显示暂停态）；
  2. `windowExhausted = true`，发 `needMoreTracks{reason:'hitHole'}` + `ended{reason:'windowExhausted'}`；
  3. **保持前台服务**（FGS 不因暂停而立即撤，media3 默认在「所有播放停止」后降级，正好等于我们要的语义）；
  4. 等待 `patchQueue`；若等待超时（建议 60s，可配）仍无新歌：`stopSelf()` 并撤回通知（避免常驻通知惹用户）；
  5. 用户主动 `next()` 时若踩空 → 立即 `ended{reason:'windowExhausted'}`，不重试。
- **不变量**：原生**永不**自己发网络请求；原生**永不**自己决定解析哪首歌；原生的 `autoSkip` 只在 `policy.autoSkip=true` 且 `skippedThisSession < policy.skipLimit` 时生效——**策略参数的唯一来源是 JS（core 常量）**。
- **回前台对账**：JS 在 `active` 时 `getState()` → 若 `state.index !== store.currentIndex` 则以原生为准（后台期间发生的切歌全部补账）；若 `remaining < N` 立即补 `patchQueue`。

### 2.4 状态/错误语义与 core 的接线点（避免两套策略）

| core 能力 | 接线方式 |
|---|---|
| `resolvePlayableSongRouted` / `prefetchPlayableSong` | **完全留在 JS**；解析结果经 `loadQueue/patchQueue` 变成 `Track.uri + headers` |
| `refererForSourceKey` / `BROWSER_UA`（`audioPlayer.ts:499-505` 现算在播放处） | 前移到「构造 Track」处；原生只负责把 headers 塞进 `OkHttpDataSource.Factory`（模板 `AudioModule.kt:883-889`） |
| `skipGuard` / `explainPlaybackFailure` / `registerTerminalFailure` / 坏歌记忆 | **JS 保留**（前台）→ 通过 `policy` + `patchQueue({upsert})` 影响原生；原生的兜底只实现「连续失败达 `skipLimit` → 暂停」这一条最小规则 |
| 试听版 `nonFull` / `audioTagStore` 徽标 | 留在 JS（`Track.nonFull` 随事件带回，JS 写 tag） |
| `playbackTrace`（`setPlaybackTraceSink`） | 新增一条原生来源：`trackChanged/error` 事件带 `revision` + `reason`，JS 落进现有环形缓冲 |
| `playerStore` | 增加「以原生为准」的对账入口（`setState`），`queue/currentIndex` 的 source of truth 在后台期间是原生 |

---

## 三、在这个仓库里的接线方式（CNG 反向，重点核实）

### 3.1 local Expo module 怎么被 autolinking 收进来（实测）

- **默认搜索目录**：`nativeModulesDir` 默认 `./modules`（**相对 app root**，即 `packages/mobile/modules`）——`node_modules/expo-modules-autolinking/build/commands/autolinkingOptions.js:170-172`；官方文档同款表述：*"It searches local modules in the directory specified in ... `nativeModulesDir`, which defaults to `./modules/`"*（[Autolinking](https://docs.expo.dev/modules/autolinking/)）。
- **app root 是 `packages/mobile`**：`settings.gradle:20-32` 只调 `expoAutolinking.useExpoModules()`，而 `ExpoAutolinkingSettingsExtension.projectRoot` 默认 = `settings.rootDir` = `packages/mobile/android`（`ExpoAutolinkingSettingsExtension.kt:20`），autolinking CLI 就以该目录为 cwd 执行（`SettingsManager.kt:58-61`），app root 由「向上找 package.json」得到（`autolinkingOptions.js:119-128`）→ `packages/mobile`。
- **我自己搭了个探针 app 实测**（临时目录，已删除）：`<appRoot>/modules/mplayer-player/{package.json,expo-module.config.json,android/build.gradle,android/src/main/AndroidManifest.xml}`，且 **app 的 package.json 里没有任何依赖**：

  ```
  $ expo-modules-autolinking resolve --platform android --project-root <probe>/app --json
  {"modules":[{"packageName":"@mplayer/native-player","projects":[{"name":"mplayer-native-player",
    "sourceDir":".../app/modules/mplayer-player/android",
    "modules":[{"classifier":"expo.modules.mplayerplayer.PlayerModule","name":null}],...}]}]}
  ```

  → 证明三件事：**(a)** 不需要写进 app 的 `dependencies`；**(b)** gradle 工程名 = package name 转换（`android.js:133-135`）；**(c)** `sourceDir` 就是 `<module>/android`（`ExpoModuleConfig.js:129-142` 默认 `path: 'android'`）。
- **harness 侧自动 include**：`SettingsManager.link()` 对非 publication 的模块调 `settings.linkProject` → `include(":mplayer-native-player")` + `projectDir = <module>/android`（`gradle/SettingsExtension.kt:17-20`）。
- **谁把它加进 :app 的类路径**：`:expo` 这个 Android 工程 apply 了 `expo-autolinking` 插件（`packages/mobile/node_modules/expo/android/build.gradle:3`），该插件把每个非预编译模块 `dependencies.add("api", subproject)`（`ExpoAutolinkingPlugin.kt:38-45`）、预编译模块加成 maven 坐标（:72-77）。而 `:app` 通过 **RN autolinking** 依赖 `:expo`——实测 `expo-modules-autolinking react-native-config` 输出里 `expo` 有条目（`sourceDir=.../expo/android`、`packageInstance=new ExpoModulesPackage()`），**而 `expo-audio` 与 `expo-modules-core` 均为 `null`**（被 `androidResolver.js:35-40` 主动判掉，避免与 expo-autolinking 双重链接）。
- 结论：**新模块是「放进目录即生效」**，这也正是官方的 local module 流程（`create-expo-module --local` 生成 `modules/<name>`，见 [Get started](https://docs.expo.dev/modules/get-started/)）。

### 3.2 需要改 / 不需要改的文件（逐项回答）

| 文件 | 改？ | 依据 |
|---|---|---|
| `packages/mobile/modules/native-player/expo-module.config.json` | **新增** | 唯一必需的注册文件；字段见 [expo-module.config.json](https://docs.expo.dev/modules/module-config.md)（`platforms` + `android.modules` 全类名） |
| `packages/mobile/modules/native-player/package.json` | **新增** | `scanDependenciesInSearchPath` 要求目录里有 `package.json` 才认（`dependencies/scanning.js:13-30,60-74`） |
| `packages/mobile/android/settings.gradle` | **不改** | `:32` 已有 `expoAutolinking.useExpoModules()`（新模块由它自动 include） |
| `packages/mobile/android/app/build.gradle` | **不改** | `:171-197` 的 dependencies 里本来就不列 expo 模块；模块经 `:expo` 的 `api` 传递（见 3.1） |
| `packages/mobile/android/app/src/main/AndroidManifest.xml` | **不改（推荐）** | service/FGS 权限写进**模块自己的库 manifest**，由 manifest merger 合入（见 3.3） |
| `packages/mobile/android/app/proguard-rules.pro` | **不改**（前提是包名 `expo.modules.*`） | `:15` `-keep class expo.modules.** { *; }`；另外 expo-modules-core 自带 consumer rules（`expo-modules-core/android/build.gradle:95` + `proguard-rules.pro:15-18` keep 所有 `expo.modules.kotlin.modules.Module` 子类） |
| `packages/mobile/app.json`（config plugin 列表） | **不改** | 模块自带库 manifest，不依赖 config plugin；CNG 反向也不跑 prebuild，插件本来就不会执行（见 3.3） |
| `package.json`（mobile 的 dependencies） | **不改（可选）** | 若想 `import from '@mplayer/native-player'` 可用 `file:modules/native-player`；不想加依赖就用相对路径/tsconfig paths 导入 |
| `packages/mobile/android/gradle.properties` | **不改** | `org.gradle.caching=true`(:66) 会让新子工程的编译产物进 Build Cache |

> ⚠️ 与「CNG 反向」的唯一真正冲突点：**config plugin 永远不会跑**。官方在 local module 文档里明说「若项目已生成原生目录（android/ios）就**跳过** `npx expo prebuild --clean`」（[Get started](https://docs.expo.dev/modules/get-started/)），本仓库更进一步——CI 明确不 prebuild（`release.yml:246-250`、`ci.yml:63-67`）。因此**任何依赖 config plugin 改 manifest/权限的做法都不会生效**，必须落到「模块库 manifest」或「手工改 committed 的 app manifest」。

### 3.3 AndroidManifest 的 service 与 FGS 类型

**现状（已 committed，逐字来自 prebuild 的历史产物）**：`packages/mobile/android/app/src/main/AndroidManifest.xml:2-3` 的 `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK`，与 `:23-27` 的 `expo.modules.audio.service.AudioControlsService`（`exported=false` + `foregroundServiceType="mediaPlayback"` + `androidx.media3.session.MediaSessionService` intent-filter）——与 `node_modules/expo-audio/plugin/src/withAudio.ts:117-128` 的插件产物逐字一致。expo-audio 自己的库 manifest **只有** `MODIFY_AUDIO_SETTINGS`（`node_modules/expo-audio/android/src/main/AndroidManifest.xml:1-3`），因为它要求服务可开关。

**我们的做法（库 manifest 承载，不改 app manifest）**：

```xml
<!-- packages/mobile/modules/native-player/android/src/main/AndroidManifest.xml -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
  <application>
    <service
      android:name="expo.modules.mplayerplayer.PlayerService"
      android:exported="false"
      android:foregroundServiceType="mediaPlayback">
      <intent-filter>
        <action android:name="androidx.media3.session.MediaSessionService" />
      </intent-filter>
    </service>
  </application>
</manifest>
```

**第一手证据（库 manifest 会被 merger 合入 app）**：本机残留的 merged manifest（`packages/mobile/android/app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml`）第 **44 行**有 `POST_NOTIFICATIONS`，而 app 的 committed manifest 里没有这条——它来自 expo-notifications 的库 manifest（`node_modules/expo-notifications/android/src/main/AndroidManifest.xml:3`）。（`<service>` 合入机制同理，属标准 manifest merging；未在本仓库跑过一次带新模块的构建，此条为**高置信推断**，落地时必须 `./gradlew :app:processReleaseMainManifest` 验证一次。）

**FGS 类型与 targetSdk 36 的核对**：merged manifest 的 `minSdkVersion=24 / targetSdkVersion=36`（同上文件 `:7-9`）。官方 FGS 超时规则：**6 小时限额只适用于 `dataSync` 与 `mediaProcessing`**，`mediaPlayback` 不在其列（[Foreground service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout)）。→ 长时后台播放不会被 FGS 超时掐掉。

**「一个 app 只能一个 MediaSessionService」**：media3 官方 `MediaSessionService` 文档明确写 *"It's recommended for an app to have a single service declared in the manifest. Otherwise, your app might be shown twice in the list of the controller apps, or another app might fail to pick the right service..."*（[MediaSessionService](https://developer.android.com/reference/androidx/media3/session/MediaSessionService)）。因此落地时二选一：
- **(推荐) 停用 expo-audio 的会话**：JS 不再调 `setActiveForLockScreen`（现调用点 `services/audioPlayer.ts:518-525`）→ `AudioControlsService` 不会 `startService+bindService`，物理上只有一个 mediaPlayback 服务在跑；
- 或**彻底移除 expo-audio**（连带删掉 `app/src/main/AndroidManifest.xml:23-27` 与 `app.json:28-33` 的插件项）——它的唯一用处只剩 `setAudioModeAsync`（`services/audioPlayer.ts:1,74-78`），可由新模块自己 `setAudioAttributes(handleAudioFocus=true)` 覆盖。

### 3.4 与 `expo-build-properties` / `expo-audio` 的 media3 版本冲突核查

- **本仓库实际解析到的 media3 = 1.9.0**：本机 Gradle 缓存 `~/.gradle/caches/modules-2/files-2.1/androidx.media3/` 下 13 个 artifact 全部只有 `1.9.0`（`media3-common`、`session`、`exoplayer`、`ui`、`datasource`、`datasource-okhttp`、`exoplayer-dash/hls/smoothstreaming`、`extractor`、`decoder`、`container`、`database`）。
- **来源是 expo-audio 的预编译 POM**：`local-maven-repo/.../expo.modules.audio-57.0.4.pom:64-111` 8 条 `androidx.media3:*:1.9.0`（`runtime` scope）。expo-audio 源码里也 pin `def androidxMedia3Version = "1.9.0"`（`node_modules/expo-audio/android/build.gradle:29-37`）。
- **`expo-build-properties` 不碰 media3**：本仓库只配了 `usesCleartextTraffic/buildArchs/enableMinifyInReleaseBuilds/enableShrinkResourcesInReleaseBuilds`（`packages/mobile/app.json:34-47`），没有任何 media3/AGP/Kotlin 版本覆盖。
- **AGP/Kotlin/compileSdk 兼容性已被本次构建证明**：`compileSdk 36 / minSdk 24 / targetSdk 36 / AGP 8.12.0 / Kotlin 2.1.20 / buildTools 36.0.0`（`node_modules/react-native/gradle/libs.versions.toml:3-9,32`，经 `settings.gradle:36` `useExpoVersionCatalog()` 注入），而 1.9.0 的产物已经在同一套配置下编译/打包过 → **pin 1.9.0 无新增兼容风险**。
- **唯一禁忌**：不要在新模块里把 media3 提到 `1.10.x`。Gradle 默认取最高版本，会把 expo-audio 的 AAR 一起顶到它没编译验证过的版本（同一份 `MediaSession`/`MediaSessionService` API 面），且 media3 1.9.0 是**已发布 tag**（[androidx/media 1.9.0，2025-12-17](https://github.com/androidx/media/releases/tag/1.9.0)）。（1.10.x 与 1.9.0 的 API 差异未核，属**不确定**。）

### 3.5 R8 / proguard

- app 侧已开 `minifyEnabled + shrinkResources`（`gradle.properties:60-61`、`app/build.gradle:132-135`）。
- `app/proguard-rules.pro:15` 的 `-keep class expo.modules.** { *; }` 覆盖 `expo.modules.mplayerplayer.*`；即便不用这个包名，expo-modules-core 的 consumer rules 也会 keep 所有 `expo.modules.kotlin.modules.Module` 子类（`expo-modules-core/android/proguard-rules.pro:15-18`，由 `expo-modules-core/android/build.gradle:95` 以 `consumerProguardFiles` 发布）。→ **proguard 规则无需新增**（前提：模块类继承 `Module`；如果引入第三方库/反射加载的类，另说）。
- 服务类被 manifest 引用，AGP 会自动 keep manifest 组件（标准行为，未在本仓库单独验证 → **推断**）。
- **注意**：R8 只在 release 生效；dev build（`com.mplayer.mobile.dev`）走 debug，**必须额外用 release APK 验一次**，否则 keep 问题会在发版才暴露。

---

## 四、改动量

### 4.1 Kotlin 新增

- **750–1050 行**（表格见 2.1），另有 ~40 行脚手架；对比 expo-audio 播放半区 2800 行 = **27%–38%**。
- 相对模板的「省行」来源：不抄 564 行自建通知（用 media3 默认 provider）、不抄录音/流/预载（`AudioRecorder` 489 + `AudioStream` 214 + `AudioRecordingService` 202 + `AudioRecordingServiceConnection` 153 + `AudioRecords` 162 + `AudioPreloadManager` 55 = 1275 行）、不抄多协议 MediaSource 分支（DASH/HLS/SS）。
- 相对模板的「多行」来源：`QueueStore` + `AdvancePolicy`（expo-audio 的 `AudioPlaylist` 把队列语义全交给 ExoPlayer，没有「窗口/踩空/向 JS 要歌」的概念）+ `PlayerBridge`（Expo 模块与服务解耦这一层 expo-audio 没有）。

### 4.2 JS 侧新增/改写

| 文件 | 现状 | 动作 | 行数变化 |
|---|---|---|---|
| `services/audioPlayer.ts` | 654 行 | 播放驱动段（`:499-555` 建/换源/锁屏/通知 + `:105-171` listener）替换为原生桥调用 | **≈450 行改写**，净 ±0～-80 |
| `services/nativePlayer.ts`（新） | — | 桥封装：`requireOptionalNativeModule`、事件订阅、`getState` 对账、iOS 降级 | **+180～260** |
| `services/queuePrefetch.ts`（新） | `prefetchNextSong` 现在只预取 1 首（`:350-375`） | 改成窗口预取 N=3 + `patchQueue` 投喂 | **+80～120**（原 26 行删除） |
| `stores/playerStore.ts` | 85 行 | 加 `setState`（原生为准的对账入口） | **+15～25** |
| `app/_layout.tsx` | — | `:113-143` JS 通知权限/分类/按钮监听（后台按不了）收敛为「原生媒体通知」 | **-20～-30** |
| `services/notificationService.ts` | 121 行 | 通知与按钮职责整体移交给 media3 → 可删 | **-100**（或保留 `requestNotificationPermission` 供其它用途） |
| 模块自带 `src/index.ts` + `.types.ts` | — | 类型与 API 包装 | **+60～90** |

**净增 350–600 行**。

### 4.3 需要保留的 JS 解析链（0 改动）

`resolvePlayableSongRouted` / `prefetchPlayableSong` / `refreshPlayableUrl`（`audioPlayer.ts:248-254`）/ 缓存探活（`:436-473`）/ `fetchLrcInBackground`（`:266-323`）/ `handleTerminalPlaybackFailure`（`:193-236`）/ `pickNextPlayableSong`（`:179-182`）/ `playbackTrace` 全留。**唯一新增职责**：把解析结果「翻译」成 `Track`（uri + headers + 元数据）并投喂窗口。

### 4.4 受影响的测试

- `packages/mobile/__tests__/audioPlayer.test.ts`（**938 行**，mock harness `:29-100` 全部围绕 `createAudioPlayer/addListener/replace`）→ 需要整体换 mock 面（假原生模块 + 手动注入 `trackChanged/error` 事件），**改动 ≈150–250 行**；其中「切歌/跳歌护栏/试听版标记」等 10 个 describe（`:225-938`）语义不变、断言路径要改。
- 新增 `__tests__/nativePlayer.test.ts`（窗口管理、patchQueue 拒绝 stale、踩空语义、对账）**+200～350 行**。
- `__tests__/notificationService.test.ts`（64 行）→ 若删 JS 通知则连同删除（1 个 describe，`:46-52`）。
- 测试运行方式不变：`npx vitest run --config packages/mobile/vitest.config.ts`（`ci.yml:36`，include `__tests__/**/*.test.ts`，`vitest.config.ts:10-16`）。
- **原生行为无法用 vitest 覆盖**（队列推进/踩空/通知）→ 必须上 **dev build**（Expo Go 不能加载自定义原生代码）或 release APK 跑一次 `scripts/mobile-e2e.sh` 真机清单。

### 4.5 CI / 发布影响

- **workflow 改动：0**（`ci.yml:61-67` `./gradlew assembleRelease`、`release.yml:246-250` `./gradlew assembleRelease bundleRelease --no-daemon` 都能直接吃到新的 gradle 子工程）。
- **构建时间**：多一个 `:mplayer-native-player` 子工程（Kotlin 750–1050 行）的 compile+kotlin 任务；冷构建首次数十秒～2 分钟量级，热构建靠 `org.gradle.caching=true`（`gradle.properties:66`）+ `gradle/actions/setup-gradle@v6`（`ci.yml:56-60`）命中缓存。（**推断**，无数值实测。）
- **APK 体积**：media3 那 ~4.9MB 的 AAR（实测：`media3-common` 574.7KB、`exoplayer` 1613.2KB、`session` 878.1KB、`extractor` 779.8KB、`ui` 420.8KB、`datasource` 164.3KB、`exoplayer-hls` 219.2KB…）**本来就在包里**（expo-audio 带的），新模块的边际增量只有自己那点 Kotlin → **推断 dex 增量 ~20–80KB**（R8 后）。本机只有 debug APK（80.70MB，含 dev-launcher + 双 ABI）可作规模参照，**release 体积无本机实测**。
- **R8**：见 3.5，无需新增规则，但**必须用 release 验一次**。
- **iOS**：`packages/mobile/ios/` **不存在**（iOS 走 forward CNG），且 `release.yml` 只有 `build-desktop`(含 macOS 桌面) / `build-mobile`(Android) / `publish` 三个 job，**移动端 iOS 目前不在 CI 内**。若 `expo-module.config.json` 只写 `platforms:["android"]`，iOS autolinking 直接跳过（`ExpoModuleConfig.js:61-82`），但 JS 里必须用 `requireOptionalNativeModule`（`expo-modules-core/src/requireNativeModule.ts:32`）并在 `Platform.OS !== 'android'` 时回落到现有 expo-audio 路径——**这会让 iOS 继续保留 #405 的后台不切歌行为**（明确的跨端不一致，见风险 R5）。

---

## 五、风险清单

| # | 风险 | 依据 / 影响 | 缓解 |
|---|---|---|---|
| **R1** | **media3 版本被顶高** | 若新模块写 `1.10.x`，Gradle 取最高版本 → expo-audio 的预编译 AAR（编译期针对 1.9.0，POM `:64-111`）运行时升版，未验证 | 显式 pin `1.9.0`；或统一走 `expo-modules-autolinking` 的 `buildFromSource` 关掉 expo-audio 预编译（[Autolinking: buildFromSource](https://docs.expo.dev/modules/autolinking/)）后一起升级 |
| **R2** | **AGP/Kotlin 兼容** | 新模块走 `expo-module-gradle-plugin`（来自 expo-modules-core 57.0.12，`expo-module.config.json:12-20` + `ExpoModulesGradlePlugin.kt:14-45`），SDK 版本自动注入（`ProjectConfiguration.kt:69-81`）；Gradle 9.3.1 + AGP 8.12 + Kotlin 2.1.20 组合已有成功构建 | 不在模块里手写 `compileSdk/minSdk`；一旦报错优先查 `expo-module-gradle-plugin` 版本是否跟随 expo-modules-core |
| **R3** | **后台/Doze 存活** | 有 FGS 的进程不进入 cached 状态；官方 `mediaPlayback` 不受 6h FGS 超时约束（[FGS timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout)）。但**一旦 JS 运行时被冻结/销毁，事件全丢**（`KModuleEventEmitterWrapper.kt:47-49`、`SharedObject.kt:66-68`） | 原生推进零依赖事件（2.3 的不变量）；`getState()` 对账；不设 `android:process` 分隔进程（跨进程会让 `PlayerBridge` 失效，**推断**：需改用 media3 `MediaController`，成本 +150 行） |
| **R4** | **Doze/省电白名单** | AOSP：Android 14+ 进程进入 cached 后 **10s 被冻结**，冻结时**所有线程挂起**、且「若某 app 所有进程被冻结，系统会终止其 TCP socket」（[cached apps freezer](https://source.android.com/docs/core/perf/cached-apps-freezer)）。有 FGS 时不属于 cached，但 OEM 省电策略（MIUI/EMUI/ColorOS）仍可能额外杀 | 保留/补齐「省电白名单引导」（同 Symfonium/AIMP 做法，见 `docs/research/2026-09-27-android-background-playback.md:12`）；预解析窗口让**网络不在后台发生**，降低被杀概率 |
| **R5** | **通知与锁屏行为对齐** | 换 provider 后通知样式/按钮与 57.0.4 的 expo-audio 通知不同（后者只有播放/暂停 ±10s，`AudioControlsService.kt:190-233`）；且 JS 那条 expo-notifications 通知必须撤掉，否则**两条通知并存**（`docs/research/2026-09-27-android-background-playback.md:420`；调用点 `audioPlayer.ts:552,633,640`、`_layout.tsx:113-143`） | 用 media3 `DefaultMediaNotificationProvider` + `CommandButton`（上一首/播放暂停/下一首），删 JS 通知与按钮监听；`exported=false` 与 expo-audio 现网一致（`app/src/main/AndroidManifest.xml:23`），若要 Android Auto/Wear 可发现性再谈 `exported=true` |
| **R6** | **双端一致性（桌面端）** | 桌面走 Howler（Electron），与本模块无关：`src/` 下无任何 expo/RN 依赖，`packages/mobile/` 才是 RN 面 | 不动 `src/`；core 的解析/失败处置接口是双端共享的，改动必须留在 core 或纯 JS 层（本题属移动端原生实现，桌面端用 Howler，见 `AGENTS.md`「Architecture」节；同类方案对比见 `docs/research/2026-09-27-android-background-playback.md:474`） |
| **R7** | **长期维护成本（谁维护这段 Kotlin）** | 这是一段要跟 Android 版本、media3 大版本、Expo SDK 大版本同时演进的代码。竞品参考：Metrolist 用 media3 1.10.1 的 `MusicService : MediaLibraryService`、Retro Music 用旧 `MediaBrowserServiceCompat`（`docs/research/2026-09-27-android-background-playback.md:12`） | ① 把「平台适配层」压到最小（只用 `MediaSessionService` + `ExoPlayer` + 默认通知 provider，**不自己写通知**）；② 队列/策略语义留在 JS 的 core（参数化下发）；③ 在 `docs/agents/` 补一页「移动端原生播放模块边界」，把 media3 升级纳入 Expo SDK 升级清单；④ 若不想长期自己维护，同一接口面可用 react-native-track-player 4.x 平替（`docs/research/...:473,504-509`），但接口边界要提前设计成可替换 |
| **R8** | **策略分叉（我认为最该盯的一条）** | core 的 `skipGuard`/`explainPlaybackFailure`/坏歌记忆/trace 都在 JS；原生必须自带一份最小跳歌兜底，**两份策略会漂移** | `policy` 由 JS 下发（`autoSkip`/`skipLimit`/`loopMode`），原生只做「连续失败达上限 → 暂停」；原生每次跳过都发 `trackChanged{reason:'errorSkip'}` + `error`，让 JS 侧 core 计数与原生计数可对齐、可诊断（进 `playbackTrace`） |

---

## 参考

**仓库内（第一手，`file:line` 已在正文标注）**
- `node_modules/expo-audio/**`（57.0.4：`AudioModule.kt` 952 行 / `BaseAudioPlayer.kt` 167 / `AudioPlayer.kt` 292 / `AudioPlaylist.kt` 205 / `service/AudioControlsService.kt` 564 / `AudioMediaSessionCallback.kt` 62 / `AudioPlaybackServiceConnection.kt` 103 / `BaseServiceConnection.kt` 141 / `MetadataInjectingPlayer.kt` 93 / `AudioPreloadManager.kt` 55 / `Playable.kt` 48 / `AudioUtils.kt` 38 / `AudioExceptions.kt` 65 / `RingerModeReceiver.kt` 15）
- `node_modules/expo-audio/local-maven-repo/.../expo.modules.audio-57.0.4.pom`（media3 1.9.0 依赖清单）
- `node_modules/expo-audio/plugin/src/withAudio.ts`（service/FGS 权限的 config plugin 来源）
- `packages/mobile/node_modules/expo/node_modules/expo-modules-core/android/...`（`Module.kt`、`sharedobjects/SharedObject.kt`、`events/KModuleEventEmitterWrapper.kt`、`proguard-rules.pro`、`expo-module-gradle-plugin/`）
- `node_modules/expo-modules-autolinking/build/**`（`autolinkingOptions.js`、`autolinking/findModules.js`、`dependencies/scanning.js`、`platforms/android/android.js`、`ExpoModuleConfig.js`、`reactNativeConfig/androidResolver.js`）+ `android/expo-gradle-plugin/**`（`SettingsManager.kt`、`gradle/SettingsExtension.kt`、`ExpoAutolinkingPlugin.kt`、`ExpoAutolinkingSettingsExtension.kt`）
- `packages/mobile/android/{settings.gradle,gradle.properties,app/build.gradle,app/proguard-rules.pro,app/src/main/AndroidManifest.xml}`
- `packages/mobile/android/app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml`（merged 结果：minSdk 24 / targetSdk 36、POST_NOTIFICATIONS 合并、单一 mediaPlayback service）
- `packages/mobile/{app.json,package.json,tsconfig.json,vitest.config.ts,metro.config.js}`、`packages/mobile/services/audioPlayer.ts`、`packages/mobile/services/notificationService.ts`、`packages/mobile/stores/playerStore.ts`、`packages/mobile/app/_layout.tsx`、`packages/mobile/__tests__/audioPlayer.test.ts`（938 行）
- `.github/workflows/{ci.yml,release.yml}`、`node_modules/react-native/gradle/libs.versions.toml`
- 既有调研：`docs/research/2026-09-27-android-background-playback.md`（平台机制 / 同类 App / 候选路径 A–D）

**外部（可点开）**
- Expo Autolinking（`nativeModulesDir` 默认 `./modules`、`searchPaths`、`buildFromSource`）：https://docs.expo.dev/modules/autolinking/
- Expo Modules API: Get started（`create-expo-module --local` → `modules/`；已有原生目录则**跳过** prebuild）：https://docs.expo.dev/modules/get-started/
- `expo-module.config.json` 字段：https://docs.expo.dev/modules/module-config.md
- Module API（`Events` / `OnStartObserving` / `sendEvent` / Sending events）：https://docs.expo.dev/modules/module-api.md
- Media3 `MediaSessionService`（**单一 service** 建议、`onUpdateNotification` 与 `setMediaNotificationProvider`、manifest 片段）：https://developer.android.com/reference/androidx/media3/session/MediaSessionService
- Media3 后台播放（Background playback with a MediaSessionService）：https://developer.android.com/media/media3/session/background-playback
- Android 前台服务超时（6h 仅 `dataSync`/`mediaProcessing`，**不含 `mediaPlayback`**）：https://developer.android.com/develop/background-work/services/fgs/timeout
- AOSP cached apps freezer（Android 14+ 进 cached 10s 冻结、全线程挂起、杀 TCP socket）：https://source.android.com/docs/core/perf/cached-apps-freezer
- androidx/media 1.9.0 release tag（2025-12-17）：https://github.com/androidx/media/releases/tag/1.9.0
- expo-audio 官方文档（`setActiveForLockScreen` 与「约 3 分钟」限制）：https://docs.expo.dev/versions/latest/sdk/audio/
- expo/expo#46020（播放列表锁屏控件+上一首/下一首，合入 main、未进 57.x）：https://github.com/expo/expo/pull/46020
- 仓库 issue #405：https://github.com/fuzz1og/mplayer/issues/405

