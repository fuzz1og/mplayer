# MPlayer

> 本项目仅供个人学习 Electron、React、TypeScript 等技术使用，不包含任何商业目的。所有音乐资源版权归原作者所有。

Electron 桌面音乐播放器 + Expo/React Native 移动端。支持多音乐源搜索与播放（网易云、QQ、酷狗、咪咕、酷我、千千、Soda）。

## 项目结构

```
/
├── src/                     # Electron 桌面端
│   ├── main/                # Electron 主进程
│   ├── renderer/            # React 渲染进程
│   └── shared/              # 共享类型定义
├── packages/
│   ├── core/                # @mplayer/core — 共享 API 客户端和类型
│   └── mobile/              # Expo/React Native 移动端
├── e2e/                     # Playwright E2E 测试（桌面端）
└── docs/                    # 设计文档和计划
```

## Desktop (Electron)

### 技术栈

- Electron 28 + React 18 + TypeScript + Vite 5
- Zustand（状态管理）、Ant Design 5（UI）、Howler.js（音频）
- @tanstack/react-virtual（虚拟滚动）、@dnd-kit（拖拽排序）
- electron-builder（打包）、electron-updater（自动更新）
- Playwright（E2E 测试）

### 功能

| 分类 | 功能 |
|------|------|
| 播放 | 多源搜索、热歌榜、播放控制、四种模式、音量/进度条（键盘可操作）、歌词、全局快捷键 |
| 搜索 | 歌曲/歌手标签页分类、歌手浏览（分类筛选）、歌手详情 |
| 收藏 | 单首收藏、URL 自动刷新与 DB 回写 |
| 历史 | 自动记录、查看/清空/删除 |
| 歌单 | 创建/删除、拖拽排序、批量操作、URL 自动刷新与 DB 回写、文本/链接导入 |
| 发现 | 推荐歌单浏览（分类标签、无限滚动）、一键保存 |
| 缓存 | URL（12h）、封面（永久磁盘）、音频（最近 10 首）、空数据不缓存、统计/清除 |
| 托盘 | 右键菜单、歌曲信息提示 |
| 队列 | 拖拽排序、保存为歌单 |
| 下载 | 单曲/批量、进度弹窗、PlayerBar 快捷下载 |
| 本地音乐 | 文件夹扫描、ID3 解析、文件变更监视 |
| 设置 | 缓存管理、下载目录、API 地址、网络代理、检查更新 |

### 快速开始

```bash
npm install
npm run electron:dev    # 开发模式
npm run build           # 生产构建
npm run electron:build  # 打包应用（当前平台）
```

### API 配置

1. **用户配置**（优先级最高）：设置页 → API 设置 → 填入地址 → 保存重启
2. **开发配置**：项目根目录创建 `.env.local`，填入 `MUSIC_API_URL=https://your-api-server.com/`

需要兼容的接口：`/search`、`/toplist`、`/url`、`/lyric`、`/playlist/catlist`、`/playlist/hot`、`/playlist/detail`

### 项目结构（桌面端）

```
src/
├── main/                    # Electron 主进程
│   ├── main.ts              # 入口（窗口、IPC、快捷键、托盘）
│   ├── api/                 # HTTP 客户端（搜索、热榜、反爬）
│   ├── cache/               # 磁盘缓存
│   ├── storage/             # 数据持久化（db.ts）
│   ├── ipc/                 # IPC 注册工具
│   ├── services/            # 下载、本地音乐扫描
│   └── tray/                # 系统托盘
├── renderer/                # React 渲染进程
│   ├── components/          # 组件（PlayerBar, SongList, Modals 等）
│   ├── pages/               # 页面（Discover, Favorites, History, Playlists 等）
│   ├── store/               # Zustand stores
│   ├── services/            # 业务服务（audioPlayer, cacheService 等）
│   ├── hooks/               # 自定义 Hooks
│   └── utils/               # 工具函数（songDedupe, lyricsParser, format 等）
└── shared/                  # 共享类型定义
```

### 发布

推送 tag 自动触发 GitHub Actions 构建：

```bash
git tag v1.x.x
git push origin v1.x.x
```

三平台（Windows/macOS/Linux）产物自动上传到 GitHub Releases。应用内设置页可检查更新并一键安装。

## Mobile (Expo/React Native)

### 技术栈

- Expo 52 + React Native 0.76 + TypeScript
- expo-router（导航）、Zustand（状态管理）、expo-av（音频播放）
- @react-native-async-storage/async-storage（持久化）

### 快速开始

```bash
cd packages/mobile
npm install        # 安装依赖
npm run android    # Android 模拟器
npm run ios        # iOS 模拟器（仅 macOS）
```

> 需要先构建 `@mplayer/core` 共享包：在项目根目录运行 `npm run core:build`

### 页面

| 路由 | 功能 |
|------|------|
| `/` | 发现页 — 排行榜/歌单/歌手滑动 Tab |
| `/search?q=` | 搜索结果（隐藏 Tab 栏动画下滑） |
| `/playlists` | 歌单页（内置收藏/播放历史入口） |
| `/player` | 全屏播放器（模态）— 左滑歌词、播放模式、收藏、队列 |
| `/favorites` | 我的收藏 |
| `/history` | 播放历史 |
| `/settings` | API 地址 + 播放模式设置 |
| `/playlist/[id]` | 歌单详情 |
| `/artist/[id]` | 歌手详情 |

### 调试

```bash
# 启动 Expo 开发服务器
cd packages/mobile
npm start

# 查看日志
npx expo start --android --logs
```

## Shared Package (`@mplayer/core`)

`packages/core/` 包含桌面端和移动端共用的 API 客户端和类型定义。

```bash
npm run core:build        # 构建共享包（修改核心代码后需重新构建）
npm run core:typecheck    # 类型检查
```

## 构建检查

```bash
npm run lint              # ESLint（零警告）
npm run typecheck         # 桌面端类型检查
npm run typecheck:mobile  # 移动端类型检查
npm run build             # 桌面端构建
npm run core:build        # 共享包构建
```

## E2E 测试（桌面端）

```bash
npx vite --config vite.test.config.ts --port 5174   # 启动测试服务器
npx playwright test                                   # 运行全部测试
```

测试文件位于 `e2e/` 目录，使用 Playwright 自动化 Electron 应用。

## 免责声明

1. 个人学习项目，禁止商用
2. 不存储任何音乐文件，资源来自第三方服务
3. 内置反爬机制仅用于降低请求频率，不用于绕过安全措施

## 许可证

[MIT](LICENSE)
