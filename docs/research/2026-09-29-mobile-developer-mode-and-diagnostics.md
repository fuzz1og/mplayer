# 移动端「开发者模式 / 埋点」调研与落地方案

> 类型：调研 + 方案（待拍板）· 关联 **#477** · 日期 2026-09-29 · 依据：本仓源码实测 + 外部一手文档（**外部部分见 §5「待核对」——本会话网络工具不可用，未逐条核对原文**）
> 口径：仓库结论一律给 `file:line`（worktree `drag-jank-probe`，基线 `origin/master`）；外部结论只给**待核对清单**，不伪装成已核实。

## 1. 一句话问题

MPlayer 现在**没有开发者模式**：诊断能力散在四个服务里、各写各的，唯一面向用户的诊断面是设置页的「播放诊断」，
而且**分两个可见构建**（`com.mplayer.mobile` / `com.mplayer.mobile.dev`）。维护者的诉求是：
能不能像别的软件那样有个开发者模式，把埋点/日志开关收进去，**release 构建也能按需出诊断**。

## 2. 仓库现状（全部 `file:line` 实证）

### 2.1 已有的诊断资产——不弱，但**没有统一开关，也没有读取入口**

| 资产 | 位置 | 现状 |
|---|---|---|
| 应用内日志环形缓冲 | `packages/mobile/stores/logsStore.ts:11` | `MAX_ENTRIES = 100`，`addLog` 镜像到 `console`（`:37-44`）。**除 Toast 用的 `notice` 外没有任何 UI 读它**——写进去的日志没人看得到 |
| JS 帧率看门狗 | `packages/mobile/services/perfMonitor.ts` | 常驻，持续掉帧才 warn；现场含 `route/player/drag` |
| 播放解析链 trace | `packages/mobile/services/playbackTrace.ts` + `components/settings/DiagnosticsSection.tsx:58-61` | 会话内环形缓冲（最多 200 条，展示 20 条），`:76` 导出写文档目录并唤起系统分享（`:156` 注明不落盘、不外传） |
| 拖拽跟手探针 | `packages/mobile/services/dragJankProbe.ts` | #430 本轮新增；掉帧 warn、干净手势仅 `__DEV__` 记 info |
| 封面失败埋点 | `packages/mobile/services/coverDiagnostics.ts` | #466 本轮新增；同 URL 只报一次、每 scope 上限 10 条 |

### 2.2 构建面：两个并存的包名

- `packages/mobile/android/app/build.gradle:128` → debug 变体 `applicationIdSuffix '.dev'`，即 `com.mplayer.mobile.dev`。
- 于是现状是**三个运行环境**：Expo Go、dev build（`.dev`）、release（`com.mplayer.mobile`）。
- 设置页现有 8 个区段（`packages/mobile/components/settings/`）：About / Appearance / Cache / Diagnostics / DirectStatus / Playback / Tier3 / Update——**没有任何一处是「开发者」语义**。

### 2.3 缺口（这才是要解决的）

1. **没有统一开关**：`perfMonitor` 常驻、`dragJankProbe` 看 `__DEV__`、`coverDiagnostics` 无门禁、`playbackTrace` 恒开——四套策略。
2. **日志写进去读不出来**：100 条环形缓冲零消费方。
3. **release 上诊断能力等于零**：JS 侧日志没有落点，仓库自己的 skill 也提醒 release 会剥掉 JS 日志（**该说法未按一手来源核实**，见 §5）。
4. **诊断要靠「换个包名」**：想看日志就得装 dev build——对维护者本人够用，对「用户在真机上复现一次给我看」不够用。

## 3. 参照的行业惯例（**待核对，见 §5**）

公认做法可以概括成四条，每条都对应 §2.3 的一个缺口：

1. **隐藏入口**：Android 系统「开发者选项」的经典做法是**在版本号上连点若干次**——不占正常 UI、不误导普通用户。
2. **进了门才有级别**：开发者模式门禁的不是「有没有日志」，而是**日志级别/详略**（常态静默，verbose 才铺开）。
3. **有读有带走**：面板里能看（日志查看器）+ 能导出（分享文件）。
4. **构建分层**：`__DEV__` 管开发期；生产期用构建配置/profile 区分「带诊断」与「纯发布」，而不是发两个长得一样的 App。

## 4. 建议方案（最小首片 + 后续）

### 4.1 首片（建议一次做完，改动面可控）

1. **`services/devMode.ts`**：`isDevMode()` / `setDevMode(on)` / 订阅；状态存 `stores/settingsStore`（沿用既有 AsyncStorage persist），**不新引入依赖**。
2. **入口**：设置页 `AboutSection` 的版本行**连点 7 次**切换（沿用 Android 惯例），开启时才在设置页追加 `DeveloperSection`。
3. **统一日志级别**：给 `logsStore` 加 `level` 门禁（`silent | normal | verbose`），并把现有四套策略收敛成「**常态只记 warn/error；`verbose` 才记 info**」。`dragJankProbe` 的 `__DEV__` 判断改成 `__DEV__ || isDevMode()`——**dev 构建行为不变**。
4. **补上读取入口**：`DeveloperSection` 里加一个日志查看器（读 `logsStore.entries`）+ 「导出诊断」——**复用 `playbackTrace` 已验证的导出姿势**（写文档目录 + 系统分享），把日志缓冲与 playback trace 打成一个包。
5. **保持隐私口径**：仍然不落盘、不外传（除用户主动导出）；**不做**远程上报。

### 4.2 后续（首片落地后再评估）

- 把 `coverDiagnostics` / `dragJankProbe` 的计数也接进导出包（现在只有日志行）。
- 评估是否需要「带诊断的 release 变体」（同 applicationId、不同构建 profile）以覆盖「用户真机复现」场景——**本方案的立场是先不要**：先把 `isDevMode()` 这条路走通，它已经能覆盖 release 上的取证需求，且不需要多维护一个构建产物。

### 4.3 明确不做

- 不在 release 默认打 console 洪水（现在是常态静默，别退回）。
- 不为诊断再分叉出一个「长得一样的 App」。
- 不引入第三方日志/监控 SDK 作为前置条件（先自足；将来要接 Sentry 一类再单独评估隐私面）。

## 5. 待核对（本会话网络工具不可用，以下**一律未核实原文**）

需要逐条打开并核对后再把 §3 从「惯例」升级为「有出处的结论」：

| 要问的问题 | 应查的一手来源 |
|---|---|
| 连点版本号开启开发者选项的官方描述 | `developer.android.com/studio/debug/dev-options` |
| `__DEV__` 的准确定义与 release 下的取值 | React Native 官方文档（Global / JavaScript Environment） |
| release 构建是否真的会剥掉 JS `console` 日志、由谁剥（Metro minifier？babel 插件？） | Metro / `babel-preset-expo` / `babel-plugin-transform-remove-console` 文档与源码 |
| dev client 与 production build 的能力差（`expo-dev-client`） | `docs.expo.dev/develop/development-builds/introduction` |
| 如何读构建类型/包名做门禁 | `expo-application`（`nativeBuildType` / `applicationId`）文档 |
| 用构建 profile / 更新 channel 区分诊断能力 | `docs.expo.dev/build/eas-json`、`expo-updates` 文档 |
| 本地导出与分享的 API | `expo-file-system`、`expo-sharing` / RN `Share` 文档 |

**未验证的仓库侧说法**：`.agents/skills/mobile-device-debugging/SKILL.md` 里「release 会把 JS 日志剥掉」——本会话未核到一手来源，
而这直接决定 §4.1 第 5 条（「release 上诊断能力等于零」）是否成立，**实施前必须先确认**。
