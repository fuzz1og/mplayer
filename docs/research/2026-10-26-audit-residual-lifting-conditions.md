# npm audit 残余 9 条的解除条件（electron / node-forge / zod / decode-uri-component 四根包，一手来源）

> 调研日期：2026-10-26 · 类型：调研 · 关联：[fuzz1og/mplayer#656](https://github.com/fuzz1og/mplayer/issues/656)（周报：16 → 9）、ADR [`docs/adr/2026-09-29-dependency-update-governance.md`](../adr/2026-09-29-dependency-update-governance.md)「2026-10-26 残余清单」、master `b4ac29e`
> 依据：**仅一手来源** —— npm registry 元数据（`npm view <pkg>@<ver> dependencies` / `npm view <pkg> version` / `npm view <pkg> time`）、OSV 记录页（`https://osv.dev/vulnerability/<GHSA>`）、上游仓库文件（`gh api repos/...`）、npm CLI 官方文档源文件（`npm/cli@latest` 的 `docs/lib/content/configuring-npm/package-json.md`）。
> 环境：node `v22.23.2` / npm `10.9.8`（与 CI 同款 Node 22）。**所有 registry 与 OSV 读数截至 2026-10-26**（下称「截至 2026-10-26」）。凡实测均标出可复跑的命令；凡未核实一律写进 §3，不做推测。
> 本笔记**只回答一个问题**：9 条残余里每个直接根包的解除条件是什么。不重复论证「要不要修」，那由 ADR 决策 1 与本票范围决定。

---

## 0. 结论先行

| 包 | 级别 | 解除条件（上游要做什么） | SDK 58 是否解除 | 仓库能否用 override 解除 |
|---|---|---|---|---|
| `electron` | high | **仓库自己抬声明区间即可**。advisory `GHSA-jr5w-w6x2-84p9` `fixed: 42.11.16`；41.x 最后一个版本是 **41.10.7**，`^41.7.1` 的 caret 永远到不了 42 —— 必须改 manifest | **不适用**（桌面端不随 Expo SDK） | **不能**。`electron` 是根 `devDependencies` 直接依赖，override 会 `EOVERRIDE`；`"$electron"` 自引用只是把区间映射回自己（实测仍解析 41.10.7）。唯一杠杆是改 `package.json` 的区间 |
| `node-forge` | high | **只能等上游发版**：registry 全 134 个版本里 **不存在 > 1.4.0 的版本**，advisory `GHSA-86w9-cpqp-85rv` 只有 `introduced: 0` + `last_affected: 1.4.0`、**没有 `fixed` 事件**；上游 `main` 已是 `1.4.1-0`（未发布），4 个修复 PR（#1152 / #1159 / #1160 / #1161）全部 **open、未合** | **否，且更糟**：`@expo/cli@58.1.15` 把声明从 57 线的 `^1.3.3` **抬高成 `^1.4.0`**（= 唯一受影响版本） | **不能**。override 到 `1.4.1` 直接 `ETARGET`；**不存在目标版本**（与 braces 那次「区间盖满」不同，这次是「registry 没有更高版本」） |
| `zod` | high | **等 `@expo/cli` 把声明跨到 4.x**，或等 zod 出 3.x 修复版（3.x 最后发布 = **3.25.76**，其后只有 `3.26.0-canary`）。advisory `GHSA-mrhx-c7xc-m3w5` `fixed: 4.6.6`，干净版 **存在** | **否**：`@expo/cli@58.1.15` 仍写 `zod: ^3.25.76`（3.x），SDK 58 全链没有任何一环把 zod 抬到 4 | **技术上可以**（override 到 `4.6.7` 生效，audit 9→8）。本次**实测 @expo/cli 运行时所用 zod API 全部在 4.6.7 下可用**（含两个真实构建产物加载成功），但这是**越过上游声明区间**，需自担后续 `@expo/cli` 升级时的语义漂移 |
| `decode-uri-component` | moderate | **上游已修**（`0.5.0`），但要落到树里必须换掉父级 `query-string@7`：`^0.2.2` 在 0.x 语义下封死 `<0.3.0`；`query-string@8/9` 写 `^0.4.1`（仍 <0.5.0，且 `0.4.2` 根本不存在）；只有 **`query-string@10.0.0` 把该依赖整个删掉** | **是（已实测）**：`expo-router` 自 **58.0.13** 起不再依赖 `query-string`，`58.0.26` 的依赖表里没有它 → 整条链消失，moderate 归零 | **能顶版但产物会崩**：两种根写法都能让 lock 变成 `0.5.1`，但 `0.5.1` 是 **ESM-only**（`"type": "module"`、无 `main`），`query-string@7.1.3` 是 CJS `require()` 后直接调用 —— 实测 `TypeError: decodeComponent is not a function`，而 `expo-router@57` 运行时真的会走 `queryString.parse`。**结论：不可采** |

**一句话**：9 条 = 2 个根因 + 1 个可直接改 + 1 个等上游。`electron` 改 manifest 即解；`decode-uri-component`（连带 `query-string`、`expo-router`）**确认由 SDK 58 解除**；`zod` **SDK 58 不解**，可 override 但有越界成本；`node-forge` **SDK 58 不解，且不存在任何 override 目标**，只能等上游 —— 而它正是剩余 4 条 high 的唯一来源。

> **与 ADR 第 5 条的一处更正**：ADR 记「两种 override 写法均静默不生效」。截至 2026-10-26 在 npm 10.9.8 下**无法复现**——两种根写法都生效（§1.4）。真正让这条路不可采的是 **ESM/CJS 互操作崩溃**，不是 override 失效。唯一会「静默不生效」的写法是把 `overrides` 写进**非根** manifest（`packages/mobile/package.json`），npm 官方文档明说只认根，实测也确实不动锁文件（§1.4 的 R4）。

---

## 1. 逐包证据

### 1.1 `electron`（high，进桌面产物）

**装的是谁、卡在哪**

```
$ node -e "const l=require('./package-lock.json');console.log(l.packages['node_modules/electron'].version)"
41.10.7
$ npm view electron versions --json | (取 41.x 最大值)
41.10.7
```

`package.json` 声明 `"electron": "^41.7.1"`（`devDependencies`）。caret 在 major 41 上封顶 `<42.0.0`，**结构上到不了 42.11.16**。

**8 条 advisory 的分布**（`npm audit --package-lock-only --json`，截至 2026-10-26；`via` 逐条列出）

| GHSA | 级别 | 区间 |
|---|---|---|
| `GHSA-fw47-9c62-h3vw` | moderate | `<42.11.3` |
| `GHSA-2p8c-gr87-2676` | moderate | `<42.11.3` |
| `GHSA-x562-297c-g43g` | moderate | `<42.11.9` |
| `GHSA-98mx-cjp9-gchm` | low | `<42.11.1` |
| `GHSA-3qxv-5xgr-q7w9` | low | `<42.11.6` |
| `GHSA-h3v5-h239-pg29` | low | `<42.11.6` |
| `GHSA-997q-gvvc-jwmx` | moderate | `<42.11.3` |
| **`GHSA-jr5w-w6x2-84p9`** | **high（7.4）** | `<42.11.16` |

条目级别取 `via` 的最大值，所以整条显示 high。**唯一 high 是 eMudhra 中间证书缓解**，OSV 原文：

> "A set of eMudhra intermediate certificates were compromised and are being blocked by browsers and other TLS clients. This Electron update adds the same block to both Chromium networking and Node.js `tls`, `https` and `fetch`."
> —— [OSV GHSA-jr5w-w6x2-84p9](https://osv.dev/vulnerability/GHSA-jr5w-w6x2-84p9)，Published `2026-10-23T20:53:41Z`，截至 2026-10-26

该 advisory 的 OSV 事件是四段并列（4 条维护线各修一版）：`45.0.0-alpha.1 → 45.0.0-beta.6`、`44.0.0-alpha.1 → 44.9.1`、`43.0.0-alpha.1 → 43.8.1`、`0 → 42.11.16`。**41 线没有修复版**。

**实测：每个 major 的干净下限**（临时目录逐个 `npm install --package-lock-only` + `npm audit --package-lock-only`，截至 2026-10-26）

| 版本 | audit 结果 |
|---|---|
| 41.10.7 | 1 条（electron） |
| 42.11.14 / 42.11.15 | 1 条 |
| **42.11.16** | **clean** |
| 42.11.17 / 42.11.18 | clean |
| 43.8.0 | 1 条 |
| **43.8.1** | **clean** |
| 44.9.0 | 1 条 |
| **44.9.1** | **clean** |
| **45.0.0** | **clean** |

registry 侧对应事实（`npm view electron time --json`，截至 2026-10-26）：`42.11.16` = `2026-10-20T02:53:45Z`、`43.8.1` = `2026-10-20T02:54:21Z`、`44.9.1` = `2026-10-20T02:53:15Z`、`45.0.0` = `2026-10-21T06:03:52Z`。**即修复是 2026-10-20/21 才落地的**，不是长期存在没跟。

**解除条件（精确）**：把 `electron` 声明抬到 **`^42.11.16`**（最小动作，跨 1 个 major）或 `^43.8.1` / `^44.9.1` / `^45.0.0`。**不需要上游做任何事**——上游已经发了；挡路的只有我们自己的 caret。注意这是 major 跳级（41 → 42 起），不是 patch 动作。

**SDK 58**：不适用（Electron 与 Expo SDK 无关）。顺带记一条：`electron` 42/43/44/45 的 `engines.node` 全部是 `>= 22.12.0`（`npm view electron@<v> engines`），与 CI 的 Node 22 兼容。

**override 为什么不行**（两条都实测）

```
# 形式 1：直接钉版
$ npm install --package-lock-only
npm error code EOVERRIDE
npm error Override for electron@^41.7.1 conflicts with direct dependency

# 形式 2：官方给的 $ 自引用写法
{"devDependencies":{"electron":"^41.7.1"},"overrides":{"electron":"$electron"}}
$ npm install --package-lock-only && node -e "...packages['node_modules/electron'].version"
41.10.7          # 只是把区间映射回自己，没有任何抬升
```

官方原文（`npm/cli@latest` `docs/lib/content/configuring-npm/package-json.md` 第 968–969 行，`gh api` 取回，截至 2026-10-26）：

> "You may not set an override for a package that you directly depend on unless both the dependency and the override itself share the exact same spec."
> "To make this limitation easier to deal with, overrides may also be defined as a reference to a spec for a direct dependency by prefixing the name of the package you wish the version to match with a `$`."

**结论**：electron 的解除动作**不是 override，是改声明区间**——这也解释了为什么它在 9 条里最"可解"却一直挂着（改区间要跟一次桌面端打包冒烟，属另一个工作流）。

---

### 1.2 `node-forge`（high，SDK 58 不解，且无 override 目标）

**装的是谁、卡在哪**

```
$ node -e "const l=require('./package-lock.json');console.log(l.packages['node_modules/node-forge'].version)"
1.4.0
# 依赖边（lock 里逐条扫 dependencies）：
node-forge  <=  node_modules/@expo/code-signing-certificates  (^1.3.3)
node-forge  <=  node_modules/expo/node_modules/@expo/cli     (^1.3.3)
```

**advisory 没有 `fixed` 事件**（OSV 页面逐字，截至 2026-10-26）：

> `Introduced` = **0**（"Unknown introduced version / All previous versions are affected"）· `Last Affected` = **1.4.0**
> "node-forge through 1.4.0 fails to validate element count in nested DigestAlgorithm sequences during RSA PKCS#1 v1.5 signature verification. Attackers can embed garbage bytes inside the DigestAlgorithm sequence to forge valid signatures for arbitrary messages using low-exponent RSA keys. **This is an incomplete fix for CVE-2026-33894.**"
> —— [OSV GHSA-86w9-cpqp-85rv](https://osv.dev/vulnerability/GHSA-86w9-cpqp-85rv)，Published `2026-09-03T21:31:15Z` / Modified `2026-10-01T21:40:55Z`，7.5 High，别名 `CVE-2026-33894` / `CVE-2026-85393`

**registry 里根本没有更高的版本**（截至 2026-10-26）：

```
$ npm view node-forge version            → 1.4.0
$ npm view node-forge dist-tags          → {"latest": "1.4.0"}
$ npm view node-forge versions --json    → 134 个版本，> 1.4.0 的：不存在
$ npm view node-forge time --json        → 1.3.2=2025-11-25 · 1.3.3=2025-12-02 · 1.4.0=2026-03-24
```

**上游有在修，但没发版**（`gh api repos/digitalbazaar/forge/...`，截至 2026-10-26）：

| 事实 | 读数 |
|---|---|
| `main` 的 `package.json` `version` | **`1.4.1-0`**（= 1.4.1 的预发布占位，registry 上不存在） |
| 最近一次 release tag | `v1.4.0`（没有 1.4.1 的 release） |
| 相关 open PR | #1152 `Fix RSA PKCS#1 v1.5 forgery via nested DigestAlgorithm garbage`、#1159 `Fix CVE-2026-85393: reject non-canonical DigestInfo...`、#1160 `fix(rsa): reject garbage in nested DigestAlgorithm SEQUENCE`、#1161 `Reject nested DigestAlgorithm garbage and nonempty NULL parameters` —— **全部 open / `merged: false`** |

**解除条件（精确）**：`node-forge` 发布 **> 1.4.0** 的版本（`1.4.1` 或 `1.5.0` 均可，见下），**或** `GHSA-86w9-cpqp-85rv` 被上游撤回（braces 那次就是这么解的）。

**声明区间不是拦路石**：`^1.4.0` / `^1.3.3` 都允许 `>=1.4.0 <2.0.0`，**1.4.1 一发布，`npm install` 会自动吃进去**，不需要改任何 manifest、不需要 override。这与 `zod`（区间跨 major）性质完全不同。

**SDK 58 不解，而且把地板抬高了**（`npm view <pkg>@<ver> dependencies --json`，截至 2026-10-26）：

| 包版本 | `node-forge` 声明 |
|---|---|
| `@expo/cli@57.0.31`（当前 lock 的 57 线） | `^1.3.3` |
| `@expo/cli@58.1.9`（`next`） | `^1.4.0` |
| **`@expo/cli@58.1.15`（`latest`）** | **`^1.4.0`** |
| `@expo/code-signing-certificates@0.0.6`（当前） | `^1.3.3` |
| **`@expo/code-signing-certificates@0.0.7`** | **`^1.4.0`** |

即 SDK 58 **把下界钉到了唯一受影响的那个版本**。即使 node-forge 今天发 1.4.1，SDK 58 树也会自动升；但**在它发版之前，SDK 58 对这条 high 零贡献**（实测见 §1.5）。

**override 为什么不行**：没有目标版本。

```
$ # 在根 overrides 里写 {"node-forge": "1.4.1"}
npm error code ETARGET
npm error notarget No matching version found for node-forge@1.4.1.
```

这与 braces 那次的机理**不同**：braces 是「两条区间盖满全部已发布版本」（有版本、无干净版本）；node-forge 是「**registry 没有比漏洞版本更高的版本**」——连候选都没有，差测无从谈起。

**可达性（沿用 ADR 口径，本次复核未推翻）**：本仓源码无 `node-forge` 直接引用（`grep -rn "node-forge" src packages scripts e2e` 只命中 `packages/core/src/api/neteaseWeapi.ts:40` 的一行**注释**「等价于 node-forge 的 encrypt(str, 'NONE')」，不是 import）。实际链路是 `expo → @expo/cli → node-forge`，只在移动端构建期的代码签名证书链上跑。advisory 的 sink 是 **RSA PKCS#1 v1.5 签名验证**，本仓不调用。

---

### 1.3 `zod`（high，SDK 58 不解，override 可生效但有越界成本）

**装的是谁、卡在哪**

```
$ node -e "const l=require('./package-lock.json');console.log(l.packages['node_modules/zod'].version)"
3.25.76
# 依赖边：
zod  <=  node_modules/expo/node_modules/@expo/cli  (^3.25.76)
zod  <=  node_modules/eslint-plugin-react-hooks    (^3.25.0 || ^4.0.0)
zod  <=  node_modules/zod-validation-error         (^3.25.0 || ^4.0.0)
```

**advisory 有 `fixed` 事件，干净版存在**（OSV 页面逐字，截至 2026-10-26）：

> `Introduced` = 0 · **`Fixed` = 4.6.6**
> "Zod schema-validation library through 4.6.5 contains an uncontrolled resource consumption vulnerability that allows attackers to exhaust memory by submitting a large array to an application using an array schema without a length constraint. Attackers can exploit the `handleArrayResult` parse logic in `$ZodArray`, which accumulates every validation issue for each failing element with no cap or early termination..."
> —— [OSV GHSA-mrhx-c7xc-m3w5](https://osv.dev/vulnerability/GHSA-mrhx-c7xc-m3w5)，Published `2026-10-01T18:32:46Z` / Modified `2026-10-23T18:30:09Z`，7.5 High，别名 `CVE-2023-54404`

```
$ npm view zod version                 → 4.6.7
$ npm view zod time --json | grep 4.6  → 4.6.5=2026-09-13 · 4.6.6=2026-10-11 · 4.6.7=2026-10-12
$ npm view zod versions --json | (3.x 最大值) → 3.25.76（其后只有 3.26.0-canary.20250708T225111）
```

**关键：3.x 线截至 2026-10-26 没有修复版，也没有迹象**。zod 的 `latest` 是 4.6.7，3.x 最后一次正式发布是 `2025-07-08` 的 3.25.76（距复核时刻已 15 个月）。上游 issue 也印证 3.x 的问题仍未修：

> "v3: `.max()` on arrays and sets doesn't stop parsing (CVE-2023-54404)" · `state: open` · created `2026-10-09` / updated `2026-10-24`
> "v3 checks the bound first but only marks the result dirty, so every element is still parsed"
> —— [colinhacks/zod#6653](https://github.com/colinhacks/zod/issues/6653)，截至 2026-10-26

**解除条件（精确）**：`@expo/cli` 把 `zod` 声明从 `^3.25.76` 跨到 `^4.6.6` 及以上（或 `>=4.6.6`），**或** zod 在 3.x 线回发一个 `>=3.25.77` 的修复版（截至 2026-10-26 无任何迹象）。

**SDK 58 不解**（`npm view <pkg>@<ver> dependencies`，截至 2026-10-26）：

| 包版本 | `zod` 声明 |
|---|---|
| `@expo/cli@57.0.31` | `^3.25.76` |
| `@expo/cli@58.1.9`（`next`） | `^3.25.76` |
| **`@expo/cli@58.1.15`（`latest`）** | **`^3.25.76`** |
| `@expo/cli@canary` | `^3.25.76` |

**canary 都还没动**。SDK 58 的 `expo@58.0.19` 依赖 `"@expo/cli": "^58.1.15"`，所以换 SDK 58 只会拿到同一个 `zod ^3.25.76`。**这是 SDK 58 完全不解除的那一条。**

**override 能不能用：能生效，且本次实测其运行时风险比 ADR 记录的更低**

形式：根 `overrides: {"zod": "4.6.7"}`。在仓库副本上实测（截至 2026-10-26）：

| 场景 | lock 结果 | `npm audit` |
|---|---|---|
| 现仓（SDK 57） | `zod = 4.6.7` | 9 → **8**（zod 那条消失） |
| SDK 58 + electron 43.8.1 | `zod = 4.6.7` | 5 → **4**（zod 那条消失） |

**运行时风险实测**（这是 ADR 第 3 条说「盲顶有风险」的地方，本次做了正面验证）：

1. `@expo/cli` 的**全部** `require("zod")` 只出现在两个构建产物里（`grep -rln 'require("zod")' node_modules/expo/node_modules/@expo/cli/build` 与 `@expo/cli@58.1.15` 的 tarball 双向确认）：
   `build/src/start/server/DevToolsPlugin.schema.js`、`build/src/start/server/createMCPDevToolsExtensionSchema.js`。
2. 这两个文件用到的 zod API 全集是 `z.string` / `z.object` / `z.enum` / `z.array` / `z.literal` / `z.union` / `z.boolean` / `z.number` + `.strict()` + `.readonly()`，**逐项在 zod 4.6.7 下实测可用**（`.strict()` 仍产出 `unrecognized_keys`）。
3. **把真实构建产物拷到 zod 4.6.7 的树里加载**：`PluginSchema.safeParse(<合法载荷>)` → `true`；`createMCPDevToolsExtensionSchema(...)` → 正常返回 schema 对象。对照 zod 3.25.76 同一文件同样成功。
4. 源码里唯一的 3→4 断点是 `createMCPDevToolsExtensionSchema.ts:79` 的 `Record<string, z.ZodTypeAny>`——`z.ZodTypeAny` 在 zod 4 里已不存在（实测 `undefined`），**但它是纯类型标注，构建后已擦除**（构建产物里搜不到 `ZodTypeAny`），不影响运行。

**结论**：override `zod → 4.6.7` 在 `@expo/cli` 这条链上**运行时是安全的（就这两个文件而言）**。剩下的成本不是"可能崩"，而是**越界**：`@expo/cli` 声明 `^3.25.76`，我们强制喂 4.x，等于自己承担 `@expo/cli` 未来新增 zod 用法时的静默不兼容。要不要接受这个越界，是本票之外的决策，不是技术可行性问题。

---

### 1.4 `decode-uri-component`（moderate，SDK 58 解除；override 能顶但产物崩）

**装的是谁、卡在哪**

```
$ node -e "const l=require('./package-lock.json');console.log(l.packages['node_modules/decode-uri-component'].version)"
0.2.2
# 依赖边：
decode-uri-component  <=  node_modules/query-string  (^0.2.2)
query-string          <=  node_modules/expo-router   (^7.1.3)
```

**advisory 有 `fixed` 事件，干净版存在**（OSV 页面逐字，截至 2026-10-26）：

> `Introduced` = 0 · **`Fixed` = 0.5.0** · `database_specific.last_known_affected_version_range` = `"<= 0.4.2"`
> "An attacker who can supply input to `decodeUriComponent()` (directly or via a dependency that uses this package on URL/query/path data) can cause excessive CPU usage and application unresponsiveness. This is an availability issue; there is no known memory corruption, data disclosure, or remote code execution impact."
> "**Patches** Upgrade to `decode-uri-component@0.5.0`."
> —— [OSV GHSA-vcc3-ghjq-m6fr](https://osv.dev/vulnerability/GHSA-vcc3-ghjq-m6fr)，Published `2026-08-31T22:10:20Z` / Modified `2026-09-10T03:51:14Z`，6.6 Medium，别名 `CVE-2026-45822`

**解除条件（精确）**：树里出现 **`decode-uri-component@>=0.5.0`**。三条上游路线：

| 父级版本 | `decode-uri-component` 声明 | 能否到 `>=0.5.0` |
|---|---|---|
| `query-string@7.1.3`（当前） | `^0.2.2` | **否**，0.x caret 封死 `<0.3.0` |
| `query-string@8.1.0` / `9.4.1` | `^0.4.1` | **否**，仍 `<0.5.0`（且 `0.4.2` 在 registry 上不存在，`npm view decode-uri-component@0.4.2` = `E404`） |
| **`query-string@10.0.0`** | **依赖整个删除** | **是**（绕开，不是升级） |

**SDK 58 解除——已实测**

```
$ npm view expo-router@58.0.12 dependencies --json | grep query-string   → "query-string": "^7.1.3"
$ npm view expo-router@58.0.13 dependencies --json | grep query-string   → （无）
$ npm view expo-router@58.0.26 dependencies --json                       → 依赖表里没有 query-string
```

切点是 **`58.0.13`**（发布于 `2026-10-03T13:06:56Z`），`58.0.26` 发布于 `2026-10-23T23:26:56Z`。

在最小 SDK 58 树（`expo@58.0.19` + `expo-router@58.0.26`）里实测：

```
node_modules/expo                    58.0.19
node_modules/expo-router             58.0.26
node_modules/@expo/cli               58.1.15
node_modules/decode-uri-component    ABSENT
node_modules/query-string            ABSENT
$ npm audit --package-lock-only --json → total 5，moderate = 0
```

**moderate 三条（`expo-router` / `query-string` / `decode-uri-component`）一起归零，无需任何 override。** ADR 第 5 条「随 SDK 58 推进自动消解」的结论**成立**，本次给出了可复跑的证明。

**override 为什么不可采：能生效，但产物会崩**

先纠正 ADR 的记录——两种根写法**都生效**（`npm 10.9.8`，临时目录 + 仓库副本双跑，截至 2026-10-26）：

| 写法 | lock 里 `decode-uri-component` |
|---|---|
| `overrides: {"decode-uri-component": "0.5.1"}`（根平铺） | **0.5.1** |
| `overrides: {"query-string": {"decode-uri-component": "0.5.1"}}`（根嵌套） | **0.5.1** |
| `overrides` 写进 `packages/mobile/package.json`（**非根**） | **0.2.2**（静默不动，npm 不报错） |

官方依据（`npm/cli@latest` `package-json.md` 第 885–886 行，截至 2026-10-26）：

> "Overrides are only considered in the root `package.json` file for a project."
> "Overrides in installed dependencies (including workspaces) are not considered in dependency tree resolution."

所以「静默不生效」确实存在，但**只发生在非根 manifest**——这很可能就是 ADR 那次实测的形态。**根上的两种写法在 10.9.8 下都生效。**

**但生效之后会崩**，这才是不可采的真正原因：

```
# decode-uri-component@0.5.1 的包元数据
{ "type": "module", "exports": { "types": "./index.d.ts", "default": "./index.js" } }   # 无 main
# query-string@7.1.3 是 CJS，index.js:3 写：
const decodeComponent = require('decode-uri-component');
# index.js:233 直接调用：
return decodeComponent(value);

# 实测（根平铺 override 生效、真仓副本完整安装后）
$ node -e "const qs=require('query-string'); console.log(qs.parse('a=%E4%BD%A0&b=2'))"
TypeError: decodeComponent is not a function
    at decode (.../query-string/index.js:233:10)
    at Object.parse (.../query-string/index.js:328:124)
```

即 `require()` 一个 ESM-only 包返回的是命名空间对象（`{__esModule: true, default: fn}`），不是函数。

而 `expo-router@57.0.29` 的构建产物**运行时真的会走这条**（`npm pack expo-router@57.0.29` 取 tarball 逐行核对；磁盘上装的是 57.0.28，调用点逐行相同）：

```
$ grep -rn "queryString\.parse\|queryString\.stringify" package/build --include=*.js
package/build/react-navigation/core/getStateFromPath.js:499:  const params = queryString.parse(query);      ← 真调用
package/build/fork/getStateFromPath.js:538:        //   const params = queryString.parse(query);  ← 注释掉的
package/build/fork/getPathFromState.js:273:            const query = queryString.stringify(focusedParams, { sort: false });
package/build/fork/getPathFromState-forks.js:71:    const query = queryString.stringify(focusedParams, { sort: false });
package/build/react-navigation/core/getPathFromState.js:212:            const query = queryString.stringify(focusedParams, { sort: false });
```

调用点上下文（`getStateFromPath.js:494–499`，深链 query 解析的必经路径）：

```js
const parseQueryParams = (path, parseConfig) => {
    const query = path.split('?')[1];
    if (!query) { return undefined; }
    const params = queryString.parse(query);      // ← 这里
```

而 `query-string@7.1.3` 的 `parse` 必然走到 `decodeComponent`（`index.js:3` require、`:233` `return decodeComponent(value);`）。

对照：把 `query-string` 整个 override 到 `10.0.0`（依赖表里已无 decode-uri-component）也会崩，因为 `query-string@8` 起就是 ESM-only：

```
$ # override query-string → 10.0.0，然后按 expo-router 的 __importStar(require(...)) 形态调用
typeof queryString.parse = undefined
CRASH: TypeError: queryString.parse is not a function
```

（`query-string@8.1.0` / `9.4.1` / `10.0.0` 的 `type` 均为 `"module"`，`require()` 后 `Object.keys` 只有 `__esModule, default`，实测三版一致。）

**结论**：`decode-uri-component` 的 override **技术上完全可行、audit 也确实降**（9 → 6，moderate 清零），但**会把 `expo-router` 的 query 解析打成运行时异常**。这条的正确解法就是 **SDK 58**（`expo-router >= 58.0.13`），不是 override。

---

### 1.5 交叉验证：三条路径合起来的 audit 读数

在仓库副本上（三个 manifest + lock 全量复制，`npm install --package-lock-only` 重算，`npm audit --package-lock-only --json`，截至 2026-10-26）：

| 场景 | total | high | moderate | 剩余条目 |
|---|---|---|---|---|
| 现仓（master `b4ac29e`） | **9** | 6 | 3 | 全部 9 条 |
| 仅 `overrides: {"decode-uri-component": "0.5.1"}` | 6 | 6 | **0** | 6 high（但产物崩，见 §1.4） |
| 仅 `electron: ^42.11.16` | 8 | **5** | 3 | electron 消失 |
| SDK 58（`expo ~58.0.19` / `expo-router ~58.0.26`）+ `electron ^43.8.1` | **5** | 5 | **0** | `@expo/cli` / `@expo/code-signing-certificates` / `expo` / `node-forge` / `zod` |
| 上一条 + `overrides: {"zod": "4.6.7"}` | **4** | 4 | 0 | `@expo/cli` / `@expo/code-signing-certificates` / `expo` / `node-forge` —— **全部 via node-forge** |

最后一行说明：**做完所有「可做的」，剩下 4 条 high 全是 node-forge 一棵树的投影**，与 ADR 第 4 条「纯传递、无独立 sink」的判断一致。**node-forge 是唯一真正卡死的点。**

---

## 2. 上游声明原文（逐字短引文 + 复核时刻）

| # | 原文 | 出处 | 复核时刻 |
|---|---|---|---|
| 1 | "node-forge through 1.4.0 fails to validate element count in nested DigestAlgorithm sequences during RSA PKCS#1 v1.5 signature verification. ... **This is an incomplete fix for CVE-2026-33894.**" | [OSV GHSA-86w9-cpqp-85rv](https://osv.dev/vulnerability/GHSA-86w9-cpqp-85rv) | 截至 2026-10-26 |
| 2 | OSV 事件：`Introduced 0` → `Last Affected 1.4.0`（**无 `Fixed`**） | 同上 | 截至 2026-10-26 |
| 3 | "Zod schema-validation library through 4.6.5 contains an uncontrolled resource consumption vulnerability ... `$ZodArray` ... accumulates every validation issue for each failing element with no cap or early termination" | [OSV GHSA-mrhx-c7xc-m3w5](https://osv.dev/vulnerability/GHSA-mrhx-c7xc-m3w5) | 截至 2026-10-26 |
| 4 | "v3: `.max()` on arrays and sets doesn't stop parsing (CVE-2023-54404)" · `state: open` · "v3 checks the bound first but only marks the result dirty, so every element is still parsed" | [colinhacks/zod#6653](https://github.com/colinhacks/zod/issues/6653) | 截至 2026-10-26 |
| 5 | "**Patches** Upgrade to `decode-uri-component@0.5.0`." / "This is an availability issue; there is no known memory corruption, data disclosure, or remote code execution impact." | [OSV GHSA-vcc3-ghjq-m6fr](https://osv.dev/vulnerability/GHSA-vcc3-ghjq-m6fr) | 截至 2026-10-26 |
| 6 | "A set of eMudhra intermediate certificates were compromised and are being blocked by browsers and other TLS clients. This Electron update adds the same block to both Chromium networking and Node.js `tls`, `https` and `fetch`." | [OSV GHSA-jr5w-w6x2-84p9](https://osv.dev/vulnerability/GHSA-jr5w-w6x2-84p9) | 截至 2026-10-26 |
| 7 | "You may not set an override for a package that you directly depend on unless both the dependency and the override itself share the exact same spec." | `npm/cli@latest` `docs/lib/content/configuring-npm/package-json.md` 第 968 行 | 截至 2026-10-26 |
| 8 | "Overrides are only considered in the root `package.json` file for a project." / "Overrides in installed dependencies (including workspaces) are not considered in dependency tree resolution." | 同上，第 885–886 行 | 截至 2026-10-26 |
| 9 | "Electron's official support policy is the latest 3 stable releases." | `electron/electron@main` `docs/tutorial/electron-timelines.md` | 截至 2026-10-26 |

**registry 读数（`npm view`，全部截至 2026-10-26）**

| 命令 | 输出 |
|---|---|
| `npm view electron version` | `45.0.0` |
| `npm view electron@42.11.16 version` / `@43.8.1` / `@44.9.1` | 均存在 |
| `npm view node-forge version` / `dist-tags` | `1.4.0` / `{"latest":"1.4.0"}` |
| `npm view zod version` / `dist-tags.latest` | `4.6.7` |
| `npm view zod versions`（3.x 最大） | `3.25.76`（发布于 2025-07-08） |
| `npm view decode-uri-component version` | `0.5.1` |
| `npm view query-string version` | `10.0.0` |
| `npm view @expo/cli dist-tags` | `latest: 58.1.15` / `next: 58.1.9` / `sdk-57: 57.0.32` |
| `npm view expo dist-tags` | `latest: 58.0.19` / `sdk-57: 57.0.31` |
| `npm view expo-router dist-tags` | `latest: 58.0.26` / `sdk-57: 57.0.29` |
| `npm view @expo/cli@58.1.15 dependencies` | `zod: ^3.25.76` · `node-forge: ^1.4.0` · `@expo/code-signing-certificates: ^0.0.7` |
| `npm view @expo/code-signing-certificates@0.0.7 dependencies` | `node-forge: ^1.4.0` |
| `npm view expo-router@58.0.26 dependencies` | 无 `query-string` |

---

## 3. 未能核实 / 需要下一手补的

1. **Metro 打包器下 `decode-uri-component@0.5.1` 的互操作行为未验**。§1.4 的崩溃是在 **Node CJS `require()`** 下测的（与 `expo-router` 构建产物的模块形态一致）。Metro 走的是 `unstable_enablePackageExports`（本仓 `node_modules/metro-config/src/defaults/index.js:69` 默认为 `true`）+ 自己的 ESM 互操作，**结果可能不同**。要下定论需在真机/dev build 上跑一次深链路由。但这不改变结论——既然 SDK 58 能干净解除，没有理由去赌 Metro 的行为。
2. **`eslint-plugin-react-hooks@7.1.1` 在 zod 4 下的运行时行为未逐条验**。已知事实只有它**自己声明** `^3.25.0 || ^4.0.0`（`npm view eslint-plugin-react-hooks@7.1.1 dependencies`，截至 2026-10-26），即 zod 4 在其**自述支持范围**内；但没跑过 `npm run lint` 全套。若日后真要落 zod override，这一项应与 `npx expo` 全链路一起验。
3. **`npx expo start` / `expo export` / 原生构建在 zod 4 下未做端到端验证**。§1.3 验的是 `@expo/cli` 里**唯一两处** `require("zod")` 的真实构建产物，覆盖了该包全部的 zod 消费点；但没跑完整的 Expo 命令。ADR 第 3 条要求的「先有人验一遍 `npx expo` 全链路」**本次仍未完成**。
4. **`node-forge` 上游 1.4.1 的发布时间不可预测**。`main` 的 `package.json` 是 `1.4.1-0`，4 个修复 PR 全 open。没有 release 计划、没有 milestone 可引用——**不要给这条写 ETA**。
5. **`electron` 42/43/44/45 与本仓 `contextIsolation` / preload 桥 / `electron-updater` 的兼容性未验**。本次只证明了 audit 口径下哪些版本干净，**没有**做打包冒烟。ADR 第 1 条要求的「走 `release.yml` 完整打包与安装包冒烟」仍是前置条件。
6. **ADR 第 5 条「两种 override 写法均静默不生效」的原始复现步骤未知**。本次在 npm 10.9.8 下两种根写法都生效，只有非根写法静默失效。无法判断当初测的是哪一种，故只能记录「无法复现」并给出最可能的解释（写进了非根 manifest），**不改写 ADR 原文**。
7. **`npm ci` 与 override 的交互**：本次实测「`package.json` 有 override、lock 未重算」时 `npm ci` 会**显式失败**（`EUSAGE: Invalid: lock file's decode-uri-component@0.2.2 does not satisfy decode-uri-component@0.5.1`），不是静默放过。这条是好消息（CI 会拦住漏重算 lock 的 override PR），但与本题无关，记在这里备查。

---

## 4. 给下一手的行动建议（不代替决策）

| 动作 | 前置 | 收益 |
|---|---|---|
| 抬 `electron` 声明到 `^42.11.16`（或更高） | 一次桌面端打包 + 安装包冒烟 | 9 → 8，且**这是唯一一条不需要上游配合的 high** |
| 推进 SDK 58（`expo ~58.0.19` / `expo-router ~58.0.26`） | 移动端全链路验真 + 原生重建 | 9 → 5（moderate 清零），且**顺带解掉 3 条** |
| 两项都做 + 暂不碰 zod | 无 | **5 条 high，全部 via node-forge** |
| 再叠加 `overrides: {"zod": "4.6.7"}` | 补 §3.2 / §3.3 两项验证 | 5 → 4，但越界 `@expo/cli` 声明区间 |
| `node-forge` | **无动作可做**，只能等上游发 > 1.4.0 | 等它发版即自动解除（`^1.4.0` 已能吃到 1.4.1，无需改 manifest） |
