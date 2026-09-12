# MPlayer 架构细节

低频参考：主进程/渲染进程结构、IPC 通道契约。每轮决策需要先读此处（配合 `CONTEXT.md` 与 `docs/adr/`）。

## Desktop (Electron)

`contextIsolation: false`, `nodeIntegration: true`. Renderer 直接 import 主进程模块。

### Main Process (`src/main/`)

| File | Role |
|------|------|
| `main.ts` | Entry. BrowserWindow (1400×900, hiddenInset), IPC 注册, global shortcuts, tray |
| `hidpi.ts` | WSLg HiDPI 修复：读 Windows AppliedDPI → 强制 `force-device-scale-factor`；非 WSL 跳过；`MPLAYER_UI_SCALE` 可覆盖 |
| `proxy.ts` | Electron session proxy config |
| `api/musicApi.ts` | 壳：re-export core `musicApi` / client 配置（HTTP 客户端逻辑在 core） |
| `cache/diskBackend.ts` | 磁盘缓存后端（音频、封面、歌词；constructor 注入 cacheDir） |
| `storage/db.ts` | Primary persistence (favorites, history, playlists, settings)；启动时跑旧签名端点迁移 |
| `ipc/registerHandler.ts` | `registerIpcHandler` helpers |
| `services/` | downloadService(进度按 150ms 聚合后推 IPC) / localMusicService / updateService / chartAggregator |
| `tray/trayManager.ts` | System tray + context menu |

### Renderer Process (`src/renderer/`)

- `router/index.tsx` HashRouter 全懒加载；页面在 `pages/`（推荐/发现/热榜/收藏/历史/歌单/队列/本地/歌手/专辑/设置等）
- `store/` Zustand：playerStore, searchStore, favoriteStore, downloadStore, localStore
- playerStore 播放失败处理：同曲 fresh 重试一次（`forgetPrefetchedUrl` + 重走路由链）→ 仍失败按播放模式自动跳下一首；连续失败达队列长度或没有别的歌则停止提示（对齐移动端）。下一首 URL 预取统一写 core 预取缓存（30min TTL、失败可遗忘），渲染层不再自建 URL Map；播放成功后的簿记异常（历史/队列/封面）不参与失败判定，避免误跳歌
- `services/` audioPlayer(Howler), playbackClock(播放位置/时长读模型：点击/键盘 seek 语义 + 叶子窄订阅，位置/时长不进 store), searchService, sourceSwap, IpcClient, callMusicApi 等
- `components/` PlayerBar/SongList/SongRow/LyricsDisplay 等通用件

## IPC Channels

约定 `domain:action`。渲染端 request/response 用 `invoke`，推送用 `on`。

**MusicApi** — 单通道分发（ADR-0001，#278 派生化更新）：`musicApi:call(method, ...args)`。契约 = `BASE_METHODS ∪ CONTENT_METHODS ∪ MainOnlyMethods`
（`src/shared/musicApiContract.ts`；内容方法自 `DirectSourceClient` 接口派生、带 `source` 首参）；渲染端泛型入口 `callMusicApi(method, ...args)`，
主进程基础/独有方法手写表 + 内容方法按 `CONTENT_METHODS` 清单循环分派到 `getDirectClient(source)`，未知方法返回失败封套。
加内容方法 = 直连客户端加方法 + `CONTENT_METHODS` 加字符串，其余自动（完整性测试兜底）。**不要在架构文档枚举方法清单**——那是契约文件的缓存。

**语义通道**（ADR-0002）：`cache:*`（getSongResources/setSongResources/clear/getStats；封面磁盘字节通道已随封面直链直渲移除）、
favorite/history/playlist/localMusic/settings/download/dialog/app/update 各自的 `domain:action` 组。
Push（main→renderer）：`download:progress|complete|error`, `localMusic:folderChanged`, `tray:action`, `shortcut:action`, `update:status`。

## Mobile (Expo/React Native)

expo-router Stack + Tabs：`(tabs)/`（推荐/发现/搜索/歌单/下载）+ player/favorites/history/settings/hotlist/playlist/[id]/discover-playlist/[id]/artist/[id]/album/[id]。

- `components/` TopBar, PlayerBar, PlayerOverlay, SongRow, DiscoverTabs, SourceSwapModal, AddToPlaylistModal 等
- `gestures/` 手势物理纯内核（拖拽关闭会话：位移/速度/判关，零 react-native 依赖，node 可测）+ `hooks/useDragToDismiss` 适配器——PlayerOverlay 与 BottomSheet 共用同一份物理
- `stores/` Zustand（部分 AsyncStorage persist）：player/settings/favorite/history/playlist/search/discover/source/download/audioTag/logs
- `services/` audioPlayer(expo-audio), notificationService, downloadService(SAF), songProbe/songResources(严格搜索 + core 刷新编排适配器)/sourceSwap, legacyMigration, cacheService(身份键 + 可播资源值缓存)

## Shared Package (`packages/core/`)

桌面/移动端共享。

- `api/` 请求层：7 源直连客户端（`neteaseDirect`/`qqDirect`/`kugouDirect`/`miguDirect`/`kuwoDirect`/`qianqianDirect`/`sodaDirect`，能力面 = searchSongs/getToplists/内容方法，IPC 契约见上节）；`musicApi` 薄门面（probeSongsBatch、soda 分享解析等基础方法）；`qqPlaylist`/`playlistImport`（QQ 歌单解析与链接导入）；`neteaseWeapi`；`antiScrape`（UA 池/反同源连续）；`tlsFingerprint` + `transport`（可注入接缝，maxRedirects 透传）；`probeSongs` + `prefetchCache`（探测写预取；键 = 歌曲身份键，值 = `PlayableResource`）
- `cache/` 缓存内核（CacheKernel/SongResourcesCache）
- `shared/`：`sourceRouter`（来源开关 `auto|direct` 两态 + `sanitizeSourceModes` 洗白存量 'api'、直连客户端注册表、`searchSongsRouted`/`resolvePlayableSongRouted` 路由、`getToplistSongs` + `TOPLIST_SOURCE_IDS`）、`chartAggregate`（多源榜单聚合内核）、`searchOrchestrator`、`sourceSwap`、`songResourceRefresh`（可播资源刷新编排：取缓存 → 旧签名死链判定 → 精确匹配搜索 → 写缓存/写回，依赖注入）、`songLyrics`、`updateChannels`（更新镜像探速）
- `utils/`（`songIdentity` 歌曲身份键：源 + 去源前缀真实 ID，多层嵌套按最外层源折叠；songMatcher/songDedupe/lyricsParser/legacyUrl 等）
- `tier3/tier3Api` 订阅源执行器

```bash
npm run core:build   # 移动端 Metro 吃 dist 产物：改 core 后必须重建移动端才生效
```
