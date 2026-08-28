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
| `services/` | downloadService / localMusicService / updateService / chartAggregator |
| `tray/trayManager.ts` | System tray + context menu |

### Renderer Process (`src/renderer/`)

- `router/index.tsx` HashRouter 全懒加载；页面在 `pages/`（推荐/发现/热榜/收藏/历史/歌单/队列/本地/歌手/专辑/设置等）
- `store/` Zustand：playerStore, searchStore, favoriteStore, downloadStore, localStore
- `services/` audioPlayer(Howler), searchService, sourceSwap, coverCacheService, IpcClient, callMusicApi 等
- `components/` PlayerBar/SongList/SongRow/LyricsDisplay 等通用件

## IPC Channels

约定 `domain:action`。渲染端 request/response 用 `invoke`，推送用 `on`。

**MusicApi** — 单通道分发（ADR-0001）：`musicApi:call(method, ...args)`。方法清单唯一手写物是
`src/shared/musicApiContract.ts` 的 `MUSIC_API_METHODS`；渲染端泛型入口 `callMusicApi(method, ...args)`，
主进程分发表 `satisfies MusicApiMethodMap`，未知方法返回失败封套。加方法 = core 加方法 + 清单加字符串，
其余自动（完整性测试 `src/__tests__/musicApiIntegrity.test.ts` 兜底）。**不要在架构文档枚举方法清单**——那是契约文件的缓存。

**语义通道**（ADR-0002）：`cache:*`（getSongResources/setSongResources/getCoverPath/setCoverBytes/invalidateCover/clear/getStats）、
favorite/history/playlist/localMusic/settings/download/dialog/app/update 各自的 `domain:action` 组。
Push（main→renderer）：`download:progress|complete|error`, `localMusic:folderChanged`, `tray:action`, `shortcut:action`, `update:status`。

## Mobile (Expo/React Native)

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
