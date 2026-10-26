# Electron 41 → 42+ 大版本升级的落点与破面（一手来源）

> 调研日期：2026-10-26 · 类型：调研 · 关联：[fuzz1og/mplayer#658](https://github.com/fuzz1og/mplayer/issues/658)、[#656](https://github.com/fuzz1og/mplayer/issues/656)、ADR `docs/adr/2026-09-29-dependency-update-governance.md`
> 依据：**仅一手来源** —— Electron 官方文档（`electronjs.org/docs/latest`）、官方发版数据（`releases.electronjs.org`、npm registry `npm view`）、`endoflife.date` API、本仓源码与 `npm audit` 实测。所有结论带**复核时刻**（截至 2026-10-26）。

## 0. 结论先行

1. **#658 正文里的目标「至少在 `^42` 内挑一个 `>= 42.11.16`」已经过期。** 42.x 的 EOL 是 **2026-10-20**，早于本票创建日（2026-10-26）。今天 Electron 官方支持的是 **45 / 44 / 43** 三个 major，42 已出支持窗口（来源：`https://endoflife.date/api/electron.json`，截至 2026-10-26 实测）。
2. **8 条 advisory 里唯一 high 是 `GHSA-jr5w-w6x2-84p9`（eMudhra 中间证书缓解，range `<42.11.16`）**，其余 7 条是 low/moderate（上界分别 `<42.11.1/3/6/9`）。整体 `range: "<=42.11.15"` —— **只要 ≥ 42.11.16 就全部清零**，不需要到 45（来源：本仓 `npm audit --json` 的 `vulnerabilities.electron`，截至 2026-10-26）。
3. **实测：42.11.18 / 43.8.3 / 44.9.3 / 45.0.0 四个候选，`npm audit` 全部 0 条漏洞。** 方法：临时目录 `npm install --package-lock-only --ignore-scripts` + `npm audit --json`（截至 2026-10-26）。**即：`npm audit` 这条 high 在任何 ≥42.11.16 的落点上都能消掉，落点选择与「能不能修」无关，只与「跳到哪个 major」有关。**
4. **本仓唯一确定会被这次升级打破的东西，是一条文档。** Electron 42 起**移除了 `postinstall`**（改为首次运行 `require('electron')` 时按需下载，来源：官方 breaking changes 42.0 节）。因此本仓 `docs/agents/testing.md:35` 与 `scripts/verify.mjs:205` 给出的处置「补一条 `npm rebuild electron`」**在 42+ 上会静默失效**。实测：`electron@42.11.18` + `npm ci --ignore-scripts` + `npm rebuild electron` → 输出 "rebuilt dependencies successfully"，但 `node_modules/electron/path.txt` 与 `dist/` **都不存在**（截至 2026-10-26 实测）。
5. **打包链路不受这条影响。** `electron-builder` 不从 `node_modules/electron/dist` 取二进制：它先 `computeElectronVersion()` 读 `node_modules/electron/package.json` 的 `version`，再自己 `downloadElectronArtifactZip()` 下载对应 zip 解包（来源：本仓 `node_modules/app-builder-lib/out/electron/ElectronFramework.js` 与 `electron/electronVersion.js`，实测版本 electron-builder 26.16.1）。所以 `release.yml` 的 `npm ci --ignore-scripts` + 缓存 electron zip 的现有接线**无需改动**。
6. **开发链路也不受影响。** `scripts/start-electron-dev.mjs:3` `import electron from 'electron'` 触发的是 `node_modules/electron/index.js`，42+ 的 `index.js` 在缺 `path.txt` 时会 `spawnSync(install.js)` 现场下载（来源：`electron@42.11.18` 的 `index.js` 实测内容）。**即「按需下载」恰好接住了本仓的 `import electron` 写法。**
7. **42/43/44/45 的 breaking changes 逐条对照本仓，只有两条值得在验收里点名**：(a) 43.0 的「Dialog `defaultPath` 默认变成 Downloads」—— 本仓两个 `showOpenDialog` 之一没传 `defaultPath`；(b) 42.0 的 postinstall 移除（见结论 4）。其余（44.0 的 macOS 12 移除、32-bit 移除、渲染进程 clipboard 移除、`net.request` Sec-Fetch 校验、`select-client-certificate` 的 `webContents` 可能为 null；45.0 的沙箱 preload 移除 Node shim）**均不命中本仓**，判定证据见 §3。
8. **45.0.0 太新，不建议作为本次落点。** 它发布于 **2026-10-21**（距复核日 5 天），而本仓 `.github/dependabot.yml` 自己给 major 定的冷却期是 `semver-major-days: 30`。用同一个尺子量：现在跳 45 就是绕开本仓自己的冷却纪律。

## 1. 支持窗口：42 已经出局

| major | 发布日期 | EOL | Chromium | Node |
|---|---|---|---|---|
| 45 | 2026-10-20 | **2027-04-27** | M156 | 24 |
| 44 | 2026-08-24 | **2027-03-02** | M152 | 24 |
| 43 | 2026-06-29 | **2027-01-05** | M150 | 24 |
| 42 | 2026-05-05 | **2026-10-20（已过期）** | M148 | 24 |
| 41（当前） | 2026-03-10 | 2026-08-24（已过期） | M146 | 24 |

来源：`https://endoflife.date/api/electron.json`（截至 2026-10-26 实测）。官方策略原文：`The latest three stable major versions are supported by the Electron team.`（`https://www.electronjs.org/docs/latest/tutorial/electron-timelines`）。

**推论：本仓现在跑在 41.10.7 上，已经出了官方支持窗口两个 major。** 42 也已经过期 —— 「修 audit 顺手落 42」会立刻得到一个刚过期的运行时，等于下一次 audit 周期还得再跳一次。

## 2. 候选落点的实测漏洞面

方法（可复跑）：临时目录里只写一个含 `electron@<ver>` 的 `package.json`，跑
`npm install --package-lock-only --ignore-scripts --no-audit`，再 `npm audit --json` 数 `vulnerabilities` 条数。

| 候选 | `npm audit` 条数 | 支持到 |
|---|---|---|
| 41.10.7（当前） | 1（electron，high） | 已过期 |
| 42.11.18 | **0** | 2026-10-20（已过期） |
| 43.8.3 | **0** | 2027-01-05 |
| 44.9.3 | **0** | 2027-03-02 |
| 45.0.0 | **0** | 2027-04-27 |

截至 2026-10-26 实测。**四个候选都能清掉这条 high**；差别只在支持窗口长度与跳几个 major。

**边界复核**（同法，逐版本实测，截至 2026-10-26）：

| 版本 | `npm audit` 条数 |
|---|---|
| 42.11.15 | 1（electron） |
| **42.11.16** | **0** |
| 42.11.18 | 0 |

这与 `npm audit` 报出的 `range: "<=42.11.15"` **逐位吻合** —— 42.11.16 就是那条 high（`GHSA-jr5w-w6x2-84p9`，range `<42.11.16`）的修复线。#658 正文写的「至少 `>= 42.11.16`」在**版本号层面是对的**，错的只是「42 这个 major 还能用」。

## 3. breaking changes 逐条对照本仓

来源统一为 `https://www.electronjs.org/docs/latest/breaking-changes`（截至 2026-10-26 抓取）。

### 3.1 42.0 —— **命中**：postinstall 移除

官方原文（42.0 节）：`Behavior Changed: electron no longer downloads itself via postinstall script` / `Electron will now download itself dynamically the first time that its main bin script is run` / `This also means the ELECTRON_SKIP_BINARY_DOWNLOAD environment variable is no longer supported`。

实测佐证（截至 2026-10-26）：

- `npm view electron@41.10.7 scripts bin --json` → `{"scripts":{"postinstall":"node install.js"},"bin":{"electron":"cli.js"}}`
- `npm view electron@44.9.3 scripts bin --json` → `{"electron":"cli.js","install-electron":"install.js"}`（**无 `scripts` 字段**）
- 装 `electron@42.11.18` + `--ignore-scripts` 后 `npm rebuild electron` → 输出 "rebuilt dependencies successfully"，但 `path.txt` / `dist/` 均不存在

**本仓受影响处（升级时必须一并改，否则是错文档）**：

| 位置 | 现文案 | 42+ 上的真实情况 |
|---|---|---|
| `docs/agents/testing.md:35` | 「补一条 `npm rebuild electron`」 | 空转，不下载任何东西 |
| `scripts/verify.mjs:205` | 「再补 npm rebuild electron（--ignore-scripts 会跳过它的 postinstall…）」 | 同上，且「跳过 postinstall」这个因果在 42+ 已不成立 |

**正确的替代写法**（两条都实测/源码可证）：

- `npx install-electron` —— 42+ 的 `bin` 里新增了 `install-electron → install.js`，就是原 postinstall 的同款代码；
- 或者什么都不做：直接跑 `npx electron --version` / 本仓的 `npm run electron:dev`，`index.js` 会在缺 `path.txt` 时 `spawnSync(install.js)` 现场补齐。

**不受影响处（已核实，勿误改）**：

- `electron-builder` 走 `computeElectronVersion()`（读 `node_modules/electron/package.json` 的 `version`）+ `downloadElectronArtifactZip()` 自取 zip（`app-builder-lib/out/electron/ElectronFramework.js`、`electronVersion.js`），**不依赖 electron 包的 postinstall 产物**；
- `.github/workflows/release.yml:119-132` 缓存的是 electron zip 缓存目录 + `npm ci --ignore-scripts`，接线不变；
- `scripts/start-electron-dev.mjs:3,32` 的 `import electron` → `spawn(electron, …)` 恰好走「按需下载」路径。

### 3.2 43.0 —— **命中（体验层）**：Dialog `defaultPath` 默认变成 Downloads

官方原文（43.0 节）：`Behavior Changed: Dialog methods default to Downloads directory` —— `The defaultPath option … now defaults to the user's Downloads folder`，且 `the OS will no longer track and restore the last-used directory between dialog invocations`。

本仓两个调用点：

- `src/main/ipc/appSettingsUpdate.ts:36` `dialog.showOpenDialog({ properties: ['openDirectory','createDirectory'] })` —— **未传 `defaultPath`**，43+ 后每次打开都落在 Downloads，且不再记忆上次目录；
- `src/main/services/playbackTraceService.ts:56` `dialog.showSaveDialog({ defaultPath: exportFileName(now), … })` —— 已显式传，**不受影响**。

结论：43 起「选目录」这个入口的默认落点会变。是否算缺陷取决于产品意图；至少要在验收里点名确认，而不是当回归。

### 3.3 44.0 —— **不命中**（逐条）

| 44.0 条目 | 本仓判定 | 证据 |
|---|---|---|
| 移除 macOS 12 支持 | 不命中 | `electron-builder.yml` 只出 dmg（x64/arm64），无最低系统版本声明；CI 用 `macos-latest` |
| 移除 Windows 32-bit / Linux armv7l | 不命中 | `electron-builder.yml` win/linux target 均只 `arch: [x64]` |
| 渲染进程移除 `clipboard` 模块 | 不命中 | `src/` 下无 `clipboard` 引用（渲染层只有测试 setup 的 stub）；主进程 import 面里也没有 `clipboard` |
| `net.request` 校验 `Sec-Fetch-Dest` | 不命中 | 全仓无 `net.request` / `net.fetch` / `session.fetch` 调用 |
| `select-client-certificate` 的 `webContents` 可能为 null | 不命中 | 全仓未监听该事件 |
| ANGLE 静态链接 / Unity 移除 / `setBadgeCount` 等 | 不命中 | 全仓无相关调用 |

主进程 import 面实测（`grep` 全部 `src/`）：`app / BrowserWindow / contextBridge / dialog / globalShortcut / ipcMain / ipcRenderer / Menu / nativeImage / session / shell / Tray`。

### 3.4 45.0 —— **不命中**

| 45.0 条目 | 本仓判定 | 证据 |
|---|---|---|
| 沙箱 preload 移除 Node shim / `Buffer` / `setImmediate` | 不命中 | 官方原文明确 `Preload scripts for renderers with sandbox: false are unaffected`；本仓 `src/main/main.ts:149` 是 `sandbox: false` |
| 沙箱 preload 的 EventEmitter 换成原生实现 | 不命中 | 同上，本仓 preload 非沙箱 |
| `getUserMedia` `chromeMediaSource: 'desktop'` 拒收 WebContents id | 不命中 | 全仓无 `getUserMedia` / `desktopCapturer` |
| `contentTracing.enableHeapProfiling()` 移除 / Perfetto 格式 | 不命中 | 全仓无 `contentTracing` |
| 子帧 worker 的 Node 集成、DevTools 扩展帧的 preload | 不命中 | 未用 `nodeIntegrationInWorker` / 扩展 |

**注意**：45.0 的这几条里，前三条被官方注明「also backported to Electron 44.3.0, 43.7.0 and 42.11.3」——所以只要落到 ≥42.11.3，这些行为就已经在生效；本仓均不命中，不影响落点选择。

## 4. electron-updater / electron-builder 的兼容性

- `electron-builder@26.16.1`：**未找到官方明文的 Electron 44/45 支持矩阵**。可证的部分只有源码行为：版本从 `node_modules/electron/package.json` 读、zip 自行下载，与 Electron 大版本无关。
- `electron-updater@^6.8.9`：**未找到官方明文说明其与 Electron 44/45 的兼容要求**。
- 结论：这两条**属于「未验证」，不是「已确认兼容」**。它们只能靠打包产物冒烟来证，不能靠文档推断。

## 5. 落点建议（供维护者拍板，非结论）

| 落点 | 支持到 | 跳几个 major | 风险面 |
|---|---|---|---|
| 43.8.3 | 2027-01-05 | 2 | 窗口只剩 ~2.5 个月，下次 audit 周期还得再跳 |
| **44.9.3** | **2027-03-02** | **3** | 窗口 ~4 个月；44 的 breaking changes 本仓全部不命中 |
| 45.0.0 | 2027-04-27 | 4 | 发布仅 5 天，违背本仓 `semver-major-days: 30` 的自我纪律 |

**倾向 44.9.3**：窗口足够覆盖到下一次审计，且 44.0 的 breaking changes 经逐条对照全部不命中；45 的唯一优势是窗口更长，代价是踩一个刚发布 5 天的新 major。**这是产品/维护判断，不是技术必然** —— 如果维护者更在意「一次跳到位、少跳一轮」，45 也成立，但需要额外的冷却期观察。

## 6. 与既有记录的差异（本票为什么要新写一份）

- ADR `2026-09-29-dependency-update-governance.md` 的「残余 9 条」第 1 条已经回答了**「为什么不在 #656 顺手做」**（major 跳级、打包运行时、需完整 `release.yml` 链路、风险不对称）—— 那部分**仍然成立，本次直接复用，不重复论证**。
- 但它**没有回答**：42 已 EOL 怎么办、落到哪个 major、42+ 移除 postinstall 会打破本仓哪条文档、43/44/45 的 breaking changes 哪些真命中。**这四件事是本次新查的全部理由。**

## 7. 未验证 / 待真机证的（不许当结论传播）

- `electron-updater` 在 44/45 下的检查更新、下载、`quitAndInstall` 行为 —— 无官方明文，只能靠打包产物冒烟。
- `electron-builder@26.16.1` 打 44/45 安装包的产物完整性 —— 无官方明文。
- Windows 代码签名 / macOS 公证在 44/45 下的行为 —— 无官方明文。
- 44 起 ANGLE 静态链接对 GPU 渲染路径的实际影响 —— 本仓未替换 ANGLE，理论上不命中，但**未实测**。
