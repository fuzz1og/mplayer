# MPlayer 架构细节

低频参考：主进程/渲染进程结构、IPC 通道契约。每轮决策需要先读此处（配合 `GLOSSARY.md` 与 `docs/adr/`）。

## Desktop (Electron)

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, `webSecurity: true`。渲染层**没有** Node/require 能力，唯一 IPC 入口是 preload 桥 `window.electronAPI`（`src/main/preload.ts` + 契约 `src/shared/electronAPI.ts`）；主进程侧对每个 handle 做 sender 校验（`isTrustedIpcSender`/`checkIpcSender`）。

### Main Process (`src/main/`)

| File | Role |
|------|------|
| `main.ts` | Entry. BrowserWindow (1400×900, `frame: false` 自绘标题栏, autoHideMenuBar, show:false), preload 桥 + IPC 注册, global shortcuts, tray |
| `preload.ts` | 唯一 IPC 桥：`contextBridge` 暴露 `window.electronAPI`；渲染层不 import 主进程模块 |
| `env.ts` | 启动早期环境设置（`ELECTRON_GET_USE_PROXY` 等），`main.ts` 首行 import |
| `hidpi.ts` | WSLg HiDPI 修复：读 Windows AppliedDPI → 强制 `force-device-scale-factor`；非 WSL 跳过；`MPLAYER_UI_SCALE` 可覆盖 |
| `proxy.ts` | Electron session proxy config |
| `api/musicApi.ts` | 壳：re-export core `musicApi` / client 配置（HTTP 客户端逻辑在 core） |
| `cache/diskBackend.ts` | 磁盘缓存后端（音频、封面、歌词；constructor 注入 cacheDir） |
| `cache/binCacheBudget.ts` | 汽水音频缓存的容量预算与**按 key 前缀精确回收**（#412）：用后端 `keys()` 拿真实 key 再筛前缀，不扫目录（`cache/bin` 里还有渲染层写的条目）；keys/stat/unlink 全异步，调用方 fire-and-forget |
| `storage/fileStorage.ts` | Primary persistence (favorites, history, playlists, settings，JSON 文件存储)；启动时跑旧签名端点迁移（清 `api.php?get=*` 的 url/cover/lrc 与 audioTag/nonFull） |
| `storage/db.ts` | 兼容壳：re-export `getFileStorage()` |
| `cookies/cookieAdapter.ts` | core `cookieManager` 的桌面落盘 adapter |
| `utils/fsAsync.ts` | 异步存在性检查（`fileExists`）——主进程请求路径不用 `fs.existsSync` 同步打磁盘（#412） |
| `ipc/*.ts` | `registerHandler` 辅助 + 各域注册（appSettingsUpdate / cache / favoriteHistoryPlaylist / localMusic / musicApiHandlers / playbackTrace） |
| `services/` | downloadService(进度按 150ms 聚合后推 IPC) / localMusicService / updateService / playbackTraceService(播放解析链 trace 会话内环形缓冲 + 导出 JSON) / playlistLinkResolver(歌单链接 → 目标源歌单) |
| `tray/trayManager.ts` | System tray + context menu |

> **写盘口径**：`storage/fileStorage.ts` 的 `saveData()` 是 **200 ms 防抖的脏标记**（`markDirty → scheduleWrite`），多次调用会被 `drainDirty / writeDomains` 合并成一次原子写（写 `.tmp` + rename）。**凡是要下「N 首 = N 次落盘 / 大列表会卡在写盘」这类结论，先读这里**——实测：一次批量 IPC（200 首）与逐首 5 次 IPC 都只产生 **1** 次物理写，两次路径的差别在渲染↔主进程的调用次数，不在物理写次数（2026-10-01 实测，见 #514 验收评论）。

### Renderer Process (`src/renderer/`)

- `router/index.tsx` HashRouter 全懒加载；页面在 `pages/`（推荐/发现/热榜/收藏/历史/歌单/队列/本地/歌手/专辑/歌词/设置等）
- `store/` Zustand：playerStore, searchStore, favoriteStore, downloadStore, localStore
- playerStore 播放失败处理（#385 / #397）：处置由 core `shared/skipGuard` 单一决策（`decideAfterPlaybackFailure`）——同曲 fresh 重试一次（`forgetPrefetchedUrl` + 重走路由链）→ 仍失败即「终局失败」，core 记一次（计数 +1、记住这首歌）后按优先级决策：**离线 → 停**（不进解析链）／**关闭「失败即跳」→ 停**／**队列没有别的歌 → 停**／**连续失败达固定上限 3 首 → 停**（与队列长度无关）／否则跳下一首（跳歌时跳过坏歌记忆里的歌）。计数**只在真正开始播放时归零**（手动点歌不清零）；离线 predicate 与「失败即跳」偏好由宿主注入（偏好默认开，设置页可关），停播文案 core 单一来源。下一首 URL 预取统一写 core 预取缓存（30min TTL、失败可遗忘），渲染层不再自建 URL Map；播放成功后的簿记异常（历史/队列/封面）不参与失败判定，避免误跳歌
- `services/` audioPlayer(Howler), playbackClock(播放位置/时长读模型：点击/拖动/键盘 seek + seek 乐观值防回跳 + 叶子窄订阅，位置/时长不进 store), searchService, sourceSwap, artistMetaCache, importService(文本/链接歌单导入；链接导入的写入腿走下面的 adapter 批量腿), playlistWriteAdapter(**桌面唯一的歌单写入 adapter**——#552：宿主只留两个回调「读目标快照」(`playlist:getSongs`) 与「同名时怎么办」(`resolveNameConflict`)，IPC 形状与编排（`playlist:addSongs`/`create`/`delete`）藏在其后；三份复制 helper 与四处手写编排的唯一落点), IpcClient, callMusicApi, devMode(开发者模式开关：localStorage 持久化 + `isDiagnosticsEnabled()` 详细度总开关), rendererLogStore(渲染层日志环形缓冲：全局捕获 console、约 30 行、只在诊断开启时记录) 等
- `components/` PlayerBar/SongList/SongRow/LyricsDisplay 等通用件；设置页「播放诊断」区 `PlaybackDiagnosticsSection.tsx`（trace 快照 / 导出 / 清空）
- **歌曲列表模块**（#302 整合；窗口化自 #428 起是**共享能力**而非 `SongList` 独占）：窗口化 = `hooks/useVirtualRows`（自动挂靠页面已有滚动容器、`plain/pending/virtual` 三态兜底）+ `components/VirtualRow`（只吃 `start/size/scrollMargin` 三个数字的 memo 定位壳），`SongList.tsx` / `GroupedSongList.tsx` / 队列页三个消费者共用；`SongRow.tsx` 是唯一行实现（能力位 + `dragHandle`/`actions`/`fillTitle` 插槽），`SortableSongRow.tsx` 是它的 dnd 薄包装（队列页/本地歌单页共用，排序索引数学在 `utils/reorder.moveItem` + `hooks/useSortableReorder`）；`VirtualSortableList.tsx` 把「窗口化 + 可排序」叠成一份能力（`SortableContext items` 传**全量有序 id**、被拖行走常驻 `DragOverlay`，见 ADR `2026-09-29-queue-virtualized-sortable-list.md`）。`SongList` 另有选中/收藏的 Set 索引与行级交互（下拉菜单/换源/勾选/批量栏/加入歌单弹窗），`GroupedSongList` 数据经 props（页面做 `searchStore` 适配器）。页面只做数据与语义回调的适配器，不感知测量细节。

## IPC Channels

约定 `domain:action`。渲染端 request/response 用 `invoke`，推送用 `on`。

**MusicApi** — 单通道分发（ADR-0001，#278 派生化更新）：`musicApi:call(method, ...args)`。契约 = `BASE_METHODS ∪ CONTENT_METHODS ∪ MainOnlyMethods`
（`src/shared/musicApiContract.ts`；内容方法自 `DirectSourceClient` 接口派生、带 `source` 首参）；渲染端泛型入口 `callMusicApi(method, ...args)`，
主进程基础/独有方法手写表 + 内容方法按 `CONTENT_METHODS` 清单循环分派到 `getDirectClient(source)`，未知方法返回失败封套。
加内容方法 = 直连客户端加方法 + `CONTENT_METHODS` 加字符串，其余自动（完整性测试兜底）。**不要在架构文档枚举方法清单**——那是契约文件的缓存。

**语义通道**（ADR-0002）：`cache:*`（getSongResources/setSongResources/clear/getStats；封面磁盘字节通道已随封面直链直渲移除）、
favorite/history/playlist/localMusic/settings/download/dialog/app/update/playbackTrace/**window** 各自的 `domain:action` 组（`window:minimize|toggleMaximize|isMaximized|close`，供自绘标题栏用）
（`playbackTrace:list|clear|export`，语义命名与 `settings:*` 同组）。
Push（main→renderer）：`download:progress|complete|error`, `localMusic:folderChanged`, `tray:action`, `shortcut:action`, `update:status`, `window:maximized`。
反向（renderer→main，`send`）：`tray:state`（当前歌/播放态，供托盘菜单显示）。

## Mobile (Expo/React Native)

expo-router Stack + Tabs：`(tabs)/`（推荐 / 发现 / 歌单 / 本地歌曲；搜索页 `href: null` 不占 Tab，由顶栏进入）+ player/favorites/history/settings/hotlist/playlist/[id]/discover-playlist/[id]/artist/[id]（下设 `artist/[id]/albums` 专辑时间线页，#417）/album/[id]。

- `modules/native-player/` 自写 Kotlin Expo Module（Android 播放引擎，ADR `2026-09-29-native-playback-ownership`）：`PlayerModule`（Expo Module 定义 + Record 入参）/`PlayerBridge`（media3 `MediaController` 连接 + HeadlessJsTask 补窗）· `PlaybackController`（ExoPlayer 持队列 + 原生推进）· `PlayerService`/`ServiceLauncher`（`MediaLibraryService` 媒体会话 / 前台服务 / 通知与锁屏）· `QueueStore`（原生队列模型与 load/patch）· `AdvancePolicy`（推进决策参数容器：只消费 JS 下发的 policy，语义源仍是 core `skipGuard`）· `ErrorPolicy`/`ErrorCodes`（原生错误分级：只分级，文案与坏歌记忆在 core）· `ExpiryGuard`（直链过期的本地拦截）· `PrefetchBridge`（原生补窗预取）· `Events`（模块级事件名，全部是「通知」性质、不驱动原生推进）。JS 侧入口 `index.ts`，接线在 `services/nativePlayer`
- `components/` TopBar, PlayerBar, PlayerOverlay, SongRow, DiscoverTabs, SourceSwapModal, AddToPlaylistModal 等；列表/网格封面统一走 `LazyCover`（同形占位 + 失败重试一次；**不设闸门**，并发靠 `listWindowProps` 窗口化）+ core `shared/coverUrl.ts` 的 `coverThumbUrl`（按**各源 CDN 机制**要缩略图：网易 `?param=WxH`、QQ 档位白名单（路径模板 `R{size}x{size}` 只有少数档位真实存在，请求档向下吸附——#537）、未验证机制的源原样返回——#496，ADR `2026-09-30-mobile-cover-loading`）；`SongList` 用 `viewabilityConfig` 的可见回调 + `components/songListHydration` 的**停稳闸**（可见集合 `VIEWPORT_SETTLE_MS` 内不再变化才按整屏入队，上滑中滚过的行不入队——#421）把「行进入视口」接到 core `lyricsHydrator` 预取歌词（#429）；**同一拍**还算出本次离开可见集合的 key 交给 `cancelLyricsHydration` 收回，卸载时只收回本列表入队过的 key
- `gestures/` 手势物理纯内核：`dragSession.ts`（拖拽关闭会话：位移/速度/判关，零 react-native 依赖，node 可测）+ `hooks/useDragToDismiss` 适配器——PlayerOverlay 与 BottomSheet 共用同一份物理。同目录 `dragJank`（#430）量「相邻 move 回调隔了多久」：拖拽跟手跑在 JS 线程，**跟手掉帧**是「回调被推迟」而不是「渲染变慢」，故与 `services/dragJankProbe` 现场、`scripts/mobile-frame-stats.mjs`（系统侧帧计时）合看才下判语
- `components/collapsingChrome.ts` 折叠头部纯逻辑核心（阈值 / 进度 clamp / 状态栏边沿，零 react-native 依赖，node 可测）+ `hooks/useCollapsingChrome` 原生驱动接线，专辑 / 歌手 / 网络歌单直接用 `CollapsingHero`，歌单详情经 `PlaylistHero` 适配层复用同一结构。原生**颜色**插值不结算 `extrapolate`（数值路径结算）——颜色节点前必须串数值 clamp 节点（`navBackgroundPlan`），否则滚过折叠点后通道越界回绕、条身跳色（#372）
- `hooks/` 适配器：useCollapsingChrome（折叠头部原生驱动接线）、useDragToDismiss、usePressMutex、useReducedMotion、useRefreshedCover
- `stores/` Zustand（部分 AsyncStorage persist）：player/settings/favorite/history/playlist/search/discover/source/download/downloadProgress/audioTag/logs/songActions
- `services/` audioPlayer(expo-audio)/nativePlayer(Expo Module 原生引擎桥：事件 / 状态 / 循环模式 + AppRegistry 预取任务；Android 走它、iOS 回落 audioPlayer), songResolution(播放 URL 解析的唯一出口——引擎与解析链互不依赖), notificationService, downloadService(SAF), queuePrefetch(预取窗口状态与定序：在飞 / 成功窗口 / 失败冷却三层去重，纯逻辑), queueInsert(「下一首播放」的队列插入规划：最终队列 / 插入下标 / 幂等判定；纯函数，下标数学只此一份), songResources(严格搜索 + core 刷新编排适配器)/sourceSwap, songListOps(列表内原位替换——函数式更新保单行 memo), legacyMigration, networkState(在线/离线 predicate，注入跳歌护栏), playlistLinkImport(歌单链接导入), playlistExport(**移动端唯一的歌单写入 adapter**——#552：`createMobilePlaylistWriter` 把本地 store 包成与桌面同形的两个回调交给 core `writeSongsToPlaylist`，写入按 `identityKey` 判重并回报宿主真实新增数（#554）；`exportSongsToLocalPlaylist` 是同文件薄封装，供网络歌单导出到本地歌单用), cacheService(身份键 + 可播资源值缓存), seekReconcile(松手后 seek 对账：旧心跳不得把乐观值拽回), appUpdate/coverSearchSlot/coverDiagnostics(封面加载失败埋点接缝)/perfMonitor(JS 帧率看门狗)/dragJankProbe(拖拽跟手采样与上报)/pressMutex/reducedMotion/sheetExit/songActionEffects/songSwapSession/playbackTrace(启动时注册 sink + 会话内环形缓冲 + 导出), devMode(开发者模式与诊断分级的单一判定点：isDevMode / isDevBuild / isDiagnosticsEnabled), shuffleMode(随机播放的移动端接线：洗牌序落盘与恢复、展示序；语义源是 core utils/shuffleOrder)

## Shared Package (`packages/core/`)

桌面/移动端共享。另有 `download/`（下载队列 / 标签 / 歌词落盘：container / queue / progress / tagging / lyrics）与 `cookies/`（cookie 管理器，宿主落盘走 adapter）。

- `api/` 请求层：7 源直连客户端（`neteaseDirect`/`qqDirect`/`kugouDirect`/`miguDirect`/`kuwoDirect`/`qianqianDirect`/`sodaDirect`，能力面 = searchSongs/getToplists/内容方法，IPC 契约见上节）；`musicApi` 薄门面（预取门面 prefetchPlayableSong/forgetPrefetchedSong、soda 分享解析等基础方法）；`qqPlaylist`/`playlistImport`（QQ 歌单解析与链接导入）；`neteaseWeapi`；`antiScrape`（UA 池/反同源连续）；`tlsFingerprint` + `transport`（可注入接缝，maxRedirects 透传）+ `outboundGate`（transport 内部接缝的出网闸门：全局 6 / 每 host 2 双层在飞上限、同 host FIFO、排队期间响应 abort；ADR `2026-09-26-outbound-request-governance`）；`prefetchCache`（写入方 = `prefetchPlayableSong` 门面，读 = 播放解析；键 = 歌曲身份键，值 = `PlayableResource`）、`audioProbe`（只剩 `isUrlAlive` 播放期直链活性闸）、`memoryCacheManager`。#391 已删探测链（`probeSongs`/`probeAudioUrl`/`probeSwapCandidates`/`PlaybackProbeTrace`）
- `cache/` 缓存内核（CacheKernel/SongResourcesCache）
- `shared/`：`sourceRouter`（来源开关 `auto|direct` 两态 + `sanitizeSourceModes` 洗白存量 'api'、直连客户端注册表、`searchSongsRouted`/`resolvePlayableSongRouted` 路由、`getToplistSongs`/`pickToplistGroup` + `TOPLIST_SOURCE_IDS`、tier3 跨歌在飞 K=3 槽位与初始化窗口的**槽位借用接缝**）、`sourceSchedule`（tier3 会话内源调度纯函数：健康度 EWMA 计分 / `orderSources` 只重排不筛选 / `beginInit` 单飞初始化窗口；模块级 Map、无 I/O、不落盘）、`playbackGuard`（护栏决策纯函数：L1 源自带时长 → L2 音频头 → L3 体积÷码率 → L4 仅文本 → L5 仅 source 声明，±2s；`pickDurationEvidence` 是时长证据降级链的**单一来源**，tier3 护栏与直连腿取证共用）、`audioDuration`（L2 时长取证：music-metadata 懒加载 + 头部时长可信性判定）、`audioHead`（一次 64KB Range 取头部字节 + 完整大小的取证接缝，tier3 嗅探与直连腿取证共用）、`directValidation`（直连腿播放时时长取证：仅无权威时长的源，判「比标称短」→ nonFull，证据不足 fail-open）、`playbackBudgets`（播放链路的**四层时限**单点常量表：单请求超时 / 墙 / 预算 / 传输重试与默认值，每项注明所属层与被谁覆盖——#399；其上的**解析链总预算** `RESOLUTION_CHAIN_BUDGET_MS` = 直连墙 + 一条 tier3 腿预算 = 9s（与 tier3 腿的「整链 6s 预算」不同层）——#424）、`resolutionBudget`（解析链总预算：墙钟（不暂停；K=3 排队照走） + `clamp(min(本腿墙, 剩余))` + 耗尽 abort 与 `ResolutionBudgetExhaustedError`；一次解析链创建一个、作为**参数**下传，不是模块级全局态——#424 / ADR `2026-09-28-resolution-chain-deadline.md`）、`skipGuard`（**跳歌护栏**：终局失败后的 `skip|stop` 纯决策 + 会话内连续失败计数/坏歌记忆；离线 predicate 与「失败即跳」偏好由宿主注入，文案单一来源）、`playability`（可播性叶子模块，避免 `sourceRouter → audioProbe → musicApi` 循环导入）、`searchOrchestrator`、`sourceSwap`、`songResourceRefresh`（可播资源刷新编排：取缓存 → 旧签名死链判定 → 精确匹配搜索 → 写缓存/写回，依赖注入）、`songLyrics`、`lyricsHydrator`（可见期歌词预取：#429 入队 / 同 songId single-flight / 取消（排队项从 transport 闸门摘除）/ 单次入队预算——**单次**上限 30 条、分批入队不受限；**并发与限速不在这里**，模块自身零 I/O、只调既有取词实现；消费端目前只有移动端，桌面另开票 #441）、`updateChannels`（更新镜像探速）、`playlistWrite`（**歌单写入编排**（#542/#553/#554）：入参含**目标歌单快照**（已有曲目 + 容量）与「同名异源怎么裁决」回调；每首歌的落点由本模块用 `utils/songDedupe` 的 `classifySong` 产出（new / duplicate / nameConflict / invalid），整批优先 / 批内去重 / 就地新建失败即回滚；`added` 是宿主回报的**真实新增数**，容量截断走 `truncated` 显式通道。双端各留一个 adapter——桌面 `renderer/services/playlistWriteAdapter`、移动 `services/playlistExport`）、`playbackTrace`（解析链 trace schema + sink 注册 + 环形缓冲；core 零 I/O，宿主落 sink）
- `utils/`（`songIdentity` 歌曲身份键：源 + 去源前缀真实 ID，多层嵌套按最外层源折叠；`songDedupe` 的 `classifySong` = **歌单写入「同一首歌」判据的唯一实现**（identityKey 同源判定 + 同源 name+artist 合流 + 跨源 name+artist 才算 nameConflict），`createPlaylistSnapshot` 造目标快照；songMatcher/lyricsParser/legacyUrl 等）
- `tier3/tier3Api` 订阅源执行器（`url-resolver`/`search-then-resolve`；每源候选过 `playbackGuard` 后才采用，不过护栏换下一个源；单源墙按 kind 分档 url-resolver 2s / search-then-resolve 2.5s 且**只计搜索 + 解析**（候选嗅探独立 1s、不占该墙、计入整链预算），路由层跨歌在飞上限 K=3 且排队不计入 6s 预算；跨层墙/预算值集中在 `shared/playbackBudgets.ts`，口径见 ADR `2026-09-27-playback-budget-layers`；#424 起 `control.signal`（整链预算耗尽）会中止在飞源请求并停止遍历后续源，剩余源记「放弃观测」）；清单能力扩展 idNormalize / redirect 响应 / 护栏字段（ADR `2026-09-23-tier3-manifest-capability-extensions`，schema 见 `docs/agents/tier3-manifest.md`）
- 播放解析结果 `RoutedPlayable` = `{ url, nonFull, via: 'direct'|'tier3', guard: PlaybackGuard }`（#361）：tier3 只替换流 URL，绝不铸造新身份；直连腿 `guard='none'`

```bash
npm run core:build   # 移动端 Metro 吃 dist 产物：改 core 后必须重建移动端才生效
```