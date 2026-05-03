# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MPlayer — an Electron desktop music player built with React, TypeScript, and Vite. Supports searching and playing music from NetEase and QQ Music sources.

## Commands

```bash
npm run dev              # Start Vite dev server (renderer only, port 5173)
npm run electron:dev     # Start full Electron app in dev mode
npm run build            # TypeScript check + Vite production build
npm run electron:build   # Build + package with electron-builder
npm run electron:build:win   # Build for Windows
npm run electron:build:mac   # Build for macOS
npm run electron:build:linux # Build for Linux
npm run lint             # ESLint with --max-warnings 0
npm run typecheck        # tsc --noEmit (type checking only)
```

No test framework is configured.

## Architecture

### Process Model (Electron)

The app uses `contextIsolation: false` and `nodeIntegration: true` — the renderer process can directly import main-process modules. IPC is used for operations requiring Node.js/Electron APIs.

### Main Process (`src/main/`)

- **`main.ts`** — Electron entry point. Creates BrowserWindow (1400x900, hiddenInset titleBar), sets up IPC handlers.
- **`api/musicApi.ts`** — HTTP client for music API. Handles search, audio URL resolution, lyrics, hotlist. **API base URL is dynamically loaded from config**.
- **`api/memoryCacheManager.ts`** — In-memory cache with TTL for fast access.
- **`config.ts`** — Configuration manager. Priority: Database settings (user) > Environment variables > Empty.
- **`cache/cacheManager.ts`** — Disk cache for search results, audio files, cover art, lyrics.
- **`storage/fileStorage.ts`** — JSON-file-based persistence for favorites, history, playlists, settings.
- **`storage/db.ts`** — Database abstraction layer.
- **`services/downloadService.ts`** — Download service with progress callbacks.

### Renderer Process (`src/renderer/`)

- **`App.tsx`** — Root component. Page routing via `useState<PageType>` (no router).
- **`store/`** — Zustand stores: playerStore, searchStore, favoriteStore, downloadStore.
- **`services/`** — Service singletons: audioPlayer, searchService, lyricsService, favoriteService, historyService, playlistService, cacheService.
- **`pages/`** — Discover, Favorites, History, Playlists, Settings, Lyrics, PlaylistDetail, HotlistDetail.
- **`components/`** — Sidebar, TopBar, PlayerBar, SongList, MusicCard, AddToPlaylistModal, BatchAddToPlaylistModal, DownloadProgressModal, PlayModeButton, CustomDropdown, LyricsDisplay.
- **`utils/`** — songDedupe, lyricsParser.
- **`hooks/`** — useLazyLoad.
- **`styles/`** — global.css.

### Shared (`src/shared/types/`)

- **`song.ts`** — Type definitions: SongBase, Song, Favorite, PlayHistory, Playlist, PlaylistSong.

### Build & Packaging

- Vite builds renderer to `dist/`, vite-plugin-electron builds main to `dist-electron/`.
- electron-builder produces NSIS installer and portable exe.

### Key Conventions

- UI: Ant Design 5 with Chinese locale (`zhCN`).
- Icons: lucide-react.
- All UI text in Chinese.
- No React Router — state-driven navigation.
- Store actions call IPC via `ipcRenderer.invoke()`.
- IPC channels: `domain:action` naming (e.g., `cache:getSong`, `settings:setDownloadPath`).

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