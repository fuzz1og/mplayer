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
- **必做后续（合并之后）**：给 master 的 ruleset `protect-master` 加 required status checks（`check` + 四个 `test` 分片）。顺序不可颠倒：job 必须先存在于 master。
- **未解决、留给后续**：`release.yml` 的 `workflow_dispatch` 通道保留未动——dispatch-with-version 会在 publish 阶段推 tag，从而再触发一次 tag-push 构建（同版本构建 2 次）。这是独立的流水线设计问题，需先确认手工出包的使用场景。
- 本决策不碰 `docs/research/`、`docs/specs/` 下的日期存档；那里「CI 会跑 X」若与现状不符，属历史快照，不回改。
