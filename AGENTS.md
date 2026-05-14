# AGENTS.md

## Commands
```bash
npm run dev                 # Vite dev server (port 5173)
npm run electron:dev        # Full Electron app
npm run build               # tsc && vite build
npm run electron:build      # Package (current platform)
npm run electron:build:win  # Package for Windows
npm run electron:build:mac  # Package for macOS
npm run electron:build:linux# Package for Linux
npm run lint                # ESLint (--max-warnings 0)
npm run typecheck           # tsc --noEmit
npm run test:run            # vitest single run
```

## Build Order
`lint -> typecheck -> test:run -> build`

## Architecture
- **Main**: `src/main/` — Electron entry, IPC, HTTP client, cache, storage, download, tray
- **Renderer**: `src/renderer/` — React + Zustand, state-driven navigation
- **Shared**: `src/shared/types/` — TypeScript types
- **Alias**: `@/` → `src/`
- **Electron**: `contextIsolation: false`, `nodeIntegration: true`, 1400x900, `titleBarStyle: hiddenInset`

## Conventions
- UI: Ant Design 5 (zhCN), icons: lucide-react
- IPC: `domain:action` naming
- **ipcRenderer**: `const { ipcRenderer } = window.require('electron')` (no import)
- API calls: use `ipcRenderer.invoke()` on channels `musicApi:getAudioUrl`, `musicApi:searchSongs`, `musicApi:getNeteaseHotlist`, `musicApi:getQQHotlist`
- **DnD**: `@dnd-kit/core` + `@dnd-kit/sortable` for drag-and-drop reordering
- **Virtual scroll**: `@tanstack/react-virtual` (`SongListVirtual`, threshold 30 items)

## System Tray
- `src/main/tray/trayManager.ts` — `TrayManager` class with 16x16 canvas icon
- IPC from renderer: `tray:state` — send `{ songName, artist, isPlaying }` to update tray tooltip/menu
- IPC to renderer: `tray:action` — receive `{ type: 'playPause' | 'prev' | 'next' }` from tray menu clicks

## Global Shortcuts
- Registered in `src/main/main.ts` via `globalShortcut.register()`
- Media keys: `MediaPlayPause`, `MediaNextTrack`, `MediaPreviousTrack`
- Custom: `CommandOrControl+Alt+Space` (play/pause), `CommandOrControl+Alt+Right` (next), `CommandOrControl+Alt+Left` (prev)
- Forwarded to renderer via IPC channel `shortcut:action` — handles in `src/renderer/hooks/useGlobalShortcuts.ts`

## Song Deduplication
- `src/renderer/utils/songDedupe.ts` — `checkDuplicate()` / `filterDuplicates()` / `dedupeSongs()`
- Statuses: `'duplicate'` (same name+source), `'nameConflict'` (same name, diff source), `'ok'`
- Used by playlist add, queue add, batch operations

## API Config
1. **User Settings**: Settings → API Settings → URL → Save → Restart
2. **Dev**: `.env.local` → `MUSIC_API_URL=https://your-api-server.com/`
Never commit API URLs to Git.

## Audio Caching
First play downloads to `cache/audio/` (max 10). Subsequent plays use cache. Methods: `getAudioCache()`, `setAudioCache()`, `trimAudioCache(keepCount)`

## Download
Custom path in Settings. Progress via IPC: `download:progress`, `download:complete`, `download:error`. Default: system Downloads folder.
