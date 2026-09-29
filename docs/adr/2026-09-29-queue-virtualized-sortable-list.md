# ADR: 队列页虚拟化——窗口化挂载与 dnd-kit 共存

- 状态：已接受
- 日期：2026-09-29
- 关联：**#428**（本决策）、#412 / PR #422（前置：消掉整表重渲染，并把本项列为已知取舍）、#441（桌面端「行进入视口」信号的下一个消费者）

## 背景

#412（PR #422）修掉了队列页「播放状态一变整表重渲染」，但把**队列页无虚拟化**列进了已知取舍表，给的技术理由是：

> dnd-kit 的 `SortableContext` 需要所有 sortable item 在册，行被虚拟化卸载后拖拽测量会失效；真正的虚拟化要配 `DragOverlay` 单独做

**这句话的前半句是错的**，而且它已随 PR 合并写进仓库历史（正文与评审复验段落各一处）。三条一手证据：

1. **官方 legacy 文档**（本仓用的就是 v6 这套）：`rectSortingStrategy`「This strategy **does not support virtualized lists**」；`verticalListSortingStrategy`「This strategy is optimized for vertical lists, and **supports virtualized lists**」——队列页用的正是后者。`SortableContext` 对 `items` 的要求只有「a sorted array of the unique identifiers associated with the elements that use the `useSortable` hook within it」+「sorted in the same order in which the items are rendered」，**没有任何"必须包含未挂载项"的要求**。
2. **安装源码**（`node_modules/@dnd-kit/sortable@10.0.0`）：每项的排序下标来自 `items.indexOf(id)`，与 DOM 顺序无关；`getSortedRects` 以 `Array(items.length)` 归位、未测量项留洞；挂在拖拽中被卸载的场景由 `@dnd-kit/core` 的 `useCachedNode` 显式兜底，其注释原文：`// This is the case for virtualized lists. In those situations, we fall back to the last known value for that node.`
3. **官方还专门为虚拟化列表写了文档与示例**：三个 storybook 示例（react-window / react-virtual / react-tiny-virtual-list）。后半句的 `DragOverlay` 反而被文档支持，见决策 4。

队列长度不是假想值：**7 个入口**会把整份集合塞进队列并 `persistQueue` 落盘——`AlbumDetailPage`、`DiscoverPlaylistDetailPage`、`FavoritesPage`、`PlaylistDetailPage.handlePlayAll`、`ChartPanel`、`SongList.handlePlaySong`（按行点播）、`QueuePage` 自身。三千首收藏就是三千首队列。

O(队列长度) 的挂载成本有四项，**只有一项是"DOM 节点多"本身**：① React 挂载（N 个组件实例 + fiber + hook，一次同步提交）；② **每行的挂载副作用**——`SongRow` 在 `song.cover` 为空时挂载即触发一次封面重识别，收藏/历史里没存过封面的歌，一进队列页就是 N 个任务进并发闸门排队；③ 浏览器样式计算与布局；④ 常驻内存。②是本仓最重、也最容易被忽略的一笔。

**动机强度必须写明**：本项来自 2026-09-26 桌面端**纯静态**评审 D11，**没有用户报告**；桌面端也**没有任何**帧率/挂载耗时埋点（`services/perfMonitor.ts` 只在移动端，它是 #411 / #421 / #430 的口径）。所以本决策的依据是「这个形态随队列长度线性增长、是错误的形态」，**不是**「实测到了卡顿」——后来人不得把本 ADR 当作实测结论引用。

## 决策

1. **队列页改为窗口化挂载**，复用既有 `hooks/useVirtualRows` + `components/VirtualRow`（与 `SongList` / `GroupedSongList` 同一份实现），不再裸 `map`。
2. **抽出共享能力**（"窗口化 + 可排序"列表，队列页只做数据与语义适配）。**本地歌单页接入留另票**：本票只保证该能力可被复用，不扩大回归面。
3. `SortableContext` 的 `items` 必须是**全量有序 id**（不是窗口内的 id）——它是排序下标的唯一来源，也必须是 memo 化的稳定引用。
4. **加 `DragOverlay`**，被拖行在 overlay 中渲染（用**非 sortable** 的行实现，否则同一 id 会二次注册）。依据是官方对虚拟化列表的最强措辞：「If your `useDraggable` items are within a virtualized list, you will **absolutely want** to use a drag overlay, since the original drag source can unmount while dragging as the virtualized container is scrolled.」overlay 常驻挂载（官方要求），渲染在**滚动容器之外**以免被 `overflow` 裁剪。
5. **`setNodeRef` 留在行本身**（`SortableSongRow` 内部），**禁止**挪到被 `translateY` 定位的 `VirtualRow` 包裹层上：dnd-kit 测量时用 `getTransformAgnosticClientRect` 剥离**被测元素自身**的 transform，挂错层会让所有行的 rect 塌到同一位置、拖拽静默失效。
6. 行高沿用固定 `SONG_ROW_HEIGHT = 64`，不引入动态测量（`verticalListSortingStrategy` 本身就假设等高行）。
7. 阈值沿用 `VIRTUALIZE_THRESHOLD = 30`，不另立一套；沿用 `useVirtualRows` 的 `plain / pending / virtual` 三态兜底（探不到滚动祖先或窗口为空时退回整表）。
8. **排序语义不变**：仍在 `onDragEnd` 提交（`useSortableReorder` → `playerStore.reorderQueue`），**不**改成拖拽中实时重排——官方新版示例用的是 `onDragOver` 实时重排，但本仓 `reorderQueue` 会 `persistQueue` 落盘，逐帧写不可接受。
9. **验收口径**：500 首时挂载行数与视口成正比（DOM 计数，可断言）+ 拖拽正确性手测清单（中部拖到首/尾、快速连续拖拽、拖到视口外）。**明确不以「滚动零掉帧」为验收**：桌面端没有埋点，且列表层之外还有别的掉帧来源（移动端 #421 就是列表层优化后仍可复现的例子）。

## 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| 分页 / 懒加载替代虚拟化 | 只治首屏、不治常驻（已加载页数无上界）；滚动条长度不再等于队列长度；队列页失去按 index 定位的能力；与本仓另一端的取向相反（移动端队列用 `FlatList` 原生窗口，不是分页） |
| 自研位移计算、抛掉 dnd-kit | 票面引用的"纯内核"是移动端**竖直拖拽关闭**手势（`packages/mobile/gestures/dragSession.ts`），与列表排序位移不是同一能力、无可复用；等于重写一份 dnd-kit 已经写好的实现 |
| `content-visibility: auto` + `contain-intrinsic-size` | 保留全部 DOM，因而**保住 Cmd+F 与无障碍**，但治不了 React 挂载与每行挂载副作用（背景②）这两笔最重的成本；本票收益会缩水成"滚动更顺"，不是本票目标 |
| 拖拽期间临时全量挂载 | 2000 首队列等于在拖拽那一刻把本票收益全还回去；实测也不需要——挂载/卸载会触发 rect 表重测，未挂载项本来就当不了落点 |
| 改排序策略（`rectSortingStrategy`） | 官方明说它**不支持**虚拟化列表 |
| `onDragOver` 实时重排（官方新版示例做法） | 本仓 `reorderQueue` 会 `persistQueue` 落盘，拖拽中逐帧写 store 不可接受；且那些示例属新版 API（`@dnd-kit/react`），本仓在 legacy v6 |
| 给 `SongList` 长出排序能力、把队列页改写成 `SongList` + sortable | 队列页行布局与 `SongList` 不同（`albumWidth`、固定操作列），合并会让唯一行实现长出第二套形态；本票只抽"窗口化 + 可排序"这一层能力 |

## 后果

- **得到**：队列页挂载行数与视口成正比；每行的挂载副作用（封面重识别）从"进页面 N 个任务"变成"滚到才发生"；队列页与两个既有列表共用同一份窗口化实现。
- **实测（本 PR 内，Chromium + 500 首队列，DOM 计数而非帧率）**：首屏挂载 `.song-row` **17** 个（改前 = 500）；滚动容器内容高 **32043px**（≈ 500×64 + 表头，即滚动条仍反映整份队列）；滚到中段后行号仍是全量下标（291 → 292）；窗口内拖拽（第 1 首 → 第 6 位）与**拖到视口外**（autoScroll 实际滚动 920px、源行已被卸载、body 上的 `position: fixed` overlay 仍在渲染被拖行）都提交成功。
- **代价（用户可见，维护者已明确接受）**：**Cmd+F 只能找到窗口内的行**、屏幕阅读器读不到屏幕外的行——这是 DOM 虚拟化的固有代价（react-beautiful-dnd 的虚拟列表文档把这两条列为 drawbacks）。本仓现状：队列页没有"在队列内搜索"的入口，故接受。
- **代价（性能侧，需记账）**：拖拽期间每次窗口变化都会让 dnd-kit **全量重测已挂载行**（每行一次 `getBoundingClientRect`），首屏收益换来的正是这笔拖拽期边际成本；窗口变化本身还有挂载/卸载成本（图片未缓存时需重新解码）。
- **既有边界（未改变）**：队列里同一首歌出现多次时，dnd-kit 的 id 索引本就歧义（`items.indexOf(id)` 只认第一个），拖拽排序对重复项不可用——本决策不修复也不放大这条限制。
- **范围**：只覆盖桌面队列页。`PlaylistDetailPage`（本地歌单页）同样全量挂载、且 `items={songs.map(...)}` 每帧新建数组、守卫测试未覆盖——留另票。
- **文档同步**：`docs/agents/architecture.md`「歌曲列表模块」段落中「`SongList.tsx` `独占`虚拟滚动与滚动测量」不再成立（虚拟化从此有第三个消费者），同 PR 改写。
- **纠正落点**：PR #422 正文与评审段落里那句「`SortableContext` 需要所有 sortable item 在册」以后由本 ADR 纠正；引用该句时应指向本文件。

## 参考

- dnd-kit legacy 文档：`presets/sortable/sortable-context`（strategy / items）、`api-documentation/draggable/drag-overlay`；三个虚拟化示例在仓库 `apps/stories/stories/react/Sortable/Virtualized`
- 本仓实现：`src/renderer/hooks/useVirtualRows.ts`、`src/renderer/components/VirtualRow.tsx`、`src/renderer/hooks/useSortableReorder.ts`、`src/renderer/utils/reorder.ts`
- 相关票：#412 / PR #422、#441
