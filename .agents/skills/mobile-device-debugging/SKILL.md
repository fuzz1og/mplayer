---
name: mobile-device-debugging
description: MPlayer 真机调试环境：Android 手机经 usbipd 直挂进 WSL、原生 adb 单 server、一条龙调试脚本、起 Expo、看真机日志。当用户要真机验收、连手机调试、看手机端日志、expo 起开发服务器、设备连不上/attach 报 busy、adb reverse / logcat / Metro 连不上或报 500 时使用。
---

# MPlayer 真机调试

在 WSL 里开发、手机是 Android 真机的标准调试回路。核心事实：**手机 USB 经 usbipd-win 直挂进 WSL，全系统只有一个 adb server——WSL 原生版**（`~/.local/bin/adb` → `~/.local/opt/platform-tools/adb`；udev 规则 `/etc/udev/rules.d/51-android-usbip.rules` 放行用户态访问）。Windows 侧 adb 与 wrapper 已退役（备份在 `~/.local/bin/adb-windows-wrapper.bak`），任何诡异连接问题先怀疑有程序又把 Windows 侧 adb 拉起来了。

## 标准流程

1. **设备进 WSL**：手机插线后跑 `./scripts/mobile-device/usb-attach.sh`。自动找 Android 设备、bind（每台设备一次，弹 UAC）、attach 进 WSL、验证 `adb devices`。每次重新插拔都要重跑。
2. **调试回路一条龙**：`./scripts/mobile-debug.sh`（后台跑）。做完全部步骤：重置 adb → 双 transport 检查 → `adb reverse tcp:8081` → 起/复用 Metro（日志写 `packages/mobile/.expo/dev/logs/start.log`）→ 冷启 App → 挂 logcat。参数：`--no-cold-start` 不杀 App；`-c` 清 Metro 缓存。
3. **看日志**（手工时）：`adb logcat -v time ReactNativeJS:V ExpoModulesCore:V ActivityTaskManager:I *:S`——`ReactNativeJS` 是 App 自己的日志（`[player]`/`[search]`/`[tier3]` 前缀）；冷启 App 用 `adb shell am force-stop host.exp.exponent` 后 `am start -a android.intent.action.VIEW -d "exp://localhost:8081"`。

**完成标准**：logcat 出现 `Running "main"` + `存量数据迁移完成`（App 启动日志），Metro 日志出现 `metro:bundling:done`。两者都见到才算连通。核对 manifest 里 `initialUri`/`hostUri` 是自己的端口（多会话共抢一台手机时尤其要查，见陷阱）。

## dev build（非 Expo Go）：验后台播放 / FGS / 锁屏媒体会话

**Expo Go 验不了这一层**：Expo Go 下 expo-audio 不 bind/start `AudioControlsService`（media3 `MediaSessionService`），且本仓库在 Expo Go 主动跳过 `setActiveForLockScreen`（`packages/mobile/services/audioPlayer.ts:528-535`）——没有前台服务就没有「后台持续播放」，也看不到媒体会话与锁屏控件。凡涉及后台播放 / FGS / 锁屏与通知控件 / 曲末切歌的验收，一律用 dev build。

dev build 的包名带 `.dev` 后缀（`android/app/build.gradle` 的 debug 变体 `applicationIdSuffix '.dev'`），**与 release 共存**，不会覆盖测试机上的正式包。

```bash
# 1. 出包（本地构建；路径要短——见陷阱「CMake 250 字符对象路径」）
cd packages/mobile/android
./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
#   产物 app/build/outputs/apk/debug/app-debug.apk，包名 com.mplayer.mobile.dev

# 2. 装（用 push + pm install，别用 adb install：80MB 流式安装在本环境卡死过 adb server）
adb push app/build/outputs/apk/debug/app-debug.apk /data/local/tmp/mplayer-dev.apk
adb shell pm install -r /data/local/tmp/mplayer-dev.apk

# 3. 拉起（scheme 与 release 共用 → 直接发 mplayer:// 会弹选择器，必须用显式组件）
adb reverse tcp:8081 tcp:8081
adb shell am start -n com.mplayer.mobile.dev/com.mplayer.mobile.MainActivity \
  -a android.intent.action.VIEW \
  -d 'mplayer://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'
```

首次启动会有 dev-client 引导页与 `POST_NOTIFICATIONS` 权限框，**都要点过**（否则 FGS 通知发不出来）。

启动后确认三件事都成立（不成立说明还在 Expo Go 语义下）：

```bash
adb shell dumpsys activity services com.mplayer.mobile.dev | grep -E 'AudioControlsService|isForeground'
#   → ... expo.modules.audio.service.AudioControlsService ... isForeground=true types=0x2（mediaPlayback）
adb shell dumpsys media_session | grep mplayer.mobile.dev
#   → Media button session is com.mplayer.mobile.dev/androidx.media3.session.id.N
adb shell dumpsys notification --noredact | grep music-playback
```

**附带好处**：debug 构建的 `console.log` 在 logcat 可见（release 会把 JS 日志剥掉），所以 `[player]` 一类排查要在 dev build 上做。

## 陷阱速查

- **attach 报 `Device busy (exported)`**：Windows 正占用设备。两个来源：手机处于「文件传输/MTP」模式（下拉通知切成「仅充电」，USB 调试保持开）；或 Windows 侧 adb 被其他程序拉起（`/mnt/c/Users/Admin/scoop/shims/adb.exe kill-server`）。切换 USB 模式会让设备重新枚举，bind 可能要重做——直接重跑 usb-attach.sh。
- **之前能用，突然 `no devices`**：usbipd 透传掉了（拔插、省电、重新枚举都会）。重跑 usb-attach.sh 即可。
- **改了 core 必须重建**：移动端 Metro 吃 `packages/core/dist` 产物。dist 过期的典型症状是启动即 `undefined is not a function`（core 新导出不存在）——`npm run core:build` 后冷启 App；行为诡异时 `./scripts/mobile-debug.sh -c` 清 Metro 缓存。
- **worktree 里调真机**：`packages/mobile/node_modules` 软链到主克隆时，`expo-router` 的 babel 插件按「被转换文件的真实路径」反推 app root（`babel-preset-expo` 的 `getExpoRouterAppRoot`），`_ctx.android.js` 的真实路径落在主克隆 → **打包的是主克隆的 `app/`**，worktree 的改动全部不生效（症状：改了没反应、真机跑的是旧代码）。确认真机跑的是哪份源码：从 logcat `Running "main"` 里取 `launchAsset.url`，追加 `&lazy=false` 后 curl，`grep` 你新加的标识串。修法：worktree 就地 `npm install`；临时救急用 `cp -al` 硬链主克隆的 `node_modules` 与 `packages/mobile/node_modules`（硬链的真实路径落在 worktree 内，app root 推导才正确）。
- **Metro 报 500**：先 curl bundle URL 看错误体。常见根因是 Metro 实例的 projectRoot 不是 `packages/mobile`（陈年残留进程，解析到仓库根）——杀掉它用 mobile-debug.sh 重起。App 收到的 manifest 里 `projectRoot` 字段可直接验。
- **多会话共抢一台手机**：其他 worktree 会话可能也在调试（各自 Metro 占 8082 等端口、互相拉起 App）。`adb kill-server` 会打掉**所有人**的 reverse 隧道——动过 server 后跑 `adb reverse --list` 确认自己的端口还在，App 的 `initialUri` 要指向自己的端口。
- **双 transport 串线**：设备同时挂 USB + 无线两条 transport 时 reverse 静默不通（App 拉起但 JS 永远不跑、Metro 无 bundling 记录）。修法：`adb disconnect` 只留 USB，重建 reverse，冷启。mobile-debug.sh 已内置该检查。
- **`adb install` 把 server 卡死 / 5037 被抢**：实测 80MB 的 `adb install` 能把 adb server 卡到 `adb devices` 都超时。处置：改 `adb push` + `adb shell pm install`；仍卡死就查占用者（Windows：`Get-NetTCPConnection -LocalPort 5037 -State Listen`）——`D:\leidian\LDPlayer14\adb.exe` 与 scoop 的 `android-clt\...\adb.exe` 都会抢 5037，杀掉后让 WSL 侧 `~/.local/bin/adb start-server` 接管。
- **CMake 250 字符对象路径上限**：在深层 worktree（如 `.claude/worktrees/<name>`）里跑 `./gradlew assembleDebug` 会因原生模块对象路径过长失败，症状是 CMake 警告 `CMAKE_OBJECT_PATH_MAX` + `ninja: error: manifest 'build.ninja' still dirty after 100 tries`。修法：换到路径更短的检出（主克隆）构建，或加 `subst` 短盘符。
- **验证隧道别用手机侧 nc**：Android toybox nc 静默失败。以 Metro bundling 日志 + ReactNativeJS 日志为准。
- **无线调试（不用 USB 的备用路线）**：镜像网络下手机可直连开发机局域网 IP 拉 bundle（Hyper-V 防火墙需放行 8081）；无线 adb 端口每次重连随机，`adb mdns services` 扫 `_adb-tls-connect._tcp`，配对码 30 秒过期。适合临时看 UI，长会话仍走 USB。
