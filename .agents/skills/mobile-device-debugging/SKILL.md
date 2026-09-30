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
| **C · WSL + usbipd** | 在 WSL 里开发时 | `./scripts/mobile-device/usb-attach.mjs` + `./scripts/mobile-debug.mjs` |

回路 C 的前提：手机 USB 经 usbipd-win 直挂进 WSL，全系统只有一个 adb server——WSL 原生版（udev 规则 `/etc/udev/rules.d/51-android-usbip.rules`），Windows 侧一律不用。**本机（DSH 跑在 Windows）实际走 A/B**：usbipd 里手机显示 `Shared`（未 attach）是正常的，别 attach 进 WSL。

## 标准流程

1. **连设备**
   - A：`ldconsole.exe list2` 看实例 → `ldconsole.exe launch --index 0` → `adb devices` 出现 `emulator-5554`（没有就 `adb connect 127.0.0.1:5555`）。模拟器里已装 Expo Go。
   - B：插线 → `adb devices` 出现机型序列号（`unauthorized` 见陷阱）。
   - C：`usb-attach.mjs`（每次重新插拔都要重跑）→ `mobile-debug.mjs` 一条龙：重置 adb → 双 transport 检查 → `adb reverse` → 起/复用 Metro（日志 `packages/mobile/.expo/dev/logs/start.log`）→ 冷启 → 挂 logcat。`--no-cold-start` 不杀 App，`-c` 清 Metro 缓存。
2. **起 Metro 并接上**（A/B 手工）：**在 worktree 内**跑 `npx expo start` → `adb reverse tcp:8081 tcp:8081` → 冷启。
   - **一条会话只起一个 Metro、端口固定**（记进会话便签）。实测踩过：一轮会话起了 8 次（8090→8097），每次 `--clear` 重建 40–60s，白等十几分钟。`--clear` 只在怀疑 transform 缓存时用；**重启 Metro 后必须重新 `adb reverse`**。
   - **后台 dev server 会被系统静默回收**（日志无报错、退出码 1，实测两次）。遇到「App 突然连不上」先查 dev server 任务/日志，别先怀疑 App。
   - 模拟器里只能用 `127.0.0.1`，`localhost` 拉不到 bundle。
   - **首次冷构建** bundle 约 12MB，Expo Go 会先报 `Failed to download remote update`：先在设备内 `adb shell curl` 预热 manifest 与其中的 `launchAsset.url`，再开 App 即正常。
3. **冷启 + 看日志**：`adb shell am force-stop host.exp.exponent` → `adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"` → `adb logcat -v time ReactNativeJS:V ExpoModulesCore:V ActivityTaskManager:I *:S`。`ReactNativeJS` 是 App 自己的日志（`[player]` / `[search]` / `[tier3]` 前缀）。

**完成标准**：logcat 出现 `Running "main"` + `存量数据迁移完成`，Metro 日志出现 `metro:bundling:done`；且已确认**跑的是你的那份源码**（取证第 1 条）。

## 取证

验收结论要可复核：**每个验收项配一条能看的证据**，没有就写「未做 + 原因」，别写「已附截图」而没附。

1. **先证明跑的是你的代码**：从 logcat `Running "main"` 里取 `launchAsset.url`，追加 `&lazy=false` 后 curl，`grep` 你新加的标识串；manifest 的 `projectRoot` 要是你的 worktree。跑错源码时后面的结论全部作废。
2. **要坐标、要文案断言，先 dump 再截图**：`adb shell uiautomator dump /sdcard/ui.xml` + `adb pull` 拿到带 `text=` / `bounds=` 的树（RN 组件会映射成原生节点；实测一次调用就能定位「播放队列 (7)」「明知故犯」这类元素并给出 `bounds`）。现成驱动与坑见 `e2e/README.md`（动画/滚动中会间歇性吐空壳树，要重试 + 弃旧快照）。**截图退居视觉复核**，别用它猜坐标。
3. **截图**：**先裁感兴趣区域再读**（全屏 PNG 1.5–2.6MB，连读十几张代价很高）；能用埋点日志判读就别截图——例：`[cover] 加载失败 0`、`[perf]` 窗口 warn 比一张截图更省也更硬。`adb exec-out screencap -p > <用例>.png`（pwsh 7 / bash 字节安全；Windows PowerShell 5.1 会改编码，改用 `adb shell screencap -p /sdcard/x.png` + `adb pull`）。存仓库外（`%TEMP%\mplayer-acceptance\`），文件名用 `<PR 号>-<序号>-<用例>.png`，别用 `s1.png`；同类用例要固化就跑 `npm run mobile:e2e`（截图落 `e2e/artifacts/`，已 gitignore）。
4. **交互坐标按当前设备取**：先 `adb shell wm size`，坐标就是截图里的物理像素。**点不动时先怀疑"点偏了"，不要先怀疑"输入被拦"**——PKB110 / ColorOS 16 实测 `adb shell input tap` 是生效的（点启动器图标能打开对应 App）——但**应用内的 RN Pressable 是已知例外**，点不动多半不是坐标问题，见下节「验收准备别靠点触摸应用内 UI」。`input -d 0 tap X Y` 只在 display id 不为 0 时才有意义（`adb shell dumpsys display | grep -m1 mDisplayId`；本机 id=0，两种写法等效）。快速滑动用连打 `input swipe`；`onEndReached` 那类要滚动的验收，`input keyevent 20`（DPAD_DOWN）连打更稳（触摸滑动的落点/惯性更难控）。tab 栏在屏幕底部（OnePlus 上 y≈2602–2648，2680 已落进系统手势区）。
   - **别用错误判据**：`input tap` 点状态栏**不会**拉下通知栏（ColorOS 上本就不拉），拿它当"输入被拦"的证据会误判整轮验收（实测踩过）。判别输入是否生效，用**点启动器图标看前台 Activity**（`dumpsys activity activities | grep -m1 topResumedActivity`）这种有唯一答案的目标。
5. **量化证据要配「真的动了」**：`[perf]` warn 只在**连续 2 个 2s 窗口 < 30fps** 时上报（`packages/mobile/services/perfMonitor.ts`，后台暂停窗口不报）。所以「零 warn」单独不成立——必须同时给出「列表滚到第 N 名 / 打开了哪个页面」。
   **长采样脚本要给每个 adb 调用套 `timeout`**（如 `A() { timeout 25 adb -s "$S" "$@"; }`）：实测一次 `dumpsys` 挂住，让 23 分钟的采样在**第 6 个样本静默停摆**，而任务状态仍显示 running——不加超时就会交出一轮「看着在跑、其实没数据」的取证。
6. **收尾**：验收结束停掉 Metro。`adb kill-server` 会打掉所有人的 reverse——动过 server 后 `adb reverse --list` 确认自己的端口还在。

## 验收准备别靠点触摸应用内 UI

RN 的 `ScalePress` 对注入触摸**时灵时不灵**：同一实例上，设置齿轮 / 「+ 添加 URL 订阅」/ 播放模式按钮对 `input tap`、长按式 `input swipe x y x y 200`、5 次连点**全无响应**（齿轮有 ripple 却不导航；按钮连 Alert 都不弹，说明 handler 压根没跑），而同屏原生 `Switch` / `TextInput` 正常。**点不动且没有任何状态变化（无 Alert、无导航、无日志）时，先怀疑「这个控件不吃注入触摸」**，别继续换坐标试。

可靠替代——验收准备要的是「设备处于某个状态」，不是「按钮被按过」：

- **导航**用深链，不点按钮：`adb shell am start -a android.intent.action.VIEW -d 'mplayer://settings' -p com.mplayer.mobile.dev`。
- **配置**用临时注入，不填表单：在 `packages/mobile/app/_layout.tsx` 临时调 `core.addTier3SubscriptionFromUrl(...)` + `setTier3Enabled(true)`，跑一次让它**落进 AsyncStorage**，随后**立刻回退源码**——设备照常可用，敏感值全程不入库（tier3 实测就是这么配上的）。
- **断言**用 dump 的文本，不靠看像素（见取证 §2）。

release 包 applicationId 不同（`com.mplayer.mobile` vs `.dev`），dev 上配好的数据**不会带过去**，且 release 没有 dev 工具——要验 release 的播放判据，只能用**带注入的构建**（构建产物本身也不入库）。

## 图附到 PR（正文 / 验收评论）

`gh pr edit <PR> --attach '<png>#<图注>'`（PR 正文）或 `gh pr comment <PR> --attach '<png>#<图注>'`（追加一条评论；验收结论本来就是评论时用这个，别去动 PR 正文）。（本机 gh 2.101.0 已验证；`gh pr edit --help` 里没有 `--attach` 就是版本太老）。**必须在 git 仓库目录内执行**，临时目录里会报 not a git repository。

- 上传**不是走 REST API**：评论图片是浏览器会话专属通道（`POST /<owner>/<repo>/upload/policies/assets` + S3），拿 token 直接打只会 422。要程序化上传就用上面的 `--attach`，不要自己拼那个端点。
- 评论正文改错了用 `gh api -X PATCH repos/{owner}/{repo}/issues/comments/<id> -F body=@body.md` 精确覆盖（`gh pr comment --edit-last` 也能改，但它只认"自己最后一条"）。

- **可靠做法是两步**：① `--attach` 把图传上去（可重复，一次最多 50 个）——正文里**没被引用**的附件会以 `![图注](URL)` 追加到正文末尾；② `gh pr view <PR> --json body --jq .body` 读出 `user-attachments` URL，用 `--body-file` 把正文排成「说明 → 图」，末尾那份重复删掉。
- 一步到位的唯一前提：正文里的链接目标与 `--attach` 传入路径**逐字一致**（实测 `![x](D:\...\shot.png)` + `--attach 'D:\...\shot.png#x'` 会被改写成上传后的 URL；写 basename 或 `./shot.png` 不命中，只会多追加一份）。
- **正文只引上传后的 URL**：本地路径（含相对路径）不渲染，会显示成裂图。
- **传完要验，别只看命令退出码**：① 读回正文（`gh pr view <PR> --json body --jq .body` / `gh api .../issues/comments/<id> --jq .body`），每个图片引用都应是 `user-attachments` URL、本地路径残留为 0；② 公开仓库再抓一次 PR 页面 HTML，确认 asset id 出现在渲染产物里；③ 抽一个 asset `GET`（带浏览器 UA）应回 `200` + `Content-Type: image/png` + PNG 魔数 `89 50 4e 47`——**别用 HEAD 判断**，`user-attachments` 对 HEAD 回 403。
- 图注写「这张图证明了什么」（如「热榜滚到第 194–200 名 → `getItemLayout` 偏移算术正确」），不写文件名；部分文件上传失败时正文仍会更新，看退出码。

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

**附带好处**：`console.log` 在 logcat 可见，所以 `[player]` 一类排查优先在 dev build 上做。

**应用内日志本来就进 logcat，别重复埋点**：`useLogsStore.addLog` 会镜像 `console`（`packages/mobile/stores/logsStore.ts`），`info` 的级别门禁只作用于**应用内缓冲**（dev build 或设置页「开发者模式」才收 info，#477）——为取证再加一份 `console.log` 是重复劳动。分级与开关见 `docs/research/2026-09-29-mobile-developer-mode-and-diagnostics.md`。

> **更正（2026-09-30 · #477 收口）**：此处原写「release 会把 JS 日志剥掉」——**本仓没有这个机制，确定不剥**。
> Expo 默认**不**剥离 `console`，要显式开 Terser 的 `drop_console` 才剥（<https://docs.expo.dev/guides/minify/>）；
> 而本仓 `packages/mobile/metro.config.js` 未设 `transformer.minifierConfig`、`babel.config.js` 无 console 剥离插件，
> 且 Hermes 变体走的是 `--minify false`（`@react-native/gradle-plugin` 的
> `TaskConfiguration.kt:80` 按 `hermesEnabled` 取反，本仓 `android/gradle.properties:43` 为 true），
> 于是 terser 根本不跑。**可复核证据**：`npx expo export:embed --platform android --dev false --minify false …`
> 后 grep 产物中 `console.log` 计数 > 0（#477 PR 内可跑，不需真机 release 包）。
> 结论与四层证据见 `docs/research/2026-09-29-mobile-developer-mode-and-diagnostics.md` §0.1。

## 陷阱速查

- **attach 报 `Device busy (exported)`**：Windows 正占用设备。两个来源：手机处于「文件传输/MTP」模式（下拉通知切成「仅充电」，USB 调试保持开）；或另一条回路的 adb 被拉起（`/mnt/c/Users/Admin/scoop/shims/adb.exe kill-server`）。切换 USB 模式会让设备重新枚举，bind 可能要重做——重跑 usb-attach.mjs。
- **之前能用，突然 `no devices`**：usbipd 透传掉了（拔插、省电、重新枚举都会）。重跑 usb-attach.mjs 即可。
- **开发态验收用 Expo Go，不是装机 APK**：`com.mplayer.mobile` 是 release 构建（无 DEBUGGABLE），跑打包 JS、不连 Metro——看不到 `Running "main"` 与 bundling 日志就是这个原因。
- **原生能力必须 dev client**：Expo Go 下 `setActiveForLockScreen` 被跳过（`services/audioPlayer.ts` 的 `if (!isExpoGo)`）、`enableBackgroundPlayback` 插件不生效（#327）——后台播放 / 锁屏 / 通知栏类验收在 Expo Go 上得到的结论无效，别写进 PR。
- **改了 core 必须重建**：移动端 Metro 吃 `packages/core/dist` 产物。dist 过期的典型症状是启动即 `undefined is not a function`（core 新导出不存在）——`npm run core:build` 后冷启 App；行为诡异时 `./scripts/mobile-debug.mjs -c` 清 Metro 缓存。
- **worktree 里调真机**：`packages/mobile/node_modules` 软链到主克隆时，`expo-router` 的 babel 插件按「被转换文件的真实路径」反推 app root（`babel-preset-expo` 的 `getExpoRouterAppRoot`），`_ctx.android.js` 的真实路径落在主克隆 → **打包的是主克隆的 `app/`**，worktree 的改动全部不生效（症状：改了没反应）。修法：worktree 就地 `npm install`；临时救急用 `cp -al` 硬链主克隆的 `node_modules` 与 `packages/mobile/node_modules`（硬链的真实路径落在 worktree 内，app root 推导才正确）。
- **Metro 报 500**：先 curl bundle URL 看错误体。常见根因是 Metro 实例的 projectRoot 不是 `packages/mobile`（陈年残留进程，解析到仓库根）——杀掉它重起。App 收到的 manifest 里 `projectRoot` 字段可直接验。
- **多会话共抢一台手机**：其他 worktree 会话可能也在调试（各自 Metro 占 8082 等端口、互相拉起 App）。`adb kill-server` 会打掉**所有人**的 reverse 隧道——动过 server 后跑 `adb reverse --list` 确认自己的端口还在，App 的 `initialUri` 要指向自己的端口。
- **双 transport 串线**：设备同时挂 USB + 无线两条 transport 时 reverse 静默不通（App 拉起但 JS 永远不跑、Metro 无 bundling 记录）。修法：`adb disconnect` 只留 USB，重建 reverse，冷启。mobile-debug.mjs 已内置该检查。
- **`adb install` 把 server 卡死 / 5037 被抢**：实测 80MB 的 `adb install` 能把 adb server 卡到 `adb devices` 都超时。处置：改 `adb push` + `adb shell pm install`；仍卡死就查占用者（Windows：`Get-NetTCPConnection -LocalPort 5037 -State Listen`）——`D:\leidian\LDPlayer14\adb.exe` 与 scoop 的 `android-clt\...\adb.exe` 都会抢 5037，杀掉后让 WSL 侧 `~/.local/bin/adb start-server` 接管。
- **CMake 250 字符对象路径上限**：在深层 worktree（如 `.claude/worktrees/<name>`）里跑 `./gradlew assembleDebug` 会因原生模块对象路径过长失败，症状是 CMake 警告 `CMAKE_OBJECT_PATH_MAX` + `ninja: error: manifest 'build.ninja' still dirty after 100 tries`。修法：换到路径更短的检出（主克隆）构建，或加 `subst` 短盘符。
- **验证隧道别用手机侧 nc**：Android toybox nc 静默失败。以 Metro bundling 日志 + ReactNativeJS 日志为准。
- **模拟器飞行模式会连 adb 一起断，且不可恢复**：雷电上 `cmd connectivity airplane-mode enable` 后 `adb shell` 立即返空、`127.0.0.1:5555` 变 offline，`ldconsole quit/launch` 重启 VM 后 **adbd 也不回来**（实例报废）。**断网类验收一律走真机 USB**（`svc wifi disable && svc data disable` 不影响 USB adb）。实例报废后重建：`ldconsole add --name <n>` + `launch --index <i>`，**端口 = 5555 + 2×index**（index 1 → 5557），且**新实例默认 720×1280**，坐标要重新 `wm size` 取。
- **「进程被杀后恢复」用 `am force-stop`，不要用 `am kill`**：`am kill` 对**带前台服务的进程是空操作**（pid 不变）——这本身可当「FGS 真的生效」的旁证，但验不了恢复路径；模拟器又没有 `su`，`kill -9` 用不了。`am force-stop` 更狠（连服务一起停），验出来更硬。
- **多步 adb 编排写成脚本再跑**：内联进 `pwsh -Command` 会被吃掉引号/反斜杠/`$`（实测踩过 `unknown command adb`）。脚本连同**探针**都写 `%TEMP%`，别落在 worktree 根——`git add -A` 会把它带进提交（实测补了一个 `chore:` 才删掉）。
- **无线调试（不用 USB 的备用路线）**：镜像网络下手机可直连开发机局域网 IP 拉 bundle（Hyper-V 防火墙需放行 8081）；无线 adb 端口每次重连随机，`adb mdns services` 扫 `_adb-tls-connect._tcp`，配对码 30 秒过期。适合临时看 UI，长会话仍走 USB。
