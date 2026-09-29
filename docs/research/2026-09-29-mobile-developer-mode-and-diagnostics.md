# 移动端「开发者模式 / 埋点」调研与落地方案

> 类型：调研 + 方案（待拍板）· 关联 **#477** · 日期 2026-09-29
> 依据：本仓源码实测（全部给 `file:line`）+ 官方文档原文（`docs.expo.dev` 的 **Markdown 版**，逐条给了引用原文）
> 口径：**已核实**与**未取到**分开写；不把没核到的东西写成结论。

## 0. 最重要的那条结论（它推翻了仓库里的一句话）

**Expo 默认不会剥掉 JS 的 `console` 日志；我们这个仓库也没有配置任何剥离机制。**

- 官方 minify 指南原文：「The **default** minification of Expo CLI is sufficient for most projects. However, you can customize the minifier to optimize for speed or remove additional features like logs.」
  以及「## Remove console logs — You can remove console logs from your production build. Use the **`drop_console`** option in the Terser minifier config.」
  —— 出处：<https://docs.expo.dev/guides/minify/>（Agent 版：<https://docs.expo.dev/guides/minify.md>）
- 本仓 `packages/mobile/metro.config.js` **只设了 `resolver.blockList`，没有 `transformer.minifierConfig`** → 没开 `drop_console`；
  `packages/mobile/babel.config.js` **只有 `presets: ['babel-preset-expo']`** → 没有 `babel-plugin-transform-remove-console`。
- 而 `.agents/skills/mobile-device-debugging/SKILL.md:90` 写着「debug 构建的 `console.log` 在 logcat 可见（**release 会把 JS 日志剥掉**）」。
  **这句在本仓没有机制支撑**——要么它指的是别的机制（需在 release 构建上实测），要么就是错的。已按「未核实、与仓库配置不一致」改写该行。

**为什么这条最重要**：它决定了 §3 的方案形态。如果 release 真的会剥日志，就得先造一个「带诊断的构建」；
**既然没剥，缺的只是「开关」和「读取入口」**——方案因此小得多。

### 0.1 顺带一个可直接用的机制：按级别选择性剥离

同一页文档给了：`drop_console: ['log', 'info']` 会移除 `console.log` / `console.info`，**保留 `console.warn` 与 `console.error`**。
这正好是「常态安静、warn/error 永远留」这条纪律的**构建期**版本，将来若真要收紧 release 噪音，用它而不是自己造门禁。

## 1. 一句话问题

MPlayer 现在**没有开发者模式**：诊断能力散在四个服务里、各写各的，唯一面向用户的诊断面是设置页的「播放诊断」，
而且要靠装另一个包名才能拿开发期日志。诉求：有个开发者模式，把埋点/日志开关收进去，**release 也能按需出诊断**。

## 2. 仓库现状（全部 `file:line` 实证）

### 2.1 已有的诊断资产——不弱，但**没有统一开关，也没有读取入口**

| 资产 | 位置 | 现状 |
|---|---|---|
| 应用内日志环形缓冲 | `packages/mobile/stores/logsStore.ts:11` | `MAX_ENTRIES = 100`，`addLog` 镜像 `console`（`:37-44`）。**除 Toast 用的 `notice` 外没有 UI 读它** |
| JS 帧率看门狗 | `packages/mobile/services/perfMonitor.ts` | 常驻；持续掉帧才 warn，现场含 `route/player/drag` |
| 播放解析链 trace | `packages/mobile/services/playbackTrace.ts` + `components/settings/DiagnosticsSection.tsx:58-61,76` | 会话内环形缓冲（最多 200 条，展示 20 条），导出写文档目录并唤起系统分享（`:156` 注明不落盘、不外传） |
| 拖拽跟手探针 | `packages/mobile/services/dragJankProbe.ts` | #430 新增；掉帧 warn、干净手势仅 `__DEV__` 记 info |
| 封面失败埋点 | `packages/mobile/services/coverDiagnostics.ts` | #465 后续新增；同 URL 只报一次、每 scope 上限 10 条 |

### 2.2 构建面

- `packages/mobile/android/app/build.gradle:128` → debug 变体 `applicationIdSuffix '.dev'`，与 release 共存（skill `:59` 也这么写）。
- 三个运行环境：Expo Go、dev build（`.dev`）、release（`com.mplayer.mobile`）。
- 设置页 8 个区段（`packages/mobile/components/settings/`）：About / Appearance / Cache / Diagnostics / DirectStatus / Playback / Tier3 / Update——**没有一个是开发者语义**。
- 已装的相关依赖（`packages/mobile/package.json`）：`expo-constants`、`expo-file-system`、**`expo-dev-client`**；
  **未装**：`expo-application`、`expo-sharing`、`expo-updates`（要用需新增）。

### 2.3 缺口

1. **没有统一开关**：`perfMonitor` 常驻 / `dragJankProbe` 看 `__DEV__` / `coverDiagnostics` 无门禁 / `playbackTrace` 恒开——四套策略。
2. **日志写进去读不出来**：100 条环形缓冲零消费方。
3. **诊断要靠换包名**：对维护者够用，对「用户在真机上复现一次给我看」不够用。
4. ~~release 上诊断等于零~~ —— **撤销**：见 §0，本仓没有剥离机制，日志本来就出得来，只是没人看、也没开关。

## 3. 建议方案（最小首片 + 后续）

### 3.1 首片（建议一次做完，改动面可控）

1. **`services/devMode.ts`**：`isDevMode()` / `setDevMode(on)` / 订阅；状态存 `stores/settingsStore`（沿用既有 AsyncStorage persist），**不新引入依赖**。
2. **入口**：设置页 `AboutSection` 的版本行**连点若干次**开启（下一节给了这条惯例的出处），开启后才追加 `DeveloperSection`。
3. **门禁的是级别而不是有无**：给 `logsStore` 加 `silent | normal | verbose`，把四套策略收敛成「常态只记 warn/error，`verbose` 才记 info」；
   `dragJankProbe` 的 `__DEV__` 判断改成 `__DEV__ || isDevMode()`（**dev 构建行为不变**）。
4. **补读取入口**：`DeveloperSection` 里加日志查看器（读 `logsStore.entries`）+ 「导出诊断」，
   **复用 `playbackTrace` 已验证的导出姿势**（写文档目录 + 系统分享），把日志缓冲与 trace 打成一个包。
5. **隐私口径不变**：不落盘、不外传（除用户主动导出）；**不做**远程上报。

### 3.2 后续（首片落地后再评估）

- 把 `coverDiagnostics` / `dragJankProbe` 的计数也接进导出包（现在只有日志行）。
- 若 release 噪音成为问题，用 §0.1 的 `drop_console: ['log','info']` 在**构建期**收紧，而不是再加一层运行时门禁。
- 「带诊断的 release 变体」**本方案主张先不做**：`isDevMode()` 已能覆盖 release 取证，且不需要多维护一个构建产物。

### 3.3 明确不做

- 不在 release 默认打 console 洪水。
- 不为诊断再分叉出一个「长得一样的 App」。
- 不把第三方日志/监控 SDK 作为前置条件（将来要接再单独评估隐私面）。

## 4. 已核实的外部依据（每条附原文引用）

### 4.1 构建期：日志会不会被剥

| 结论 | 原文引用 | 出处 |
|---|---|---|
| Expo **默认不剥** console，要显式开 `drop_console` | 「The **default** minification of Expo CLI is sufficient for most projects. However, you can customize the minifier to optimize for speed or remove additional features like logs.」 | <https://docs.expo.dev/guides/minify/> |
| 可**按级别**选择性剥离 | 「`drop_console: ['log', 'info']` will remove `console.log` and `console.info` but **preserve `console.warn` and `console.error`**」 | 同上 |
| dev build = 把 `expo-dev-client` 编进应用的构建 | 「a development build is the app compiled with the expo-dev-client library included」 | <https://docs.expo.dev/develop/development-builds/introduction/> |

### 4.2 门禁的对象：级别，不是布尔

这条**印证**了 §3.1 第 3 条（「门禁的是级别而不是有无」）——两个第一方日志系统都是分级 + 按级别判定的：

| 结论 | 原文引用 | 出处 |
|---|---|---|
| Android `Log` 五级，按 tag + level 判定是否输出 | 「Checks to see whether or not a log for the specified tag is loggable at the specified level.」；「The order in terms of verbosity, from least to most is ERROR, WARN, INFO, DEBUG, VERBOSE.」 | <https://developer.android.com/reference/android/util/Log#isLoggable(java.lang.String,%20int)> |
| Apple 统一日志的级别体系，且**级别决定落盘** | 「The various log levels that the unified logging system provides.」；「The log level determines which messages stay in memory and which go to disk.」 | <https://developer.apple.com/documentation/os/oslogtype.md> · <https://developer.apple.com/documentation/os/logger.md> |
| 埋点**默认脱敏**有第一方依据 | 「the system redacts the value of that string or object by default」（要 `privacy: .public` 才可见） | <https://developer.apple.com/documentation/os/logger.md> |

### 4.3 入口：隐藏门的先例

| 结论 | 原文引用 | 出处 |
|---|---|---|
| Android 开发者选项：连点 Build number **7 次** | 「Tap the Build Number option **seven times** until you see the message `You are now a developer!`」；「On Android 4.2 and higher, you must enable this screen.」 | <https://developer.android.com/studio/debug/dev-options> |
| Apple 的门是**条件出现**（只在与 Mac 配对后出现），而不是常驻 | 「Developer Mode only appears in Settings if you initiate pairing or if you previously paired the device to a Mac.」 | <https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device> |
| Chrome 用内部 scheme 承载开关 | 「The special URL of interest here is `chrome://flags`.」 | <https://developer.chrome.com/blog/browser-flags> |

### 4.4 「能看 + 能带走」的官方形态

| 结论 | 原文引用 | 出处 |
|---|---|---|
| Android：开发者选项里生成 bug report，完成后**由用户自己从通知分享** | 「To share the bug report, tap the notification.」；「A bug report contains device logs, stack traces, and other diagnostic information…」 | <https://developer.android.com/studio/debug/bug-report> |
| Apple：由用户**主动采集并提交** profiles/logs | 「collect and submit profiles, logs, and reproducible test cases」 | <https://developer.apple.com/bug-reporting/profiles-and-logs> |

> 这两条与 MPlayer 现有 `playbackTrace` 的导出姿势（写文档目录 + 唤起系统分享、不落盘不外传）**同构**——§3.1 第 4 条是沿着已被第一方验证的形态走，不是自创。

### 4.5 不另发 App 就给 release 开诊断

| 结论 | 原文引用 | 出处 |
|---|---|---|
| 远程配置可当 feature flag 用 | 「lets you change the behavior and appearance of your client app or server without requiring users to download an app update.」 | <https://firebase.google.com/docs/remote-config> |
| EAS build profile 是「一组具名配置」 | 「A build profile is a named group of configurations that describes the necessary parameters to perform a certain type of build.」（development profile 用 `"developmentClient": true`） | <https://docs.expo.dev/build/eas-json/> |

> 结论：**有**官方机制支撑「release 开诊断」；但本方案首片仍主张先不上远程配置（§3.2）——本地开关已够用，少一个线上依赖。

### 4.6 隐私口径

| 结论 | 原文引用 | 出处 |
|---|---|---|
| Google Play 要求申报数据收集与处理 | 「All developers must declare how they collect and handle user data for the apps they publish on Google Play」 | <https://support.google.com/googleplay/android-developer/answer/10787469> |
| Apple 用 privacy manifest 记录收集的数据类型 | 「The privacy manifest is a property list that records the following information: - The types of data collected by your app or third-party SDK.」 | <https://developer.apple.com/documentation/bundleresources/privacy-manifest-files> |

> 这正是 §3.1 第 5 条「不落盘、不外传、只走用户主动导出」的合规依据：**不收集**就不需要申报。方案保持这条线。

> 附带一条工程实践：**`docs.expo.dev` 的页面在 URL 后加 `.md` 就是 Markdown 版**（页内有 `<link rel="alternate" type="text/markdown">`），
> 另有全量索引 <https://docs.expo.dev/llms.txt>。抓 Expo 文档应当直接取 `.md`，比抓 HTML 干净得多、也快得多。

## 5. 未取到 / 仍需实测

1. **`expo-application` 的 `nativeBuildType`**：在 latest 文档里**没有出现**（只核到 `applicationId`）。
   若要用「运行时判断当前是不是 debug 构建」，得先确认这个字段是否存在，或改用 `Application.applicationId` 是否带 `.dev` 后缀（本仓 debug 变体的后缀见 §2.2）。
2. **本仓 release 构建上 JS `console` 到底可不可见**：配置层面已证明「无剥离机制」，但**没有在 release 包上实测过**。
   验收时应实测一次（`com.mplayer.mobile` 冷启后看 logcat 有没有 `ReactNativeJS`），再决定要不要改 skill 那句。
3. ~~连点版本号开启开发者选项的官方原文页~~ → **已取到**，见 §4.3（「连点 **seven times**」原文）。§3.1 第 2 条据此采纳：本方案用 **7 次**，与 Android 系统一致。
4. EAS build profile / `expo-updates` channel 的原文未取（首片不需要，留到 §3.2 评估时再核）。
