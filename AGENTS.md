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
- Android 发布构建（CNG 反向）：原生目录 `packages/mobile/android/` 提交进 git，不再每次 prebuild。**发版**由 `release.yml` 的 `build-mobile` 跑 `./gradlew assembleRelease bundleRelease --no-daemon`，产物 APK（arm64-v8a+armeabi-v7a，R8+shrinkResources）+ AAB 一并上传；release 签名 keystore base64 存 GitHub Secrets（`ANDROID_KEYSTORE_*`），build.gradle 从环境变量读取、无 env 回退 debug 签名；版本号由 build.gradle 从 `app.json` 显式读取。**只在发版期构建**：PR 与 push 只做静态检查与四套测试，不编译原生（代价与残余风险见 ADR `docs/adr/2026-09-29-ci-verification-boundary.md`）。Gradle 缓存走 `gradle/actions/setup-gradle@v6`（勿混用 actions/cache）。

### 依赖版本基线
- **生态耦合集**（`expo`、`expo-*`、`react-native`、`react-native-*`、`@react-native-community/*`、`@react-native-async-storage/async-storage`）的版本基线 = **Expo SDK 的期望值**，不是「semver 允许的最新」。升级动作是 `npx expo install --fix`，校验是 `npm run verify -- expo`（CI 的 `expo-check` job）。
- **全仓只允许一份 `expo`**：根与 `packages/mobile` 必须声明**同一范围**（当前 `~57.0.26`）。写不同范围会让 npm 在 `packages/mobile/node_modules` 下再装一份，于是「根 `node_modules/expo` 是哪个版本」变成陷阱（实测踩过）。同理 `@types/react` / `@types/react-dom` 的范围不得逃出 SDK 的 `relatedPackages`（`~19.2.4` / `~19.2.3`）。
- **`expo install --check` 只校验「已装版本」，看不见 package.json 的声明地板**：地板落后照样全绿（实测曾出现 `expo-asset: ~57.0.13` 而 SDK 期望 `~57.0.18`），所以声明地板要人工对齐。
- **未解决**：根 `overrides` 的 `metro: ^0.84.5` 会解析成 0.84.6，而 `@expo/metro` 与 RN 的 `@react-native/community-cli-plugin` 都要求**精确** 0.84.5（`npm ls` 报 `invalid`）。改法已明确，但本轮落地受阻（npm 10.9.8 arborist 崩在从零重解析）——详见 ADR 的「后果」。
- 机器人的职责边界见 `.github/dependabot.yml` 的 ignore 段；决策与否决理由见 ADR `docs/adr/2026-09-29-dependency-update-governance.md`。

## 多源链路速览

自建 API 已退役。**官方直连优先 → tier3 订阅源兜底**（移动端设置页 auto/direct 来源开关；两端设置页 tier3 订阅清单 + 每源统计；实现在 core `sourceRouter`/`tier3Api`）。
预解析 = 「队列下一首预取 / 冷启预热」经 core 门面 `prefetchPlayableSong`（含 tier3、写入播放解析读的那一份缓存）；播放走 `resolvePlayableSongRouted`（预取命中 0 等待 → 直连 → tier3 → 失败）；直连解析腿有独立 3s 墙钟，无权威时长的源在播放时对直连 URL 做一次时长取证以标记试听片段（#389 / #392）；一次解析链另有**解析链总预算 9s**（= 直连 3s 墙 + 一条 tier3 腿预算；与既有文档里 tier3 腿的「整链 6s 预算」不是同一层。各腿取 `min(本腿墙, 剩余)`，试听换完整版的第二条 tier3 腿只吃剩余额度；链总预算是墙钟（K=3 排队照走，否则槽位占满会无界等待），而 tier3 腿预算仍从槽位到手起计；耗尽即 abort 底层并停止遍历；#424 / ADR `2026-09-28-resolution-chain-deadline.md`），「最坏无声窗口」= `skipGuard.WORST_CASE_SILENT_MS`。旧 `api.php?get=*` 签名地址是死链，见 core `utils/legacyUrl`。请求硬化（UA 池/反同源连续/TLS 指纹伪装开关，weapi 试点）见 core `api/tlsFingerprint`、`api/transport` 与其内部接缝 `api/outboundGate`（出网闸门：全局 6 + 每 host 2）。tier3 解析腿按**会话内健康度定序**（`shared/sourceSchedule`：只改遍历顺序、绝不缩减候选集，连续失败 2 次沉底、成功一次即回归，无样本回退清单顺序），**第一首进 tier3 的歌即初始化**（单飞交错起手 600ms、在飞 ≤2、命中即交付、无窗口级墙值），窗口在飞计入 K=3。tier3 订阅清单 schema 与 `source` 字段（源归属）合法值见 `docs/agents/tier3-manifest.md`。
专辑/歌手内容面：`Album` 带**必填** `sourceType`（专辑是源内实体，缓存键含源、跨源不互送 id），`publishTime` 统一 epoch ms；失败语义分「该源未实现该内容能力」与「源支持但这次没取到」两种（页面三态据此给文案），歌手页按 id 校正而非按名字搜——见 ADR `docs/adr/2026-09-27-album-and-artist-content-contract.md`。播放失败按 core `explainPlaybackFailure` 分级归因（无声明源 / 全被归属跳过 / 适用源都没命中 / tier3 未开启 / 仅直连），双端共用同一份文案；失败后的**处置**由 core `shared/skipGuard` 单一决策（#385）：同曲 fresh 重试一次 → 终局失败则固定上限 **3 首**、**离线直接暂停不进解析链**、会话内**坏歌记忆**（跳歌跳过）、**「失败即跳」偏好**（默认开，双端设置页可关），文案双端同一来源；每源统计「交付」= 路由层真正采纳数，「丢弃」= 预算超时丢弃的迟到命中（ADR `docs/adr/2026-09-23-tier3-failure-attribution.md`）。播放解析链结构化 trace 由 core `shared/playbackTrace` 产出（`setPlaybackTraceSink`），宿主注册内存环形缓冲、双端设置页「播放诊断」区展示并手动导出（ADR `docs/adr/2026-09-23-playback-trace-sink.md`）。内容能力面新增网易**歌单搜索**（`searchPlaylists`，走 `api/cloudsearch/pc` `type=1000`，与搜索同腿、不新增加密/头；双端搜索页「歌单」tab **懒加载** + **滚动到底才发下一页** + core 单飞 + 6h 缓存），`searchArtists` 一并迁到同腿 `type=100` 且失败不再静默空数组（ADR `docs/adr/2026-09-27-netease-playlist-search.md`）。

## Git Workflow

**只有文档类修改可以直接 push `master`；其余修改（含 bugfix）一律从最新 `master` 建 worktree，完成后 PR，CI 绿后等人工审核，不自行合并。**

- **Issue 先行**：动手前开/认领 GitHub issue；跨端契约/IPC/来源路由先写 ADR。issue/PR 模板见 `.github/`（issue 标题 `[Bug]:` / `[Feature]:` 前缀；PR 正文用模板，验证清单含双端核对）。
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
- `release`（`.agents/skills/release`）——版本发布流程（文档同步 → `./scripts/release.mjs` 一键发布 → 监控 CI → 更新介绍 → 验证产物）
- `new-component`（`.agents/skills/new-component`）——按项目模式生成 renderer 组件/页面/hook 模板
- `mobile-device-debugging`（`.agents/skills/mobile-device-debugging`）——真机 / 模拟器验收（雷电 / 原生 adb / usbipd + 一条龙脚本）+ 截图取证与附 PR 正文
