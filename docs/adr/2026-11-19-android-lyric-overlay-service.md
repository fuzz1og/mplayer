# ADR: Android 歌词浮窗——挂 PlayerService、原生时序与权限意图契约

- 状态：**已接受**（2026-11-19，wayfinder #760 / #771 汇总；实施票 #775）
- 日期：2026-11-19
- 关联：**#628**（父需求）· **#760**（地图）· **#771**（汇总票）· #762（Android 冒烟）· #763（悬浮窗合规与 ROM 调研）· #764（可见性语义）· #767（承载与渲染形态）· #768（权限引导与降级）· #769（设置与持久化）· #770（视觉）· ADR `2026-09-29-native-playback-ownership.md`（原生持队列 / 原生推进 / I3 单 MediaSessionService）· 实施规格 `docs/specs/2026-11-19-lyric-overlay.md`

## 背景

Android 端做「浮在其他应用之上」只有系统悬浮窗 `TYPE_APPLICATION_OVERLAY` + `SYSTEM_ALERT_WINDOW` 一条路；通知 / `MediaSession` 结构上没有逐行歌词槽（10-09 research §3.2）。仓库的 `SYSTEM_ALERT_WINDOW` 已在 app manifest 声明但全仓零消费（#762 验证合并后仍在）。

三条既有事实决定了承载与时序：

1. **不需要独立前台服务**。AOSP `checkAddPermission` 只检查 `OP_SYSTEM_ALERT_WINDOW`，不检查 FGS 类型 / 前台状态 / 通知；播放中 `PlayerService` 已是 `mediaPlayback` FGS，ADR `2026-09-29-native-playback-ownership` 的单 `MediaSessionService` 天然满足。只有「暂停 / 停止后仍要长期常驻」才需要独立 `specialUse` FGS（media3 暂停后 FGS 上限 10 分钟）——一期不做（#763）。
2. **后台 JS 定时器不投递**（`2026-09-29-native-playback-ownership` 的根因），当前 native 进度只有 1s 一跳；歌词推进必须原生驱动。JS 推「当前行 + 下一行」会依赖后台定时器，必然不可靠（#767）。
3. **合规硬约束**：Android 12+ 对 SAW 走 untrusted touch，单窗 `alpha > 0.8` 会静默拦截下层触摸；遮挡按窗口 frame 而非绘制区域计算，因此必须 `alpha ≤ 0.8` + 紧 bounds；`FLAG_NOT_TOUCHABLE` 才是触摸穿透，`FLAG_NOT_FOCUSABLE` 只解决焦点。API 24–25 没有 `TYPE_APPLICATION_OVERLAY`（#763）。

另外，控制器**不能放在 Expo module**：module 随 React 上下文销毁（`PlayerModule.OnDestroy` → `PlayerBridge.clear()`），而 ADR `2026-09-29-native-playback-ownership` I1 按「JS 上下文可能丢失、原生照常」设计；窗口归 module 会在 JS 丢失时变孤儿（#767）。

## 决策

### 1. 承载与归属

`LyricOverlayController` 作为现有 `PlayerService` 的组件：`onCreate` 创建、`onDestroy` 移除。**不加第二个 service、不加 FGS 类型、不动通知**。JS 新增模块函数经 `PlayerBridge` 落到 service，与既有命令同构。

窗口寿命 = 服务进程寿命。暂停时窗口保留（冻结）；media3 FGS 10 分钟宽限结束后服务可能被回收，窗口随之消失，重启后按第 6 条重建。一期不做 `specialUse` FGS；若将来确需「暂停后长驻」，按 #763 的清单另开票。

### 2. 渲染

原生两行 `View`（固定外框的垂直两行 `TextView`；需要统一描边 / 阴影时用一个自绘 View），`WindowManager.addView` 直接挂载。**不用 WebView**：一期无动画 / 填色收益，换不来第二个 JS 运行时、asset 打包、首帧与透明 surface 的代价。

窗口参数（#763 / #770）：

```text
TYPE_APPLICATION_OVERLAY（API 26+）
FLAG_NOT_FOCUSABLE | FLAG_NOT_TOUCHABLE
PixelFormat.TRANSLUCENT
alpha ≤ 0.8
bounds 紧贴歌词条（不铺全屏透明根 View）
```

视觉细节（字号、描边、主题、刘海避让）按 #770 与共享契约；`alpha ≤ 0.8` 是硬约束。

### 3. 时序

**JS 推整张 timing 表，原生自算。**

- 解析完成 / 清空时调 `setLyricLines(trackKey, [{time, text}])`；`time` 为秒，与 core `LyricLine.time` 同单位；一期不带 `words`。
- 原生取行规则与 core `findCurrentLyricIndex` 相同：最后一个 `time ≤ position` 的行，`< 0` 为前奏；`current = lines[idx]`、`next = lines[idx + 1]`，前奏时 current 空、next 取第 0 行（#764）。
- 换行精度：不用 1s 进度 tick 渲染；在下一行边界 `postDelayed` 精确切换，seek / play / pause / 切曲时重算；暂停时不调度（冻结），暂停中 seek 仍跟随；1s tick 只作安全重同步。
- 否决「JS 推当前行 + 下一行」：后台 JS 定时器不投递（ADR 根因）；否决「原生解析 LRC」：要拿原文、复制解析器，违反 #764「零取词零判源」。

### 4. 输入

默认 `FLAG_NOT_TOUCHABLE` 穿透。**仅 MPlayer Activity 前台时**去掉 `NOT_TOUCHABLE` 并用 `OnTouchListener` 拖动；离开前台立即恢复穿透。位置持久化在原生；恢复 / 旋转 / 显示变化后按当前显示夹紧（#762）。锁定 / 穿透判断全在原生，JS 只发状态，不做逐帧指令。

代价（已接受）：在别的 App 里想挪位置需先回 MPlayer。

### 5. 权限契约

- `setLyricOverlayEnabled(bool)` 持久化用户意图，无权限时不 `addView`、不抛异常；`getLyricOverlayState()` → `{enabled, permission, attached, touchable}`。
- 撤销检测：每次 attach 前与回前台时查 `Settings.canDrawOverlays()`；`addView` 捕获 `BadTokenException` / `SecurityException`（#763：撤销后可能不抛异常但窗口被隐藏）；失败即 `attached=false` 并 emit 状态事件。
- `openOverlaySettings()` 由模块提供（跳系统悬浮窗页）；入口与引导文案归 #768。首次开启先展示引导，「去设置」才把持久意图置 on，「取消」保持 off。
- `setLyricLines` 不受开关门控：开关关着也接收并缓存当前曲的表，开开关立即出窗。

### 6. 生命周期与数据

| 情形 | 行为 |
|---|---|
| 同曲、JS 丢失 | 原生用已推送的表继续推进（App 后台、划掉任务后仍有效，只要服务存活） |
| 切曲 | 原生监听到 media item transition 即丢弃旧表、`removeView`；新表到达才重新显示，**绝不显示上一首的最后一行** |
| 一期 JS 不在时切曲 | 保持隐藏直到 JS 重推；不做 headless 取词 |
| 服务重启 / `restoreSnapshot` | 只持久化「开关意图 + 窗口位置」；不持久化 timing 表；`onCreate` 恢复快照后不开窗 |
| 幂等 attach 条件 | 开关开 + 权限有 + 当前曲有表 + （播放中 或 暂停且有当前行） |
| JS 推表时机 | 歌词就绪 / 空词 / 切曲 / `serviceState` 变化（服务重启）时推；不依赖用户回前台 |
| 停止 / 队尾 / 播放错误 / 开关关闭 / 权限撤销 | 立即 `removeView`，不留空窗、不留不可见热区 |

### 7. 模块接口

```ts
canDrawOverlays(): boolean
openOverlaySettings(): void
setLyricOverlayEnabled(enabled: boolean): OverlayState
getLyricOverlayState(): OverlayState        // { enabled, permission, attached, touchable }
setLyricLines(trackKey: string, lines: Array<{ time: number; text: string }>): void
// event: lyricOverlayState(OverlayState)
```

实现细节（sync / async、Record 形状、位置存储键）随实施规格定；语义以本 ADR 为准。

## 备选与否决

| 备选 | 否决理由 |
|---|---|
| 独立 `specialUse` FGS | 一期播放中已有 mediaPlayback FGS，SAW 不要求额外 FGS；长期常驻成本高、要第二条通知，暂停后长驻需求未成立（#763 / #767） |
| WebView asset 渲染 | 一期无动画 / 填色收益；第二个 JS 运行时、asset 打包、首帧与透明 surface 代价不值（#767） |
| JS 推「当前行 + 下一行」 | 后台 JS 定时器不投递（ADR `2026-09-29-native-playback-ownership` 根因），`PlayerOverlay` 的换行正靠 250ms JS 心跳（#767） |
| 原生解析 LRC | 要拿原文、复制解析器，违反 #764「零取词零判源」（#767） |
| 另起 overlay service | 违反单 `MediaSessionService` 约束；窗口归 module 会在 JS 丢失时变孤儿（#767 / #763） |
| `alpha > 0.8` 或全屏透明根 View | Android 12+ untrusted touch 静默拦截下层触摸；遮挡按 frame 计算（#763） |
| 锁定 / 穿透用户开关 | 仅 App 前台可拖、其余自动穿透，无需用户第二状态（#767 / #769） |
| 持久化 timing 表 | 重启后可能过期；只存意图与位置，表由 JS 重推（#767） |

## 后果

- Android 原生行为不在 CI 编译 / 测试范围内（ADR `2026-09-29-ci-verification-boundary`），必须真机验收：ColorOS 真机 + LDPlayer。
- API 24–25 无 `TYPE_APPLICATION_OVERLAY`，悬浮歌词限定 API 26+；入口对 API < 26 / low-RAM 隐藏（#768）。
- 锁屏歌词不可实现（overlay 层级低于 keyguard）；ColorOS 划掉任务 / 锁屏 / 权限撤销 / HyperOS / HarmonyOS 仍有未验项（#762 / #763 / #768）。
- 暂停超过 media3 的 10 分钟 FGS 宽限后服务可能被回收，浮窗消失；恢复后靠幂等 attach 重建。
- 仅 MPlayer 前台可拖；在别的 App 里不能移动位置（已接受）。
- 通知权限与 SAW 解耦：拒绝通知不影响浮窗与播放（#762 / #763）。
- 逐字、译文、offset、headless 取词均不在一期。

## 参考

- 票：**#628** · **#760** · **#771** · #762 / #763 / #764 / #767 / #768 / #769 / #770 · 实施票 #775
- 调研：`docs/research/2026-10-09-desktop-lyrics-subtitle-implementations.md` §3；Android 合规调研见 #763（分支 `research/android-overlay-compliance`，未入库）
- 实施规格：`docs/specs/2026-11-19-lyric-overlay.md`
