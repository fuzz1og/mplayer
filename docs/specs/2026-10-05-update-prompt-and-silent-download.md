# 实施规格：进入即检查更新（桌面徽标 + 静默下载 + 应用内确认后退出安装；移动端弹窗跳浏览器）

> 规格日期：2026-10-05 · 类型：实施规格（可直接开工）· 关联：**#579**
> 决策依据：ADR `docs/adr/2026-10-05-update-prompt-and-silent-desktop-download.md`（含安装器行为的技术前提）
> 调研与证据：`docs/research/2026-10-05-update-prompt-research.md`（本文件不重复论证）
> 口径：给 `file:line` 的均为 master 实测；本文件写接口签名与行为契约，**不写实现代码**

## 1. 目标与不变量

### 1.1 目标

1. 双端**冷启动后自动检查一次**更新；无新版时界面零变化。
2. 桌面端：有新版 → 左下「设置」旁徽标 + **静默后台下载** → 下载完成**弹应用内确认框**；用户点「立即安装并重启」后**退出应用**、静默安装、装完自动重启。
3. 移动端：有新版 → 弹窗（版本号 + 说明），可「叉掉」（记录该版本已忽略）或「立即更新」（跳浏览器）。
4. 检查失败（断网 / 全部镜像不可用）双端**静默**，不弹错误、不阻断启动。

### 1.2 不变量（实现与测试都必须守住）

- **I1 启动流程绝不 throw**：`runStartupFlow` / 弹窗检查的任何失败都只记日志，不得冒泡成未捕获异常或阻断启动。
- **I2 状态以主进程为唯一事实源**：渲染层不得自行推断「有没有更新」；`update:status`（push）与 `update:getStatus`（拉取）必须给出一致的快照。
- **I3 拉取与推送的合并规则**：首帧拉一次快照**覆盖**本地状态；此后**只认 push**。快照返回晚于 push 时不得让状态回退（用单调序号或「已收到 push 则忽略更早快照」实现，二者择一，测试必须覆盖）。
- **I4 安装必须先退出应用，且由应用自己问一次**：安装走 `quitAndInstall(true, true)`（`/S` 静默 + `--force-run` 重启）。**禁止**用 `shell.openPath` 把安装器拉起来而应用自己还开着——Windows 上运行中的 exe 被占用就装不了，且安装器还要再弹一次「应用正在运行」，等于问两遍。
- **I5 退出只能由用户确认触发**：`runStartupFlow` 与任何自动路径**不得**调用 `quitAndInstall`；唯一调用点是用户点确认框的「立即安装并重启」或设置页同义按钮。点「稍后」时 `autoInstallOnAppQuit` 保持 true（正常退出时装上，不自动重启）。
- **I6 检查超时必须收紧**：启动检查用独立超时（`STARTUP_CHECK_TIMEOUT_MS`，默认 8000ms），不得沿用设置页手动的 10000ms 默认值去抢首屏带宽；复用 10 分钟探针缓存。
- **I7 移动端忽略粒度 = 版本号**：`dismissedUpdateVersion` 持久化；`latest === dismissed` 不弹，`latest !== dismissed` 仍弹。
- **I8 不新增产物目标**：Windows 维持 `nsis` + `portable`；不引入 MSI、不改 `electron-builder.yml` 的 `win.target`。
- **I9 不做移动端应用内安装**：不新增 `REQUEST_INSTALL_PACKAGES`、不新增 `expo-intent-launcher`；「立即更新」只能是 `Linking.openURL`。

## 2. 桌面端

### 2.1 主进程 `updateService`（`src/main/services/updateService.ts`）

新增常量（导出以便测试断言与调参）：

```ts
/** 启动检查的检查超时：比设置页手动检查更短，避免与首屏请求抢带宽 */
export const STARTUP_CHECK_TIMEOUT_MS = 8000;
/** 首帧后延时再检查，避开首屏请求高峰 */
export const STARTUP_FLOW_DELAY_MS = 3000;
```

新增/扩展的公开接口：

```ts
class UpdateService {
  /**
   * 启动自动流程：检查 → 有新版则**静默下载**。到此为止，**不退出应用**（I5）。
   * 全程静默：任何一步失败都只记日志并返回，绝不 throw（I1）。
   * 与手动 `checkForUpdates` 共用 `isChecking` / `isDownloading` 单飞守卫。
   */
  async runStartupFlow(opts?: { checkTimeoutMs?: number }): Promise<void>;

  /** 是否已拿到可安装的本地安装包（供判断与测试） */
  hasDownloadedInstaller(): boolean;

  /**
   * 退出应用并安装已下载的更新，装完自动重启（I4）：`quitAndInstall(true, true)`。
   * 未下载完成时返回 `{ ok: false, error }` 且**不退出**。
   */
  installDownloadedUpdate(): { ok: boolean; error?: string };
}
```

实现约束：

- **捕获下载产物路径**：路径取自 `update-downloaded` 事件的 `UpdateDownloadedEvent.downloadedFile`，
  在 `onDownloaded` 里记为 `this.downloadedFiles = [info.downloadedFile]`。
  **不要**依赖 `autoUpdater.downloadUpdate()` 的 resolve 值：两者时序不保证，绑 promise 会让下载流程被它的
  resolve 迟到拖住（既有下载用例就是靠 `update-downloaded` 事件驱动的）。该路径只用于「能不能装」的判断——
  实际安装路径由 electron-updater 自己持有（`installerPath`）。
- **`installDownloadedUpdate()` 的守卫**：`status !== 'downloaded' && !hasDownloadedInstaller()` 时返回
  `{ ok: false, error: '更新尚未下载完成' }`，不调用 `quitAndInstall`——不能在没下好时把用户的应用关掉。
- **不加幂等标记**：`quitAndInstall` 成功即进程退出；且 electron-updater 的 `install()` 内部有
  `quitAndInstallCalled` 守卫，重复调用只会被忽略并 warn，不需要我们在外面再挡一层。
- 状态机维持既有 7 态，不新增；安装动作不改变 `status`。

### 2.2 IPC（`src/main/ipc/appSettingsUpdate.ts:146-164`）

新增一条 + 改写一条：

```ts
// 新增：首帧快照（registerIpcHandlerSimple = 裸返回，无封套）
registerIpcHandlerSimple('update:getStatus', () => updateService.getStatus());
// 改写：原来是无参 quitAndInstall()（可见向导）。现在走带参的退出+静默安装，且返回结果供 UI 报错。
// 用 registerIpcHandler（带 { success, data | error } 封套）。
registerIpcHandler('update:install', () => updateService.installDownloadedUpdate());
```

其余通道不变（`update:check` / `update:download` / `update:downloadInBrowser` /
`update:getVersion` / `update:getChannels` / `update:setChannel` / `update:speedTest`）。
`UpdateService.quitAndInstall()` 保留为无参裸封装，供将来做「可见安装向导」入口，当前 UI 不使用。

### 2.3 主进程启动接线（`src/main/main.ts:402` 附近）

- 在 `registerUpdateIpc(mainWindow)` 之后调用 `scheduleStartupUpdateFlow(mainWindow)`：
  `webContents.isLoading()` 为真则 `once('did-finish-load', ...)`，否则直接排期
  （**不假设时序**：`registerUpdateIpc` 之前有一次 `await db.getSetting()`，窗口可能已经加载完），
  再 `setTimeout(() => void updateService.runStartupFlow(), STARTUP_FLOW_DELAY_MS)`。
- **一次性守卫**：模块级 `let startupUpdateFlowStarted = false`。dev 下 HMR / 重载会重复触发加载事件，
  只允许第一次排期（`macOS` 的 `activate` 重建窗口同理不再触发）。
- 不能在 `app.whenReady()` 里直接 `runStartupFlow()`：那会早于渲染层订阅（I2 的拉取兜底虽能补救，但白白浪费一次检查）。

### 2.4 渲染层状态（新增 `src/renderer/store/updateStore.ts`）

```ts
export type UpdateUiStatus =
  | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

interface UpdateStoreState {
  status: UpdateUiStatus;
  version: string;
  progress: number;
  error: string;
  sourceLabel: string;
  /** 是否有更新（available | downloading | downloaded）——徽标唯一判据 */
  hasUpdate: boolean;
}

interface UpdateStoreActions {
  /** 幂等初始化：订阅一次 update:status，并拉一次 update:getStatus 快照。返回退订函数。 */
  initUpdateBridge: () => () => void;
  /** 仅测试与内部使用：应用一条主进程状态 */
  applyStatus: (status: Partial<UpdateStatusEvent>) => void;
}
```

- 合并规则按 **I3** 实现。
- `initUpdateBridge()` 必须**幂等**：重复调用不重复订阅（`App.tsx` 与 `UpdateSection` 都可能调）。
  实现方式：模块级 `let bridged = false` + 记录退订函数，重复调用直接返回已有退订函数。

### 2.5 徽标（`src/renderer/components/Sidebar.tsx`）

- 新增可选 prop：`updateAvailable?: boolean`（默认 `false`）。
- 「设置」项（`:153`）右侧渲染一个小圆点徽标：`position: absolute`，靠右居中，用 `var(--accent)`（或 `--danger`，
  取 `--accent` 与设置页「发现新版本」一致）。
- 加 `aria-label`（如 `设置（有可用更新）`）与 `title`（`有新版本可更新`），保证可访问性与测试可断言。
- **其余 nav item 不受影响**；`updateAvailable` 为 false 时 DOM 里不出现徽标节点。

### 2.6 设置页 `UpdateSection`（`src/renderer/components/UpdateSection.tsx`）

- **状态来源改为 update store**：`status` / `latestVersion` / `progress` / `error` / `activeChannelLabel` 一律从 store 读，
  删除组件内的 `updateStatus` / `latestVersion` / `updateProgress` / `activeChannelLabel` 局部 state 与 `update:status` 订阅。
- 保留组件内局部 state：通道下拉（`channel` / `channelSources`）、测速（`speedResults` / `isTestingSpeed`）、
  `browserUrl`（浏览器下载提示，属设置页本地反馈）。
- `downloaded` 态按钮改为「立即安装并重启」→ `update:install`（即 `installDownloadedUpdate()` = `quitAndInstall(true, true)`）。
- `update:download` 保持现状不接到启动流程里，但**设置页应新增一个可见入口**：
  `available` 态下除了「浏览器下载」再加一个「静默下载」按钮 → `update:download`。理由：静默流程失败时用户需要手动兜底。
- 文案保持中文，与既有风格一致。

### 2.6b 确认框（新增 `src/renderer/components/UpdateReadyDialog.tsx`）

- antd `Modal`，`open = status === 'downloaded' && !dismissed`，挂在 `App.tsx`（与 `DownloadNotifications` 平级）。
- 内容：标题「更新已就绪」+ 一句「新版本 vX 已下载完成。安装需要先退出应用，装完会自动重新打开。」
- 按钮：「稍后」= 收起弹窗（**只改本地 dismissed，不改主进程状态**，徽标与设置页入口保留）；
  「立即安装并重启」= `update:install`，失败时把返回的 `error` 显示在框内。
- `status` 离开 `downloaded` 时复位 `dismissed` / `installing` / `error`，下次下好还要再问一次。
- **这是唯一会退出应用的入口**（连同设置页同义按钮），启动流程不得触发（I5）。

### 2.7 新增/变更 IPC 汇总（本规格）

| 通道 | 方向 | 签名 | 说明 |
| --- | --- | --- | --- |
| `update:getStatus` | renderer → main | `() => UpdateStatus` | 首帧快照（I2/I3），`registerIpcHandlerSimple` 裸返回 |
| `update:install`（**语义变更**） | renderer → main | `() => { ok: boolean; error?: string }` | 退出应用 + 静默安装 + 自动重启（I4/I5），带 `{success,data}` 封套 |

`docs/agents/architecture.md:50` 的域清单（`update` 组）与 `:52` 的 push 清单**无需变更**（未新增 push 通道），
但 `:50` 的 `domain:action` 描述可不动；**规格落地后由实现者在 PR 里确认这两处是否仍准确**。

## 3. 移动端

### 3.1 持久化（`packages/mobile/stores/settingsStore.ts`）

```ts
interface SettingsState {
  /** 用户已忽略的更新版本号（#579）：同版本不再弹窗；null = 未忽略 */
  dismissedUpdateVersion: string | null;
  setDismissedUpdateVersion: (version: string | null) => void;
}
```

默认值 `null`；随既有 `persist`（`name: 'settings-storage'`）落盘，不需要新增 store。

### 3.2 纯判据（新增 `packages/mobile/services/appUpdatePrompt.ts`）

```ts
/** 是否应当弹窗：有新版本且该版本未被忽略（I7）。纯函数，零 I/O，便于单测。 */
export function shouldPromptUpdate(
  latestVersion: string | undefined,
  dismissedVersion: string | null,
): boolean;
```

### 3.3 弹窗宿主（新增 `packages/mobile/components/UpdatePromptHost.tsx`）

- 挂载在 `packages/mobile/app/_layout.tsx`，与 `SongActionsHost` / `PlaybackNoticeToast` 平级（`AnimatedBgProvider` 内）。
- 启动检查：`setTimeout` 延时（`UPDATE_PROMPT_DELAY_MS = 5000`）后调
  `checkLatestRelease(Constants.expoConfig?.version ?? '0.0.0', useSettingsStore.getState().updateChannel)`；
  用 `getState()` 读通道而不是订阅，避免通道变化重跑启动检查。
- 命中 `shouldPromptUpdate` 才 `setVisible(true)`；**失败一律静默**（I1）。
- 弹窗内容：标题「发现新版本 v{version}」、`releaseNotes`（`numberOfLines` 限高）、`needsUninstallMigration`
  时追加既有跨签名提示文案（与设置页 `UpdateSection` 同款，避免两处文案分叉——**提取为共享常量/组件**）。
- 「叉掉」：`setVisible(false)` + `setDismissedUpdateVersion(version)`。
- 「立即更新」：`Linking.openURL(apkUrl)` + `setVisible(false)` + `setDismissedUpdateVersion(version)`。
- 复用 `Modal`（仓库既有用法见 `app/(tabs)/playlists.tsx`）与主题 token（`useTheme()`），不写死颜色。
- **不修改**设置页 `UpdateSection` 的手动入口行为。

### 3.4 与设置页的文案去重

`UpdateSection.tsx` 与弹窗都要展示「新版本 + 说明 + 迁移提示」。规格要求：把
**新版本信息块**抽成一个共享组件（如 `components/settings/UpdateAvailableInfo.tsx`），
两处引用同一份，避免 `needsMigration` 文案分叉（#263 的签名迁移提示是安全相关文案）。

## 4. 验收标准（可测、可演示）

| # | 平台 | 判据 |
| --- | --- | --- |
| A1 | 双端 | 冷启动后自动检查一次；无新版时界面**零变化**（无提示、无徽标、无弹窗） |
| A2 | desktop | 有新版时左下「设置」旁出现徽标（`aria-label` 含「有可用更新」），并开始静默下载 |
| A3 | desktop | 下载完成后**应用不退出**，而是弹出「更新已就绪」确认框；点「立即安装并重启」→ 应用退出 → 静默安装（`/S`）→ 应用自动重新打开且版本已更新 |
| A4 | desktop | 「启动检查早于渲染层就绪」不丢状态：`update:getStatus` 返回 `available`，徽标显示 |
| A5 | desktop | 点「稍后」只收起弹窗：应用继续运行、徽标仍在、设置页仍可安装（不调用 `quitAndInstall`） |
| A6 | desktop | 设置页在 `available` 态可手动「静默下载」；`downloaded` 态可「立即安装并重启」（走 `update:install`） |
| A7 | mobile | 有新版弹窗出现；点「叉掉」后同版本不再弹（重启应用仍不弹），下个版本仍弹 |
| A8 | mobile | 点「立即更新」调 `Linking.openURL(apkUrl)` 且弹窗关闭 |
| A9 | 双端 | 断网 / 全部更新源不可用时静默：无错误弹窗、启动不受阻、控制台仅 warn/error 日志 |

## 5. 测试矩阵

| 层 | 文件 | 覆盖 |
| --- | --- | --- |
| main | `src/__tests__/main/updateService.test.ts`（扩展） | `runStartupFlow`：not-available 不下载也不安装；available → 只下载、**不** `quitAndInstall`；check 抛错静默不 throw；download 抛错静默；`installDownloadedUpdate` 未下载完时 `{ok:false}` 且不退出；下载完成后 `quitAndInstall` 恰以 `(true, true)` 调用 |
| renderer | `src/renderer/__tests__/updateStore.test.ts`（新增） | push 更新状态；`initUpdateBridge` 幂等；快照晚于 push 不回退（I3）；`hasUpdate` 派生 |
| renderer | `src/renderer/__tests__/Sidebar.test.tsx`（扩展） | `updateAvailable` 为 true 渲染徽标且 `aria-label` 正确；false 不渲染 |
| mobile | `packages/mobile/__tests__/updatePrompt.test.ts`（新增） | `shouldPromptUpdate` 三态（有新版未忽略 / 已忽略同版本 / 未忽略但 latest 为 undefined）；`setDismissedUpdateVersion` 落 store |

`npm run verify -- <scope>` 为准（`main` / `renderer` / `mobile` 三个分片 + `static`）。
`UpdateReadyDialog` 的交互（确认 → `update:install`；稍后 → 只收起）属 UI 走查项，不进单测矩阵。

## 6. 明确不做（out-of-scope）

1. 不新增 MSI 产物、不改 `electron-builder.yml` 的 `win.target`（I8）。
2. 不做移动端应用内下载 APK / 拉起安装器（I9）。
3. 不做 iOS 自更新与 iOS 分发（本仓不发 IPA）。
4. 不做桌面端「已下载」跨进程持久化（ADR 后果段已定：进程重启回到 idle，下次启动重新检查）。
5. 不改移动端设置页 `UpdateSection` 的既有手动入口行为与通道选择/测速。
6. 不做更新检查的节流策略（如「24 小时内已检查过就跳过」）——每次冷启动检查一次，失败静默，代价可接受。
7. 不把更新检查纳入 core 的 `outboundGate`（ADR 后果段已记录这是闸门之外的出网）。
