# MPlayer

跨平台音乐播放器：桌面 Electron + React，移动端 Expo/React Native；`@mplayer/core` 统一歌曲识别、播放地址解析与多源搜索（netease / qq / kugou / migu / kuwo / qianqian / soda）。

> 先查 `docs/specs/`（规格）与 `docs/research/`（调研）——常已有答案；入口：决策 `docs/adr/README.md` · 活文档 `docs/agents/` · 词汇 `GLOSSARY.md` · 评审 `CODING_STANDARDS.md`。

## Commands

命令以 `package.json` 的 scripts 为准；只有四条环境说不出来：

- 验证唯一入口 `npm run verify -- <scope>`（`all` = static + 四套测试 + Expo 依赖），实现在 `scripts/verify.mjs`；`scripts/verify.sh` 是等价写法的 shim，**Windows 别用 bash 调**（可能是 WSL，#500）。分片与 CI 对应见 `docs/agents/testing.md`。
- pre-commit 钩子是本地加速，闸门是 CI；新 worktree 先 `npm ci --ignore-scripts`，缺依赖时修依赖，别默认 `--no-verify`。
- 图标只改 `resources/icon.svg`，跑 `python resources/generate_icon.py` 重建，产物不手改。
- 发版见 `release` skill；依赖升级见 ADR `2026-09-29-dependency-update-governance.md`。

## Architecture

桌面 `src/`：`contextIsolation: true` + `nodeIntegration: false`（`sandbox: false`），渲染层只经 preload 的 `window.electronAPI`。移动端 `packages/mobile/`：expo-router Stack+Tabs、Zustand、双主题 token；Android 播放引擎是自写 Kotlin 模块 `modules/native-player/`（media3 持队列 + 原生推进 + 媒体会话），iOS 回落 expo-audio。共享 `packages/core/`：多源直连、缓存内核、源路由/解析、tier3 执行器，以及歌曲去重/匹配（`songDedupe` / `songMatcher`）。

细节、IPC 契约（musicApi 单通道 + 语义通道 + push）见 `docs/agents/architecture.md`；tsconfig/ESLint/测试配置见 `docs/agents/testing.md`。

## Key Conventions

- **Desktop**：UI 用 `src/renderer/ui/` 自建原语 + lucide-react（1.9.0 起无 antd）；虚拟滚动 `@tanstack/react-virtual`，DnD `@dnd-kit`，文案中文。`@/*` → `./src/*`；主进程 import 共享件用相对路径（tsc 主进程构建不解析别名）。
- **Mobile**：双主题 token（system/light/dark）+ `textVariants`（`packages/mobile/theme/tokens.ts`）。Metro 吃 `packages/core/dist`：改 core 必须 `core:build`；**新增/改名导出**还要 `npx expo start --clear`，否则真机红屏 `undefined is not a function`（`runtime-verification` #576）。
- **Android 原生构建（CNG 反向）**：`packages/mobile/android/` 已提交；PR/push 不编译原生，发版期由 `.github/workflows/release.yml` 的 `build-mobile` 跑 `assembleRelease bundleRelease`。应用内更新与 `.apk.md5` 校验见 `docs/agents/architecture.md`「Mobile」与 #725。
- **依赖基线**：生态耦合集以 Expo SDK 期望值为准，不是 semver 最新；升级 `npx expo install --fix`，校验 `npm run verify -- expo`。别把 `expo install --check` 全绿当对齐依据（它看不见 `package.json` 地板）；全仓只留一份 `expo`（根与 mobile 同范围）。版本字面量不写进本文件；边界见 ADR `2026-09-29-dependency-update-governance.md`。

## 多源链路

自建 API 已退役：**官方直连优先 → tier3 订阅源兜底**（双端设置页 auto/direct 开关）。预解析门面 core `prefetchPlayableSong`，播放入口 `resolvePlayableSongRouted`；失败按 core `explainPlaybackFailure` 归因，处置由 `shared/skipGuard` 单一决策，双端同一份文案。

- **模块与常量**：`docs/agents/architecture.md` 的 `api/` / `shared/` / `tier3/` 三节——路由、四层时限与整链预算（`playbackBudgets` / `resolutionBudget`）、健康度定序（`sourceSchedule`）、出网闸门（`outboundGate`）、预取缓存（`prefetchCache`）。
- **词汇与清单**：`GLOSSARY.md`；tier3 schema 与 `source` 合法值见 `docs/agents/tier3-manifest.md`。
- **决策**：路由/时限/调度/归因/trace/专辑歌手/歌单搜索/请求头/编码归一的 ADR 见 `docs/adr/README.md`（集中在 2026-09-23～2026-10-09）；旧 `api.php?get=*` 死链见 core `utils/legacyUrl`。

## Git Workflow

**只有文档类修改可直接 push `master`；其余（含 bugfix）一律从最新 `master` 建 worktree → PR → CI 绿后等人工审核，不自行合并。**

- **Issue 先行**：动手前开/认领 issue；跨端契约/IPC/来源路由先写 ADR。标题前缀 `[Bug]:` / `[Feature]:` / `[Perf]:` / `[Tooling]:` / `[Chore]:`。
- **worktree**：优先 Codex 原生；手工用 `.agents/worktrees/<slug>`（别放 `.claude/worktrees/`），进入后先 `npm ci --ignore-scripts`。完整流程见 `docs/agents/git-workflow.md`。
- **敏感信息不入库**：tier3 订阅地址、API key、本地缓存；`scripts/docs-gate.mjs` 会扫 `docs/{adr,research,specs,wayfinder}` 与文档目录下的未跟踪文件。
- **截图**：验收/UI 证据图传 PR 正文或评论，不入库；活文档长期引用的产品图放 `docs/assets/`。判据是「有没有长期正文引用」，不是「是不是截图」。

## Agent skills

issue / PR 操作见 `docs/agents/issue-tracker.md`，五标签分诊见 `docs/agents/triage-labels.md`，领域文档（single-context：根 `GLOSSARY.md` + `docs/adr/`）见 `docs/agents/domain.md`。
