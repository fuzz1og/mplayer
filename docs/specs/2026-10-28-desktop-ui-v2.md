# 桌面端 UI 收口 v2 — SwiftUI 观感（2026-10-28）

> 状态：已与用户逐项确认（grilling 第一轮 Q1–Q7、第二轮 Q8–Q15、标题栏/Q16–Q18 修正）。
> 基线：`feat/ui-redesign-1.9.0`（PR #691）之上继续收口；本规格只覆盖 P0，P1 留下一轮。
> 设计目标：macOS 桌面原生感（SwiftUI），不是 iOS 大卡片风。

## 1. 问题

1.9.0 的新语言只落在设置、资料库、全屏播放器与标题栏/播放栏的一部分。15 个产品路由中 13 个仍是旧版/半旧版页面壳；共享 `SongList` 还是 64px 行、44px 封面、sticky 表头、操作常显，而资料库另建 `LibrarySongTable`（46px、30px 封面、无表头、hover 操作）。结果是一个页面像新版，其余 8 个列表页仍旧。

## 2. P0 范围（本轮）

### 2.1 共享歌曲列表（唯一列表协议）

- 把「资料库密度」做成 `SongList` 的 `density="library"` variant；删除 `LibraryPage` 内的 `LibrarySongRow` / `LibraryRowTail` / `LibrarySongTable`，资料库回用 `SongList`。
- 行规格：46px 高、30×30 封面（圆角 4）、标题 15/600、meta 11 tertiary、专辑 13 tertiary、时长列 13 tertiary、行操作 hover/focus 才出现。
- 行尾只保留一个 28px 圆形 `MoreHorizontal` 按钮；下载、收藏、加入歌单等收进行菜单，不再并排三个图标。
- 保留页面能力：选择/批量（Favorites/History/Album/DiscoverPlaylist 保持现有常显 checkbox 与批量动作）、换源、拖拽（PlaylistDetail/Queue 继续用 `VirtualSortableList` + `SortableSongRow`，不把 dnd 并入 `SongList`）、无限滚动、空态/骨架。
- 统一 queue contract：`onPlay(song, queue, index)` 由列表调用方提供；`SongList` 不再隐式 `setCurrentPlaylist`。
- 修复既有 props 漂移：`AlbumDetailPage` / `DiscoverPlaylistDetailPage` 的批量下载必须传 `onBatchDownload`；批量删除要么接上，要么删掉入口。

### 2.2 页面壳

新增两个布局组件：

- `PageHeader`：h1 28/700 + 同行 lead/统计（13 tertiary）+ 右侧动作；不再使用旧 `.list-page__head` / `.detail-page__nav` / 二级 60px 标题栏。
- `PageSurface`：内容区背景 `--surface-content`，内容分组用 `Group` 卡片（12px 圆角、无边框、发丝线仅用于行内分隔）。

页面处理：

| 页面 | 页头 |
|---|---|
| Favorites / History | 标准 `PageHeader`（标题 28/700 + 数量/说明 + 播放全部） |
| Album / Artist / PlaylistDetail | 保留 hero（封面/头像 + 标题 + meta + 主操作），但去掉标题栏下的 60px 二级栏，hero 放进标准页面流 |
| Hotlist / Discover 搜索 / DiscoverPlaylistDetail | 标准 `PageHeader`；批量栏与筛选条保留 |
| Library | 保持现有 28/700 页头 + 五段 pill，仅把列表换成共享 `SongList` |
| Queue | 保留队列特殊布局，行样式跟随共享 variant |

### 2.3 标题栏 / 侧栏（chrome）

- **无 logo**：标题栏左列与侧栏品牌位都不再显示 MPlayer 品牌；应用身份由窗口标题与任务栏承担。
- 标题栏：左列 `‹ → 设置 帮助`（文字，**无竖线分隔**）；中部 420px 搜索；右侧窗口最小化/最大化/关闭；设置与帮助都在左列。
- 「检查更新」收进「帮助」下拉菜单（菜单项：检查更新、关于）；有更新时帮助上显示小红点，不单独占用标题栏按钮。
- 侧栏：背景改 `--material-chrome` + `--material-blur`，删除右边框与品牌带；外观页「侧栏与播放栏使用半透明材质」开关必须真正作用于侧栏。
- 标题栏/侧栏/播放栏之间不再画 1px 硬边框，改用材质与明度差分层；内容滚动时才显示边线（实现可用 scroll shadow）。

### 2.4 播放栏

- 三列 grid：左右各 `1fr`、中列 `auto`，播放键真正位于窗口光学中心；1024 宽下仍成立。
- 左：52px 封面（点击进全屏播放器）、歌名/艺术家、收藏。
- 中：上一 / 播放 / 下一 + **单个播放模式按钮**（循环顺序：`列表循环 → 随机播放 → 单曲循环 → 列表循环`；图标映射 `Repeat / Shuffle / Repeat1`；`aria-label="播放模式：随机播放"`，不用 `aria-pressed`）+ 进度条。
- 右：队列、更多、音量；移除重复的「歌词」麦克风按钮（封面已承担该入口）。
- 音量默认收起为图标 + hover/focus 弹出滑杆（键盘可达，静音点击保留）。
- 更多菜单：加入歌单、下载、收藏等低频动作；菜单补 ESC 关闭、焦点归还与方向键导航。
- 图标统一 16px stroke（播放键内部 20 除外），右侧图标分组间距 8px，音量组前 16px。

### 2.5 文案

- 统一使用 **「我喜欢的音乐」**：侧栏、页面 h1、空态、测试与 aria 全部一致；`我的收藏` 从界面文案中移除。
- 「收藏 / 取消收藏」只作为动作词保留。

## 3. P1（不做）

- macOS 原生交通灯（用户明确不做；继续 Windows 自绘窗口按钮）。
- Dialog/浮层材质与 20px 圆角、DownloadProgressModal 改 Dialog。
- 7 个设置分区旧页头统一、旧页面胶囊按钮统一。
- 移除 router 全局 `songlist.css`、暗色全量走查、`t-*` 排版工具类、图标尺寸 token、`design-lint` 补 `style={表达式}`。

## 4. 验收

- 8 个列表页全部使用同一 `SongList` 密度；任意列表行高 46px、封面 30px、操作 hover 才出现；资料库不再有私有列表实现。
- 页面壳：Favorites/History/Album/Artist/Hotlist/PlaylistDetail/Discover 搜索/DiscoverPlaylistDetail 均使用 `PageHeader`（详情页 A 方案保留 hero）；旧 60px 二级栏在所有页面消失。
- 标题栏无 logo；左列 `‹ → 设置 帮助`；帮助菜单含检查更新；侧栏材质开关生效。
- 播放栏：1024/1280/1400 三个宽度下播放键居中；模式按钮三态循环正确；音量 hover/focus 展开；无重复歌词按钮。
- 文案：全仓界面不再出现「我的收藏」作为集合名。
- 测试：typecheck、lint、design-lint --desktop-strict、相关页面单测；真实 Electron 截图 8 页 + 标题栏/播放栏。
- 深色/浅色都至少跑一遍 8 个列表页与设置页截图。

## 5. 设计事实

- 原型：`.proto/page-shell-options.html`（A/B 页面壳）、`.proto/titlebar-options-left.html`（标题栏）；截图在 `shots/proto-*`，不入库。
- 当前列表分叉根因：`src/renderer/pages/LibraryPage.tsx:39` 曾明确「不修改 SongList / SongRow」，另建 `LibrarySongTable`（:187-249）。
- 播放模式类型唯一来源：`packages/core/src/types/index.ts:172`（`单曲循环 | 随机播放 | 列表循环`）；移动端同一顺序 `packages/mobile/stores/settingsStore.ts:20`。
