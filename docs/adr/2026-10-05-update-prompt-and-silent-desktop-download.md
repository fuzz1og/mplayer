# 进入即检查更新：桌面左下徽标 + 静默下载 + 应用内确认后退出安装；移动端弹窗跳浏览器

日期：2026-10-05 · 状态：已接受 · 关联：**#579**（本决策的实现票）·
**部分取代** `docs/adr/2026-08-28-update-mirror-channels.md`（ADR-0011）的**决策 3 之桌面端**（移动端维持原判）·
依据：`docs/research/2026-10-05-update-prompt-research.md`（证据清单与逐条强度，本文件不重复论证）

## 背景

双端更新链路（#262/#263）已上线，但**只有设置页的手动按钮**能触发检查（桌面 `update:check` 的唯一调用点是设置页；
移动端同理）。不进设置页的用户永远不知道有新版本。

仓库里已有的、本决策要复用的能力：

- 桌面 `updateService.downloadUpdate()` 就是**进程内静默下载**（`electron-updater` 的 `netSession`，无对话框，落盘前 sha512 校验），
  带首字节 25s / 停滞 30s 看门狗与停滞源降权，并沿通道逐源降级；只是**没有接到 UI**。
- 桌面状态只有 `update:status` **push**，没有「读取当前状态」的 IPC → 启动检查若早于渲染层订阅就会丢状态。
- 移动端 `checkLatestRelease` 产出 APK 直链，`handleUpdate` 走 `Linking.openURL`（ADR-0011 决策 3 的浏览器路径）。

ADR-0011 决策 3 曾以「公共镜像大文件吞吐逐次抽奖、0% 停滞频发」为由，把**双端**大文件下载交给浏览器。
#579 的诉求是在桌面端走回进程内静默下载，故本决策对桌面端反转该条，移动端维持。

### 本决策的技术前提：安装器的「应用正在运行」提示来自哪里

这是本决策能成立的关键，且与直觉相反，必须钉死（源码：electron-builder NSIS 模板
`templates/nsis/include/allowOnlyOneInstallerInstance.nsh` 的 `_CHECK_APP_RUNNING`，
由 `templates/nsis/installSection.nsh` 在安装段插入）：

| 安装器启动方式 | `isUpdated` | 检测到应用在跑时的行为 |
| --- | --- | --- |
| 带 `--updated`（即 `quitAndInstall`） | true | **不弹任何提示**：`Sleep` → `KILL_PROCESS`（taskkill）→ 仍不退出则强杀 |
| 不带 `--updated`（用户/`shell.openPath` 直接运行 exe） | false | `MessageBox "$(appRunning)"`：**「MPlayer 正在运行。点击确定关闭它。」** → 确定则关应用继续安装，取消则退出安装器 |

而 `quitAndInstall()` 的实现是**先 spawn 安装器（带 `--updated`）再 `app.quit()`**
（`BaseUpdater.quitAndInstall` → `NsisUpdater.doInstall`，后者仅在 `isSilent` 时追加 `/S`；
`install()` 内部置 `quitAndInstallCalled`，退出时的 `autoInstallOnAppQuit` 因此不会再装第二次）。

**这张表怎么用**：安装必须**先退出应用**（Windows 上运行中的 exe 被占用就装不进去），所以「谁来关应用」必须选一边：

- 交给安装器（`shell.openPath`，应用继续跑）→ 会多出安装器那一句「应用正在运行」的提示；
- 由应用自己关（`quitAndInstall`）→ 安装器拿到 `--updated`，**安静接管、不重复问**。

本决策选后者：应用自己弹确认框问一次，用户点了就直接退出安装——**一次询问、一个弹窗**，
不依赖也不重复安装器的对话框。#579 的口径即「弹窗 → 退出应用 → 装上」。

## 决策

1. **双端进入应用后自动检查一次更新**（冷启动，首帧之后延时触发，避开首屏请求高峰）；**检查失败一律静默**，
   不弹错误、不阻断启动，手动入口保持不变。
2. **桌面端更新状态以主进程为唯一事实源，并改成「推送 + 拉取」双通道**：
   保留 `update:status` push，新增 `update:getStatus` 供渲染层首帧取一次当前状态；
   渲染层新增 `src/renderer/store/` 下的 update store 承载共享状态（消除 `UpdateSection` 的局部 state）。
3. **桌面端徽标挂在左下角「设置」项旁**，`status === 'available' | 'downloading' | 'downloaded'` 时可见。
4. **桌面端发现新版本后立即开始静默后台下载**（复用现有 `downloadUpdate` 的看门狗与逐源降级），
   **启动流程到此为止、不自行退出应用**。**本决策反转 ADR-0011 决策 3 的桌面端**：桌面端不再把大文件交给浏览器。
5. **下载完成后由渲染层弹确认框**（「新版本已下载完成，安装需要先退出应用」+「稍后」/「立即安装并重启」）。
   用户点确认 → `quitAndInstall(true, true)`：`isSilent` 给 NSIS 传 `/S`（**静默的前提是这个框已经拿到了同意**），
   `isForceRunAfter` 传 `--force-run`（装完自动把应用拉起来）；退出由 electron-updater 完成。
   选「稍后」只收起弹窗：徽标与设置页入口保留，且 `autoInstallOnAppQuit` 仍为真——用户正常退出时会把更新装上
   （不自动重启），不会出现「点了稍后就永远不更新」。
6. **移动端弹窗**（版本号 + 更新说明）：「叉掉」记录**该版本号已忽略**（持久化），同版本不再弹、下个版本仍弹；
   「立即更新」维持 `Linking.openURL(apkUrl)` 跳浏览器。
7. **不做 MSI**：Windows 产物维持 `nsis` + `portable`。理由见备选与否决。
8. **不做移动端应用内下载 APK + 拉起安装器**；**不做 iOS 自更新**。

## 备选与否决

1. **桌面端维持浏览器下载（ADR-0011 决策 3 原判）**——否决：与 #579「静默下载 + 退出安装」的诉求直接冲突。
   保留为**移动端**的方案，并保留为桌面端设置页的手动兜底入口（失败时用户仍可自己走浏览器）。
2. **`shell.openPath(安装包)`：应用不退出，交给安装器提示关闭**——否决（**本 ADR 初版选它，已被 #579 明确纠正**）：
   Windows 上运行中的 exe 被占用就装不了，所以应用终究要退出；让安装器来做这件事会多出第二个对话框
   （我们自己问一次 + 安装器再问一次「应用正在运行」），且退出时机不受我们控制。
3. **`quitAndInstall(false, true)`（可见安装向导 + 自动重启）**——否决：确认框已经在应用内问过一遍，
   再弹 NSIS 向导等于第二个弹窗，把「一次询问」拆成两次；用户的诉求是弹窗后直接退出安装。
4. **自建下载 + `msiexec /qn` 静默装 MSI**——否决：脱离 `electron-updater` 的受支持路径（`NsisUpdater` 只从 feed 取 `.exe`），
   且**MSI 与 `publish: github` + `latest.yml` 不兼容**：electron-builder 的 `MsiTarget` 产物标 `isWriteUpdateInfo: false`，
   不产 `latest.yml` / `app-update.yml`，官方矩阵把 MSI 的 Auto-update 标为「Not supported via electron-updater」。
   `msi-wrapped` 虽被支持，但它强制要求同时配 `nsis`、包裹的是 NSIS exe，updater 下发的仍是 exe → **加 MSI 换不来任何更新能力，
   只是多一个给企业静默部署用的壳**，却要引入 WiX 工具链与产物矩阵变更（触碰 ADR-0011 已钉死的「磁盘名 = feed 名 = 资产名」）。
5. **启动检查做成设置项、默认关**——否决：#579 的诉求就是「进入即检查」。
6. **只在设置页提示、不加徽标**——否决：不解决「用户不进设置页就不知道」。
7. **移动端应用内下载 APK 并拉起安装器**——否决（本次）：需新增 `REQUEST_INSTALL_PACKAGES` 权限与原生依赖
   `expo-intent-launcher`（会要求重建 dev client），而 Android 的系统确认框**必现**（MPlayer 是用户侧载的，
   不是自己的 installer of record），换不来静默；收益不足以抵消成本。若日后要做，另开票。
8. **iOS 自更新**——否决：App Review Guideline 2.5.2 禁止下载并安装代码；且本仓 release 不发 IPA，iOS 实际无分发通道。

## 后果

- **桌面端重新承担 ADR-0011 记录的镜像停滞风险**。缓解手段就是 ADR-0011 决策 4 保留的那套：首字节/停滞看门狗 +
  停滞源会话内降权 + 逐源降级 + 失败静默。这一点是主动接受的取舍，不是遗漏。
- **静默安装失败时无 UI 反馈**：退出应用后安装器全程无界面（`/S`），装失败就是「应用没回来」。
  这是「确认框已问过一次、不再弹第二个框」的代价，也是所有 quit-and-install 类更新的固有性质；
  用户可重新打开应用（仍是旧版）再走一次。
- **`autoInstallOnAppQuit` 保持 true**：点「稍后」并不会让更新消失——正常退出应用时仍会静默装上（不自动重启）。
  点「立即安装并重启」时，`install()` 内部置位的 `quitAndInstallCalled` 会让退出处理器跳过二次安装，
  因此不存在「装两遍」。
- 渲染层双通道（push + 拉取）存在先后竞态：约定**以主进程返回的快照为准做一次覆盖，之后只认 push**，
  由 update store 单点实现，`UpdateSection` 不再自持状态。
- **启动新增一次闸门之外的出网**：core 的 `outboundGate` 只管 `packages/core/src/api/transport.ts` 这条接缝
  （ADR `2026-09-26-outbound-request-governance.md`），桌面更新走 `electron-updater` 的 `netSession`、
  移动端走裸 `fetch`，都不经闸门。故检查超时必须收紧并复用 10 分钟探针缓存，避免与首屏请求抢带宽。
- 桌面端「已下载」状态的持久化**不做**：进程重启后状态回到 idle，下次启动重新检查（`latest.yml` 只有数百字节，
  代价远低于维护一份磁盘状态）。移动端的「已忽略版本」**必须**持久化，否则每次冷启动都弹同一个弹窗。

## 验收（可测）

1. 冷启动后自动检查一次；无新版时双端界面**零变化**（无提示、无徽标）。
2. 桌面端有新版：设置项旁出现徽标且后台开始下载；**下载完成后不自动退出应用**，而是弹出应用内确认框
   「更新已就绪 / 立即安装并重启」。
3. 桌面端点「立即安装并重启」：应用退出 → 安装器静默安装（`/S`）→ 应用自动重新打开且版本已更新
   （即 `quitAndInstall(true, true)`）；点「稍后」则应用继续运行、徽标仍在。
4. 桌面端启动检查早于渲染层就绪时，徽标仍能显示（`update:getStatus` 兜底）。
5. 移动端有新版：弹窗出现；叉掉后同版本不再弹、下个版本仍弹；「立即更新」跳浏览器。
6. 断网 / 全部更新源不可用时，双端均静默，不弹错误、不阻断启动。
