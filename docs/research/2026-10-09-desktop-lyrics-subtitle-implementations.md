# 桌面歌词字幕（悬浮覆盖层）实现调研

> 调研日期: 2026-10-09
> 调研目标: 别的真实项目是怎么做「把当前歌词当字幕浮在桌面上（盖在其他窗口之上）」的，给 MPlayer 桌面端（Electron）+ Android 端定实现路线
> 调研方法: 直读参考项目的**源码**（`gh api …/contents` 逐文件取，非二手转述）+ 相关 OS API 官方文档（Electron custom-window-interactions、AOSP media-control）+ 本地对照 MPlayer 现有歌词链路
> 范围: 只调研不改代码。本文件即交付物，落地由 MPlayer 团队另行进行；iOS 不在本轮范围

---

## 0. TL;DR（结论先行）

1. **桌面端事实标准 = 「独立 `BrowserWindow` 覆盖层」，不是 `<webview>`/`BrowserView`。** 唯一被大量产品/复刻验证的形态是：新建一个 `frame:false` + `transparent:true` + `hasShadow:false` + `alwaysOnTop` + `skipTaskbar` 的无边框透明窗口，只装一个歌词 HTML。参考源码：`lyswhut/lx-music-desktop` 的 `src/main/modules/winLyric/`（最完整，含锁定/置顶/多显示器/DPI/鼠标穿透全部处理），`amadoncy/qq-desktop-lyrics`（给外部播放器 QQ 音乐做的同形态覆盖层）。
2. **鼠标穿透（点穿到下层窗口）靠 `setIgnoreMouseEvents(true, {forward:true})`，拖拽/配置靠「关掉穿透让它可聚焦」的态切换。** 由于开了穿透后窗口收不到 `mouseenter/leave`（Electron 官方文档原话「mouse movement events will not be emitted」），两家都用 **`screen.getCursorScreenPoint()` 定时轮询光标是否落在窗口 bounds 内**来判定 hover，再动态翻穿透态——**Linux 上这条整体失效**（`forward` 被硬关、轮询被跳过，见 lx-music `config.ts:22` `!isLinux`、`mouseCheckTools.ts:35` `if (isLinux…) return`）。
3. **高频歌词同步可绕开主进程**：lx-music 用 `MessageChannelMain` 建一条 `MessagePort`，主窗口渲染进程与歌词窗口**直传**（主进程只负责撮合通道，`rendererEvent.ts:31` 注释「without going through the main process」）。MPlayer 单窗口，其实更简单：主窗口把「当前行文本」经一条新语义通道推给覆盖层窗口即可（换行才发，频率极低）。
4. **Android 端只有两条可用主干：(a) 系统悬浮窗 `TYPE_APPLICATION_OVERLAY` + `SYSTEM_ALERT_WINDOW` 权限；(b) 把歌词塞进媒体通知/`MediaSession`——而 (b) 根本装不下逐行歌词**（AOSP media-control 文档确认通知是元数据 + 由 `PlaybackState` 生成的控制按钮，无逐行文本槽）。故**做「桌面字幕」只能走 (a)**。真实参考：`QuickLyric/QuickLyric`、`tcrrry/desktop-lyrics`（Kotlin）——两者都是「`NotificationListenerService` 读外部播放器当前曲 → `WindowManager` 在 Service 里 `addView` 一个 `TYPE_APPLICATION_OVERLAY`」。
5. **这两家 Android 参考读的是「别的 App 的通知」**（它们是给外部播放器配歌词的工具）。**MPlayer 自持播放，不需要这条**——播放进度与歌词都在我们自己的进程里（native-player 已 `MediaLibraryService`，JS 已有 `lyricLines`/`currentLineIdx`）。MPlayer 要补的只是：`SYSTEM_ALERT_WINDOW` 权限 + 一个把歌词行画成悬浮窗的原生入口。
6. **歌词数据面 MPlayer 现状只有「逐行」**：core `parseLRC`（`packages/core/src/utils/lyricsParser.ts:11`）只吃 `[mm:ss.xx]`、只出 `LyricLine{time,text}`；**逐字 karaoke（`<…>` 内联时间戳）、全局 `[offset:…]` 校正、双语译文**均未处理（`hasTranslation` 恒 false）。要做卡拉OK字幕需先扩 core。

---

## 1. 桌面端参考项目（逐个读源码）

### 1.1 `lyswhut/lx-music-desktop` —— 最完整的 Electron 桌面歌词（`src/main/modules/winLyric/`）

Vue3 + Electron。桌面歌词模块结构：`main.ts`（建窗 + 窗口事件）、`config.ts`（设置项→窗口态映射）、`rendererEvent.ts`（渲染层↔主进程 IPC）、`mouseCheckTools.ts`（光标轮询）、`utils.ts`（尺寸/DPI 夹紧）。逐条源码结论：

**建窗选项**（`main.ts` `createWindow()`，实测原文）：
```js
new BrowserWindow({
  x, y, width, height, minWidth, minHeight,
  useContentSize: true,
  frame: false,            // 无边框
  transparent: true,       // 透明背景
  hasShadow: false,        // 去阴影（否则透明区带矩形阴影）
  resizable: isWin,        // 仅 Windows 允许缩放；Linux 不许把窗设出屏外
  minimizable: false, maximizable: false, fullscreenable: false,
  roundedCorners: false,
  show: false,             // ready-to-show 再 show
  alwaysOnTop: isAlwaysOnTop,
  skipTaskbar: !isShowTaskbar,
  webPreferences: { nodeIntegration: true, contextIsolation: false,  // ← 旧安全模型，见下
    backgroundThrottling: false,  // ← 被遮挡/后台时不让 Chromium 降频，歌词才不断流
    webgl: false, spellcheck: false, enableWebSQL: false },
})
```
- 单独 `loadURL('…/lyric.html?os=&dark=&theme=')`——歌词窗口是**独立渲染进程 + 独立 HTML 页**，不是主窗口里的一个 div。
- ⚠️ 它用的是 `nodeIntegration:true + contextIsolation:false`（历史包袱）。**MPlayer 不能照抄**——我们的安全基线是 `contextIsolation:true` + preload 桥（`src/main/main.ts:149-159`、`src/main/preload.ts:35`）。覆盖层窗口应复用同一 preload，走受约束的 `window.electronAPI`。

**置顶（macOS/Windows 层级）**：`setAlwaysOnTop(flag, 'screen-saver')`——Electron 把 NSWindowLevel / Windows 层级映射成字符串档（`'floating'|'screen-saver'|…`，`screen-saver` 高于普通窗）。且有个 `alwaysOnTopTools.startLoop()`：**每 500ms 重发一次 `setAlwaysOnTop(true,'screen-saver')`**（`main.ts` 底部），因为覆盖层会被别的全屏/置顶窗挤下去，需要「续命」。注释还点明「linux 下每次重开貌似要重设置置顶」。

**鼠标穿透 + 拖拽**（这是最关键的一段）：
- 锁定态：`setIgnoreMouseEvents(true, { forward: !isLinux && isHoverHide })`（`config.ts:22`）。`forward:true` 让穿透时**仍把鼠标移动转发给下层**，用于 hover 判定；Linux 强制 `false`。
- 穿透窗收不到 enter/leave → `mouseCheckTools.ts` 每 **500ms** 取 `screen.getCursorScreenPoint()`，判断是否落进 `getBounds()`，进窗→解穿透（可拖/可右键菜单）、出窗→重新锁穿透；`runCheck` 里 `if (isLinux …) return`——**Linux 整条 hover 逻辑直接放弃**。
- 拖拽落位：窗 `move`/`resize` 事件里，只有「主动调整」（`isWinBoundsUpdateing`）才把 bounds 存进设置；否则 Windows 下把窗**弹回**存好的位置（`main.ts` `winEvent()` 的 `move` 分支）——锁定即靠这个「拖了也弹回」。

**多显示器 / DPI**（`utils.ts`）：所有位置存**绝对 x/y/w/h**，`getLyricWindowBounds()` 用 `global.envParams.workAreaSize`（主屏去掉任务栏的工作区）夹紧 `maxX/maxY`，`initWindowSize()` 首次落位到工作区右下。Electron 内部坐标是 DIP，与 `getCursorScreenPoint()` 同一单位——**缩放交给 Chromium DIP，项目自己不做 DPI 换算**（WSL HiDPI 例外，MPlayer 已有 `src/main/hidpi.ts` 处理）。

**歌词怎么送进窗口**（`rendererEvent.ts`）：主进程 `new MessageChannelMain()`，`port1` 交给主窗口侧的 desktop-lyric client（`sendNewDesktopLyricClient`），`port2` 经 `postMessage` 交给歌词窗口——之后逐行歌词/进度**在主窗口渲染进程 ↔ 歌词窗口之间经 MessagePort 直传，不过主进程**。设置项（字号/颜色/偏移）另走 `on_config_change` 事件。

### 1.2 `amadoncy/qq-desktop-lyrics` —— 给外部播放器（QQ 音乐）做的 Electron 字幕 + Windows SMTC

TS + Vite + Electron（`electron/` 目录：`main.ts`/`preload.ts`/`smtcSync.ts`/`smtcEnv.ts`/`smtcControl.ts`/`qqMusicApi.ts`）。价值在于它演示了**「覆盖层读的是别人的播放」**该怎么拿曲目与进度：

- 覆盖层建窗与 lx-music 同款（`main.ts:185` 起：`transparent:true, frame:false, hasShadow:false, alwaysOnTop:true, skipTaskbar:false`），穿透同样是 `setIgnoreMouseEvents(!interactive,{forward:true})` + `screen.getCursorScreenPoint()` 轮询——但这里把窗**分成上/下两块 hit zone**（`CHROME_HIT_HEIGHT=120` 顶栏、`CONTROLS_HIT_HEIGHT=80` 底栏），只有光标落在顶/底区才变可交互（`main.ts:44-60` `syncClickThroughHitTest`），中间歌词区始终穿透。
- **曲目/进度来源 = Windows SMTC**：用 npm 包 `windows-media-sessions`（Node 绑定 Windows `GlobalSystemMediaTransportControlsSessionManager`，靠随包的 `windows-media-sessions-backend.exe`，`smtcEnv.ts` 打包时解 `app.asar.unpacked` 路径）。`smtcSync.ts` 用 `getAllSessions()`/`onSessionsChanged()` 拿活动会话的 `timeline.positionMs`，并**本地插值**（`getInterpolatedPositionSec()`：`positionMs += Date.now()-anchor.at`）——因为 SMTC 的时间线更新稀疏，必须自己按挂钟补帧。**歌词按曲名去 QQ 音乐 API 匹配**（`resolveLyricsForTrack`）。
- **对 MPlayer 的意义**：这条 SMTC/MediaRemote 路线**是给不拥有播放的第三方工具用的**。MPlayer 自持播放，进度就在我们手里（桌面 Howler + `playbackClock`，Android media3），**不需要 SMTC 轮询、也不需要匹配外部曲目**——省掉一整个易碎的子系统。

### 1.3 用户预设的猜测：大多不成立，记下正确出处

- `Lyirico/Lyricify`（404）——真实是 **`WXRIW/Lyricify-App`**（7.3k★）：一款**C#/WPF 原生**滚动歌词软件（为 Spotify 等外部播放器供词），**不是 Electron**、也不是「桌面浮窗」而是滚动窗。另有 `Lyricify/Lyricify-on-Wine`。参考价值：证明 WPF 原生也能做，但对 Electron 路线无直接借鉴。
- `Sansyun/GetLyric`、`Xmader/GetLyric`（均 404）——`GetLyric` 一名多指网易云**歌词下载**工具（非悬浮字幕），与本特性不同题。
- `Marin-Maus/…`（未定位到相关项）。
- 顺带核实到的同类（**均可作次级参考，源码未逐一细读，标为待深读**）：`cqjjjzr/MusicBee-DesktopLyrics`（C#，为 MusicBee 供桌面词）、`tuberry/desktop-lyric`（**GNOME Shell 扩展**，JS）、`Ferry-200/desktop_lyric` + `qingyueyin/pure-player-lyric`（**Flutter/Dart**）、`brendonjkding/QQMusicDesktopLyrics`（Objective-C，iOS/macOS QQ 音乐）。

> **网易云音乐 / QQ 音乐官方桌面歌词**：闭源（CEF/原生），无法读源码验证内部实现，只能作**行为参照**（透明置顶条、逐行高亮、锁定/穿透、右键设置、跟随主窗或固定屏幕位置）。具体机件视为**未验证**。

---

## 2. 桌面端机制对比（Electron）

| 形态 | 怎么做 | 优点 | 代价 / 坑 |
|---|---|---|---|
| **独立 `BrowserWindow` 覆盖层**（lx-music / qq 都选它）| `frame:false transparent:true alwaysOnTop skipTaskbar` 新窗，装独立 lyric.html；独立渲染进程 | 可盖在其他 App 上、可点穿、可置顶续命、崩溃隔离、`backgroundThrottling:false` 保证不被降频 | 多一个窗=多一个渲染进程（内存）；穿透态 + 拖拽态要自己管；DPI/多屏要夹紧；Wayland 受限 |
| 主窗口内 CSS `position:fixed` 一个 div | 直接在主窗 DOM 画 | 零 IPC、零新进程 | **盖不到别的 App**——只在播放器窗口内。这**不是**「桌面字幕」，是「应用内歌词页」（=MPlayer 现有 `LyricsPage`） |
| `<webview>` / `BrowserView` | 把歌词页嵌进主窗或叠在主窗上 | 也独立文档/进程 | **同样只在应用窗口范围内**，出不了主窗边界去覆盖外部桌面——解决不了核心诉求；`<webview>` 官方还标注为不推荐 |

结论：**要「浮在桌面上、盖住别的窗口」，只有独立顶层 `BrowserWindow` 一条路**。其余三种都困在自己的窗口里。

**关键 API 清单（供落地对照，均已在 §1 源码里出现）**：`alwaysOnTop`（+ `setAlwaysOnTop(true,'screen-saver')` 层级/续命）、`transparent` + `hasShadow:false`（+ `backgroundColor:'#00000000'`）、`frame:false`、`skipTaskbar`、`focusable`（锁定态可设 `false` 进一步免抢焦点）、`setIgnoreMouseEvents(bool,{forward})`（穿透核心）、`screen.getCursorScreenPoint()` 轮询（hover 判定）、`getBounds/setBounds` + `workAreaSize` 夹紧（多屏/DPI）、`MessageChannelMain`（高频同步直传）、`backgroundThrottling:false`。

**覆盖层要不要「跟随主窗」**：两家参考都选了**固定/自由摆放 + 存绝对坐标**，而非跟随播放器窗移动。跟随主窗只在「播放器本身也是桌面上的独立窗」时才自然；MPlayer 主窗是常规窗，跟随意义不大。**建议默认固定位置（可拖），不做跟随**。

### 2.1 OS 陷阱（务必读）

- **Linux Wayland vs X11**（最硬的一道坎）：
  - X11 下覆盖层靠 override-redirect / `_NET_WM_WINDOW_TYPE_DOCK` 之类绕过合成器摆放；Wayland 协议**禁止客户端自设 surface 绝对坐标、也禁止强行盖在其他客户端之上**，Electron 在 Wayland 的透明置顶窗表现一贯不稳（这也是为什么 lx-music 在 Linux 上关掉 `forward`、跳过光标轮询、每次重开重设置顶——`config.ts:22/31`、`mouseCheckTools.ts:35`）。
  - `tuberry/desktop-lyric` 走的是**另一条 Linux 正解**：做成 GNOME Shell 扩展，代码跑在 **mutter 合成器进程内**（Clutter actor 画在桌面上），既不需要 overlay 权限、X11/Wayland 都吃——但那是 Shell 扩展，**不是 Electron**，Electron 应用享受不到。
  - 对 MPlayer：桌面端**先把 Windows + macOS 做扎实，Linux（尤其 Wayland）标为已知受限/尽力而为**。
- **macOS**：窗口层级用 `setAlwaysOnTop(true,'screen-saver')` 抬到普通窗之上；透明无边框在 mac 上工作正常（相对 Linux 省事）。注意 mac「全屏 Space」切换时覆盖层可能被隔离到别 Space——`fullscreenable:false` + 需要时重设层级。
- **Windows**：`transparent:true` 走分层窗（layered window）+ DWM，旧显卡/远程桌面对透明区可能有残影/闪烁；`hasShadow:false` 必设否则透明边缘有阴影矩形。任务栏/输入法候选条/通知条可能与底部覆盖层叠放冲突——`workAreaSize` 夹紧能避任务栏，避不开浮层通知。
- **录屏 / 截图**：置顶透明窗会被 OBS/截图正常拍到（它就是普通顶层窗）。若将来要「不被录进」需要特殊 window attribute，超出本轮范围。

---

## 3. Android 端机制

### 3.1 参考项目（读源码）

- **`QuickLyric/QuickLyric`**（528★，Java）：`services/NotificationListenerService.java`（读外部播放器**媒体通知**取当前曲）+ `services/LyricsOverlayService.java` + `view/OverlayLayout.java`。`OverlayLayout.java:57-68` 建窗：`TYPE_APPLICATION_OVERLAY`（API26+）/ 回退 `TYPE_PHONE`，flags `FLAG_FORCE_NOT_FULLSCREEN | FLAG_WATCH_OUTSIDE_TOUCH`（+`FLAG_LAYOUT_ATTACHED_IN_DECOR`/`FLAG_KEEP_SCREEN_ON`），`MATCH_PARENT`。清单权限 `SYSTEM_ALERT_WINDOW` + `NotificationListenerService` 绑定。**它是给第三方播放器配字幕的工具**，所以走通知监听。
- **`tcrrry/desktop-lyrics`**（Kotlin，近期）：同款主干——清单有 `SYSTEM_ALERT_WINDOW` + `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_SPECIAL_USE` + `POST_NOTIFICATIONS`；`MediaListenerService` 仍是 `NotificationListenerService`（读外部曲），`LyricsTileService` 是 QuickSettings 磁贴开关；**`LyricsOverlayService` 是一个前台 Service**，内部 `getSystemService(WINDOW_SERVICE)` 建 `WindowManager.LayoutParams`（`LyricsOverlayService.kt:715-735`）：`TYPE_APPLICATION_OVERLAY`、flags `FLAG_NOT_FOCUSABLE | FLAG_LAYOUT_IN_SCREEN | FLAG_HARDWARE_ACCELERATED | FLAG_KEEP_SCREEN_ON`、`gravity=TOP|START`、`layoutInDisplayCutoutMode=ALWAYS`；**歌词用 WebView 载 `file:///android_asset/lyrics_overlay.html` 渲染动画**，拖拽靠 `dragArea.setOnTouchListener`，缩放靠 resize 把手；权限门槛 `if(!Settings.canDrawOverlays(this))` → `startActivity(ACTION_MANAGE_OVERLAY_PERMISSION)`（`:322/:408`）。

> 两家都是**「读别人的通知 + 自己的悬浮窗」**。MPlayer 属于「自持播放」，**通知监听那半不需要**，但悬浮窗那半的机件完全可照搬。

### 3.2 三条候选路线对比

| 路线 | 能否显示逐行歌词 | 需要的权限/组件 | 关键约束 |
|---|---|---|---|
| **(a) 系统悬浮窗 `TYPE_APPLICATION_OVERLAY`** | ✅ 任意自定义（含动画/卡拉OK） | `SYSTEM_ALERT_WINDOW`（用户到「显示在其他应用上层」页手动授，`ACTION_MANAGE_OVERLAY_PERMISSION`）；在一个 **Service** 的 `WindowManager` 上 `addView` | 权限是「特殊访问」，非运行时弹窗，引导用户去系统设置页；后台需前台服务保活；各家 ROM（小米/华为）有额外悬浮窗开关 |
| **(b) 媒体通知 / `MediaSession`（Android 13+ 播控）** | ❌ **装不下逐行歌词** | 无需额外权限（就是现有通知） | AOSP media-control 文档确认：13+ 通知是元数据 + **由 `PlaybackState` 生成的动作按钮**（+ `setRemotePlaybackInfo`）；`DefaultMediaNotificationProvider`/`MediaPlayerManager` 暴露的是 title/artist/album/icon/actions，**没有放当前歌词行的文本槽**。最多把「正在唱的一句」塞进 `contentTitle` 之类的 hack，既丑又丢原曲名，且拿不到逐行时序。**不能当字幕方案** |
| **(c) 桌面小部件 / 锁屏 / 画中画(PiP)** | 小部件 ✅（限 App Widget 能力）；PiP ⚠️ | AppWidget 无需悬浮权限；PiP 需 activity | 小部件=HomeScreen 里的 `RemoteViews`，刷新受限、动画弱；PiP 是「小窗播放」语义，给歌词用很别扭。均非主流桌面歌词形态 |

结论：**Android 桌面歌词只有 (a) 悬浮窗是正经路子**，(b) 结构性做不了逐行字幕，(c) 只适合辅助。

### 3.3 从 Expo / 我们的 Kotlin 模块可达吗

**可达，且成本主要在权限而非窗口**——因为我们**已经有 `MediaLibraryService`（`PlayerService.kt:33`）**，而悬浮窗要求的就是「一个 Service 的 `WindowManager`」，Service context 天然满足（`tcrrry` 的 `LyricsOverlayService` 就是 Service 里 `addView`；我们不必再起一个独立 service，可挂在 PlayerService 上，或为清晰另立一个 overlay service）。要补的东西：

1. **清单加权限**：**其实已经有了** —— `packages/mobile/android/app/src/main/AndroidManifest.xml:8` 已声明 `SYSTEM_ALERT_WINDOW`（本仓 CNG 反向、原生目录进 git，权限写 app manifest 而非模块 manifest），但**全仓没有任何代码消费它**：`canDrawOverlays` / `WindowManager` / `ACTION_MANAGE_OVERLAY_PERMISSION` 零命中。所以这一步不是「加权限」而是「把已声明却闲置的权限真正接上」，并确认 manifest merging 后成品 APK 里仍在。模块清单 `native-player/android/src/main/AndroidManifest.xml:4-9` 只有 FGS 三件套 / `WAKE_LOCK` / `POST_NOTIFICATIONS` / `ACCESS_NETWORK_STATE`。
2. **expose 模块函数**（`PlayerModule.kt` `ModuleDefinition` 里，仿现有 `Function("play")…`）：`showLyricOverlay`/`hideLyricOverlay`/`setOverlayLyricLine(text, nextText)`/`setOverlayPosition/size`/`canDrawOverlays()`（读回权限态）。窗口用 `WindowManager` 从 `applicationContext`/`PlayerService` 拿（对齐 `tcrrry:72`）。
3. **权限流**：`Settings.canDrawOverlays(ctx)==false` → 从 JS 触发 `startActivity(Intent(ACTION_MANAGE_OVERLAY_PERMISSION, "package:$pkg"))`（需 `FLAG_ACTIVITY_NEW_TASK`，`tcrrry:408/821` 就这么做）；Expo 侧可用 `expo-modules-core` 的 `Intent` 或 `expo-application`。这是**特殊访问权限**，无法运行时弹窗，只能在设置页手动开。
4. **歌词时序怎么喂**：
   - 现状 native 侧进度只有 **1s 一跳**（`PlayerService.kt:91` 的 `progressTick`，`main.postDelayed(this, 1_000L)` 见 `:96`/`:133`；`emitProgress` `:241` 只发 `positionMs`）——**对逐行字幕够用**（换行本就 ~ 数秒一次），但别指望它做逐帧动画。
   - **推荐：把歌词文本留在 JS 侧算，只把「当前行」推给原生**。JS 已经有 `lyricLines`+`currentLineIdx`（`PlayerOverlay.tsx:94-95`，用 core `parseLRC`/`findCurrentLyricIndex` + `planLyricsFetch`，`:284/:321`）；换行时调 `setOverlayLyricLine(cur,next)` 一次即可。这样**复用现有 core 歌词逻辑、避免把 LRC 解析复制进 Kotlin、且 IPC 频率极低**。反方案（把整份 timing 表喂给原生、原生自己按 positionMs 定当前行）只在「要原生做逐字卡拉OK插值」时才值得。
5. **生命周期/杀进程**：悬浮窗随 `PlayerService`（`MediaLibraryService`）活着；被系统回收后需靠 media3 会话/前台服务重启（MPlayer 已有 `restoreSnapshot` 与 headless 补窗链路），overlay 需在 service `onCreate` 后按设置重建。任务被划掉→进程死→窗消失，重开 App 或系统重拉会话再复原。

### 3.4 「读别人播放」的可达性与后台限制（仅作对照，MPlayer 用不上）

`QuickLyric`/`tcrrry` 用 `NotificationListenerService` 读外部播放器通知（需用户授予「通知使用权」）。另一条是 `MediaSession` 轮询（`MediaPlayerManager`/`MediaBrowser`）读别的 App 的 now-playing。二者是**第三方工具**的无奈选择；**MPlayer 自持 `MediaLibrarySession`，进度与曲目都在自己进程内，不涉及跨 App 读取，也就不吃 Android 12+ 的后台执行/通知监听那套约束**。此节仅为「如果将来想让 MPlayer 给外部播放器供词」留档。

---

## 4. 歌词数据 / 时序面

- **逐行 vs 逐字（karaoke）**：MPlayer core `parseLRC`（`packages/core/src/utils/lyricsParser.ts:11`）只解析行级 `[mm:ss.xx]`，产出 `LyricLine{time,text}`，**不认**逐字内联时间戳（AMLL/Apple Music 那种 `<mm:ss.xx>` 逐字高亮需要扩展解析器 + 逐字插值）。`amadoncy` 有 `wordKaraoke` 开关但依赖 QQ 侧数据。
- **偏移校正（offset）**：标准 LRC 支持全局 `[offset:±ms]` 与逐行微调；MPlayer 现 `parseLRC` **不读 offset**（正则只抓时戳+文本，`:15`）。桌面歌词工具（`tcrrry` 有 `LyricOffsetMemoryActivity`）普遍把「按歌曲记忆偏移」作为一等功能。
- **双语/译文**：core 有 `hasTranslation` 字段但**恒 false、未真正拆译**（`:8/:36`）。覆盖层若要双语需先补这里。
- **无歌词兜底**：两端都已有「暂无歌词」态（桌面 `LyricsDisplay.tsx:62`，移动 `showLyrics` 空态）；`planLyricsFetch` 的 `none` 分支是唯一允许搜索补全的场景（`packages/core/src/shared/songLyrics.ts:54`、移动 `resolveLyricsText` `services/lyrics.ts:13`）。覆盖层应沿用「无词=隐藏或占位」，不新造逻辑。

---

## 5. 映射到 MPlayer 现有架构

### 5.1 桌面端（Electron）

| 关注点 | 现状（file:line） | 覆盖层要接的位 |
|---|---|---|
| 主窗建窗 | `src/main/main.ts:143` `createWindow()`（`frame:false, show:false`, 安全基线 `contextIsolation:true`+preload `:149-159`）| 新增 `createLyricOverlayWindow()`，选项照 §1.1（`transparent/hasShadow:false/alwaysOnTop/skipTaskbar/resizable:false/fullscreenable:false/backgroundThrottling:false`），**复用同一 preload**（不抄 lx-music 的 `nodeIntegration:true`） |
| 现成「推送另一窗」模板 | 托盘：渲染层 `src/renderer/store/playerStore.ts:1040` `ipcRenderer.send('tray:state', {songName,artist,isPlaying})` → 主进程 `src/main/main.ts:428` 收并更新 TrayManager | 桌面歌词同构：新增语义通道（如 `lyricOverlay:line`）由渲染层 `send` 当前行、主进程转发给覆盖层窗 `webContents.send`；若嫌主进程中转，可上 §1.1 的 `MessageChannelMain`（MPlayer 是单窗，直传收益有限，先用简单语义通道） |
| 歌词文本源 | 播放歌词在 `playerStore.lyrics`（声明 `:114`，装载 `loadLyricsWithRetry:46`→`set({lyrics})` `:628`）；取词 I/O 走 `callMusicApi('getLyrics'/'getNeteaseLyrics'/'getSodaLyrics')`（`musicApiContract.ts:24-37` BASE_METHODS） | 覆盖层不需要重新取词——从同一 `lyrics` 走。**桌面取词决策已收敛**：`loadLyricsWithRetry` 在 `:63` 消费 core `planLyricsFetch`（#608 / PR #614，术语见 `GLOSSARY.md`「取词单点」），覆盖层只订阅同一份 `lyrics`，**不得在覆盖层里另判一次源**，否则就成了第 5 处漂移 |
| 逐行当前句 | `LyricsDisplay.tsx:21` `parseLRC` + `:34` `usePlaybackSelector` 订阅 `playbackClock`（`playbackClock.ts`，采样 `DEFAULT_PLAYBACK_INTERVAL_MS=250` `:55`）派生 `findCurrentLyricIndex` | 覆盖层窗内同样 `parseLRC`+按 position 选行；position 用 IPC 从主窗随 `lyricOverlay:line` 带上，或覆盖层自持一份时钟。**换行才推**，250ms 采样落到覆盖层只画最终文本，无高频负担 |
| IPC/preload 契约 | `src/shared/electronAPI.ts:9` 只有 `invoke/send/on/removeListener`（channel 字符串驱动，`:11` 渲染层按通道断言类型）| 新通道是纯字符串语义通道，preload 桥不用动；只需主进程注册 handler + 覆盖层 `on`。sender 校验沿用 `checkIpcSender`（`main.ts:111`）——覆盖层页 URL 须纳入可信白名单 |

**桌面最小落地骨架（不在本调研实现）**：主进程加 `winLyric.ts`（仿 lx-music 模块）建覆盖层窗 + 一组 `setIgnoreMouseEvents/setAlwaysOnTop/setBounds` 导出；渲染层加一个极薄的 `lyric.html` 页组件（只画当前行 + 下一行 + 锁定/字号本地态）；`playerStore` 在换行处 `electronAPI.send('lyricOverlay:line', {cur,next,enabled})`；设置页加「桌面歌词：开/锁/置顶」开关（对齐现有设置 IPC 域 `src/main/ipc/appSettingsUpdate.ts`）。

### 5.2 Android 端（native-player）

- 需要**新增**到 `packages/mobile/modules/native-player/android/`：
  - `AndroidManifest.xml`：加 `SYSTEM_ALERT_WINDOW`（现仅 `:4-8` 的 FGS/WAKE_LOCK/POST_NOTIFICATIONS）。
  - 一个 `LyricOverlayController`（Kotlin）：持 `WindowManager`，`addView/removeView` 一个 `TYPE_APPLICATION_OVERLAY` 视图（`FLAG_NOT_FOCUSABLE|FLAG_LAYOUT_IN_SCREEN`，`layoutInDisplayCutoutMode=ALWAYS`——参数照 `tcrrry:715-735`）。视图可纯原生 `TextView`/自定义 View，或照 `tcrrry` 用 WebView 载 asset（**若要复刻我们在 `2026-09-23` 调研的 Apple-Music 式行激活动画，WebView/自绘都行**）。
  - `PlayerModule.kt` `ModuleDefinition` 里加 `Function`：`showOverlay`/`hideOverlay`/`setOverlayText`/`setOverlayFrame`/`hasOverlayPermission`；`AsyncFunction`/`Function` 触发 `ACTION_MANAGE_OVERLAY_PERMISSION` 跳设置。
- **JS 侧喂数**：复用 `PlayerOverlay.tsx` 已算好的 `currentLineIdx`（`:95`），换行处调用模块 `setOverlayText(cur,next)`。native 1s 进度跳（`PlayerService.kt:144/252`）作粗校正或不用。
- 触发路径与现有「JS 解析→喂预取窗口给原生播放器」同构（`nativePlayer.ts`/`PrefetchBridge.kt`），overlay 只是多一条「喂显示」的旁路，**不动播放/解析主链**。

---

## 6. 未决问题 / 需要决策（人来拍板）

1. **桌面：覆盖层用独立 `BrowserWindow` 已无悬念**（§2 三选一），但——**默认穿透还是默认可拖？** 两家参考默认「锁定=穿透」但提供 hover 解锁。建议：**默认锁定穿透**（更像桌面字幕、防误触），长按/托盘菜单解锁。**Linux（Wayland）是否作为一期目标**？（穿透+hover+置顶在 Wayland 已知受限，建议一期 Windows+macOS，Linux 尽力而为并单列风险）。
2. **桌面：歌词文本走「主进程中转（简单语义通道）」还是「`MessageChannelMain` 直传」**？MPlayer 单窗、换行低频，**倾向主进程一条语义通道**（照抄 tray:state 模式，最省）。直传只有在未来要逐字/逐帧高频同步时才有价值。
3. **桌面：覆盖层窗口是否复用现有 `contextIsolation` 安全基线并纳入 IPC sender 白名单**——必须，且 `will-navigate`/`setWindowOpenHandler` 拦截也要覆盖新窗（`main.ts:167-182` 现只挂主窗）。
4. **Android：悬浮窗 vs 通知——已定只能走悬浮窗**（§3.2 (b) 结构性不可行）。剩余决策：**(i) 挂在现有 `PlayerService` 上还是单起一个 overlay service**；**(ii) 歌词渲染用原生 View 还是 WebView asset**；**(iii) 时序留在 JS 推文本 vs 喂表给原生自算**（§3.3-4，倾向留 JS）。
5. **Android：权限引导 UX**——`SYSTEM_ALERT_WINDOW` 是特殊访问，须跳系统「显示在其他应用上层」页；首次开启的引导与拒授后的降级态要设计。ROM 差异（小米/华为额外开关）是否一期覆盖？
6. **歌词数据：一期是否要逐字卡拉OK / 双语 / offset 记忆？** 现 core 只有逐行（§4）。若桌面字幕要「比逐行更高级」，先扩 `parseLRC` 与 `hasTranslation`，这会牵动双端歌词渲染——建议**一期逐行 + 全局 offset，逐字/双语留后续**。
7. **是否要求覆盖层「跟随主窗」**：参考项目都不跟随；建议不跟随（固定可拖 + 记忆坐标）。

---

## 附：本次读到的源码/文档出处

- `lyswhut/lx-music-desktop`（Electron，桌面歌词最完整）：`src/main/modules/winLyric/{main,config,rendererEvent,mouseCheckTools,utils}.ts`
- `amadoncy/qq-desktop-lyrics`（Electron + Windows SMTC 给外部播放器）：`electron/{main,smtcSync,smtcEnv,qqMusicApi}.ts`（依赖 npm `windows-media-sessions`）
- `QuickLyric/QuickLyric`（Android，通知监听+悬浮窗）：`…/services/{NotificationListenerService,LyricsOverlayService}.java`、`…/view/OverlayLayout.java`、`AndroidManifest.xml`
- `tcrrry/desktop-lyrics`（Android，Kotlin，通知监听+`TYPE_APPLICATION_OVERLAY`+WebView）：`…/LyricsOverlayService.kt`、`…/MediaListenerService.kt`、`AndroidManifest.xml`
- 真实名纠正：`WXRIW/Lyricify-App`（C#/WPF，非 Electron，`Lyirico/Lyricify` 与 `*/GetLyric` 猜测均 404）；`tuberry/desktop-lyric`（GNOME Shell 扩展）；`cqjjjzr/MusicBee-DesktopLyrics`（C#）；`Ferry-200/desktop_lyric`、`brendonjkding/QQMusicDesktopLyrics`（Dart/OC，未细读）
- 官方文档：Electron Custom Window Interactions（`setIgnoreMouseEvents` + `forward`）；AOSP「系统 UI 中的媒体控件」（Android 13 通知=元数据+`PlaybackState` 动作按钮，无逐行歌词槽）
- 网易云/QQ 音乐官方桌面歌词：**闭源未验证**，仅作行为参照
- MPlayer 对照（本地）：`packages/core/src/shared/songLyrics.ts:54`、`packages/core/src/utils/lyricsParser.ts:11`、`src/main/main.ts:143/149/428`、`src/main/preload.ts:35`、`src/shared/electronAPI.ts:9`、`src/shared/musicApiContract.ts:24`、`src/renderer/store/playerStore.ts:44/114/628/1040`、`src/renderer/components/LyricsDisplay.tsx:21/34/62`、`src/renderer/services/playbackClock.ts:55`、`packages/mobile/components/PlayerOverlay.tsx:94/284`、`packages/mobile/services/lyrics.ts:13`、`packages/mobile/modules/native-player/android/src/main/AndroidManifest.xml:4`、`…/PlayerService.kt:33/91/241`、`…/PlayerModule.kt:133`
