# ADR: 悬浮歌词的双端共享契约——逐行可见性、设置面与视觉基线

- 状态：**已接受**（2026-11-19，wayfinder #760 / #771 汇总；实施票 #774 / #775）
- 日期：2026-11-19
- 关联：**#628**（父需求）· **#760**（地图）· **#771**（汇总票）· #764（数据面与可见性）· #765（桌面交互）· #769（设置与持久化）· #770（视觉）· ADR `2026-11-19-desktop-lyric-overlay-window.md` · ADR `2026-11-19-android-lyric-overlay-service.md` · 调研 `docs/research/2026-10-29-kuwo-lrcx-word-timed-lyrics.md` · 实施规格 `docs/specs/2026-11-19-lyric-overlay.md`

## 背景

#628 立项时 core 的 `parseLRC` 只产出 `LyricLine{time,text}`，原文把「core 只有行级歌词」当成前提。该前提**已过时**：core 现已产出 `LyricLine.words`（酷我 lrcx 逐字轨道，`packages/core/src/utils/lyricsParser.ts`），桌面主窗 `LyricsDisplay` 已消费逐字；移动端尚未消费。`[offset:…]` 与译文仍未支持（`hasTranslation` 恒 false）。

即便逐字数据已存在，一期悬浮歌词仍决定**只做逐行**（#764）：#628 验收写明「逐行即可」；#761 冒烟中持续 60fps rAF 被用户报告明显卡顿；Android 原生进度与 FGS 边界也不适合逐字插值；双端要求同档。逐字作为二期另票，`words` 数据保留，不删不改。

两端若各自定义可见性、设置面与视觉，必然分叉；本 ADR 只固定**难以回退且确实有取舍**的共享语义，具体像素 / 颜色 token 以 #770 为准，允许实现期微调。

## 决策

### 1. 一期只做逐行

覆盖层显示「当前行 + 下一句」纯文本，不消费 `LyricLine.words`，不做填色 / 卡拉 OK。桌面主窗 `LyricsDisplay` 的逐字现状不变；`words` 数据保留，二期另开票。`[offset:…]` 维持忽略，`hasTranslation` 维持恒 false；不扩 core。

### 2. 行推导唯一口径

两端都只订阅宿主既有 `planLyricsFetch` 的加载结果：**零取词、零判源**，不在覆盖层再取一次歌词。core **不新增字段、不新增选择器**；复用 `findCurrentLyricIndex`：

```text
idx = findCurrentLyricIndex(lines, position)
current = idx >= 0 ? lines[idx]     : null
next    = idx >= 0 ? lines[idx + 1] : lines[0]
```

前奏（`idx < 0`）：current 空、next 取第 0 行（与移动端 `PlayerOverlay` 现有预览同口径）。末行无下一句：第二行留空；内容在固定外框内垂直居中，不随行数改窗口 / 视图尺寸。

### 3. 可见性状态机（双端一致）

| 状态 | 桌面 | Android | 说明 |
|---|---|---|---|
| 无歌词 / 纯音乐 / 取词失败（解析 0 行） | 隐藏 | 隐藏 | 不区分三者；不新增纯音乐检测 |
| 歌词加载中 / 切歌后新词未就绪 | 清旧词并隐藏 | 同 | 不显示骨架 / 占位，不残留上一首 |
| 前奏（`idx < 0`） | 第 0 行在「下一句」位 | 同 | 当前行留空 |
| 播放中 | 当前行 + 下一句 | 同 | 随 position 换行；逐字不做 |
| 暂停 | 冻结当前行 | 同 | 进度停在暂停点；暂停中 seek 仍跟随；不变暗 |
| 队尾自然结束 | 隐藏 | 隐藏 | 桌面队尾落 `stop()`；Android 以 `queueEnded` 作 ended 信号 |
| 停止 / 无当前曲 / 播放错误 | 隐藏 | 隐藏 | 不残留 |
| App 前台 / 后台、主窗最小化 / 隐藏到托盘 | 不影响 | 不影响 | 只跟播放状态；Android 前台时也浮在本 App 上 |
| 锁屏 | 平台遮挡，不可见 | 平台不可见 | 两端均无产品语义 |
| 开关关闭 | 立即隐藏 | 立即隐藏 | #628 验收 3 |

细则：

- **「暂停」与「队尾结束」必须区分**：暂停冻结、队尾隐藏。Android 侧 `onQueueEnded` 现在落 `pause()`，覆盖层语义层需单独接 `queueEnded`，不能只看 `isPlaying`。
- 覆盖层可见性不依赖宿主窗口 / App 前后台状态。
- 桌面 `visible` 由主窗渲染层按本表计算；Android 由原生按表 + `setLyricLines` / `queueEnded` / 播放状态执行。

### 4. 设置面与持久化

一期只有**开关 +（仅桌面）字号**：

| 项 | 桌面 | Android |
|---|---|---|
| 开关 | 播放栏右侧「词」按钮；默认关 | 播放器「更多」→「歌词浮窗」+ Switch；默认关 |
| 字号 | 复用「设置 → 外观 → 歌词字号」`standard` / `large` | 固定 sp，随系统字体缩放；无 App 内控件 |
| 透明度 | 不设 | 不设 |
| 主题跟随 | 不设（固定深色） | 不设（固定深色） |
| 下一句 | 固定显示 | 固定显示 |
| 锁定 / 穿透 | 不设 | 不设（仅前台可拖，其余自动穿透） |
| 位置 | 按 `display.id` 记忆；右键「重置位置」 | 原生记忆；无重置 UI |
| 全局「恢复默认设置」 | 不做 | 不做 |

持久键：

| 端 | 键 / 字段 | 载体 |
|---|---|---|
| 桌面 | `floatingLyricsEnabled`（boolean，默认 false） | 渲染层 localStorage |
| 桌面 | `lyricsSize`（`standard` / `large`，默认 `standard`） | 渲染层 localStorage `mplayer.appearance`（现有字段） |
| 桌面 | `floatingLyricsBounds`（`Record<displayId, {x,y,width,height}>`） | 主进程 `settings.json` |
| Android | `floatingLyricsEnabled`（boolean，默认 false） | Zustand persist `settings-storage` + 原生 SharedPreferences 镜像 |

不持久化 attached / visible / 权限态 / timing 表。桌面 `enabled=false` 立即销毁窗口（即使当前 `visible=false`）；桌面快照新增 `enabled` 与 `lyricsSize`；Android 启动与每次 `serviceState` 变化时由 JS 单向回灌原生开关，原生永不反向改 JS。

### 5. 视觉基线

结构层面固定（跨端同一套）：

- **单胶囊双行**：当前句在上、下一句在下，居中；当前句最多 2 行，下一句 1 行省略；固定外框，末行 / 前奏留空位不改变外框。
- **固定条宽**：桌面只随字号档位变化（`standard → M`、`large → L`；`S` 只留在 #770 原型，不进产品），不随每行文本跳动；Android 条宽以屏宽 62% 为上限、竖 / 横屏同口径，避让挖孔与手势条。
- **固定深色**：一期不跟随 `themeMode`，不设主题开关；深色底 + 白字 + 阴影，不做描边文字，不用纯文字无底方案。浅色 token 留在 #770 原型，需要时另开票。
- **桌面交互反馈**：整条可拖、无独立把手；hover 时条外 3px 虚线框 + `grab` 光标；无锁图标 / 锁态提示；「词」按钮开 = 强调色文字 + 淡底 + 强调边，关 = 弱化文字无底。
- **Android alpha 预算**：窗口 `alpha ≤ 0.8`，有效底约 0.5；条外全透明，紧 bounds。

具体字号、颜色、圆角、间距、阴影取值以 #770 决议为准；本 ADR 只冻结「两行 / 固定外框 / 固定宽档 / 深色 / 无锁定」这些结构调整成本较高的部分，颜色与像素微调不需要新 ADR。

### 6. 命名与跨端一致性

- 用户文案：桌面「词」、Android「歌词浮窗」；现有歌词页入口不改名。
- 持久层统一 `floatingLyricsEnabled`、`floatingLyricsBounds`（用户领域词「悬浮歌词」）。
- 运行时 API：桌面通道 `lyricOverlay:*`；Android `setLyricOverlayEnabled` / `getLyricOverlayState` / `LyricOverlayController`。不因设置票改名。
- 语义层完全一致，不设平台特例；仅存平台强制差异：锁屏两端不可见；Android `alpha ≤ 0.8` + 紧 bounds；队尾 ended 信号来源不同（桌面 `stop()`、Android `queueEnded`）。

## 备选与否决

| 备选 | 否决理由 |
|---|---|
| 一期消费 `LyricLine.words` 做逐字填色 | #628 只要求逐行；#761 原型持续 60fps 造成可感知卡顿；Android 进度 / FGS 边界不适合；双端同档优先（#764） |
| 「下一句」做成开关 / 第三行 | 两行是产品定稿；开关增加设置面与布局分支（#764 / #769） |
| 条宽自适应文本 / 随行数改窗口 | 每行 `setBounds` 抖动，且与「固定外框」冲突（#764 / #765） |
| 跟随系统主题 / 透明度滑杆 | 浮在任意应用上，固定深色 + alpha 预算更稳；透明度滑杆可把 Android 下层触摸调坏（#769 / #763） |
| 锁定 / 穿透作为用户设置 | 桌面一期取消锁定（#765）；Android 仅前台可拖（#767） |
| 两端各自定义语义 | 分叉后很难发现；可见性 / 设置 / 视觉必须同一口径（#764 / #769） |
| 为覆盖层扩 core 字段 / 选择器 | 现有 `findCurrentLyricIndex` 足够；扩 core 会牵动双端歌词渲染（#764） |

## 后果

- 一期产品能力有明确上限：只有两行、只有深色、只有开关 + 桌面字号、无锁定、无逐字；用户不能调透明度 / 主题 / 下一句。
- 长句会被截断（当前句 ≤ 2 行，下一句 1 行省略）；固定外框不随内容变化。
- Android 受系统权限与 ROM 行为约束；桌面受 Windows 置顶 / 多显示器边界约束（见各端 ADR）。
- 逐字、译文、offset、锁定 / 穿透、浅色主题、第三档字号、长期常驻 FGS 都是二期或后续票，不在本契约内。
- #628 的原始验收 2 / 3（锁定态穿透、两端设置页开关）与 out-of-scope 的「core 只有行级」前提已由本 ADR 与 #765 / #767 / #768 / #769 修正。

## 参考

- 票：**#628** · **#760** · **#771** · #764 / #765 / #769 / #770 · 实施票 #774 / #775
- 对应 ADR：`2026-11-19-desktop-lyric-overlay-window.md` · `2026-11-19-android-lyric-overlay-service.md`
- 调研：`docs/research/2026-10-29-kuwo-lrcx-word-timed-lyrics.md`（`LyricLine.words` 的来源与边界）
- 实施规格：`docs/specs/2026-11-19-lyric-overlay.md`
