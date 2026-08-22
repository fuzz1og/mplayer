# 🎵 MPlayer

> 个人学习项目，仅供学习 Electron / React / React Native / TypeScript 技术栈使用，不包含任何商业目的。

[![CI](https://img.shields.io/github/actions/workflow/status/fuzz1og/mplayer/ci.yml?label=CI&branch=master)](https://github.com/fuzz1og/mplayer/actions/workflows/ci.yml)
[![Build & Release](https://img.shields.io/github/actions/workflow/status/fuzz1og/mplayer/release.yml?label=Build%20%26%20Release)](https://github.com/fuzz1og/mplayer/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-orange)](LICENSE)
![Version](https://img.shields.io/github/package-json/v/fuzz1og/mplayer)

跨平台音乐播放器：**Electron 桌面端 + Expo/React Native 移动端**，7 大音乐源官方直连搜索与播放（网易云 / QQ / 酷狗 / 咪咕 / 酷我 / 千千 / 汽水），直连失败自动降级到第三方解析源（tier3 订阅）。桌面端与移动端共享同一套 `@mplayer/core` 能力。

## ✨ 特性

- **🎧 多源聚合播放** — 7 源官方直连，可播性探测 + 预取缓存，播放零等待出声；直连失败按订阅清单降级到第三方解析源
- **🔀 单曲换源** — 完整版优先 + 可播性探测 + 原位替换，失效音源一键换源
- **📱 双端一致** — 桌面（Electron + React）与移动端（Expo + React Native）共享 core，功能与数据语义对齐
- **🌗 深色模式** — 移动端双主题 token 体系 + textVariants 语义变体，跟随系统或手动切换
- **⚡ 智能更新** — 桌面端更新走 GitHub 直连，失败自动降级到加速镜像（gh-proxy / ghfast / ghproxy）
- **📻 本地音乐** — ID3 元数据解析、文件夹扫描监视、下载队列（.lrc 歌词侧车）

## 🚀 快速开始

```bash
# 桌面端（Electron）
npm install
npm run electron:dev        # 开发模式
npm run electron:build      # 打包当前平台

# 移动端（Expo）
cd packages/mobile
npm install
npm run start               # 启动 Expo dev server
```

> 移动端运行前需先构建共享包：项目根目录 `npm run core:build`

## 🖥️ 桌面端功能

| 分类 | 功能 |
|------|------|
| 播放 | 多源搜索、热歌榜、四种播放模式、歌词、全局快捷键、试听版识别提示 |
| 换源 | 单曲换源（完整版优先 + 可播性探测 + 原位替换） |
| 搜索 | 歌曲/歌手 Tab、歌手浏览与详情、无 URL 歌曲严格匹配回填 |
| 收藏 / 历史 | URL 自动刷新与 DB 回写；自动记录、查看/清空 |
| 歌单 | 创建/删除、拖拽排序、批量操作、文本/链接导入 |
| 发现 | 推荐 / 排行榜 / 新碟 / 歌单 / 歌手、专辑页、一键保存 |
| 缓存 | 预取缓存（播放零等待）、封面/音频磁盘缓存、统计/清除 |
| 网络 | 7 源直连状态面板、tier3 订阅清单 + 每源统计、HTTP 代理、TLS 指纹伪装 |
| 下载 / 本地 | 单曲/批量下载、进度弹窗；文件夹扫描、ID3 解析、变更监视 |

## 📱 移动端功能

- **5 个 Tab**：推荐 / 发现 / 搜索 / 歌单 / 下载（默认推荐）
- **全屏播放器**：左滑歌词、播放模式、收藏、队列
- **深色模式**：跟随系统 / 浅色 / 深色三态
- **下载**：SAF 授权保存到公共下载目录
- **设置**：直连设置（auto/direct 来源开关）、tier3 订阅、代理、检查更新、缓存、播放日志
- **详情页**：排行榜 / 歌单 / 专辑 / 歌手 / 发现歌单

完整路由表见 [docs/agents/architecture.md](docs/agents/architecture.md)（agent 视角）与 `packages/mobile/app/` 目录。

## 🔌 多源与解析链路

自建 API 已退役，**无需任何 API 地址配置**：

```
官方直连优先 → tier3 订阅源兜底 → 全部失败换元/标记不可播
```

- 7 源均内置官方直连客户端（网易云 weapi / QQ musicu.fcg / 酷狗 / 咪咕 / 酷我 / 千千 / 汽水）
- 探测语义 = 直连可播性：探测时直接解析并写入预取缓存，播放命中零等待
- tier3 订阅源（实验性，默认关闭）：设置页添加 URL / 本地文件 / 粘贴 JSON 清单，可查看每源命中/失败统计

## 🧱 技术栈

| 端 | 技术 |
|----|------|
| 桌面 | Electron 41 · React 19 · TypeScript · Vite 6 · Zustand · Ant Design 6 · Howler · electron-builder · electron-updater |
| 移动 | Expo 57 · React Native 0.86 · expo-router · expo-audio · Zustand · AsyncStorage · lucide-react-native |
| 共享 | `@mplayer/core`：多源直连客户端、歌曲识别/匹配、播放地址解析、缓存内核、tier3 执行器 |

## 🛠️ 开发

```bash
npm run lint                # ESLint（零警告）
npm run typecheck           # 桌面端类型检查
npm run typecheck:mobile    # 移动端类型检查
npm run test:run            # 渲染端测试
npm run core:build          # 构建共享包（改 core 后移动端必须重建）
```

桌面端 E2E（Playwright）：`npx vite --config vite.test.config.ts --port 5174` + `npx playwright test`

## 📦 发布

推送 `v*` tag 自动触发 GitHub Actions 构建（桌面三平台 + Android APK）并上传 GitHub Releases，应用内可检查更新：

```bash
./scripts/release.sh patch   # 一键发布（验证 → bump → commit → tag → 触发 CI）
```

## 参考与致谢

- **[musicdl](https://github.com/CharlesPikachu/musicdl)**（PolyForm Noncommercial License 1.0.0）——各音乐源官方直连手法（端点、签名算法、cookie 思路）的参考。本项目实现为独立重写的 TypeScript 代码，仅用于学习研究、禁止商用。
- **[NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)**（MIT）——网易云 weapi 加密算法参考。

## 免责声明

1. 个人学习项目，禁止商用
2. 不存储任何音乐文件，资源来自第三方服务
3. 内置反爬机制仅用于降低请求频率，不用于绕过安全措施

## 许可证

[PolyForm Noncommercial License 1.0.0](LICENSE)——**仅限非商业用途**（与参考项目 musicdl 同款许可证）。允许学习、研究、个人使用，禁止商业使用。
