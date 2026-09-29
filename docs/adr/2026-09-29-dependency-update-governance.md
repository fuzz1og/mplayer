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
- 未解决：`expo-check` 是否设为 master 的必需检查，留到合并后（必需检查引用的 job 必须先在 master 存在）。
