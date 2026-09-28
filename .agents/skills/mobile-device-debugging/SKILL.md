---
name: mobile-device-debugging
description: MPlayer 移动端真机 / 模拟器验收：三条回路（雷电模拟器 / Windows 原生 adb / WSL+usbipd 脚本）、起 Expo、看真机日志、按设备取交互坐标、截图取证并把证据图附到 PR 正文。当用户要真机验收、连手机或模拟器调试、看手机端日志、expo 起开发服务器、设备连不上 / attach 报 busy / adb reverse / logcat / Metro 连不上或报 500、要把验收截图挂到 PR 时使用。
---

# MPlayer 真机调试

移动端验收有**三条回路**，按「命令在哪跑」选一条并全程只用它——两条 adb 同时抢设备会让 reverse 静默失效：

| 回路 | 何时用 | 入口 |
|---|---|---|
| **A · 雷电模拟器**（默认优先） | 会话跑在 Windows、验 UI / 渲染 / JS 层 | `D:\leidian\LDPlayer14\ldconsole.exe`（`C:\leidian` 是空壳） |
| **B · Windows 原生 adb** | 要真实机型 / 网络 / 原生能力 | `C:\Users\Admin\scoop\apps\android-clt\current\platform-tools\adb.exe` |
| **C · WSL + usbipd** | 在 WSL 里开发时 | `./scripts/mobile-device/usb-attach.sh` + `./scripts/mobile-debug.sh` |

回路 C 的前提：手机 USB 经 usbipd-win 直挂进 WSL，全系统只有一个 adb server——WSL 原生版（udev 规则 `/etc/udev/rules.d/51-android-usbip.rules`），Windows 侧一律不用。**本机（DSH 跑在 Windows）实际走 A/B**：usbipd 里手机显示 `Shared`（未 attach）是正常的，别 attach 进 WSL。

## 标准流程

1. **连设备**
   - A：`ldconsole.exe list2` 看实例 → `ldconsole.exe launch --index 0` → `adb devices` 出现 `emulator-5554`（没有就 `adb connect 127.0.0.1:5555`）。模拟器里已装 Expo Go。
   - B：插线 → `adb devices` 出现机型序列号（`unauthorized` 见陷阱）。
   - C：`usb-attach.sh`（每次重新插拔都要重跑）→ `mobile-debug.sh` 一条龙：重置 adb → 双 transport 检查 → `adb reverse` → 起/复用 Metro（日志 `packages/mobile/.expo/dev/logs/start.log`）→ 冷启 → 挂 logcat。`--no-cold-start` 不杀 App，`-c` 清 Metro 缓存。
2. **起 Metro 并接上**（A/B 手工）：**在 worktree 内**跑 `npx expo start` → `adb reverse tcp:8081 tcp:8081` → 冷启。
   - 模拟器里只能用 `127.0.0.1`，`localhost` 拉不到 bundle。
   - **首次冷构建** bundle 约 12MB，Expo Go 会先报 `Failed to download remote update`：先在设备内 `adb shell curl` 预热 manifest 与其中的 `launchAsset.url`，再开 App 即正常。
3. **冷启 + 看日志**：`adb shell am force-stop host.exp.exponent` → `adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"` → `adb logcat -v time ReactNativeJS:V ExpoModulesCore:V ActivityTaskManager:I *:S`。`ReactNativeJS` 是 App 自己的日志（`[player]` / `[search]` / `[tier3]` 前缀）。

**完成标准**：logcat 出现 `Running "main"` + `存量数据迁移完成`，Metro 日志出现 `metro:bundling:done`；且已确认**跑的是你的那份源码**（取证第 1 条）。

## 取证

验收结论要可复核：**每个验收项配一条能看的证据**，没有就写「未做 + 原因」，别写「已附截图」而没附。

1. **先证明跑的是你的代码**：从 logcat `Running "main"` 里取 `launchAsset.url`，追加 `&lazy=false` 后 curl，`grep` 你新加的标识串；manifest 的 `projectRoot` 要是你的 worktree。跑错源码时后面的结论全部作废。
2. **截图**：`adb exec-out screencap -p > <用例>.png`（pwsh 7 / bash 字节安全；Windows PowerShell 5.1 会改编码，改用 `adb shell screencap -p /sdcard/x.png` + `adb pull`）。存仓库外（`%TEMP%\mplayer-acceptance\`），文件名用 `<PR 号>-<序号>-<用例>.png`，别用 `s1.png`；同类用例要固化就跑 `npm run mobile:e2e`（截图落 `e2e/artifacts/`，已 gitignore）。
3. **交互坐标按当前设备取**：先 `adb shell wm size`。**`adb shell input tap` 在部分机型（OnePlus）静默无效，改 `adb shell input -d 0 tap X Y`**；快速滑动用连打 `input swipe`。tab 栏在屏幕底部（OnePlus 上 y≈2602–2648，2680 已落进系统手势区）。
4. **量化证据要配「真的动了」**：`[perf]` warn 只在**连续 2 个 2s 窗口 < 30fps** 时上报（`packages/mobile/services/perfMonitor.ts`，后台暂停窗口不报）。所以「零 warn」单独不成立——必须同时给出「列表滚到第 N 名 / 打开了哪个页面」。
5. **收尾**：验收结束停掉 Metro。`adb kill-server` 会打掉所有人的 reverse——动过 server 后 `adb reverse --list` 确认自己的端口还在。

## 图附到 PR 正文

`gh pr edit <PR> --attach '<png>#<图注>'`（本机 gh 2.101.0 已验证；`gh pr edit --help` 里没有 `--attach` 就是版本太老）。**必须在 git 仓库目录内执行**，临时目录里会报 not a git repository。

- **可靠做法是两步**：① `--attach` 把图传上去（可重复，一次最多 50 个）——正文里**没被引用**的附件会以 `![图注](URL)` 追加到正文末尾；② `gh pr view <PR> --json body --jq .body` 读出 `user-attachments` URL，用 `--body-file` 把正文排成「说明 → 图」，末尾那份重复删掉。
- 一步到位的唯一前提：正文里的链接目标与 `--attach` 传入路径**逐字一致**（实测 `![x](D:\...\shot.png)` + `--attach 'D:\...\shot.png#x'` 会被改写成上传后的 URL；写 basename 或 `./shot.png` 不命中，只会多追加一份）。
- **正文只引上传后的 URL**：本地路径（含相对路径）不渲染，会显示成裂图。
- 图注写「这张图证明了什么」（如「热榜滚到第 194–200 名 → `getItemLayout` 偏移算术正确」），不写文件名；部分文件上传失败时正文仍会更新，看退出码。

## 陷阱速查

- **attach 报 `Device busy (exported)`**：Windows 正占用设备。两个来源：手机处于「文件传输/MTP」模式（下拉通知切成「仅充电」，USB 调试保持开）；或另一条回路的 adb 被拉起（`/mnt/c/Users/Admin/scoop/shims/adb.exe kill-server`）。切换 USB 模式会让设备重新枚举，bind 可能要重做——重跑 usb-attach.sh。
- **之前能用，突然 `no devices`**：usbipd 透传掉了（拔插、省电、重新枚举都会）。重跑 usb-attach.sh 即可。
- **开发态验收用 Expo Go，不是装机 APK**：`com.mplayer.mobile` 是 release 构建（无 DEBUGGABLE），跑打包 JS、不连 Metro——看不到 `Running "main"` 与 bundling 日志就是这个原因。
- **原生能力必须 dev client**：Expo Go 下 `setActiveForLockScreen` 被跳过（`services/audioPlayer.ts` 的 `if (!isExpoGo)`）、`enableBackgroundPlayback` 插件不生效（#327）——后台播放 / 锁屏 / 通知栏类验收在 Expo Go 上得到的结论无效，别写进 PR。
- **改了 core 必须重建**：移动端 Metro 吃 `packages/core/dist` 产物。dist 过期的典型症状是启动即 `undefined is not a function`（core 新导出不存在）——`npm run core:build` 后冷启 App；行为诡异时 `./scripts/mobile-debug.sh -c` 清 Metro 缓存。
- **worktree 里调真机**：`packages/mobile/node_modules` 软链到主克隆时，`expo-router` 的 babel 插件按「被转换文件的真实路径」反推 app root（`babel-preset-expo` 的 `getExpoRouterAppRoot`），`_ctx.android.js` 的真实路径落在主克隆 → **打包的是主克隆的 `app/`**，worktree 的改动全部不生效（症状：改了没反应）。修法：worktree 就地 `npm install`；临时救急用 `cp -al` 硬链主克隆的 `node_modules` 与 `packages/mobile/node_modules`（硬链的真实路径落在 worktree 内，app root 推导才正确）。
- **Metro 报 500**：先 curl bundle URL 看错误体。常见根因是 Metro 实例的 projectRoot 不是 `packages/mobile`（陈年残留进程，解析到仓库根）——杀掉它重起。App 收到的 manifest 里 `projectRoot` 字段可直接验。
- **多会话共抢一台手机**：其他 worktree 会话可能也在调试（各自 Metro 占 8082 等端口、互相拉起 App）。`adb kill-server` 会打掉**所有人**的 reverse 隧道——动过 server 后跑 `adb reverse --list` 确认自己的端口还在，App 的 `initialUri` 要指向自己的端口。
- **双 transport 串线**：设备同时挂 USB + 无线两条 transport 时 reverse 静默不通（App 拉起但 JS 永远不跑、Metro 无 bundling 记录）。修法：`adb disconnect` 只留 USB，重建 reverse，冷启。mobile-debug.sh 已内置该检查。
- **验证隧道别用手机侧 nc**：Android toybox nc 静默失败。以 Metro bundling 日志 + ReactNativeJS 日志为准。
- **无线调试（不用 USB 的备用路线）**：镜像网络下手机可直连开发机局域网 IP 拉 bundle（Hyper-V 防火墙需放行 8081）；无线 adb 端口每次重连随机，`adb mdns services` 扫 `_adb-tls-connect._tcp`，配对码 30 秒过期。适合临时看 UI，长会话仍走 USB。
