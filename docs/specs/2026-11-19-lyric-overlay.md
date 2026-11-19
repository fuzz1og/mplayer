# 悬浮歌词（桌面 + Android）— 实施规格（骨架）

> 日期：2026-11-19 · 状态：骨架（待实施） · 来源：wayfinder 地图 **#760** / 汇总票 **#771**
> 父需求：**#628** · 实施票：桌面 **#774** / Android **#775**
> ADR：`2026-11-19-desktop-lyric-overlay-window.md` · `2026-11-19-android-lyric-overlay-service.md` · `2026-11-19-lyric-overlay-shared-contract.md`
> 调研：`docs/research/2026-10-09-desktop-lyrics-subtitle-implementations.md` · `docs/research/2026-10-29-kuwo-lrcx-word-timed-lyrics.md` · Android 合规见 #763（分支 `research/android-overlay-compliance`，未入库）

本规格只定边界、契约与验收；具体文件 / 函数落点由实施票决定。ADR 已定的决策不在本文件重新讨论。

## 1. 范围

**一期做**

- 桌面（一期仅 Windows 验收）：独立透明置顶歌词条，当前行 + 下一句；播放栏「词」按钮；按显示器记忆位置；固定深色视觉；无锁定 / 穿透。
- Android（API 26+）：系统悬浮窗；原生两行 View；JS 推 timing 表、原生精确换行；默认穿透、仅 App 前台可拖；权限意图 / 生效态与降级；「更多」弹层「歌词浮窗」开关。
- 双端共享：逐行语义、可见性状态机、`floatingLyricsEnabled` 等持久键、视觉基线。

**一期不做**

iOS；Linux（尤其 Wayland）与 macOS 的验收 / 承诺；锁定 / 鼠标穿透；逐字填色；译文与 `[offset:…]`；透明度 / 主题 / 下一句 / 锁定设置；全局恢复默认；通知栏 / `MediaSession` 塞歌词；给外部播放器供词；headless 取词；锁屏歌词；录屏不可见 / DRM 级隐藏；截图与个人数据入库。

## 2. 验收（#628 四条，按 #765 / #767 / #768 / #769 修正）

| # | #628 原验收 | 一期判定 |
|---|---|---|
| 1 | 播放器失焦、其他窗口在前时字幕仍可见，换行跟得上（逐行即可） | 保留。桌面 Windows 11 真机；Android ColorOS 真机 + LDPlayer |
| 2 | 锁定态鼠标可穿透点下层窗口；解锁态能拖动且位置跨重启保持 | **改写**：一期无锁定态。桌面歌词条整条可拖、位置跨重启保持；Android 默认触摸穿透，仅 MPlayer 前台可拖，位置由原生持久化 |
| 3 | 两端设置页各有开关，关闭后不残留悬浮窗 | **改写**：桌面播放栏「词」按钮；Android 播放器「更多」弹层「歌词浮窗」+ Switch；两端默认关，关闭后无窗口 / 无不可见热区 |
| 4 | Android 未授予「显示在其他应用上层」时走系统设置页引导；拒绝后降级，不崩、不循环弹 | 保留。开关 = 持久意图；无权限不 addView、不抛错；回前台查 `canDrawOverlays()`；撤销时 removeView + 状态行「去开启」+ 一次性轻提示 |

**共享语义验收**（补 #764 / #769）：

- 无词 / 纯音乐 / 取词失败：隐藏，不显示空条。
- 歌词加载中 / 切歌后新词未就绪：清旧词并隐藏，不残留上一首。
- 前奏（`idx < 0`）：第 0 行在「下一句」位，当前行留空。
- 暂停冻结；暂停中 seek 仍跟随；队尾结束隐藏；停止 / 无当前曲 / 播放错误隐藏。
- 桌面 `enabled=false` 即使 `visible=false` 也立即销毁窗口；Android 关闭立即 `removeView`，重启不重建。
- 字体 / 条宽变化不改变固定外框策略；长句按「当前句 ≤ 2 行、下一句 1 行省略」截断。

## 3. 双端模块边界

### 3.1 桌面

| 层 | 责任 | 边界 |
|---|---|---|
| 主窗渲染层（`playerStore` / `playbackClock` / 歌词页） | 唯一状态源：歌词文本、播放态、位置锚点、按 #764 计算 `visible`；发快照 | 不新增取词；不把「当前行」算好再推 |
| 播放栏（`PlayerBar`） | 「词」开关；`aria-pressed`；开 / 关样式 | 不进设置页；无当前歌曲也可点（全局偏好） |
| 外观设置（`AppearanceSection` / `appearancePrefs`） | 复用 `lyricsSize` 的 `standard` / `large` | 不新增设置行；字号同时影响覆盖层 |
| 主进程（新增覆盖层窗口模块 + IPC + 存储） | 建 / 销窗、`showInactive` / `hide`、置顶续命、bounds 夹紧、快照缓存、sender 校验、导航守卫 | 只执行可见性与窗口，不重新计算歌词语义 |
| 覆盖层页面（独立 HTML + 专用 preload） | 用 core `parseLRC` / `findCurrentLyricIndex` 自算当前行；本地时钟；两行渲染；拖动 | 零取词零判源；preload 只暴露 `getState` / `onState` |
| 构建（`vite.config.ts` / `electron-builder`） | 多页 `lyric-overlay.html` 入口 + 第三个 electron preload 入口；dev URL / 打包 `loadFile` | `electron-builder.yml` 的 `dist/**/*` 已覆盖 |

### 3.2 Android

| 层 | 责任 | 边界 |
|---|---|---|
| `PlayerOverlay`（「更多」弹层） | 「歌词浮窗」+ Switch；首次开启引导；状态行「去开启」 | 不进设置页；iOS / API < 26 / low-RAM 隐藏整行 |
| 设置 store（`settings-storage`） | `floatingLyricsEnabled` 持久意图；启动 / `serviceState` 变化时单向回灌原生 | 原生永不反向改 JS；不持久化 attached / 权限态 / timing 表 |
| JS 歌词推送器（宿主级订阅，不只存在于 `PlayerOverlay` 挂载期） | 歌词就绪 / 空词 / 切曲 / 服务重启时推整张 `{time,text}` 表；切曲先清表 | 零取词零判源；复用 `planLyricsFetch` 的结果 |
| Expo module（`native-player/index.ts` / `PlayerModule.kt`） | 暴露 `setLyricOverlayEnabled` / `getLyricOverlayState` / `setLyricLines` / `canDrawOverlays` / `openOverlaySettings`；事件 `lyricOverlayState` | 命令经 `PlayerBridge` 落 service；module 不持有窗口 |
| `PlayerService` + `LyricOverlayController` | 窗口 add / remove；原生两行 View；timing 推进；前台可拖；位置持久化；权限双检；服务生命周期 | 不新起 service / FGS；不解析 LRC；不 headless 取词 |
| app manifest | `SYSTEM_ALERT_WINDOW` 已声明（#762 验证合并后仍在） | 不新增权限；通知权限解耦 |

### 3.3 core

一期**不改 core**：不新增字段、不新增选择器；复用 `parseLRC` / `findCurrentLyricIndex`。`LyricLine.words` 保留给二期；`[offset:…]` 与 `hasTranslation` 维持现状。

## 4. 共享语义与状态机

### 4.1 行推导

```text
idx = findCurrentLyricIndex(lines, positionSec)
current = idx >= 0 ? lines[idx]     : null
next    = idx >= 0 ? lines[idx + 1] : lines[0] ?? null
```

- 末行无下一句：`next = null`，第二行留空。
- 前奏：`current = null`，`next = lines[0]`。
- 两端同一口径；桌面覆盖层本地算，Android 原生算。

### 4.2 可见性状态机（双端共享）

| 当前状态 | 事件 | 下一状态 | 动作 |
|---|---|---|---|
| 关闭 | 开关开 + 有当前曲 + 歌词就绪 + 播放 / 暂停有当前行 | 显示（暂停则冻结） | 桌面：按 `visible` 建窗；Android：满足 attach 条件则 addView |
| 关闭 | 开关开但无词 / 停止 / 队尾 / 错误 | 关闭（无窗） | 不创建不可见窗 |
| 显示 | 暂停 | 显示（冻结） | 覆盖层不变暗；Android 停止调度 |
| 显示 | seek | 显示 | 重锚 / 重算当前行 |
| 显示 | 切歌 | 隐藏 | 清旧词；桌面 `visible=false`；Android removeView 或清表 |
| 显示 | 队尾 `queueEnded` / `stop` / 错误 | 隐藏 | 桌面 `visible=false`；Android removeView |
| 显示 | 开关关 | 关闭 | 桌面立即销毁；Android 立即 removeView |
| 隐藏 | 新词到达 + 开关开 + 播放 / 暂停有当前行 | 显示 | 桌面 create/show；Android 幂等 attach |
| 任意 | 权限撤销（Android） | 关闭（无窗） | removeView；开关保持 on；状态行「去开启」 |

### 4.3 暂停 vs 队尾

- 暂停：位置停在暂停点；覆盖层冻结当前行；暂停中 seek 仍跟随；不变暗。
- 队尾自然结束：隐藏。桌面队尾落 `stop()`；Android 以 `queueEnded` 为 ended 信号，**不能只看 `isPlaying`**（`onQueueEnded` 当前落 `pause()`）。

## 5. 桌面契约

### 5.1 通道

| 通道 | 方向 | 载荷 | 校验 |
|---|---|---|---|
| `lyricOverlay:state` | 主窗渲染层 → 主进程 | `LyricOverlaySnapshot` | `checkIpcSender`（收紧到 `<dist>` / dev 同源） |
| `lyricOverlay:state` | 主进程 → 覆盖层 | `LyricOverlaySnapshot` | 发送到覆盖层 `webContents` |
| `lyricOverlay:getState` | 覆盖层 → 主进程 | 无 → 缓存快照 / `null` | sender 必须是覆盖层 `webContents` |

不新增其他渲染层通用 IPC。右键「重置位置」的具体实现随实施定，约束是不扩大覆盖层 preload 的通用能力（#769）。

### 5.2 快照

```ts
interface LyricOverlaySnapshot {
  enabled: boolean;
  visible: boolean;
  playing: boolean;
  songId: string | null;
  lyricsText: string;
  positionSec: number;
  durationSec: number;
  lyricsSize: 'standard' | 'large';
}
```

- 推送时机：切歌 / 歌词到达 / 清空 / 播放暂停 / seek / 可见性变化 / 设置变化（开关 / 字号）；播放且可见时约 10s 心跳纠偏。
- 覆盖层收到快照时以 `positionSec` 为锚点、`playing` 决定是否随挂钟推进；暂停 / seek / 切歌时重锚。
- 主进程缓存最后一份快照；覆盖层加载先拉一次，之后只认推送。
- 主窗重载重发全量；主窗渲染进程崩溃先 `hide()`；覆盖层 `render-process-gone` 按上次 bounds 重建。

### 5.3 窗口状态机

| 状态 | 进入条件 | 窗口 | 鼠标 / 焦点 |
|---|---|---|---|
| 关闭 | `enabled=false` | 不存在；关闭后无残留 | — |
| 隐藏 | `enabled=true` + `visible=false` | 存在则 `hide()`；不存在不创建 | 无不可见热区 |
| 显示 | `enabled=true` + `visible=true` | 创建 / `showInactive()`；置顶续命 | 整条接收；`focusable:false` |
| 拖拽中 | 显示态按住 | 同显示 | 指针捕获，松手落位 |
| 重建中 | 覆盖层崩溃 | 按上次 bounds 重建并恢复显示 | 同显示 |

### 5.4 位置与安全

- `floatingLyricsBounds`：`Record<displayId, {x,y,width,height}>`，存 `getBounds()` 外框；恢复用存储左上角 + 当前字号档位的新尺寸，夹进 `workArea`；缺屏 → 主屏底部居中；跨屏落位记到落点屏；`display-metrics-changed` 重夹紧。
- 尺寸只由 `lyricsSize` 改变；不跟随主窗；不允许拖边缘缩放；重置只删当前屏记录。
- 安全：专用 preload；`contextIsolation:true` + `sandbox:true` + `nodeIntegration:false` + `webSecurity:true`；sender = 覆盖层 `webContents`；`will-navigate` 只放行自身 / dev 同源；`setWindowOpenHandler` 一律 deny；`checkIpcSender` 与 `registerHandler.ts` 副本同步收紧。

## 6. Android 契约

### 6.1 模块接口

```ts
type OverlayState = {
  enabled: boolean;      // 持久意图
  permission: boolean;   // Settings.canDrawOverlays()
  attached: boolean;     // 窗口当前是否已 addView 且可见
  touchable: boolean;    // 当前是否可拖（仅 MPlayer 前台）
};

canDrawOverlays(): boolean
openOverlaySettings(): void
setLyricOverlayEnabled(enabled: boolean): OverlayState
getLyricOverlayState(): OverlayState
setLyricLines(trackKey: string, lines: Array<{ time: number; text: string }>): void
// event: lyricOverlayState(OverlayState)
```

`trackKey` 用宿主现有歌曲身份规则生成，仅用于原生判定切歌 / 丢弃旧表；`time` 为秒，与 core `LyricLine.time` 同单位；一期不带 `words`。sync / async、Record 形状、位置存储键随实施定。

### 6.2 权限 / attach 状态机

| 状态 | 条件 | 行为 |
|---|---|---|
| 关闭 | `enabled=false` | 无窗；持久 false |
| 意图开、无权限 | `enabled=true` + `permission=false` | 不 addView、不抛错；状态 `{enabled:true, permission:false, attached:false}`；UI 状态行「去开启」 |
| 意图开、有权限、无表 / 不可播 | 有权限但无当前曲 / 无表 / 停止 / 队尾 / 错误 | 不 addView 或 removeView；不显示空窗 |
| 已挂载、穿透 | 有表 + 播放 / 暂停有当前行 + App 不在前台 | `NOT_TOUCHABLE`；原生按边界推进 |
| 已挂载、可拖 | 同上 + MPlayer Activity 前台 | 去掉 `NOT_TOUCHABLE`；`OnTouchListener` 拖动；离开前台恢复穿透 |
| 权限撤销 | `canDrawOverlays()=false` | 立即 removeView；`attached=false`；开关保持 on；一次性轻提示；emit 状态 |

- 首次开启先展示引导；「去设置」才把持久意图置 on，「取消」保持 off（#768）。
- `setLyricOverlayEnabled(bool)` 只持久化意图；无权限不 addView、不抛异常。
- 每次 attach 前与回前台查 `canDrawOverlays()`；`addView` 捕获 `BadTokenException` / `SecurityException`；撤销后可能不抛异常但窗口被隐藏，需用 `canDrawOverlays()` + 窗口可见性双检。
- `setLyricLines` 不受开关门控：开关关着也接收并缓存当前曲的表，开开关立即出窗。

### 6.3 时序算法

1. 收到 `setLyricLines(trackKey, lines)`：校验 `trackKey`；保存整表；重算当前行；若满足 attach 条件则 addView / 更新文本。
2. 播放 / seek / 暂停 / 切曲：重算 `idx`；暂停时取消 `postDelayed`，冻结文本；seek 后重新调度。
3. 正常推进：在下一行 `time` 边界 `postDelayed`，到点更新两行文本并调度下一行；不依赖 1s tick。
4. 1s `progressTick` 只作安全重同步：比较原生位置与预期，漂移超过阈值才重算 / 重排。
5. 切曲（media item transition）：丢弃旧表、removeView；新表到达才重新显示；绝不显示上一首最后一行。
6. 队尾 / 停止 / 错误 / 开关关 / 权限撤销：取消所有调度，removeView。

### 6.4 窗口参数与生命周期

```text
TYPE_APPLICATION_OVERLAY（API 26+）
FLAG_NOT_FOCUSABLE | FLAG_NOT_TOUCHABLE
PixelFormat.TRANSLUCENT
alpha ≤ 0.8
bounds 紧贴歌词条；避让挖孔 / 手势条
```

- `LyricOverlayController` 在 `PlayerService.onCreate` 创建、`onDestroy` 移除；不新起 service / FGS。
- 只持久化开关 + 位置；不持久化 timing 表；`restoreSnapshot` 后不开窗。
- 幂等 attach 条件：开关开 + 权限有 + 当前曲有表 + （播放中 或 暂停且有当前行）。
- 同曲 JS 丢失：原生继续推进；切曲 JS 不在：保持隐藏，不 headless 取词。
- 暂停超过 media3 FGS 10 分钟宽限：服务可能被回收，窗口消失；恢复后按幂等条件重建。

## 7. 视觉与尺寸

| 项 | 桌面 | Android |
|---|---|---|
| 结构 | 单胶囊双行，固定外框，内容垂直居中 | 原生两行 View，同结构 |
| 当前句 | 20px / 700 / 100%，行高 1.35，居中，最多 2 行 | 固定 sp，随系统字体缩放；最多 2 行 |
| 下一句 | 14px / 500 / 62%，1 行省略 | 同上 |
| 条宽 | `standard → M` 520px、`large → L` 640px；`S` 只留原型 | 屏宽 62% 上限，竖 / 横屏同口径 |
| 外框高度 | M 档 112px；L 档按 #770 实现值 | 固定外框，不随行数变化 |
| 配色 | 一期只有深色：底 `rgba(16,16,20,.62)` + 1px 边框 + 白字阴影 | 同一套 token；窗口 alpha ≤ 0.8，有效底约 0.5 |
| 交互反馈 | hover 3px 虚线框 + `grab`；无锁图标 / 徽标 | 无锁提示；紧 bounds |

视觉 token 以 #770 决议评论为准；颜色 / 像素微调不需要新 ADR。字号档位沿用 #769 的 `lyricsSize` 键。

## 8. 分期

1. **桌面先行（#774）**：窗口 / 通道 / 生命周期 / 安全 / 位置 / 交互 / 设置 / 视觉；Windows 11 真机验收；Linux / macOS 不承诺。
2. **Android 随后（#775）**：控制器 / 权限引导 / 原生时序 / 两行 View / 设置；ColorOS 真机 + LDPlayer 验收；被 ROM / 权限卡住时降级，不拖桌面。
3. **1.9.0 双端同批**；桌面先落地。
4. **二期（不在本规格）**：逐字填色、译文 / offset、锁定 / 穿透、浅色主题、第三档字号、长期常驻 `specialUse` FGS。各自另开票。

## 9. 风险与未验

| 项 | 影响 | 处置 |
|---|---|---|
| ColorOS 划掉最近任务 / 锁屏 | 浮窗存续不确定；锁屏平台层级不可逾越 | #762 未验；实施期真机复核；锁屏不做产品承诺 |
| HyperOS / HarmonyOS / 其他 ROM | 额外悬浮窗 / 后台开关差异 | 一期只覆盖 ColorOS「耗电行为控制」静态提示（#768）；其余 ROM 未验 |
| Android 权限撤销不抛异常 | 窗口被隐藏但 `addView` 成功 | `canDrawOverlays()` + 窗口可见性双检；emit `attached=false`（#763 / #767） |
| 多显示器 / 跨屏 / DPI 切换 / 虚拟桌面 / 全屏独占 | 桌面位置 / 置顶异常 | #761 只验 175% 单屏；实现期真机复核 |
| 旧显卡 / 远程桌面透明残影 | 透明分层窗显示异常 | 未验；作为已知边界 |
| Wayland / macOS | 平台层限制；一期不承诺 | Out of scope；代码不主动破坏 macOS |
| Android 条宽映射（#770 的 62% 屏宽 vs #769 的 M / L 档） | 不同屏幕尺寸下观感不一 | 以屏宽 62% 为上限、竖 / 横屏同口径；具体像素实现期真机校准 |
| 系统字体缩放导致换行 / 截断 | 文本溢出固定外框 | 仍按「当前句 ≤ 2 行、下一句 1 行省略」截断，不改窗口尺寸（#770） |
| Android 暂停超过 10 分钟 FGS 宽限 | 服务被回收、浮窗消失 | 一期接受；恢复后幂等重建；长期常驻另票 |
| API 24–25 无 `TYPE_APPLICATION_OVERLAY` | 低版本不可用 | 限定 API 26+；入口对 API < 26 / low-RAM 隐藏（#768） |
| `checkIpcSender` 收紧回归 | 既有 IPC 调用 / 测试被误伤 | 同一 PR 跑全量 `npm run verify -- all`；保留测试直调放行 |
| 覆盖层崩溃 / 主窗重载 | 窗口空白或旧快照 | 主进程缓存 + getState + 按上次 bounds 重建（#766） |
| 逐字 / 译文 / offset | 一期不做 | `LyricLine.words` 保留；二期另票 |
| 通知权限被拒 | 不影响浮窗与播放 | #762 / #763 已验证解耦；不门控 |

## 10. 参考

- 地图 **#760** · 汇总 **#771** · 父需求 **#628** · 实施票 **#774** / **#775**
- ADR：`2026-11-19-desktop-lyric-overlay-window.md` · `2026-11-19-android-lyric-overlay-service.md` · `2026-11-19-lyric-overlay-shared-contract.md`
- 调研：`2026-10-09-desktop-lyrics-subtitle-implementations.md` · `2026-10-29-kuwo-lrcx-word-timed-lyrics.md`
- 上游 ADR：`2026-09-29-native-playback-ownership.md`（I1 / I3 / I6）· `2026-09-29-ci-verification-boundary.md`
