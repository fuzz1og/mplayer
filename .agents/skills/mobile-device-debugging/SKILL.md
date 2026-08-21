---
name: mobile-device-debugging
description: MPlayer 真机调试环境：连接 Android 手机（USB reverse / Windows adb）、起 Expo、看真机日志。当用户要真机验收、连手机调试、看手机端日志、expo 起开发服务器、adb reverse / logcat / Metro 连不上时使用。
---

# MPlayer 真机调试

在 WSL 里开发、手机是 Android 真机的标准调试回路。核心事实：**只用 Windows 侧 adb**（WSL 与 Windows 各起一个 adb server 会互踢，双 server 是一切诡异连接问题的第一嫌疑）。

## 标准流程（USB reverse 路线）

1. `adb devices` 确认设备（`adb` = `~/.local/bin/adb` wrapper → Windows scoop adb.exe；若报 command not found 用全路径）。首次或连接异常时先 `adb kill-server` 再重试——双 server 竞态的报错（`could not read ok from ADB Server`）重试即愈。
2. `adb reverse tcp:8081 tcp:8081` —— 手机侧 `localhost:8081` 走 USB 隧道到开发机，绕开全部防火墙/子网问题。**网络类问题一律先走这条路线**，不要默认改 `--tunnel`。
3. `cd packages/mobile && npx expo start --localhost`（后台跑）。
4. 拉起 App：`adb shell am start -a android.intent.action.VIEW -d "exp://localhost:8081"`；改过代码后冷启：先 `adb shell am force-stop host.exp.exponent`。
5. 看日志：`adb logcat -v time ReactNativeJS:V ExpoModulesCore:V ActivityTaskManager:I *:S`——`ReactNativeJS` 是 App 自己的日志（`[player]`/`[search]`/`[tier3]` 前缀）。

**完成标准**：logcat 出现 `Running "main"` + `存量数据迁移完成`（App 启动日志），Metro 侧 `packages/mobile/.expo/dev/logs/start.log` 出现 `metro:bundling:done`。两者都见到才算连通。

## 陷阱速查

- **双 transport 串线**：设备同时挂着 USB + 无线两条 transport 时，reverse 隧道会静默不通（App 拉起但 JS 永远不跑、Metro 无 bundling 记录）。修法：`adb disconnect` 断无线只留 USB，重建 reverse，`force-stop` 后冷启。
- **改了 core 必须重建**：移动端 Metro 吃 `packages/core/dist` 产物——`npm run core:build` 后重载 App；行为诡异时 `npx expo start -c` 清 Metro 缓存。
- **验证隧道别用手机侧 nc**：Android toybox nc 静默失败，空输出不代表隧道断。以 Metro bundling 日志 + ReactNativeJS 日志为准。
- **Windows→WSL 回环验证**：`/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "Test-NetConnection -ComputerName 127.0.0.1 -Port 8081 -InformationLevel Quiet"`（镜像网络下 WSL 端口 Windows 侧可达；cmd.exe/powershell.exe 不在 WSL PATH，用绝对路径）。
- **无线调试（不用 USB 时）**：端口每次重连随机，`adb mdns services` 扫 `_adb-tls-connect._tcp` 拿新端口；配对码 30 秒过期；手机关闭「无线调试」页面即停止广播。
- **WSL interop**：Windows PATH 未注入 WSL，Windows 程序一律绝对路径调用（`/mnt/c/...`）；UNC cwd 告警无害。
