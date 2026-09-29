# 移动端「开发者模式 / 埋点」调研与落地方案

> 类型：调研 + 方案（待拍板）· 关联 **#477** · 日期 2026-09-29
> 依据：本仓源码/依赖源码逐层实测（给 `file:line`）+ 官方文档原文引用。**已核实**与**未取到**分开写。

## 0. 最重要的两条结论

### 0.1 本仓 release **不会**剥掉 JS `console`（四层证据 + 一个反证）

`.agents/skills/mobile-device-debugging/SKILL.md:90` 写「release 会把 JS 日志剥掉」——**在默认配置下这个断言是错的**。逐层核过：

| 层 | 检查结果 |
|---|---|
| Babel | `packages/mobile/babel.config.js:4` 只有 `'babel-preset-expo'`，无任何 remove-console 插件；`babel-plugin-transform-remove-console` 不在依赖里 |
| Metro | `packages/mobile/metro.config.js:1-19` 未设 `transform.minifierConfig` |
| Metro 默认值 | 默认 `minifierConfig` 里没有 `drop_console`（`metro-config/src/defaults/index.js:120-136`）；`metro-minify-terser/src/minifier.js:27-49` 原样透传 config |
| preset | `babel-preset-expo@57.0.7` 整个 `build/` 逐目录搜索，**无** `remove-console` / `drop_console` 命中 |
| release 实际只做 | `--minify true`（`BundleHermesCTask.kt:168-169`）+ R8（`app.json:43-44` 的 `enableMinifyInReleaseBuilds`）。**R8 只作用于 Java/Kotlin**，且 `proguard-rules.pro` 里没有 `-assumenosideeffects android.util.Log` |

**反证（决定性）**：`@react-native/js-polyfills/console.js:579-589` 的 `console → global.nativeLoggingHook` 路径**没有 `__DEV__` 门控**
（该文件 `:582`/`:659` 的 `__DEV__` 只用于保留 debugger console），而钩子由 JSI **无条件绑定**
（`ReactCommon/jsitooling/react/runtime/JSRuntimeBindings.cpp:14-31`）。

> **仍未实测**：release 包（`com.mplayer.mobile`）里 `console` 在 logcat 上实际可不可见。配置层面已证「无剥离机制」，
> 但没在真机上跑过 release 包——这一条留在 §5，也是 #477 的验收项。

### 0.2 真正的构建能力差**不在日志**，而在没有 Metro / LogBox / dev-client

这一点比「日得不得得到日志」重要得多：release 里 `console` 调用仍在、仍会落到 native logger，
**但它没有 Metro 的热重载、没有 LogBox 的报错浮层、没有 dev-client 的菜单**——那才是 dev build 不可替代的部分。

⇒ 方案形态因此变小：release 上日志本来就出得来，缺的只是**开关**与**读取入口**。

### 0.3 Expo 官方确实提供「按级别选择性剥离」

官方 minify 指南：「The **default** minification of Expo CLI is sufficient for most projects. However, you can customize the minifier to optimize for speed or remove additional features like logs.」
以及「`drop_console: ['log', 'info']` will remove `console.log` and `console.info` but **preserve `console.warn` and `console.error`**」
（<https://docs.expo.dev/guides/minify/>）。这是「常态安静、warn/error 永远留」的**构建期**版本；要收紧 release 噪音时用它，别再造一层运行时门禁。

## 1. 一句话问题

MPlayer 现在**没有开发者模式**：诊断能力散在四个服务里、各写各的，唯一面向用户的诊断面是设置页的「播放诊断」，
而且要靠装另一个包名才能拿开发期日志。诉求：有个开发者模式，把埋点/日志开关收进去，**release 也能按需出诊断**。

## 2. 仓库现状（`file:line` 实证）

### 2.1 已有的诊断资产——不弱，但**没有统一开关，也没有读取入口**

| 资产 | 位置 | 现状 |
|---|---|---|
| 应用内日志环形缓冲 | `packages/mobile/stores/logsStore.ts:11` | `MAX_ENTRIES = 100`，`addLog` 镜像 `console`（`:37-44`）。**除 Toast 用的 `notice` 外没有 UI 读它** |
| JS 帧率看门狗 | `packages/mobile/services/perfMonitor.ts` | 常驻；持续掉帧才 warn，现场含 `route/player/drag` |
| 播放解析链 trace | `packages/mobile/services/playbackTrace.ts` + `components/settings/DiagnosticsSection.tsx:58-61,76` | 会话内环形缓冲（最多 200 条，展示 20 条），导出写文档目录并唤起系统分享（`:156` 注明不落盘、不外传） |
| 拖拽跟手探针 | `packages/mobile/services/dragJankProbe.ts` | #430 新增；掉帧 warn、干净手势仅 `__DEV__` 记 info |
| 封面失败埋点 | `packages/mobile/services/coverDiagnostics.ts` | #465 后续新增；同 URL 只报一次、每 scope 上限 10 条 |

### 2.2 构建面与依赖现状

- `packages/mobile/android/app/build.gradle:128` → debug 变体 `applicationIdSuffix '.dev'`，与 release 共存。
- 三个运行环境：Expo Go、dev build（`.dev`）、release（`com.mplayer.mobile`）。
- 设置页 8 个区段（`packages/mobile/components/settings/`）：About / Appearance / Cache / Diagnostics / DirectStatus / Playback / Tier3 / Update——**没有一个是开发者语义**。
- 依赖现状（`packages/mobile/package.json`）：**已是依赖** `expo-constants:22`、`expo-file-system:23`、`expo-dev-client:45`（devDependency）；
  **不是依赖** `expo-application`、`expo-sharing`、`expo-updates`（要新增）。
- **本仓没有 `eas.json`**（root 与 `packages/mobile` 均无），`app.json` 无 `updates` 键，CI 直接 `./gradlew assembleRelease`
  ⇒ §4.5 那套「构建 profile / 更新 channel」官方机制**在本仓尚未启用**，要用得从零建。

### 2.3 缺口

1. **没有统一开关**：`perfMonitor` 常驻 / `dragJankProbe` 看 `__DEV__` / `coverDiagnostics` 无门禁 / `playbackTrace` 恒开——四套策略。
2. **日志写进去读不出来**：100 条环形缓冲零消费方。
3. **诊断要靠换包名**：对维护者够用，对「用户在真机上复现一次给我看」不够用。
4. ~~release 上诊断等于零~~ —— **撤销**：见 §0.1/§0.2。

## 3. 建议方案

### 3.1 首片（改动面可控，宜一次做完）

1. **`services/devMode.ts`**：`isDevMode()` / `setDevMode(on)` / 订阅；状态存 `stores/settingsStore`（沿用既有 AsyncStorage persist），**不新引入依赖**。
2. **入口**：设置页 `AboutSection` 的版本行**连点 7 次**（依据见 §4.4），开启后才追加 `DeveloperSection`。
3. **门禁的是级别而不是有无**：给 `logsStore` 加 `silent | normal | verbose`，把四套策略收敛成「常态只记 warn/error，`verbose` 才记 info」；
   `dragJankProbe` 的 `__DEV__` 判断改成 `__DEV__ || isDevMode()`（**dev 构建行为不变**）。
4. **补读取入口**：`DeveloperSection` 里加日志查看器（读 `logsStore.entries`）+ 「导出诊断」。
   **零新增依赖**：照 `services/playbackTrace.ts:88-93` 的既有姿势（`expo-file-system/legacy` 写文档目录 + RN `Share.share`），该文件 `:83` 就注明了「不新增依赖」。
5. **隐私口径不变**：不落盘、不外传（除用户主动导出）；**不做**远程上报——也正因此无需做数据收集申报（§4.6）。

### 3.2 后续（首片落地后再评估）

- 把 `coverDiagnostics` / `dragJankProbe` 的计数也接进导出包（现在只有日志行）。
- 若 release 噪音成为问题，用 §0.3 的 `drop_console: ['log','info']` 在**构建期**收紧。
- 「带诊断的 release 变体」与 EAS profile/channel：官方机制存在（§4.5），但**本仓要先从零建 `eas.json`**；首片不需要，故不做。

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
| 不开 `developmentClient` 就是**没有开发工具的独立包** | 「set `developmentClient` to `true` on a build profile… Without it, EAS Build produces a standalone build with no development tools」 | Expo `dev-client` 文档 |

### 4.2 `__DEV__` 到底怎么变 false（编译期内联）

RN 官方页（<https://reactnative.dev/docs/global-__DEV__>）：「inlined during compilation and gets **completely stripped out with the if blocks it guards** in the minified build」。
本仓的具体落点：`packages/mobile/node_modules/expo/node_modules/babel-preset-expo/build/configs/expo.js:223-227` —— `options.isProduction` 时
`inlines['__DEV__'] = false`（由 `plugins/define-plugin.js` 完成内联）。**所以 release 下 `if (__DEV__) { … }` 是整块被删掉的**，
`__DEV__` 门禁**不需要**运行时判断、也不增加包体——这一条支撑 §3.1 第 3 条「dev 构建行为不变」。

### 4.3 运行时判断「我是不是 debug 构建」

| 结论 | 依据 |
|---|---|
| `expo-application` **没有** `nativeBuildType` | 读 `packages/expo-application/src/Application.ts` 导出列表（只有 `applicationId` / `nativeApplicationVersion` / `nativeBuildVersion` / `getAndroidId` …），SDK 文档亦无此名 → **不要用它** |
| 可用 `Application.applicationId` | 「On Android, this is the application ID.」 <https://docs.expo.dev/versions/latest/sdk/application/>（本仓 debug 变体带 `.dev` 后缀，见 §2.2，可据此判构建） |
| 可用 `Constants.debugMode` | 「true when the app is running in debug mode (__DEV__)」，<https://docs.expo.dev/versions/latest/sdk/constants/>（`expo-constants` **已是依赖**） |
| 可用 `Constants.executionEnvironment` / `expoConfig` / `expoConfig.extra` | 同上 |

### 4.4 门禁的对象：级别，不是布尔

| 结论 | 原文引用 | 出处 |
|---|---|---|
| Android `Log` 五级，按 tag + level 判定是否输出 | 「Checks to see whether or not a log for the specified tag is loggable at the specified level.」；「The order in terms of verbosity, from least to most is ERROR, WARN, INFO, DEBUG, VERBOSE.」 | <https://developer.android.com/reference/android/util/Log#isLoggable(java.lang.String,%20int)> |
| Apple 统一日志的级别体系，且**级别决定落盘** | 「The various log levels that the unified logging system provides.」；「The log level determines which messages stay in memory and which go to disk.」 | <https://developer.apple.com/documentation/os/oslogtype.md> · <https://developer.apple.com/documentation/os/logger.md> |
| 埋点**默认脱敏**有第一方依据 | 「the system redacts the value of that string or object by default」（要 `privacy: .public` 才可见） | <https://developer.apple.com/documentation/os/logger.md> |

### 4.5 隐藏入口的先例

| 结论 | 原文引用 | 出处 |
|---|---|---|
| Android 开发者选项：连点 Build number **7 次** | 「Tap the Build Number option **seven times** until you see the message `You are now a developer!`」；「On Android 4.2 and higher, you must enable this screen.」 | <https://developer.android.com/studio/debug/dev-options> |
| Apple 的门是**条件出现**（仅与 Mac 配对后出现），不是常驻 | 「Developer Mode only appears in Settings if you initiate pairing or if you previously paired the device to a Mac.」 | <https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device> |
| Chrome 用内部 scheme 承载开关 | 「The special URL of interest here is `chrome://flags`.」 | <https://developer.chrome.com/blog/browser-flags> |

### 4.6 「能看 + 能带走」与隐私口径

| 结论 | 原文引用 | 出处 |
|---|---|---|
| Android：开发者选项生成 bug report，完成后**由用户自己从通知分享** | 「To share the bug report, tap the notification.」；「A bug report contains device logs, stack traces, and other diagnostic information…」 | <https://developer.android.com/studio/debug/bug-report> |
| Apple：由用户**主动采集并提交** profiles/logs | 「collect and submit profiles, logs, and reproducible test cases」 | <https://developer.apple.com/bug-reporting/profiles-and-logs> |
| Google Play 要求申报数据收集与处理 | 「All developers must declare how they collect and handle user data for the apps they publish on Google Play」 | <https://support.google.com/googleplay/android-developer/answer/10787469> |
| Apple 用 privacy manifest 记录收集的数据类型 | 「The privacy manifest is a property list that records the following information: - The types of data collected by your app or third-party SDK.」 | <https://developer.apple.com/documentation/bundleresources/privacy-manifest-files> |

> 前两行与 MPlayer 现有 `playbackTrace` 的导出姿势**同构**（写文档目录 + 唤起系统分享、不落盘不外传）；
> 后两行是 §3.1 第 5 条「不外传」的合规依据：**不收集**就不需要申报。

### 4.7 不另发 App 就给 release 开诊断的官方机制（本仓尚未启用）

| 结论 | 原文引用 / 仓库现状 | 出处 |
|---|---|---|
| 远程配置可当 feature flag 用 | 「lets you change the behavior and appearance of your client app or server without requiring users to download an app update.」 | <https://firebase.google.com/docs/remote-config> |
| EAS build profile 是「一组具名配置」 | 「A build profile is a named group of configurations that describes the necessary parameters to perform a certain type of build.」 | <https://docs.expo.dev/build/eas-json/> |
| **本仓未启用** | 无 `eas.json`（root 与 `packages/mobile` 均无）、`app.json` 无 `updates` 键、CI 直接 `./gradlew assembleRelease` | 仓库实测 |

## 5. 未取到 / 仍需实测

1. **release 包上 JS `console` 在 logcat 究竟可不可见**：配置层面已证「无剥离机制」（§0.1 四层 + 反证），但**没在真机上跑过 release 包**。
   这是 #477 的验收项；结论出来后再决定要不要把 skill 那句话彻底删掉（现在是「已更正 + 标注需实测」）。
2. `expo-application` / `expo-sharing` / `expo-updates` 若要引入，需确认 SDK 57 下的具体版本与是否需要 prebuild（本方案首片**不需要**它们）。
3. EAS profile / `expo-updates` channel 的原文细节未展开（首片不需要；真要启用时再核，且要先从零建 `eas.json`）。

> 工程实践（附带发现）：`docs.expo.dev` 的页面在 URL 后加 **`.md`** 就是 Markdown 版（页内有 `<link rel="alternate" type="text/markdown">`），
> 另有全量索引 <https://docs.expo.dev/llms.txt>。抓 Expo 文档应当直接取 `.md`，比抓 HTML 干净得多、也快得多。
