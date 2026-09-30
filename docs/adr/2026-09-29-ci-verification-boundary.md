# ADR: CI 验证边界——唯一入口、测试分片、原生按路径触发

- 状态：已接受
- 日期：2026-09-29
- 关联：**#460**（本决策）；#446（前一轮依赖批次暴露的 lockfile/CI 事实）。取证依据：master CI 近 30 次运行的逐 job 结论、`release.yml` 近 5 个月 62 次运行，均可用 `gh run list` / `gh run view --json jobs` 复核。

## 背景

三条一手事实：

1. **触发器静默失效**：`ci.yml` 写 `on.push.branches: ['*']`，而 GitHub 的 glob 里 `*` 不匹配 `/`；本仓库分支规范是 `<type>/<slug>`（`docs/agents/git-workflow.md`）。CI 全部历史里的 push 事件命中 **119 次 master、1 次无斜杠探针分支、0 次功能分支**。同一时期 `mobile-android` 带 `if: github.event_name != 'pull_request'`，于是 PR 期永远不跑、功能分支 push 期也从不触发，只剩 master 一种可能。
2. **master 复核被自己取消**：`concurrency.cancel-in-progress: true` 让连续合并互相取消——近 30 次 master 运行 **11 次 cancelled**；`feat/native-player`（#443，整个原生播放层）在 master 上的运行就是 cancelled。
3. **测试与原生构建的覆盖空洞**：PR CI 只跑 mobile 一套（37 文件）。renderer + `src/__tests__`（59 文件 / 466 用例）只在发版期的桌面构建里跑；`packages/core`（55 文件 / 676 用例）**在任何 workflow 里都不跑**；main（18 文件 / 174 用例）连 npm script 都没有。原生侧 `ci.yml` 只跑 `assembleRelease`（APK），AAB 的 `packageReleaseBundle` 从未在 CI 执行。

第 3 条后半段有直接代价：**v1.7.3 发版炸在 `:app:packageReleaseBundle` / `Java heap space`**——唯一一次发版期原生失败，正好落在那条从没被 CI 跑过的路径上。

反过来，原生构建不是没有价值：2026-07-31 一天内 5 次拦下 `gradle-api-9.3.1.jar ... metadata is 2.2.0, expected version is 1.9.0` 的工具链不兼容（当时的 `expo prebuild --clean` 形态）；2026-09-12 拦下 Android release bundle 的 `Identifier navBg has already been declared`。所以问题不是「要不要验原生」，而是**什么时候验**。

## 决策

1. **验证只有一个入口**：`scripts/verify.sh`，scope 为 `all` / `static` / `fast`(=static) / `renderer` / `main` / `core` / `mobile`。CI 每个 job 只写 `./scripts/verify.sh <scope>`，不在 workflow 里另拼命令；文档只引用脚本，不复述步骤序列。
2. **测试按套件分片**：`check`（static）+ 矩阵 `test (renderer|main|core|mobile)`，`fail-fast: false`。每个分片自带 `core:build`，彼此独立、不依赖 job 顺序。
3. **main 套件独立**：`src/__tests__/main/**` 归 `vitest.main.config.ts` + `npm run test:main`，并从根 `vite.config.ts` 的 `include` 摘出——同一批用例不再在 jsdom 与 node 两种环境下各跑一遍。
4. **原生构建只在发版期跑**：`ci.yml` 不含任何 Android/Gradle 步骤，PR 与 push 只做静态检查（`check`）与四套测试；APK + AAB 由 `release.yml` 的 `build-mobile` 在 tag 期构建（`assembleRelease bundleRelease --no-daemon` + release 签名）。**发版前不经 CI 编译原生。**
5. **触发器与并发语义写死**：`on.push.branches: [master]`（功能分支交给 `pull_request`）；`cancel-in-progress: ${{ github.ref != 'refs/heads/master' }}`——master 的运行永不被取消。
6. **发版路径降噪**：`release.yml` 加同版本 `concurrency`（`cancel-in-progress: false`，串行而非打断正在 publish 的运行）；`create-tag` 检测远端同名 tag 后明确报错，`publish` 不再 `--force` 推 tag。

## 备选与否决

- **原生构建按路径触发**（`paths` 命中原生文件时在 PR 与 master 上跑 `assembleRelease bundleRelease`）：**先采纳，后在评审中否决**。它比「每次 push 都跑」省，又能保住发版前那一跳；实测一次完整 Gradle release 构建 **6 分 29 秒**（run 36563256853）。否决理由是维护者的判断：原生侧已过了「构建包不成熟、频繁报错」的阶段——2026-07-31 那批 Kotlin/Gradle 工具链失败集中在 `expo prebuild --clean` 时代，改成原生目录入库后再未复发；日常改动绝大多数只碰 JS/TS，为它们付一次完整 Gradle 构建不划算。**本决策明确接受「原生类改动的构建验证推迟到发版期」这一代价。**
- **保持现状（每次 master push 都跑原生）**：否决。近 30 次里 10 次被取消，收益接近零却持续烧额度。
- **只加一步 Metro 打包（`expo export`）而不跑 Gradle**：本轮否决、保留为日后选项。它能以远低于 Gradle 的成本覆盖 RN bundle 这一类（见「后果」里的残余风险），但本轮不引入。
- **`on.push.branches: ['**']`**：否决。功能分支已由 `pull_request` 覆盖，`'**'` 会让同一份代码在分支 push 与 PR 上各跑一遍。
- **required status checks 与本决策同批落地**：否决（时序不可行）。必需检查引用的是 job 名，job 必须先在 master 上存在；先设会让所有 PR 永久 pending。故拆成合并后的独立动作。
- **把 Playwright `e2e/` 接进 CI**：本轮否决。`e2e/README.md` 已声明它是本地手工回归工具；spec 走 `_electron.launch`、部分需要 5174 dev server，接入要 xvfb + 起服务，属独立课题。

## 后果

- **「验证什么」收敛到一处**：改验证范围只改 `scripts/verify.sh`，CI 与文档自动跟随。代价是 5 个 job 各自跑一次 `core:build`（约 8s），换分片独立与失败只影响一片。
- **原生构建的验证点只剩发版期**：PR/push 不再编译 Kotlin/Gradle。发版流水线仍是闸门——`publish` 要求 `build-mobile` 成功（`release.yml` 的 `if` 条件），所以原生构建失败**不会发出坏版本**，代价是**一次失败的发布尝试**（用 GitHub 的 re-run 重试即可，不必重打 tag）。
- **已记录的残余风险（明知的取舍）**：原生依赖 bump（如 2026-09-29 的 `react-native-screens` 4.27.0）与 AAB 打包路径都只在 tag 期才被编译；RN bundle（Metro）这一类失败的证据强度有限——2026-09-12 那次 `check` 先挂在 lint 上，`mobile tsc` 未执行，因此**「tsc 是否也能抓到同类错误」未经验证**，该空洞可能本就不存在。
- **上一条的残余风险已于 2026-09-29 兑现**：`react-native 0.86.2 → 0.87.1`（0.x 的 minor，实际是破坏性升级、且不在 Expo SDK 57 的支持矩阵内）随 Dependabot 的 production 分组混进 19 条的批次（#449 → #466），把 master 的 Android 发版构建打破（#478，修复 #481）——而 PR CI 因本决策「原生只在发版期构建」一路全绿。
  处置**不是**恢复 PR 期的原生 Gradle 构建，而是：把生态耦合集从 semver 机器人手里收回，并新增 **`expo install --check` 门禁**（秒级、零 Gradle，直接命中这一类失败）——见 ADR `docs/adr/2026-09-29-dependency-update-governance.md`。
- **必做后续（合并之后）**：给 master 的 ruleset `protect-master` 加 required status checks（`check` + 四个 `test` 分片；`expo-check` 见下条权衡）。顺序不可颠倒：job 必须先存在于 master。
- **未解决、留给后续**：`release.yml` 的 `workflow_dispatch` 通道保留未动——dispatch-with-version 会在 publish 阶段推 tag，从而再触发一次 tag-push 构建（同版本构建 2 次）。这是独立的流水线设计问题，需先确认手工出包的使用场景。
- 本决策不碰 `docs/research/`、`docs/specs/` 下的日期存档；那里「CI 会跑 X」若与现状不符，属历史快照，不回改。

## 更新（2026-09-30，#500）

决策 1 的**入口实现**从 bash 换成 Node：`scripts/verify.mjs` 成为唯一事实源，`scripts/verify.sh` 退化为两行 shim
（`exec node ...`）；scope 集合与步骤序列逐字不变，**决策 1 的语义不变**（仍然只有一个入口、CI 不另拼步骤）。

原因是踩到了一条没被记录的 Windows 坑：`Get-Command bash` 的第一顺位常常是
`C:\WINDOWS\system32\bash.exe`（WSL），于是 WSL 的 **Linux** node 去跑 Windows 装的 `node_modules`，
在 `core:build` 里报 `Cannot find module @rollup/rollup-linux-x64-gnu` —— 错误完全不指向成因，
且每个在 Windows 上跑验证的人与 agent 都会撞一次（本仓的主力开发机就是 Windows）。Node 是本项目的硬依赖，
脚本因此跨 pwsh / cmd / Git Bash / WSL / CI 行为一致。`design-lint.sh` 同样移植为 `design-lint.mjs`，
输出与退出码已与 bash 版逐字对拍（干净树 + 植入 4 条违规含豁免行，两边完全一致）。

- CI 的三处 `./scripts/verify.sh <scope>` **未改**（走 shim，顺带把 shim 一起验证）；新增 `npm run verify`，
  Windows / PowerShell / cmd / Git Bash 通用（含 `-- <scope>`）。
- `verify.mjs` 增加一条**起跑前自检**：`node_modules` 的平台与当前 node 不一致时直接给人话
  （点名「你在用 Windows 装的依赖跑 Linux node（WSL）」并给两条处置），把上面那个「长得像 rollup 的问题」提前拦成明确的平台错误。
- 仍未移植（当时有意）：`release.sh`（低频人工动作）与 `mobile-*.sh`（绑定 adb / 真机回路）——它们仍需要 bash，
  且 CRLF 那条老坑对它们继续成立（见 `docs/agents/git-workflow.md`）。

## 更新（2026-09-30，#502）：剩余 bash 脚本一并收口

上一条里「仍未移植」的那批脚本已按同一形态全部移植（`.mjs` 事实源 + `.sh` 两行 shim）：

| 脚本 | 说明 |
|---|---|
| `release.mjs` | 一键发布；子进程改用数组参数（不拼命令行）→ 用户给的目标版本没有注入面 |
| `dev-mobile.mjs` | Expo dev server |
| `mobile-debug.mjs` | 真机调试一条龙 |
| `mobile-frame-stats.mjs` | 帧计时取证；解析段原为内嵌 Python heredoc → JS 重写，**去掉 python3 依赖** |
| `mobile-e2e.mjs` | 真机 e2e 一条龙；uiautomator XML 解析与 manifest projectRoot 提取改 JS，**不再需要 python3** |
| `mobile-device/usb-attach.mjs` | usbipd 把手机 attach 进 WSL（本就只在 WSL 里有意义） |

- 两处**有意**的行为差异（都是去掉环境耦合）：仓库根改由脚本自身位置推导（原 `git rev-parse` 在
  「Windows 建的 worktree + WSL 侧跑」时解析 Windows 绝对路径会失败，原脚本自己记过这条限制）；不再要求 python3。
- 可无设备验证的部分已对拍：`mobile-frame-stats.mjs` 复算 `e2e/artifacts/frame-A1` 的产物与
  原 bash+python 版**逐字段一致**（对拍时抓到一处真实分叉：原实现的注释写 `ceil(p*n)-1`，代码实际是
  `int(p*n)-1`，移植按**代码实际行为**对齐，否则 p90/p99 会不一致）；`mobile-e2e.mjs` 的
  uiautomator XML 解析与 Python 版在同一份探针 XML 上**逐例一致**（含锚定模式因 NUL 不命中的行为、`&amp;` 实体解码）。
- **真机部分仍需复跑一次**：`mobile-e2e.mjs` / `mobile-debug.mjs` 的设备路径（adb + uiautomator + logcat）
  在无设备环境里不可验证，按仓库约定属人工环节。

## 更新（2026-10-01，#523）：static 增加文档门禁

决策 1（验证只有一个入口）不变，`static` 的步骤序列多了一步，排在最前：`docs-gate.mjs`（秒级、不依赖安装）。
**没有加 CI job**：`check` job 跑的就是 `verify.sh static`，顺带覆盖。

它把两条「人肉核对」变成机械门禁：活文档里把 `scripts/*.sh`（现全为两行 shim）当命令推荐；
`docs/agents/architecture.md` 的文件表漏记实现文件（1.8.5 复盘一次就漏了 10 处）。边界：只扫活文档的 Markdown
（历史存档 `docs/{adr,research,specs,wayfinder}` 不回改；`.github/workflows/**` 有意走 shim，要验证 shim 本身），
允许清单在脚本里。

同批还加了两条同族的前置拦截：`verify.mjs` 自检**依赖树与 `package-lock.json` 一致**（依赖提交合并后
`node_modules` 落后时，症状原本落在 `lint` 的 `Cannot find module` 与 `core:build` 的 `pako` TS7016 上）；
`.githooks/pre-commit` 在 mobile typecheck 前保证 `packages/core/dist` 新鲜（dist 落后会报假 `TS2305`）。

