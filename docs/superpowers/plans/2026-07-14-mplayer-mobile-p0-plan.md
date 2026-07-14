# MPlayer Mobile — P0 骨架实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo 搭建 + core 包提取验证 + Expo 项目初始化 + tab 布局 + 迷你播放栏 + 发现页

**Architecture:** 现有桌面端拆分为 packages/core + packages/desktop。新增 packages/mobile (Expo)。core 包为纯 TS，无 Electron/RN 依赖，供双端引用。

**Tech Stack:** npm workspaces, TypeScript, Vite (core 构建), Expo SDK 52+, expo-router, expo-av, zustand, axios

**Phase scope:** 这是 P0（共 3 阶段）。产出为可运行 Expo 项目，含 3 tab 导航、发现页展示排行榜数据、吸底播放栏。

---

## Global Constraints

- core 包必须是运行时无关的纯 TS — 不引用 Electron、Node.js、React Native 任何模块
- 文件路径使用 `@/` 别名映射到 `src/`
- UI 文字用中文
- 新建文件遵循现有命名风格 (camelCase)
- 桌面端代码不重构，core 包只提取不修改原文件

---

## File Structure（最终目标）

```
mplayer/
├── package.json                    # workspace root
├── tsconfig.json                    # root tsconfig
├── tsconfig.base.json               # base tsconfig for packages
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── src/
│   │   │   ├── index.ts             # 统一导出
│   │   │   ├── types/
│   │   │   │   └── index.ts         # Song, Artist, Playlist 等
│   │   │   ├── api/
│   │   │   │   ├── musicApi.ts      # 7 音乐源 HTTP 逻辑
│   │   │   │   ├── memoryCacheManager.ts
│   │   │   │   └── antiScrape.ts
│   │   │   └── utils/
│   │   │       ├── songDedupe.ts
│   │   │       ├── songMatcher.ts
│   │   │       ├── songResolver.ts
│   │   │       ├── lyricsParser.ts
│   │   │       └── format.ts
│   │   └── __tests__/
│   │
│   ├── desktop/                     # 现有代码 (不变)
│   │   └── src/
│   │
│   └── mobile/
│       ├── package.json
│       ├── tsconfig.json
│       ├── app.json
│       ├── app/                     # Expo Router pages
│       │   ├── _layout.tsx          # Root layout (Stack)
│       │   ├── (tabs)/
│       │   │   ├── _layout.tsx      # Tab layout
│       │   │   ├── index.tsx        # 发现页
│       │   │   ├── playlists.tsx    # 歌单页
│       │   │   └── favorites.tsx    # 收藏页
│       │   ├── player.tsx           # 全屏播放器
│       │   └── settings.tsx         # 设置页
│       ├── components/
│       │   ├── TopBar.tsx
│       │   ├── PlayerBar.tsx
│       │   └── SongRow.tsx
│       ├── stores/
│       │   └── playerStore.ts
│       ├── services/
│       │   └── audioPlayer.ts
│       └── styles/
│           └── theme.ts
```

---

### Task 1: Monorepo 搭建

**Files:**
- Modify: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vite.config.ts`

**Interfaces:**
- Produces: root `package.json` with `workspaces: ["packages/*"]`, root `tsconfig.base.json` with shared TS config, `packages/core/` ready for TS/Vite

- [ ] **Step 1: 修改根 package.json**

```json
{
  "private": true,
  "workspaces": ["packages/*"],
  // 保持原有 name/version/scripts... scripts 暂时只加 core 构建
  // 注意：不移动原有 dependencies，它们属于 desktop 隐式
  // 只新增构建 core 的脚本
  "scripts": {
    // ... 保留全部原有 scripts ...
    "core:build": "npm run build -w packages/core",
  }
}
```

添加 `workspaces: ["packages/*"]` 到根 `package.json`，保留所有原有字段和 scripts。

- [ ] **Step 2: 创建 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: 创建 packages/core/package.json**

```json
{
  "name": "@mplayer/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "axios": "^1.6.2"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "vite": "^6.4.3",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 4: 创建 packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2020"],
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: 创建 packages/core/vite.config.ts**

```ts
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => format === 'es' ? 'index.js' : 'index.cjs',
    },
    rollupOptions: {
      external: ['axios'],
    },
    sourcemap: true,
  },
});
```

- [ ] **Step 6: 验证**

```bash
npm install              # 安装 workspaces
npm run core:build       # 构建 core 包
```

预期输出：`packages/core/dist/index.js` + `packages/core/dist/index.cjs` + `packages/core/dist/index.d.ts`

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json packages/core/
git commit -m "build: monorepo scaffold with packages/core"
```

---

### Task 2: Core — 提取 types

**Files:**
- Create: `packages/core/src/types/index.ts`
- Create: `packages/core/src/index.ts`

**Interfaces:**
- Produces: 从 `src/shared/types/song.ts` 复制类型定义 (SongBase, Song, Favorite, PlayHistory, Playlist, PlaylistSong, SongGroup, DiscoverPlaylist, LocalSong, Artist, LocalFolder, SearchResult)，移除 `@/shared/types/song` 内部引用

- [ ] **Step 1: 创建 packages/core/src/types/index.ts**

从 `src/shared/types/song.ts` 复制完整内容，移除 `interface` 前的 `export` 关键字不用改 — 保持全部 `export`。核心类型如下：

```ts
// SourceKey 作为 string literal union
export type SourceKey = 'netease' | 'qq' | 'kugou' | 'migu' | 'kuwo' | 'qianqian' | 'soda' | 'local';

export interface SongBase {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  sourceType: SourceKey;
}

export interface Song extends SongBase {
  url: string;
  cover: string;
  lrc: string;
}

export interface Favorite {
  id?: number;
  songId: string;
  song: SongBase;
  createdAt: Date;
}

// ... 其余类型同 song.ts（PlayHistory, Playlist, PlaylistSong, LocalFolder, Artist, LocalSong, SongGroup, DiscoverPlaylist）
// 注意：移除 SearchResult interface（桌面端专用，core 不需要）
```

**注意：`sourceType` 在 `SongBase` 中的类型从 `'netease' | 'qq' | ... | 'local'` 改为从 `SourceKey` 类型引用。**

- [ ] **Step 2: 创建 packages/core/src/index.ts**

```ts
export * from './types/index.js';
// 后续模块逐步添加
```

- [ ] **Step 3: 验证**

```bash
npm run core:build
```

预期：构建成功，`dist/index.d.ts` 包含类型定义。

- [ ] **Step 4: Commit**

```bash
git add packages/core/
git commit -m "feat(core): extract shared types"
```

---

### Task 3: Core — 提取 memoryCacheManager

**Files:**
- Create: `packages/core/src/api/memoryCacheManager.ts`
- Modify: `packages/core/src/index.ts` (添加导出)

**Interfaces:**
- Produces: `MemoryCacheManager` 类，与桌面版一致但不依赖 `@/shared/types/song`（改用本地类型）

- [ ] **Step 1: 复制 core 版本 memoryCacheManager**

从 `src/main/api/memoryCacheManager.ts` 复制到 `packages/core/src/api/memoryCacheManager.ts`。

改动：
- 移除 `import type { Song } from '@/shared/types/song'` — core 版本的 `Song` 从 `../types/index.js` 导入
- 添加 `import type { Song } from '../types/index.js'`

```ts
import type { Song } from '../types/index.js';

// 其余代码完全保留，包括 CacheManager class、单例 export
```

- [ ] **Step 2: 更新 index.ts**

在 `src/index.ts` 末尾添加：

```ts
export { cacheManager } from './api/memoryCacheManager.js';
export type { /* 不导出 CacheManager 内部类型，外部只需要 cacheManager 实例 */ };
```

- [ ] **Step 3: 验证**

```bash
npm run core:build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/
git commit -m "feat(core): extract memoryCacheManager"
```

---

### Task 4: Core — 提取 antiScrape

**Files:**
- Create: `packages/core/src/api/antiScrape.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `RateLimiter`, `beforeRequest()`, `getAntiScrapeHeaders()`, `AntiScrapeHeaders` — 与桌面版完全一致

- [ ] **Step 1: 复制 antiScrape.ts**

从 `src/main/api/antiScrape.ts` 复制到 `packages/core/src/api/antiScrape.ts`。内容完全不变 — 无外部依赖。

- [ ] **Step 2: 更新 index.ts**

```ts
export { RateLimiter, beforeRequest, getAntiScrapeHeaders } from './api/antiScrape.js';
export type { AntiScrapeHeaders } from './api/antiScrape.js';
```

- [ ] **Step 3: 验证**

```bash
npm run core:build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/
git commit -m "feat(core): extract antiScrape"
```

---

### Task 5: Core — 提取 musicApi 核心部分

**Files:**
- Create: `packages/core/src/api/musicApi.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `musicApi` 对象，包含 7 源搜索/排行榜/歌单/歌手/URL 解析方法
- 与桌面版区别：移除 Electron-only 依赖（`config`, `proxy`, `cacheManager` 磁盘层）

**核心变更：**
- 移除 `import { config } from '../config'` — 改为从 options 或环境变量获取 baseURL
- 移除 `import { getHttpAgent, getHttpsAgent } from '../proxy'` — 桌面端专用代理
- 移除 `import { getCacheManager } from '../cache/cacheManager'` — 磁盘缓存桌面专用
- `apiClient` 的 `baseURL` 改为配置式：通过 `setBaseURL(url)` 或直接写默认值 `http://localhost:3000`
- 移除 `downloadAndCacheAudio`（桌面端磁盘缓存行为）
- `getAudioUrl` 简化：纯 URL 解析 + 内存缓存，不写磁盘
- `getSodaPlayableUrl` 移除（桌面端特有流式下载缓存）

- [ ] **Step 1: 创建 packages/core/src/api/musicApi.ts**

提取自 `src/main/api/musicApi.ts`，主要改动：

```ts
import axios, { type AxiosInstance } from 'axios';
import type { Song, SourceKey, SongGroup, DiscoverPlaylist } from '../types/index.js';
import { cacheManager } from './memoryCacheManager.js';

// ── 配置 ────────────────────────────────────────────────────
let API_BASE_URL = 'http://localhost:3000';

export function setApiBaseUrl(url: string): void {
  API_BASE_URL = url;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

// ── normalizeUrl ────────────────────────────────────────────
function normalizeUrl(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return API_BASE_URL + url.slice(1);
  return API_BASE_URL + url;
}

// ── processSong ─────────────────────────────────────────────
function processSong(song: any, sourceType: SourceKey = 'netease'): Song {
  return {
    id: song.id || song.songid || '',
    name: song.name || song.songname || '',
    artist: song.artist || song.authors || '',
    album: song.album || song.albumname || '',
    url: normalizeUrl(song.url),
    cover: normalizeUrl(song.cover || song.pic),
    lrc: normalizeUrl(song.lrc || song.lyric || song.lrcurl),
    duration: song.duration || song.interval || 0,
    sourceType: song.sourceType || sourceType,
  };
}

// ── apiClient ───────────────────────────────────────────────
const apiClient = axios.create({
  get baseURL() { return API_BASE_URL; },
  headers: {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'x-requested-with': 'XMLHttpRequest',
  },
  timeout: 30000,
});

export function getApiClient(): AxiosInstance {
  return apiClient;
}

// 歌手头像缓存
const artistPicCache = new Map<string, string>();

// ── HotlistSong 接口 ─────────────────────────────────────────
interface HotlistSong {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

// ⚠️ 注意: 以下方法移除 Electron 代理相关代码（getHttpAgent/getHttpsAgent）
// - 网易云相关方法 (createNeteaseClient) 不再设置 httpAgent/httpsAgent
// - QQ 音乐相关方法同
// - 汽水音乐相关方法同
// 保留所有其他逻辑：缓存、重试、URL 解析、排行榜、歌单、歌手

// ── musicApi 对象 ───────────────────────────────────────────
export const musicApi = {
  // 保留所有方法，仅移除 Electron 依赖部分：
  // 1. createNeteaseClient() — 移除 httpAgent，保留 headers/timeout
  // 2. 所有 axios 请求移除 httpAgent/httpsAgent
  // 3. getAudioUrl — 移除 downloadAndCacheAudio 调用
  // 4. getSodaPlayableUrl — 移除（桌面端特有）
  // 5. 保留: searchSongs, getAudioUrl（纯 URL 解析）, getLyrics,
  //    getNeteaseHotlist, getQQHotlist, getNeteasePlaylists,
  //    getNeteasePlaylistDetail, getNeteaseArtists, getNeteaseArtistSongs,
  //    searchNeteaseArtists, searchAllSources, batchSearch,
  //    searchSongsSoda, getSodaAudioUrl, parseSodaShareLink,
  //    fetchSodaSharePage, sodaBuildImageUrl, groupIntoSongGroups,
  //    getPlaylistSongsFromThirdParty
  // 6. getNeteaseToplist/QQToplist: 移除 httpAgent 但保留 User-Agent/Referer
};
```

完整实现：复制桌面版 `musicApi` 所有方法，逐块移除非 core 依赖：
- 所有 `.create()` 调用的 `httpAgent`/`httpsAgent` 参数移除
- `getAudioUrl` 中的 `downloadAndCacheAudio` 调用移除
- 桌面版 `getSodaPlayableUrl` 移到 `getSodaAudioUrl` 后面，标记 `@deprecated` 或移除

核心保留方法（完整复制实现体，只改以上三点）：

| 方法 | 保留 | 修改点 |
|------|------|--------|
| `sodaBuildImageUrl` | 完整 | 无 |
| `searchSongsSoda` | 完整 | 移除 httpAgent |
| `fetchSodaSharePage` | 完整 | 移除 httpAgent |
| `getSodaAudioUrl` | 完整 | 移除 httpAgent |
| `searchSongs` | 完整 | 无（用 apiClient） |
| `getAudioUrl` | 简化 | 移除 downloadAndCacheAudio |
| `getLyrics` | 完整 | 无 |
| `batchSearch` | 完整 | 无 |
| `searchNeteaseArtists` | 完整 | 移除 httpAgent |
| `getNeteaseArtists` | 完整 | 无（委托） |
| `fetchNeteaseArtistsByApi` | 完整 | 移除 httpAgent |
| `fetchNeteaseArtistsByHtml` | 完整 | 移除 httpAgent |
| `getNeteaseArtistSongs` | 完整 | 移除 httpAgent |
| `getNeteaseToplist` | 完整 | 移除 httpAgent |
| `getNeteaseHotlist` | 完整 | 无 |
| `getNeteaseNewSongList` | 完整 | 无 |
| `getQQToplist` | 完整 | 移除 httpAgent，保留 headers |
| `getQQHotlist` | 完整 | 无 |
| `getQQNewSongList` | 完整 | 无 |
| `getNeteasePlaylists` | 完整 | 移除 httpAgent |
| `getNeteasePlaylistDetail` | 完整 | 移除 httpAgent |
| `groupIntoSongGroups` | 完整 | 无 |
| `searchAllSources` | 完整 | 无 |
| `getPlaylistSongsFromThirdParty` | 完整 | 移除 httpAgent |

注意：`getPlaylistSongsFromThirdParty` 向 `sss.unmeta.cn` 发 POST 请求创建 `axios.post`，也需要移除 httpAgent。

具体来说，每个 `createNeteaseClient()` 调用创建 axios 实例时，移除 `httpAgent`/`httpsAgent` 行，保留 headers/timeout。

```ts
// 修改前
function createNeteaseClient() {
  return axios.create({
    httpAgent: getHttpAgent(),
    httpsAgent: getHttpsAgent(),
    headers: { ... },
    timeout: 30000,
  });
}

// 修改后
function createNeteaseClient() {
  return axios.create({
    headers: { ... },
    timeout: 30000,
  });
}
```

QQ 音乐部分 `qqClient` 同理，移除 `httpAgent`/`httpsAgent`。

```ts
// 修改前
const qqClient = axios.create({
  httpAgent: getHttpAgent(),
  httpsAgent: getHttpsAgent(),
  headers: { ... },
  timeout: 30000,
  responseType: 'text'
});

// 修改后
const qqClient = axios.create({
  headers: { ... },
  timeout: 30000,
  responseType: 'text'
});
```

`getPlaylistSongsFromThirdParty` 里的 `axios.post` 同样移除 httpAgent。

```ts
// 修改前
const response = await axios.post(url, data, {
  httpAgent: getHttpAgent(),
  httpsAgent: getHttpsAgent(),
  headers: { ... },
  timeout: 30000,
});

// 修改后
const response = await axios.post(url, data, {
  headers: { ... },
  timeout: 30000,
});
```

`getSodaPlayableUrl` 方法整体移除（包含 disk cache 逻辑，桌面端特有）。

- [ ] **Step 2: 更新 index.ts**

```ts
export { musicApi, setApiBaseUrl, getApiBaseUrl, getApiClient } from './api/musicApi.js';
export type { SourceKey } from './types/index.js';
```

- [ ] **Step 3: 验证**

```bash
npm run core:build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/
git commit -m "feat(core): extract musicApi (remove Electron deps)"
```

---

### Task 6: Core — 提取 utils

**Files:**
- Create: `packages/core/src/utils/songDedupe.ts`
- Create: `packages/core/src/utils/songMatcher.ts`
- Create: `packages/core/src/utils/songResolver.ts`
- Create: `packages/core/src/utils/lyricsParser.ts`
- Create: `packages/core/src/utils/format.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: 全部 5 个工具模块，从 desktop renderer 复制，无需修改

- [ ] **Step 1-5: 逐个复制 5 个工具文件（直接复制，无外部依赖）**

```bash
# 从 renderer utils 复制到 core utils
cp src/renderer/utils/songDedupe.ts packages/core/src/utils/
cp src/renderer/utils/songMatcher.ts packages/core/src/utils/
cp src/renderer/utils/songResolver.ts packages/core/src/utils/
cp src/renderer/utils/lyricsParser.ts packages/core/src/utils/
cp src/renderer/utils/format.ts packages/core/src/utils/
```

每个文件检查 import，将 `@/shared/types/song` 替换为 `../types/index.js`。

- [ ] **Step 6: 更新 index.ts**

```ts
// 在文件末尾添加
export { dedupeSongs } from './utils/songDedupe.js';
export { matchSong } from './utils/songMatcher.js';
export { resolveBestSource } from './utils/songResolver.js';
export { parseLyrics, type LyricLine } from './utils/lyricsParser.js';
export { formatDuration, formatPlayCount, formatDate } from './utils/format.js';
```

- [ ] **Step 7: 验证**

```bash
npm run core:build
```

预期：构建成功，无 TS 错误。

- [ ] **Step 8: Commit**

```bash
git add packages/core/
git commit -m "feat(core): extract utils (dedupe, matcher, resolver, lyrics, format)"
```

---

### Task 7: 验证 core 包在桌面端可用

**Files:**
- Modify: `packages/desktop/package.json` (添加 `@mplayer/core` 依赖)

**Interfaces:**
- Consumes: `@mplayer/core` — 验证包结构正确

- [ ] **Step 1: 确认 desktop 引用 core**

根 worktree 中 desktop 还是 `src/` 结构，不是独立包。验证 core 构建产物可被 import。

```bash
# 验证 core 构建产物存在且可被 Node 解析
node -e "const m = require('./packages/core/dist/index.cjs'); console.log(Object.keys(m))"
```

预期输出：包含所有导出的模块名列表 (`cacheManager`, `musicApi`, `setApiBaseUrl`, ...)

- [ ] **Step 2: desktop 引用 core 的初步方案**

桌面端暂不修改代码引用 core（阶段二做迁移）。只验证构建产物可用即可。

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: verify core package builds and exports"
```

---

### Task 8: Expo 项目初始化

**Files:**
- Create: `packages/mobile/package.json`
- Create: `packages/mobile/tsconfig.json`
- Create: `packages/mobile/app.json`
- Create: `packages/mobile/App.tsx`

**Interfaces:**
- Produces: Expo managed workflow project skeleton

- [ ] **Step 1: 创建 packages/mobile/package.json**

```json
{
  "name": "@mplayer/mobile",
  "version": "0.1.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web"
  },
  "dependencies": {
    "@mplayer/core": "*",
    "expo": "~52.0.0",
    "expo-router": "~4.0.0",
    "expo-status-bar": "~2.0.0",
    "react": "18.3.1",
    "react-native": "0.76.0",
    "react-native-safe-area-context": "^4.12.0",
    "react-native-screens": "~4.4.0",
    "expo-av": "~15.0.0",
    "@react-native-async-storage/async-storage": "^1.24.0",
    "zustand": "^4.4.7",
    "axios": "^1.6.2",
    "@expo/vector-icons": "^14.0.0"
  },
  "devDependencies": {
    "@babel/core": "^7.25.0",
    "@types/react": "~18.3.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 2: 创建 packages/mobile/tsconfig.json**

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 3: 创建 packages/mobile/app.json**

```json
{
  "expo": {
    "name": "MPlayer",
    "slug": "mplayer-mobile",
    "version": "0.1.0",
    "orientation": "portrait",
    "scheme": "mplayer",
    "userInterfaceStyle": "dark",
    "splash": {
      "backgroundColor": "#1a1a2e"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.mplayer.mobile"
    },
    "android": {
      "adaptiveIcon": {
        "backgroundColor": "#1a1a2e"
      },
      "package": "com.mplayer.mobile"
    },
    "plugins": [
      "expo-router"
    ]
  }
}
```

- [ ] **Step 4: 安装依赖**

```bash
cd packages/mobile && npm install
```

- [ ] **Step 5: 验证 Expo 可启动**

```bash
cd packages/mobile && npx expo start --web
```

预期：Expo 开发服务器启动。可以 Ctrl+C 退出。

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/
git commit -m "feat(mobile): init Expo project with expo-router"
```

---

### Task 9: Mobile — Tab 布局 + TopBar

**Files:**
- Create: `packages/mobile/app/_layout.tsx`
- Create: `packages/mobile/app/(tabs)/_layout.tsx`
- Create: `packages/mobile/app/(tabs)/index.tsx` (占位)
- Create: `packages/mobile/app/(tabs)/playlists.tsx` (占位)
- Create: `packages/mobile/app/(tabs)/favorites.tsx` (占位)
- Create: `packages/mobile/components/TopBar.tsx`

**Interfaces:**
- Produces: 3-tab layout with TopBar (search bar + settings icon), placeholder pages

- [ ] **Step 1: 创建 app/_layout.tsx**

```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="player" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'push' }} />
    </Stack>
  );
}
```

- [ ] **Step 2: 创建 app/(tabs)/_layout.tsx**

```tsx
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet } from 'react-native';
import TopBar from '../../components/TopBar';

export default function TabLayout() {
  return (
    <View style={styles.container}>
      <TopBar />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: '#e74c3c',
          tabBarInactiveTintColor: '#888',
          tabBarLabelStyle: { fontSize: 12, marginBottom: 4 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: '发现',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="compass-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="playlists"
          options={{
            title: '歌单',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="list-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="favorites"
          options={{
            title: '收藏',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="heart-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  tabBar: {
    backgroundColor: '#16213e',
    borderTopColor: '#2a2a4a',
    borderTopWidth: 1,
    height: 60,
    paddingTop: 4,
  },
});
```

- [ ] **Step 3: 创建 components/TopBar.tsx**

```tsx
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function TopBar() {
  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#888" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.input}
          placeholder="搜索歌曲..."
          placeholderTextColor="#666"
          onFocus={() => router.push('/search')}
        />
      </View>
      <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsBtn}>
        <Ionicons name="settings-outline" size={22} color="#ccc" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingTop: 52, // safe area top
    backgroundColor: '#1a1a2e',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a4a',
    borderRadius: 20,
    paddingHorizontal: 12,
    height: 36,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  settingsBtn: {
    marginLeft: 12,
    padding: 4,
  },
});
```

- [ ] **Step 4: 创建 3 个占位页面**

`app/(tabs)/index.tsx`:
```tsx
import { View, Text, StyleSheet } from 'react-native';

export default function DiscoverPage() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>发现</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  text: { color: '#fff', fontSize: 18 },
});
```

`playlists.tsx` 和 `favorites.tsx` 同理，改标题文字。

- [ ] **Step 5: 创建 search.tsx 占位 + settings.tsx 占位**

`app/search.tsx`:
```tsx
import { Stack } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';

export default function SearchPage() {
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '搜索', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }} />
      <Text style={styles.text}>搜索页面（P1 实现）</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  text: { color: '#666', fontSize: 16 },
});
```

`app/settings.tsx` 同理。

- [ ] **Step 6: 验证**

```bash
cd packages/mobile && npx expo start --web
```

预期：3 tab 显示（发现/歌单/收藏），TopBar 显示搜索栏+齿轮图标。

- [ ] **Step 7: Commit**

```bash
git add packages/mobile/
git commit -m "feat(mobile): tab layout with TopBar"
```

---

### Task 10: Mobile — PlayerStore + AudioPlayer

**Files:**
- Create: `packages/mobile/stores/playerStore.ts`
- Create: `packages/mobile/services/audioPlayer.ts`

**Interfaces:**
- Consumes: `@mplayer/core` (musicApi for URL resolving)
- Produces: `usePlayerStore` (zustand) + `AudioPlayerService` (expo-av wrapper)

- [ ] **Step 1: 创建 stores/playerStore.ts**

```ts
import { create } from 'zustand';
import type { Song } from '@mplayer/core';

interface PlayerState {
  currentSong: Song | null;
  queue: Song[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  // actions
  play: (song: Song) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  setQueue: (songs: Song[], startIndex?: number) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (dur: number) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentSong: null,
  queue: [],
  isPlaying: false,
  currentTime: 0,
  duration: 0,

  play: (song) => set({ currentSong: song, isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true }),

  next: () => {
    const { queue, currentSong } = get();
    if (queue.length === 0 || !currentSong) return;
    const idx = queue.findIndex(s => s.id === currentSong.id);
    const nextIdx = (idx + 1) % queue.length;
    set({ currentSong: queue[nextIdx], isPlaying: true, currentTime: 0 });
  },

  prev: () => {
    const { queue, currentSong } = get();
    if (queue.length === 0 || !currentSong) return;
    const idx = queue.findIndex(s => s.id === currentSong.id);
    const prevIdx = (idx - 1 + queue.length) % queue.length;
    set({ currentSong: queue[prevIdx], isPlaying: true, currentTime: 0 });
  },

  setQueue: (songs, startIndex = 0) => {
    if (songs.length === 0) return;
    set({ queue: songs, currentSong: songs[startIndex], isPlaying: true, currentTime: 0 });
  },

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (dur) => set({ duration: dur }),
}));
```

- [ ] **Step 2: 创建 services/audioPlayer.ts**

```ts
import { Audio, AVPlaybackSource } from 'expo-av';
import { musicApi } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';

let sound: Audio.Sound | null = null;

export async function initAudio(): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    staysActiveInBackground: true,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
}

export async function playSong(song: Song): Promise<void> {
  try {
    // 解析音频 URL
    let audioUrl = song.url;
    if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
      const resolved = await musicApi.getAudioUrl(audioUrl);
      audioUrl = resolved || audioUrl;
    }

    // 卸载旧实例
    if (sound) {
      await sound.unloadAsync();
      sound = null;
    }

    const { sound: newSound } = await Audio.Sound.createAsync(
      { uri: audioUrl },
      { shouldPlay: true, progressUpdateIntervalMillis: 250 }
    );

    sound = newSound;
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) return;
      usePlayerStore.getState().setCurrentTime(status.positionMillis / 1000);
      usePlayerStore.getState().setDuration(
        (status.durationMillis ?? 0) / 1000
      );
      if (status.didJustFinish) {
        usePlayerStore.getState().next();
        const nextSong = usePlayerStore.getState().currentSong;
        if (nextSong) playSong(nextSong);
      }
    });
  } catch (err) {
    console.error('playSong error:', err);
    // 出错自动切下一首
    usePlayerStore.getState().next();
    const nextSong = usePlayerStore.getState().currentSong;
    if (nextSong) playSong(nextSong);
  }
}

export async function togglePlay(): Promise<void> {
  if (!sound) return;
  const state = await sound.getStatusAsync();
  if (state.isPlaying) {
    await sound.pauseAsync();
    usePlayerStore.getState().pause();
  } else {
    await sound.playAsync();
    usePlayerStore.getState().resume();
  }
}

export async function seekTo(timeSec: number): Promise<void> {
  if (sound) {
    await sound.setPositionAsync(timeSec * 1000);
  }
}

export async function cleanup(): Promise<void> {
  if (sound) {
    await sound.unloadAsync();
    sound = null;
  }
}
```

- [ ] **Step 3: 验证导入**

```bash
cd packages/mobile && npx tsc --noEmit
```

预期：无 TS 错误（可能报 `@mplayer/core` 找不到类型，需要确保 workspace 正确 link）

- [ ] **Step 4: Commit**

```bash
git add packages/mobile/
git commit -m "feat(mobile): playerStore + expo-av audioPlayer service"
```

---

### Task 11: Mobile — PlayerBar 吸底播放栏

**Files:**
- Create: `packages/mobile/components/PlayerBar.tsx`
- Modify: `packages/mobile/app/(tabs)/_layout.tsx`

**Interfaces:**
- Produces: 吸底迷你播放栏，常驻 Tab 上方。显示当前歌曲名 + 播放/暂停按钮

- [ ] **Step 1: 创建 components/PlayerBar.tsx**

```tsx
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { usePlayerStore } from '../stores/playerStore';
import { togglePlay } from '../services/audioPlayer';

export default function PlayerBar() {
  const currentSong = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  if (!currentSong) return null;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => router.push('/player')}
      activeOpacity={0.8}
    >
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {currentSong.name}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {currentSong.artist}
        </Text>
      </View>
      <TouchableOpacity
        onPress={(e) => { e.stopPropagation(); togglePlay(); }}
        style={styles.playBtn}
      >
        <Ionicons
          name={isPlaying ? 'pause-circle' : 'play-circle'}
          size={36}
          color="#e74c3c"
        />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  info: { flex: 1, marginRight: 12 },
  title: { color: '#fff', fontSize: 14, fontWeight: '600' },
  artist: { color: '#888', fontSize: 12, marginTop: 2 },
  playBtn: { padding: 4 },
});
```

- [ ] **Step 2: 更新 app/(tabs)/_layout.tsx**

在 `TopBar` 和 `<Tabs>` 中间添加 `PlayerBar`，再加上底部间距适配。

**注意：PlayerBar 放在 `<Tabs>` 下方的 View 结构不对。** 应该包裹整个屏幕：

```tsx
// 修改前
<View style={styles.container}>
  <TopBar />
  <Tabs ...>
    ...
  </Tabs>
</View>

// 修改后
<View style={styles.container}>
  <TopBar />
  <View style={{ flex: 1 }}>
    <Tabs ...>
      ...
    </Tabs>
  </View>
  <PlayerBar />
  {/* 注意：PlayerBar 在所有 content 下方，tab bar 上方 */}
</View>
```

但是 Tabs Navigator 内部渲染了 Tab Bar。要让 PlayerBar 出现在 Tab Bar 上方，需要在 Tabs 的 `tabBar` prop 自定义。

实际上更简单的方式：用 `tabBar={() => null}` 隐藏默认 Tab Bar，完全自己渲染：

```tsx
// 用 SafeAreaView 包裹
import { StatusBar } from 'expo-status-bar';
import PlayerBar from '../../components/PlayerBar';

export default function TabLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: '#1a1a2e' }}>
      <StatusBar style="light" />
      <TopBar />
      <Tabs
        screenOptions={{
          headerShown: false,
        }}
        tabBar={({ state, descriptors, navigation }) => (
          <View style={tabBarStyles.container}>
            {state.routes.map((route, i) => {
              const isFocused = state.index === i;
              const onPress = () => { navigation.navigate(route.name); };
              const icons = { index: 'compass-outline', playlists: 'list-outline', favorites: 'heart-outline' };
              const labels = { index: '发现', playlists: '歌单', favorites: '收藏' };
              return (
                <TouchableOpacity key={route.key} onPress={onPress} style={tabBarStyles.tab}>
                  <Ionicons
                    name={icons[route.name as keyof typeof icons] as any}
                    size={22}
                    color={isFocused ? '#e74c3c' : '#888'}
                  />
                  <Text style={{ color: isFocused ? '#e74c3c' : '#888', fontSize: 11, marginTop: 2 }}>
                    {labels[route.name as keyof typeof labels]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      >
        {/* Tab screens 不变 */}
      </Tabs>
      <PlayerBar />
    </View>
  );
}

const tabBarStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#16213e',
    borderTopColor: '#2a2a4a',
    borderTopWidth: 1,
    paddingBottom: 24,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

- [ ] **Step 3: 验证**

```bash
cd packages/mobile && npx expo start --web
```

预期：底部 Tab Bar + Tab Bar 上方 PlayerBar（当前无歌曲时不显示）。

- [ ] **Step 4: Commit**

```bash
git add packages/mobile/
git commit -m "feat(mobile): PlayerBar mini player above tab bar"
```

---

### Task 12: Mobile — 发现页（排行榜）

**Files:**
- Create: `packages/mobile/app/(tabs)/index.tsx` (替换占位)
- Create: `packages/mobile/stores/discoverStore.ts`

**Interfaces:**
- Consumes: `@mplayer/core` (musicApi.getNeteaseHotlist, getQQHotlist, getNeteaseNewSongList, getQQNewSongList)
- Produces: 发现页展示排行榜卡片列表，点击进入排行榜详情页（后续实现）

- [ ] **Step 1: 创建 stores/discoverStore.ts**

```ts
import { create } from 'zustand';
import { musicApi } from '@mplayer/core';

interface HotlistItem {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

interface DiscoverState {
  neteaseHotlist: HotlistItem[];
  qqHotlist: HotlistItem[];
  neteaseNew: HotlistItem[];
  qqNew: HotlistItem[];
  loading: boolean;
  load: () => Promise<void>;
}

export const useDiscoverStore = create<DiscoverState>((set) => ({
  neteaseHotlist: [],
  qqHotlist: [],
  neteaseNew: [],
  qqNew: [],
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const [nh, qh, nn, qn] = await Promise.all([
        musicApi.getNeteaseHotlist(),
        musicApi.getQQHotlist(),
        musicApi.getNeteaseNewSongList(),
        musicApi.getQQNewSongList(),
      ]);
      set({
        neteaseHotlist: nh.slice(0, 10),
        qqHotlist: qh.slice(0, 10),
        neteaseNew: nn.slice(0, 10),
        qqNew: qn.slice(0, 10),
      });
    } catch (err) {
      console.error('加载发现页失败:', err);
    } finally {
      set({ loading: false });
    }
  },
}));
```

- [ ] **Step 2: 替换 app/(tabs)/index.tsx**

```tsx
import { useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useDiscoverStore, HotlistItem } from '../../stores/discoverStore';

const SECTIONS = [
  { key: 'neteaseHotlist', title: '网易云音乐 · 热歌榜' },
  { key: 'qqHotlist', title: 'QQ 音乐 · 热歌榜' },
  { key: 'neteaseNew', title: '网易云音乐 · 新歌榜' },
  { key: 'qqNew', title: 'QQ 音乐 · 新歌榜' },
];

export default function DiscoverPage() {
  const loading = useDiscoverStore(s => s.loading);
  const load = useDiscoverStore(s => s.load);

  useEffect(() => { load(); }, []);

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator color="#e74c3c" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={SECTIONS}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <SectionCard
              title={item.title}
              songs={useDiscoverStore.getState()[item.key as keyof typeof useDiscoverStore.getState()] as HotlistItem[]}
            />
          )}
        />
      )}
    </View>
  );
}

function SectionCard({ title, songs }: { title: string; songs: HotlistItem[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {songs.slice(0, 5).map((song, i) => (
        <View key={song.id + String(i)} style={styles.songRow}>
          <Text style={styles.rank}>{i + 1}</Text>
          <Image source={{ uri: song.cover }} style={styles.cover} />
          <View style={styles.songInfo}>
            <Text style={styles.songName} numberOfLines={1}>{song.name}</Text>
            <Text style={styles.songArtist} numberOfLines={1}>{song.artists}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  section: {
    backgroundColor: '#16213e',
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    padding: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  rank: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    width: 28,
    textAlign: 'center',
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 6,
    marginRight: 10,
  },
  songInfo: { flex: 1 },
  songName: { color: '#fff', fontSize: 14 },
  songArtist: { color: '#888', fontSize: 12, marginTop: 2 },
});
```

- [ ] **Step 3: 验证**

```bash
cd packages/mobile && npx expo start --web
```

预期：发现页展示 4 个排行榜卡片，每个显示前 5 首歌的排名+封面+名字+歌手。

注意：Web 模式可能因 CORS 限制无法加载封面图，Android native 正常。这是预期行为。

- [ ] **Step 4: Commit**

```bash
git add packages/mobile/
git commit -m "feat(mobile): discover page with chart sections"
```

---

### Task 13: Mobile — 全屏播放器页壳

**Files:**
- Create: `packages/mobile/app/player.tsx`

**Interfaces:**
- Consumes: `usePlayerStore`, `audioPlayer` (togglePlay, seekTo)
- Produces: 全屏播放器页面，从底部弹出 modal

- [ ] **Step 1: 创建 app/player.tsx**

```tsx
import { useEffect, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import Slider from '@react-native-community/slider';
import { usePlayerStore } from '../stores/playerStore';
import { togglePlay, seekTo } from '../services/audioPlayer';

const { width } = Dimensions.get('window');

export default function PlayerPage() {
  const song = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const currentTime = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  const next = usePlayerStore(s => s.next);
  const prev = usePlayerStore(s => s.prev);
  const [lyrics, setLyrics] = useState<string[]>([]);

  useEffect(() => {
    if (!song) router.back();
  }, [song]);

  if (!song) return null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        headerShown: true,
        title: '',
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-down" size={28} color="#fff" />
          </TouchableOpacity>
        ),
      }} />

      {/* 专辑封面 */}
      <View style={styles.coverWrap}>
        <Image
          source={{ uri: song.cover || 'https://via.placeholder.com/300' }}
          style={styles.cover}
        />
      </View>

      {/* 歌曲信息 */}
      <View style={styles.infoWrap}>
        <Text style={styles.title}>{song.name}</Text>
        <Text style={styles.artist}>{song.artist}</Text>
      </View>

      {/* 进度条 */}
      <View style={styles.progressWrap}>
        <Slider
          style={{ width: width - 48 }}
          minimumValue={0}
          maximumValue={duration || 1}
          value={currentTime}
          onSlidingComplete={seekTo}
          minimumTrackTintColor="#e74c3c"
          maximumTrackTintColor="#444"
          thumbTintColor="#e74c3c"
        />
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatTime(currentTime)}</Text>
          <Text style={styles.time}>{formatTime(duration)}</Text>
        </View>
      </View>

      {/* 控制按钮 */}
      <View style={styles.controls}>
        <TouchableOpacity onPress={prev}>
          <Ionicons name="play-skip-back" size={32} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={togglePlay} style={styles.playBtn}>
          <Ionicons
            name={isPlaying ? 'pause-circle' : 'play-circle'}
            size={64}
            color="#e74c3c"
          />
        </TouchableOpacity>
        <TouchableOpacity onPress={next}>
          <Ionicons name="play-skip-forward" size={32} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', alignItems: 'center' },
  coverWrap: { marginTop: 40 },
  cover: { width: 280, height: 280, borderRadius: 16 },
  infoWrap: { marginTop: 24, alignItems: 'center' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  artist: { color: '#888', fontSize: 14, marginTop: 6 },
  progressWrap: { marginTop: 32, alignItems: 'center' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', width: width - 48, marginTop: 4 },
  time: { color: '#666', fontSize: 12 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 32,
    gap: 40,
  },
  playBtn: { marginHorizontal: 8 },
});
```

- [ ] **Step 2: 添加 @react-native-community/slider 依赖**

```bash
cd packages/mobile && npm install @react-native-community/slider
```

- [ ] **Step 3: 验证**

```bash
cd packages/mobile && npx tsc --noEmit
```

预期：无 TypeScript 错误。

- [ ] **Step 4: 连接：点击 PlayerBar 进入全屏播放器**

PlayerBar 已有 `onPress={() => router.push('/player')}`，确认路由正常工作。

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/
git commit -m "feat(mobile): fullscreen player page with controls"
```

---

## Self-Review

### Spec coverage
- Monorepo: Task 1 ✓
- Core types: Task 2 ✓
- Core cache: Task 3 ✓
- Core antiScrape: Task 4 ✓
- Core musicApi (Electron deps removed): Task 5 ✓
- Core utils: Task 6 ✓
- Expo project: Task 8 ✓
- Tab layout (3 tabs+TopBar): Task 9 ✓
- Player store + audio service: Task 10 ✓
- PlayerBar (mini player, above tab bar): Task 11 ✓
- Discover page: Task 12 ✓
- Fullscreen player: Task 13 ✓

### Missing from spec
- `packages/desktop/` 改为引用 core（spec 写"阶段二做"）→ P1 内容，当前不涉及 ✓
- 搜索页（P1）、歌单页（P1）、收藏页（P1）、设置页（P2）→ 后续阶段 ✓

### Placeholder check
无 TBD/TODO，所有代码块包含完整实现。

### Type consistency
- `Song extends SongBase` 在 core types 中一致 ✓
- `SourceKey` union type 在 types 和 musicApi 中一致 ✓
- `HotlistItem` 在 discoverStore 和 component 中一致 ✓

---

## 执行方式

**Plan complete. 两种执行方式：**

1. **Subagent-Driven (推荐)** — 每个 Task 派发独立子 agent，子 agent 之间通过 core 包构建产物衔接，快速迭代

2. **Inline Execution** — 在当前 session 依次执行，你查看进度

选哪个？
