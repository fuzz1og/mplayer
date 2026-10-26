# Electron 41 → 42+ 大版本升级的落点与破面（一手来源）

> 调研日期：2026-10-26 · 类型：调研 · 关联：[fuzz1og/mplayer#658](https://github.com/fuzz1og/mplayer/issues/658)（[Chore]: Electron 41 → 42 major 升级评估）
> 依据：**仅一手来源** —— Electron 官方文档与发版数据（`electronjs.org/docs/latest`、`www.electronjs.org/blog`、`releases.electronjs.org`、`api.github.com` 的 release 资产清单）、npm registry（`npm view` / `npm pack` 读包内 `package.json` 与 `index.js`）、`endoflife.date` API、`github.com/advisories`、electron-builder 官方 changelog 与 `app-builder-lib` 源码，以及本仓源码与 `npm audit` 实测。**每条断言带复核时刻（截至 2026-10-26，Asia/Hong_Kong）**；官方沉默处在 §8 明确标注，不编造。

## 0. 结论先行

1. **官方支持策略是「最新 3 个 stable major」**：`The latest three stable major versions are supported by the Electron team.`（[electron-timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)）。**截至 2026-10-26 在支持的是 45 / 44 / 43**，42 已出窗口。
2. **EOL 复核结果与 `endoflife.date` API 一致**（[api/electron.json](https://endoflife.date/api/electron.json)，截至 2026-10-26 抓取）：42 → **2026-10-20**、43 → **2027-01-05**、44 → **2027-03-02**、45 → **2027-04-27**。官方侧证：Electron 45 的发布博客明写 `End of Support for 42.x.y`（[electron-45-0](https://www.electronjs.org/blog/electron-45-0)）。**42 在 2026-10-20 随 45 发布而 EOL，早于本票创建日 2026-10-26 —— #658 正文里「在 `^42` 内挑 `>= 42.11.16`」的目标已经过期。**
3. **8 条 advisory 里唯一 high 是 `GHSA-jr5w-w6x2-84p9`（eMudhra 中间证书缓解）**，本仓 `npm audit --json` 实测其 `range: "<42.11.16"`，其余 7 条是 low/moderate（上界 `<42.11.1 / <42.11.3 / <42.11.6 / <42.11.9`）。聚合后 `vulnerabilities.electron.range = "<=42.11.15"`，`fixAvailable = electron@45.0.0 (isSemVerMajor: true)`（本仓实测，截至 2026-10-26）。
4. **实测边界：42.11.15 仍有 1 条、42.11.16 起为 0 条；42.11.18 / 43.8.3 / 44.9.3 / 45.0.0 全部 0 条。** 方法：`.tmp-*` 临时目录里只写含 `electron@<ver>` 的 `package.json`，`npm install --package-lock-only --ignore-scripts` 后 `npm audit --json`（截至 2026-10-26 实测，临时目录已删）。**即：这条 high 与「跳到哪个 major」无关，只要 ≥ 42.11.16 就清零；落点选择只看支持窗口与破面。**
5. **42.0 的 postinstall 移除是本次唯一「确定会打破本仓既有文档」的改动**。`electron@41.10.7` 的包内 `scripts.postinstall = "node install.js"`；`electron@42.11.18 / 43.8.3 / 44.9.3 / 45.0.0` **均无 `scripts` 字段**，改为 `bin: { electron: cli.js, install-electron: install.js }`（`npm view electron@<v> scripts bin --json` + `npm pack` 解包核对，截至 2026-10-26）。因此 `docs/agents/testing.md:35` 与 `scripts/verify.mjs:205` 的处置「补一条 `npm rebuild electron`」**在 42+ 上静默空转**：实测 41.10.7 重建后出现 `dist/` 与 `path.txt`，42.11.18 / 44.9.3 重建后两者**都不存在**，但命令照样输出 `rebuilt dependencies successfully`。
6. **替代写法有官方明文**：`npx install-electron`（42.0 起新增的 bin，源码即原 postinstall 的同款 `install.js`）；或者干脆不预装——`index.js` 在缺 `path.txt`/`dist` 时会 `spawnSync(install.js)` **首次运行时现场下载**。本仓 `scripts/start-electron-dev.mjs:3,32` 的 `import electron from 'electron'` → `spawn(electron, …)` 恰好走这条按需路径，**开发链路不用改**。**注意：官方文档里的 `npx install-electron --no` 那个 `--no` 是文档遗留——`install.js` 里 `process.argv` 出现 0 次，不解析任何参数。**
7. **打包链路不受 postinstall 移除影响**：`electron-builder` 从 `node_modules/electron/package.json` 读版本号，再自己下载对应 zip 解包（`app-builder-lib/out/electron/electronVersion.js`、`ElectronFramework.js:220-232` 的 `downloadElectronArtifactZip`），不消费 electron 包的 postinstall 产物。`release.yml:119-132` 的 `npm ci --ignore-scripts` + electron zip 缓存接线**无需改动**。
8. **43.0 的「Dialog 默认落到 Downloads」命中本仓 3 处调用**：`appSettingsUpdate.ts:36`（选目录）、`appSettingsUpdate.ts:39`（选 tier3 清单文件）都没传 `defaultPath`；`playbackTraceService.ts:56-59` 传的是**裸文件名**（`defaultPath: exportFileName(now)`），按官方文档「file name to use by default」的语义，目录部分同样回落 Downloads，只有文件名被预填。**且 OS 不再记忆上次目录。**
9. **44.0 的条目里除「macOS 12 移除」外均不命中，而那条命中也不是阻塞项**：`electron-builder.yml` 的 win/linux 只有 `x64`、mac 只有 `x64+arm64`（无 ia32 / armv7l）；`src/` 无 `clipboard`、无 `net.request`/`net.fetch`、无 `select-client-certificate` 监听。**命中的是「macOS 12 支持移除」**：本仓没有 `mac.minimumSystemVersion`，`macPackager` 只在显式配置时才写 `LSMinimumSystemVersion`（`app-builder-lib/out/macPackager.js:421-424`），所以 dmg 不声明系统地板，而 44 起运行时要求 macOS 13+ —— 这是**支持面收窄 + 无安装期拦截**，需要在 README/发行说明里写明。
10. **45.0 的「沙箱 preload 移除 Node shim / Buffer / setImmediate」对本仓不适用**，依据是官方原文 `Preload scripts for renderers with sandbox: false are unaffected and continue to have the full Node.js environment.`，而本仓 `src/main/main.ts:149` 是 `sandbox: false`；preload 只用 `contextBridge` + `ipcRenderer`（`src/main/preload.ts:1,31`）。
11. **但 45.0 有一条本仓会被打到的打包面问题（本票新增发现）**：45 起 Windows 发行包里多了 `electron_wer.dll`，官方要求 `If you rename electron.exe to myapp.exe, also rename electron_wer.dll to myapp_wer.dll`（[electron-45-0](https://www.electronjs.org/blog/electron-45-0)），而 `electron-builder` 确实会把 `electron.exe` 改名成 `MPlayer.exe`（`ElectronFramework.js:50`）。该改名逻辑**只在 app-builder-lib ≥ 26.18.1 存在**（26.18.0 与 26.17.0 的包里 `electron_wer` 出现 0 次，26.18.1 出现且有 `FIRST_ELECTRON_MAJOR_WITH_WER_HELPER = 45`；本机解包实测，截至 2026-10-26）。**本仓 lock 是 26.17.0 —— 若直接落 45，Windows 端 `__fastfail` 类崩溃的捕获会静默失效（仅在本仓将来调用 `crashReporter.start()` 时才有实际影响；当前 `src/` 无 `crashReporter` 调用）。**
12. **`electron-updater@^6.8.9` / `electron-builder@^26.16.1` 对 Electron 44/45 没有官方明文支持矩阵** —— `electron.build` 的 v26 文档（Overview / Auto Update / Troubleshooting）逐页查过，只有「metadata 格式兼容」与「electron 必须在 devDependencies」这类说明，没有 Electron 版本下限/上限。**能拿到的是一手 changelog/源码级证据**：`electron-builder` 27.0.0-alpha.6 为「Electron 44 移除 Windows ia32」改过 `arch: "all"` 的展开（[CHANGELOG](https://github.com/electron-userland/electron-builder/blob/master/CHANGELOG.md)），27.0.0-alpha.12 为 Electron 45 加了 wer.dll 改名并**回灌到 26.18.1**。**即：落 45 + Windows ⇒ electron-builder 必须 ≥ 26.18.1，这一条是有源码依据的硬约束；其余（更新器在 44/45 下的实际行为）属未验证。**
13. **落点倾向 44.9.3**：支持到 2027-03-02（比 43 多约 2 个月、比 45 少约 2 个月），发布已 63 天、22 个 patch，`npm audit` 0 条，44.0 的破面本仓全部不阻塞。**45 的唯一硬优势是窗口更长（2027-04-27），代价是它 2026-10-21 才发布（距今 5 天），低于本仓 `.github/dependabot.yml:14` 自己给 major 定的 `semver-major-days: 30` 冷却期，且必须连带升 electron-builder。**

---

## 1. 官方支持策略与 EOL（截至 2026-10-26）

### 1.1 政策原文

> `The latest three stable major versions are supported by the Electron team.`
> `We only support the latest minor release for each stable release series.`
> `Electron's cadence between major version releases is 8 weeks long.`

出处：[Electron Releases / Version support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)（截至 2026-10-26 抓取）。同页把权威时间表指向 [releases.electronjs.org/schedule](https://releases.electronjs.org/schedule)。

### 1.2 EOL 与发布日（三方交叉核对）

| major | stable 发布 | EOL | Chromium | Node | 现状 |
|---|---|---|---|---|---|
| 45 | 2026-10-20 / 21（见 §1.3 口径差异） | **2027-04-27** | M156 | 24 | 在支持（最新） |
| 44 | 2026-08-24 | **2027-03-02** | M152 | 24 | 在支持 |
| 43 | 2026-06-29 / 30 | **2027-01-05** | M150 | 24 | 在支持（最老） |
| 42 | 2026-05-05 | **2026-10-20（已过期）** | M148 | 24 | 已 EOL |
| 41（本仓当前） | 2026-03-10 | 2026-08-24（已过期） | M146 | 24 | 已 EOL |

来源 1（机器可读）：`GET https://endoflife.date/api/electron.json`（截至 2026-10-26 抓取），逐字给出 `{"cycle":"42",…"eol":"2026-10-20"}`、`{"cycle":"43",…"eol":"2027-01-05"}`、`{"cycle":"44",…"eol":"2027-03-02"}`、`{"cycle":"45",…"eol":"2027-04-27"}`，以及各 cycle 的 `latest`（45.0.0 / 44.9.3 / 43.8.3 / 42.11.18 / 41.10.7）。
来源 2（官方时间表）：`https://releases.electronjs.org/schedule` 内嵌数据里 42/43/44/45 的 EOL 字段分别是 `2026-10-20`、`2027-01-05`、`2027-03-02`、`2027-04-27`（截至 2026-10-26 抓取，与来源 1 逐字一致）。
来源 3（官方声明）：Electron 45 博客 `End of Support for 42.x.y` 段 —— `Electron 42.x.y has reached end-of-support as per the project's support policy.`（[electron-45-0](https://www.electronjs.org/blog/electron-45-0)，2026-10-21）。

### 1.3 口径差异（引用时别混）

- **45 的 stable 日期**：`endoflife.date` 与 `releases.electronjs.org/schedule` 写 `2026-10-20`，而 `releases.electronjs.org/releases.json` 里 `45.0.0` 的 `date` 是 `2026-10-21`，博客发布日期也是 2026-10-21。**差一天是「计划日 vs 实际发布时刻」**，两者都能引，但要标清是哪一个。
- **43 同理**：schedule 写 2026-06-29，releases.json 写 `43.0.0 → 2026-06-30`。
- **`releases.json` 的 `files` 字段不可作为「有没有 32 位包」的证据**：`44.9.3` 与 `45.0.0` 的 `files` 里仍列着 `win32-ia32` / `linux-ia32`，但 GitHub Release 的真实资产清单里已经没有它们（见 §4.2）。**判 32 位要看 `api.github.com/repos/electron/electron/releases/tags/v<ver>` 的 `assets[].name`。**

---

## 2. 42.0：postinstall 移除 —— **命中**

### 2.1 官方原文

> `Behavior Changed: electron no longer downloads itself via postinstall script`
> `Electron will now download itself dynamically the first time that its main bin script is run (e.g. via npx electron). With this change, you can now use Electron with the npm --ignore-scripts flag.`
> `If you need to download the Electron binary on-demand, you can now call the install-electron script, which contains the exact same code from the former postinstall script.`
> `This also means the ELECTRON_SKIP_BINARY_DOWNLOAD environment variable is no longer supported`

出处：[Breaking Changes §42.0](https://www.electronjs.org/docs/latest/breaking-changes#behavior-changed-electron-no-longer-downloads-itself-via-postinstall-script)（截至 2026-10-26 抓取）；发布博客同款措辞见 [electron-42-0](https://www.electronjs.org/blog/electron-42-0)（`#49328`）。

### 2.2 包层面实测（截至 2026-10-26）

```
npm view electron@41.10.7 scripts bin --json
→ {"scripts":{"postinstall":"node install.js"},"bin":{"electron":"cli.js"}}

npm view electron@42.11.18 scripts bin --json
→ {"electron":"cli.js","install-electron":"install.js"}      # 无 scripts 字段

npm view electron@44.9.3 scripts bin --json
→ {"electron":"cli.js","install-electron":"install.js"}      # 无 scripts 字段

npm view electron@45.0.0 scripts bin --json
→ {"electron":"cli.js","install-electron":"install.js"}      # 无 scripts 字段
```

`electron@44.9.3` 的完整 `package.json`（`npm pack` 解包读取）：`main: index.js`、`engines.node: ">= 22.12.0"`、`dependencies: { "@electron-internal/extract-zip": "^1.0.1", "@electron/get": "^5.0.0", "@types/node": "^24.9.0" }`、`files` 里含 `cli.js` / `index.js` / `install.js` / `checksums.json`。**没有 `scripts` 键** —— 与 42.0 的说明逐字吻合。

### 2.3 「`npm rebuild electron` 还能用吗」—— 本仓实测：**在 42+ 上静默空转**

```
41.10.7  + npm install --ignore-scripts + npm rebuild electron
  → exit 0，"rebuilt dependencies successfully"，dist/ 与 path.txt 出现   ✅

42.11.18 + npm install --ignore-scripts + npm rebuild electron
  → exit 0，"rebuilt dependencies successfully"，dist/ 与 path.txt 都不存在  ❌

44.9.3  + npm install --ignore-scripts + npm rebuild electron
  → exit 0，"rebuilt dependencies successfully"，dist/ 与 path.txt 都不存在  ❌
```

截至 2026-10-26 在本机 `.tmp-*` 临时目录实测（已删）。**根因**：`npm rebuild` 重跑的是包的 `scripts`；42+ 没有 `postinstall` 可跑，命令因此「成功但什么也没做」。

### 2.4 本仓受影响处（升级时必须一并改，否则是错文档）

| 位置 | 现文案 | 42+ 上的真实情况 |
|---|---|---|
| `docs/agents/testing.md:35` | 「`npm ci --ignore-scripts` 跳过了 `electron` 的 postinstall …… 补一条 `npm rebuild electron`」 | 空转；「跳过 postinstall」这个因果在 42+ 已不成立（没有 postinstall 可跳） |
| `scripts/verify.mjs:205` | 「再补 `npm rebuild electron`（`--ignore-scripts` 会跳过它的 postinstall…）」 | 同上，提示文案会把下一个人引向一条无效命令 |

### 2.5 正确替代写法（两条，都有官方或源码依据）

1. **`npx install-electron`** —— 42+ 的 `bin` 新增项，`install.js` 就是原 postinstall 的同款代码（官方原文 + §2.2 的 `bin` 字段双证）。
   ⚠️ **官方文档示例写的是 `npx install-electron --no`，那个 `--no` 是遗留**：`electron@44.9.3` 的 `install.js` 里 `process.argv` 出现 **0 次**（`grep -c 'process.argv'` = 0，截至 2026-10-26 解包实测），脚本不解析任何参数，只读 `ELECTRON_INSTALL_PLATFORM` / `ELECTRON_INSTALL_ARCH` / `force_no_cache` / `electron_config_cache` 等环境变量。**写进本仓文档时用不带 `--no` 的 `npx install-electron`。**
2. **什么都不做** —— 直接 `npm run electron:dev`。`electron@44.9.3` 的 `index.js` 在 `path.txt` 缺失或 `dist/` 不存在时调用 `downloadElectron()` → `spawnSync(process.execPath, [install.js])`，失败时报错原文为 **Please delete `node_modules/electron` and run "npx install-electron --no" manually.**（源码实测，截至 2026-10-26；注意这句官方错误信息自己也带着那个多余的 `--no`）。

> **未完成的一步（诚实标注）**：本机尝试真正跑通 `npx install-electron` 的端到端下载时，`@electron/get` 报 `TypeError: fetch failed`；同环境用 `curl` 拉 `electron-v42.11.18-win32-x64.zip` 也在 90s 内只拿到 3.6 MB / 149 MB 后超时。**所以「`npx install-electron` 能成功下载」这一步在本会话只验到「命令存在、源码语义正确、失败信息正确」，未验到「完整下载 149 MB 成功」。** 这条要在真机验收里补。

### 2.6 不受影响处（已核实，勿误改）

- **`electron-builder` 不依赖 electron 包的 postinstall 产物**：`createElectronFrameworkSupport()` 用 `computeElectronVersion()` 读 `node_modules/electron/package.json` 的 `version`（`app-builder-lib/out/electron/electronVersion.js`），再走 `downloadElectronArtifactZip()` 自己下 zip（`ElectronFramework.js:220-232`）。本机 `electron-builder` 实装 26.17.0、lock 同版本（截至 2026-10-26）。
- **`.github/workflows/release.yml:119-132`**：缓存 `%LOCALAPPDATA%\electron\Cache`（workflow 里写作 `~\AppData\Local\electron\Cache`）/ `~/.cache/electron` + `npm ci --ignore-scripts`，缓存路径与 `@electron/get` 的 `envPaths('electron').cache` 默认值同源（`@electron/get/dist/Cache.js:8-11`），**接线不变**。注释里「`npm ci --ignore-scripts` 跳过 electron postinstall」这句理由在 42+ 会变成废话，但**行为仍正确**（zip 缓存照样命中），属可改可不改的注释债。
- **`scripts/start-electron-dev.mjs:3,32`**：`import electron from 'electron'` 触发 `node_modules/electron/index.js`，42+ 的 `index.js` 会按需下载 → `spawn(electron, ['.', ...extraArgs])` 拿到的仍是可执行文件路径。**写法天然兼容，不用改。**

---

## 3. 43.0：Dialog 默认落到 Downloads —— **命中（体验层，3 处）**

### 3.1 官方原文

> `Behavior Changed: Dialog methods default to Downloads directory`
> `The defaultPath option for the following methods now defaults to the user's Downloads folder (or their home directory if Downloads doesn't exist) when not explicitly provided: dialog.showOpenDialog / showOpenDialogSync / showSaveDialog / showSaveDialogSync`
> `Now, Electron explicitly sets the initial directory to Downloads, which also means the OS will no longer track and restore the last-used directory between dialog invocations.`

出处：[Breaking Changes §43.0](https://www.electronjs.org/docs/latest/breaking-changes#behavior-changed-dialog-methods-default-to-downloads-directory)（截至 2026-10-26 抓取）。API 文档同款措辞：`If not provided, the dialog will default to the user's Downloads folder, or their home directory if Downloads doesn't exist.`（[dialog.md](https://github.com/electron/electron/blob/main/docs/api/dialog.md)，raw 抓取于 2026-10-26）。

### 3.2 本仓三个调用点逐条判定

| 位置 | 现状 | 43+ 后的行为 |
|---|---|---|
| `src/main/ipc/appSettingsUpdate.ts:36` | `dialog.showOpenDialog({ properties: ['openDirectory','createDirectory'] })` —— **未传 `defaultPath`** | 每次打开都落在 Downloads（无 Downloads 则 home）；**且不再记忆上次目录** |
| `src/main/ipc/appSettingsUpdate.ts:39` | `dialog.showOpenDialog({ properties: ['openFile'], filters: [...] })` —— **未传 `defaultPath`** | 同上（选 tier3 JSON 清单） |
| `src/main/services/playbackTraceService.ts:56-59` | `dialog.showSaveDialog({ title, defaultPath: exportFileName(now), filters })` | 传的是**裸文件名**（`mplayer-playback-trace-<stamp>.json`）。按 API 文档「absolute file path, or file name to use by default」语义，文件名被预填、**目录部分同样回落 Downloads** |

调用链（用于评估影响面）：
- `dialog:openDirectory` ← `src/renderer/components/DownloadSection.tsx:24`、`src/renderer/store/localStore.ts:77`
- `dialog:openTier3File` ← `src/renderer/components/Tier3Section.tsx:83`

### 3.3 对本仓 UX 的具体影响

1. **「选择下载目录」的默认落点变成 Downloads** —— 而本仓的下载目录默认值本来就是 `app.getPath('downloads')`（`src/main/ipc/appSettingsUpdate.ts:83-86`）。**两者恰好重合，所以首次使用的默认体验没变坏**，变坏的是「用户已经把下载目录改到 D 盘、再点一次选择目录」这个场景：对话框仍从 Downloads 起步，用户要自己再导航。
2. **「选 tier3 清单文件」同理**，且这个入口更痛——音源清单通常和用户自己的音乐库/配置放一起，不是 Downloads。
3. **「导出播放诊断」的文件名仍预填正确**，只是目录从「上次用的目录」变成 Downloads。
4. **「不再记忆上次目录」是跨所有对话框的**：43+ 之前，Windows/macOS 的 OS 原生对话框会自己恢复上次目录；43+ 之后由 Electron 显式设定 Downloads，这个 OS 行为被绕过。**这是用户可感知的退化，不是本仓的 bug。**

### 3.4 判定

**命中，但不是「坏掉」**：属产品意图问题。可选的三种处置（供维护者拍板，本调研不替产品决定）：
- (a) 接受新默认，验收里点名「对话框从 Downloads 起步」；
- (b) 自己记 last-used dir 并显式传 `defaultPath`（官方给了同款示例代码，见 §3.1 页面内 `lastUsedPath` 片段）；
- (c) 只给「选下载目录」这个入口传当前下载目录作为 `defaultPath`，另外两处接受默认。

---

## 4. 44.0：逐条对照本仓

来源统一为 [Breaking Changes §44.0](https://www.electronjs.org/docs/latest/breaking-changes#breaking-api-changes-440) 与发布博客 [electron-44-0](https://www.electronjs.org/blog/electron-44-0)（截至 2026-10-26 抓取）。

| 44.0 条目 | 判定 | 本仓证据 |
|---|---|---|
| **移除 macOS 12 支持** | **命中（非阻塞，但需声明）** | 见 §4.1 |
| 移除 Windows 32-bit (ia32) / Linux armv7l | **不命中** | `electron-builder.yml:36-42`（win 只有 nsis/portable + `x64`）、`electron-builder.yml:72-79`（linux 只有 AppImage/deb + `x64`）、`:65-69`（mac dmg `x64`+`arm64`）。无 ia32 / armv7l 目标 |
| 渲染进程移除 `clipboard` 模块 | **不命中** | `grep -r clipboard src/` 只命中 3 个测试 setup 的 electron mock（`src/renderer/__tests__/setup.ts:35,93`、`src/__tests__/main/setup.ts:99`、`src/__tests__/main/downloadService.test.ts:78`）。主进程 import 面里没有 `clipboard` |
| `clipboard` 模块重构为 W3C 语义（Promise 化） | **不命中** | 同上，全仓无 `clipboard.*` 实调用 |
| `net.request` 校验 `Sec-Fetch-Dest` | **不命中** | `grep 'net\.request\|net\.fetch'` 在 `src/` 无命中。**但见 §4.3 的两条近邻风险** |
| `select-client-certificate` 的 `webContents` 可能为 null | **不命中** | `grep 'select-client-certificate'` 全仓 0 命中 |
| ANGLE 静态链接 | **不命中** | 本仓不替换/管理 ANGLE 库，无 `libEGL`/`libGLESv2` 引用 |
| 移除 Unity 支持 / `app.isUnityRunning()` | **不命中** | 全仓无 `isUnityRunning` / `setBadgeCount` / `setProgressBar` |
| 移除 Pre-macOS 13 login item 属性 | **不命中** | 全仓无 `setLoginItemSettings` / `getLoginItemSettings` |

### 4.1 macOS 12 移除：命中的是「支持面」，不是「代码」

官方原文：`macOS 12 (Monterey) is no longer supported by Chromium. … macOS 13 (Ventura) or later will be required to run Electron v44.0.0 and higher.`（同 §4 来源，`#51967`）。

本仓现状：
- `electron-builder.yml:59-69` 的 `mac` 段**没有 `minimumSystemVersion`**（`grep -n minimumSystemVersion electron-builder.yml` 0 命中）；
- `app-builder-lib/out/macPackager.js:421-424` 只在 `platformSpecificBuildOptions.minimumSystemVersion != null` 时才写 `LSMinimumSystemVersion` —— **不配就不写**，dmg 的 `Info.plist` 不会声明系统地板；
- `README.md:53` 的下载表只写「Intel / Apple Silicon」，**没有 macOS 版本地板**。

**结论**：升级到 44+ 后，macOS 12 用户会**装得上、但启动即崩/闪退**（Chromium 不再支持该平台），且安装包不拦、README 不提示。**这不是代码破面，是支持面与文档破面** —— 处置是在 `README.md` 的下载表 + 发行说明里写明「macOS 13+」，是否同时配 `mac.minimumSystemVersion: "13.0"` 由维护者定（配了会让旧系统用户在安装期看到更明确的拒绝）。

### 4.2 32 位移除：本仓不命中，且核实了「确实移除了」

GitHub Release 真实资产（`api.github.com/repos/electron/electron/releases/tags/v<ver>` 的 `assets[].name`，截至 2026-10-26 抓取，只看 `electron-v*` 且排除 symbols/debug）：

- `v42.11.18`：含 `win32-ia32.zip`、`linux-armv7l.zip`
- `v43.8.3`：含 `win32-ia32.zip`、`linux-armv7l.zip`
- `v44.9.3`：**只有** `darwin-arm64/x64`、`linux-arm64/x64`、`mas-arm64/x64`、`win32-arm64/x64`（+ pdb/toolchain-profile）—— **无 ia32、无 armv7l**
- `v45.0.0`：同 44.9.3

与官方原文一致：`Electron 44 and higher are published only for 64-bit x64 and arm64 platforms.`（[electron-44-0](https://www.electronjs.org/blog/electron-44-0)，`#52326`）。
⚠️ **反面教材**：`releases.electronjs.org/releases.json` 里 `44.9.3` 的 `files` 字段仍列 `win32-ia32` / `linux-ia32`，与真实资产不符。**判定 32 位是否还存在，必须看 GitHub Release 资产，不能看 `releases.json` 的 `files`。**

### 4.3 `net.request` Sec-Fetch 校验：本仓不命中，但有三个近邻点要写清

官方原文：`net.request now rejects requests where Sec-Fetch-Dest is document, frame, iframe, or fencedframe unless Sec-Fetch-Mode is also set to navigate.`（`#52216`）。

本仓直接调用：**0 处**。但有三处「看起来像、其实不算命中」的，逐条写清：

1. **`electron-updater` 内部用 `net.request`**：`node_modules/electron-updater/out/electronHttpExecutor.js:54` 有 `require("electron").net.request({...})`。**它不设 `Sec-Fetch-Dest`**（`grep Sec-Fetch` 在该包 `out/` 0 命中），所以不会触发这条新校验。→ 本仓的更新下载链路**不命中**。
2. **`@mplayer/core` 的浏览器态请求头确实设了 `Sec-Fetch-Dest: document` + `Sec-Fetch-Mode: navigate`**（`packages/core/src/api/antiScrape.ts:241-242`）。但那条链路走的是 **axios（Node http/https）**，不是 `net.request`，不受该规则约束。→ **不命中**。
3. `src/main/services/updateService.ts:129-132` 的 `netSession.fetch` 只带 `Range` 头（`packages/core/src/shared/updateChannels.ts:103-106`），无 `Sec-Fetch-Dest`。→ **不命中**。

**但要记住这条规则的形状**：将来若有人给 `net.request`/`net.fetch` 显式加 `Sec-Fetch-Dest: document`（比如把 core 的 antiScrape 头搬到 net 通道），就必须同时加 `Sec-Fetch-Mode: navigate`，否则请求被拒。

---

## 5. 45.0：逐条对照本仓

来源：[Breaking Changes §45.0](https://www.electronjs.org/docs/latest/breaking-changes#breaking-api-changes-450)、发布博客 [electron-45-0](https://www.electronjs.org/blog/electron-45-0)（截至 2026-10-26 抓取）。

| 45.0 条目 | 判定 | 本仓证据 |
|---|---|---|
| **沙箱 preload 移除 Node shim / `Buffer` / `setImmediate` / `clearImmediate`** | **不适用** | 官方原文见 §5.1；`src/main/main.ts:149` `sandbox: false` |
| 沙箱 preload 的 `ipcRenderer`/`process` 改用原生 EventEmitter | **不适用** | 同上，本仓 preload 非沙箱 |
| 子帧 worker 需 `nodeIntegrationInSubFrames` 才有 Node 集成 | **不命中** | 全仓无 `nodeIntegrationInWorker` / `nodeIntegrationInSubFrames` |
| preload 只在 DevTools 扩展帧运行 | **不命中** | 本仓不加载扩展（无 `loadExtension`） |
| `getUserMedia` 的 `chromeMediaSource: 'desktop'` 拒收 WebContents id | **不命中** | 全仓无 `getUserMedia` / `desktopCapturer` |
| `contentTracing.enableHeapProfiling()` 移除 / Perfetto 格式 | **不命中** | 全仓无 `contentTracing` |
| 屏幕捕获请求改为 `display-capture` 权限 | **不命中** | 全仓无 `setPermissionRequestHandler` |
| `document.requestStorageAccessFor` 默认关闭 | **不命中** | 全仓无 `requestStorageAccessFor` |
| ASAR 内文件描述符只能经 `fs` 使用 | **不命中** | 本仓对 asar 内文件一律走 `fs.readFileSync`（如 `src/main/ipc/appSettingsUpdate.ts:45`、`src/main/storage/fileStorage.ts:138`） |
| 非沙箱窗口的 `window.open()` 子窗口进独立沙箱进程 | **不命中** | `src/main/main.ts:166-172` 的 `setWindowOpenHandler` 一律 `{ action: 'deny' }`，不存在子窗口 |
| `safeStorage` 同步方法弃用（46 移除） | **不命中** | 全仓无 `safeStorage` |
| **Windows WER helper `electron_wer.dll` 需随 exe 改名** | **命中（条件性）** | 见 §5.2 |

**回灌提示**：45.0 里有三条被官方注明 `This change was also backported to Electron 44.3.0, 43.7.0 and 42.11.3.` —— 子帧 worker 的 Node 集成、DevTools 扩展帧的 preload、`getUserMedia` 的 `chromeMediaSource: 'desktop'` 拒收 WebContents id（[Breaking Changes §45.0](https://www.electronjs.org/docs/latest/breaking-changes#breaking-api-changes-450) 各条末尾，截至 2026-10-26 抓取）。**本仓三条全不命中**，所以这条回灌不影响落点选择；但它说明「落 44 就完全躲开了 45 的新行为」这个直觉是错的 —— 相当一部分行为早已随 patch 落到 44/43 的 line 上。

### 5.1 沙箱 preload 那一条为什么「不适用」——官方原文

> `Sandboxed preload scripts (the default since Electron 20) and service worker preload scripts no longer have access to the events, timers and url Node.js module shims through require, and are no longer run with Buffer, setImmediate and clearImmediate in scope.`
> `Preload scripts for renderers with sandbox: false are unaffected and continue to have the full Node.js environment.`

出处：[Breaking Changes §45.0 / Removed: Node.js module shims…](https://www.electronjs.org/docs/latest/breaking-changes#removed-nodejs-module-shims-and-buffer-setimmediate-clearimmediate-globals-in-sandboxed-preload-scripts)（截至 2026-10-26 抓取）。

本仓对应事实：
- `src/main/main.ts:143-150` 的 `webPreferences`：`nodeIntegration: false`、`contextIsolation: true`、`webSecurity: true`、**`sandbox: false`**（`:149`）。
- `src/main/preload.ts` 全文 31 行，只用 `contextBridge` + `ipcRenderer`（`:1` 的 import、`:31` 的 `exposeInMainWorld`），**没有** `require('events')` / `require('url')` / `Buffer` / `setImmediate`。

**双重不命中**：① 官方明说 `sandbox: false` 不受影响；② 即使将来收紧成沙箱，本仓 preload 需要的 `require('electron')` 与 `process`/`global` 在 45 里**仍然提供**（官方原文：`require in a sandboxed preload now only loads electron (and electron/renderer, electron/common); process and global are still provided.`）。

### 5.2 Windows WER helper：本仓会被打到的打包面问题（本票新增）

官方原文（[electron-45-0](https://www.electronjs.org/blog/electron-45-0)，`#53851`）：

> `Electron now ships a Windows Error Reporting (WER) helper so crashReporter can capture __fastfail terminations and other crashes that bypass the in-process handler on Windows 10 20H1 and later. The helper is registered when your application calls crashReporter.start().`
> `Package the helper DLL alongside your application's executable. If you rename electron.exe to myapp.exe, also rename electron_wer.dll to myapp_wer.dll. The helper must match the executable's name for Windows to load it.`

本仓事实链：
1. `electron-builder` **会把 `electron.exe` 改名**：`app-builder-lib/out/electron/ElectronFramework.js:50` → `rename(path.join(appOutDir, \`${electronBranding.projectName}.exe\`), executable)`，产物即 `MPlayer.exe`（`electron-builder.yml:2` `productName: MPlayer`）。
2. **`electron_wer.dll` 的同步改名只有 app-builder-lib ≥ 26.18.1 才有**。本机解包对比（`npm pack` + `tar`，截至 2026-10-26）：

   | app-builder-lib | `electron_wer` 出现次数 | 是否含 `FIRST_ELECTRON_MAJOR_WITH_WER_HELPER` |
   |---|---|---|
   | 26.17.0（本仓 lock 与实装） | 0 | 否 |
   | 26.18.0 | 0 | 否 |
   | **26.18.1** | **1** | **是（= 45）** |

   26.18.1 的实现（`out/electron/ElectronFramework.js:44-71`）：`FIRST_ELECTRON_MAJOR_WITH_WER_HELPER = 45`；`semver.major(coerced) < 45` 时直接 return；否则 `rename(<projectName>_wer.dll → <productFilename>_wer.dll)`，源文件缺失时静默跳过。
3. 对应 changelog 条目（electron-builder 27.0.0-alpha.12，随后回灌到 26.18.1）：`Fix(win): rename Electron's electron_wer.dll Windows Error Reporting helper together with the executable for Electron 45 and later, so fail-fast crashes are captured in packaged apps`（[CHANGELOG](https://github.com/electron-userland/electron-builder/blob/master/CHANGELOG.md)，`#10398`）。26.18.1 的 npm 发布时间 `2026-10-26T12:34:16Z`（`npm view electron-builder time`，截至 2026-10-26）。

**判定：命中，但当前无用户可见影响** —— 本仓 `src/` **没有 `crashReporter` 调用**（`grep -rn crashReporter src/` 0 命中），而官方明说 helper 是 `registered when your application calls crashReporter.start()`。所以：
- **落 44 及以下**：完全无关；
- **落 45**：必须同时把 `electron-builder` 提到 **≥ 26.18.1**（本仓 `package.json:88` 是 `^26.16.1`，lock 与实装是 26.17.0 —— **`npm ci` 不会自动越过 lock**），否则将来接 `crashReporter` 时 Windows `__fastfail` 崩溃会静默丢失。

---

## 6. electron-updater / electron-builder 对 Electron 44/45 的兼容性

### 6.1 官方明文：**未找到**

逐页查过 `electron.build` 的 v26 文档（截至 2026-10-26）：

| 页面 | 内容 | 是否有 Electron 版本矩阵 |
|---|---|---|
| [v26 Overview](https://www.electron.build/v26/) | 能力概览 | 无 |
| [v26 Auto Update](https://www.electron.build/v26/docs/features/auto-update) | `electronUpdaterCompatibility` 只约束 **metadata 格式**（`>=1.0.0` / `>=2.15` / `>=2.16`），与 Electron 运行时版本无关 | **无** |
| [v26 Troubleshooting](https://www.electron.build/v26/docs/troubleshooting) | 只说 `electron must be in devDependencies, not dependencies`、`The Electron version specified in your devDependencies doesn't exist for the target architecture` | **无** |

**结论：`electron-updater@^6.8.9` / `electron-builder@^26.16.1` 对 Electron 44/45 没有官方明文支持声明。**「官方沉默」不等于「不兼容」，也不等于「兼容」——**属未验证**（见 §8）。

### 6.2 能拿到的一手证据（源码 / changelog 级）

1. **Electron 45 + Windows ⇒ electron-builder ≥ 26.18.1**（§5.2 的 wer.dll 改名）。这是本调研找到的**唯一一条有源码依据的硬版本约束**。
2. **Electron 44 的 ia32 移除，electron-builder 在 27.0.0-alpha.6 才改**：`createTargets(..., arch: "all") now expands to x64 + arm64 on Windows and Linux instead of x64 + ia32. Electron 44 removed Windows ia32 builds…`（[CHANGELOG](https://github.com/electron-userland/electron-builder/blob/master/CHANGELOG.md)，`#10032`）。**本仓不受影响**——`electron-builder.yml` 逐个 target 显式写 `arch: [x64]`/`[x64, arm64]`，从不使用 `arch: "all"`。
3. **electron-updater 自己的测试基线是 Electron 39**：`electron-updater@6.8.9` 与 `6.8.12` 的 `package.json` `devDependencies.electron` 都是 `"39.8.5"`（`npm view` 实测，截至 2026-10-26）。**这是「未在 44/45 上测过」的客观信号，不是结论。**
4. **electron-updater 的版本门槛检查不存在**：`grep 'process.versions.electron'` 在该包 `out/` 0 命中 —— 它不做 Electron 版本 gating，行为兼容性只能靠冒烟。
5. **本仓两条依赖的当前解析结果**（截至 2026-10-26）：`electron-builder@^26.16.1` 最新可达 **26.18.1**、`electron-updater@^6.8.9` 最新可达 **6.8.12**；本机 lock 里分别是 26.17.0 与 6.8.9。**若落 45，至少要主动 `npm install electron-builder@^26.18.1` 把 lock 推过 26.18.1。**

---

## 7. 版本选择的判据

### 7.1 42 已 EOL 意味着什么

- **安全补丁通道关闭**：官方支持策略是「最新 3 个 major」，42 在 45 发布日（2026-10-20）出窗口；45 的发布博客直接写了 `End of Support for 42.x.y`。**42 之后不会再收到任何 Electron 安全修复**（含 Chromium 侧的）。
- **`npm audit` 会重新变红**：本仓现在这条 high 的修复线是 42.11.16，42 系最后一版是 42.11.18（2026-10-21）。**今天装上 42.11.18 是 0 条，但它已 EOL，下一次 Electron 安全公告不会再有 42 的修复版本 —— 届时 `npm audit` 会再出一条 `range` 只到 42.x 的 high，而 42 已无版本可升。** 这正是 #658 想避免的那种「刚修完又要修」。
- **结论**：42 不构成合法落点，哪怕它的 audit 是 0 条。

### 7.2 43 / 44 / 45 三选一

| 落点 | 支持到 | 距今窗口 | stable 发布 | patch 数 | audit | 本仓破面 | 额外动作 |
|---|---|---|---|---|---|---|---|
| 43.8.3 | 2027-01-05 | 71 天（~2.3 个月） | 2026-06-29 | 26 | 0 | Dialog 默认目录（§3） | 无 |
| **44.9.3** | **2027-03-02** | **127 天（~4.2 个月）** | 2026-08-24 | 22 | 0 | Dialog 默认目录 + macOS 13 地板声明（§4.1） | README 写明 macOS 13+ |
| 45.0.0 | 2027-04-27 | 183 天（~6.0 个月） | 2026-10-21 | 1 | 0 | 同上 + **electron-builder ≥ 26.18.1**（§5.2） | 升 builder + 冷却观察 |

数据来源：EOL/发布日见 §1.2；patch 数为 `releases.electronjs.org/releases.json` 中 `<major>.` 开头的 stable 版本计数（42.x=45、43.x=26、44.x=22、45.x=1，截至 2026-10-26）；audit 见 §0 结论 4。

### 7.3 判据与倾向

1. **支持窗口长度**（从复核日 2026-10-26 算到 EOL）：45 = 183 天、44 = 127 天、43 = 71 天。**43 的窗口在下一个 audit 周期（季度级）前就会到期，等于立刻要跳第二次**，直接排除。
2. **line 成熟度**：44 有 22 个 patch、发布 63 天；45 只有 1 个 patch、发布 5 天。**45 是一个刚出生的 major。**
3. **本仓自己的冷却纪律**：`.github/dependabot.yml:12-16` 给 major 定的是 `semver-major-days: 30`。**今天跳 45 就是绕开自己写下的尺子**（45.0.0 发布 2026-10-21，距今 5 天）。
4. **破面代价**：44 与 43 的破面相同（都是 Dialog 默认目录）；45 额外多一条「必须升 electron-builder 到 ≥26.18.1」。
5. **跳几个 major**：从 41 出发，43 = 跳 2、44 = 跳 3、45 = 跳 4。Chromium 从 M146 → M150/152/156。**本仓与 Chromium 直接耦合的面很窄**（`webPreferences` 是安全基线、无扩展、无 `getUserMedia`、无 OSR、无 `net.request`），所以「跳得多」本身在本仓不是主要风险项 —— 但 Chromium 的渲染行为变化（字体、媒体解码、Howler/WebAudio）只能靠真机验。

**倾向 44.9.3**：窗口覆盖到 2027-03，成熟度足够，破面全部可控（1 处 UX 待拍板 + 1 处文档声明），且不需要连带升 electron-builder。**这是维护判断，不是技术必然** —— 若维护者更在意「一次跳到位、两年不再动」，45 也成立，前置条件是 `electron-builder ≥ 26.18.1` + 30 天冷却期后再动。

### 7.4 无论选哪个，都要一并改的清单（可执行）

按「升级 PR 的完成定义」列，不是建议：

1. **`docs/agents/testing.md:35`** —— 把「补一条 `npm rebuild electron`」换成 `npx install-electron`（或直接删掉，改成「跑一次 `npm run electron:dev` 即会自动下载」），并删掉「跳过它的 postinstall」这个 42+ 已不成立的因果。
2. **`scripts/verify.mjs:205`** —— 同上，提示文案与 `testing.md` 对齐（这两处是本仓**唯一**会把人引向空转命令的地方）。
3. **`README.md:52-54`** 的下载表 + 发行说明 —— 若落 ≥44，写明 **macOS 13 (Ventura) 或更高**（§4.1）。
4. **`src/main/ipc/appSettingsUpdate.ts:36,39`** —— 拍板 Dialog 默认目录的处置（§3.4 的 a/b/c）。
5. **若落 45**：`package.json:88` 的 `electron-builder` 提到 `^26.18.1` 并 `npm install` 把 lock 推过 26.18.1（§5.2）。
6. **`.github/dependabot.yml:37`** —— 该处 `ignore: electron` 的理由写的是「electron 由 electron-builder 配套版本管理」；升级后这条理由仍然成立（Electron 版本与 electron-builder 的配套关系在 45 上反而变强了），**但值得在 PR 里复核一次**，别让「ignore」在下次 audit 周期里把安全补丁也一起挡掉。

---

## 8. 官方沉默 / 未验证（不许当结论传播）

1. **`electron-updater` 在 Electron 44/45 下的实际行为（检查更新、下载、`quitAndInstall`、差分下载）—— 无官方明文。** 其自身测试基线是 Electron 39（§6.2 第 3 条）。只能靠打包产物冒烟证。
2. **`electron-builder@26.16.1` 打 44/45 安装包的产物完整性 —— 无官方明文。** 唯一有依据的是 45 + Windows 的 wer.dll 版本门槛（§5.2）。
3. **Windows 代码签名 / macOS 公证在 44/45 下的行为 —— 无官方明文。** 本仓 `electron-builder.yml:64` `notarize: true` 但 CI 无凭据时自动跳过（`release.yml:152-185`），这条路径**从未在有凭据的环境下被本调研验证过**。
4. **`npx install-electron` 的端到端下载 —— 本会话未验成功**（网络受限，§2.5 末尾）。源码语义正确、失败信息正确，但「149 MB 下完并解出 `dist/`」这一步未跑通。
5. **44 起 ANGLE 静态链接对 GPU 渲染路径的实际影响 —— 本仓未替换 ANGLE，理论上不命中，但未实测。**
6. **`endoflife.date` 是第三方聚合**：本调研用它做**交叉核对**（与 `releases.electronjs.org/schedule` 内嵌数据、官方博客三方一致），**不作为唯一依据**。若将来三者冲突，以 `releases.electronjs.org/schedule` 为准。

---

## 9. 复核方法与来源清单

### 9.1 复跑命令（全部只读，不改仓库）

```bash
# 1) 支持窗口 / EOL
curl -s https://endoflife.date/api/electron.json
curl -s https://releases.electronjs.org/releases.json        # 注意 files 字段不可信，见 §1.3
curl -s https://releases.electronjs.org/schedule             # 内嵌 schedule 数据

# 2) postinstall 是否还在（41 vs 42+）
npm view electron@41.10.7 scripts bin --json
npm view electron@42.11.18 scripts bin --json
npm view electron@44.9.3 scripts bin --json

# 3) 候选落点的漏洞面（在 .tmp-* 里做，别碰本仓 lock）
mkdir -p .tmp-audit && cd .tmp-audit
printf '{"name":"probe","version":"0.0.0","private":true,"devDependencies":{"electron":"44.9.3"}}' > package.json
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm audit --json

# 4) npm rebuild 在 42+ 上是否空转
mkdir -p .tmp-rb && cd .tmp-rb
printf '{"name":"p","version":"0.0.0","private":true}' > package.json
npm install --ignore-scripts --no-audit --no-fund electron@42.11.18
npm rebuild electron && ls node_modules/electron   # 期望：没有 dist/、没有 path.txt

# 5) electron-builder 有没有 wer.dll 改名（45 前置）
npm pack app-builder-lib@26.18.1 && tar -xzf app-builder-lib-26.18.1.tgz
grep -c electron_wer package/out/electron/ElectronFramework.js   # 26.17.0/26.18.0 为 0，26.18.1 为 1
```

### 9.2 一手来源

| 来源 | URL | 用途 |
|---|---|---|
| Electron 支持策略 / 发布节奏 | <https://www.electronjs.org/docs/latest/tutorial/electron-timelines> | 「最新 3 个 major」、8 周节奏、只支持每 line 最新 minor |
| Electron Breaking Changes | <https://www.electronjs.org/docs/latest/breaking-changes> | 42/43/44/45 的逐条原文（含 `sandbox: false` 那句豁免） |
| Electron 42 发布博客 | <https://www.electronjs.org/blog/electron-42-0> | postinstall 移除（`#49328`） |
| Electron 43 发布博客 | <https://www.electronjs.org/blog/electron-43-0> | Dialog 默认 Downloads（`#49868`） |
| Electron 44 发布博客 | <https://www.electronjs.org/blog/electron-44-0> | macOS 12 移除（`#51967`）、32 位移除（`#52326`）、EOS 41 |
| Electron 45 发布博客 | <https://www.electronjs.org/blog/electron-45-0> | 沙箱 preload、WER helper（`#53851`）、EOS 42 |
| Electron 官方发版数据 | <https://releases.electronjs.org/releases.json> · <https://releases.electronjs.org/schedule> | 版本→日期/Chromium/Node；EOL |
| Electron 发布资产真值 | `https://api.github.com/repos/electron/electron/releases/tags/v<ver>` | 判 32 位是否还存在 |
| Electron dialog API 文档 | <https://github.com/electron/electron/blob/main/docs/api/dialog.md> | `defaultPath` 未传时的 Downloads 语义 |
| EOL 聚合（交叉核对） | <https://endoflife.date/api/electron.json> | 与官方 schedule 三方一致 |
| 安全公告 | <https://github.com/advisories/GHSA-jr5w-w6x2-84p9> | 唯一 high 的 affected/patched 区间（`<42.11.16`，patch 42.11.16/43.8.1/44.9.1/45.0.0-beta.6） |
| electron-builder changelog | <https://github.com/electron-userland/electron-builder/blob/master/CHANGELOG.md> | 27.0.0-alpha.6（ia32/arch all）、alpha.12（wer.dll，`#10398`） |
| electron-builder v26 文档 | <https://www.electron.build/v26/> · <https://www.electron.build/v26/docs/features/auto-update> · <https://www.electron.build/v26/docs/troubleshooting> | **确认无 Electron 版本矩阵** |

源码级证据（本调研直接读的实现）：

- `electron@44.9.3` 包内：`package.json`（无 `scripts`、`bin.install-electron`）、`index.js`（缺 `path.txt` 时 `spawnSync(install.js)`）、`install.js`（`process.argv` 出现 0 次）。
- `app-builder-lib@26.17.0`（本机实装）/ `26.18.0` / `26.18.1`（`npm pack` 解包）：`out/electron/ElectronFramework.js`（`:50` exe 改名、`:220-232` 自下 zip、`:44-71` wer.dll 改名与 `FIRST_ELECTRON_MAJOR_WITH_WER_HELPER`）、`out/electron/electronVersion.js`（版本从 `node_modules/electron/package.json` 读）、`out/macPackager.js:421-424`（`LSMinimumSystemVersion` 仅显式配置时写入）。
- `electron-updater@6.8.9`（本机实装）：`out/electronHttpExecutor.js:54`（`net.request`，无 `Sec-Fetch-*`）。
- `@electron/get@5.0.0`：`dist/Cache.js:8-11`（`envPaths('electron').cache`，与 `release.yml` 缓存路径同源）。

### 9.3 本仓证据索引（`文件:行`）

| 断言 | 证据 |
|---|---|
| electron 声明 `^41.7.1` | `package.json:87` |
| electron-builder 声明 `^26.16.1` | `package.json:88` |
| electron-updater 声明 `^6.8.9` | `package.json:47` |
| 「补 `npm rebuild electron`」 | `docs/agents/testing.md:35`、`scripts/verify.mjs:205` |
| release 缓存 electron zip + `npm ci --ignore-scripts` | `.github/workflows/release.yml:119-132` |
| dev 启动走 `import electron` | `scripts/start-electron-dev.mjs:3,32` |
| 选目录 / 选清单对话框无 `defaultPath` | `src/main/ipc/appSettingsUpdate.ts:36`、`:39` |
| 保存对话框传裸文件名 | `src/main/services/playbackTraceService.ts:56-59` |
| 下载目录默认值 = Downloads | `src/main/ipc/appSettingsUpdate.ts:83-86` |
| `sandbox: false` | `src/main/main.ts:143-150`（`:149`） |
| preload 只用 contextBridge/ipcRenderer | `src/main/preload.ts:1,31` |
| `window.open` 一律 deny | `src/main/main.ts:166-172` |
| 无 `crashReporter` | `grep -rn crashReporter src/` → 0 命中 |
| 无 `clipboard` 实调用 | 仅测试 mock：`src/renderer/__tests__/setup.ts:35,93`、`src/__tests__/main/setup.ts:99`、`src/__tests__/main/downloadService.test.ts:78` |
| 无 `net.request`/`net.fetch` | `grep -rn 'net\.request\|net\.fetch' src/` → 0 命中 |
| 无 `select-client-certificate` | `grep -rn select-client-certificate src/` → 0 命中 |
| win/linux 只有 x64、mac x64+arm64 | `electron-builder.yml:36-42`、`:65-69`、`:72-79` |
| 无 `mac.minimumSystemVersion` | `grep -n minimumSystemVersion electron-builder.yml` → 0 命中 |
| README 下载表无 macOS 地板 | `README.md:52-54` |
| major 冷却 30 天 | `.github/dependabot.yml:12-16` |
| electron 被 dependabot ignore | `.github/dependabot.yml:37` |
