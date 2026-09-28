# 方案 C 真机验收执行手册（#405）

> 配套 `docs/specs/2026-09-29-mobile-native-playback.md`。规格 §11.3 给的是**判据**（T1–T10），
> 这份给的是**操作与取证命令**，以及本机环境实测结论——实现落地后照表逐条跑、逐条填结论。

## 0. 环境与前置（2026-09-29 实测）

| 项 | 值 |
| --- | --- |
| 设备 | OnePlus PKB110 · Android 16 / ColorOS 16 · 1256×2760@560dpi · `adb` 序列号 `N7TOAIMFOJPFIV7D` |
| 已装包 | `com.mplayer.mobile`（1.8.4 release）、`com.mplayer.mobile.dev`（1.8.4-dev，由 PR #435 构建，2026-09-27 装机） |
| 引擎 | **Expo Go 不可用**（方案 C 是原生模块，`isExpoGo` 分支 + 插件不生效）→ 必须 dev build / release APK |

**拉起 dev client（实测可用）**——`-p` 不能省：release 与 dev 包都注册了 `mplayer` scheme，不指定包名会弹选择器（`ResolverActivity`）：

```powershell
adb -s N7TOAIMFOJPFIV7D reverse tcp:<port> tcp:<port>      # 端口可换；规格写 8081，本机实测用 8084 亦可
adb -s N7TOAIMFOJPFIV7D shell am start -a android.intent.action.VIEW \
  -d 'mplayer://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A<port>' -p com.mplayer.mobile.dev
```

**连通完成标准（两条都要看到）**：Metro 侧 `Android Bundled ... expo-router/entry.js (N modules)`；App 侧 logcat `Running "main"` **且** `[player] 存量数据迁移完成`。

### 可用能力自检（手册命令的前提）

| 能力 | 命令 | 结果 |
| --- | --- | --- |
| 媒体会话 | `dumpsys media_session` / `cmd media_session list-sessions` | ✅ |
| 媒体键（替代手按锁屏） | `input keyevent 87`(next) / `88`(prev) / `85`(play-pause) | ✅ |
| 通知 | `dumpsys notification --noredact` | ✅ |
| 杀进程 | `am kill <pkg>`（**必须带包名**，否则报 Exception） | ✅ |
| 断网 | `svc wifi disable && svc data disable`（用完记得 enable） | ✅ |
| 截图 | `adb shell screencap -p /sdcard/x.png` + `adb pull`（PS 5.1 下别用 `exec-out >`，会改编码） | ✅ |
| 列表滚动 | `input keyevent 20`（DPAD_DOWN）连打 | ✅（触摸滑动落点/惯性更难控） |

## P0 前置：dev build 包名后缀 —— **已验收通过**

| 判据 | 命令 | 结论 |
| --- | --- | --- |
| 两包共存 | `pm list packages \| grep mplayer` | ✅ `com.mplayer.mobile` + `com.mplayer.mobile.dev` |
| 两包都能启动 | release：`monkey -p com.mplayer.mobile -c android.intent.category.LAUNCHER 1`；dev：上面的深链 | ✅ 前台分别为 `com.mplayer.mobile/.MainActivity`、`com.mplayer.mobile.dev/com.mplayer.mobile.MainActivity` |
| dev 包连 Metro | 见 §0 | ✅ `Android Bundled ... (3486 modules)` + `存量数据迁移完成` |

**规格 §P0 的一处事实修正**：规格写「原 PR #435，已 CLOSED，必须重落」；实测 `gh pr view 435` 现在是 **OPEN**（`chore/android-dev-variant`）。master 的 `packages/mobile/android/app/build.gradle` debug 块仍无后缀，所以 P0 的落地动作是**合 #435 或 cherry-pick**，不是重写；设备上那个 dev 包就是它的产物。

## T1–T10 执行表

每条：**前置 → 操作 → 判据 → 取证命令**。结论栏实现落地后回填，格式 `T1 Pass — 后台连播 7 首 · <证据链接>`。

| # | 操作（在 §0 的环境里） | 取证命令 |
| --- | --- | --- |
| T1 | 队列 ≥6 首 → 播放 → 锁屏（`input keyevent 26`）→ 不动 3 分钟 → 回前台 | `adb logcat -v time \| Select-String 'trackChanged\|MPlayerNativePlayer'`；`dumpsys media_session \| Select-String 'MPlayerNativePlayer\|state='` |
| T2 | 锁屏下 `input keyevent 87 / 88` | 截图（锁屏元数据）+ 同 T1 的 logcat |
| T3 | 构造短 TTL/过期 URL 后等该项播放 | `adb logcat -v time \| Select-String 'playbackError\|errorSkip\|disposition'` |
| T4 | 播放中 `am kill com.mplayer.mobile.dev` → 从通知/媒体区恢复 | `dumpsys media_session`；`adb logcat \| Select-String 'onPlaybackResumption\|restore'` |
| T5 | 播放中 `svc wifi disable && svc data disable` | `adb logcat \| Select-String 'skipGuard\|offline\|pause'`；确认无解析链发起 |
| T6 | 展开通知/系统媒体区，逐曲观察 | 截图；`dumpsys notification --noredact \| Select-String 'mplayer'`（应只有**一条**媒体通知） |
| T7 | 后台播放中划掉任务卡（`input keyevent 187` 打开最近任务，再上滑） | logcat + 通知栏截图 |
| T8 | 队列只剩 1 首未播，等跨窗口边界 | `adb logcat \| Select-String 'MPlayerPrefetch\|needTracks'`（headless 起止） |
| T9 | 四种模式各跑一段（设置页切） | `adb logcat \| Select-String 'policy\|playMode'` + 截图 |
| T10 | 装 **release APK**（R8 全开）复跑 T1/T3/T6 | 同各条 + `adb install -r` 记录、小图标截图 |

## 留档约定

- 截图命名 `<PR 号>-<序号>-<用例>.png`，存仓库外（`%TEMP%\mplayer-acceptance\`），**不入库**；附到 PR 正文或验收评论见 `mobile-device-debugging` skill（`gh pr comment --attach`，传完要读回正文验引用）。
- 结论要**可复核**：每条给「操作 → 判据 → 证据」，没有证据就写「未做 + 原因」，不许写「已验证」而没证据。
- 收尾：停 Metro；`adb reverse --list` 确认隧道；把 `svc wifi/data` 恢复。

## 会阻塞验收的未决项（规格 §12 相关）

- **随机语义未定案**（规格 §7.3 / §P6 前置）：需要先写 ADR，否则 T9 的「随机」一项无判据。
- **R3（后台 core 墙钟是否触发）未定论**：T8 会直接暴露；若后台解析跑不完，P4 的降级形态才是实际可达。
- **T10 的 R8 keep 规则**要等 P1 的 proguard 片段落地才能验。


---

## 执行结果（方案 C 落地后，2026-09-29）

> 设备：真机 OnePlus PKB110 / Android 16（ColorOS）· 雷电模拟器 LDPlayer 14（Android 14 / x86_64，另起干净实例 720×1280）
> 构建：debug（`com.mplayer.mobile.dev`，arm64-v8a / x86_64）+ release（`com.mplayer.mobile`，R8+shrink，x86_64）
> 说明：tier3 订阅地址属敏感信息，只在设备上运行期配置，**不入库**。

| # | 结果 | 取证 |
| --- | --- | --- |
| T1 | ✅ 通过 | 雷电熄屏静置 30 拍全程 `PLAYING`；标题序列 `海屿你 → 明知故犯 → 遐想 → 甲乙丙丁 → 两 难`（**5 首连续自动推进**）；`isForeground=true` 30/30；`dumpsys media_session` 无第二会话 |
| T2 | ✅ 通过 | 熄屏后媒体键：`两 难 →(NEXT)→ 我不难过 →(PREV)→ 两 难 →(NEXT)→ 我不难过`，`metadata` 跟随 |
| T3 | ✅ 通过 | 真机真实过期直链（进程重启后恢复的旧快照）：`player error kind=expired` → `awaiting fresh url` → `retrying … after 1000ms` → `attempt 1/2/3` → `skip failed item … retries=3 skippedThisSession=1/3`；不卡死 |
| T4 | ✅ 通过 | `am force-stop` → 重启：`restored 89 tracks at index=5 position=0` + `PlayerService created` + `MediaController connected`；会话回到 `PAUSED`（**不自动续播**）；`FATAL EXCEPTION` 无 |
| T5 | ⏸ 未执行 | 需真机 USB（雷电飞行模式会断 adb，实测：`echo adb_ok` 返空、`127.0.0.1:5555` offline、重启 VM 后 adbd 未恢复）。手机当前离线，等重新接入 |
| T6 | ✅ 通过 | `dumpsys notification --noredact`：本包 **1 条**媒体通知；`android.title=两 难` / `android.text=加木`；播放中 `isForeground=true`、`onUpdateNotification startFG=true` |
| T7 | ⏸ 未执行 | 需设备可解锁划任务卡；雷电无 root 时 `am kill` 对前台服务进程是空操作（这本身是 FGS 生效的旁证），待用新实例补 |
| T8 | ✅ 通过 | `MPlayerPrefetch: task start id=11` / `task finish id=11` 成对出现（headless 任务真的起得来、跑得完）；配套 `patchQueue received → release prefetch window` |
| T9 | ⏸ 未执行 | 四种播放模式的设备侧验证（模式语义已有单测：`queuePrefetch.test.ts` 覆盖顺序/随机/单曲/绕回） |
| T10 | ◐ 部分通过 | **R8 充分性已证**：release 包 `PlayerService created` + `MediaController connected` + 媒体会话注册 + headless `task start/finish` + `LoadQueueInput/PatchQueueInput` Record 转换正常，无 `ClassNotFoundException`/`NoClassDefFoundError`。**播放复跑未执行**：release 应用需要 tier3 订阅，而该 emulator 实例的触摸注入不触发应用的 `ScalePress`（`+ 添加 URL 订阅` 毫无反应、无 Alert），原生 `Switch`/`TextInput` 正常 |

### 验收过程中发现并修掉的真实缺陷

1. **从来没有 `MediaController` ⇒ 没有媒体通知、没有前台服务**（`da94e53`）
   media3 1.9.0 字节码：`triggerNotificationUpdate()` 只遍历 `getSessions()`，而 `getSessions()` 仅在**有 controller 连接**时才有内容。JS 走自写 bridge，于是 session 从未注册 → 无通知 → 无 FGS → 系统 `Stopping service due to app idle`，后台播放断（真机表现为「连播 4 首后 PAUSED」）。
2. **过期项只等 1s 就盲重试，装不下 core 的 3–9s 解析链**（`5261c5c`）
   改为把 1s 当**下限**：发 `playbackError{retrying}` 后等 JS `patchQueue({upsert})`（10s 兜底）。
3. **进程重启后 JS 的 `playerStore.queue` 是空的**（`5261c5c`）
   `playerStore` 没接 persist，原生恢复了队列而 JS 不知道这些歌是谁 → 无法重解析、UI 空播放器。按 §4.3 补 `PlayerState.tracks` + `reconcileQueueFromNative()`（原生权威、JS 单向对账）。
4. **窗口边界处「下一首」静默失灵**（`bf8ec2d`）
   `next()` 踩空分支会 `pause()` 并向 JS 要歌，但补窗落地的续播条件写的是 `playbackState == STATE_ENDED` → 新歌只躺在列表里。改用 `pendingUserNext` 单独记用户意图。
5. **长会话原生播放列表无界增长**（`b714a5e`）
   `patchQueue` 是 append-only，T4 打印出 `restored 89 tracks`。加 `QueueStore.dropLeading` + 超过 60 项时裁剪（保留当前项前 10 项），并让 JS 在 `trackChanged` 时用 `getState().tracks` 重建 mirror。

### 已知未完成项（供人工接手）

- T5 真机断网即停；T7 划任务卡；T9 四种模式；T10 的 release 播放复跑（需在 release 应用里配置 tier3）。
- 遗留告警：`Introspectable data is missing for class expo.modules.mplayerplayer.*Input`（Record 走反射转换，纯性能，不影响正确性）。
