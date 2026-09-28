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
