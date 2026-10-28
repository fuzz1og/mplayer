# MPlayer

MPlayer 是一个跨平台音乐播放器（桌面 Electron + React，移动端 React Native/Expo），统一由 `@mplayer/core` 提供歌曲识别、播放地址解析与多源搜索能力。多源：netease / qq / kugou / migu / kuwo / qianqian / soda。

> 动手前先查 `docs/specs/`（规格）与 `docs/research/`（调研）——常已有答案，别再派人重搜；其余入口：决策 `docs/adr/`（索引见其 `README.md`）· 会话资产 `docs/wayfinder/` · 活文档 `docs/agents/` · 词汇 `GLOSSARY.md` · 评审标准 `CODING_STANDARDS.md` · 工程 skills 见下文 Agent skills

## Commands

命令以 `package.json` 的 scripts 为准（`npm run`）。只有环境自己说不出来的四条：

- 验证唯一入口 `npm run verify -- <scope>`（`all` = static + 四套测试 + Expo 依赖一致性），实现在 `scripts/verify.mjs`；`scripts/verify.sh` 是等价写法的 shim。**Windows 上别用 bash 调它**——那个 bash 可能是 WSL 的（#500）。分片与 CI job 的对应见 `docs/agents/testing.md`，边界理由见 ADR `docs/adr/2026-09-29-ci-verification-boundary.md`。
- pre-commit 钩子（`.githooks/pre-commit`）是本地加速，不是闸门——闸门是 CI 的必需状态检查。
- 图标：只改 `resources/icon.svg`，跑 `python resources/generate_icon.py` 重建全部位图产物，产物不手改。
- 发版：见 `release` skill。依赖升级治理见 ADR `docs/adr/2026-09-29-dependency-update-governance.md`。

## Architecture

- **Desktop** (`src/`): `contextIsolation: true` + `nodeIntegration: false`（`sandbox: false`），渲染层经 preload 桥 `window.electronAPI` 通信、无 Node 能力。主进程（入口/preload/缓存/storage/ipc/services/tray）与渲染进程（懒加载 router、Zustand、Howler、`src/renderer/ui/` 自建原语）详见 `docs/agents/architecture.md`。
- **Mobile** (`packages/mobile/`): expo-router Stack+Tabs，Zustand(AsyncStorage persist)，双主题 token + textVariants。
  **播放引擎**：Android 走自写 Kotlin Expo Module `packages/mobile/modules/native-player/`（media3 ExoPlayer 持队列 + 原生推进 + `MediaLibraryService` 媒体会话/锁屏；JS 只解析并喂预取窗口）；iOS 回落 expo-audio。见 ADR `docs/adr/2026-09-29-native-playback-ownership.md`。
- **Shared** (`packages/core/`): 双端共享 —— `api/` 多源直连客户端、cache 内核、`shared/` 源路由/解析、`tier3/` 订阅执行器、`utils/`。

IPC 通道契约（musicApi 单通道 + 语义通道 + push）见 `docs/agents/architecture.md`；tsconfig/ESLint/测试配置见 `docs/agents/testing.md`。

## Key Conventions

### Desktop
- UI: 自建原语 `src/renderer/ui/`（1.9.0 起无 antd）+ lucide-react；虚拟滚动 `@tanstack/react-virtual`；DnD `@dnd-kit`；文案中文。
- Path alias `@/*` → `./src/*`；主进程 import 共享件用相对路径（tsc 主进程构建不解析别名）。
- 歌曲去重/匹配在 core（songDedupe/songMatcher）。

### Mobile
- 双主题 token（system/light/dark 三态，默认跟随系统）+ `textVariants` 语义变体（`packages/mobile/theme/tokens.ts`）。
- Audio: Android 走自写 Kotlin 模块（`modules/native-player/`，media3），iOS 回落 expo-audio（非 Howler）；手势 PanResponder + Animated；Metro 吃 `packages/core/dist`（core 改动必须 `core:build`；**新增/改名导出**时还要 `npx expo start --clear` 重起 Metro，否则按需加载的旧 chunk 会让真机红屏 `undefined is not a function`——见 `runtime-verification` skill 的陷阱速查 #576）。
- Android 原生构建（CNG 反向）：原生目录 `packages/mobile/android/` 提交进 git，不再每次 prebuild；**PR / push 不编译原生**，只在发版期由 `release.yml` 的 `build-mobile` 跑 `./gradlew assembleRelease bundleRelease`（产物、签名 keystore、Gradle 缓存的接线见 `release.yml`；本机复现与依赖基线见 `docs/agents/testing.md`「原生发版构建（本机）」；边界与残余风险见 ADR `docs/adr/2026-09-29-ci-verification-boundary.md`）。

### 依赖版本基线
- **生态耦合集的基线 = Expo SDK 的期望值**，不是 semver 最新：升级动作 `npx expo install --fix`，校验 `npm run verify -- expo`。**别拿「`expo install --check` 全绿」当对齐依据**——它只看已装版本，看不见 `package.json` 的地板；全仓只允许一份 `expo`（根与 `packages/mobile` 同一范围）。
- **版本字面量不抄在本文件**（无时间戳的「当前值」必然腐烂成误导）：范围的真相在 `package.json` 与 `npx expo install --check` 的当前输出。
- 各条实测、未解决项（metro `overrides` 与 `@expo/metro` 的精确要求冲突）、机器人职责边界与决策理由：ADR `docs/adr/2026-09-29-dependency-update-governance.md`。

## 多源链路速览

自建 API 已退役：**官方直连优先 → tier3 订阅源兜底**（双端设置页 auto/direct 来源开关）。预解析门面 core `prefetchPlayableSong`，播放入口 `resolvePlayableSongRouted`；失败按 core `explainPlaybackFailure` 归因，处置由 core `shared/skipGuard` 单一决策，双端同一份文案。

链路的现状与口径只在下面几处维护，改动前按需读，不要在本文件里另记一份：

- **模块与常量**：`docs/agents/architecture.md` 的 `api/` / `shared/` / `tier3/` 三节 —— 路由、四层时限与解析链总预算（`playbackBudgets` / `resolutionBudget`）、健康度定序（`sourceSchedule`）、出网闸门（`outboundGate`）、预取缓存（`prefetchCache`）。
- **语义词汇**：`GLOSSARY.md` —— 播放时限层次 / tier3 交付 / 跳歌护栏 / 初始化窗口 / 直连 / 按 ID 直取歌词源 / 直链编码归一。
- **tier3 清单**：schema 与 `source`（源归属）合法值见 `docs/agents/tier3-manifest.md`。
- **决策与口径**：时限 ADR `2026-09-27-playback-budget-layers.md` + `2026-09-28-resolution-chain-deadline.md` · 出网 ADR `2026-09-26-outbound-request-governance.md` · 调度 ADR `2026-09-25-tier3-source-scheduling.md` · 失败归因与交付/丢弃 ADR `2026-09-23-tier3-failure-attribution.md` · trace ADR `2026-09-23-playback-trace-sink.md` · 专辑/歌手契约 ADR `2026-09-27-album-and-artist-content-contract.md` · 网易歌单搜索 ADR `2026-09-27-netease-playlist-search.md` · 每源请求头 ADR `2026-10-08-per-source-request-headers.md` · 直链编码归一（取 URL 的单一落点）ADR `2026-10-09-playable-url-encoding-single-gate.md` · 旧 `api.php?get=*` 死链见 core `utils/legacyUrl`。

## Git Workflow

**只有文档类修改可以直接 push `master`；其余修改（含 bugfix）一律从最新 `master` 建 worktree，完成后 PR，CI 绿后等人工审核，不自行合并。**

- **Issue 先行**：动手前开/认领 GitHub issue；跨端契约/IPC/来源路由先写 ADR。标题前缀：模板预置的 `[Bug]:` / `[Feature]:`，另有 `[Perf]:` / `[Tooling]:` / `[Chore]:`。
- **敏感信息不入库**：tier3 订阅地址、API key、本地缓存。机械门禁见 `scripts/docs-gate.mjs` 的敏感扫描（**含** `docs/{adr,research,specs,wayfinder}` 存档与文档目录下的未跟踪文件），命中即 CI 红。
- **验收截图不入库，活文档配图入库**：真机验收 / UI 走查的**证据图**传 **PR 正文或验收评论**（`gh pr edit <PR> --attach '<png>#<图注>'`）——PR 是它的一次性载体，入库只会攒下一堆没人再看第二眼的二进制。反过来，**活文档正文长期引用的产品图**（README 截图、logo）**必须入库**，放 `docs/assets/`。判据是「有没有一个长期存在的正文在引用它」，不是「它是不是截图」。
- 分流边界（什么算文档类）、分支命名、Conventional Commits、验证顺序、PR 模板与清理的完整流程见 `docs/agents/git-workflow.md`。

## Agent skills

工程 skills 在 `.agents/skills/`：`release`（发版，含 release 介绍规格）、`runtime-verification`（真机验真）。其余约定各一份权威文档，本文件不复述：issue / PR 操作见 `docs/agents/issue-tracker.md`，五标签分诊见 `docs/agents/triage-labels.md`，领域文档（single-context：根 `GLOSSARY.md` + `docs/adr/`）见 `docs/agents/domain.md`。
