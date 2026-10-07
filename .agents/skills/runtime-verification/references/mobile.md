# 移动端验真（Android 真机 / 模拟器）

通用流程（列命题 / 选端 / 证据强度阶梯 / 附 PR / 完成标准）在 `SKILL.md`；本节只写移动端：怎么连上、**怎么证明跑的是这份代码**、怎么取证。

**本节速查**：[三条回路](#三条回路) · [标准流程（脚本优先）](#标准流程) · [身份锚](#身份锚) · [取证](#取证) · [别靠点触摸应用内 UI](#验收准备别靠点触摸应用内-ui) · [dev build](#dev-build非-expo-go) · [陷阱速查](#陷阱速查)

## 三条回路

按「命令在哪跑」选一条并**全程只用它**——两条 adb 同时抢设备会让 reverse 静默失效。

| 回路 | 何时用 | 入口 |
|---|---|---|
| **A · 雷电模拟器**（默认优先） | 会话跑在 Windows、验 UI / 渲染 / JS 层 | `D:\leidian\LDPlayer14\ldconsole.exe`（`C:\leidian` 是空壳） |
| **B · Windows 原生 adb** | 要真实机型 / 网络 / 原生能力 | `C:\Users\<用户名>\scoop\apps\android-clt\current\platform-tools\adb.exe` |
| **C · WSL + usbipd** | 在 WSL 里开发时 | `node scripts/mobile-device/usb-attach.mjs` → `node scripts/mobile-debug.mjs` |

回路 C 的前提：手机 USB 经 usbipd-win 直挂进 WSL，**全系统只有一个 adb server**——WSL 原生版（udev 规则 `/etc/udev/rules.d/51-android-usbip.rules`），Windows 侧一律不用。**本机（DSH 跑在 Windows）实际走 A/B**：usbipd 里手机显示 `Shared`（未 attach）是正常的，别 attach 进 WSL。

## 标准流程

**入口是脚本，不是手打命令。** 六步（重置 adb → 双 transport 检查 → `adb reverse` → 起/复用 Metro → 冷启 → 挂 logcat）漏掉任一步就是一轮静默失败的取证；实测 A/B 回路的 11 个会话全部手打、零调用脚本，代价是每个会话重写一遍这六步。

```bash
node scripts/mobile-debug.mjs                 # 完整回路（含冷启 + logcat）
node scripts/mobile-debug.mjs -c              # 怀疑 transform 缓存时清 Metro 缓存再起
node scripts/mobile-debug.mjs --no-cold-start # 不杀 App，热拉起
```

- **WSL 回路先 attach**：`node scripts/mobile-device/usb-attach.mjs`（每次重新插拔都要重跑）。它按 `/mnt/c/...` 硬编码路径，**只在 WSL 里有意义**，A/B 回路不用它。
- **设备侧只剩一步人工**：手机上点「允许 USB 调试」（`unauthorized` 时）。

**脚本失败或不适用时**才手打，顺序照抄、别调换：

1. **起 Metro：先 `cd packages/mobile`** 再 `npx expo start`——在 worktree 根起会 `ConfigError: Cannot resolve entry file`，且 Expo 会顺手改写根 `tsconfig.json`（见陷阱「Metro 起错目录」）。**一条会话只起一个 Metro、端口固定 8081**（记进会话便签）：实测一轮会话起了 8 次（8090→8097），每次 `--clear` 重建 40–60s，白等十几分钟。
2. `adb reverse tcp:8081 tcp:8081`——**重启 Metro 后必须重做**（daemon 重启也会清空，见陷阱）。
3. 冷启：`adb shell am force-stop host.exp.exponent` → `adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"`。**模拟器（回路 A）用 `127.0.0.1`**：实测那里 `localhost` 拉不到 bundle；`mobile-debug.mjs` 服务 C 回路、冷启写的是 `exp://localhost:8081`，在模拟器上手打时别照抄这一处。
4. 挂 logcat：`adb logcat -v time ReactNativeJS:V ExpoModulesCore:V ActivityTaskManager:I *:S`。`ReactNativeJS` 是 App 自己的日志（`[player]` / `[search]` / `[tier3]` 前缀）。
   - **后台 dev server 会被系统静默回收**（日志无报错、退出码 1，实测两次）：「App 突然连不上」先查 dev server 任务/日志，别先怀疑 App。
   - **首次冷构建** bundle 约 12MB，Expo Go 会先报 `Failed to download remote update`：先在设备内 `adb shell curl` 预热 manifest 与其中的 `launchAsset.url`，再开 App 即正常。

**跑通判据（只证明环境就位，不证明命题成立）**：logcat 出现 `Running "main"` + `存量数据迁移完成`；`mobile-debug.mjs` 另以 Metro 日志（`packages/mobile/.expo/dev/logs/start.log`）出现 `metro:bundling:done` 为完成标准。命题成不成立看下面两节。

## 身份锚

**任意一条不成立，后面所有结论作废**——实测踩过：设备上装的是旧 APK，日志里的 `changed=true` 是假成功，靠第 3 条才把它推翻。先做这三条，再谈取证。

1. **包里的代码是不是这份**（JS 侧）：
   - 归属：`curl -s -H 'expo-platform: android' -H 'Accept: application/expo+json,application/json' http://127.0.0.1:8081/ | grep -o '"projectRoot":"[^"]*"'` 必须等于你的 worktree 的 `packages/mobile`（`scripts/mobile-e2e.mjs` 的 `metro` 步就是这条检查；不符说明 8081 上是陈年 / 别的 worktree 的 Metro）。
   - 内容：从 logcat `Running "main"` 那行取 `launchAsset.url`，**追加 `&lazy=false`** 后 curl，grep 你新加/改名的**字符串字面量**。设备 bundle URL 带 `lazy=true`，按需加载的 chunk 里才有新符号——不追加 `&lazy=false` 会 grep 不到，误判成「改动没生效」。
2. **设备上装的是哪一版**：`adb shell dumpsys package com.mplayer.mobile.dev | grep -E 'lastUpdateTime|versionName'`，与你的构建时刻对齐（`Get-Item packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk | Select LastWriteTime`）。`lastUpdateTime` 早于你的构建，就是旧包。
3. **装的是不是你以为的那个包**（原生 / Kotlin 侧才有新符号；纯 JS 改动走第 1、2 条）——拉回设备 `base.apk` 扫 dex：

   ```powershell
   $T = "$env:TEMP\mplayer-dex"; New-Item -ItemType Directory -Force $T | Out-Null
   adb -s <serial> shell pm path com.mplayer.mobile.dev      # → package:/data/app/…/base.apk
   adb -s <serial> pull /data/app/…/base.apk "$env:TEMP\mplayer-base.apk"
   tar -xf "$env:TEMP\mplayer-base.apk" -C $T                # unzip / 7z 都行
   node -e "const fs=require('fs'),d=process.argv[1];console.log(fs.readdirSync(d).filter(f=>f.endsWith('.dex')&&fs.readFileSync(d+'/'+f,'latin1').includes('insertAfterCurrent')).join('\n')||'NOT FOUND')" $T
   ```

   按 latin1 读 dex 是必须的（符号名躺在 dex 的字符串表里，编码猜错会误判成 NOT FOUND）；WSL / Git Bash 里换成 `grep -a -l 'insertAfterCurrent' /tmp/mplayer-dex/classes*.dex`。

   实测：dex 里 `insertAfterCurrent` NOT FOUND + `lastUpdateTime` 没变 → 设备上是旧 APK（deploy 时撞了 `INSTALL_FAILED_NO_MATCHING_ABIS`，之后没人复核），上一轮「日志说 changed=true」的验收整轮作废。

## 取证

下面的次序就是 `SKILL.md` §3 强度阶梯在移动端的具体化：**能读日志就不 dump，能 dump 就不截图**。

**多设备时每条 adb 都要写 `-s <serial>`**——不带就报 `more than one device/emulator`（见陷阱「多设备」）。

1. **要坐标、要文案断言，先 dump 再截图**：`adb shell uiautomator dump /sdcard/ui.xml` + `adb pull` 拿到带 `text=` / `bounds=` 的树（RN 组件会映射成原生节点；实测一次调用就定位到「播放队列 (7)」「明知故犯」这类元素并给出 `bounds`）。现成驱动与坑见 `e2e/README.md`（动画 / 滚动中会间歇性吐空壳树，要重试 + 弃旧快照）。**截图退居视觉复核**，别拿它猜坐标。
   **dump 是单行 XML**：别用按行读取/截断的工具读它（实测 read 类工具会把那一行截断，正则静默匹配 0 个节点，看着像「空树」）——用 Node `fs.readFileSync` 或 python 解析后再取 `text=` / `bounds=`；解析这一步现在是命令：`node scripts/mobile-ui.mjs find '<re>'`（`dump` / `find` / `tap`，坐标与文案一起给，省掉手写 dump→bounds→tap 循环）。
2. **截图**：**先裁感兴趣区域再读**（全屏 PNG 1.5–2.6MB，连读十几张代价很高）；能用埋点日志判读就别截图——`[cover] 加载失败 0` 这种一行日志比一张截图更省也更硬。`adb exec-out screencap -p > <用例>.png`（pwsh 7 / bash 字节安全；Windows PowerShell 5.1 会改编码，改用 `adb shell screencap -p /sdcard/x.png` + `adb pull`）。存仓库外（`$env:TEMP\mplayer-acceptance\`），文件名 `<PR 号>-<序号>-<用例>.png`，别用 `s1.png`；同类用例要固化就跑 `npm run mobile:e2e`（截图落 `e2e/artifacts/`，已 gitignore）。
3. **交互坐标按当前设备取**：先 `adb shell wm size`，坐标就是截图里的物理像素。**点不动时先怀疑「点偏了」，别先怀疑「输入被拦」**——PKB110 / ColorOS 16 实测 `adb shell input tap` 是生效的（点启动器图标能打开对应 App）——但**应用内的 RN Pressable 是已知例外**，见下一节。`input -d 0 tap X Y` 只在 display id 不为 0 时才有意义（`adb shell dumpsys display | grep -m1 mDisplayId`；本机 id=0）。快速滑动用连打 `input swipe`；`onEndReached` 那类要滚动的验收，`input keyevent 20`（DPAD_DOWN）连打更稳。tab 栏在屏幕底部（OnePlus 上 y≈2602–2648，2680 已落进系统手势区）。
   **别用错误判据**：`input tap` 点状态栏**不会**拉下通知栏（ColorOS 上本就不拉），拿它当「输入被拦」的证据会误判整轮验收。判别输入是否生效，用**点启动器图标看前台 Activity**（`dumpsys activity activities | grep -m1 topResumedActivity`）这种有唯一答案的目标。
4. **量化证据要配「真的动了」**：系统侧帧计时的入口是 **`node scripts/mobile-frame-stats.mjs`**：
   - 默认注入 2s 下滑，坐标先给定：`MOBILE_FRAME_SWIPE="x1 y1 x2 y2 2000" node scripts/mobile-frame-stats.mjs`；`MOBILE_FRAME_WAIT=8` 改成留 8s 窗口手拖；`MOBILE_FRAME_SERIAL=<serial>` 多设备；`MOBILE_FRAME_PKG=com.mplayer.mobile.dev` 测 dev build；`MOBILE_FRAME_PARSE_DIR=e2e/artifacts/frame-…` 只复算旧 dump。产物与 `frame-stats.json` 落 `e2e/artifacts/frame-<label>-<时间戳>/`（已 gitignore）。**这些是环境变量**：pwsh 里写 `$env:MOBILE_FRAME_SWIPE='x1 y1 x2 y2 2000'; node scripts/mobile-frame-stats.mjs`，`VAR=… node …` 那种前缀写法只在 bash 里成立。
   - **它不能单独定罪**：App 的拖拽跟手跑在 JS 线程，JS 卡住时面板是「冻住」而不是「画得慢」，帧统计可能反而健康——必须与 App 侧 **`[drag]` 日志**（`packages/mobile/services/dragJankProbe.ts`）合看：一个答「JS 线程被占了吗」，一个答「用户看得见吗」。
   - App 侧 `[perf]` warn 只在**连续 2 个 2s 窗口 < 30fps** 时上报（`packages/mobile/services/perfMonitor.ts`；后台暂停窗口不报，前台长卡死另报一条）——所以「零 warn」单独不成立，必须同时给出「列表滚到第 N 名 / 打开了哪个页面」。
   - **长采样脚本给每个 adb 调用套 `timeout`**（如 `A() { timeout 25 adb -s "$S" "$@"; }`）：实测一次 `dumpsys` 挂住，让 23 分钟的采样在**第 6 个样本静默停摆**，而任务状态仍显示 running——不加超时就会交出一轮「看着在跑、其实没数据」的取证。
5. **收尾停掉 Metro**。`adb kill-server` 会打掉**所有人**的 reverse——动过 server 后 `adb reverse --list` 确认自己的端口还在。

## 验收准备别靠点触摸应用内 UI

RN 的 `ScalePress` 对注入触摸**时灵时不灵**：同一实例上，设置齿轮 / 「+ 添加 URL 订阅」/ 播放模式按钮对 `input tap`、长按式 `input swipe x y x y 200`、5 次连点**全无响应**（齿轮有 ripple 却不导航；按钮连 Alert 都不弹，说明 handler 压根没跑），而同屏原生 `Switch` / `TextInput` 正常。**点不动且没有任何状态变化（无 Alert、无导航、无日志）时，先怀疑「这个控件不吃注入触摸」**，别继续换坐标试。

**先自检注入本身有没有效**：拿一个**已知可长按**的控件做对照（本机实测：长按「我的歌单」页的歌单卡片 → 弹「删除歌单」确认）。`input swipe x y x y <ms>`（同点、>=500ms）与 `input motionevent DOWN/…/UP` 都能触发长按；**对照组生效而目标不响应**时，才轮到怀疑「这个控件不吃注入触摸」或「手势被组件树吞掉」——2026-10-01 就是靠这条把「注入无效」与「外层 Pressable 被内层吞掉」分开，才定性到 responder 归属（#514）。

可靠替代——验收准备要的是「设备处于某个状态」，不是「按钮被按过」：

- **导航**用深链，不点按钮：`adb shell am start -a android.intent.action.VIEW -d 'mplayer://settings' -p com.mplayer.mobile.dev`。
- **配置**用临时注入，不填表单：在 `packages/mobile/app/_layout.tsx` 临时调 `core.addTier3SubscriptionFromUrl(...)` + `setTier3Enabled(true)`，跑一次让它**落进 AsyncStorage**，随后**立刻回退源码**——设备照常可用，敏感值全程不入库（tier3 实测就是这么配上的）。
- **断言**用 dump 的文本，不靠看像素（见「取证」第 1 条）。

release 包 applicationId 不同（`com.mplayer.mobile` vs `.dev`），dev 上配好的数据**不会带过去**，且 release 没有 dev 工具——要验 release 的播放判据，只能用**带注入的构建**（构建产物本身也不入库）。

## dev build（非 Expo Go）

**Expo Go 验不了这一层**：Expo Go 下 expo-audio 不 bind/start `AudioControlsService`（media3 `MediaSessionService`），且本仓在 Expo Go 主动跳过 `setActiveForLockScreen`（`packages/mobile/services/audioPlayer.ts` 的 `if (!isExpoGo)` 分支）——没有前台服务就没有「后台持续播放」，也看不到媒体会话与锁屏控件。凡涉及后台播放 / FGS / 锁屏与通知控件 / 曲末切歌的验收，一律用 dev build。

dev build 的包名带 `.dev` 后缀（`packages/mobile/android/app/build.gradle` 的 debug 变体 `applicationIdSuffix '.dev'`），**与 release 共存**，不会覆盖测试机上的正式包。

**执行只有一条命令**（本 skill 包内，别抄裸命令）：

```bash
node .agents/skills/runtime-verification/scripts/dev-build.mjs
```

它把出包 → 装 → reverse → 拉起 → 自检连同实测坑一起固化了：按设备 `ro.product.cpu.abi` 出包（避免 `INSTALL_FAILED_NO_MATCHING_ABIS`）、用 `adb push` + `pm install -r` 而非 `adb install`、撞 `Failed to restorecon` 自动改推 `/sdcard/` 重试、android 目录过长先告警（含绕开它的第二层坑）、拉起用显式组件而不是裸 `mplayer://`、每个 adb 调用带超时、`adb reverse` 失败不再静默。

选项：`--dry-run`（只打印将要 spawn 的 argv）、`--skip-build`（APK 已存在）、`--abi <abi>`、`--serial <serial>`、`--after-play`（进入播放后自检，见下）、`--dex <symbol>`（拉回设备 `base.apk` 扫 dex，即「身份锚」第 3 条）、`--keep`（保留设备上的 APK）。环境变量：`MOBILE_ADB` / `MOBILE_GRADLE` / `MOBILE_ADB_TIMEOUT_MS` / `MOBILE_LAUNCH_TIMEOUT_MS` / `MOBILE_POSTPLAY_TIMEOUT_MS`。

**只能人工做的两步**：首次启动的 dev-client 引导页、`POST_NOTIFICATIONS` 权限框——都要点过，否则 FGS 通知发不出来。

**成立标准分两段**（这是最容易误解的地方：三段并成一段跑，等于每次冷启都 3 条全不命中、脚本恒 exit 1 的假失败）：

1. **启动阶段 —— 决定退出码**：身份锚通过 + logcat 轮询到 `Running "main"`，且没有 `undefined is not a function`（后者 = core dist 断裂）。冷启一次就该绿。
2. **播放后 —— 只在 `--after-play` 时跑，不决定退出码**：三条 `dumpsys` 只证明「真的在 dev build 的播放语义下」，结构上都要**正在播放**才有——`expo.modules.mplayerplayer.PlayerService` 且 `isForeground=true`、media_session 里出现 `Media button session is com.mplayer.mobile.dev/…`、通知渠道出现 `music-playback-native`。不成立说明还在 Expo Go 语义下。（旧 skill 写的 `AudioControlsService` / `music-playback` 已随 expo-audio → 自写 native-player 退役：`packages/mobile/android/app/src/main/AndroidManifest.xml:25-26` 的 I3 注释、`modules/native-player/android/src/main/res/values/strings.xml:3`。照旧名字 grep 永不命中，会把完全正常的后台播放误判成「还在 Expo Go 语义下」。）

**附带好处**：`console.log` 在 dev build 的 logcat 可见，`[player]` 一类排查优先在 dev build 上做。**本仓确定不剥 `console`**（Metro / Babel 未开 console 剥离插件，`packages/mobile/stores/logsStore.ts` 的注释即此口径），release 上这类日志同样进 logcat。

**应用内日志本来就镜像进 logcat，别重复埋点**：`useLogsStore.addLog` 会镜像 `console`（`packages/mobile/stores/logsStore.ts`），`info` 的级别门禁只作用于**应用内缓冲**（dev build 或设置页「开发者模式」才收 info，#477）——为取证再加一份 `console.log` 是重复劳动。分级与开关见 `docs/research/2026-09-29-mobile-developer-mode-and-diagnostics.md`。

## 陷阱速查

- **attach 报 `Device busy (exported)`**：Windows 正占用设备。两个来源：手机处于「文件传输 / MTP」模式（下拉通知切成「仅充电」，USB 调试保持开）；或另一条回路的 adb 被拉起（`/mnt/c/Users/<用户名>/scoop/shims/adb.exe kill-server`）。切换 USB 模式会让设备重新枚举，bind 可能要重做——重跑 `usb-attach.mjs`。
- **之前能用，突然 `no devices`**：usbipd 透传掉了（拔插、省电、重新枚举都会）。重跑 `usb-attach.mjs` 即可。
- **模拟器实例掉线 / 报废**（不只是 usbipd 掉线）：雷电实例会自己从 `adb devices` 里消失或变 `offline`，`ldconsole quit` 再 `launch --index <i>` 常常**起不回来**（adbd 不回来）。重建：`ldconsole add --name <n>` + `launch --index <i>`；**端口 = 5555 + 2×index**（index 1 → 5557），且**新实例默认 720×1280**，坐标要重新 `wm size` 取。特例：**飞行模式会连 adb 一起断且不可恢复**（`cmd connectivity airplane-mode enable` 后 `adb shell` 立即返空、`127.0.0.1:5555` 变 offline）——**断网类验收一律走真机 USB**（`svc wifi disable && svc data disable` 不影响 USB adb）。
- **开发态验收用 Expo Go，不是装机 APK**：`com.mplayer.mobile` 是 release 构建（无 DEBUGGABLE），跑打包 JS、不连 Metro——看不到 `Running "main"` 与 bundling 日志就是这个原因。
- **原生能力必须 dev client**：Expo Go 下 `setActiveForLockScreen` 被跳过（`services/audioPlayer.ts` 的 `if (!isExpoGo)`）、`enableBackgroundPlayback` 插件不生效（#327）——后台播放 / 锁屏 / 通知栏类验收在 Expo Go 上得到的结论无效，别写进 PR。
- **改了 core 必须重建**：移动端 Metro 吃 `packages/core/dist` 产物。dist 过期的典型症状是启动即 `undefined is not a function`（core 新导出不存在）——`npm run core:build` 后冷启 App；行为诡异时 `node scripts/mobile-debug.mjs -c` 清 Metro 缓存。
- **core 新增/改名导出时，只 `core:build` 还会红屏（#576 实测）**：设备的 bundle URL 带 `lazy=true&transform.bytecode=1`，被**按需加载**的那个 chunk 仍是旧转换缓存——`core:build` + 冷启之后，一打开用到新导出的页面照样红屏 `undefined is not a function`（实测：master 上开全屏播放页，`PlayerOverlay.tsx` 的 `planLyricsFetch`）。修法：`npx expo start --clear` 重起 Metro（或 `node scripts/mobile-debug.mjs -c`）再冷启。取证按「身份锚」第 1 条：curl 设备 manifest 的 `launchAsset.url`（追加 `&lazy=false`）grep 新符号。**别把这种红屏当成「刚合的 PR 把 master 弄炸了」**。
- **worktree 里调真机**：`packages/mobile/node_modules` 软链到主克隆时，`expo-router` 的 babel 插件按「被转换文件的真实路径」反推 app root（`babel-preset-expo` 的 `getExpoRouterAppRoot`），`_ctx.android.js` 的真实路径落在主克隆 → **打包的是主克隆的 `app/`**，worktree 的改动全部不生效（症状：改了没反应）。修法：worktree 就地 `npm install`；临时救急用 `cp -al` 硬链主克隆的 `node_modules` 与 `packages/mobile/node_modules`（硬链的真实路径落在 worktree 内，app root 推导才正确）。
- **Metro 报 500**：先 curl bundle URL 看错误体。常见根因是 Metro 实例的 projectRoot 不是 `packages/mobile`（陈年残留进程，解析到仓库根）——杀掉它重起。App 收到的 manifest 里 `projectRoot` 字段可直接验（身份锚第 1 条）。
- **多会话共抢一台手机**：其他 worktree 会话可能也在调试（各自 Metro 占 8082 等端口、互相拉起 App）。`adb kill-server` 会打掉**所有人**的 reverse 隧道——动过 server 后跑 `adb reverse --list` 确认自己的端口还在，App 的 `initialUri` 要指向自己的端口。
- **归属对照：同一台设备上再起一个 Metro（8082）跑 master**：分支上某控件不响应 / 行为可疑时，用 master 的 bundle 复现一次（`adb reverse tcp:8082 tcp:8082` → `am start … exp://127.0.0.1:8082`），就能把「本 PR 引入」与「既有行为」分开——#514 的长按吞手势就是这样定性为既有模式（对照图进了 PR 评论）。用完记得 `adb reverse tcp:8081 tcp:8081` 切回自己的端口并冷启。
- **双 transport 串线**：设备同时挂 USB + 无线两条 transport 时 reverse 静默不通（App 拉起但 JS 永远不跑、Metro 无 bundling 记录）。修法：`adb disconnect` 只留 USB，重建 reverse，冷启。`mobile-debug.mjs` 已内置该检查。
- **adb server / 5037 争抢（同一处置的三个子情形）**：症状是任何 `adb` 命令挂住、`adb devices` 超时，或 80MB 的 `adb install` 把 server 卡死。① 雷电自带 `D:\leidian\LDPlayer14\adb.exe` 与 scoop 的 `…\scoop\shims\adb.exe` 都会抢 5037，多个 server 互踢；② `adb install` 走流式安装，比 `adb push` + `adb shell pm install -r` 脆弱得多；③ **daemon 重启会清空所有 reverse 隧道**（实测别的会话的 daemon 崩掉，把 8099 一起带走）。处置：**杀光所有 adb 进程 → 只用一份 `adb start-server`（scoop 的 `android-clt` 或 WSL 侧 `~/.local/bin/adb`）→ 重新 `adb reverse`**；查占用者 `Get-NetTCPConnection -LocalPort 5037 -State Listen`；装包改 `adb push` + `pm install -r`；「App 突然连不上 Metro」先查 `adb reverse --list`，别先怀疑 App。**别** `adb connect 127.0.0.1:5555`——会造出同一台设备的**重复 transport**。
- **CMake 250 字符对象路径上限（含绕开后的第二层坑）**：在深层 worktree（如 `.claude/worktrees/<name>`）里跑 `./gradlew assembleDebug` 会因原生模块对象路径过长失败，症状是 CMake 警告 `CMAKE_OBJECT_PATH_MAX` + `ninja: error: manifest 'build.ninja' still dirty after 100 tries`（或 `Filename longer than 260 characters`）。修法：**在短路径检出构建**（主克隆、`subst` 短盘符、`D:\npw` 这种），别在 `.claude/worktrees/<长名>` 里硬试。⚠️ **绕开它的第二层坑**：把源码复制到短路径（游离副本）构建出的 APK **启动即崩** `ClassNotFoundException: expo.modules.splashscreen`——autolinking 认的是检出结构，副本里模块收不全。**正解是在主克隆里建临时分支构建**，不是复制目录。
- **验证隧道别用手机侧 nc**：Android toybox nc 静默失败。以 Metro bundling 日志 + ReactNativeJS 日志为准。
- **`uiautomator dump` 在动画界面必失败**：报 `ERROR: could not get idle state`，dump 恒空。已知触发：**播放页**（唱片动画）、**底部弹层入场动画期间**。这不是坐标写错，别反复重试——改用 logcat 断言（如 `[player] 补窗 mode=… 计划=[…]`）或截图裁切判读。#514 的长按选择模式、#515 的 `moved` 分支两条验收因此**无法**用合成输入完成，需要真人手指。
- **「进程被杀后恢复」用 `am force-stop`，不要用 `am kill`**：`am kill` 对**带前台服务的进程是空操作**（pid 不变）——这本身可当「FGS 真的生效」的旁证，但验不了恢复路径；模拟器又没有 `su`，`kill -9` 用不了。`am force-stop` 更狠（连服务一起停），验出来更硬。
- **多步 adb 编排写成脚本再跑**：内联进 `pwsh -Command` 会被吃掉引号 / 反斜杠 / `$`（实测踩过 `unknown command adb`）。脚本连同**探针**都写 `$env:TEMP`，别落在 worktree 根——`git add -A` 会把它带进提交（实测补了一个 `chore:` 才删掉）。
- **无线调试（不用 USB 的备用路线）**：镜像网络下手机可直连开发机局域网 IP 拉 bundle（Hyper-V 防火墙需放行 8081）；无线 adb 端口每次重连随机，`adb mdns services` 扫 `_adb-tls-connect._tcp`，配对码 30 秒过期。适合临时看 UI，长会话仍走 USB。
- **Metro 起错目录**：在 worktree **根**跑 `npx expo start` 会 `ConfigError: Cannot resolve entry file`；更阴的是 Expo 会**顺手改写根 `tsconfig.json`**（`extends` 变成 `expo/tsconfig.base`），当轮验完要 `git checkout -- tsconfig.json` 收尾。工作目录必须是 `packages/mobile`。
- **多设备**：`adb` 不带 `-s` 在多于一台设备时必报 `more than one device/emulator`；`mobile-debug.mjs` 的 adb 调用**不带 `-s`**，多设备时直接死在设备检查那步。处置：只留一台在线（关掉另一个模拟器 / `adb disconnect`），或改用能选设备的入口——`dev-build.mjs --serial <serial>`、`MOBILE_E2E_SERIAL` / `MOBILE_FRAME_SERIAL` 环境变量。
- **原生包架构要与设备匹配**：真机 arm64-v8a、雷电模拟器 x86_64 → 装错报 `INSTALL_FAILED_NO_MATCHING_ABIS`。构建加 `-PreactNativeArchitectures=<abi>`；工作区现成的 `app-debug.apk` 往往是模拟器用的 x86_64，别直接往真机上装（`dev-build.mjs` 会按设备 ABI 出包）。
- **`pm install` 报 `Failed to restorecon`**（`INSTALL_FAILED_MEDIA_UNAVAILABLE`）：从 `/data/local/tmp` 装会撞（SELinux 上下文还原失败）。改 `adb push` 到 **`/sdcard/`** 再 `pm install -r`。
- **现场日志要在起 App 之前就开始录**：`adb -s <serial> logcat -v time > <全路径>` 挂后台任务。本轮「随机模式歌不换」正是靠 51MB 现场里 `计划=[120,72,68]→[93,170,87]` 的横跳定位的；PowerShell 里 **`%TEMP%` 不会展开**，必须写全路径。
