# ADR: 桌面歌词悬浮条——独立覆盖窗 + 主进程语义快照通道

- 状态：**已接受**（2026-11-19，wayfinder #760 / #771 汇总；实施票 #774）
- 日期：2026-11-19
- 关联：**#628**（父需求）· **#760**（地图）· **#771**（汇总票）· #761（桌面冒烟）· #765（交互模型）· #766（数据通道与窗口生命周期）· #769（设置与持久化）· #770（视觉与交互反馈）· 调研 `docs/research/2026-10-09-desktop-lyrics-subtitle-implementations.md` · ADR `2026-10-27-desktop-ui-primitives-and-settings-shell.md`（桌面 UI 原语与设置壳）· 实施规格 `docs/specs/2026-11-19-lyric-overlay.md`

## 背景

目标是把当前歌词行当字幕浮在**其他应用窗口之上**。主窗内 CSS、`<webview>`、`BrowserView` 都出不了主窗边界，桌面端只有独立顶层 `BrowserWindow` 一条路；#761 在 Windows 11 / Electron 44.9.3 / 175% 缩放下实测透明、置顶、`focusable:false` 与鼠标事件均可用，但也暴露了三个必须写进契约的事实：

1. **置顶会掉**：点击下层 topmost 窗口会把覆盖层压下去，必须 `moveTop()` 或周期重设置顶。
2. **后台节流**：隐藏时 `backgroundThrottling:false` 仍保持 60fps / 10 timers 每秒；原型持续 60fps 重绘期间用户报告明显卡顿。产品侧必须事件驱动，`backgroundThrottling:false` 只用于「可见但失焦」。
3. **位置要存外框**：175% 缩放下窗口尺寸有 1px 舍入，存请求的内容尺寸会导致位置回弹；必须存 `getBounds()` 外框。

数据面另有两条硬约束：主窗渲染层是唯一状态源（`playerStore` 同时持 `lyrics` 与 `isPlaying`），但主窗最小化后 Chromium 会把 250ms 采样节流到约 1s，**主窗算好当前行再推文本恰好会在桌面歌词最常用的场景里推晚**（#766）；而覆盖层拿到 LRC 原文与一次位置锚点后，可以用 core `parseLRC` / `findCurrentLyricIndex` 自算，暂停 / seek / 切歌时重锚，换行不依赖主窗采样频率。

安全上，现有 `checkIpcSender` 接受任意 `file://`，覆盖层是新增的 `file://` 页面；必须把信任面收紧到 `<dist>` 与 dev server，并给覆盖层专用 preload，不暴露通用 `invoke/send/on`（#766）。

产品侧已定：一期**不做锁定 / 鼠标穿透**，歌词条始终接收鼠标、整条可拖（#765）；开关在播放栏「词」按钮，默认关，关闭即销毁（#765 / #769）；可见性语义归 #764（无词 / 停止 / 队尾隐藏，暂停冻结）。

## 决策

### 1. 形态与窗口参数

独立 `BrowserWindow`，独立 HTML 入口与独立渲染进程。窗口参数：

```text
frame: false, transparent: true, hasShadow: false,
backgroundColor: '#00000000', alwaysOnTop: true,
skipTaskbar: true, focusable: false, show: false,
resizable: false, fullscreenable: false
```

`ready-to-show` 后 `showInactive()`，不抢焦点。可见时每 1s `setAlwaysOnTop(true, 'screen-saver')` + `moveTop()`；显示、显示器变化时立即执行；隐藏即停（#761 / #765）。

### 2. 数据通道与快照

**主进程中转的语义通道，不用 `MessageChannelMain`。**

- 主窗渲染层 `ipcRenderer.send('lyricOverlay:state', snapshot)`；
- 主进程 `checkIpcSender` 校验后缓存，并 `overlayWindow.webContents.send('lyricOverlay:state', snapshot)`；
- 覆盖层加载后先 `invoke('lyricOverlay:getState')` 拉一次，之后只认推送（照 #579 的模式消除订阅竞态）。

快照字段（#766 + #769）：

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

- `visible` 由主窗渲染层按 #764 的可见性语义算好；主进程只执行 `showInactive` / `hide` 并缓存快照；覆盖层零可见性策略。
- 推送时机：切歌、歌词到达 / 清空、播放 / 暂停、seek、可见性变化、设置变化（开关 / 字号），以及播放且可见时约 10s 一次心跳纠偏；**不推当前行、不推逐帧**。
- 覆盖层用 `lyricsText` + `positionSec` 锚点自算：`parseLRC` → `findCurrentLyricIndex` → `current = lines[idx]`、`next = lines[idx + 1]`；`idx < 0` 时 current 空、next 取第 0 行（#764）。零取词、零判源，不新增第二条 IPC。

### 3. 窗口生命周期

| 状态 | 窗口 |
|---|---|
| `enabled=false` | 立即销毁；即使 `visible=false` 也销毁（#769） |
| `enabled=true` + `visible=true` | 不存在则创建，存在则 `showInactive()` |
| `enabled=true` + `visible=false` | 存在则 `hide()`；不存在不创建；无不可见热区 |
| 主窗最小化 / 关闭到托盘 | 保持（覆盖层只看播放与开关，不看主窗） |
| 应用退出 | 随进程销毁 |
| 覆盖层 `render-process-gone` | 开关仍开则按上次 bounds 重建并恢复显示 |
| 主窗渲染进程崩溃 | 先 `hide()`；等新快照再显示（播放宿主已停，旧快照必过期） |
| 主窗重载 | 重发全量快照 |
| `app.on('activate')` | 只判主窗口是否存在，不再按窗口总数为 0（否则覆盖层挡住主窗重建） |

### 4. 位置与多显示器

- 按 `display.id` 记忆，存 `getBounds()` 外框（#761）到主进程 `settings.json` 的 `floatingLyricsBounds`（#769）。
- 恢复：存储的左上角 + 当前字号档位的新尺寸，再夹进该显示器 `workArea`；显示器不存在 → 主屏 `workArea` 底部居中。
- 拖动跨屏落位记到落点屏，旧屏记录保留；`display-metrics-changed` 后重新夹紧；不做手动 DPI 换算。
- 一期不跟随主窗、不允许拖边缘改尺寸；条宽只随 `lyricsSize` 改；字号变化且窗口存在时保留左上角、按新档位重设尺寸并夹紧，窗口不存在则下次创建用新尺寸；「重置位置」只删当前 `display.id` 记录，入口在右键菜单，不加设置页项。
- 右键「重置位置」的具体 IPC / 主进程实现随实施定，约束是**不扩大覆盖层 preload 的通用能力**（#769）。

### 5. 安全边界

- `checkIpcSender` 与 `registerHandler.ts` 里的同逻辑副本一并收紧：只信任 `<dist>` 下的 `file://` 与 dev server 同源；测试直接调用 handler（无 senderFrame）照旧放行。
- 覆盖层专用 preload，只暴露 `getState` / `onState`；`contextIsolation:true`、`sandbox:true`、`nodeIntegration:false`、`webSecurity:true`。
- 覆盖层通道额外校验 sender 为该覆盖层窗口的 `webContents`，不只靠 URL。
- 新窗同样挂 `will-navigate`（只放行自身页面 / dev 同源）与 `setWindowOpenHandler`（一律 deny；覆盖层无外链）。

### 6. 渲染与交互

- 事件驱动重绘；一期逐行，无逐字填色，不跑 rAF。
- `backgroundThrottling:false` 只用于「可见但失焦」；隐藏时恢复 `true` 并停止页面循环（#761）。
- `focusable:false`；整条可拖、无独立把手；窗口 bounds 紧贴歌词条（可含 3px hover 虚线框的小边距），不允许大块透明留白。
- 一期只做显示 + 拖动；不做播放控制、歌词点击跳转、双击动作；右键菜单只有「重置位置」（#765）。
- 无锁定 / 穿透态，无 hover 解锁；关闭窗口后无残留。

## 备选与否决

| 备选 | 否决理由 |
|---|---|
| `MessageChannelMain` 主窗 ↔ 覆盖层直传 | port 消息不过 `checkIpcSender`，等于在安全边界外开一条无校验通道；一期没有 60fps 流式需求（#766） |
| 主窗算好「当前行 + 下一句」再推文本 | 主窗最小化后 250ms 采样被节流到约 1s，恰好在最常用场景推晚（#766） |
| 主窗内 CSS / `<webview>` / `BrowserView` | 出不了主窗边界，不解决「盖住别的 App」（10-09 research §2） |
| 复用通用 preload / `window.electronAPI` | 覆盖层不需要通用 `invoke/send/on`，攻击面应最小化（#766） |
| 锁定 / 鼠标穿透作为一期默认 | 用户 2026-11-19 拍板不做；歌词条始终接收鼠标、整条可拖（#765） |
| 存请求的内容尺寸而不是 `getBounds()` | 175% 缩放下有 1px 舍入，位置会回弹（#761） |
| 跟随主窗移动 | 参考项目都不跟随；自由摆放 + 记忆绝对坐标更符合桌面字幕（#765 / 10-09 research） |
| 关闭开关时 `hide()` 而不销毁 | #628 验收 3 要求关闭后不残留；隐藏仍留窗口与不可见热区（#765 / #769） |

## 后果

- 多一个渲染进程与一个构建入口（`dist/lyric-overlay.html` + 专用 preload）；`vite.config.ts` 需加多页 input 与第三个 electron 入口（#766）。
- `checkIpcSender` 收紧会影响既有调用点与测试，需在同一改动中验证；新增覆盖层 sender 校验。
- 置顶需要周期续命，与其他 topmost 窗口存在 z-order 竞争；隐藏时停止续命。
- 无锁定态意味着歌词条矩形内始终拦截鼠标；用户若需要穿透，只能关闭开关。
- 一期不承诺 Linux（尤其 Wayland）与 macOS；Windows 上多显示器 / DPI 切换 / 虚拟桌面 / 全屏独占 / 旧显卡与远程桌面透明残影均未验证（#761）。
- 逐字填色、译文、offset 均不在一期；`LyricLine.words` 数据保留，二期另票（#764）。

## 参考

- 票：**#628** · **#760** · **#771** · #761 / #765 / #766 / #769 / #770 · 实施票 #774
- 调研：`docs/research/2026-10-09-desktop-lyrics-subtitle-implementations.md`
- 实施规格：`docs/specs/2026-11-19-lyric-overlay.md`
