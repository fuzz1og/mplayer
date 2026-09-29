# 自动化依赖升级策略调研（Renovate vs Dependabot，一手来源）

> 调研日期：2026-09-29 · 类型：调研 · 关联：[fuzz1og/mplayer#478](https://github.com/fuzz1og/mplayer/issues/478)（`react-native 0.86.2 → 0.87.1` 随未经审查的分组批量 PR 进入 master，Android 发版构建被打破）、[fuzz1og/mplayer#446](https://github.com/fuzz1og/mplayer/issues/446)、本仓 `.github/dependabot.yml`、`packages/mobile/package.json`
> 依据：**仅一手来源** —— 官方文档源文件（`renovatebot/renovate@main` 的 `docs/**`、`github/docs@main` 的 `content/**` + `data/reusables/**`、`expo/expo@main` 的 `docs/**`）、官方源码（`expo/expo@main` 的 `packages/@expo/cli/src/install/*`）、规范原文（`semver/semver@master` 的 `semver.md`）、官方 API（`api.expo.dev`）。所有链接于 2026-09-29 逐个校验返回 HTTP 200（见 §11）。
> 全文引用为**逐字短引文**（英文原文）；`[sic]` 标注原文笔误。**官方沉默处与有争议处在 §9 明确标注，不编造共识。**

## 0. 结论先行

1. **两个机器人纸面能力都能做到「分层分组 + 冷却 + 排除耦合包」，但「一个 dashboard issue 取代 PR 洪水」只有 Renovate 有。** Renovate 官方对照页直接写 `Dependabot does not have a similar feature.`（[bot-comparison](https://docs.renovatebot.com/bot-comparison/#dependency-dashboard)）。
2. **automerge 是两边差异最大的一处**：Renovate 有原生 `automerge`/`automergeType`/`platformAutomerge`，且**默认在看到通过的 status check 之前不合**；Dependabot 在 `dependabot.yml` 里**根本没有 automerge 配置项**，官方只给「GitHub Actions + `dependabot/fetch-metadata` + `gh pr merge --auto`」的配方（[automate-dependabot-with-actions](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions#enabling-automerge-on-a-pull-request)）。
3. **「major 绝不 automerge」这句明文，只有 Renovate 官方有**（措辞是「多数人会把 major 留给人工先看」）；**GitHub 官方文档没有这句**，它只给了一个「只 automerge 指定依赖的 patch」的示例。Renovate 另有一条默认行为兜底：`separateMajorMinor` 默认 `true`，**major 永远单独出 PR，连分组也压不过它**。
4. **0.x 陷阱有官方明文**：semver 规范 §4「Major version zero (0.y.z) … Anything MAY change at any time.」；Renovate 明确警告 `Packages that follow SemVer are allowed to make breaking changes in any 0.x version, even patch and minor.`，并要求 automerge 规则排除 pre-1.0；**GitHub/Dependabot 文档对 0.x 完全沉默**，它只说 `Dependabot assumes that versions in this form are always major.minor.patch.` —— 即按 `x.y.z` 字面位置分类，`0.86.2 → 0.87.1` 就是 `minor`。本仓事故正卡在这一刻。
5. **Expo 官方机制确认**：`npx expo install` 会「挑与项目兼容的版本」，官方要求「**Upgrade all dependencies to match the installed SDK version**」，升级流程是 `npx expo install --fix` + `npx expo-doctor`。**`npx expo install --check` 在版本不匹配时确实以非零码退出**（文档明文 + `checkPackages.ts` 源码 `Log.exit(..., 1)` 双证），可直接做 CI 门禁。
6. **Expo 的 SDK→RN 版本表可从官方 API 取**：`api.expo.dev/v2/versions/latest` 里 `sdkVersions["57.0.0"].facebookReactNativeVersion = "0.86.3"`。`0.87.1` 不在 SDK 57 的期望版本内 —— 这不是猜测，是 Expo 官方接口的数据。
7. **发布后延迟采纳（cooldown）在官方文档里的理由并不一样**：Dependabot 写的是「给新版本时间**稳定**」（stabilize）；Renovate 才明写「降低**供应链风险**、让安全研究者与自动化工具抓出恶意包」，并要求时间戳来自 registry（防发布者自报时间）。**引用时不要把「防投毒」当成 GitHub 文档的原文。**
8. **本仓已出现的配置方向（`groups` + `cooldown` + `ignore`）恰好就是 GitHub 官方推荐的三个旋钮**，但官方推荐的分组粒度是「development 依赖的 minor/patch」这类低风险层；把 production 的 0.x minor 混进任何分组，属于「工具允许、官方未背书、且被 Renovate 明文警告过」的用法。

---

## 1. Renovate vs Dependabot：官方各自支持什么

### 1.1 逐项对照（每格都有官方出处）

| 能力 | Renovate | Dependabot |
|---|---|---|
| 分组 | `packageRules` + `groupName`（自由文本，同名同 PR）：`All updates sharing the same groupName will be placed into the same branch/PR.`（[`groupName`](https://docs.renovatebot.com/configuration-options/#groupname)）；另有现成的社区/官方 presets 分组（[config presets](https://docs.renovatebot.com/config-presets/)） | `groups`：`Define rules to create one or more sets of dependencies managed by a package manager, to group updates into fewer, targeted pull requests.`（[`groups`](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#groups--)） |
| 分组可用维度 | `matchUpdateTypes` / `matchDepTypes` / `matchPackageNames` / `matchDatasources` / `matchCurrentVersion` / `matchIsBreaking` / `matchConfidence` / `matchCurrentAge` …（[`packageRules`](https://docs.renovatebot.com/configuration-options/#packagerules) 下的 match 系列） | `applies-to`（version/security）、`dependency-type`（development/production）、`patterns`/`exclude-patterns`、`update-types`（minor/patch/major）、`group-by`（跨目录按依赖名） |
| **单个 dashboard issue 取代大量 PR** | **有** `dependencyDashboard`（`config:recommended` 默认开启）：`Configuring dependencyDashboard to true will lead to the creation of a "Dependency Dashboard" issue within the repository. This issue has a list of all PRs pending, open, closed (unmerged) or in error.`（[`dependencyDashboard`](https://docs.renovatebot.com/configuration-options/#dependencydashboard)、[Key concepts: Dependency Dashboard](https://docs.renovatebot.com/key-concepts/dashboard/)） | **无**。Renovate 对照页：`Dependabot does not have a similar feature.`（[bot-comparison](https://docs.renovatebot.com/bot-comparison/#dependency-dashboard)）。Dependabot 最接近的是仓库 Insights→Dependency graph 的 Dependabot 面板（[version updates 文档](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates)），它不是 issue、没有可勾选审批 |
| dashboard 审批工作流（先批后建 PR） | **有** `dependencyDashboardApproval`：`you can tell Renovate to wait for your approval from the Dependency Dashboard before creating a branch/PR.`（[`dependencyDashboardApproval`](https://docs.renovatebot.com/configuration-options/#dependencydashboardapproval)）；`prCreation: "approval"` 同类 | **无**（无审批型 dashboard） |
| 发布后稳定期 | `minimumReleaseAge`（可配 `minimumReleaseAgeBehaviour`、`minimumReleaseAgeBuffer`、`internalChecksFilter`），并加 `renovate/stability-days` 状态检查（[`minimumReleaseAge`](https://docs.renovatebot.com/configuration-options/#minimumreleaseage)、[Minimum Release Age](https://docs.renovatebot.com/key-concepts/minimum-release-age/)） | `cooldown`（`default-days` / `semver-major-days` / `semver-minor-days` / `semver-patch-days`，天数 1~90），未配置时**默认也冷却 3 天**（[`cooldown`](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#cooldown-)） |
| automerge | **原生**：`automerge` + `automergeType`（`pr`/`branch`）+ `automergeStrategy` + `platformAutomerge`（默认 `true`）；[`automerge`](https://docs.renovatebot.com/configuration-options/#automerge)、[`platformAutomerge`](https://docs.renovatebot.com/configuration-options/#platformautomerge)、[Key concepts: Automerge](https://docs.renovatebot.com/key-concepts/automerge/) | **无配置项**。只有「平台 auto-merge + Actions 配方」：`You can instead use GitHub Actions and the GitHub CLI.`（[automate-dependabot-with-actions](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions#enabling-automerge-on-a-pull-request)） |
| pin / range 策略 | `rangeStrategy`：`pin` / `bump` / `replace` / `widen` / `update-lockfile` / `in-range-only` / `auto`（[`rangeStrategy`](https://docs.renovatebot.com/configuration-options/#rangestrategy)）；另有 `pinDigests`：`If enabled Renovate will pin Docker images or GitHub Actions by means of their SHA256 digest and not only by tag so that they are immutable.`（[`pinDigests`](https://docs.renovatebot.com/configuration-options/#pindigests)） | `versioning-strategy`：`auto` / `increase` / `increase-if-necessary` / `lockfile-only` / `widen`，只支持部分生态（[`versioning-strategy`](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#versioning-strategy-)）；**没有** digest/SHA 钉版选项 |
| 安全更新 | `vulnerabilityAlerts`（读 GitHub 告警，需开 dependency graph + Dependabot alerts；[`vulnerabilityAlerts`](https://docs.renovatebot.com/configuration-options/#vulnerabilityalerts)）+ `osvVulnerabilityAlerts`（内置 OSV 离线库，[`osvVulnerabilityAlerts`](https://docs.renovatebot.com/configuration-options/#osvvulnerabilityalerts)） | **平台原生**：Dependabot alerts → security updates，与 version updates 是两条独立通道（[security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates)、[version updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates)） |
| 内置程度 / 平台 | 需装 App 或自托管（对照表 `Built-in to GitHub: No, requires app or self-hosting`，[bot-comparison](https://docs.renovatebot.com/bot-comparison/)） | GitHub 原生，另仅支持 Azure DevOps |

### 1.2 只有 Renovate 有的（Dependabot 无对应配置项）

- **Dependency Dashboard（单个 issue）+ 勾选式审批**（`dependencyDashboard` / `dependencyDashboardApproval` / `prCreation: "approval"`）。
- **`minimumReleaseAge` 全家桶**：`minimumReleaseAgeBehaviour`（时间戳必需/可选）、`minimumReleaseAgeBuffer`（默认 30 分钟，解决配套包晚发）、`internalChecksFilter: strict`（未过冷却的版本直接不进 PR）。Dependabot 的 `cooldown` 语义是「跳过这个版本」，没有 pending 状态检查，也不能和 automerge 联动。
- **原生 automerge 与 `platformAutomerge`**（含 GitHub merge queue / GitLab merge train 集成）。
- **`rangeStrategy` + `pinDigests`**（含 Actions SHA 钉版）。
- **`separateMajorMinor`（默认 `true`）/ `separateMinorPatch` / `separateMultipleMajor`** —— major 永远独立 PR 的默认行为。
- **`matchIsBreaking`**（按「是否破坏性」匹配，而非只看 `x` 位）、`matchCurrentAge`、`matchConfidence`（merge confidence）、`matchCategories`。
- **presets 生态**（`config:recommended`、`config:best-practices`、`security:minimumReleaseAgeNpm`、`group:monorepos`、`abandonments:recommended` 等）与自定义 regex manager。
- **`osvVulnerabilityAlerts` 的恶意包拦截**：`If Renovate detects a malicious dependency using data from OSV, it will surface this in log warnings, and prevent PRs from being created.`（[`osvVulnerabilityAlerts`](https://docs.renovatebot.com/configuration-options/#osvvulnerabilityalerts)）。

### 1.3 只有 Dependabot 有的

- **平台原生、无需安装**：GitHub 内置，配置只在 `.github/dependabot.yml`（[about the dependabot.yml file](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file)）。
- **`open-pull-requests-limit`**（默认 5；**安全更新 PR 不受此限、也不占额度**；设为 `0` 可临时停用某生态的版本更新）。
- **`multi-ecosystem-groups`**（跨生态分组）与 `group-by: dependency-name`（跨目录同类依赖合成一个 PR）。
- **PR 评论命令** `@dependabot rebase|merge|ignore|unignore`（[comment commands](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands)）。
- **`schedule` 的 `day`/`time`/`timezone`**（可钉到具体时区与时刻）。
- **`directory`/`directories` 多目录声明、`vendor`、`insecure-external-code-execution`、`enable-beta-ecosystems`**。
- **兼容性评分（compatibility score）**：`Dependabot security updates may include compatibility scores to let you know whether updating a dependency could cause breaking changes to your project.`（[security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates)）。

### 1.4 名字像但不是一回事（引用时别混）

- `cooldown`（Dependabot，推迟「提出更新」）≠ `minimumReleaseAge`（Renovate，推迟「建议更新」**并**在 PR 上挂 pending 状态，可与 automerge 串起来）。
- `versioning-strategy`（Dependabot，改 manifest 写法，5 个值）≠ `rangeStrategy`（Renovate，7 个值，且 npm 的 `auto` 有明确的四条行为规则）。
- `groups`（Dependabot）≠ `groupName`（Renovate）：前者是声明式规则集，后者是「同名字符串即同 PR」的自由标签。
- Renovate 对照页 `bot-comparison` 是 **Renovate 官方自述的对比**（其自述 `We are trying to be as objective as possible`），引用请与 GitHub 官方文档交叉核对；本节的每个结论都已用两边各自的官方文档复核。

---

## 2. GitHub 官方对 Dependabot version updates 的建议

### 2.1 官方自己列出的两个旋钮

官方「优化 PR 创建」教程开篇列了两条：`Controlling the frequency` 与 `Prioritize meaningful updates` with `groups`（[optimizing-pr-creation-version-updates](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/optimizing-pr-creation-version-updates)）。

### 2.2 分组（groups）

- 默认行为：`Open a single pull request for each dependency that needs to be updated to a newer version for version updates and for security updates.`（[`groups`](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#groups--)）
- 分组后：`All updates for dependencies that match a rule are combined in a single pull request.`；`If a dependency matches more than one rule, it's included in the first group that it matches.`；`Any outdated dependencies that do not match a rule are updated in individual pull requests.`
- 可用维度：`applies-to`（`version-updates`/`security-updates`，不写默认 version）、`dependency-type`（`development`/`production`）、`patterns`/`exclude-patterns`、`update-types`（`minor`/`patch`/`major`）、`group-by`（跨目录按依赖名）。
- ⚠️ **工具允许把 `major` 放进 `update-types` 一起分组**（`Supported values: minor, patch, and major`）—— 本仓事故就是把 0.x 的 minor 混进分组。工具允许 ≠ 官方推荐：官方给的示例落在低风险层，`you can combine updates for minor or patch updates for development dependencies into a single pull request`（同页 Grouping related dependencies together）。
- version 与 security **不能共用同一套分组规则**：`You cannot apply a single grouping set of rules to both version updates and security updates. Instead, if you want to group both version updates and security updates using the same criteria, you must define two, separately named, grouping sets of rules.`（[data/reusables](https://github.com/github/docs/blob/main/data/reusables/dependabot/dependabot-grouped-updates-applies-to.md)）

### 2.3 cooldown（冷却）

官方给的正是「分级冷却」示例（[optimizing](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/optimizing-pr-creation-version-updates#setting-up-a-cooldown-period-for-dependency-updates)）：

```yaml
cooldown:
  default-days: 5
  semver-major-days: 30
  semver-minor-days: 7
  semver-patch-days: 3
  include: ["requests", "numpy", "pandas*", "django"]
  exclude: ["pandas"]
```

- `The number of cooldown days must be between 1 and 90.`（同页）
- `We recommend the use of exclude to **only** exclude **specific dependencies** from cooldown settings.`（同页）
- `The exclude list always take precedence over the include list.`（[`cooldown`](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#cooldown-)）
- 仅作用于版本更新：`The cooldown option is only available for _version_ updates, not _security_ updates.`（同上）
- 默认值：`Apply a default cooldown period of 3 days to version updates, even when cooldown is not configured. A new version is not considered for a version update until 3 days after its release. This default cooldown does not apply to security updates.`（同上）

### 2.4 `open-pull-requests-limit`

- 默认：`If five pull requests with version updates are open, no further pull requests are raised until some of those open requests are merged or closed.`
- 安全更新不受限：`Security update pull requests are not subject to this limit and do not count toward it. There is no limit on the number of open pull requests for security updates.`
- 设为 `0` 可临时停用该生态的版本更新：`You can temporarily disable version updates for a package manager by setting this option to zero`（[`open-pull-requests-limit`](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#open-pull-requests-limit-)）
- 语义提醒：它是**并发上限**，不是策展工具；官方 `configure-version-updates` 把它与「注释掉整个 ecosystem」并列为停用手段。

### 2.5 `ignore` + `update-types`

`ignore` 支持三个字段：`dependency-name`（支持 `*`）、`versions`（按包管理器语法写范围，npm 可写 `^1.0.0`）、`update-types`（`version-update:semver-patch` / `-minor` / `-major`）。`Dependabot checks for all allowed dependencies and then filters out any ignored dependencies or versions.` `If a dependency is matched by an allow and an ignore statement, then it is ignored.`（[`ignore`](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#ignore--)）

### 2.6 version updates 与 security updates 的分工

| 选项 | 作用于 | 出处 |
|---|---|---|
| `cooldown` | 仅 version updates | options ref `cooldown` 头部图标 + 正文 |
| `open-pull-requests-limit` | 仅 version updates | 同上 |
| `allow.update-types` | `update-types only affects _version_ updates, not _security updates_` | options ref `allow.update-types` |
| `ignore` | 两者都作用（`ignoring those dependencies when it opens pull requests for version updates and security updates`） | [controlling-dependencies-updated](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/controlling-dependencies-updated#ignoring-specific-dependencies) |
| `groups` | 两者都能用，但必须各写一套命名规则 | options ref `groups` + 上文 reusable |

版本更新的判定依据是 semver：`Dependabot determines if there is a new version of a dependency by looking at the semantic versioning (semver) of the dependency to decide whether it should update to that version.`（[version updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates)）

### 2.7 官方有没有说「什么情况下不该让机器人升级某个依赖」？

**有，两处，都是「人为判断优先」的口径**：

1. `If you are not ready to adopt changes from certain dependencies in your project, you can configure Dependabot to ignore those dependencies when it opens pull requests for version updates and security updates.`（[controlling-dependencies-updated](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/controlling-dependencies-updated#ignoring-specific-dependencies)）
2. `This is particularly useful if you need to block updates to a library, pending work to support a breaking change to its API, but want to get any security fixes to the version you use.`（[configure-version-updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-version-updates#disabling-dependabot-version-updates)）—— 这句正是「生态耦合包：锁住升级、但保留安全补丁」的官方依据。

另外官方明确建议**把忽略写进配置文件而不是用 PR 评论命令**：`While this is a quick solution, for repositories with more than one contributor it is better to explicitly define the dependencies and versions to ignore in the configuration file. This makes it easy for all contributors to see why a particular dependency isn't being updated automatically.`（[manage-dependabot-prs](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/manage-dependabot-prs)）

**官方也把「AI/自动化代为分析」列为可选项**，但把闸门留给确定性 CI：`while keeping security enforcement and merge gating in deterministic ...`（[automate-dependabot-with-actions](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions)）

---

## 3. automerge 实践：官方怎么说才算安全

### 3.1 Renovate 官方口径

- **默认必须有通过的检查**：`By default, Renovate will not automerge until it sees passing status checks / check runs for the branch.` `If you have no tests but still want Renovate to automerge, you need to add "ignoreTests": true`（[automerge](https://docs.renovatebot.com/key-concepts/automerge/)）。
- **只合「你本来就会点 merge」的东西**：`In general, we recommend you enable automerge for any dependency update where you would select "merge" anyway. Keep automerge _disabled_ for updates where you want to read the changelogs or code before the merge.`（同上）
- **devDependencies 优先**：`Automerge often works well for devDependencies. It can work for production dependencies too, but your project should have good test coverage.`（同上）
- **非 major 才考虑**：`Non-major updates in SemVer ecosystems shouldn't have breaking changes (if they follow the spec), so many users enable automerge for these too`（同上）。
- **必须排除 pre-1.0**：官方示例用 `"matchCurrentVersion": "!/^0/"`，并解释 `The matchCurrentVersion setting above is a rule to exclude any dependencies which are pre-1.0.0 because those can make breaking changes at _any_ time according to the SemVer spec.`（同上）
- **major 留给人工**（最接近明文的一句）：`Usually you won't want to automerge _all_ PRs, for example most people would want to leave major dependency updates to a human to review first.`（[`automerge`](https://docs.renovatebot.com/configuration-options/#automerge)）
- **与 minimumReleaseAge 的配合**：`If you enable automerge _and_ minimumReleaseAge, Renovate … will create PRs immediately, but only automerge them when the minimumReleaseAge time-duration has passed.`（`minimumReleaseAge` 页 L2990 原文重复了一个 Renovate，此处以省略号标注）实现方式是加 pending 检查：`Renovate adds a "renovate/stability-days" pending status check to each branch/PR. This pending check prevents the branch going green to automerge before the time has passed.`（[`minimumReleaseAge`](https://docs.renovatebot.com/configuration-options/#minimumreleaseage)）
- **`platformAutomerge` 是什么**：`If you have enabled automerge and set automergeType=pr in the Renovate config, then leaving platformAutomerge as true speeds up merging via the platform's native automerge functionality.` **但必须开分支保护**：`If you use the default platformAutomerge=true then you should enable your Git hosting platform's capabilities to enforce test passing before PR merge. If you don't do this, the platform might merge Renovate PRs even if the repository's tests haven't started, are in still in progress, or possibly even when they have failed.`（[`platformAutomerge`](https://docs.renovatebot.com/configuration-options/#platformautomerge)）
- **`automergeType=branch` 的代价**：不建 PR、测试过了直接推 base 分支，测试挂了才补 PR（[automerge](https://docs.renovatebot.com/key-concepts/automerge/#branch-vs-pr-automerging)）—— 对本仓「破坏原生构建」的场景风险更高，不建议。

### 3.2 GitHub / Dependabot 官方口径

- **平台 auto-merge 的含义**：`you can use GitHub's automerge functionality. This enables the pull request to be merged when any tests and approvals required by the branch protection rules are successfully met.`（[automate-dependabot-with-actions](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions#enabling-automerge-on-a-pull-request)）
- **官方示例只合 patch、而且限定依赖**：`if: contains(steps.metadata.outputs.dependency-names, ...) && steps.metadata.outputs.update-type == 'version-update:semver-patch'`，然后 `gh pr merge --auto --merge "$PR_URL"`（同上）。
- **官方要求先开必需状态检查**：`If you use status checks to test pull requests, you should enable Require status checks to pass before merging for the target branch for Dependabot pull requests. This branch protection rule ensures that pull requests are not merged unless all the required status checks pass.`（同上）
- **通用前置**：`It's good practice to have automated tests and acceptance processes in place so that checks are carried out before the pull request is merged. This is particularly important if the suggested version to upgrade to contains additional functionality, or a change that breaks your project's code.`（[data/reusables/dependabot/automated-tests-note.md](https://github.com/github/docs/blob/main/data/reusables/dependabot/automated-tests-note.md)）

### 3.3 「major 绝不 automerge」有没有明文？

- **Renovate：有倾向性明文，但不是绝对禁止** ——「多数人会把 major 留给人工先看」（§3.1 的两句），且 `separateMajorMinor` 默认把 major 拆成独立 PR。
- **GitHub：没有**。官方自动合并文档里 `major` 只出现在选项取值与 metadata 说明中（`major, minor, patch` 的 `update-type` 取值）；搜遍官方 Dependabot 文档没有「不要 automerge major」的句子，官方唯一的合并示例过滤条件是 `version-update:semver-patch`。**这是沉默，不是背书**（见 §9）。

---

## 4. 0.x 的 semver 陷阱

### 4.1 规范原文

- §4：`Major version zero (0.y.z) is for initial development. Anything MAY change at any time. The public API SHOULD NOT be considered stable.`（[semver.org 规范](https://semver.org/#spec-item-4)，源文件 `semver.md` L70-71）
- 规范 FAQ：`Major version zero is all about rapid development.`（[semver.org FAQ](https://semver.org/#how-should-i-deal-with-revisions-in-the-0yz-initial-development-phase)）

结论：**`0.86.2 → 0.87.1` 在「第几位变化」意义上是 minor，在「是否破坏」意义上完全没有保证。**

### 4.2 Renovate 怎么分类，以及它自己的警告

- 分类规则（`matchIsBreaking`）：`What counts as breaking depends on the versioning of the dependency: Versionings with their own notion of breaking changes decide themselves, for example Cargo treats a minor bump of a 0.x crate (0.1.0 to 0.2.0) as breaking; For all other versionings, an update is breaking if its updateType is major`（[`matchIsBreaking`](https://docs.renovatebot.com/configuration-options/#matchisbreaking)）。即 npm 语义下 `0.86.2 → 0.87.1` 的 `updateType` 是 **minor，且 Renovate 不算它 breaking**。
- 官方警告（管理员视角，正是本仓事故）：`Packages that follow SemVer are allowed to make breaking changes in _any_ 0.x version, even patch and minor. Check if you're using any 0.x package, and see if you need custom packageRules for it. When setting up automerge for dependencies, make sure to stop accidental automerges of 0.x versions.`（[`matchUpdateTypes`](https://docs.renovatebot.com/configuration-options/#matchupdatetypes)）
- 官方给的排除写法：`"matchCurrentVersion": "!/^0/"`（[automerge 示例](https://docs.renovatebot.com/key-concepts/automerge/#automerge-non-major-updates)）。

### 4.3 Dependabot 怎么分类，以及它的沉默

- **按字面 x.y.z 分位**：`Dependabot assumes that versions in this form are always major.minor.patch.`（[options ref `groups.update-types`](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#update-types-groups)；同一句在 `ignore.update-types`/`allow.update-types` 重复出现）。于是 `0.86.2 → 0.87.1` = `version-update:semver-minor`，可以名正言顺进任何 `update-types: [minor]` 的分组。
- **没有 0.x 概念**：官方 Dependabot 文档中不存在 pre-1.0 / 0.x / major-version-zero 的任何说明或建议（本调研对 `github/docs` 全量 Dependabot 文档 grep 过 `0.x` / `pre-1.0` / `major version zero`，零命中）。**要按 0.x 分层，只能用 `patterns` + `ignore` 手写包名清单。**

### 4.4 本仓事故的精确对应

`react-native 0.86.2 → 0.87.1`：semver 位次 = minor（两个机器人同判）；实际 = 破坏性（semver §4 允许）；且不在 Expo SDK 57 的期望版本内（§5.4）。**三个条件同时成立时，任何「minor 自动合并 / minor 进分组」的策略都会失守。**

---

## 5. 生态耦合的依赖集（Expo / React Native）

### 5.1 `npx expo install` 是不是官方机制？是，而且是官方指定入口

- `The npx expo install command picks a library version compatible with your project and then uses your JavaScript package manager (such as npm) to install it.`（[Using libraries](https://docs.expo.dev/workflow/using-libraries/)）
- `We recommend always using npx expo install instead of npm install or yarn add directly because it allows Expo CLI to pick a compatible version of a library when possible and also warn you about known incompatibilities.`（同上）
- 官方要求**对齐 SDK 而不是取最新**：`Upgrade all dependencies to match the installed SDK version. Then run expo-doctor command to check for common problems.`（[Upgrade Expo SDK](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)，源文件 L50）
- 官方升级动作：`npx expo install --fix` 然后 `npx expo-doctor`（同页 L53）。

### 5.2 `--check` / `--fix` / `expo-doctor` 的官方定义

- `--check`: `Check which installed packages need to be updated.`；`--fix`: `Automatically update any invalid package versions.`（[Expo CLI：install](https://docs.expo.dev/more/expo-cli/#install)）
- `npx expo-doctor` 用法（含 `npx expo-doctor --help`）（[Expo tools / expo-doctor](https://docs.expo.dev/develop/tools/#expo-doctor)）；官方工具表还把它列为「安装新库 / 校验并更新已有库」的入口（同页）。
- 排除机制：`expo.install.exclude`（写在 `package.json`）可让指定包不参与 `npx expo install`、`npx expo-doctor`、`npx expo start` 的版本检查（[using-libraries](https://docs.expo.dev/workflow/using-libraries/#excluding-a-third-party-library-from-version-checks)、[package.json config](https://docs.expo.dev/versions/latest/config/package-json/#installexclude)）。

### 5.3 `expo install --check` 在版本不匹配时是否非零退出？**是，双证**

官方文档：`npx expo install --check prompts you about packages that are installed incorrectly. It also prompts about installing these packages to their compatible versions locally. It exits with non-zero in Continuous Integration (CI). This means you can use this to do continuous immutable validation.`（[Expo CLI：install](https://docs.expo.dev/more/expo-cli/#install)）

官方环境变量表：`CI | boolean | When enabled, the CLI will disable interactive functionality, skip optional prompts, and fail on non-optional prompts. Example: CI=1 npx expo install --check will fail if any installed packages are outdated.`（[Expo CLI：environment variables](https://docs.expo.dev/more/expo-cli/#environment-variables)）

源码双证（`expo/expo@main`，`packages/@expo/cli/src/install/checkPackages.ts`）：

- 全部匹配：`if (!dependencies.length) { … Log.exit(chalk.greenBright('Dependencies are up to date'), 0); }`（L68-75）
- 有不匹配：`// Exit with non-zero exit code if any of the dependencies are out of date.` + `Log.exit(chalk.red('Found outdated dependencies'), 1);`（L102-103）
- `--check --json`（CI 友好）：`JSON.stringify({ dependencies, upToDate: false }, null, 2)` 后 `// Exit with non-zero exit code to indicate outdated dependencies` + `process.exit(1);`（L77-81）

⇒ **可以直接做 CI 门禁**：`CI=1 npx expo install --check`；要结构化输出用 `npx expo install --check --json`（`--json` 只能与 `--check` 同用，见 `install/resolveOptions.ts` L26-28）。注意它校验的是「包版本是否对齐 SDK」，不编译原生，正好卡住 `0.86.2 → 0.87.1` 这类越界升级。

### 5.4 Expo 官方给出的 SDK 57 → React Native 期望版本

官方 API `https://api.expo.dev/v2/versions/latest` 的 `sdkVersions["57.0.0"]` 字段（2026-09-29 实测）：`facebookReactNativeVersion: "0.86.3"`、`facebookReactVersion: "19.2.3"`、`expoVersion: "~57.0.26"`、`metro: "^0.84.4"`、`babel-preset-expo: "~57.0.0"`。

文档侧交叉引用：`You can also view the React Native version that corresponds to your Expo SDK version`（[using-libraries](https://docs.expo.dev/workflow/using-libraries/)，指向 [versions/latest](https://docs.expo.dev/versions/latest/)）。

⇒ 本仓 `packages/mobile/package.json` 里的 `react-native: 0.87.1` **不等于** SDK 57 期望的 `0.86.3`；而同一份 package.json 里 `expo-*` 全是 `~57.x`。这就是「生态耦合集」的定义：**RN 与 expo-* 必须整体对齐 SDK，不能各自按 semver 漂移。**

---

## 6. 供应链实践：发布后延迟采纳（cooldown / minimumReleaseAge）

### 6.1 Renovate：明确写「降低供应链风险」

- 目的：`The use of minimumReleaseAge is not to slow down fast releasing project updates, but to provide a means to reduce risk supply chain security risks.` [sic]（[Minimum Release Age](https://docs.renovatebot.com/key-concepts/minimum-release-age/)）
- 理由（防投毒）：`For example, minimumReleaseAge=14 days would ensure that a package update is not suggested by Renovate until 14 days after its release, which allows plenty of time to allow security researchers and automated security tools to catch malicious intent in packages.`（同上）
- 时间戳必须来自 registry：`To prevent supply-chain attacks, Renovate requires that the registry/datasource provides the timestamp. This ensures that a package maintainer cannot specify (maliciously or accidentally) a different timestamp to when the package was actually published.`（同上）
- npm 额外防护：`When minimumReleaseAge is configured, Renovate passes --before=<date> to npm commands during lock file generation. This ensures that npm only resolves package versions that were available before the cooldown threshold, protecting against newly published (and potentially malicious) transitive dependencies.`（同上）
- 与包管理器双配置：`We recommend specifying minimum release age in both your Renovate and package manager configuration.`（同上）
- 安全更新不受冷却阻挡：`Security updates bypass any minimumReleaseAge checks, and so will be raised as soon as Renovate detects them.`（同上）

### 6.2 Dependabot：官方写的是「给新版本时间稳定」

- `By default, Dependabot applies a cooldown period of 3 days to version updates, so a new version is not considered for a version update until 3 days after its release. This default cooldown does not apply to security updates.`（[data/reusables/dependabot/default-cooldown-period.md](https://github.com/github/docs/blob/main/data/reusables/dependabot/default-cooldown-period.md)）
- `This gives new releases time to stabilize before you receive a pull request.`（[version updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates)）
- 官方 Dependabot 文档里与「被攻陷的包」相关的措辞只出现在 `insecure-external-code-execution`（`could allow a compromised package to steal credentials`），**不是** cooldown 的理由。⇒ 把「cooldown 是为了防投毒」说成 GitHub 官方口径并不准确；那是 Renovate 文档的明文（见 §9）。

---

## 7. 官方明文表态（逐字引用汇总）

### 7.1 「不要让机器人批量合 major / major 单独一个 PR」

| # | 原文 | 来源 |
|---|---|---|
| 1 | `Usually you won't want to automerge _all_ PRs, for example most people would want to leave major dependency updates to a human to review first.` | [Renovate `automerge`](https://docs.renovatebot.com/configuration-options/#automerge) |
| 2 | `Renovate's default behavior is to create a separate branch/PR if both minor and major version updates exist` … `It is recommended that you leave this option to `true`, because of the polite way that Renovate handles this.` | [Renovate `separateMajorMinor`](https://docs.renovatebot.com/configuration-options/#separatemajorminor) |
| 3 | `This option also has priority over package groups configured by packageRule. So Renovate will propose separate PRs for major and minor updates of packages even if they are grouped. If you want to enforce grouped package updates, you need to set this option to false within the packageRule.` | 同上 |
| 4 | `Major updates often have breaking changes which require manual changes in your code before they can be merged. So maybe you only want to get major updates when you have sufficient time to check them carefully.` | [Renovate Dependency Dashboard](https://docs.renovatebot.com/key-concepts/dashboard/#require-approval-for-major-updates) |
| 5 | `Dependency Dashboard Approval is far superior to disabling major updates because at least you can fully see what's pending on the dashboard, instead of updates being totally invisible.` | 同上 |

### 7.2 「生产依赖不要无脑自动合；minor 要能逐条看」

| # | 原文 | 来源 |
|---|---|---|
| 6 | `In general, we recommend you enable automerge for any dependency update where you would select "merge" anyway. Keep automerge _disabled_ for updates where you want to read the changelogs or code before the merge.` | [Renovate automerge](https://docs.renovatebot.com/key-concepts/automerge/) |
| 7 | `Automerge often works well for devDependencies. It can work for production dependencies too, but your project should have good test coverage.` | 同上 |
| 8 | `You check that your tests pass, review the changelog and release notes included in the pull request summary, and then merge it.` | [GitHub version updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates) |
| 9 | `It's good practice to have automated tests and acceptance processes in place so that checks are carried out before the pull request is merged.` | [GitHub reusable](https://github.com/github/docs/blob/main/data/reusables/dependabot/automated-tests-note.md) |
| 10 | `you can combine updates for minor or patch updates for development dependencies into a single pull request`（官方给出的**唯一**分组示例，落在 development 层） | [optimizing PR creation](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/optimizing-pr-creation-version-updates) |

### 7.3 「0.x 随时可能破坏」

| # | 原文 | 来源 |
|---|---|---|
| 11 | `Major version zero (0.y.z) is for initial development. Anything MAY change at any time. The public API SHOULD NOT be considered stable.` | [semver.org §4](https://semver.org/#spec-item-4) |
| 12 | `Packages that follow SemVer are allowed to make breaking changes in _any_ 0.x version, even patch and minor. Check if you're using any 0.x package, and see if you need custom packageRules for it. When setting up automerge for dependencies, make sure to stop accidental automerges of 0.x versions.` | [Renovate `matchUpdateTypes`](https://docs.renovatebot.com/configuration-options/#matchupdatetypes) |
| 13 | `The matchCurrentVersion setting above is a rule to exclude any dependencies which are pre-1.0.0 because those can make breaking changes at _any_ time according to the SemVer spec.` | [Renovate automerge](https://docs.renovatebot.com/key-concepts/automerge/#automerge-non-major-updates) |
| 14 | `If you are not ready to adopt changes from certain dependencies in your project, you can configure Dependabot to ignore those dependencies…` | [GitHub controlling dependencies](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/controlling-dependencies-updated) |

---

## 8. 可直接用的配置配方

### 8.0 先说一个来源约束：Renovate **不吃 YAML**

任务要求给 YAML 片段，但 Renovate 官方只支持 JSON/JSONC/JSON5 形态的仓库配置文件：`Renovate supports JSONC for .json files and any config files without file extension (e.g. .renovaterc). We also recommend you prefer using a .jsonc file if you want to add comments to your configuration, instead of a .json5 file.`（[`fileNames`/配置说明](https://docs.renovatebot.com/configuration-options/)）与 `Alternative file names are supported, but the default is renovate.json.`（[config-overview](https://docs.renovatebot.com/config-overview/)）。**没有来源支持「Renovate 的 YAML 配置」，所以这里给 `renovate.jsonc`；Dependabot 侧才给 YAML。** 这是刻意的取舍，不编造格式。

### 8.1 Renovate 配方（`renovate.jsonc`）

覆盖四件事：按风险分层分组、`minimumReleaseAge`、排除生态耦合包、automerge 规则。每条规则都能在 §1/§3/§4/§6 找到出处。

```jsonc
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  // config:recommended 默认带 dependencyDashboard；security:minimumReleaseAgeNpm 是官方安全 presets
  "extends": ["config:recommended", "security:minimumReleaseAgeNpm"],
  "timezone": "Asia/Shanghai",

  // —— 可见性：单个 dashboard issue，取代 PR 洪水（Dependabot 无此能力）——
  "dependencyDashboard": true,

  // —— 发布后稳定期（供应链）：未过期的版本连 PR 都不建，靠 dashboard 看被压住的更新 ——
  "minimumReleaseAge": "5 days",
  "minimumReleaseAgeBehaviour": "timestamp-required",
  "internalChecksFilter": "strict",
  // 仅在 PR 的状态检查结束后才建 PR；因为本仓 CI 只在 pull_request 上跑，需同时打开 internalChecksAsSuccess
  "prCreation": "not-pending",
  "internalChecksAsSuccess": true,

  // —— 默认把 major 拆成独立 PR（Renovate 默认即 true，这里显式化）——
  "separateMajorMinor": true,

  "packageRules": [
    {
      // 生态耦合集：Expo / RN 及随 SDK 对齐的包。不自动提 PR，只在 dashboard 勾选后才建，
      // 且强制更长冷却；升级动作固定走 `npx expo install --fix` + `npx expo-doctor`
      "description": "Ecosystem-coupled set (Expo/React Native): dashboard approval only",
      "matchPackageNames": [
        "expo", "expo-*",
        "react-native", "react-native-*", "react-native-web",
        "@react-native-community/*", "@react-native-async-storage/async-storage",
        "react", "react-dom", "@types/react"
      ],
      "dependencyDashboardApproval": true,
      "minimumReleaseAge": "14 days",
      "automerge": false
    },
    {
      // 0.x 一律不 automerge（官方示例用 matchCurrentVersion "!/^0/" 把 pre-1.0 排除在 automerge 之外；
      // 这里用等价的 /regex/ 写法直指 0.x —— 0.x 的 minor 同样可能破坏）
      "description": "Never automerge pre-1.0 (0.x)",
      "matchCurrentVersion": "/^0\\./",
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": false
    },
    {
      // major：单独 PR + 先审批（对应官方「leave major updates to a human」）
      "description": "Major: separate PR, approval required",
      "matchUpdateTypes": ["major"],
      "dependencyDashboardApproval": true,
      "automerge": false
    },
    {
      // 生产依赖：按风险分层分组，只把 patch 合成一个 PR，且不自动合
      "description": "Production patch group (review required)",
      "matchDepTypes": ["dependencies"],
      "matchUpdateTypes": ["patch"],
      "groupName": "production patch",
      "automerge": false
    },
    {
      // 开发依赖：patch 才 automerge（官方推荐范围；Renovate 默认要求 status check 通过）
      "description": "Dev patch: group + automerge",
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["patch"],
      "groupName": "dev patch",
      "automerge": true
    },
    {
      "description": "Dev minor: group, review required",
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["minor"],
      "groupName": "dev minor",
      "automerge": false
    }
  ],

  // 安全修复 PR：跳过冷却与排队（官方：vulnerability alerts skip the line），但仍不自动合
  "vulnerabilityAlerts": {
    "labels": ["security"]
  }
}
```

要点与出处：`internalChecksFilter: "strict"` + `dependencyDashboard` 是官方推荐组合（[`internalChecksFilter`](https://docs.renovatebot.com/configuration-options/#internalchecksfilter)）；`prCreation: "not-pending"` 在「CI 只跑 pull_request」时有停滞风险，官方要求补 `internalChecksAsSuccess=true`（[`prCreation`](https://docs.renovatebot.com/configuration-options/#prcreation)）；`automerge` 默认仍要求 status check 通过（[automerge](https://docs.renovatebot.com/key-concepts/automerge/)）；`dependencyDashboardApproval` 可在 packageRule 内按包、按 major 级别使用（[`dependencyDashboardApproval`](https://docs.renovatebot.com/configuration-options/#dependencydashboardapproval)）。

### 8.2 Dependabot 配方（`.github/dependabot.yml`）

覆盖同样四件事，但**automerge 不写在 YAML 里**（Dependabot 无此配置项），而是交给 §8.3 的 Actions + 分支保护。

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: tuesday
      time: "09:00"
      timezone: Asia/Shanghai
    # 并发上限只是安全阀：安全更新不受它限制，设为 0 才是停用
    open-pull-requests-limit: 20
    # 分级冷却：major 30 天 / minor 7 天 / patch 3 天（天数必须 1~90）
    cooldown:
      default-days: 5
      semver-major-days: 30
      semver-minor-days: 7
      semver-patch-days: 3
    # 按风险分层分组：production 只合 patch；development 才合 minor+patch
    # （major 永不出现在 groups 里：官方示例只合低风险层，且 Renovate 侧有明文反对）
    groups:
      prod-patch:
        applies-to: version-updates
        dependency-type: production
        update-types: [patch]
      dev-non-major:
        applies-to: version-updates
        dependency-type: development
        update-types: [minor, patch]
    ignore:
      # 生态耦合集：只允许 patch（含安全修复）；minor/major 一律人工走 SDK 升级流程
      # 依据：官方「block updates to a library, pending work to support a breaking change to its API,
      # but want to get any security fixes to the version you use」
      - dependency-name: "react-native"
        update-types: ["version-update:semver-minor", "version-update:semver-major"]
      - dependency-name: "react-native-*"
        update-types: ["version-update:semver-minor", "version-update:semver-major"]
      - dependency-name: "@react-native-community/*"
        update-types: ["version-update:semver-minor", "version-update:semver-major"]
      - dependency-name: "@react-native-async-storage/async-storage"
        update-types: ["version-update:semver-minor", "version-update:semver-major"]
      - dependency-name: "react-native-web"
        update-types: ["version-update:semver-minor", "version-update:semver-major"]
      - dependency-name: "expo*"
        update-types: ["version-update:semver-minor", "version-update:semver-major"]
      - dependency-name: "react"
        update-types: ["version-update:semver-minor", "version-update:semver-major"]
      - dependency-name: "react-dom"
        update-types: ["version-update:semver-minor", "version-update:semver-major"]
      - dependency-name: "@types/react"
        update-types: ["version-update:semver-minor", "version-update:semver-major"]
    labels: [dependencies]
    commit-message:
      prefix: fix
      prefix-development: chore
      include: scope

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    labels: [dependencies]
    commit-message:
      prefix: chore
      include: scope
```

⚠️ **一处来源不明确，已标注**：`ignore` 被官方标为对 version + security 更新都生效，但**没有明文说明 `ignore.update-types` 在 security updates 上的具体行为**（只有 `allow.update-types` 明确写了 `only affects _version_ updates, not _security updates_`）。落地后应在仓库里用一个真实安全告警实测这条规则是否仍能开 PR；若不放心，可改为按 `versions` 阻断（例如 `versions: [">=0.87"]`），或把耦合包交给 `expo install --check` 门禁 + 人工评审（见 §9）。

### 8.3 automerge 的 Dependabot 侧实现（GitHub Actions，官方配方）

```yaml
# .github/workflows/dependabot-automerge.yml
name: Dependabot auto-merge
on: pull_request

permissions:
  contents: write
  pull-requests: write

jobs:
  dependabot:
    runs-on: ubuntu-latest
    if: github.event.pull_request.user.login == 'dependabot[bot]'
    steps:
      - name: Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@d7267f607e9d3fb96fc2fbe83e0af444713e90b7
        with:
          github-token: "${{ secrets.GITHUB_TOKEN }}"
      - name: Enable auto-merge for patch updates only
        if: steps.metadata.outputs.update-type == 'version-update:semver-patch'
        run: gh pr merge --auto --merge "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- 结构照抄官方示例（`dependabot/fetch-metadata` + `gh pr merge --auto`，[automate-dependabot-with-actions](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions#enabling-automerge-on-a-pull-request)）。要进一步只对 development 依赖放行，可再叠加 `dependabot/fetch-metadata` 的 `dependency-type` 输出作为条件（该输出定义在 action 自己的文档里，不属于本次引用的 GitHub Docs 页面，落地前请自行核对）。
- **必须**在目标分支打开 `Require status checks to pass before merging`（官方原文见 §3.2），否则 auto-merge 在检查未跑完时就可能合。
- 想要「版本不合规就红」的硬门禁，用 §8.4 的 `expo install --check`，它不依赖 automerge 语义。

### 8.4 CI 门禁（把 Expo 的 SDK 对齐做成必需检查）

```yaml
# 加进现有 workflow 的一个 job 步骤
- name: Mobile dependencies must match the installed Expo SDK
  working-directory: packages/mobile
  env:
    CI: "1"            # 官方：CI=1 时非交互，且 outdated 会失败
  run: npx expo install --check   # 不匹配时 exit 1；需要结构化输出时加 --json
```

出处：`It exits with non-zero in Continuous Integration (CI). This means you can use this to do continuous immutable validation.`（[Expo CLI](https://docs.expo.dev/more/expo-cli/#install)）；`CI=1 npx expo install --check will fail if any installed packages are outdated.`（[环境变量表](https://docs.expo.dev/more/expo-cli/#environment-variables)）；源码 `checkPackages.ts` L102-103 / L77-81。若某些包确实要停在旧版，用 `expo.install.exclude` 显式豁免（[package.json config](https://docs.expo.dev/versions/latest/config/package-json/#installexclude)）—— 豁免要写在仓库里，而不是关掉门禁。

---

## 9. 来源沉默 / 有争议 / 本调研未覆盖

### 9.1 官方沉默（不要当成官方立场）

1. **Dependabot 对 0.x / pre-1.0 完全没有表述**：`github/docs` 的 Dependabot 文档里没有 pre-1.0、0.x、major version zero 的任何一句；只有「按 x.y.z 字面分位」的假设。**「Dependabot 认为 0.x 的 minor 是安全的」是我们的推论（由其分类规则推出），不是它的原话。**
2. **GitHub 没有「major 绝不 automerge」的明文**：官方只给了「只合 patch」的示例，没有禁止性条款。
3. **GitHub 没有把 cooldown 归因于供应链投毒**：官方措辞是 `gives new releases time to stabilize`；「防恶意发布」是 Renovate 文档的明文。
4. **`ignore.update-types` 对 security updates 的确切作用未明文**（§8.2 已标注）。
5. **Dependabot 没有 dashboard / 审批工作流**：官方文档中不存在等价物；「用单个 issue 收敛 PR 噪音」只能换 Renovate。
6. **Renovate 没有 YAML 配置**（§8.0）。

### 9.2 有争议（社区/厂商自述，非中立共识）

1. **「把 major 也塞进 `groups` 一起合」**：Dependabot 的工具**允许**（`update-types: [major]` 是合法取值），官方教程却只示范低风险层，Renovate 官方则明文反对把 major 并入分组（`separateMajorMinor` 默认拆开、且优先级高于分组）。⇒ **「工具支持」与「官方推荐」在这件事上是分裂的**，本仓事故就发生在这条缝里。
2. **Renovate vs Dependabot 的对比口径**：`bot-comparison` 是 Renovate 官方写的对比页（自称 `We are trying to be as objective as possible`），属于厂商自述；本调研只把它用于「Dependabot 没有 dashboard」这类可被 GitHub 侧文档反证的结论。
3. **「关掉机器人」不是官方对立的选项**：Renovate 官方明确反对「用停掉 major 更新的方式回避」，主张用 dashboard 审批保留可见性（§7.1 第 5 条）；GitHub 侧对应的官方手段是 `ignore` + `open-pull-requests-limit: 0`（按生态/按包停用），而不是撤销整个机器人。
4. **本调研未采用任何二手来源**：因此没有覆盖「社区对 0.x 分组的更细致做法」（例如按包名维护 pre-1.0 清单的具体模板），也没有引用 Dependabot 的 issue 讨论（非规范文本）。

---

## 10. 对本仓（MPlayer，#478 之后）的适用性小结

1. **本仓现有 `.github/dependabot.yml` 的方向与 GitHub 官方推荐一致**（`groups` 分层 + `cooldown` 分级 + `ignore` 排除耦合包 + `open-pull-requests-limit` 上调），差距只有三处：(a) 缺少 `expo install --check` 门禁；(b) production 层的 `prod-patch` 分组之外，0.x 的 minor 仍会单独提 PR 并且**没有任何 CI 会红**（因为 native 构建只在发版期跑）；(c) 没有任何 automerge，这点与官方示例一致，无需改。
2. **「关掉机器人」会让安全更新也一起没了**：Dependabot 的 security updates 与 version updates 是两条独立通道（§2.6），而 `ignore` + `open-pull-requests-limit: 0` 已能按生态/按包精确停用 version updates，**没有必须关掉整个机器人的官方理由**。
3. **如果核心痛点是「PR 洪水 + 看不到全貌」**：Dependabot 侧无解，得换 Renovate（`dependencyDashboard` + `dependencyDashboardApproval`，配 `minimumReleaseAge` + automerge 分层）。
4. **无论用哪个机器人，0.x 与生态耦合集都必须显式分层**：这是唯一被两边文档（semver 规范 + Renovate 明文警告 + Expo「对齐 SDK」要求）同时支持的做法。

---

## 11. 来源清单与校验记录

采集时间 2026-09-29。Renovate/GitHub/Expo 的文档源文件取自各仓库 `main` 分支（**会漂移**；引用的锚点链接是稳定的），semver 取自 `semver/semver@master`。以下 URL 于当日逐个 GET 校验，全部 200：

| 来源 | URL |
|---|---|
| Renovate 配置参考（所有 `#anchor` 的宿主页） | <https://docs.renovatebot.com/configuration-options/> |
| Renovate：automerge | <https://docs.renovatebot.com/key-concepts/automerge/> |
| Renovate：Dependency Dashboard | <https://docs.renovatebot.com/key-concepts/dashboard/> |
| Renovate：Minimum Release Age | <https://docs.renovatebot.com/key-concepts/minimum-release-age/> |
| Renovate：bot comparison | <https://docs.renovatebot.com/bot-comparison/> |
| GitHub：dependabot.yml options reference | <https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference> |
| GitHub：Dependabot version updates | <https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates> |
| GitHub：Dependabot security updates | <https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates> |
| GitHub：about the dependabot.yml file | <https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file> |
| GitHub：optimizing PR creation | <https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/optimizing-pr-creation-version-updates> |
| GitHub：automate Dependabot with Actions | <https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions> |
| GitHub：controlling dependencies updated | <https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/controlling-dependencies-updated> |
| GitHub：configure version updates（停用/忽略） | <https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-version-updates> |
| Expo：Using libraries | <https://docs.expo.dev/workflow/using-libraries/> |
| Expo：Upgrade Expo SDK | <https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/> |
| Expo CLI（install --check / 环境变量） | <https://docs.expo.dev/more/expo-cli/> |
| Expo tools（expo-doctor） | <https://docs.expo.dev/develop/tools/> |
| Expo package.json config（install.exclude） | <https://docs.expo.dev/versions/latest/config/package-json/> |
| Expo 官方版本 API | <https://api.expo.dev/v2/versions/latest> |
| semver 规范 | <https://semver.org/> |

源码级证据（本调研直接引用其行号）：

- `expo/expo@main`：`packages/@expo/cli/src/install/checkPackages.ts`（L68-75 匹配→exit 0；L77-81 `--json` + `process.exit(1)`；L102-103 不匹配→exit 1）、`packages/@expo/cli/src/install/resolveOptions.ts`（L26-28 `--json` 必须与 `--check` 同用）、`packages/@expo/cli/src/install/index.ts`（`--check` 帮助文本）。
- `renovatebot/renovate@main`：`docs/usage/configuration-options.md`、`docs/usage/key-concepts/{automerge,dashboard,minimum-release-age}.md`、`docs/usage/bot-comparison.md`、`docs/usage/config-overview.md`。
- `github/docs@main`：`content/code-security/**`、`data/reusables/dependabot/*.md`（行号即这些源文件的行号）。
