# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MPlayer — an Electron desktop music player built with React, TypeScript, and Vite. Supports searching and playing music from NetEase and QQ Music sources.

## Commands

```bash
npm run dev              # Start Vite dev server (renderer only, port 5173)
npm run electron:dev     # Start full Electron app in dev mode
npm run build            # TypeScript check + Vite production build
npm run electron:build   # Build + package with electron-builder (current platform)
npm run electron:build:win   # Build for Windows
npm run electron:build:mac   # Build for macOS
npm run electron:build:linux # Build for Linux
npm run lint             # ESLint with --max-warnings 0
npm run typecheck        # tsc --noEmit (type checking only)
npm run test             # Run vitest (watch mode)
npm run test:run         # Run vitest (single run)
```

## Architecture

### Process Model (Electron)

The app uses `contextIsolation: false` and `nodeIntegration: true` — the renderer process can directly import main-process modules. IPC is used for operations requiring Node.js/Electron APIs.

### Main Process (`src/main/`)

- **`main.ts`** — Electron entry point. Creates BrowserWindow (1400x900, hiddenInset titleBar), sets up IPC handlers, global shortcuts (media keys + `Ctrl+Alt+Space` etc.), and tray.
- **`api/musicApi.ts`** — HTTP client for music API. Handles search, audio URL resolution, lyrics, hotlist. **API base URL is dynamically loaded from config**.
- **`api/memoryCacheManager.ts`** — In-memory cache with TTL for fast access.
- **`config.ts`** — Configuration manager. Priority: Database settings (user) > Environment variables > Empty.
- **`cache/cacheManager.ts`** — Disk cache for search results, audio files, cover art, lyrics.
- **`storage/fileStorage.ts`** — JSON-file-based persistence for favorites, history, playlists, settings.
- **`storage/db.ts`** — Database abstraction layer.
- **`services/downloadService.ts`** — Download service with progress callbacks.
- **`tray/trayManager.ts`** — System tray icon with context menu (play/pause, prev/next, show, quit).

### Renderer Process (`src/renderer/`)

- **`App.tsx`** — Root layout component. Uses React Router's `<Outlet />` to render child routes.
- **`router/index.tsx`** — React Router configuration with `createHashRouter`. All pages use lazy loading.
- **`store/`** — Zustand stores: playerStore, searchStore, favoriteStore, downloadStore.
- **`services/`** — Service singletons: audioPlayer, searchService, lyricsService, favoriteService, historyService, playlistService, cacheService.
- **`pages/`** — Discover, Favorites, History, Playlists, Queue, Settings, Lyrics, PlaylistDetail, HotlistDetail.
- **`components/`** — Sidebar, TopBar, PlayerBar, SongList, SongListVirtual, SongRow, PlayerControls, PlayerProgress, PlayerVolume, MusicCard, AddToPlaylistModal, BatchAddToPlaylistModal, DownloadProgressModal, PlayModeButton, CustomDropdown, LyricsDisplay.
- **`utils/`** — songDedupe (checkDuplicate/filterDuplicates/dedupeSongs), lyricsParser.
- **`hooks/`** — useLazyLoad, useGlobalShortcuts.
- **`styles/`** — global.css.

### IPC Channels

**API (renderer → main via `ipcRenderer.invoke()`):**
- `musicApi:getAudioUrl` — Get real audio URL from redirect
- `musicApi:searchSongs` — Search songs by keyword
- `musicApi:getNeteaseHotlist` — Get NetEase hotlist
- `musicApi:getQQHotlist` — Get QQ Music hotlist

**Tray (renderer → main via `ipcMain.on`):**
- `tray:state` — Send `{ songName, artist, isPlaying }` to update tray

**Tray (main → renderer via `webContents.send`):**
- `tray:action` — Receive `{ type: 'playPause' | 'prev' | 'next' }` from tray menu clicks

**Shortcuts (main → renderer via `webContents.send`):**
- `shortcut:action` — Receive `{ type: 'playPause' | 'next' | 'prev' }` from global shortcuts

**Note**: renderer should call invoke-type channels via `ipcRenderer.invoke()` instead of importing `musicApi` directly.

### Shared (`src/shared/types/`)

- **`song.ts`** — Type definitions: SongBase, Song, Favorite, PlayHistory, Playlist, PlaylistSong.
- **`player.ts`** — Type definitions: PlayMode.

### Build & Packaging

- Vite builds renderer to `dist/`, vite-plugin-electron builds main to `dist-electron/`.
- electron-builder produces NSIS installer and portable exe.

### Key Conventions

- UI: Ant Design 5 with Chinese locale (`zhCN`).
- Icons: lucide-react.
- All UI text in Chinese.
- React Router with HashRouter for navigation.
- Store actions call IPC via `ipcRenderer.invoke()`.
- IPC channels: `domain:action` naming (e.g., `cache:getSong`, `settings:setDownloadPath`).
- **ipcRenderer access**: Must use `const { ipcRenderer } = window.require('electron')` instead of static import, because Vite marks `electron` as external.

### Route Configuration

Routes are defined in `src/renderer/router/index.tsx`:

| Path | Component | Description |
|------|-----------|-------------|
| `/` | App (layout) | Root layout with sidebar, topbar, playerbar |
| `/discover` | DiscoverPage | Main discovery page with search results |
| `/hotlist/:type` | HotlistDetailPage | Hotlist detail (netease/qq) |
| `/favorites` | FavoritesPage | User's favorite songs |
| `/history` | HistoryPage | Play history |
| `/queue` | QueuePage | Now-playing queue with drag-to-reorder |
| `/playlists` | PlaylistsPage | User's playlists |
| `/playlist/:id` | PlaylistDetailPage | Playlist detail (with drag-to-reorder + batch ops) |
| `/settings` | SettingsPage | App settings |
| `/local` | ComingSoon | Local music (planned) |
| `/download` | ComingSoon | Download manager (planned) |

### API Configuration

The app requires an external music API service. Two configuration methods:

1. **User Configuration** (Priority): Set API URL in Settings page → API Settings → Save → Restart app.
2. **Development**: Create `.env.local` in project root:
   ```
   MUSIC_API_URL=https://your-api-server.com/
   ```

**Important**: Never commit API URLs to Git. The `.env.local` file is already in `.gitignore`.

### Audio Caching

- On first play: audio file downloaded and cached to `cache/audio/` (max 10 recent songs)
- Subsequent plays: use cached file (faster)
- Managed by `cacheManager.ts`: `getAudioCache()`, `setAudioCache()`, `trimAudioCache(keepCount)`

### Download Functionality

- Users can set custom download path via Settings
- Download progress tracked in real-time via IPC events (`download:progress`, `download:complete`, `download:error`)
- Default download path: system Downloads folder

### System Tray

- `trayManager.ts` draws a 16×16 canvas icon (blue triangle) for the tray
- Right-click menu shows: current song (disabled), play/pause toggle, previous, next, show window, quit
- Renderer sends `tray:state` IPC on song change / play state change
- Tray menu clicks send `tray:action` IPC back to renderer

### Global Shortcuts

Registered in `main.ts` via `globalShortcut.register()`:
- Media keys: `MediaPlayPause`, `MediaNextTrack`, `MediaPreviousTrack`
- Custom: `CommandOrControl+Alt+Space` (play/pause), `CommandOrControl+Alt+Right` (next), `CommandOrControl+Alt+Left` (prev)
- Forwarded to renderer on channel `shortcut:action`
- `useGlobalShortcuts` hook in renderer dispatches to `playerStore`

### Song Deduplication

- `src/renderer/utils/songDedupe.ts`
- `checkDuplicate(targetSongs, newSong)` → `{ status: 'duplicate' | 'nameConflict' | 'ok', existingSong? }`
- `filterDuplicates(targetSongs, newSongs)` → `{ ok: Song[], duplicates: Song[], conflicts: Song[] }`
- `dedupeSongs(existingSongs, newSongs)` → unique songs by id or name|artist composite key

### Drag-and-Drop

- Uses `@dnd-kit/core` + `@dnd-kit/sortable` for reorderable lists
- Used in `PlaylistDetailPage` and `QueuePage` with `useSortable` + `GripVertical` drag handles
- `handleDragEnd` calls store action to reorder and persists via API

### Virtual Scrolling

- `SongListVirtual` component uses `@tanstack/react-virtual` `useVirtualizer`
- Threshold: renders normally for < 30 items, virtualized for 30+
- Each row delegated to `SongRow` component (memoized with custom comparator)