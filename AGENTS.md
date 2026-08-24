# MPlayer

MPlayer 是一个跨平台音乐播放器（桌面 Electron + React，移动端 React Native/Expo），统一由 `@mplayer/core` 提供歌曲识别、播放地址解析与多源搜索能力。多源：netease / qq / kugou / migu / kuwo / qianqian / soda。

> 架构决策 `docs/adr/` · 领域词汇 `CONTEXT.md` · 架构/测试细节 `docs/agents/` · 工程 skills 见下文 Agent skills

## Commands

```bash
npm run dev / electron:dev       # Vite dev (5174) / 完整 Electron dev
npm run build / electron:build   # 生产构建 / 打包当前平台
npm run lint / typecheck / typecheck:mobile  # ESLint(零警告) / 双端 tsc
npm run core:build               # 构建 @mplayer/core（改 core 后移动端必须重建）
npm run test:run                 # vitest 单次（renderer）
./scripts/verify.sh              # 提交/发布前全量验证（lint+design-lint+双端 typecheck+test；fast 跳过 test）
./scripts/release.sh             # 一键发布（bump → 验证 → commit → tag → 触发 CI 构建）
```

**验证顺序**：`lint → design-lint → typecheck → test:run`，提交前全绿（pre-commit 钩子强制 root+mobile typecheck + staged lint，见 `.githooks/pre-commit`）。

## Architecture

- **Desktop** (`src/`): `contextIsolation: false`，renderer 直用 node。主进程（入口/缓存/storage/ipc/services/tray）与渲染进程（懒加载 router、Zustand、Howler、Ant Design 6）详见 `docs/agents/architecture.md`。
- **Mobile** (`packages/mobile/`): expo-router Stack+Tabs，Zustand(AsyncStorage persist)，expo-audio，双主题 token + textVariants。
- **Shared** (`packages/core/`): 双端共享 —— `api/` 多源直连客户端、cache 内核、`shared/` 源路由/解析、`tier3/` 订阅执行器、`utils/`。

IPC 通道契约（musicApi 单通道 + 语义通道 + push）见 `docs/agents/architecture.md`；tsconfig/ESLint/测试配置见 `docs/agents/testing.md`。

## Key Conventions

### Desktop
- UI: Ant Design 6 (`zhCN`) + lucide-react；虚拟滚动 `@tanstack/react-virtual`；DnD `@dnd-kit`；文案中文。
- Path alias `@/*` → `./src/*`；主进程 import 共享件用相对路径（tsc 主进程构建不解析别名）。
- 歌曲去重/匹配在 core（songDedupe/songMatcher）。

### Mobile
- 双主题 token（system/light/dark 三态，默认跟随系统）+ `textVariants` 语义变体（`packages/mobile/theme/tokens.ts`）。
- Audio: expo-audio（非 Howler）；手势 PanResponder + Animated；Metro 吃 `packages/core/dist`（core 改动必须 `core:build`）。
- Android 发布构建（CNG 反向）：原生目录 `packages/mobile/android/` 提交进 git，CI 直接 `./gradlew assembleRelease bundleRelease` 增量构建（不再每次 prebuild）。release 签名 keystore base64 存 GitHub Secrets（`ANDROID_KEYSTORE_*`），build.gradle 从环境变量读取、无 env 回退 debug 签名；版本号由 build.gradle 从 `app.json` 显式读取；产物 APK（arm64-v8a+armeabi-v7a，R8+shrinkResources）+ AAB 一并上传。Gradle 缓存走 `gradle/actions/setup-gradle@v6`（勿混用 actions/cache）。

## 多源链路速览

自建 API 已退役。**官方直连优先 → tier3 订阅源兜底**（移动端设置页 auto/direct 来源开关；两端设置页 tier3 订阅清单 + 每源统计；实现在 core `sourceRouter`/`tier3Api`）。
探测语义 = 直连可播性（probeSongsBatch 直连解析并写预取缓存）；播放走 `resolvePlayableSongRouted`（预取命中 0 等待 → 直连 → tier3 → 失败）。旧 `api.php?get=*` 签名地址是死链，见 core `utils/legacyUrl`。请求硬化（UA 池/反同源连续/TLS 指纹伪装开关，weapi 试点）见 core `api/tlsFingerprint` 与 `api/transport`。

## Git Workflow

**只有文档类修改可以直接 push `master`；其余修改（含 bugfix）一律从最新 `master` 建 worktree，完成后 PR，CI 绿后等人工审核，不自行合并。**

- **Issue 先行**：动手前开/认领 GitHub issue；跨端契约/IPC/来源路由先写 ADR。issue/PR 模板见 `.github/`（issue 标题 `[Bug]:` / `[Feature]:` 前缀；PR 正文用模板，验证清单含双端核对）。
- **敏感信息不入库**：tier3 订阅地址、API key、本地缓存。
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
- `release`（`.agents/skills/release`）——版本发布流程（`./scripts/release.sh` 一键发布 → 监控 CI → 更新介绍 → 验证产物）
- `new-component`（`.agents/skills/new-component`）——按项目模式生成 renderer 组件/页面/hook 模板
- `mobile-device-debugging`（`.agents/skills/mobile-device-debugging`）——真机调试（usbipd 直挂 WSL / 原生 adb / 一条龙脚本 `scripts/mobile-debug.sh`）
