# AGENTS.md

## Commands
```bash
npm run dev              # Vite dev server (renderer only, port 5173)
npm run electron:dev    # Full Electron app (dev server + electron)
npm run build            # tsc && vite build
npm run electron:build   # Build + package with electron-builder
npm run electron:build:win   # Build for Windows
npm run electron:build:mac   # Build for macOS
npm run electron:build:linux # Build for Linux
npm run lint             # ESLint --max-warnings 0
npm run typecheck        # tsc --noEmit
```

## Build Order
`lint -> typecheck -> build` (run lint/typecheck before build)

## Architecture
- **Main process**: `src/main/` - Electron entry, IPC handlers, HTTP client, cache (disk + memory), storage, download service
- **Renderer**: `src/renderer/` - React + Zustand stores, no React Router (state-driven navigation)
- **Shared**: `src/shared/types/` - TypeScript types
- **Path alias**: `@/` maps to `src/`
- **Electron config**: `contextIsolation: false`, `nodeIntegration: true`, window 1400x900, titleBarStyle: hiddenInset

## Key Conventions
- UI: Ant Design 5 with Chinese locale (`zhCN`)
- Icons: lucide-react
- IPC channels: `domain:action` naming (e.g., `cache:getSong`, `settings:setDownloadPath`)

## API Configuration
The app requires an external music API. Two ways to configure:

1. **User (Settings Page)**: Settings → API Settings → Enter URL → Save → Restart (Highest Priority)
2. **Development**: Create `.env.local` in project root:
   ```
   MUSIC_API_URL=https://your-api-server.com/
   ```

**Never commit API URLs to Git**. `.env.local` is in `.gitignore`.

## Audio Caching
- On first play: audio file downloaded to `cache/audio/` (max 10 recent songs)
- Subsequent plays: use cached file
- Methods: `getAudioCache()`, `setAudioCache()`, `trimAudioCache(keepCount)`

## Download Functionality
- Custom download path configurable in Settings
- Progress tracking via IPC: `download:progress`, `download:complete`, `download:error`
- Default: system Downloads folder