# 双端「进入即检查更新」调研：桌面徽标 / 移动弹窗 / 静默下载安装

> 调研日期：2026-10-05 · 类型：调研 · **文档类，可直接入库**
> 触发：用户提问（**尚未开 issue**——按 `AGENTS.md`「Issue 先行」，动手前应先开 `[Feature]:` 票）
> 方法：**仓库一手代码逐处核对**（含 `node_modules` 内 `electron-updater@6.8.9` / `app-builder-lib@26.x` / `expo-file-system@57` 源码）+ 官方文档（electron.build、docs.expo.dev、developer.android.com、learn.microsoft.com、Apple）。
> 约定：**每条结论标证据强度**；凡未核实一律写「未找到可靠来源」，不做推测。标「推断」的条目不得当结论引用。

---

## 0. 结论速览

| 问题 | 结论 | 强度 |
| --- | --- | --- |
| 双端现在有更新链路吗？ | **有且已上线**：桌面 `electron-updater` + 镜像通道（#262），移动 `latest.yml` 探测 + APK 直链（#262/#263） | 源码，**强** |
| 现在进入应用会检查更新吗？ | **不会**。双端都只有设置页里的手动按钮，无启动检查 | 源码，**强** |
| 桌面有徽标位吗？ | 没有。`Sidebar` 左下「设置」是普通 nav item，无 badge 插槽；且更新状态是 `UpdateSection` 的**局部 state**，跨组件不可见 | 源码，**强** |
| 桌面更新链路里有 **MSI** 吗？ | **没有，一个 `.msi` 都没有**。Windows 产物是 `nsis`（`MPlayer-Setup-<ver>.exe`）+ `portable`。全仓 grep `\.msi\b` 零命中 | 源码，**强** |
| 桌面能静默下载安装包并自动运行吗？ | **能，且能力已就位**：`autoUpdater.downloadUpdate()` 就是进程内静默下载（现在没接到 UI），`quitAndInstall(true, true)` = `/S --force-run` 静默装 + 自动重启 | 源码 + 官方 API 文档，**强** |
| 那为什么不这么做？ | **ADR-0011 决策 3 已明确否决**：公共镜像大文件吞吐「逐次抽奖、0% 停滞频发」，定案把大文件交给浏览器/系统下载器。本需求与既有决策**直接冲突** | ADR 原文，**强** |
| 若真要交付 MSI 能自更新吗？ | **不能**。`msi` 目标 `isWriteUpdateInfo: false` → 不产 `latest.yml` / `app-update.yml`，与 `publish: github` feed 不兼容；electron-updater 官方矩阵把 MSI 标为「Not supported via electron-updater」。`msi-wrapped` 虽被支持，但它**包裹的是 NSIS exe**，下发的仍是 exe | 源码 + 官方文档，**强** |
| 移动弹窗可行吗？ | 可行且成本低：`app/_layout.tsx` 已有启动 effect 落点，`Modal` 有现成用法，`settingsStore` 是 persist 的 Zustand（存「已忽略版本」） | 源码，**强** |
| 移动端能「应用内下载 APK 并拉起安装器」吗？ | **能，但一定弹系统确认框，不可能真静默**。且需要：① 手改 `AndroidManifest.xml` 加 `REQUEST_INSTALL_PACKAGES`；② 新增原生依赖 `expo-intent-launcher`（未安装，SDK 57 期望 `~57.0.1`）→ 需重建 dev client | 源码 + Android 官方文档，**强** |
| iOS 呢？ | **不可能自更新**（Guideline 2.5.2）；且本仓 release **不发 IPA**，iOS 实际无分发通道 | 官方文档 + `release.yml`，**强** |

---

## 1. 现状：已有什么、缺什么

### 1.1 桌面端

| 层 | 位置 | 现状 |
| --- | --- | --- |
| 服务 | `src/main/services/updateService.ts` | 镜像通道测速/排序/逐源降级；`checkForUpdates` / `downloadUpdate`（带首字节 25s + 停滞 30s 看门狗）/ `openDownloadInBrowser` / `quitAndInstall` / `speedTest` |
| 配置 | 同文件 `:106-107` | `autoUpdater.autoDownload = false`、`autoInstallOnAppQuit = true` |
| IPC | `src/main/ipc/appSettingsUpdate.ts:146-164` | `update:check` / `update:download` / `update:downloadInBrowser` / `update:install` / `update:getVersion` / `update:getChannels` / `update:setChannel` / `update:speedTest` |
| 接线 | `src/main/main.ts:375` | `registerUpdateIpc(mainWindow)`，在 `createWindow()`（`:252`）之后 |
| Push | `updateService.updateStatus` `:174-177` | 只 `mainWindow.webContents.send('update:status', ...)`，**无「读取当前状态」的 IPC** |
| UI | `src/renderer/components/UpdateSection.tsx` | 设置页内一个 section：通道下拉 + 测速 + 检查按钮 + 进度条 |
| 徽标位 | `src/renderer/components/Sidebar.tsx:146-154` | 左下只有 `renderNavItem({ key: 'settings', ... })`，`renderNavItem` 无 badge 参数 |

**关键缺口（三条，都不是界面问题而是状态问题）：**

1. **没有任何启动检查。** `update:check` 的唯一调用点是 `UpdateSection.tsx:112`（用户点按钮）。
2. **状态不可查询。** 只有 push，没有 `getStatus` 通道。启动检查若在渲染层订阅之前完成，事件丢失且无法补救 → 徽标永远不亮。（渲染层现在靠局部 state 起步于 `'idle'`，`UpdateSection.tsx:19`。）
3. **状态不跨组件共享。** 更新状态是 `UpdateSection` 的组件内 `useState`，`Sidebar` 看不到。renderer 的共享层是 `src/renderer/store/`（Zustand，已有 `searchStore` / `playerStore` / `downloadStore` / `favoriteStore` / `localStore`），这里没有 update store。

### 1.2 移动端

| 层 | 位置 | 现状 |
| --- | --- | --- |
| 服务 | `packages/mobile/services/appUpdate.ts` | `checkLatestRelease`：按通道逐个拉 `latest.yml`（8s/源）拿版本号 → 全失败回落 GitHub API（10s）；有新版再尽力补 releaseNotes（4s）；产出 APK 直链 |
| UI | `packages/mobile/components/settings/UpdateSection.tsx` | 「关于」卡片内：通道选择/展开/测速/检查更新；`handleUpdate` = `Linking.openURL(apkUrl)`（`:74-76`）交给浏览器 |
| 启动落点 | `packages/mobile/app/_layout.tsx:115-135` | 已有启动 effect（`initAudio` / 迁移 / 通知权限 / 缓存回填），**无更新检查** |
| 持久化 | `packages/mobile/stores/settingsStore.ts` | Zustand + `persist`；`updateChannel` 默认 `'auto'`（`:61`）——「已忽略版本」可同处存放 |
| 弹窗能力 | — | `Modal` 在 `app/playlist/[id].tsx`、`app/(tabs)/playlists.tsx`、`discover-playlist/[id].tsx` 有现成用法；`components/` 下另有 3 个 `*Modal.tsx` |
| 权限 | `packages/mobile/android/app/src/main/AndroidManifest.xml:2-10` | 有 `INTERNET` / `SYSTEM_ALERT_WINDOW` / 存储等；**没有 `REQUEST_INSTALL_PACKAGES`** |
| 依赖 | `packages/mobile/package.json` | 有 `expo-file-system@~57.0.7`；**没有** `expo-intent-launcher`、`expo-sharing` |

---

## 2. 先纠正前提：这个仓库没有 MSI

需求原话是「静默直接下载 **MSI** 的那个安装包，然后自动打开运行 MSI」。**这个前提不成立**，先说清楚：

- `electron-builder.yml:31-58` 的 `win.target` 只有 `nsis`（`artifactName: ${productName}-Setup-${version}.${ext}`，`oneClick: false`，`allowToChangeInstallationDirectory: true`）与 `portable`。
- 全仓 `grep '\.msi\b|\bMSI\b'`（`docs/` `src/` `packages/` `.github/`）**零命中**。
- `.github/workflows/release.yml:385-393` 上传的是 `desktop-{linux,mac,win}` 目录 + `*.apk` + `*.aab`。
- ADR `docs/adr/2026-08-28-update-mirror-channels.md:25`（#350）已把「Windows 产物名」这套三处一致性（磁盘名 = feed 名 = 资产名）钉死，改动产物矩阵会直接触碰这条线。

所以「静默下载安装包并自动运行」在**不改产物矩阵**的前提下，指的就是那个 NSIS `MPlayer-Setup-<ver>.exe`。这反而更好办（见 §3）。

### 2.1 如果确实要加 MSI，代价与死路

| 事项 | 事实 | 强度 |
| --- | --- | --- |
| electron-builder 26 有 `msi` 目标吗？ | 有（`node_modules/app-builder-lib/out/targets/MsiTarget.js` 实存；官方 win targets 页列出） | 源码，**强** |
| 构建依赖 | 内部用 WiX Toolset（`MsiTarget` 里 `getBinFromUrl("wix", "4.0.0.5512.2", ...)` 自动下载）；官方 msi 页只说「uses WiX Toolset internally」 | 源码/文档，**强**（版本号仅源码，文档未写） |
| MSI 会写更新 feed 吗？ | **不会**。`MsiTarget` 产物标 `isWriteUpdateInfo: false`；`app-update.yml` 只在 Windows 侧含 `nsis`/`nsis-*` 时才写 | 源码，**强** |
| electron-updater 支持 MSI 安装自更新吗？ | **不支持**。官方 msi 页表格写明「Auto-update: Not supported via electron-updater」；targets 页同款 | 官方文档，**强** |
| `msi-wrapped` 呢？ | 被标为支持，但它**强制要求同时配 `nsis`**（否则 `No nsis target found!`），本质是把 NSIS exe 包进 MSI 壳。feed 与 updater 拿到的都是**内层 exe**，不是 MSI | 源码，**强**（官方 targets 表列支持；此机制文档未叙述 → 源码推导） |
| 自己下 MSI 再 `msiexec /qn`？ | 可行但脱离 electron-updater API。`/qn`/`/quiet` 只压**安装器自身 UI**；需要提升权限时 **UAC 同意框仍会出现**（per-machine 安装必现；per-user 不要求管理员） | Microsoft 文档，**强**（「`/qn` + UAC 的关系」官方文档未逐字合并陈述 ⇒ 该合并结论为推断） |

**要点：把发行形态换成 MSI，会同时丢掉「自动更新」这条链路**——除非同时保留 NSIS，那 MSI 就只是给企业/静默部署用的第二个壳。这属于产品决策，不是技术细节。

---

## 3. 桌面「静默下载 + 自动运行安装包」：能力已就位，冲突在 ADR

### 3.1 能力清单（源码逐处核对）

| 能力 | 现状 |
| --- | --- |
| 进程内静默下载 | **已有**：`updateService.downloadUpdate()`（`src/main/services/updateService.ts:412-463`）→ `autoUpdater.downloadUpdate()`。`autoDownload=false` 下这是官方指定的手动入口；下载走 updater 自己的 `netSession`，全程无对话框，落盘前做 sha512 校验 |
| 看门狗 | **已有**：首字节 25s / 进度停滞 30s / 持续推进不限时（`:44-45`、`:328-376`）；停滞源**会话内降权到队尾**（`:252-258`） |
| 逐源降级 | **已有**：检查/下载都沿通道顺序降级（`:391-401`、`:426-454`） |
| 静默安装 + 自动重启 | **差一个参数**：`quitAndInstall()` 现无参调用（`:483-485`）→ `isSilent=false` → NSIS **辅助安装向导会显示**。改 `quitAndInstall(true, true)` 即为 `/S`（静默）+ `--force-run`（装完自动起） |
| 未调用 `quitAndInstall` 时退出即装 | **已有**：`autoInstallOnAppQuit = true` → 退出时代码 0 则 `install(true, false)`（静默装、不自动起） |
| 免签名校验的静默升级 | `electron-builder.yml:43` `verifyUpdateCodeSignature: false`、`forceCodeSigning: false` |

`NsisUpdater.doInstall` 的实际参数拼装（`node_modules/electron-updater/out/NsisUpdater.js`）：`["--updated"]` + `isSilent ? "/S"` + `isForceRunAfter ? "--force-run"` + 可选 `/D=<installDirectory>` + `--package-file=<path>`；`isAdminRightsRequired`（per-machine 且 `oneClick` 或 `packElevateHelper` 时由 feed 携带）则改走随包 `elevate.exe`（此时**会弹 UAC**），并在 `EACCES` 时回落 elevate。

### 3.2 与 ADR-0011 的正面冲突

ADR `docs/adr/2026-08-28-update-mirror-channels.md` 决策 3 原文：

> **大文件下载交给专职工具**：……桌面端：`shell.openExternal` 同构接管（**electron-updater 保留检查与元数据职责，进程内单流下载对公共镜像波动无抵抗力——真机实测 ghfast 连接质量逐次抽奖，0% 停滞频发**）。

同 ADR「后果」又记：`syncProxyEnv` 未配置时钉死直连、系统代理（Clash）对更新器不可见；WSL2 下 Cloudflare 镜像 UDP 443 中转不可靠致 0% 停滞。

也就是说：**用户现在想要的「静默进程内下载」，正是 ADR-0011 当时实测否决的那条路。** 进程内下载代码被刻意保留（注释写明「未来可做设置项」），所以技术上随时能开，但这是一个**需要重新决策**的动作，不是实现细节。

可选口径（供决策，非结论）：

| 方案 | 说明 | 主要风险 |
| --- | --- | --- |
| A. 保持浏览器下载 | 徽标/弹窗只做「有新版本」的提示，下载仍走浏览器 | 与「自动打开运行」诉求不符 |
| B. 进程内静默下载 + 静默安装 | 用现成 `downloadUpdate` + `quitAndInstall(true, true)` | 回归 ADR-0011 实测的镜像停滞问题；看门狗会换源但仍可能全源失败；**静默安装全程无 UI**，失败时用户无感 |
| C. 双模式（默认静默，设置项可切浏览器） | ADR 已预留「未来可做设置项」 | 状态机与文案分支变多；失败路径要有明确出口 |
| D. 均不选，先只做提示 | 徽标 + 弹窗先落地，「自动运行」另开票 | 最小步长，最稳 |

> **未核实的部分（真机未验）**：当前已安装的 1.8.x 都是 `oneClick: false` 的**辅助安装器**装的，`--updated` + `/S` 在这条存量安装路径上的实际表现**仓库内无证据**（无 e2e、无真机记录）。源码显示 `/S` 是 electron-builder NSIS 模板注册的参数、静默时由 installer 自读注册表 `InstallLocation` 复用安装目录，但**必须在真 Windows 上对存量安装做一次实测**才能当结论。列为验收前置项。

---

## 4. 桌面徽标：落点与需要补的状态管道

- **落点**：`Sidebar.tsx:146-154` 左下「设置」项旁。`renderNavItem`（`:70-106`）是唯一渲染函数，加 badge 只需扩一个可选 prop；`navItemStyle` 已是 `position: relative`（`:58`），绝对定位的圆点可直接挂。
- **数据来源**：需要新增 renderer 共享状态（`src/renderer/store/` 下新建 update store）+ 一个 `update:getStatus` IPC。理由见 §1.1 的三条缺口。
- **启动检查时机**：`registerUpdateIpc(mainWindow)` 在 `createWindow()` 之后（`main.ts:252` → `:375`），主进程若在 `app.whenReady` 里立刻发起检查，**早于渲染层完成订阅**（渲染层只订阅 push）→ 必须靠 `update:getStatus` 兜底，或把检查放在 `webContents` 的 `did-finish-load` 之后。
- **「忽略此版本」**：需要持久化一个「已忽略版本号」。桌面持久化入口是 `src/main/storage/fileStorage.ts` 的 `db.getSetting / setSetting / getSettingSync`（`:790/:798/:804`），与 `updateChannel`（`CHANNEL_SETTING_KEY`）同款做法。
- **出网治理**：core 的 `outboundGate` 只管 `packages/core/src/api/transport.ts` 这一条接缝（ADR `2026-09-26-outbound-request-governance.md:8-9`）。桌面更新检查走 `electron-updater` 自带 `netSession`、移动走裸 `fetch`，**都不经闸门**。启动新增一次检查 = 闸门之外的出网，需在 spec 里明确是否纳入治理。
- **成本**：一次 `checkForUpdates` 最坏 = 通道数 × `timeoutMs`（默认 10000ms/源，README 级 `latest.yml` 数百字节）。启动即检查时应缩短超时或复用 `PROBE_CACHE_TTL_MS = 10min` 的探针缓存（`:35`）。

---

## 5. 移动端弹窗

- **落点**：`packages/mobile/app/_layout.tsx` 的启动 effect（`:115-135`）之后延迟触发；弹窗宿主可仿 `PlaybackNoticeToast`（同文件 `:51-81`）这种「挂在 `RootLayout` 里的全局单例」写法，或复用 `Modal`。
- **「叉掉」**：需要持久化「已忽略版本」到 `settingsStore`（persist 已就绪，`updateChannel` 就是现成范式）。
- **「立即更新」两种实现**：
  - **保持现状（推荐起步）**：`Linking.openURL(apkUrl)` → 浏览器下载器接管。零新依赖、零原生改动，与 ADR-0011 决策 3 一致。
  - **应用内下载 + 拉起安装器**：见 §6，成本明显更高（原生权限 + 新原生依赖 + 重建 dev client）。
- **启动即检查的代价**：`checkLatestRelease` 逐个源拉 `latest.yml` 每源 8s、失败回落 API 10s、补 notes 再 4s。冷启动本来就跑「发现页首屏数百次上游请求」（ADR-2026-09-26 背景第 4 条），再叠一次启动检查会抢带宽。建议：延后触发（首帧后 + 延时）、或用短超时、或仅在网络非计量时检查。
- **iOS**：`app.json` 有 `bundleIdentifier`，但 `release.yml` 只发 APK/AAB，**没有 IPA 分发**。且 Apple Guideline 2.5.2 明确禁止应用下载并安装代码，唯一路径是 App Store / TestFlight / Ad Hoc / Enterprise。→ **iOS 上「立即更新」只能是「跳转商店/提示」**，不能下载安装。

---

## 6. 移动端应用内安装 APK（若要做）

### 6.1 必须做的事

| # | 事项 | 依据 | 强度 |
| --- | --- | --- | --- |
| 1 | 声明 `android.permission.REQUEST_INSTALL_PACKAGES` | targetSdk ≥ 26 使用 `ACTION_INSTALL_PACKAGE`/`PackageInstaller` 的前提 | Android 官方文档，**强** |
| 2 | 改**哪个**文件 | 本仓 `android/` 已入库（CNG 反向），插件只在 prebuild 期执行；Expo 官方口径也是「改权限直接编辑 `AndroidManifest.xml`」 | 官方文档，**强** |
| 3 | 新依赖 `expo-intent-launcher` | 未安装；SDK 57 期望版本 `~57.0.1`（`node_modules/expo/bundledNativeModules.json`）。是**原生模块** → 需重建 dev client | 源码，**强** |
| 4 | 下载 APK 到本地 | `File.downloadFileAsync(url, destination)`（`expo-file-system` 新 API）；或 legacy `downloadAsync` / `createDownloadResumable` | 官方文档 + 本仓 `expo-file-system@~57.0.7`，**强** |
| 5 | 拿 content URI | `File.contentUri`（SDK 57 原生类属性，`build/internal/NativeFileSystem.types.d.ts:248`，`@platform android`）；或 legacy `getContentUriAsync`（**必须**从 `expo-file-system/legacy` 导入——根导出已 `@deprecated … will throw in runtime`） | 源码，**强** |
| 6 | 拉起安装器 | `IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: cUri, flags: 1 })`，`1 = FLAG_GRANT_READ_URI_PERMISSION`；MIME 可传 `application/vnd.android.package-archive` | Expo 官方文档示例（写在 `getContentUriAsync` 的 JSDoc 里）+ Android FileProvider 文档，**强** |
| 7 | FileProvider | **无需自己配**：`expo-file-system` 的 Android 清单已内置 `provider`，authority = `${applicationId}.FileSystemFileProvider`，`grantUriPermissions="true"` | 源码，**强** |

### 6.2 不可能真静默

- `PackageInstaller.SessionParams.setRequireUserAction`：对持有 `REQUEST_INSTALL_PACKAGES` 的应用，**未显式设置时视同 `USER_ACTION_REQUIRED`** → 系统确认界面。
- Android 12+ 的 `USER_ACTION_NOT_REQUIRED`（无 UI）只在安装方是**更新所有者 / installer of record / 「正在更新自己」/ 持有 `UPDATE_PACKAGES_WITHOUT_USER_ACTION`** 时生效。MPlayer 是用户从浏览器/文件管理器**侧载**的 → MPlayer 不是自己的 installer of record → **每次更新都会弹系统确认框**。
- 真正静默只有两条路：device owner / affiliated profile owner，或系统级 `INSTALL_PACKAGES`（`protectionLevel="signature|privileged"`，第三方不可用）。
- 首次还需用户在系统设置里为 MPlayer 打开「安装未知应用」；`canRequestPackageInstalls()` 可检测，`ACTION_MANAGE_UNKNOWN_APP_SOURCES` 可跳转。

**结论：移动端「立即更新」的体验上限是「一次系统确认框」，不会比现在的浏览器路径少点几下太多**——但可以省掉「跳浏览器 → 下载 → 在下载列表里点开」的来回，并把版本与安装包绑定（避免装错版本）。收益真实但有限。

---

## 7. 需要决策的点（写给后续 ADR / spec）

1. **「静默下载 + 自动运行」是否重新推翻 ADR-0011 决策 3？** 若推翻，需要新 ADR 记录为什么这次结论不同（例如：新增了更严的看门狗与逐源降级、或加了设置项让用户自选）。
2. **`quitAndInstall(true, true)` 的静默安装是否对所有既有安装生效？** 真机实测前置（见 §3.2 未核实项）。
3. **「自动运行安装包」是否等于「静默安装」？** 二者不同：前者可以只是 `shell.openPath(exe)` 弹出辅助向导让用户点（与 ADR-0011 的浏览器路径体验不同但同样不静默）。需求原文没说清，建议先确认。
4. **MSI 要不要？** 若要，是「额外加一个给企业用的壳」还是「替换 NSIS」——后者直接丧失自动更新（§2.1）。
5. **移动端是否投入应用内安装？** 需要新增原生权限 + 原生依赖 + 重建 dev client，且换不来「静默」。
6. **「已忽略版本」的粒度**：只忽略该版本（下个版本再提示）还是永久静音？桌面/移动要一致。
7. **启动检查的出网是否纳入治理**（§4 末）与超时预算。

---

## 8. 证据清单（一手来源）

**仓库源码 / 配置**
- `src/main/services/updateService.ts` · `src/main/ipc/appSettingsUpdate.ts:146-164` · `src/main/main.ts:252,375` · `src/main/preload.ts`（`invoke`/`on` 为泛型透传，无 channel 白名单） · `src/main/storage/fileStorage.ts:790,798,804`
- `src/renderer/components/UpdateSection.tsx:106,112,123-141` · `src/renderer/components/Sidebar.tsx:58,70-106,146-154` · `src/renderer/store/`
- `packages/mobile/services/appUpdate.ts:126-166` · `packages/mobile/components/settings/UpdateSection.tsx:53-76` · `packages/mobile/app/_layout.tsx:51-81,115-135` · `packages/mobile/stores/settingsStore.ts:33,61` · `packages/mobile/app.json`（`version 1.8.6` / `versionCode 27`） · `packages/mobile/android/app/src/main/AndroidManifest.xml:2-10` · `packages/mobile/package.json`
- `electron-builder.yml:31-58` · `.github/workflows/release.yml:381-393` · `dev-app-update.yml`
- `node_modules/electron-updater/out/NsisUpdater.js`（`doInstall`）、`out/NsisUpdater.d.ts:11`、`out/AppUpdater.d.ts`（`quitAndInstall(isSilent?, isForceRunAfter?)`）
- `node_modules/app-builder-lib/out/targets/MsiTarget.js`、`MsiWrappedTarget.js`、`out/publish/updateInfoBuilder.js`、`scheme.json`
- `node_modules/expo-file-system/build/internal/NativeFileSystem.types.d.ts:248`、`build/legacy/FileSystem.d.ts:50`、`build/legacyWarnings.d.ts:11-13`、`android/src/main/AndroidManifest.xml`、`node_modules/expo/bundledNativeModules.json`

**既有决策/文档**
- ADR `docs/adr/2026-08-28-update-mirror-channels.md`（#262/#263，决策 3 与后果段）
- ADR `docs/adr/2026-09-26-outbound-request-governance.md:8-9`（唯一出网接缝）
- `docs/agents/architecture.md:50,52`（IPC 域与 push 通道清单）
- Issues：#262 #263 #350（均已 CLOSED）；**本次需求尚无 issue**

**外部官方文档**
- [electron-builder · auto-update](https://www.electron.build/v26/docs/features/auto-update) · [targets](https://www.electron.build/v26/docs/targets) · [msi](https://www.electron.build/v26/docs/msi) · [msi-wrapped](https://www.electron.build/v26/docs/msi-wrapped) · [nsis](https://www.electron.build/v26/docs/nsis) · [AppUpdater API](https://www.electron.build/v26/docs/api/electron-updater.Class.AppUpdater)
- [electron-builder v26.0.12 MsiTarget.ts](https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/app-builder-lib/src/targets/MsiTarget.ts) · [MsiWrappedTarget.ts](https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/app-builder-lib/src/targets/MsiWrappedTarget.ts) · [PublishManager.ts](https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/app-builder-lib/src/publish/PublishManager.ts) · [NsisTarget.ts](https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/app-builder-lib/src/targets/nsis/NsisTarget.ts)
- [msiexec 命令行选项](https://learn.microsoft.com/en-us/windows/win32/msi/command-line-options) · [标准命令行选项（/quiet /qn /norestart）](https://learn.microsoft.com/en-us/windows/win32/msi/standard-installer-command-line-options) · [Using Windows Installer with UAC](https://learn.microsoft.com/en-us/windows/win32/msi/using-windows-installer-with-uac) · [Installation Context](https://learn.microsoft.com/en-us/windows/win32/msi/installation-context)
- [PackageInstaller](https://developer.android.com/reference/android/content/pm/PackageInstaller) · [PackageInstaller.SessionParams](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams) · [Intent（ACTION_INSTALL_PACKAGE 已弃用）](https://developer.android.com/reference/android/content/Intent) · [FileProvider](https://developer.android.com/reference/androidx/core/content/FileProvider) · [FileUriExposedException](https://developer.android.com/reference/android/os/FileUriExposedException) · [Publish your app（unknown apps / canRequestPackageInstalls）](https://developer.android.com/studio/publish) · [Android 14 behavior changes](https://developer.android.com/about/versions/14/behavior-changes-all)
- [expo-file-system](https://docs.expo.dev/versions/latest/sdk/filesystem/) · [expo-file-system（legacy）](https://docs.expo.dev/versions/latest/sdk/filesystem-legacy/) · [expo-intent-launcher](https://docs.expo.dev/versions/latest/sdk/intent-launcher/) · [expo-sharing](https://docs.expo.dev/versions/latest/sdk/sharing/) · [config plugins](https://docs.expo.dev/config-plugins/introduction/) · [mods](https://docs.expo.dev/config-plugins/mods/) · [app config](https://docs.expo.dev/versions/latest/config/app/) · [distribution](https://docs.expo.dev/distribution/introduction/)
- [Apple App Review Guidelines 2.5.2](https://developer.apple.com/app-store/review/guidelines/) · [Distributing your app](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)

**方法备注**：`developer.android.com` 对直接抓取有拦截，相关页面经 Exa 抓取代理取得（页面正文一致）。Android 12 PendingIntent 可变性页面当时不可抓取，已在 §6.2 对应位置标注。
