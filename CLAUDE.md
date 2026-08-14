# CLAUDE.md

MPlayer — Electron desktop music player (React + TypeScript + Vite) + Expo/React Native mobile app. Multi-source (NetEase, QQ, Kugou, Migu, Kuwo, Qianqian, Soda).

## Commands

### Desktop (Electron)

```bash
npm run dev              # Vite dev server (port 5173)
npm run electron:dev     # Full Electron app in dev mode
npm run build            # prebuild (kill + clean) → tsc → vite build
npm run electron:build   # Build + package (current platform)
npm run electron:build:win / :mac / :linux
npm run lint             # eslint --max-warnings 0
npm run typecheck        # tsc --noEmit
npm run core:build       # Build @mplayer/core shared package
npm run test             # vitest (watch)
npm run test:run         # vitest (single run)
npm run preview          # vite preview
```

**Verification order**: `lint → typecheck → test:run` before committing. All three must pass.

### Mobile (Expo/React Native)

```bash
cd packages/mobile
npm run start       # Expo dev server
npm run android     # Start on Android emulator
npm run ios         # Start on iOS simulator (macOS only)
npm run web         # Start in web browser
```

## Architecture

### Desktop (Electron)

`contextIsolation: false`, `nodeIntegration: true`. Renderer imports main-process modules directly.

#### Main Process (`src/main/`)

| File | Role |
|------|------|
| `main.ts` | Entry. BrowserWindow (1400×900, hiddenInset), IPC registration, global shortcuts, tray |
| `config.ts` | API URL: DB settings → env vars → empty |
| `proxy.ts` | Electron session proxy config |
| `api/musicApi.ts` | 壳：re-export `musicApi` / client 配置（`setApiBaseUrl` 等）from `@mplayer/core`（HTTP 客户端逻辑在 core） |
| `api/kugouApi.ts` | 酷狗排行榜直连（`mobilecdn.kugou.com`，`getKugouRank` / `getKugouNewSongs`） |
| `env.ts` | 环境变量读取（`.env.local` MUSIC_API_URL 等） |
| `cache/diskBackend.ts` | 磁盘缓存后端（音频、封面、歌词；`constructor(cacheDir)`） |
| `storage/db.ts` | Primary persistence (favorites, history, playlists, settings) |
| `storage/fileStorage.ts` | Legacy JSON storage |
| `ipc/registerHandler.ts` | `registerIpcHandler` / `registerIpcHandlerSimple` helpers |
| `services/downloadService.ts` | Download with progress callbacks |
| `services/localMusicService.ts` | Local music library scanning |
| `services/updateService.ts` | Auto-update via electron-updater |
| `services/chartAggregator.ts` | 多源排行榜聚合（netease/qq/kugou，供发现页） |
| `tray/trayManager.ts` | System tray + context menu |

> 注：反爬工具（`antiScrape.ts`）与内存缓存（`memoryCacheManager.ts`）已迁至 `@mplayer/core`（见 Shared Package）。

#### Renderer Process (`src/renderer/`)

| Directory | Contents |
|-----------|----------|
| `App.tsx` | Root layout, `<Outlet />` |
| `router/index.tsx` | HashRouter, all pages lazy loaded |
| `store/` | Zustand: playerStore, searchStore, favoriteStore, downloadStore, localStore |
| `services/` | audioPlayer, searchService, sourceSwap, coverCacheService, coverUrlResolver, artistMetaCache, importService, IpcClient, IpcMusicApi |
| `pages/` | Recommend, Discover, DiscoverPageV2, Favorites, History, Playlists, Queue, Settings, LocalMusic, PlaylistDetail, HotlistDetail, ArtistList, ArtistDetail, AlbumDetail, DiscoverPlaylistList, DiscoverPlaylistDetail, LyricsPage (unrouted) |
| `components/` | Sidebar, TopBar, PlayerBar, SongList, SongListVirtual, SongRow, SongListSkeleton, GroupedSongList, GroupHeaderRow, PlayerControls, PlayerProgress, PlayerVolume, MusicCard, HotlistCard, DiscoverPlaylistCard, SourceBadge, AddToPlaylistModal, BatchAddToPlaylistModal, DownloadProgressModal, ImportPlaylistModal, LinkImportForm, LinkPreviewTable, PlayModeButton, CustomDropdown, LyricsDisplay |
| `hooks/` | useLazyLoad, useGlobalShortcuts, useInfiniteScroll, useDownload, useButtonHover, useDiscoverData, useSongSwap |
| `utils/` | async, queueUtils, songCoverRefresh, songResolver（去重/匹配/歌词/格式化已迁 core） |

#### IPC Channels

Convention: `domain:action`. Renderer uses `ipcRenderer.invoke()` for request/response, `ipcRenderer.on()` for push events.

**MusicApi** — renderer→main (`invoke`):
`searchSongs`, `searchSongById`, `getAudioUrl`, `batchSearch`, `searchAllSources`, `probeAudio`, `getNeteaseHotlist`, `getQQHotlist`, `getNeteaseNewSongList`, `getQQNewSongList`, `getNeteasePlaylists`, `getNeteasePlaylistDetail`, `getNeteasePlaylistSongs`, `getNeteasePlaylistSongsPage`, `getPlaylistSongsFromThirdParty`, `getNeteaseArtists`, `getArtistSongs`, `getArtistAlbums`, `searchArtists`, `getAlbumDetail`, `getNewAlbums`, `getAggregatedChart`, `getRecommendedPlaylists`, `resolveCoverUrl`, `invalidateCoverUrl`, `fillSongUrls`, `getSodaAudioUrl`, `getSodaPlayableUrl`, `parseSodaShareLink`

**Cache** — renderer→main:
`getSong`, `setSong`, `getCover`, `setCover`, `getAudio`, `setAudio`, `getUrl`, `setUrl`, `clear`, `getStats`

**Favorite** — renderer→main:
`add`, `remove`, `isFavorite`, `getAll`

**History** — renderer→main:
`add`, `get`, `clear`, `remove`

**Playlist** — renderer→main:
`create`, `getAll`, `get`, `update`, `delete`, `addSong`, `removeSong`, `getSongs`, `updateSongsOrder`, `reorderFull`

**Lyrics** — renderer→main:
`get`

**Local Music** — renderer→main:
`addFolder`, `removeFolder`, `getFolders`, `getSongs`, `refresh`

**Settings** — renderer→main:
`getDownloadPath`, `setDownloadPath`, `resetDownloadPath`, `getApiUrl`, `setApiUrl`, `getProxy`, `setProxy`

**Download** — renderer→main:
`start`, `startBatch`, `cancel`, `getTasks`, `clearCompleted`

**Dialog** — renderer→main:
`openDirectory`

**App** — renderer→main:
`quit`

**Update** — renderer→main:
`check`, `download`, `install`, `getVersion`

**Push (main→renderer)**:
`download:progress`, `download:complete`, `download:error`, `localMusic:folderChanged`, `tray:action`, `shortcut:action`, `update:status`

**One-way (renderer→main, `on`)**:
`tray:state`, `tray:action`

**Ack**: `ipc:ack`

#### Routes

| Path | Component |
|------|-----------|
| `/` (default) | Navigate → `/recommend` |
| `/recommend` | RecommendPage |
| `/discover` | DiscoverPage / DiscoverPageV2 |
| `/hotlist/:type` | HotlistDetailPage |
| `/favorites` | FavoritesPage |
| `/history` | HistoryPage |
| `/queue` | QueuePage |
| `/playlists` | PlaylistsPage |
| `/playlists/discover` | DiscoverPlaylistListPage |
| `/discover-playlist/:id` | DiscoverPlaylistDetailPage |
| `/playlist/:id` | PlaylistDetailPage |
| `/artists` | ArtistListPage |
| `/artist/:id` | ArtistDetailPage |
| `/album/:id` | AlbumDetailPage |
| `/local` | LocalMusicPage |
| `/settings` | SettingsPage |
| `/download` | ComingSoon (planned) |

### Mobile (Expo/React Native)

#### Routes (expo-router Stack)

| Path | Component |
|------|-----------|
| `(tabs)/` | Tab layout (推荐, 发现, 搜索, 歌单, 下载；initialRouteName=recommend) |
| `(tabs)/recommend` | 推荐 tab（随机推荐 / 换一批） |
| `(tabs)/index` | DiscoverPage — swipeable tabs (排行榜/歌单/歌手) |
| `(tabs)/search` | Search results with `?q=` param |
| `(tabs)/playlists` | Playlists page with built-in 收藏/播放历史 entries |
| `(tabs)/download` | 下载列表（SAF 授权目录、本地播放、删除） |
| `player` | Full-screen player (modal presentation) |
| `favorites` | Favorites list (standalone Stack screen) |
| `history` | History list (standalone Stack screen) |
| `settings` | API + play mode settings (standalone Stack screen) |
| `hotlist` | Hotlist detail |
| `playlist/[id]` | User playlist detail |
| `discover-playlist/[id]` | Discover playlist detail |
| `artist/[id]` | Artist detail |
| `album/[id]` | Album detail |

#### Components (`packages/mobile/components/`)

| Component | Role |
|-----------|------|
| `TopBar` | Logo + search bar + settings button |
| `PlayerBar` | Mini player bar above tab bar, queue management |
| `PlayerOverlay` | Full-screen player overlay (song info + controls + lyrics) |
| `SongRow` | Reusable song row (cover, name, artist, favorite, more actions, bottom sheet) |
| `DiscoverTabs` | Swipeable tab container: Hotlist / Playlists (grid with infinite scroll) / Artists (grid with infinite scroll) |
| `AddToPlaylistModal` | Modal for adding songs to user playlists |
| `LoadMoreFooter` | Shared infinite scroll footer (loading spinner / "全部加载" text) |
| `EmptyState` | Empty state placeholder |
| `LoadingState` | Loading spinner |

#### Stores (`packages/mobile/stores/`)

| Store | Persistence | Key fields |
|-------|-------------|------------|
| `playerStore` | No | currentSong, queue, currentIndex, isPlaying, currentTime, duration |
| `settingsStore` | AsyncStorage | apiBaseUrl, playMode |
| `favoriteStore` | AsyncStorage | favorites, favoriteIds |
| `historyStore` | AsyncStorage | history (max 200) |
| `playlistStore` | AsyncStorage | playlists |
| `searchStore` | No | results, loading, error, query, page, hasMore, loadingMore |
| `discoverStore` | No | hotlist data (netease/qq hot & new) |
| `sourceStore` | AsyncStorage | selectedSource (搜索源切换) |
| `downloadStore` | No | 下载任务（status: downloading/done/error） |
| `audioTagStore` | No | 本地音频标签缓存 |
| `logsStore` | AsyncStorage | 日志记录 |

#### Services (`packages/mobile/services/`)

| Service | Role |
|---------|------|
| `audioPlayer.ts` | expo-av Sound management, play/toggle/seek |
| `notificationService.ts` | expo-notifications channel + playback notification |
| `downloadService.ts` | expo-file-system 下载（SAF 目录授权、本地 URI、删除） |
| `audioProbe.ts` / `songProbe.ts` | 音频可播性探测（复用 core `audioProbe`） |
| `songResources.ts` | 歌曲资源（封面/歌词）解析 |
| `sourceSwap.ts` | 单曲换源候选（对接 core `sourceSwap`） |
| `coverSearchSlot.ts` | 封面搜索槽位 |
| `cacheService.ts` | 缓存服务 |

## Shared Package (`packages/core/`)

Common types and API client shared between desktop and mobile.

```
packages/core/src/
├── api/                        # 请求层（桌面/移动端共享）
│   ├── musicApi.ts             # 多源音乐 API 客户端（搜索/热榜/歌单/歌手/歌词/URL）
│   │                            # 网易 weapi 直连、Soda 直连、QQ 热榜直连、反爬兜底、缓存
│   ├── neteaseWeapi.ts         # 网易 weapi 加密（AES-CBC+RSA，纯 JS 双端可用）
│   ├── antiScrape.ts           # UA 池 / 令牌桶限速 / 增强头 / beforeRequest
│   ├── memoryCacheManager.ts   # 内存缓存（搜索/URL/歌词/热榜，TTL）
│   ├── audioProbe.ts           # 音频可播性探测（probeAudio / probeAudioUrl）
│   ├── probeSongs.ts           # 批量歌曲探测
│   ├── axiosTransport.ts / transport.ts   # 传输层抽象（axios 实现 / 接口）
│   └── playlistImport.ts       # 歌单导入
├── cache/                      # 缓存内核（cacheKernel / ttl / backends/memoryBackend）
├── shared/                     # resolvePlayableUrl / resolveFreshUrl / searchController / sourceSwap（单曲换源）
├── utils/                      # songDedupe / songMatcher / songResolver / lyricsParser / format /
│                                # hash(md5) / queue / recommendBatch / resourceKey / sourceReferer
├── types/index.ts              # Song, SourceKey, LyricLine, etc.
└── index.ts                    # Re-exports everything
```

```bash
npm run core:build        # Build @mplayer/core (regenerate dist/ with type declarations)
```

## Key Conventions

### Desktop
- UI: Ant Design 5, Chinese locale (`zhCN`), lucide-react icons. All UI text in Chinese.
- Virtual scrolling: `@tanstack/react-virtual` (threshold: 30 items).
- Drag-and-drop: `@dnd-kit/core` + `@dnd-kit/sortable`.
- Song dedup: `songDedupe.ts` (by id or name|artist composite key)（在 core）。
- Audio: Howler.js（`src/renderer/services/audioPlayer.ts`）。
- Path alias: `@/*` maps to `./src/*`. Use `@/renderer/...`, `@/main/...`, etc.
- **No context isolation**: `contextIsolation: false`, `nodeIntegration: true`. Renderer imports main-process modules directly via `require('electron')`.

### Mobile
- UI: 浅色蓝调主题（对齐 desktop 设计系统），设计 token 见 `packages/mobile/theme/tokens.ts`（映射表见同目录 README.md）；主体浅色重构已完成（wayfinder #108，真机验收 #114 待办）。图标库：lucide-react-native（desktop 同款）。All UI text in Chinese.
- State management: Zustand stores, some with `persist` middleware (AsyncStorage).
- Navigation: expo-router Stack + Tabs.
- Audio: expo-av (Audio.Sound), no Howler.js.
- Gestures: PanResponder + Animated (swipeable tabs, swipe-down-to-close player).

## tsconfig Strictness

`noUnusedLocals` and `noUnusedParameters` are enabled in root tsconfig. Remove unused imports/variables before typechecking or it will fail.

Root tsconfig.json has `"exclude": ["packages"]` — root typecheck skips mobile code. Root Vite build only processes `src/` (Electron), not `packages/mobile/`.

```bash
# Root (Electron)
npx tsc --noEmit

# Mobile
npx tsc --noEmit --project packages/mobile/tsconfig.json
```

## ESLint Ignores

配置在 `eslint.config.js`（flat config）。全局 ignores：`dist/`, `dist-electron/`, `coverage/`, `node_modules/`, `packages/core/dist/`, `packages/core/coverage/`, `.expo/`, `packages/mobile/.expo/`, `src/main/storage/fileStorage.ts`（legacy）。`src/main/api/musicApi.ts` 已不是忽略项（现为 core 的 re-export 壳）。

## Testing

### Desktop (Electron)

**Renderer tests**: Vitest + jsdom + @testing-library/react. Test files in `src/renderer/__tests__/` and `src/__tests__/`.
- **Config**: `vite.config.ts` — `test` section (`globals: true`, `environment: 'jsdom'`)
- **Setup**: `src/renderer/__tests__/setup.ts` — mocks `electron` (ipcRenderer.invoke/on/send, clipboard, shell), `window.matchMedia` for Ant Design
- **Globals**: `describe`, `it`, `expect` available without import
- **Factories**: `src/renderer/__tests__/factories.ts` — `createSong()`, `createLocalSong()` for test data
- **IPC mock pattern**: `vi.mock('@/renderer/services/IpcClient')` in store integration tests

```bash
npx vitest run                    # renderer tests (single run)
npx vitest                        # renderer tests (watch mode)
```

**Main process tests**: Vitest + node environment. Test files in `src/__tests__/main/`.
- **Config**: `vitest.main.config.ts` — `environment: 'node'`, `include: ['src/__tests__/main/**']`
- **Setup**: `src/__tests__/main/setup.ts` — global `vi.mock('electron', ...)` covering app/BrowserWindow/ipcMain/dialog/session/globalShortcut/Tray/Menu/nativeImage
- **Per-file override**: Test files can call `vi.mock('electron', ...)` again to override specific APIs

```bash
npx vitest run --config vitest.main.config.ts   # main process tests
```

**Constructor injection for testability**:
- `src/main/cache/diskBackend.ts` — `constructor(cacheDir: string)`（测试传临时目录）
- `src/main/services/localMusicService.ts` — `constructor(userDataPath?: string)`（缺省回退 `app.getPath('userData')`）

（`fileStorage.ts` 已改为内部 `app.getPath('userData')`，不再注入。）

### Core (`packages/core/`)

```bash
npm run core:build                # build before running tests
npx vitest run --config packages/core/vitest.config.ts
```

### Mobile (`packages/mobile/`)

- **Config**: `packages/mobile/vitest.config.ts` — `environment: 'node'`
- **Setup**: `packages/mobile/__tests__/setup.ts` — mocks AsyncStorage, react-native Alert, @mplayer/core musicApi
- **Store tests**: Pure zustand `getState/setState` pattern — no persistence dependency in unit tests

```bash
npx vitest run --config packages/mobile/vitest.config.ts
```

### E2E

Playwright tests in `e2e/`. Use `npx vite --config vite.test.config.ts --port 5174` as test server.
- **Mobile E2E**: Not yet set up (requires Detox or Maestro). Manual testing via Expo.

### Verification order

```bash
npx vitest run                           # renderer
npx vitest run --config vitest.main.config.ts   # main
npx vitest run --config packages/mobile/vitest.config.ts  # mobile
npx vitest run --config packages/core/vitest.config.ts    # core
```

## Prebuild Script

`npm run build` runs `scripts/prebuild.js` first, which:
1. Kills running `MPlayer.exe` (Windows only, silent fail)
2. Deletes `dist/` and `dist-electron/`

This means `npm run build` is destructive to existing build output.

## Worktree Rules

- **在 worktree 内调试或跑测试时，必须在 worktree 内构建和运行**，不要 cd 到主分支目录执行。worktree 是隔离的，主分支的 `dist/`、`node_modules/.vite/` 等缓存与 worktree 代码不一致，会导致难以排查的 bug。
- 构建命令（`npm run build`、`npm run electron:dev`、`npx playwright test`）必须在 worktree 根目录下执行。
- 如果 worktree 缺少 `node_modules`，先在 worktree 内执行 `npm install`，不要从主分支复制。

## API Configuration

1. **User Config** (priority): Settings → API Settings → Save → Restart.
2. **Dev**: `.env.local` with `MUSIC_API_URL=https://your-api-server.com/`. Never commit API URLs.
3. `.env.local` is gitignored. Never commit API URLs.

Required endpoints: `/search`, `/toplist`, `/url`, `/lyric`, `/playlist/catlist`, `/playlist/hot`, `/playlist/detail`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
