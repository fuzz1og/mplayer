# 本地音乐库设计文档

## 概述

在现有 MPlayer 基础上新增本地音乐库功能，支持用户扫描本地文件夹中的音频文件，解析 ID3 元数据，通过文件夹结构浏览，并直接播放本地文件。本地歌曲可与在线歌曲一样添加到歌单、收藏和播放队列中。

## 需求

1. 用户选择本地文件夹，应用递归扫描并解析元数据
2. 支持格式：mp3、flac、wav、ogg
3. 解析 ID3 标签：歌名、艺术家、专辑、封面、时长
4. 按文件夹结构浏览本地歌曲
5. 直接播放本地文件（file:// 协议）
6. 文件变更自动监视（新增/删除）
7. 本地歌曲可添加到现有歌单和播放队列
8. 元数据持久化到本地文件

## 方案选择

采用主进程 LocalMusicService 架构（方案一），理由：
- 符合项目现有模式：主进程做重活、渲染层做展示
- 文件扫描和 ID3 解析在渲染进程会阻塞 UI
- 文件监视需要常驻进程，主进程是自然的位置
- 持久化与现有 FileStorage 模式一致

## 架构

### 数据模型

```typescript
// src/shared/types/song.ts — sourceType 行内联合类型新增 'local'
// 现有: sourceType: 'netease' | 'qq'
// 改为: sourceType: 'netease' | 'qq' | 'local'

// 新增
export interface LocalFolder {
  path: string;        // 文件夹绝对路径
  name: string;        // 文件夹名称
  songCount: number;
  lastScanned: Date;
}

export interface LocalSong {
  id: string;          // hash(filePath)
  name: string;        // ID3 title → filename
  artist: string;      // ID3 artist → 'Unknown Artist'
  album: string;       // ID3 album → parent folder name
  duration: number;    // from file metadata
  sourceType: 'local';
  filePath: string;    // 绝对路径
  coverBase64?: string;// ID3 cover art → base64
  format: string;      // mp3/flac/wav/ogg
  fileSize: number;    // bytes
}
```

渲染层使用时统一转为 `Song` 类型：`url = file:///path`，`cover = coverBase64`。

### 主进程 — LocalMusicService

**新建 `src/main/services/localMusicService.ts`**

```
localMusicService
├── addFolder(path)         → 添加文件夹并扫描
├── removeFolder(path)       → 移除文件夹（停止监视 + 删除记录）
├── getFolders()             → 返回文件夹列表
├── getSongs(folderPath?)    → 返回歌曲列表（LocalSong[]，可选按文件夹过滤）
├── refresh()                → 重新扫描所有文件夹
├── startWatching(path, cb)  → 对指定文件夹启动 fs.watch
├── stopWatching(path)       → 停止指定文件夹的监视
├── startWatchingAll(cb)    → 对所有已有文件夹启动监视（ensureInitialized 后调用）
├── stopWatchingAll()        → 停止所有监视
└── destroy()               → 清理所有监视器
```

**内部状态**（独立 JSON 文件持久化，路径 `userData/data/local-music.json`）：

```typescript
interface LocalMusicStore {
  folders: {
    path: string;
    name: string;
    songs: LocalSong[];
  }[];
}
```

与 `storage.json` 分离的原因：本地音乐数据量可能很大（数千首），混在一起影响现有功能的读写性能。

**扫描流程**：
1. 用户点击"选择文件夹"
2. 渲染进程发送 `localMusic:addFolder` IPC
3. 主进程接收路径，递归遍历目录
4. 对每个音频文件调用 `music-metadata` 解析 ID3
5. 收集结果写入 `local-music.json`
6. IPC 返回 `{ folder, songs }` 后，主进程对该文件夹启动 `fs.watch` 监视
7. app 启动时，对 `local-music.json` 中所有已有文件夹逐个启动监视器

**文件监视**：
- 检测到新增文件 → 解析 ID3 → 追加到 store → 推送 `localMusic:folderChanged({ type: 'add', folderPath, songs })`
- 检测到删除文件 → 从 store 移除 → 推送 `localMusic:folderChanged({ type: 'remove', folderPath, songIds })`

### IPC 通道

| 通道 | 方向 | payload | 返回 |
|---|---|---|---|
| `localMusic:addFolder` | R→M | `{ path: string }` | `{ folder: LocalFolder; songs: LocalSong[] }` |
| `localMusic:removeFolder` | R→M | `{ path: string }` | `void` |
| `localMusic:getFolders` | R→M | — | `LocalFolder[]` |
| `localMusic:getSongs` | R→M | `{ folderPath?: string }` | `LocalSong[]` |
| `localMusic:refresh` | R→M | — | `{ folders: LocalFolder[], songs: LocalSong[] }` |
| `localMusic:folderChanged` | M→R | `{ type: 'add'\|'remove', folderPath: string, songs?: LocalSong[], songIds?: string[] }` | — |

### 渲染层 — LocalStore

**新建 `src/renderer/store/localStore.ts`** (Zustand)：

```typescript
interface LocalStoreState {
  folders: LocalFolder[];
  songs: Song[];
  currentFolder: string | null;
  isScanning: boolean;
  scanProgress: { current: number; total: number } | null;
  initialized: boolean;

  // actions
  initialize: () => Promise<void>;      // 页面挂载时调用一次，获取所有数据
  addFolder: () => Promise<void>;      // 调用 dialog:openDirectory 后发送 addFolder IPC
  removeFolder: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  setCurrentFolder: (path: string | null) => void;
}
```

- `initialize()` 在页面挂载时调用（双检锁防止重复初始化和并发调用）
- `addFolder()` 先调用 `dialog:openDirectory`，再发送 `localMusic:addFolder`
- `localMusic:folderChanged` 事件监听在 `create()` 调用时注册（只注册一次），自动更新状态

### 页面 — LocalMusicPage

**新建 `src/renderer/pages/LocalMusicPage.tsx`**，替换路由中的 ComingSoon：

```
┌─ 页面头部 ───────────────────────────────────────────┐
│  📂 本地音乐                    [选择文件夹] [🔄 刷新] │
│  扫描进度: ████████░░ 80% (42/50)   共 3 个文件夹     │
├──────────────┬───────────────────────────────────────┤
│  文件夹列表   │  歌曲列表 (SongList 组件)              │
│              │                                       │
│  📁 音乐收藏  │   ♪ 歌名1 - 艺术家1                    │
│  📁 英语听力  │   ♪ 歌名2 - 艺术家2                    │
│  📁 游戏OST   │   ♪ 歌名3 - 艺术家3                    │
│              │                                       │
│  (点击筛选)   │   (播放/收藏/添加到歌单/下载)           │
└──────────────┴───────────────────────────────────────┘
```

- 左侧文件夹列表：点击选中筛选
- 右侧歌曲列表：直接复用现有 `SongList` 组件
- 选中文件夹时只展示该文件夹歌曲，不选时展示全部
- 扫描中显示进度条；空状态提示"选择文件夹开始导入音乐"

### 路由改动

**`src/renderer/router/index.tsx`**：将 `/local` 从 `ComingSoon` 改为 `LocalMusicPage`（lazy import）。

### 播放集成

**`src/renderer/store/playerStore.ts`** — `play()` 方法调整：

```typescript
if (song.sourceType !== 'local') {
  // 现有逻辑：通过 IPC 获取真实音频 URL
  const result = await ipcRenderer.invoke('musicApi:getAudioUrl', song.url);
  if (result.success) realUrl = result.data;
} else {
  // 本地歌曲直接使用 song.url（file:// 路径）
  realUrl = song.url;
}
```

**`src/renderer/services/audioPlayer.ts`** — Howler 已支持 file:// URL，无需改动。

## 数据流

```
用户操作          渲染进程                      主进程
─────────────────────────────────────────────────────────
点击"选择文件夹" → dialog:openDirectory
                 → 获取路径
→ localMusic:addFolder  → LocalMusicService.scanFolder()
                                           → 递归扫描目录
                                           → music-metadata 解析 ID3
                                           → 写入 local-music.json
                                           → fs.watch 注册
                                           ← LocalFolder + LocalSong[]
                 ← localStore 更新
                 → UI 渲染歌曲列表

文件变更（外部）                         → fs.watch 触发
                                          → 增量更新 store
                                          → localMusic:folderChanged
                 ← localStore 订阅更新
                 → UI 自动刷新

点击播放        → playerStore.play(song)
                 → 检测 sourceType === 'local'
                 → 跳过 getAudioUrl IPC
                 → audioPlayer.load(file://)
                 → 播放
```

## 边界情况

1. **非音频文件混入**：只处理 .mp3/.flac/.wav/.ogg 扩展名，其余跳过
2. **损坏的音频文件**：`music-metadata` 解析失败时跳过该文件，不中断整个扫描
3. **大量文件（>10000）**：扫描可能耗时数秒，UI 显示"扫描中..."状态，扫描完成后一次性更新列表
4. **文件被外部改名/移动**：rename 事件触发两次（旧路径 remove + 新路径 add），renderer 根据 songIds 过滤移除，根据 songs 添加新的
5. **扫描过程中文件夹被移除**：`refresh()` 对已删除的文件夹重新扫描会产生空结果，不会报错
6. **重复添加同一文件夹**：`addFolder` 检查路径是否已存在，已存在则跳过
7. **无 ID3 标签**：使用文件名作为歌名、文件夹名作为艺术家、未知作为专辑
8. **ID3 封面**：提取为 base64 data URI，直接作为 Song.cover 使用；部分文件封面较大，可考虑后置

## 依赖

新增 npm 包：`music-metadata`（~130KB gzipped，纯 JS，无原生依赖）

## 测试要点

- LocalMusicService 扫描空目录、含音频文件目录、含非音频文件目录
- ID3 解析：有标签/无标签/损坏标签的文件
- 文件监视：新增文件后 store 是否自动更新
- removeFolder：移除后歌曲是否全部清理
- 播放：sourceType === 'local' 时是否跳过 API URL 获取
- 添加到歌单：本地歌曲添加到歌单后能否正确播放
- 大型文件夹扫描：进度反馈是否正确
- data migration：local-music.json 文件损坏时的降级处理
