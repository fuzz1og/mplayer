# CLAUDE.md

MPlayer — Electron desktop music player. React + TypeScript + Vite. Multi-source (NetEase, QQ, Kugou, Migu, Kuwo, Qianqian, Soda).

## Commands

```bash
npm run dev              # Vite dev server (port 5173)
npm run electron:dev     # Full Electron app in dev mode
npm run build            # prebuild (kill + clean) → tsc → vite build
npm run electron:build   # Build + package (current platform)
npm run electron:build:win / :mac / :linux
npm run lint             # eslint --max-warnings 0
npm run typecheck        # tsc --noEmit
npm run test             # vitest (watch)
npm run test:run         # vitest (single run)
npm run preview          # vite preview
```

## Architecture

Electron, `contextIsolation: false`, `nodeIntegration: true`. Renderer imports main-process modules directly.

### Main Process (`src/main/`)

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

### Renderer Process (`src/renderer/`)

| Directory | Contents |
|-----------|----------|
| `App.tsx` | Root layout, `<Outlet />` |
| `router/index.tsx` | HashRouter, all pages lazy loaded |
| `store/` | Zustand: playerStore, searchStore, favoriteStore, downloadStore, localStore |
| `services/` | Singletons: audioPlayer, searchService, lyricsService, favoriteService, historyService, playlistService, cacheService, coverCacheService, importService, IpcClient |
| `pages/` | Discover, Favorites, History, Playlists, Queue, Settings, LocalMusic, PlaylistDetail, HotlistDetail, ArtistList, ArtistDetail, DiscoverPlaylistList, DiscoverPlaylistDetail, LyricsPage (unrouted) |
| `components/` | Sidebar, TopBar, PlayerBar, SongList, SongListVirtual, SongRow, SongListSkeleton, GroupedSongList, GroupHeaderRow, PlayerControls, PlayerProgress, PlayerVolume, MusicCard, HotlistCard, DiscoverPlaylistCard, SourceBadge, AddToPlaylistModal, BatchAddToPlaylistModal, DownloadProgressModal, ImportPlaylistModal, LinkImportForm, LinkPreviewTable, PlayModeButton, CustomDropdown, LyricsDisplay |
| `hooks/` | useLazyLoad, useGlobalShortcuts, useInfiniteScroll, useDownload, useButtonHover |
| `utils/` | songDedupe, songMatcher, songResolver, lyricsParser |

### IPC Channels

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

### Routes

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

## Key Conventions

- UI: Ant Design 5, Chinese locale (`zhCN`), lucide-react icons. All UI text in Chinese.
- Virtual scrolling: `@tanstack/react-virtual` (threshold: 30 items).
- Drag-and-drop: `@dnd-kit/core` + `@dnd-kit/sortable`.
- Song dedup: `songDedupe.ts` (by id or name|artist composite key).

## API Configuration

1. **User Config** (priority): Settings → API Settings → Save → Restart.
2. **Dev**: `.env.local` with `MUSIC_API_URL=https://your-api-server.com/`. Never commit API URLs.

Required endpoints: `/search`, `/toplist`, `/url`, `/lyric`, `/playlist/catlist`, `/playlist/hot`, `/playlist/detail`.
