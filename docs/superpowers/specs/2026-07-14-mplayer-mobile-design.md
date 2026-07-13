# MPlayer Mobile — React Native 移动端版本设计

## 概述

将 MPlayer（Electron 桌面音乐播放器）以 React Native (Expo) 方式移植到 Android。与桌面版保持 monorepo 共享核心逻辑。

## 技术选型

| 层面 | 方案 | 理由 |
|------|------|------|
| 框架 | React Native + Expo (SDK 52+, managed) | 最大化复用 React/TS 代码 |
| 路由 | expo-router (file-based routing) | Expo 官方推荐 |
| 音频 | expo-av | 简单够用，managed workflow 友好 |
| 状态 | Zustand (同桌面) | 零迁移成本 |
| 持久化 | @react-native-async-storage/async-storage | 轻量 JSON 键值 |
| HTTP | axios (同桌面) | 零迁移成本 |
| 图标 | @expo/vector-icons | 已内置 |
| UI | StyleSheet / nativewind | 轻量，后续可换 |

## 仓库结构

```
mplayer/
├── packages/
│   ├── core/                 # 共享纯 TS 逻辑
│   │   ├── src/
│   │   │   ├── api/          # 音乐源适配器 (7 个源)
│   │   │   │   ├── musicApi.ts        # axios client
│   │   │   │   ├── memoryCacheManager.ts
│   │   │   │   └── antiScrape.ts
│   │   │   ├── utils/
│   │   │   │   ├── songDedupe.ts
│   │   │   │   ├── songMatcher.ts
│   │   │   │   ├── songResolver.ts
│   │   │   │   ├── lyricsParser.ts
│   │   │   │   └── format.ts
│   │   │   ├── types/
│   │   │   │   └── index.ts           # Song, Artist, Playlist, SourceKey 等
│   │   │   └── index.ts               # 统一导出
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts              # 构建 cjs + esm
│   │
│   ├── desktop/               # 现有 Electron 代码
│   │   ├── src/
│   │   │   ├── main/          # 不变
│   │   │   ├── renderer/      # UI 不变
│   │   │   └── shared/        # 逐渐迁移到 core
│   │   └── package.json
│   │
│   └── mobile/                # 新 React Native app
│       ├── app/               # Expo Router 页面
│       ├── components/        # RN 组件
│       ├── stores/            # Zustand stores
│       ├── services/          # 音频播放封装
│       ├── app.json
│       └── package.json
│
├── package.json               # workspace root
└── tsconfig.json               # 根 tsconfig
```

## Core 包提取内容

提取自桌面版，纯 TS 无 Electron/RN 依赖：

| 模块 | 来源 | 状态 |
|------|------|------|
| 音乐源适配器 (7 源) | `src/main/api/musicApi.ts` | 提取 HTTP 请求逻辑，移除 IPC |
| 内存缓存 | `src/main/api/memoryCacheManager.ts` | 直接复制，无外部依赖 |
| 反爬虫 | `src/main/api/antiScrape.ts` | 直接复制 |
| 歌曲去重 | `src/renderer/utils/songDedupe.ts` | 直接复制 |
| 歌曲匹配 | `src/renderer/utils/songMatcher.ts` | 直接复制 |
| 歌曲解析 | `src/renderer/utils/songResolver.ts` | 直接复制 |
| 歌词解析 | `src/renderer/utils/lyricsParser.ts` | 直接复制 |
| 格式化 | `src/renderer/utils/format.ts` | 直接复制 |
| 类型定义 | `src/types/` 及各处 | 统一到 `types/index.ts` |

**不移入 core：**
- 磁盘缓存 (`cacheManager.ts`) — 各端不同
- IPC 通信 (`IpcClient`, `registerHandler`) — 留 desktop
- 音频播放 (`audioPlayer.ts`) — 各端不同
- Zustand stores — store shape 各端可不同
- UI 组件 — 各端不同框架
- 本地音乐 / 下载 / ID3 — 桌面专属
- 配置文件 (`config.ts`) — 桌面专属

## 移动端页面结构

### 导航层次

```
Root Layout (Stack)
├── (tabs)                    # Tab Navigator
│   ├── index.tsx             # 发现页 (默认)
│   ├── playlists.tsx         # 歌单页
│   └── favorites.tsx         # 收藏页
├── player.tsx                # 全屏播放器 (Stack modal)
└── settings.tsx              # 设置页 (Stack push)
```

### 布局

```
┌───────────────────────────┐
│  [搜索栏...]           ⚙️ │  ← TopBar (所有 tabs 公共)
├───────────────────────────┤
│                           │
│    Tab 页面内容            │
│                           │
│                           │
├───────────────────────────┤
│  ◀⏯    歌曲名 - 歌手  ▶︎  │  ← 迷你播放栏 (吸底, 常驻)
├──────┬──────┬────────────┤
│  发现 │ 歌单 │   收藏     │  ← Tab Bar (3 items)
└──────┴──────┴────────────┘
```

- 迷你播放栏：点击 → 全屏播放器页
- 全屏播放器：底部弹出，含歌词、进度条、播放模式、队列
- 搜索栏：输入后展开搜索结果（push 搜索页）

### 页面清单 (P0-P2)

| 页面 | 优先级 | 说明 |
|------|--------|------|
| 发现页 | P0 | 排行榜卡片列表，歌单推荐 |
| 迷你播放栏 | P0 | 吸底常驻，显示当前歌曲 |
| 全屏播放器 | P0 | 播放/暂停/切歌/进度/歌词 |
| 搜索页 | P1 | 多源搜索聚合结果 |
| 歌单列表/详情 | P1 | 用户歌单 CRUD |
| 收藏页 | P1 | 收藏歌曲列表 |
| 排行详情页 | P1 | 第三方排行榜/歌单详情 |
| 设置页 | P2 | API URL, UI 设置 |

## 数据流

```
┌──────────┐   fetch/axios    ┌──────────────┐
│  Mobile  │ ──────────────→  │  音乐源 API   │
│  App     │ ←──────────────  │  (第三方)     │
│          │                  └──────────────┘
│ core/    │◄─cache─────────  core/memoryCache
│ musicApi │
│          │
│ stores/  │◄─state─────────  zustand
│ (zustand)│
│          │
│ expo-av  │◄─url──────────  online 播放
└──────────┘
```

- 无 IPC 层，API 调用直接走 axios/fetch
- 音频 URL 通过 `musicApi.getAudioUrl()` 获取后直接传给 `expo-av`
- 缓存复用 core 的内存缓存，持久化通过 AsyncStorage

## 音频播放策略 (阶段一)

- 使用 `expo-av` `Audio.Sound` 实例
- 在线播放，不实现下载/磁盘缓存
- 后台播放通过 `Audio.setAudioModeAsync({ staysActiveInBackground: true })`
- 不实现跨应用通知栏控制 (阶段二)
- 出错处理：监听 `onPlaybackStatusUpdate`，自动播下一首

## 数据持久化

| 数据类型 | 存储方式 | 备注 |
|----------|----------|------|
| 收藏歌曲 | AsyncStorage key `favorites` | JSON 数组 |
| 歌单 | AsyncStorage key `playlists` | JSON 数组 |
| 播放历史 | AsyncStorage key `history` | FIFO 上限 200 |
| 播放队列 | AsyncStorage key `queue` | 队列持久化 |
| 设置 | AsyncStorage key `settings` | API URL, 播放模式等 |
| 上次播放位置 | AsyncStorage key `player-progress` | 恢复续播 |

## 阶段划分

### P0 — 骨架 (预计 2-3 天)
1. monorepo 搭建 (npm workspaces)
2. core 包创建 + 类型定义 + musicApi 提取
3. Expo 项目初始化 + expo-router tab 布局
4. 发现页 (排行榜列表)
5. 基础播放器 (expo-av 播放/暂停/切歌)
6. TopBar + 迷你播放栏 + 全屏播放器壳

### P1 — 功能补齐 (预计 3-5 天)
1. 搜索功能 (多源搜索聚合)
2. 歌单 CRUD + 歌单详情
3. 收藏功能
4. 全屏播放器完善 (进度条、歌词)
5. 排行榜详情页

### P2 — 完善 (预计 2-3 天)
1. 设置页
2. 后台播放 + 通知控制
3. 播放历史
4. 视觉打磨 (加载态、空态、错误态)
5. 播放队列管理

### 后续
- Local Music / 下载
- Android 桌面 Widget
- Android Auto

## 桌面端调整

core 包提取后 desktop 做以下调整：
1. 音乐 API 调用改为从 core import，移除 `src/main/api/musicApi.ts` 的 HTTP 请求部分
2. IPC handler 变为 core API 的薄包装层 (仍需要主进程做代理、缓存)
3. `memoryCacheManager.ts` → 从 core 引用
4. 工具函数 → 从 core 引用
5. 类型定义 → 从 core 引用

桌面端 IPC 中间层保留，core 不包含任何 Electron API 调用。

## 注意事项

- core 必须是运行时无关的纯 TS，不引用 Electron 或 RN 任何模块
- 音乐源 URL 解析如果依赖 Electron 代理设置 → 留在 desktop，core 只做 HTTP 调用
- 汽水音乐 `getSodaAudioUrl` 有特殊流式处理 → core 只保留 URL 解析，流处理各端实现
- Managed workflow 限制：如需自定义原生模块可能需 eject 到 bare
