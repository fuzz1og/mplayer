# Codebase Abstraction Refactoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce code duplication and introduce consistent abstractions across IPC handlers, renderer services, cache layer, and singleton patterns.

**Architecture:** 6 independent modules, implemented in dependency order. Each module is self-contained and verified before moving to the next.

**Tech Stack:** Electron, TypeScript, React, Zustand, Axios, Vitest

**Verification:** After each task:
```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
```

---

## File Map

| File | Status | Responsibility |
|------|--------|---------------|
| `src/shared/utils/singleton.ts` | **CREATE** | Unified singleton factory |
| `src/main/api/memoryCacheManager.ts` | MODIFY | Generic getCache/setCache methods |
| `src/main/ipc/registerHandler.ts` | **CREATE** | Auto-wrapping IPC handler registrar |
| `src/main/main.ts` | MODIFY | Replace ipcMain.handle with registerIpcHandler |
| `src/main/services/downloadService.ts` | MODIFY | Remove self-registered IPC handlers |
| `src/renderer/services/IpcClient.ts` | **CREATE** | Base IPC client for renderer |
| `src/renderer/services/cacheService.ts` | MODIFY | Use IpcClient |
| `src/renderer/services/favoriteService.ts` | MODIFY | Use IpcClient |
| `src/renderer/services/historyService.ts` | MODIFY | Use IpcClient |
| `src/renderer/services/playlistService.ts` | MODIFY | Use IpcClient |
| `src/renderer/services/lyricsService.ts` | MODIFY | Use IpcClient |
| `src/renderer/services/searchService.ts` | MODIFY | Use IpcClient |
| `src/renderer/store/localStore.ts` | MODIFY | Use localService instead of raw ipcRenderer |
| `src/renderer/store/playerStore.ts` | MODIFY | Use IpcClient instead of raw ipcRenderer |
| `src/renderer/store/favoriteStore.ts` | MODIFY | Use IpcClient instead of raw ipcRenderer |
| `src/renderer/utils/songResolver.ts` | **CREATE** | Reusable search-by-name+artist utility |
| `src/renderer/hooks/useDownload.ts` | **CREATE** | Reusable download hook |
| `src/renderer/pages/DiscoverPage.tsx` | MODIFY | Use useDownload + IpcClient |
| `src/renderer/pages/FavoritesPage.tsx` | MODIFY | Use useDownload + IpcClient |
| `src/renderer/pages/HistoryPage.tsx` | MODIFY | Use useDownload + IpcClient |
| `src/renderer/pages/PlaylistDetailPage.tsx` | MODIFY | Use useDownload + songResolver + IpcClient |
| `src/renderer/pages/HotlistDetailPage.tsx` | MODIFY | Use IpcClient |

All files are at `D:\Playground\music-player\mplayer\`

---

### Task 1: Singleton Utility

**Files:**
- Create: `src/shared/utils/singleton.ts`

- [ ] **Step 1: Create singleton utility**

Create `src/shared/utils/singleton.ts`:
```typescript
const instances = new Map<string, unknown>();

export function singleton<T>(key: string, factory: () => T): T {
  if (!instances.has(key)) {
    instances.set(key, factory());
  }
  return instances.get(key) as T;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run typecheck && npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/utils/singleton.ts
git commit -m "feat: add singleton utility"
```

---

### Task 2: Refactor memoryCacheManager with Generic Methods

**Files:**
- Modify: `src/main/api/memoryCacheManager.ts`

- [ ] **Step 1: Add generic getCache/setCache methods, widen hotlist types**

Read the file first. Then apply these changes:

Change `getHotlistCache(type: 'netease' | 'qq')` to `getHotlistCache(type: string)`:
```
oldString: getHotlistCache(type: 'netease' | 'qq'): any[] | null {
    const key = this.generateKey('hotlist', type);
    return this.get<any[]>(key);
  }

  setHotlistCache(type: 'netease' | 'qq', data: any[]): void {
    const key = this.generateKey('hotlist', type);
    this.set(key, data, this.defaultExpirations.hotlist);
  }
```

```
newString: getHotlistCache(type: string): any[] | null {
    const key = this.generateKey('hotlist', type);
    return this.get<any[]>(key);
  }

  setHotlistCache(type: string, data: any[]): void {
    const key = this.generateKey('hotlist', type);
    this.set(key, data, this.defaultExpirations.hotlist);
  }
```

- [ ] **Step 2: Verify build**

Run: `npm run typecheck && npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/api/memoryCacheManager.ts
git commit -m "refactor: widen hotlist cache types to string"
```

---

### Task 3: Create registerIpcHandler and Refactor main.ts + downloadService

**Files:**
- Create: `src/main/ipc/registerHandler.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/services/downloadService.ts`

- [ ] **Step 1: Create `src/main/ipc/registerHandler.ts`**

```typescript
import { ipcMain } from 'electron';
import type { ApiResponse } from '@/shared/types/ipc';

type AsyncHandler<T, A extends any[]> = (...args: A) => Promise<T>;

export function registerIpcHandler<T, A extends any[] = []>(
  channel: string,
  handler: AsyncHandler<T, A>
): void {
  ipcMain.handle(channel, async (_event, ...args: A): Promise<ApiResponse<T>> => {
    try {
      const data = await handler(...args);
      return { success: true, data };
    } catch (error) {
      console.error(`[IPC] ${channel} 失败:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  });
}

export function registerIpcHandlerSimple<T, A extends any[] = []>(
  channel: string,
  handler: (...args: A) => T
): void {
  ipcMain.handle(channel, (_event, ...args: A) => {
    return handler(...args);
  });
}
```

The `registerIpcHandlerSimple` variant is for handlers that return data directly without `{success, error}` wrapping (e.g., cache handlers that return raw data).

- [ ] **Step 2: Read `src/main/main.ts` fully**

Read `src/main/main.ts` to identify all IPC handlers that need replacement.

- [ ] **Step 3: Replace cache IPC handlers in main.ts**

Replace all 10 `ipcMain.handle('cache:*', ...)` blocks with:
```typescript
import { registerIpcHandlerSimple } from './ipc/registerHandler';

registerIpcHandlerSimple('cache:getSong', (keyword: string) => getCacheManager().getSongCache(keyword));
registerIpcHandlerSimple('cache:setSong', (keyword: string, songs: any[]) => getCacheManager().setSongCache(keyword, songs));
registerIpcHandlerSimple('cache:getCover', (coverUrl: string) => getCacheManager().getCoverCache(coverUrl));
registerIpcHandlerSimple('cache:setCover', (coverUrl: string, imageData: Buffer) => getCacheManager().setCoverCache(coverUrl, imageData));
registerIpcHandlerSimple('cache:getAudio', (audioUrl: string) => getCacheManager().getAudioCache(audioUrl));
registerIpcHandlerSimple('cache:setAudio', (audioUrl: string, audioData: Buffer) => getCacheManager().setAudioCache(audioUrl, audioData));
registerIpcHandlerSimple('cache:getUrl', (songId: string) => getCacheManager().getUrlCache(songId));
registerIpcHandlerSimple('cache:setUrl', (songId: string, urlData: any) => getCacheManager().setUrlCache(songId, urlData));
registerIpcHandlerSimple('cache:clear', () => getCacheManager().clearAllCache());
registerIpcHandlerSimple('cache:getStats', () => getCacheManager().getCacheStats());
```

- [ ] **Step 4: Replace favorite IPC handlers in main.ts**

```typescript
registerIpcHandler('favorite:add', (song: any) => db.addFavorite(song));
registerIpcHandler('favorite:remove', (songId: string) => db.removeFavorite(songId));
registerIpcHandler('favorite:isFavorite', (songId: string) => db.isFavorite(songId));
registerIpcHandler('favorite:getAll', () => db.getFavorites());
```

(Note: these use `registerIpcHandler` with try/catch wrapping since they may fail)

- [ ] **Step 5: Replace history IPC handlers in main.ts**

```typescript
registerIpcHandler('history:add', (song: any) => db.addToPlayHistory(song));
registerIpcHandler('history:get', (limit?: number) => db.getPlayHistory(limit));
registerIpcHandler('history:clear', () => db.clearPlayHistory());
registerIpcHandler('history:remove', (songId: string) => db.removeFromPlayHistory(songId));
```

- [ ] **Step 6: Replace playlist IPC handlers in main.ts**

```typescript
registerIpcHandler('playlist:create', (name: string, description?: string) => db.createPlaylist(name, description));
registerIpcHandler('playlist:getAll', () => db.getPlaylists());
registerIpcHandler('playlist:get', (playlistId: number) => db.getPlaylist(playlistId));
registerIpcHandler('playlist:update', (playlistId: number, playlist: any) => db.updatePlaylist(playlistId, playlist));
registerIpcHandler('playlist:delete', (playlistId: number) => db.deletePlaylist(playlistId));
registerIpcHandler('playlist:addSong', (playlistId: number, song: any) => db.addSongToPlaylist(playlistId, song));
registerIpcHandler('playlist:removeSong', (playlistId: number, songId: string) => db.removeSongFromPlaylist(playlistId, songId));
registerIpcHandler('playlist:getSongs', (playlistId: number) => db.getPlaylistSongs(playlistId));
registerIpcHandler('playlist:updateSongsOrder', (playlistId: number, songId: string, order: number) => db.updatePlaylistSongOrder(playlistId, songId, order));
registerIpcHandler('playlist:reorderFull', (playlistId: number, songIds: string[]) => db.reorderSongIds(playlistId, songIds));
```

- [ ] **Step 7: Replace lyrics + musicApi handlers in main.ts**

```typescript
registerIpcHandler('lyrics:get', (lrcUrl: string) => musicApi.getLyrics(lrcUrl));
registerIpcHandler('musicApi:getAudioUrl', (audioUrl: string) => musicApi.getAudioUrl(audioUrl));
registerIpcHandler('musicApi:searchSongs', (keyword: string, page: number, sourceType: string) => musicApi.searchSongs(keyword, page, sourceType));
registerIpcHandler('musicApi:getNeteaseHotlist', () => musicApi.getNeteaseHotlist());
registerIpcHandler('musicApi:getQQHotlist', () => musicApi.getQQHotlist());
```

Note: the original `searchSongs` handler used `'netease' | 'qq' | 'kugou'` type — change to `string` for flexibility.

- [ ] **Step 8: Replace localMusic handlers in main.ts**

```typescript
registerIpcHandler('localMusic:addFolder', async (folderPath: string) => {
  const result = await getLocalMusicService().addFolder(folderPath);
  getLocalMusicService().startWatching(folderPath, (type, songs, songIds) => {
    mainWindow.webContents.send('localMusic:folderChanged', {
      type, folderPath, songs, songIds,
    });
  });
  return result;
});
registerIpcHandler('localMusic:removeFolder', (folderPath: string) => getLocalMusicService().removeFolder(folderPath));
registerIpcHandler('localMusic:getFolders', () => getLocalMusicService().getFolders());
registerIpcHandler('localMusic:getSongs', (folderPath?: string) => getLocalMusicService().getSongs(folderPath));
registerIpcHandler('localMusic:refresh', async () => {
  await getLocalMusicService().refresh();
  const folders = await getLocalMusicService().getFolders();
  const songs = await getLocalMusicService().getSongs();
  return { folders, songs };
});
```

- [ ] **Step 9: Replace settings IPC handlers in main.ts**

```typescript
registerIpcHandlerSimple('settings:getDownloadPath', () => downloadService.getDownloadPath());
registerIpcHandler('settings:setDownloadPath', async (path: string) => {
  downloadService.updateDownloadPath(path);
  await db.setSetting('downloadPath', path);
});
registerIpcHandler('settings:resetDownloadPath', async () => {
  const defaultPath = app.getPath('downloads');
  downloadService.updateDownloadPath(defaultPath);
  await db.setSetting('downloadPath', defaultPath);
  return { path: defaultPath };
});
registerIpcHandlerSimple('settings:getApiUrl', () => db.getSetting('apiUrl') || '');
registerIpcHandler('settings:setApiUrl', (url: string) => db.setSetting('apiUrl', url));
registerIpcHandlerSimple('settings:getProxy', async () => {
  const saved = await db.getSetting<ProxyConfig>('proxyConfig');
  return saved || { enabled: false, host: '', port: 8080, protocol: 'http' };
});
registerIpcHandler('settings:setProxy', async (proxyConfig: ProxyConfig) => {
  await db.setSetting('proxyConfig', proxyConfig);
  const apiClient = getApiClient();
  updateApiClientAgents(apiClient, proxyConfig);
  applyElectronProxy(proxyConfig);
});
registerIpcHandlerSimple('dialog:openDirectory', () => dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }));
registerIpcHandlerSimple('app:quit', () => app.exit());
```

- [ ] **Step 10: Remove `setupIPC` function call and inline registrations**

After all replacements, remove the entire `function setupIPC(mainWindow: BrowserWindow)` function definition and its call at line 506. The registrations that need `mainWindow` (like `localMusic:addFolder`) capture it via closure or use `BrowserWindow.getAllWindows()`.

For `localMusic:addFolder` which needs `mainWindow`, we need to keep `mainWindow` accessible. Either:
- Register it inside `app.whenReady()` after `mainWindow` is created (inline, not in a separate function), or
- Use `BrowserWindow.getAllWindows()[0]` as a fallback

Simplest approach: keep the `localMusic:addFolder` and `localMusic:refresh` registrations inline in `app.whenReady()` where `mainWindow` is in scope. All other registrations can happen before or after.

- [ ] **Step 11: Refactor downloadService to remove self-registration**

Read `src/main/services/downloadService.ts`. Remove the `setupIpcHandlers()` method and its call in `initialize()`. Move those 5 handlers to `main.ts` using `registerIpcHandler`:

```typescript
registerIpcHandler('download:start', (song: Song) => downloadService.addDownload(song));
registerIpcHandler('download:startBatch', (songs: Song[]) => downloadService.addBatchDownloads(songs));
registerIpcHandler('download:cancel', (taskId: string) => downloadService.cancelDownload(taskId));
registerIpcHandlerSimple('download:getTasks', () => downloadService.getAllTasks());
registerIpcHandlerSimple('download:clearCompleted', () => downloadService.clearCompleted());
```

In `downloadService.ts`, remove `ipcMain` import, `setupIpcHandlers()` method, and its call in `initialize()`.

- [ ] **Step 12: Remove unused imports in main.ts**

After the refactoring, remove the `ipcMain` import if it's no longer used directly (it may still be used for `tray:state`, `tray:action`, and `ipc:ack` — check first).

- [ ] **Step 13: Verify build**

Run: `npm run typecheck && npm run build`
Expected: No errors.

- [ ] **Step 14: Commit**

```bash
git add src/main/ipc/registerHandler.ts src/main/main.ts src/main/services/downloadService.ts
git commit -m "refactor: add registerIpcHandler, consolidate IPC registration into main.ts"
```

---

### Task 4: Create IpcClient and Refactor Renderer Services

**Files:**
- Create: `src/renderer/services/IpcClient.ts`
- Modify: `src/renderer/services/cacheService.ts`
- Modify: `src/renderer/services/favoriteService.ts`
- Modify: `src/renderer/services/historyService.ts`
- Modify: `src/renderer/services/playlistService.ts`
- Modify: `src/renderer/services/lyricsService.ts`
- Modify: `src/renderer/services/searchService.ts`

- [ ] **Step 1: Create `src/renderer/services/IpcClient.ts`**

```typescript
const { ipcRenderer } = window.require('electron');

export class IpcClient {
  static async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const result = await ipcRenderer.invoke(channel, ...args);
    if (result && typeof result === 'object' && 'success' in result) {
      if (!result.success) {
        throw new Error(result.error || `${channel} 失败`);
      }
      return result.data as T;
    }
    return result as T;
  }
}
```

- [ ] **Step 2: Read all 6 service files**

Read each service file fully.

- [ ] **Step 3: Refactor `cacheService.ts`**

Replace `const { ipcRenderer } = window.require('electron');` with `import { IpcClient } from './IpcClient';`. Replace all `ipcRenderer.invoke(...)` with `IpcClient.invoke(...)`. Remove try/catch wrappers (errors propagate).

- [ ] **Step 4: Refactor `favoriteService.ts`**

Same pattern: replace `ipcRenderer` import with `IpcClient`, replace all `.invoke()` calls. Remove try/catch if present.

- [ ] **Step 5: Refactor `historyService.ts`**

Same pattern.

- [ ] **Step 6: Refactor `playlistService.ts`**

Same pattern.

- [ ] **Step 7: Refactor `lyricsService.ts`**

Same pattern. Replace:
```typescript
const { ipcRenderer } = window.require('electron');
```
with:
```typescript
import { IpcClient } from './IpcClient';
```

And replace `ipcRenderer.invoke('lyrics:get', lrcUrl)` with `IpcClient.invoke<string>('lyrics:get', lrcUrl)`. The try/catch returning `''` on error can remain or be removed — the caller handles fallback.

- [ ] **Step 8: Refactor `searchService.ts`**

Replace raw `ipcRenderer.invoke('musicApi:searchSongs', ...)` with `IpcClient.invoke<Song[]>('musicApi:searchSongs', ...)`.

- [ ] **Step 9: Verify build**

Run: `npm run typecheck && npm run build`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/services/IpcClient.ts src/renderer/services/cacheService.ts src/renderer/services/favoriteService.ts src/renderer/services/historyService.ts src/renderer/services/playlistService.ts src/renderer/services/lyricsService.ts src/renderer/services/searchService.ts
git commit -m "refactor: add IpcClient, unify renderer service layer"
```

---

### Task 5: Refactor Stores to Use Service Layer

**Files:**
- Modify: `src/renderer/store/localStore.ts`
- Modify: `src/renderer/store/playerStore.ts`
- Modify: `src/renderer/store/favoriteStore.ts`

- [ ] **Step 1: Read all 3 store files**

Read each store fully.

- [ ] **Step 2: Refactor `localStore.ts`**

Add import: `import { IpcClient } from '@/renderer/services/IpcClient';`
Remove: `const { ipcRenderer } = window.require('electron');` line.
Replace all `ipcRenderer.invoke('localMusic:*', ...)` with `IpcClient.invoke(...)`.

- [ ] **Step 3: Refactor `playerStore.ts`**

Add import: `import { IpcClient } from '@/renderer/services/IpcClient';`
The `const { ipcRenderer } = window.require('electron');` line is also used for `tray:state` at line 444 (`tray:state` uses `.send()` not `.invoke()`). So keep the ipcRenderer import but also add IpcClient.

Replace:
- `ipcRenderer.invoke('musicApi:getAudioUrl', ...)` → `IpcClient.invoke<string>('musicApi:getAudioUrl', ...)`
- `ipcRenderer.invoke('musicApi:searchSongs', ...)` → `IpcClient.invoke<Song[]>('musicApi:searchSongs', ...)`
- `ipcRenderer.invoke('history:add', ...)` → `IpcClient.invoke('history:add', ...)`

The `tray:state` `ipcRenderer.send(...)` calls remain unchanged.

- [ ] **Step 4: Refactor `favoriteStore.ts`**

Replace `ipcRenderer.invoke('musicApi:searchSongs', ...)` with `IpcClient.invoke(...)`.

- [ ] **Step 5: Verify build**

Run: `npm run typecheck && npm run build`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store/localStore.ts src/renderer/store/playerStore.ts src/renderer/store/favoriteStore.ts
git commit -m "refactor: use IpcClient in stores instead of raw ipcRenderer"
```

---

### Task 6: Create songResolver Utility

**Files:**
- Create: `src/renderer/utils/songResolver.ts`
- Modify: `src/renderer/store/playerStore.ts`
- Modify: `src/renderer/store/favoriteStore.ts`
- Modify: `src/renderer/pages/PlaylistDetailPage.tsx`

- [ ] **Step 1: Create `src/renderer/utils/songResolver.ts`**

```typescript
import { IpcClient } from '@/renderer/services/IpcClient';
import type { Song } from '@/shared/types/song';

export async function resolveSongUrls(
  name: string,
  artist: string,
  sourceType: string
): Promise<Song[]> {
  const songs = await IpcClient.invoke<Song[]>('musicApi:searchSongs', `${name} ${artist}`, 1, sourceType);
  return songs ?? [];
}
```

- [ ] **Step 2: Read `playerStore.ts` lines 176-196**

In `playerStore.ts`, replace the inline IPC invoke for lyrics search:
```typescript
// Before:
const result = await ipcRenderer.invoke('musicApi:searchSongs', `${song.name} ${song.artist}`, 1, song.sourceType);
if (result.success && result.data.length > 0) {
  const freshSong = result.data[0];
  ...

// After:
const resolveResult = await resolveSongUrls(song.name, song.artist, song.sourceType);
if (resolveResult.length > 0) {
  const freshSong = resolveResult[0];
  ...
```

Add import: `import { resolveSongUrls } from '@/renderer/utils/songResolver';`

- [ ] **Step 3: Read `favoriteStore.ts`**

Find the `refreshSongUrls` method (or similar). Replace inline `ipcRenderer.invoke('musicApi:searchSongs', ...)` with `resolveSongUrls(...)`.

Add import: `import { resolveSongUrls } from '@/renderer/utils/songResolver';`

- [ ] **Step 4: Read `PlaylistDetailPage.tsx`**

Find the song search logic (around lines 112-137). Replace with `resolveSongUrls(...)`.

- [ ] **Step 5: Verify build**

Run: `npm run typecheck && npm run build`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/utils/songResolver.ts src/renderer/store/playerStore.ts src/renderer/store/favoriteStore.ts src/renderer/pages/PlaylistDetailPage.tsx
git commit -m "feat: add resolveSongUrls utility, deduplicate search logic"
```

---

### Task 7: Create useDownload Hook

**Files:**
- Create: `src/renderer/hooks/useDownload.ts`
- Modify: `src/renderer/pages/DiscoverPage.tsx`
- Modify: `src/renderer/pages/FavoritesPage.tsx`
- Modify: `src/renderer/pages/HistoryPage.tsx`
- Modify: `src/renderer/pages/PlaylistDetailPage.tsx`
- Modify: `src/renderer/pages/HotlistDetailPage.tsx`

- [ ] **Step 1: Create `src/renderer/hooks/useDownload.ts`**

```typescript
import { useCallback } from 'react';
import { useDownloadStore } from '@/renderer/store/downloadStore';
import { IpcClient } from '@/renderer/services/IpcClient';
import type { Song } from '@/shared/types/song';

export function useDownload() {
  const { addSingleDownload, addBatchDownload } = useDownloadStore();

  const download = useCallback(async (song: Song) => {
    try {
      const task = await IpcClient.invoke('download:start', song);
      if (task) addSingleDownload(task);
    } catch (error) {
      console.error('下载失败:', error);
    }
  }, [addSingleDownload]);

  const downloadBatch = useCallback(async (songs: Song[]) => {
    try {
      const tasks = await IpcClient.invoke('download:startBatch', songs);
      if (tasks?.length) addBatchDownload(tasks);
    } catch (error) {
      console.error('批量下载失败:', error);
    }
  }, [addBatchDownload]);

  return { download, downloadBatch, addSingleDownload, addBatchDownload };
}
```

- [ ] **Step 2: Read each page file**

Read DiscoverPage.tsx, FavoritesPage.tsx, HistoryPage.tsx, PlaylistDetailPage.tsx, HotlistDetailPage.tsx to find download handler patterns.

- [ ] **Step 3: Refactor DiscoverPage.tsx**

Replace the inline `handleDownload` and `handleBatchDownload` functions with:
```typescript
import { useDownload } from '@/renderer/hooks/useDownload';
// ... inside component:
const { download, downloadBatch } = useDownload();
```
Replace all references to the old handlers.

- [ ] **Step 4: Refactor remaining pages**

Same pattern for FavoritesPage.tsx, HistoryPage.tsx, PlaylistDetailPage.tsx, HotlistDetailPage.tsx.

- [ ] **Step 5: Verify build**

Run: `npm run typecheck && npm run build`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/hooks/useDownload.ts src/renderer/pages/DiscoverPage.tsx src/renderer/pages/FavoritesPage.tsx src/renderer/pages/HistoryPage.tsx src/renderer/pages/PlaylistDetailPage.tsx src/renderer/pages/HotlistDetailPage.tsx
git commit -m "feat: add useDownload hook, deduplicate download logic across pages"
```

---

### Task 8: Full Lint and Test Pass

- [ ] **Step 1: Run full verification**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
```

Expected: All pass with 0 errors/warnings.

- [ ] **Step 2: Fix any issues**

If any lint/type errors, fix them.

- [ ] **Step 3: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: address lint and typecheck issues"
```
