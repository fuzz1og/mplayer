# 桌面端 vs Mobile 功能差距清单（wayfinder #80）

> Wayfinder map #79 的 research 资产。2026-08-03，由 subagent 全仓对比产出（src/renderer + src/main + packages/mobile + packages/core）。

按优先级排序（用户可见度最高在前）。

| # | 功能名 | 桌面端实现位置 | mobile 现状 | 对齐成本 |
|---|--------|----------------|-------------|----------|
| 1 | 下载歌曲（单曲/批量/进度/目录） | `src/main/services/downloadService.ts`（队列、并发3、abort、ID3 写入、封面嵌入）；`hooks/useDownload.ts`、`components/DownloadProgressModal.tsx`、`components/DownloadSection.tsx` | 缺失（占位 Alert「即将推出」）：`packages/mobile/components/SongRow.tsx:71`；`app/(tabs)/download.tsx` 纯占位 | **高** — Electron 主进程 fs/ID3 实现，mobile 需 expo-file-system + SAF/MediaStore + JS 标签写入重写 |
| 2 | 本地音乐（文件夹扫描/元数据/播放） | `src/renderer/pages/LocalMusicPage.tsx` + `src/main/services/localMusicService.ts`（music-metadata、多文件夹） | 缺失（`SourceKey` 含 `'local'` 但无播放路径） | **高** — 需 expo-document-picker + expo-file-system + 本地播放重建 |
| 3 | 缓存管理 UI（分项统计/一键清理） | `src/renderer/components/CacheSection.tsx` + `src/main/ipc/cache.ts` + `cache/diskBackend.ts` | 缺失 — `packages/mobile/cache/fileBackend.ts` 已写好但**未接线**（grep 无引用）；实际用 AsyncStorage `songUrl:` + core 内存缓存，用户无法查看/清理 | **中** — 接线 fileBackend 到 core CacheKernel + 设置页加 UI；`keys()` 未实现需补 |
| 4 | 播放队列管理（拖拽/移除/清空/批量加歌单） | `src/renderer/pages/QueuePage.tsx`（dnd-kit、queueUtils、清空确认） | 部分 — PlayerBar 仅只读队列弹层（列表+点击播放） | **中** — mobile 需长按拖拽或上下移按钮 |
| 5 | 歌单排序/批量操作（多选、批量下载/删除、播放全部） | `src/renderer/pages/PlaylistDetailPage.tsx`（多选 + dnd + `playlist:reorderFull` IPC） | 缺失 — mobile `playlist/[id].tsx` 仅长按移除单曲 + 重命名 | **中** |
| 6 | 歌单导入（网易/QQ 链接、文本粘贴、多源探测） | `src/renderer/components/ImportPlaylistModal.tsx`、`services/importService.ts` | 缺失 | **高** — importService 需迁 core；mobile 无粘贴导入交互设计 |
| 7 | 多源排行榜聚合（网易+QQ+酷狗、去重评分） | `src/main/services/chartAggregator.ts` + `src/main/api/kugouApi.ts`；`components/ChartPanel.tsx` | 部分 — DiscoverTabs HotlistContent 为 4 个**单源分区**（网易热歌/QQ热歌/网易新歌/QQ新歌），无酷狗、无聚合 | **中** — 聚合逻辑需从 main 迁 core（kugouApi 在 src/main/，core 未含） |
| 8 | 音量控制（滑块 + 静音） | `src/renderer/components/PlayerVolume.tsx`、`PlayerBar.tsx` | 缺失（全库 grep 无 volume） | **小** — expo-audio 有 volume API |
| 9 | 全局媒体键 / 系统托盘 | `src/main/main.ts:144-152`（globalShortcut）、`tray/trayManager.ts` | 部分等价 — notificationService 锁屏通知含 prev/play-pause/next；**仅 dev build 生效，Expo Go 禁用** | **小**（dev build 上已等价；Expo Go 属已知限制） |
| 10 | 收藏/历史页批量操作 | `src/renderer/pages/FavoritesPage.tsx`、`HistoryPage.tsx` | 缺失 — mobile 仅逐曲播放/取消收藏/清空 | **小** |
| 11 | 歌手详情"最新"排序 + 换源获取更多 | `src/renderer/pages/ArtistDetailPage.tsx`（热门/最新 tab） | 缺失 — mobile `artist/[id].tsx` 仅热门歌曲 + 专辑横滑 | **小** — core 已有 `getNeteaseArtistSongs(order)` |
| 12 | 歌单描述字段 | 桌面 `Playlist` 含 description | 缺失 — `stores/playlistStore.ts` 无 description | **小** |
| 13 | 搜索结果的"添加到歌单" | 桌面是 **stub**（`DiscoverPageV2.tsx:367`） | **已有且可用**（SongRow 更多菜单「加入歌单」） | **反向 gap**：mobile 领先 |
| 14 | 专辑详情页 | 桌面**无**（点专辑卡片直接 searchAll） | **已有**（album/[id].tsx weapi 详情） | **反向 gap**：mobile 领先 |
| 15 | 专辑页"猜你喜欢" | **桌面不存在此功能**（grep 仅 RecommendPage.tsx:91 推荐页歌单网格） | 已有等价物 — `app/(tabs)/recommend.tsx` | **N/A** — 两端现状一致，勿发明 |
| 16 | 下载管理页 | 桌面 /download 是 ComingSoon 占位 | 也是占位 | 双方共有缺口，并入 #1 |
| 17 | 播放日志 | 桌面无 | **已有**（settings.tsx + logsStore） | **反向 gap**：mobile-only |
| 18 | 推荐页（今日推荐+猜你喜欢） | RecommendPage.tsx | 等价（recommend.tsx） | **已对齐** |
| 19 | 播放模式（单曲/列表/随机） | playerStore getNextSong 三模式 | 等价（settingsStore PLAY_MODES） | **已对齐** |
| 20 | 歌词（全屏+点击跳转） | LyricsPage.tsx + LyricsDisplay.tsx | 等价（PlayerOverlay 歌词预览+全屏） | **已对齐** |
| 21 | 设置页 缓存/下载段 | CacheSection + DownloadSection | 缺失（有 API/代理/更新/日志/关于） | 并入 #1/#3 |
| 22 | 睡眠定时 / 音质选择 | 桌面无 | mobile 无 | 双方均无，勿发明 |
| 23 | 检查更新 | electron-updater | 已有（GitHub Releases + APK，镜像降级） | 已对齐（机制不同） |
| 24 | 播放历史去重/恢复 URL | HistoryPage.tsx | 等价（historyStore + fresh 重试） | **已对齐** |

## 风险项（依赖桌面独有基础设施，mobile 需重实现）

- **下载管道**：依赖 Electron 主进程（fs、mp3tag.js、abort、download:* IPC）——最大的单点缺口。
- **本地音乐**：music-metadata + fs 扫描，RN 生态无等价物。
- **磁盘缓存**：mobile `fileBackend.ts` 半成品（`keys()` 返回空、无大小统计、未接线）。
- **多源排行榜聚合**：chartAggregator + kugouApi 在 src/main/ 私有，迁移需先抽 core。
- **歌单导入**：依赖 renderer 侧 searchService/IPC + weapi。
- **代理设置在 mobile 真机可能无效**：RN fetch/axios 默认不走 http 代理，core 的 `injectProxyAgents` 是 Node agent 注入——需实测或仅提示。
- **锁屏/后台播放**：Expo Go 下显式跳过（setActiveForLockScreen 守卫），需 dev build 验证。

## 优先级建议

1. 下载（用户最可见，占位按钮已在 UI 暴露）
2. 缓存管理 UI（半成品 fileBackend 已就位）
3. 音量（成本小收益直接）
4. 队列管理 / 歌单批量操作
5. 排行榜聚合（需先迁 core）
6. 导入 / 本地音乐（成本最高，建议独立立项）

注意反向 gap：专辑页、搜索加歌单、播放日志 mobile 反而领先——对齐时不要回退 mobile 已有能力。
