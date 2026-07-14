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
| `api/musicApi.ts` | HTTP client. **Base URL loaded dynamically from config** |
| `api/antiScrape.ts` | Anti-scraping measures |
| `api/memoryCacheManager.ts` | In-memory cache |
| `cache/cacheManager.ts` | Disk cache (audio, covers, lyrics) |
| `storage/db.ts` | Primary persistence (favorites, history, playlists, settings) |
| `storage/fileStorage.ts` | Legacy JSON storage |
| `ipc/registerHandler.ts` | `registerIpcHandler` / `registerIpcHandlerSimple` helpers |
| `services/downloadService.ts` | Download with progress callbacks |
| `services/localMusicService.ts` | Local music library scanning |
| `services/updateService.ts` | Auto-update via electron-updater |
| `tray/trayManager.ts` | System tray + context menu |

#### Renderer Process (`src/renderer/`)

| Directory | Contents |
|-----------|----------|
| `App.tsx` | Root layout, `<Outlet />` |
| `router/index.tsx` | HashRouter, all pages lazy loaded |
| `store/` | Zustand: playerStore, searchStore, favoriteStore, downloadStore, localStore |
| `services/` | Singletons: audioPlayer, searchService, lyricsService, favoriteService, historyService, playlistService, cacheService, coverCacheService, importService, IpcClient |
| `pages/` | Discover, Favorites, History, Playlists, Queue, Settings, LocalMusic, PlaylistDetail, HotlistDetail, ArtistList, ArtistDetail, DiscoverPlaylistList, DiscoverPlaylistDetail, LyricsPage (unrouted) |
| `components/` | Sidebar, TopBar, PlayerBar, SongList, SongListVirtual, SongRow, SongListSkeleton, GroupedSongList, GroupHeaderRow, PlayerControls, PlayerProgress, PlayerVolume, MusicCard, HotlistCard, DiscoverPlaylistCard, SourceBadge, AddToPlaylistModal, BatchAddToPlaylistModal, DownloadProgressModal, ImportPlaylistModal, LinkImportForm, LinkPreviewTable, PlayModeButton, CustomDropdown, LyricsDisplay |
| `hooks/` | useLazyLoad, useGlobalShortcuts, useInfiniteScroll, useDownload, useButtonHover |
| `utils/` | songDedupe, songMatcher, songResolver, lyricsParser, format |

#### IPC Channels

Convention: `domain:action`. Renderer uses `ipcRenderer.invoke()` for request/response, `ipcRenderer.on()` for push events.

**MusicApi** — renderer→main (`invoke`):
`searchSongs`, `getAudioUrl`, `batchSearch`, `searchAllSources`, `getNeteaseHotlist`, `getQQHotlist`, `getNeteaseNewSongList`, `getQQNewSongList`, `getNeteasePlaylists`, `getNeteasePlaylistDetail`, `getPlaylistSongsFromThirdParty`, `getNeteaseArtists`, `getArtistSongs`, `searchArtists`, `getSodaAudioUrl`, `getSodaPlayableUrl`, `parseSodaShareLink`

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
| `/` (default) | DiscoverPage |
| `/discover` | DiscoverPage |
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
| `/local` | LocalMusicPage |
| `/settings` | SettingsPage |
| `/download` | ComingSoon (planned) |

### Mobile (Expo/React Native)

#### Routes (expo-router Stack)

| Path | Component |
|------|-----------|
| `(tabs)/` | Tab layout (发现, 搜索, 歌单, 下载) |
| `(tabs)/index` | DiscoverPage — swipeable tabs (排行榜/歌单/歌手) |
| `(tabs)/search` | Search results with `?q=` param |
| `(tabs)/playlists` | Playlists page with built-in 收藏/播放历史 entries |
| `(tabs)/download` | Download placeholder |
| `player` | Full-screen player (modal presentation) |
| `favorites` | Favorites list (standalone Stack screen) |
| `history` | History list (standalone Stack screen) |
| `settings` | API + play mode settings (standalone Stack screen) |
| `hotlist` | Hotlist detail |
| `playlist/[id]` | User playlist detail |
| `discover-playlist/[id]` | Discover playlist detail |
| `artist/[id]` | Artist detail |

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

#### Services (`packages/mobile/services/`)

| Service | Role |
|---------|------|
| `audioPlayer.ts` | expo-av Sound management, play/toggle/seek |
| `notificationService.ts` | expo-notifications channel + playback notification |

## Shared Package (`packages/core/`)

Common types and API client shared between desktop and mobile.

```
packages/core/src/
├── api/musicApi.ts       # Axios client for music API (search, lyrics, hotlist, etc.)
│                          # warmUpArtistPicCache — 预缓存热门歌手头像
│                          # fetchNeteaseArtistsByHtml — HTML 爬取 + 逐歌手 API 补图兜底
├── types/index.ts        # Song, SourceKey, LyricLine, etc.
├── utils/
│   ├── lyricsParser.ts   # parseLRC, findCurrentLyricIndex
│   └── songResolver.ts   # resolveSongUrl
└── index.ts              # Re-exports everything
```

```bash
npm run core:build        # Build @mplayer/core (regenerate dist/ with type declarations)
```

## Key Conventions

### Desktop
- UI: Ant Design 5, Chinese locale (`zhCN`), lucide-react icons. All UI text in Chinese.
- Virtual scrolling: `@tanstack/react-virtual` (threshold: 30 items).
- Drag-and-drop: `@dnd-kit/core` + `@dnd-kit/sortable`.
- Song dedup: `songDedupe.ts` (by id or name|artist composite key).
- Path alias: `@/*` maps to `./src/*`. Use `@/renderer/...`, `@/main/...`, etc.
- **No context isolation**: `contextIsolation: false`, `nodeIntegration: true`. Renderer imports main-process modules directly via `require('electron')`.

### Mobile
- UI: Custom dark theme (`#1a1a2e` bg, `#16213e` cards, `#e74c3c` accent), Ionicons icons. All UI text in Chinese.
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

`src/main/api/musicApi.ts` and `src/main/storage/fileStorage.ts` are excluded from linting (legacy code).

## Testing

- **Unit tests**: Vitest with jsdom environment. Tests in `src/renderer/__tests__/` and `src/__tests__/`.
- **Setup**: `src/renderer/__tests__/setup.ts` mocks `electron` module (`ipcRenderer.invoke`, `ipcRenderer.on`). Ant Design's `matchMedia` is also mocked.
- **Globals**: `describe`, `it`, `expect` are available without import (`globals: true` in vitest config).
- **E2E**: Playwright tests in `e2e/`. Use `npx vite --config vite.test.config.ts --port 5174` as test server.
- **Mobile E2E**: Not yet set up (requires Detox or Maestro). Manual testing via Expo.

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
