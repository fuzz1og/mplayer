# MPlayer

MPlayer 是一个跨平台音乐播放器（桌面 Electron + React，移动端 React Native/Expo），统一由 `@mplayer/core` 提供歌曲识别、播放地址解析与多源搜索能力。多源：netease / qq / kugou / migu / kuwo / qianqian / soda。

> 架构决策 `docs/adr/`（索引见其 `README.md`）· 领域词汇 `CONTEXT.md` · 架构/测试细节 `docs/agents/` · 工程 skills 见下文 Agent skills

## Commands

```bash
npm run dev / electron:dev       # Vite dev (5174) / 完整 Electron dev
npm run build / electron:build   # 生产构建 / 打包当前平台
npm run lint / typecheck / typecheck:mobile  # ESLint(零警告) / 双端 tsc
npm run core:build               # 构建 @mplayer/core（改 core 后移动端必须重建）
npm run test:run                 # vitest 单次（renderer + src/__tests__ 顶层）
npm run test:main                # vitest 单次（主进程，node env，独立 config）
npm run mobile:e2e               # 移动端真机 e2e 一条龙（usbipd 直挂真机验收，见 e2e/README.md）
./scripts/verify.sh              # 验证唯一入口（all=static+四套测试+Expo 依赖一致性；也可只跑某个 scope）
npm run verify -- <scope>        # 同上；实现在 scripts/verify.mjs。**Windows 用这条**（Windows 上 bash 可能是 WSL 的 Linux bash，见 #500）
npm run release                  # 一键发布（= ./scripts/release.mjs；验证 → bump → commit → 推 master → tag → 触发 CI 构建）
```

**验证顺序的唯一出处是 `scripts/verify.mjs`**（`scripts/verify.sh` 只是两行 shim：CI 与文档沿用旧调用串，步骤一律在 .mjs 里），CI 各 job 直接调它的分片（`check` + 四个 `test` + `expo-check`），不在 workflow 里另拼步骤。全量 = `static`（core:build → lint → design-lint → 双端 typecheck → build）+ 四套测试（renderer / main / core / mobile；矩阵见 `docs/agents/testing.md`）+ `expo`（Expo SDK 依赖一致性）。边界与理由见 ADR `docs/adr/2026-09-29-ci-verification-boundary.md`；依赖升级治理见 ADR `docs/adr/2026-09-29-dependency-update-governance.md`。
pre-commit 钩子（`.githooks/pre-commit`，`npm install` 经 `prepare` 自动接线）只做 root+mobile typecheck + staged lint，是本地加速而非闸门——闸门是 CI 的必需状态检查。

## Architecture

- **Desktop** (`src/`): `contextIsolation: true` + `nodeIntegration: false`（`sandbox: false`），渲染层经 preload 桥 `window.electronAPI` 通信、无 Node 能力。主进程（入口/preload/缓存/storage/ipc/services/tray）与渲染进程（懒加载 router、Zustand、Howler、Ant Design 6）详见 `docs/agents/architecture.md`。
- **Mobile** (`packages/mobile/`): expo-router Stack+Tabs，Zustand(AsyncStorage persist)，双主题 token + textVariants。
  **播放引擎**：Android 走自写 Kotlin Expo Module `packages/mobile/modules/native-player/`（media3 ExoPlayer 持队列 + 原生推进 + `MediaLibraryService` 媒体会话/锁屏；JS 只解析并喂预取窗口）；iOS 回落 expo-audio。见 ADR `docs/adr/2026-09-29-native-playback-ownership.md`。
- **Shared** (`packages/core/`): 双端共享 —— `api/` 多源直连客户端、cache 内核、`shared/` 源路由/解析、`tier3/` 订阅执行器、`utils/`。

IPC 通道契约（musicApi 单通道 + 语义通道 + push）见 `docs/agents/architecture.md`；tsconfig/ESLint/测试配置见 `docs/agents/testing.md`。

## Key Conventions

### Desktop
- UI: Ant Design 6 (`zhCN`) + lucide-react；虚拟滚动 `@tanstack/react-virtual`；DnD `@dnd-kit`；文案中文。
- Path alias `@/*` → `./src/*`；主进程 import 共享件用相对路径（tsc 主进程构建不解析别名）。
- 歌曲去重/匹配在 core（songDedupe/songMatcher）。

### Mobile
- 双主题 token（system/light/dark 三态，默认跟随系统）+ `textVariants` 语义变体（`packages/mobile/theme/tokens.ts`）。
- Audio: Android 走自写 Kotlin 模块（`modules/native-player/`，media3），iOS 回落 expo-audio（非 Howler）；手势 PanResponder + Animated；Metro 吃 `packages/core/dist`（core 改动必须 `core:build`）。
- Android 原生构建（CNG 反向）：原生目录 `packages/mobile/android/` 提交进 git，不再每次 prebuild；**PR / push 不编译原生**，只在发版期由 `release.yml` 的 `build-mobile` 跑 `./gradlew assembleRelease bundleRelease`（产物、签名 keystore、Gradle 缓存的接线见 `release.yml`；本机复现与依赖基线见 `docs/agents/testing.md`「原生发版构建（本机）」；边界与残余风险见 ADR `docs/adr/2026-09-29-ci-verification-boundary.md`）。

### 依赖版本基线
- **生态耦合集**（`expo`、`expo-*`、`react-native`、`react-native-*`、`@react-native-community/*`、`@react-native-async-storage/async-storage`）的版本基线 = **Expo SDK 的期望值**，不是「semver 允许的最新」。升级动作是 `npx expo install --fix`，校验是 `npm run verify -- expo`（CI 的 `expo-check` job）。
- **全仓只允许一份 `expo`**：根与 `packages/mobile` 必须声明**同一范围**（当前 `~57.0.26`）。写不同范围会让 npm 在 `packages/mobile/node_modules` 下再装一份，于是「根 `node_modules/expo` 是哪个版本」变成陷阱（实测踩过）。同理 `@types/react` / `@types/react-dom` 的范围不得逃出 SDK 的 `relatedPackages`（`~19.2.4` / `~19.2.3`）。
- **`expo install --check` 只校验「已装版本」，看不见 package.json 的声明地板**：地板落后照样全绿（实测曾出现 `expo-asset: ~57.0.13` 而 SDK 期望 `~57.0.18`），所以声明地板要人工对齐。
- **未解决**：根 `overrides` 把 metro 钉在 0.84.6，而 `@expo/metro@56.0.2` 要求**精确** 0.84.5；改法已明确（override 钉成 0.84.5），落地受阻于 npm 10.9.8 arborist 从零重解析崩溃 —— 细节见 ADR `docs/adr/2026-09-29-dependency-update-governance.md` 的「后果」。
- 机器人的职责边界见 `.github/dependabot.yml` 的 ignore 段；决策与否决理由见 ADR `docs/adr/2026-09-29-dependency-update-governance.md`。

## 多源链路速览

自建 API 已退役：**官方直连优先 → tier3 订阅源兜底**（双端设置页 auto/direct 来源开关）。预解析门面 core `prefetchPlayableSong`，播放入口 `resolvePlayableSongRouted`；失败按 core `explainPlaybackFailure` 归因，处置由 core `shared/skipGuard` 单一决策，双端同一份文案。

链路的现状与口径只在下面几处维护，改动前按需读，不要在本文件里另记一份：

- **模块与常量**：`docs/agents/architecture.md` 的 `api/` / `shared/` / `tier3/` 三节 —— 路由、四层时限与解析链总预算（`playbackBudgets` / `resolutionBudget`）、健康度定序（`sourceSchedule`）、出网闸门（`outboundGate`）、预取缓存（`prefetchCache`）。
- **语义词汇**：`CONTEXT.md` —— 播放时限层次 / tier3 交付 / 跳歌护栏 / 初始化窗口 / 直连 / 按 ID 直取歌词源。
- **tier3 清单**：schema 与 `source`（源归属）合法值见 `docs/agents/tier3-manifest.md`。
- **决策与口径**：时限 ADR `2026-09-27-playback-budget-layers.md` + `2026-09-28-resolution-chain-deadline.md` · 出网 ADR `2026-09-26-outbound-request-governance.md` · 调度 ADR `2026-09-25-tier3-source-scheduling.md` · 失败归因与交付/丢弃 ADR `2026-09-23-tier3-failure-attribution.md` · trace ADR `2026-09-23-playback-trace-sink.md` · 专辑/歌手契约 ADR `2026-09-27-album-and-artist-content-contract.md` · 网易歌单搜索 ADR `2026-09-27-netease-playlist-search.md` · 旧 `api.php?get=*` 死链见 core `utils/legacyUrl`。

## Git Workflow

**只有文档类修改可以直接 push `master`；其余修改（含 bugfix）一律从最新 `master` 建 worktree，完成后 PR，CI 绿后等人工审核，不自行合并。**

- **Issue 先行**：动手前开/认领 GitHub issue；跨端契约/IPC/来源路由先写 ADR。标题前缀：模板预置的 `[Bug]:` / `[Feature]:`，另有 `[Perf]:` / `[Tooling]:` / `[Chore]:`。PR 正文按 `.github/PULL_REQUEST_TEMPLATE.md` 的 4 段写——验证以 CI 为准，正文只留 CI 证明不了的证据。
- **敏感信息不入库**：tier3 订阅地址、API key、本地缓存。
- **截图不入库**：真机验收 / UI 截图传 **PR 正文**（`gh pr edit <PR> --attach '<png>#<图注>'`），`docs/**/assets` 只留 ADR 正文引用的资产。
- 分流边界（什么算文档类）、分支命名、Conventional Commits、验证顺序、PR 模板与清理的完整流程见 `docs/agents/git-workflow.md`。

## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI。见 `docs/agents/issue-tracker.md`。

### Triage labels

默认五标签（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）。见 `docs/agents/triage-labels.md`。

### Domain docs

single-context：根 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。

### 项目 skills

- `release-notes`（`.agents/skills/release-notes`）——publish 后按规格（亮点/分类变更/下载清单）用 `gh release edit` 更新 release 介绍
- `release`（`.agents/skills/release`）——版本发布流程（**发版前先调 `writing-for-agents` skill 同步活文档** → `npm run release` 一键发布 → 监控 CI → 更新介绍 → 验证产物）
- `new-component`（`.agents/skills/new-component`）——按项目模式生成 renderer 组件/页面/hook 模板
- `mobile-device-debugging`（`.agents/skills/mobile-device-debugging`）——真机 / 模拟器验收（雷电 / 原生 adb / usbipd + 一条龙脚本）+ 截图取证与附 PR 正文
