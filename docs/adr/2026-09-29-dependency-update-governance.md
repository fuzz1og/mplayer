# ADR: 依赖升级治理——机器人只管 patch，生态耦合集交给 SDK 对齐

- 状态：已接受
- 日期：2026-09-29
- 关联：**#483**（本决策）、#478 / #481（事故与修复）、#449 / #466（引入破坏性升级的批次）、#446（Dependabot 分组策略首版）
- 一手来源调研：`docs/research/2026-09-29-dependency-update-policy.md`（结论逐条带官方链接；下文的引文都出自该文件收录的原文）

## 背景

2026-09-29，Dependabot 的分组 PR **#449**（`bump the prod-non-major group with 19 updates`）把 19 条 production 升级捆在一起，其中包含 `react-native 0.86.2 → 0.87.1`。这条被合并（#466）后，**master 的 Android 发版构建失败**（#478：RN 0.87.1 的 gradle 插件把 AGP 提到 9.2.1 → 要求 Gradle ≥ 9.4.1；升到 9.4.1 后其内嵌 Kotlin 2.3.0 又与 Expo SDK 57 的 Kotlin 2.1.20 编译器不兼容）。

**这不是「没审细」的问题**，而是两条结构性缺口，各自都有官方依据：

1. **semver 与机器人对 0.x 的理解都不足以判断破坏性。** semver 规范 §4 原文：`Major version zero (0.y.z) is for initial development. Anything MAY change at any time. The public API SHOULD NOT be considered stable.` 而 Dependabot 官方只按字面分位：`Dependabot assumes that versions in this form are always major.minor.patch.` —— 所以 `0.86.2 → 0.87.1` 在它眼里就是 `minor`。Renovate 是唯一对此有明文警告的主流工具（`Packages that follow SemVer are allowed to make breaking changes in any 0.x version, even patch and minor.`），并有 `matchIsBreaking` 与默认 `separateMajorMinor: true` 这种「按是否破坏性/按 major 拆 PR」的维度；**GitHub 文档对 0.x 零表述**。
2. **没有任何检查在验「依赖集是否对齐 Expo SDK 的期望版本」。** Expo 官方要求 `Upgrade all dependencies to match the installed SDK version.` —— 对 Expo 而言「正确版本」不是「semver 允许的最新」，而是 SDK 的支持矩阵（官方 API `api.expo.dev/v2/versions/latest` 里 SDK 57 的 `facebookReactNativeVersion = "0.86.3"`，0.87.1 不在其中）。而按既定决策「原生只在发版期构建」（ADR `2026-09-29-ci-verification-boundary`），PR CI 不编译原生，这条偏离就一路绿到发版。

GitHub 官方唯一给出的分组示例也落在低风险层：`you can combine updates for minor or patch updates for development dependencies into a single pull request` —— 把 production 的 0.x minor 混进分组，是工具允许、官方未背书、且被 Renovate 明确警告过的用法。

## 决策

1. **生态耦合集的版本选择权不交给 semver 机器人**：`expo*`、`react-native`、`react-native-*`、`@react-native-community/*`、`@react-native-masked-view/*`、`@react-native-async-storage/async-storage`、`@types/react` 的 **minor + major version updates 一律 `ignore`**，只放行 patch。
   依据（官方明文）：`ignore` 的 `update-types` **只作用于 version updates，不影响 security updates** —— 所以这不牺牲安全补丁通道。
2. **给依赖集加一道 SDK 一致性门禁**：`scripts/verify.sh` 新增 `expo` scope，CI 新增独立 job `expo-check`，跑 `CI=1 npx expo install --check`。
   官方保证在 CI 下非零退出（文档 `It exits with non-zero in Continuous Integration (CI).` + 源码 `Log.exit(..., 1)` 双证）。实测在坏掉的 master 上输出 `react-native@0.87.1 - expected version: 0.86.3` 等 9 条并 **exit 1**，**秒级、零 Gradle、零 keystore**。
3. **机器人继续负责其余依赖**：保留 `prod-patch` 分组（production 只合 patch）、`dev-non-major` 分组、分级 `cooldown`。
4. **生态耦合集的升级动作固定为 `npx expo install --fix`**（或随 SDK 大版本升级整体推进），不再由机器人驱动；一致性由决策 2 的门禁兜住。
5. **workspace 依赖树规范**：`expo` 全仓**只保留一份** —— 根与 `packages/mobile` 声明同一范围（当前值以 `package.json` 与 `npx expo install --check` 的输出为准；本文件不抄版本字面量）。实测根写 `~57.0.25`、mobile 写 `~57.0.26` 时，npm 会在 `packages/mobile/node_modules` 下再装一份（`node_modules/expo@57.0.25` 与 `packages/mobile/node_modules/expo@57.0.26` 并存），于是「根 `node_modules/expo` 是哪个版本」变成陷阱。同理 `@types/react` / `@types/react-dom` 的范围不得逃出 SDK 的 `relatedPackages`（`~19.2.4` / `~19.2.3`）。
   **并且：`expo install --check` 只校验「已装版本」，不校验 package.json 的声明地板** —— 实测 `expo-asset: ~57.0.13`（SDK 期望 `~57.0.18`）、`expo-file-system: ~57.0.5`（期望 `~57.0.7`）、`expo-font: ~57.0.1`（期望 `~57.0.4`）、`@babel/core: ^7.25.2`（期望 `^7.29.0`）都能全绿通过。声明地板必须人工按 SDK 期望对齐。

## 备选与否决

- **关掉 Dependabot**：否决。会一并失去 security updates 通道（它与 version updates 相互独立、不占 `open-pull-requests-limit`），而本次事故的成因是「分组粒度 + 缺一致性检查」，不是「有机器人在跑」。
- **只收紧分组粒度、不加门禁**：否决。挡不住手改版本或别的 PR 把版本带偏，也无法回答「依赖集与 SDK 是否一致」。
- **迁到 Renovate**：本轮否决，保留为日后选项。它独有的 `dependencyDashboard`（单个 issue + 勾选审批，取代 PR 洪水）、原生 `automerge`/`platformAutomerge`、`minimumReleaseAge`（可挂 pending 状态并与 automerge 联动）、`matchIsBreaking` 确实更贴合「先批后建 PR」的模型（Renovate 官方对照页就 Dependabot 写 `Dependabot does not have a similar feature.`）。但决策 1 + 2 已覆盖本次失败模式，迁移是独立工程；等落地后若仍有审查疲劳再评估。
- **用 `expo-doctor` 当门禁**：否决。覆盖更广（app config、原生目录同步、依赖一致性），但在本仓有**两处设计性红**：根 `overrides` 把 metro 钉到 0.84.6 而 Expo 期望 0.84.5；原生目录已提交 + `app.json` 配置的 CNG 反向布局会被判为「未同步」。要用得先配 `expo.install.exclude`，收益不抵复杂度。
- **恢复 PR 期的原生 Gradle 构建**：否决（既定决策，见 `2026-09-29-ci-verification-boundary`）。本决策用秒级 SDK 一致性检查覆盖同一失败类别，而不是把 6.5 分钟的构建搬回 PR。

## 后果

- **#478 缺失的那一环被补上**：生态耦合集的版本偏离在 PR 期即被发现，且成本是秒级而不是一次完整原生构建。
- **已知代价（必须接受）**：`expo install --check` 读的是 Expo **远端** SDK 元数据，**Expo 发布新的期望补丁时会与仓库改动无关地变红**。处置是 `npx expo install --fix`。若日后觉得这种上游驱动的红干扰太大，正确的降级是把它从必需检查降为可见 job，**而不是删掉它**——它挡的正是 #478 那一类。
- **SDK 升级变成显式动作**：生态耦合集不再收到 minor/major 的自动 PR。代价是不再被机器人提醒「有新 SDK」；收益是不会再有机器人把一个未适配的 RN minor 混进 19 条的批次。
- **安全更新不受影响**：`update-types` 只作用于 version updates；安全更新另走通道且不占 `open-pull-requests-limit`。
- **本决策不改变「原生只在发版期构建」**：CI 边界 ADR 的后果节已补记本次事故与处置指针。
- **落地成果**：`expo` 由两份收敛为一份（根 `node_modules/expo@57.0.26`，`packages/mobile/node_modules/expo` 消失），lockfile 相应减少 329 行；`@types/react` / `@types/react-dom` 的范围收回 SDK `relatedPackages` 内；`expo-asset` / `expo-file-system` / `expo-font` / `@babel/core` 的声明地板按 SDK 期望抬齐；`music-metadata`、`wait-on` 抬到 latest（同一 major 内）。全程用 `npm ci --ignore-scripts`（与 CI 同款）验证 lock 与三个 manifest 同步。
- **未解决：metro 家族与 `@expo/metro` 的精确要求不一致**。`@expo/metro@56.0.2` 与 RN 的 `@react-native/community-cli-plugin@0.86.3` 都要求**精确** `metro@0.84.5`，而根 `overrides` 写的 `^0.84.5` 会解析成 **0.84.6** —— `npm ls` 因此把 `metro` / `metro-config` / `metro-transform-worker` 标为 `invalid`（`expo-doctor` 报同一条）。修法明确（override 钉成 `0.84.5`），但本轮**未能落地**：npm 10.9.8 的 arborist 在「从零重解析」路径上崩溃（`TypeError: Cannot read properties of null (reading 'edgesOut')` at `build-ideal-tree.js #loadPeerSet`；去掉 metro override 后同样崩，故与 override 无关），而对 lock 做外科手术会让 npm 顺手剪掉父级需要的嵌套依赖（`npm ci` 随即报 `Missing: hermes-estree@0.35.0 / agent-base@7.1.4 / negotiator@1.1.0 / mime-db@1.54.0`）。留待用更新的 npm 或 `--force` 路径单独处理。**该 `invalid` 是既有状态（HEAD 的 lock 里同样存在），本决策既未引入也未加重它。**
- **未解决：`npm audit fix` 在本仓不可用**（2026-10-08 实测，npm 10.9.8）。根 `overrides.react-native` 让全树重解析在 **peer 校验**阶段就 `ERESOLVE`（`peer react-native@"^0.0.0-0 || >=0.65 <1.0" from @react-native-async-storage/async-storage@2.2.0` vs `Conflicting peer dependency: react-native@0.72.17`）。它与上面那条 `edgesOut` TypeError **同类**（都是根 `overrides` 让理想树算不出来），但**不是同一条**；`--legacy-peer-deps` 能绕过 peer 校验，代价是算出会删包的野树（打印 `remove typescript` / `remove react-native-reanimated` / `remove react-native-worklets` 等）且修完仍剩 critical，不可采。**别再把 `npm audit fix` 当成可用入口。**
- **本决策下 audit 的可行路径 = 定点修**：声明区间内可达的用 `npm update <pkg>`，被精确钉死的用根 `overrides` 单点顶版。本次 `shell-quote`（critical）即后者——`concurrently@10.0.5` 精确钉 `shell-quote: 1.9.0`，而 `concurrently` 的 `latest` 也是 10.0.5，无修复版可换；override `^1.11.0` 后 `quote()` 在 127 个输入上与 1.9.0 逐字节相同，`npm ci --ignore-scripts` 与 `npm run verify -- all` 全绿。收益：audit 57（2 critical / 45 high / 10 moderate）→ 51（0 critical / 41 high / 10 moderate）。
- **残余的归属沿用本 ADR 既定口径**：生态耦合集随 Expo SDK 基线治理；另 4 条是**上游无补丁的根 advisory**（`braces` / `node-forge` / `sprintf-js` 的 registry `latest` 即已装的漏洞版本；`decode-uri-component` 有修复版但被 SDK 耦合链 `expo-router → query-string@7` 挡住），只能等上游发版或随 SDK 升级。
- 未解决：`expo-check` 是否设为 master 的必需检查，留到合并后（必需检查引用的 job 必须先在 master 存在）。
- **更新（2026-10-16，#636）：`braces` 属「无任何干净版本可钉」的第三类**。上文把它归进「registry `latest` 即漏洞版本」那类，结论（等上游）没错，但**理由不够**——真正的拦路石是**两条 advisory 的区间把全部已发布版本盖满**，不是「latest 恰好中招」：`GHSA-vfj7-8cjw-p6xm`（CVE-2026-93687，stack-exhaustion DoS，2026-09-18）区间 `introduced: 0` → `last_affected: 3.0.3`；`GHSA-grv7-fg5c-xmjg`（CVE-2024-4068，uncontrolled resource consumption）区间 `introduced: 0` → `fixed: 3.0.3`。OSV 逐版本实测：`2.3.2` / `3.0.0` / `3.0.1` / `3.0.2` 命中**两条**，`3.0.3` 命中后一条——**不存在任何同时避开两者的版本**，所以 `overrides` 无论钉哪一版都换不回绿。实测也印证：钉 `braces@2.3.2` 后 `npm audit` 总数 49 → 18，但 `braces` 仍是 high（`via` 列出 `<3.0.3` 与 `<=3.0.3` 两条），即**override 只换了中的那条，没消除条目**。
  - **这不是「override 有行为风险所以别动」，而是「没有目标版本」**：`shell-quote` 那条路的前置条件是存在一个「干净 + 被 `^1.x` 接受」的版本；braces 连干净版本都没有，差测根本无从谈起。为免日后误判成「还没试过」，顺手把可移植性也算清了：braces `2.3.2` 与 `3.0.3` 在 32 个 glob 模式上有 **31 个逐字节相同**，唯一差异是 `[!abc].js`（2.3.2 归一成 `[^abc./].js`，3.0.3 原样保留）——**3.0.3 才是更正确的那份**，回退到 2.x 是行为退化，不是透明降级。
  - **上游路径已堵到 SDK 之外**：`micromatch` 的 `latest` 仍是 `4.0.8`（依赖 `braces@^3.0.3`）；`metro-file-map` 从 `0.83.3` 到 `0.87.1`（含 metro `latest` `0.87.1`）**一律** `micromatch@^4.0.4`。也就是说升 metro 不会甩掉 braces，只能等 braces 自己发版。
  - **可利用性口径（勿夸大也勿当无事）**：两条 sink 里 `compile`（默认 `braces()`）被 `maxLength`（默认 10,000 字符）挡住——深度 5000 即 10,001 字符，`SyntaxError` 先抛（depth ≤ 4999 全部正常返回）；`expand()` 无字符护栏，depth 4000 即 `RangeError: Maximum call stack size exceeded`（2.3.2 更浅，depth 3500 就崩）。**而本仓实际走的那条路够不到 sink**：`metro-file-map` 只调 `micromatch.some(relativePath, globs, {dot})` → `picomatch(pattern, options)`，`picomatch/lib/parse.js` 既不 `require('braces')` 又置 `braces: 0`（关闭展开）；braces 展开只挂在 `micromatch.parse` / `.braces` / `.braceExpand` 上。实测把深度 500/2000/4000/5000 的嵌套 glob 喂给 `mm.some` **全部正常返回**（最慢 466ms）。即：**可达性上本仓不受影响，但依赖树里那条 high 是真的**，处置只能是等上游发版，或由上游维护者（GHSA 下 `jonschlinkert` 已表态需加 `maxDepth`）给出新版本。

- **更新（2026-10-26，#656）：#636 的 `braces` 残余已解除——advisory 被上游撤回**。`GHSA-vfj7-8cjw-p6xm` 已于 **2026-10-23T12:53:02Z** 置 `withdrawnAt`（OSV `GET /v1/vulns/GHSA-vfj7-8cjw-p6xm` 可复核）。OSV 实测 `braces@3.0.3` 返回空，而仓库锁定在 `braces@3.0.3`（`expo → @expo/metro → metro-file-map → micromatch@4.0.8 → braces@3.0.3`）。因此上一个更新里的「两条 advisory 区间盖满全部已发布版本」**不再成立**：区间只剩 `GHSA-grv7-fg5c-xmjg`（`fixed: 3.0.3`），而 3.0.3 恰好就是修复版。`npm audit` 里整棵 `braces → micromatch → metro-file-map → @expo/metro → expo` 大树随之消失，**无需任何 override**。这与上文「解除条件」一段的预期一致——解除条件写成「上游发一版同时避开两条」，实际以**撤回一条**的方式达成，效果相同。留存教训：advisory 的 `last_affected` 不是永久事实，weekly audit 的条目会因上游撤回而自行消解，**归因结论要带复核时刻**。

## 2026-10-26 残余清单（#656 周报：16 → 9）

`npm audit`：**16 条（9 high / 7 moderate / 0 critical）→ 9 条（6 high / 3 moderate / 0 critical）**。修掉的 7 条全部是「声明区间内可达 → `npm update` / 同 major 内 `npm install`」，无一条需要 override、无一条是 major 跳级。

### 已修（7 条，全部 devDependencies 路径，不进产物）

| 包 | 修前 | 修后 | 手段 | 说明 |
| --- | --- | --- | --- | --- |
| `vite` | 7.3.6 | 7.3.7 | 同 major patch | advisory 区间 `>=7.0.0 <=7.3.6`，7.3.7 实测 OSV 返回空。**注意：dependabot #657 也把 vite 7.3.6 → 7.3.7**，两处同值，先合哪条都能被另一条吸收 |
| `vitest` | 4.1.11 | 4.1.12 | 同 major patch | `GHSA-qxg6-89mg-rqv8` / `GHSA-xp26-3454-mjgp` 区间上界 `<4.1.12` |
| `@vitest/coverage-v8` | 4.1.11 | 4.1.12 | 同 major patch | 声明在 `packages/core/package.json`，**根 manifest 里没有**，容易漏 |
| `@vitest/mocker` | 4.1.11 | 4.1.12 | 随 vitest 精确钉版 | `vitest@4.1.12` 把 `@vitest/mocker` **精确钉**在 `4.1.12`，不需要也不能单独声明 |
| `follow-redirects` | 1.16.0 | 1.16.2 | `npm update` | `axios@^1.20.0` 声明 `^1.16.0`，区间内可达 |
| `fast-uri` | 3.1.8 | 3.1.9 | `npm update` | `ajv@8.20.0` 声明 `^3.0.1`，区间内可达 |
| `undici` | 7.30.0 / 8.11.2 / 6.29.0 | 7.30.1 / 8.12.3 / 6.29.1 | `npm update` | 三个副本各升一档；各父级声明 `^7.24.4` / `^8.11.2` / `^6.25.0` 均接受 |

**路径与工具约束**：`npm update vite` / `npm update vitest` 会命中 npm 10.9.8 的 arborist 崩溃（`TypeError: Cannot read properties of null (reading 'edgesOut')`，与上文「未解决：metro 家族」同族）——**必须用 `npm install -D <pkg>@<ver>`**，且 `vitest` 与 `@vitest/coverage-v8` 互为**精确 peer**（`peer vitest@4.1.11`），**单升任一包都会触发该崩溃**；可行路径是同时改根与 `packages/core` 的 manifest 到同一版本后一次解析。本次实测 **npm 10.9.8 与 10.9.9 均崩，npm 12.2.1 可解析**（`lockfileVersion` 仍为 3，`npm ci --ignore-scripts` 用 10.9.8 复核通过）。

### 残余 9 条（不修，逐条归因）

`dependencies`（进产物）只有 `buffer` / `electron-updater` / `mp3tag.js` / `music-metadata` 四个；下面 9 条里**只有 `electron` 与移动端 APK 那三条**在产物路径上，其余全是开发期或 Expo 打包期依赖。

1. **`electron`（high）——进产物，唯一在桌面产物路径上的 high。** 安装版 41.10.7；`fixAvailable` = `electron@45.0.0`（`isSemVerMajor: true`）。**41.x 全系无修复**：advisory 上界 `<42.11.16`，而 41.x 最后一个版本是 **41.10.7**（`npm view electron versions` 实测），根本到不了 42.11.16。**不在本票做的理由**：Electron 是打包后的运行时（主进程 + 内嵌 Chromium），41 → 42 属 major，必须走 `release.yml` 的完整打包与安装包冒烟，且需逐个核 `contextIsolation` / preload 桥 / `electron-updater` 在新 Chromium 下的行为——与本票「同 major 内定点修」不同性质。**另开 issue 跟踪**（见 #656 评论的交叉引用）。可利用性：8 条 advisory 里 7 条是 low/moderate，唯一 high 是「compromised eMudhra intermediate certificates」的证书缓解（`<42.11.16`），对本仓（不加载外部证书链、不跑不可信内容）风险有限但**不归零**。
2. **`node-forge`（high）——上游无干净版本，与 #636 同类的「真·无解」。** registry `latest` = **1.4.0**，advisory `GHSA-86w9-cpqp-85rv` 区间 `introduced: 0` → **`last_affected: 1.4.0`**（OSV 实测，未撤回）。`npm view node-forge versions` 比 1.4.0 更高的版本**不存在**，因此 override 无论钉哪一版都逃不掉——这与 braces 那次「两条区间盖满」的机理不同，**这次是单条区间就是开区间且上界 = registry 最新版**，更彻底。路径：`expo → @expo/cli → node-forge`，`@expo/cli` 声明 `^1.3.3`。可达性：RSA PKCS#1 v1.5 **签名验证**接受多余嵌套 `DigestAlgorithm`，本仓不调用 `node-forge` 做签名验证（它是 `@expo/cli` 做代码签名证书链的依赖，只在移动端构建期跑），运行时不可达。解除条件：node-forge 发 > 1.4.0。
3. **`zod`（high）——上游有干净版但被声明区间挡住，且盲顶有风险。** 装 3.25.76；advisory `GHSA-mrhx-c7xc-m3w5` 区间 `introduced: 0` → **`fixed: 4.6.6`**（OSV 实测）。`npm view zod version` = 4.6.7，即**干净版本存在**。挡路的是声明：`@expo/cli@57.0.31` 写 `zod: ^3.25.76`（**3.x**），`eslint-plugin-react-hooks@7.1.1` 写 `^3.25.0 || ^4.0.0`（跨 major 兼容）。**override 到 `4.6.7` 实测可把 16 → 8**，但 `@expo/cli` 是 Expo 打包/开发服务器入口，zod 3 → 4 有已知 breaking（schema API 变动），**盲顶属于「用打包期崩溃换一条 high」**，不是定点修。处置：记残余，**须先有人验一遍 `npx expo` 全链路（`expo start` / `expo export` / 原生构建）在 zod 4 下可用**，才轮得到 override。
4. **`expo` / `@expo/cli` / `@expo/code-signing-certificates`（high ×3）——纯传递，无独立 sink。** 三者的 `via` 分别指向 `@expo/cli`、`node-forge` / `zod` / `@expo/code-signing-certificates`、`node-forge`，**自身没有独立 advisory**。也就是说它们只是第 2、3 条在依赖树上的投影，随 `node-forge` 发版或 `zod` 解禁自动消解。`npm audit fix --force` 建议的 `expo@44.0.6` 是**降级到 SDK 44**（当前 SDK 57），直接违背本 ADR 决策 1，不可采。
5. **`expo-router` / `query-string` / `decode-uri-component`（moderate ×3）——进 APK，但修复版需要 SDK 58。** `decode-uri-component` 装 0.2.2；`GHSA-vcc3-ghjq-m6fr` 区间 `<=0.4.2`。**干净版本存在**：OSV 实测 `0.5.0` / `0.5.1` 返回空（`0.2.2` 与 `0.4.2` 均命中）。挡路的是 `query-string@7.1.3` 声明 `decode-uri-component: ^0.2.2`——`^0.2.2` 在 **0.x 语义下只允许 `<0.3.0`**，`0.5.1` 出界。**实测两种 override 写法（根平铺 `overrides.decode-uri-component` 与嵌套 `overrides['query-string'].decode-uri-component`）均静默不生效**——`npm install` 后 lock 里仍是 0.2.2，且 npm 不报错。而 `expo-router` 的修复版 `58.0.26` 属 **SDK 58**，跨 SDK 大版本，按决策 1 不在本票做。可达性：exponential decoding of malformed percent-encoded input，需要攻击者控制被 `decode-uri-component` 解码的输入且重复触发；本仓 mobile 端 `expo-router` 的 query string 来自应用自身路由跳转，非外部不可信输入。处置：记残余，**随 SDK 58 推进自动消解**。
6. **补充：`braces` 已不在列表里**——见本文开头 2026-10-26 的更新，#636 的残余已由上游撤回 advisory 解除。

### 复核时刻原则（2026-10-26 立，来自 #656 的一次误判）

**残余清单的每条结论都对应一个复核时刻；advisory 的 `last_affected` 与 registry `latest` 都不是永久事实，季度或 audit 周报时重跑一次即可自检。**

这次的实例：2026-10-16（#636）我们把 `braces` 归因为「两条 advisory 区间盖满全部已发布版本 → 无任何干净版本可钉」，结论是「等上游发版」。2026-10-26（#656）复核发现其中一条 `GHSA-vfj7-8cjw-p6xm` **已于 2026-10-23 被上游撤回**（`withdrawnAt` 置位），`braces@3.0.3` 在 OSV 上返回空，整棵依赖树自动消失——**解除条件以「撤回一条」而非「发新版」的方式达成了**。

所以：

- 写归因时**必须带复核时刻**（「截至某日，OSV 实测如下」），不要写成永久结论；`npm view <pkg> version` 同理。
- 残余清单的定期自检成本很低：`npm audit --json` + 对残余包逐个 `POST https://api.osv.dev/v1/query`，一次跑完不用改任何代码。**若某条的 OSV 返回空，直接删条目并说明解除原因**，不要让已消解的条目在清单里挂着误导下一个人去试 override。
- 「等上游发版」不是唯一解除路径：上游**撤回 advisory** 同样生效，且这条路径不会在 npm 侧产生任何版本变动信号，只能靠主动复核发现。
