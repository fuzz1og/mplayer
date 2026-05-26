# CLAUDE.md

MPlayer — Electron desktop music player (React + TypeScript + Vite). NetEase & QQ Music sources.

## Commands

```bash
npm run dev              # Vite dev server (port 5173)
npm run electron:dev     # Full Electron app in dev mode
npm run build            # tsc + Vite production build
npm run electron:build   # Build + package (current platform)
npm run electron:build:win / :mac / :linux
npm run lint             # ESLint --max-warnings 0
npm run typecheck        # tsc --noEmit
npm run test:run         # vitest single run
```

## Architecture

Electron with `contextIsolation: false`, `nodeIntegration: true`. Renderer can import main-process modules directly. IPC for Node.js/Electron APIs.

### Main Process (`src/main/`)

- `main.ts` — Entry. BrowserWindow (1400x900, hiddenInset), IPC handlers, global shortcuts, tray.
- `api/musicApi.ts` — HTTP client (search, audio URL, lyrics, hotlist). **API base URL loaded dynamically from config**.
- `config.ts` — Priority: DB settings > env vars > empty.
- `cache/cacheManager.ts` — Disk cache (audio, covers, lyrics).
- `storage/fileStorage.ts` — JSON persistence (favorites, history, playlists, settings).
- `services/downloadService.ts` — Download with progress callbacks.
- `tray/trayManager.ts` — System tray with context menu.

### Renderer Process (`src/renderer/`)

- `App.tsx` — Root layout with `<Outlet />`.
- `router/index.tsx` — HashRouter, all pages lazy loaded.
- `store/` — Zustand: playerStore, searchStore, favoriteStore, downloadStore.
- `services/` — Singletons: audioPlayer, searchService, lyricsService, favoriteService, historyService, playlistService, cacheService.
- `pages/` — Discover, Favorites, History, Playlists, Queue, Settings, Lyrics, PlaylistDetail, HotlistDetail.
- `components/` — Sidebar, TopBar, PlayerBar, SongList, SongListVirtual, SongRow, PlayerControls, PlayerProgress, PlayerVolume, MusicCard, AddToPlaylistModal, BatchAddToPlaylistModal, DownloadProgressModal, PlayModeButton, CustomDropdown, LyricsDisplay.
- `utils/` — songDedupe, lyricsParser.
- `hooks/` — useLazyLoad, useGlobalShortcuts.

### IPC Channels

Renderer calls via `ipcRenderer.invoke()` (use `const { ipcRenderer } = window.require('electron')`).

| Channel | Direction | Description |
|---------|-----------|-------------|
| `musicApi:searchSongs` | renderer→main | Search songs |
| `musicApi:getAudioUrl` | renderer→main | Resolve audio URL |
| `musicApi:getNeteaseHotlist` | renderer→main | NetEase hotlist |
| `musicApi:getQQHotlist` | renderer→main | QQ Music hotlist |
| `tray:state` | renderer→main | Update tray song info |
| `tray:action` | main→renderer | Play/pause/prev/next from tray |
| `shortcut:action` | main→renderer | Global shortcut actions |

### Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/discover` | DiscoverPage | Search results + hotlists + discover playlists |
| `/hotlist/:type` | HotlistDetailPage | Hotlist detail (netease/qq) |
| `/favorites` | FavoritesPage | Favorite songs |
| `/history` | HistoryPage | Play history |
| `/queue` | QueuePage | Now-playing queue (drag-to-reorder) |
| `/playlists` | PlaylistsPage | User playlists |
| `/playlist/:id` | PlaylistDetailPage | Playlist detail (drag + batch ops) |
| `/settings` | SettingsPage | App settings |
| `/local` | LocalMusicPage | Local music library |
| `/download` | ComingSoon | Download manager (planned) |

## Key Conventions

- UI: Ant Design 5 with Chinese locale (`zhCN`). Icons: lucide-react. All UI text in Chinese.
- IPC channels: `domain:action` naming.
- ipcRenderer: `const { ipcRenderer } = window.require('electron')` (Vite externalizes electron).
- Store actions call IPC via `ipcRenderer.invoke()`.
- Virtual scrolling: `@tanstack/react-virtual` (threshold: 30 items).
- Drag-and-drop: `@dnd-kit/core` + `@dnd-kit/sortable`.
- Song deduplication: `src/renderer/utils/songDedupe.ts` (by id or name|artist composite key).

## API Configuration

1. **User Config** (priority): Settings page → API Settings → Save → Restart.
2. **Dev**: `.env.local` with `MUSIC_API_URL=https://your-api-server.com/`. Never commit API URLs.

Required API endpoints: `/search`, `/toplist`, `/url`, `/lyric`, `/playlist/catlist`, `/playlist/hot`, `/playlist/detail`.
