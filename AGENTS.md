# MPlayer

MPlayer 是一个跨平台音乐播放器（桌面 Electron + React，移动端 React Native/Expo），统一由 `@mplayer/core` 提供歌曲识别、播放地址解析与多源搜索能力。多源：netease / qq / kugou / migu / kuwo / qianqian / soda。

> 架构决策见 `docs/adr/`，领域词汇见 `CONTEXT.md`，agent 工作约定见 `docs/agents/`。

## Commands

### Desktop (Electron)

```bash
npm run dev              # Vite dev server (--port 5174)
npm run electron:dev     # Full Electron app in dev mode
npm run build            # prebuild (kill + clean) → tsc → vite build（破坏性：删 dist）
npm run electron:build   # Build + package (current platform)
npm run lint             # eslint --max-warnings 0
npm run typecheck        # tsc --noEmit
npm run core:build       # Build @mplayer/core shared package
npm run test             # vitest (watch)
npm run test:run         # vitest (single run)
```

### Mobile (Expo/React Native)

```bash
cd packages/mobile
npm run start       # Expo dev server；真机调试流程见 .agents/skills/mobile-device-debugging
```

**验证顺序**：`lint → typecheck → test:run`，提交前全部通过（pre-commit 钩子强制 root typecheck + mobile typecheck + staged lint）。

## Architecture

### Desktop (Electron)

`contextIsolation: false`, `nodeIntegration: true`. Renderer 直接 import 主进程模块。

#### Main Process (`src/main/`)

| File | Role |
|------|------|
| `main.ts` | Entry. BrowserWindow (1400×900, hiddenInset), IPC 注册, global shortcuts, tray |
| `hidpi.ts` | WSLg HiDPI 修复：读 Windows AppliedDPI → 强制 `force-device-scale-factor`；非 WSL 跳过；`MPLAYER_UI_SCALE` 可覆盖 |
| `proxy.ts` | Electron session proxy config |
| `api/musicApi.ts` | 壳：re-export core `musicApi` / client 配置（HTTP 客户端逻辑在 core） |
| `api/kugouApi.ts` | 酷狗排行榜直连（`getKugouRank` / `getKugouNewSongs`） |
| `cache/diskBackend.ts` | 磁盘缓存后端（音频、封面、歌词；constructor 注入 cacheDir） |
| `storage/db.ts` | Primary persistence (favorites, history, playlists, settings)；启动时跑旧签名端点迁移 |
| `ipc/registerHandler.ts` | `registerIpcHandler` helpers |
| `services/` | downloadService / localMusicService / updateService / chartAggregator |
| `tray/trayManager.ts` | System tray + context menu |

#### Renderer Process (`src/renderer/`)

- `router/index.tsx` HashRouter 全懒加载；页面在 `pages/`（推荐/发现/热榜/收藏/历史/歌单/队列/本地/歌手/专辑/设置等）
- `store/` Zustand：playerStore, searchStore, favoriteStore, downloadStore, localStore
- `services/` audioPlayer(Howler), searchService, sourceSwap, coverCacheService, IpcClient, callMusicApi 等
- `components/` PlayerBar/SongList/SongRow/LyricsDisplay 等通用件

### IPC Channels

约定 `domain:action`。渲染端 request/response 用 `invoke`，推送用 `on`。

**MusicApi** — 单通道分发（ADR-0001）：`musicApi:call(method, ...args)`。方法清单唯一手写物是
`src/shared/musicApiContract.ts` 的 `MUSIC_API_METHODS`；渲染端泛型入口 `callMusicApi(method, ...args)`，
主进程分发表 `satisfies MusicApiMethodMap`，未知方法返回失败封套。加方法 = core 加方法 + 清单加字符串，
其余自动（完整性测试 `src/__tests__/musicApiIntegrity.test.ts` 兜底）。**不要在本文件枚举方法清单**——那是契约文件的缓存。

**语义通道**（ADR-0002）：`cache:*`（getSongResources/setSongResources/getCoverPath/setCoverBytes/invalidateCover/clear/getStats）、
favorite/history/playlist/localMusic/settings/download/dialog/app/update 各自的 `domain:action` 组。
Push（main→renderer）：`download:progress|complete|error`, `localMusic:folderChanged`, `tray:action`, `shortcut:action`, `update:status`。

### Mobile (Expo/React Native)

expo-router Stack + Tabs：`(tabs)/`（推荐/发现/搜索/歌单/下载）+ player/favorites/history/settings/hotlist/playlist/[id]/discover-playlist/[id]/artist/[id]/album/[id]。

- `components/` TopBar, PlayerBar, PlayerOverlay, SongRow, DiscoverTabs, SourceSwapModal, AddToPlaylistModal 等
- `stores/` Zustand（部分 AsyncStorage persist）：player/settings/favorite/history/playlist/search/discover/source/download/audioTag/logs
- `services/` audioPlayer(expo-audio), notificationService, downloadService(SAF), songProbe/songResources/sourceSwap, legacyMigration, cacheService

## Shared Package (`packages/core/`)

桌面/移动端共享。请求层 `api/`（musicApi 多源客户端、neteaseWeapi、antiScrape、probeSongs、transport 可注入接缝）、
cache 内核、`shared/`（resolvePlayableUrl/resolveFreshUrl/searchOrchestrator/sourceSwap/sourceRouter 来源开关+tier3 订阅兜底）、
`utils/`（songMatcher/songDedupe/lyricsParser/legacyUrl 等）、`tier3/tier3Api` 订阅源执行器。

```bash
npm run core:build   # 移动端 Metro 吃 dist 产物：改 core 后必须重建移动端才生效
```

## Key Conventions

### Desktop
- UI: Ant Design 6 (`zhCN`) + lucide-react。全部界面文案中文。
- Virtual scrolling: `@tanstack/react-virtual`（阈值 30）；DnD: `@dnd-kit`。
- Song dedupe/matching 在 core（songDedupe/songMatcher）。
- Path alias `@/*` → `./src/*`。
- **No context isolation**: renderer 经 `require('electron')` 直用 node；主进程 import 共享件用相对路径（别名在 tsc 主进程构建不解析）。

### Mobile
- UI: 双主题 token 体系（浅色/深色，`themeMode`: system/light/dark 三态，settingsStore 持久化，默认跟随系统），
  token 见 `packages/mobile/theme/tokens.ts`（Primitive → Semantic 双层，`lightColors`/`darkColors`）；文字走
  `textVariants` 语义变体（tokens.ts 定义，清零字号魔法数）；lucide-react-native。文案中文。
- Audio: expo-audio（非 Howler）；手势 PanResponder + Animated。
- Metro 入口是 `packages/core/dist`——core 改动必须 `core:build`。

## tsconfig Strictness

Root 开 `noUnusedLocals/noUnusedParameters`；root tsconfig `"exclude": ["packages"]`（root typecheck 不含 mobile）。

```bash
npx tsc --noEmit                                        # root
npx tsc --noEmit --project packages/mobile/tsconfig.json # mobile
```

## ESLint

flat config（`eslint.config.js`），全局 ignores 与 `--no-warn-ignored` 语义见该文件；`--max-warnings 0`。

## Testing

- **Renderer**: Vitest + jsdom + @testing-library。setup mock electron/matchMedia；factories 提供 createSong()。`npx vitest run`
- **Main**: `vitest.main.config.ts`（node env），global electron mock。`npx vitest run --config vitest.main.config.ts`
- **Core**: `npm run core:build` 后 `npx vitest run --config packages/core/vitest.config.ts`
- **Mobile**: `packages/mobile/vitest.config.ts`（node env），setup mock AsyncStorage/Alert/musicApi；store 测试用纯 getState/setState。`npx vitest run --config packages/mobile/vitest.config.ts`
- 构造器注入可测性：diskBackend(cacheDir)、localMusicService(userDataPath)
- E2E: Playwright 在 `e2e/`，测试服务器 `npx vite --config vite.test.config.ts --port 5174`；移动端 E2E 未搭建（手动 Expo 验收）

## Git Workflow

**功能开发一律从最新 `master` 新建本地 worktree 完成，完成后推分支经 PR 进入 `master`；直接 push `master` 是例外，需明确理由。**

- **Issue 先行**：动手前开/认领 GitHub issue（见 `docs/agents/issue-tracker.md`），commit 与 PR 用 `Closes #N` 关联；跨端契约/IPC 协议/来源路由这类架构取舍先写 ADR 再动工。
- 分支命名 `<type>/<slug>`（feat/fix/docs/chore/refactor）；commit 用 Conventional Commits（`type(scope): 中文描述`，scope 取 core/desktop/mobile/ci）。
- 合并门槛：worktree 内验证顺序全绿 + CI 绿；PR 描述写清做了什么/为什么/怎么验证的；改 core/mobile 的 PR 附真机验收结论。
- 敏感信息不入库：tier3 订阅地址、API key、本地缓存数据不进 commit。
- 文档同责：行为/命令/架构变化在同一 PR 更新 AGENTS.md / CONTEXT.md / ADR。
- worktree 内调试/测试就在 worktree 内构建运行，不要 cd 回主克隆目录；缺 node_modules 就地 `npm install`，不从主克隆复制。

完整流程（issue → 建 worktree → 验证 → `gh pr create` → 清理）见 `docs/agents/git-workflow.md`。

## 多源链路速览

自建 API 已退役。现状：**官方直连优先 → tier3 订阅源兜底**（来源开关 auto/direct 在移动端设置页，
桌面端为只读直连状态面板；tier3 订阅清单 + 每源命中/失败统计在两端设置页，实现在 core `sourceRouter`/`tier3Api`）。
探测语义 = 直连可播性（probeSongsBatch 直连解析并写预取缓存）；
播放走 `resolvePlayableSongRouted`（预取命中 0 等待 → 直连 → tier3 → 失败）。旧 `api.php?get=*` 签名地址
是死链，识别与清理见 core `utils/legacyUrl` 与各端迁移逻辑。请求硬化（UA 池/反同源连续/TLS 指纹伪装险情开关，
桌面设置页 `tls-fingerprint`，weapi 试点）见 core `api/tlsFingerprint` 与 `api/transport`。

## Agent skills

- Issue tracker: GitHub Issues via `gh` CLI，见 `docs/agents/issue-tracker.md`
- Triage labels: `docs/agents/triage-labels.md`
- Domain docs: `CONTEXT.md` + `docs/adr/`，见 `docs/agents/domain.md`
- Release notes: `.agents/skills/release-notes`——publish job 创建 release 后，按规格（亮点/分类变更/下载清单）用 `gh release edit` 覆盖自动生成的平铺介绍
