# AGENTS.md

## Commands
```bash
npm run dev             # Vite dev server (port 5173)
npm run electron:dev    # Full Electron app
npm run build           # tsc && vite build
npm run electron:build  # Package with electron-builder
npm run lint            # ESLint (--max-warnings 0)
npm run typecheck       # tsc --noEmit
npm run test:run        # vitest single run
```

## Build Order
`lint -> typecheck -> test:run -> build`

## Architecture
- **Main**: `src/main/` — Electron entry, IPC, HTTP client, cache, storage, download
- **Renderer**: `src/renderer/` — React + Zustand, state-driven navigation
- **Shared**: `src/shared/types/` — TypeScript types
- **Alias**: `@/` → `src/`
- **Electron**: `contextIsolation: false`, `nodeIntegration: true`, 1400x900, `titleBarStyle: hiddenInset`

## Conventions
- UI: Ant Design 5 (zhCN), icons: lucide-react
- IPC: `domain:action` naming
- **ipcRenderer**: `const { ipcRenderer } = window.require('electron')` (no import)
- API calls: use `ipcRenderer.invoke()` on channels `musicApi:getAudioUrl`, `musicApi:searchSongs`, `musicApi:getNeteaseHotlist`, `musicApi:getQQHotlist`

## API Config
1. **User Settings**: Settings → API Settings → URL → Save → Restart
2. **Dev**: `.env.local` → `MUSIC_API_URL=https://your-api-server.com/`
Never commit API URLs to Git.

## Audio Caching
First play downloads to `cache/audio/` (max 10). Subsequent plays use cache. Methods: `getAudioCache()`, `setAudioCache()`, `trimAudioCache(keepCount)`

## Download
Custom path in Settings. Progress via IPC: `download:progress`, `download:complete`, `download:error`. Default: system Downloads folder.
