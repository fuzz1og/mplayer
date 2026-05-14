# MPlayer - 极简音乐播放器

一个基于 Electron + React + TypeScript 的桌面音乐播放器，支持网易云音乐和QQ音乐双源搜索与播放。

## 技术栈

- **前端框架**: React 18 + TypeScript
- **桌面框架**: Electron 28
- **构建工具**: Vite 5
- **状态管理**: Zustand
- **UI 组件库**: Ant Design 5
- **音频处理**: Howler.js
- **HTTP 客户端**: Axios
- **打包工具**: electron-builder

## 已实现功能

### 音乐播放

- [x] 搜索播放（网易云/QQ音乐双源）
- [x] 热歌榜展示（网易云热歌榜、QQ音乐热歌榜）
- [x] 播放控制（播放/暂停/上一首/下一首）
- [x] 四种播放模式（顺序/列表循环/单曲循环/随机）
- [x] 音量控制与进度拖动
- [x] 歌词显示（点击封面进入全屏歌词）
- [x] 全局快捷键（MediaPlayPause / Ctrl+Alt+Space 等）

### 收藏与历史

- [x] 歌曲收藏（单首/批量）
- [x] 播放历史（自动记录/查看/清空/删除单条）

### 歌单管理

- [x] 创建/删除歌单
- [x] 添加/移除歌曲
- [x] 拖拽排序（歌曲重排，立即保存）
- [x] 多选批量操作（批量下载/批量移除）
- [x] 歌单详情查看
- [x] 歌单歌曲 URL 自动刷新（缓存有效 12 小时）

### 缓存系统

- [x] 歌曲 URL 缓存（12h TTL，歌单/收藏共用）
- [x] 封面图片磁盘缓存（永久存储，防裂图）
- [x] 音频文件缓存（最多保留最近 10 首）
- [x] 缓存统计与一键清除

### 系统托盘

- [x] 托盘图标与右键菜单（播放/暂停/上一首/下一首/显示窗口/退出）
- [x] 托盘通知显示当前歌曲信息

### 播放队列

- [x] 拖拽排序（@dnd-kit）
- [x] 保存队列为歌单
- [x] 清空队列

### 下载功能

- [x] 单曲/批量下载
- [x] 下载进度弹窗

### 设置

- [x] 缓存管理（查看统计/一键清除）
- [x] 下载目录设置（选择/重置）
- [x] API 地址配置
- [x] 关于页面

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run electron:dev

# 生产构建
npm run build

# 打包应用（当前平台）
npm run electron:build

# 打包应用（指定平台）
npm run electron:build:win   # Windows (.exe)
npm run electron:build:mac   # macOS (.dmg)
npm run electron:build:linux # Linux (.AppImage)

# 代码检查
npm run lint
npm run typecheck
```

## 项目结构

```
src/
├── main/                    # Electron 主进程
│   ├── main.ts              # 入口文件
│   ├── api/                 # API 调用 (音乐搜索/热榜)
│   ├── cache/               # 缓存管理
│   ├── storage/             # 数据持久化
│   ├── services/            # 核心服务 (下载)
│   └── tray/                # 系统托盘管理
├── renderer/                # React 渲染进程
│   ├── components/          # 公共组件 (PlayerBar/SongListVirtual等)
│   ├── pages/               # 页面组件
│   ├── store/               # Zustand 状态管理
│   ├── services/            # 业务服务 (cacheService/coverCacheService等)
│   ├── hooks/               # 自定义 Hooks (useGlobalShortcuts等)
│   └── utils/               # 工具函数 (songDedupe等)
└── shared/                  # 共享类型定义
```

## 功能亮点

- 支持网易云和QQ音乐双音乐源搜索
- 多种播放模式满足不同场景
- 批量操作支持（批量下载、批量收藏、批量删除）
- 多级缓存机制提升性能（URL/封面/音频三缓存）
- 封面磁盘缓存，网络图片永久存储避免裂图
- 歌单歌曲 URL 自动刷新，过期链接无缝恢复
- 虚拟滚动渲染（@tanstack/react-virtual），流畅处理大量歌曲列表
- 拖拽排序（@dnd-kit），歌单与播放队列随心排列
- 全局快捷键与系统托盘，后台播放便捷控制
- 歌曲自动去重，避免重复添加
- 中文界面，本土化体验

## 使用服务

本项目的音乐 API 地址有两种配置方式：

### 用户配置（优先级最高）

1. 打开应用设置页面
2. 在「API 设置」中填入音乐 API 服务地址
3. 保存后重启应用生效

### 开发配置

开发者可在项目根目录创建 `.env.local` 文件：

```bash
MUSIC_API_URL=https://your-api-server.com/
```

> 注意：`.env.local` 不会被提交到 Git，仅开发时使用。打包后会自动忽略。

### API 要求

API 服务需要兼容以下接口：

- 音乐搜索：`GET /search?keyword=xxx&type=xxx`
- 热歌榜：`GET /toplist?type=xxx`
- 播放链接：`GET /url?id=xxx`
- 歌词：`GET /lyric?id=xxx`

## 免责声明

> ⚠️ **重要声明**

1. **个人学习项目**: 本项目仅供个人学习 Electron、React、TypeScript 等技术使用，不包含任何商业目的。

2. **版权声明**: 本项目不存储任何音乐文件，所有音乐资源均来自第三方服务提供商。用户通过本软件播放的音乐内容版权归原始作者所有。

3. **使用风险**: 使用本软件在线播放或下载音乐可能涉及版权问题，请确保您拥有相关音乐的使用权限或仅将其用于个人欣赏。

4. **禁止商用**: 禁止使用本项目进行任何商业活动，包括但不限于捆绑推广、广告变现等。

## 开源许可证

本项目采用 [MIT](LICENSE) 许可证开源。

### 您可以

- ✅ 复制、分发本项目
- ✅ 用于个人学习目的
- ✅ 修改本项目
- ✅ 商业使用

### 限制

- 本软件按"原样"提供，不提供任何明示或暗示的保证
- 使用本项目即表示您同意上述免责声明中的条款
