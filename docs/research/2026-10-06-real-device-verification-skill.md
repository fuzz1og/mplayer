# 真机验真 skill 调研：把 `mobile-device-debugging` 改成双端验真 skill

- 日期：2026-10-06 · 类型：调研（三路并行取证）
- 取证基线：`master` = `267deca`（1.8.7）
- 方法：① **会话复盘** —— 解码最近 120 个会话目录（31 个 top-level + 89 个 subagent），取最近 **20 个 top-level 工作会话**逐条读转录；② **桌面侧盘点** —— 读实现 + 抽样 40 个已合并 PR 的 `Evidence` 正文；③ **移动侧盘点** —— 逐个读 `scripts/*mobile*` 与 `e2e/`，与 skill 正文做逐条对照
- 目的：用户要把这个 skill 改成「**批准开发完任务之后做的真机验证**，桌面端和手机端都能用」。本文回答「现在差什么」，并给出目标形态；不含实现

## 0. 结论摘要

1. **现状是「一侧成体系，一侧偶发」**。20 个会话里 13 个有移动端设备证据（`adb` 命中合计 2881 次、单会话截图上限 88 张）；桌面端**只有 1 个**真正驱动了 Electron（`b83fe199`），打包产物（`MPlayer.exe` / `win-unpacked`）**一次都没跑过**。
2. **根因不在 skill，在策略**。`docs/agents/git-workflow.md:79` 只对 `packages/mobile|packages/core` 强制真机证据，**没有桌面条款**；PR 模板（`.github/PULL_REQUEST_TEMPLATE.md:22`）又接受「未做 + 一句原因」。于是「未做」是合规写法：`#567` 写「桌面实机点击确认：**未做**」、`#508` 写「**未做：未启动真 Electron**」。16/40 个近期合并 PR 碰过 `src/`，其中没有一条桌面真机证据。
3. **桌面侧的验真能力早已存在于仓库，只是没有家**：`scripts/start-electron-dev.mjs` + Playwright `connectOverCDP` 的四条前置写在 `docs/agents/testing.md:40-45`，而 `AGENTS.md:23` 给这份文档的指针是「**tsconfig/ESLint/测试配置**」——必读材料挂在措辞错误的指针后面（典型的 variance bug）。
4. **现行 skill 不是「验收流程」，是「设备操作手册」**：它从「连设备」开始，没有第 0 步「列出这次要证明什么」；完成标准写的是「App 连上了」（`:31`），而真正的不漏项判据藏在取证小节的从句里（`:35`）。所以「验收项漏到收尾才发现」发生了两次（`8b201176` 自述「其中两条在模拟器上本来就能验，是我没去做」、`75168ada` 被真人追问）。
5. **skill 不是没被用，是「读了之后仍手打」**：12/20 个 top-level 会话显式加载过它，但 `mobile-debug.mjs` / `mobile-e2e.mjs` 只在 WSL 回路被真跑过（2 个会话），11 个走雷电/原生 adb 的会话**零调用**——因为 skill 把 A/B 回路写成手打命令，脚本只挂在 C 回路。

## 1. 现行 skill 的问题（按 `writing-for-agents` 的尺度）

### 1.1 结构：它是流程，但流程是「操作」不是「证明」

`标准流程`（`:18-31`）是「连设备 → 起 Metro → 冷启看日志」，`完成标准`（`:31`）是「logcat 出现 `Running "main"` + 存量数据迁移完成」——**证的是「环境对了」，不是「这次改动对了」**。用户要的场景（任务批准后验真）缺两个环节：

- **第 0 步：把 issue 验收标准 / spec / PR diff 抄成「要证明什么」的清单**。没有这一步，验什么由现场心情决定。
- **第 4 步：逐项关闭**。现在只有 `取证` 开头一句「每个验收项配一条能看的证据；没有就写『未做 + 原因』」（`:35`）承担这个不留项的判据，位置在从属句里。

代价是实测的：20 个会话里两次「收尾才发现漏项」（`8b201176`、`75168ada` H90）。这条也是 issue 验收标准本身的要求——`docs/agents/issue-tracker.md:30`「完成标准可验收：每条能判『做了 / 没做』」。

### 1.2 层级：35% 的正文是扁平 reference，且完成标准放错了位置

| 小节 | 行数 | 字符 | 占比 |
|---|---|---|---|
| 标准流程 | 15 | 1395 | 9% |
| 取证 | 14 | 2089 | 14% |
| 验收准备别靠点触摸应用内 UI | 14 | 1082 | 7% |
| 图附到 PR | 13 | 1364 | 9% |
| dev build | 48 | 2728 | 18% |
| **陷阱速查** | 28 | **5249** | **35%** |

陷阱速查是 24 条扁平 bullet——按 `writing-for-agents`，「扁平 peer-set」本身不是坏结构，问题是：

- **实际重复 3 处**：CMake 250 字符对象路径上限出现在 `:136` 与 `:147`（同一意思两遍）；adb 抢 5037 出现在 `:124`、`:135`、`:143`；雷电自带 adb 出现在 `:124`、`:135`、`:143`。
- **散落 1 处**：「注入触摸点不动 RN `ScalePress`」在 `取证` §4（`:41`）说了一次并「见下节」，然后在专门小节（`:47-59`）再说一次。同一概念被切开，读一处拿不到全部。
- **沉积 1 处（8 行，~600 字符）**：`:113-120` 是一段 `> 更正（2026-09-30 · #477 收口）` 引文，纠正的是「release 会把 JS 日志剥掉」——**这句话在现行文件里已经不存在了**（全文件 grep `剥` 只命中这条更正自己）。要留的信息在 `:109` / `:111` 已经正面写清楚。这是最干净的一处可删。

体量增长也印证是加积而非修剪：`47 → 148` 行，15 笔提交里 4 笔以「补 … 陷阱 / 手法」命名，删行累计 46 行（其中一次 15/15 是位置搬移）。

### 1.3 触发：描述是症状清单，且没有桌面分支

`description` 列了 10 个触发短语，可归并的分支其实只有 4 个（验收取证 / 环境搭建 / 看日志 / 附证据到 PR），其余是同一分支的同义改写（`adb reverse`、`attach busy`、`Metro 500`…）。两个具体代价：

- **过触发**：「expo 起开发服务器」「Metro 连不上或报 500」是普通开发动作，会把这 14.9k 字符的设备知识load进来，而它自己的陷阱表就说这类根因常是「陈年 Metro 进程解析到仓库根」——与设备无关。
- **欠触发**：桌面端**一个字都没有**。名字 `mobile-device-debugging` 也不承载「验证」这个意图。

### 1.4 真值维护：skill 里三处陈述已经不成立

| skill 说 | 实际 |
|---|---|
| `:24`「**在 worktree 内**跑 `npx expo start`」 | 实测在 worktree 根起会 `ConfigError: Cannot resolve entry file`，且 Expo 会**改写根 `tsconfig.json`**（`75168ada`）——必须 `cd packages/mobile` |
| `:31` 完成标准含 Metro `metro:bundling:done` | 全仓**没有任何脚本**检测它（grep 只有 `mobile-debug.mjs:13` 的一句复述注释） |
| `:43`「`[perf]` warn…」量化证据 | 有专门的 `scripts/mobile-frame-stats.mjs`（系统侧帧计时），skill **一句都没提** |

外加两条仓库级漂移：`e2e/README.md:276` 仍要求 `python3`（`mobile-e2e.mjs` 早已改 JS，ADR `2026-09-29-ci-verification-boundary.md:76-77` 明说不需 python3）；`e2e/README.md:300` 写 hotlist-detail 断言 rank ≥8，而脚本已改成「共 N 首 + 播放全部 + rank ≥1」；`scripts/dev-mobile.mjs:25` 硬编码端口 **8091**，skill 全线用 **8081**，两者互不校验。

## 2. 真机验真真正缺的东西

### 2.1 桌面侧：没有「证据分层」，所以 Chromium + stub 冒充了 Electron

`8e654ca3`（#564/#565）的证据是 `page.addInitScript` 注入 stub `window.electronAPI` 后跑真实 Chromium——它确实定位到了真 bug（表头 24px 缝），但**证的层级是渲染层几何**，证不到 preload 桥、IPC 契约、缓存与主进程。`#517` 同样写「系统 Chrome + stub `window.electronAPI`」。

缺的不是工具（`scripts/start-electron-dev.mjs --remote-debugging-port=9222` + `connectOverCDP` 已可跑通：`b83fe199` 在 PR #538 用过一次，PR #513 的验收评论另留了一例），缺的是**规则**：什么改动允许 Chromium+stub，什么改动必须真 Electron。没有这条线，「等价环境」就成了万能挡箭牌。

### 2.2 桌面侧：跑一次真 Electron 的摩擦点（已核实）

- 12 个 `e2e/*.spec.ts` 全部走 `_electron.launch`，但**在 DSH 会话里白屏**（`testing.md:40`，唯一可行路径是 CDP）；且**没有 npm script**，`scripts/verify.mjs` 里也没有 e2e scope → 没有稳定入口。
- 规格腐化：`cover-e2e.spec.ts:16` 与 `cover-scenarios.spec.ts:16` 仍打 **5173**（Vite 是 5174）；`discover-v2.spec.ts:10` 指向已退役的自建 API；**12 个里 9 个**完全不传 `VITE_DEV_SERVER_URL`（只有 `player-bar-add-to-playlist.spec.ts:41` 传对），于是它们测的是**预构建的 `dist/index.html`**，不是工作副本。
- **身份锚在桌面端有个隐藏陷阱**（写 references 时新发现）：`vite.config.ts:53-54` 配了 `port: 5174` 但**没有 `strictPort`**，5174 被别的 checkout 占用时 Vite 会自增到 5175，而 `scripts/start-electron-dev.mjs:10` 照样注入 `VITE_DEV_SERVER_URL=http://localhost:5174` → 你驱动的其实是**另一个工作树的渲染层**，IPC 前缀校验也照放行、界面看起来完全正常。所以桌面身份锚的第 1 步是读 Vite 输出确认 `Local: http://localhost:5174/`。
- 另有两条目视修正：路由是 `createHashRouter`（不是 `HashRouter`），hash URL 结论不变；`data-testid` 并非完全没用（生产代码 1 处，`PlayerControls.tsx:57`），但稳定的钩子是 `.song-row` 这个 class。
- 主进程日志**没有文件落点**：`console.*` 只到 stdout/stderr（`start-electron-dev.mjs:32-35` 是 `stdio:'inherit'`）→ agent 拿不到主进程真相。
- **没有单实例锁**（`src/main` grep `requestSingleInstanceLock` = 0 命中）+ 关窗即隐藏（`src/main/main.ts:169-174`）→ 泄漏的实例会与下一次运行共享同一份 `%APPDATA%\mplayer`，取证被污染。

### 2.3 移动侧：缺「身份锚」的工具化，缺 4 条实测坑

最有价值的一条摩擦是 `12551668`：设备上跑的是**旧 APK**，`changed=true` 是假成功日志；靠**拉回设备 `base.apk` 扫 9 个 dex 找新符号**（`insertAfterCurrent` NOT FOUND）+ 比对 `dumpsys package` 的 `lastUpdateTime` 才把上一轮结论推翻。skill 的取证 §1 讲了这个**道理**（「先证明跑的是你的代码」），但没有这条**手法**。

另外 4 条实测坑 skill 未收（或收了一半）：

| 坑 | 证据 | 现状 |
|---|---|---|
| 深层 worktree 绕开 CMake 上限后，**短路径副本构建出的 APK 启动即崩**（`ClassNotFoundException: expo.modules.splashscreen`，autolinking 缺模块）；最终只能「主克隆里建临时分支构建」 | `75168ada` | 只收了 CMake 250 上限（`:136`/`:147`），读者照做会撞第二层 |
| Metro 起错目录 → `ConfigError` + **改写根 `tsconfig.json`** | `75168ada` | ❌ 未收，且现行措辞相反 |
| 多设备时**每条 adb 都要带 `-s <serial>`**（否则 `more than one device/emulator`） | `3784b8dc` | ❌ 未收 |
| 模拟器实例掉线（不只是 usbipd 掉线） | `75168ada` | ⚠️ 只收了 usbipd 那条 |

## 3. 跨会话重复的手工动作（脚本候选，按重复会话数）

| # | 序列 | 重复 | 现状 |
|---|---|---|---|
| A | `expo start --port N` → `reverse` → `force-stop` → `am start exp://` | **9** | `mobile-debug.mjs` 覆盖 4 步，但 A/B 回路**无人调用**；它缺 dev build 的 `mplayer://expo-development-client` 拉起分支 |
| B | `uiautomator dump` → `pull` → 解析**单行 XML** 取 `bounds` → `input tap` | **8** | 每个会话各写一份临时解析器；`3845c916` 因读不存在的 `ui13.xml` 崩过一次 |
| C | dev build：`gradlew` → `push`/`pm install` → `reverse` → 显式组件拉起 → 三条 `dumpsys` 自检 | **6** | 已在 PR **#582** 脚本化，但 **0 次真机运行** |
| D | adb server 抢救（找占用者 → 杀光 → 起 scoop 那个 → 重建 reverse） | 4–5 | 纯手打 |
| E | 截图 → `gh pr comment --attach` → 读回正文验引用 | **7** | 纯手打；`--attach` 28 次调用 **0 失败**（别为它加机制） |

## 4. 建议的目标形态

### 4.1 skill：一个双端验真 skill，按目标分支

名字要承载意图，`mobile-device-debugging` 改成 **`runtime-verification`**：两端共同的判别维度是「**证据来自哪个 runtime**」——移动端的 dev build 一节之所以存在，就是 Expo Go 验不了那一层；桌面端这次翻车的正是 Chromium+stub 冒充了 Electron。活文档引用共 12 处要改（`AGENTS.md:44,91`、`e2e/README.md:273`、`docs/agents/testing.md:77`、`docs/agents/git-workflow.md:27,75,79`、`docs/specs/ui-refactor-guide.md:336`、`packages/mobile/android/app/build.gradle:126`、`packages/mobile/services/dragJankProbe.ts:8`、`scripts/mobile-device/usb-attach.mjs:14`、`scripts/mobile-e2e.mjs:433`）；`docs/{adr,specs,wayfinder,research}` 的历史存档不回改。

正文形状（通用流程留在 `SKILL.md`，按端分支推下去——这是 `writing-for-agents` 的标准「按 variant 组织」）：

```text
.agents/skills/runtime-verification/
├── SKILL.md                  # 何时用/不用 + 第 0 步命题清单 + 选端 + 身份锚 + 证据强度 + 附 PR + 完成标准
├── references/
│   ├── desktop.md            # 证据分层（真 Electron / 打包产物 / Chromium+stub）/ 四条前置 / CDP 起窗口 / 主进程日志 / 桌面陷阱
│   └── mobile.md             # 三条回路 / 脚本优先的装配链 / 身份锚 / 取证 / dev build / 去重后的陷阱速查
└── scripts/                  # 「流程用文字确定，执行固定进脚本」
    ├── dev-build.mjs         # 沿用 #582 的编排（修掉 .bat spawn / 无 timeout / 自检时机 / reverse 吞错）
    ├── dev-build-rules.mjs   # 纯判据（零 I/O），可被 node --test 直接 import
    └── __tests__/dev-build.test.js
```

两端陷阱**分列在各自 references 里**，不另开一份共享 pitfalls：实测两边几乎不相交（移动是 adb / Metro / 原生构建，桌面是 CDP / preload / 打包），合成一个文件只会让两边的读者都翻一遍不需要的内容。

`SKILL.md` 的完成标准应直接对齐 PR 模板那一行（`.github/PULL_REQUEST_TEMPLATE.md:22`）：

> 命题清单里每一行都以 **PASS（附证据）** 或 **「未做 + 原因」** 收尾；证据引用的图都是上传后的 URL，本地路径残留 0。

这样「漏项在收尾才发现」在结构上就不可能——清单是第 0 步的产物，收尾只是逐行关闭。

### 4.2 策略：不给桌面端加条款，桌面分支就是装饰

skill 只在被触发时起作用。现在没有任何东西让 agent 在写桌面 PR 时想起「要不要验」。两种口径：

- **A（推荐）**：给 `git-workflow.md:79` 加桌面条款，并要求 Evidence 里**写明证据来自哪一层**（`真 Electron` / `打包产物` / `Chromium+stub` / `未做`）。
- **B（保守）**：只写 skill，不改策略——那就要接受「桌面侧继续是偶发」。

`8e654ca3`（Chromium+stub）与 `b83fe199`（真 Electron）正好是两层的正反样本，分层判据可以照抄：**碰 `src/main`、preload、IPC 契约、打包/更新器 → 必须真 Electron 或打包产物；纯 renderer 几何/样式 → Chromium+stub 可接受，但要在 Evidence 里写明**。

### 4.3 执行顺序（收益 / 风险）

1. **纯文档**（零风险，可独立落）：修 `:24` 的 Metro 目录口径、删 `:113-120` 沉积、去 `:136`/`:147` 与 5037 的重复、补 4 条未收坑、修 `e2e/README.md` 两处漂移。
2. **skill 重构**（中）：改名 + 双端分支 + 第 0 步命题清单 + 脚本升为主入口。需处理与 **PR #582** 的冲突——它改的正是同一个文件（把 dev build 搬进包内 `scripts/`），且它自己的 PR 正文与 issue #581 验收标准仍写 `npm run mobile:dev-build`，而 head `570eb1a` 已经把这条 npm 别名删了。
3. **新脚本**（按收益排序）：`ui.mjs`（8 会话重复、风险最低）> `verify-source.mjs`（把取证 #1 从一段话变成一条命令）> `adb-reset.mjs` > 桌面 `verify-desktop.mjs`（依赖 `--tee` 与 `--user-data-dir` 两个前置）。
4. **`e2e:desktop` npm script + 12 个 spec 的分诊**（消除「没有稳定入口」与「测的是 dist 不是工作副本」）。

## 5. 反证（不要过度纠正）

- **`gh pr --attach` 是稳的**：9 个会话、28 次调用、**0 失败**。「临时目录报 not a git repository」在本窗口内只作为文档被引用，没实际踩到——不要为它加机制。
- **`uiautomator dump` 不是普遍坏**：静态页大量成功（一次调用即定位到带 `bounds` 的元素；某会话 36 次大多成功）。失败严格限于动画界面——不要改成「别用 dump」。
- **`adb install` 卡死不是普适的**：真机经 WSL 直连时反复用过且会话继续推进。触发条件是「80MB 流式安装 + 抢 5037」——不要升级成「永不许用」。
- **5037 争抢在本窗口内已被压住**：单一 adb server 的重置已生效；后续摩擦是设备掉线 / 端口，不是 5037。
- **skill 是被用的**：12/20 top-level 会话显式加载过它。问题不是「没人读」，是「读了之后仍手打」——所以处置应该是把脚本升为主入口，而不是再加一节散文。
- **Chromium + stub 不是无用功**：它抓到过真 bug。要补的是分层声明，不是禁令。
- **发布类会话没有设备工作是正常的**：验收对象是 CI / release 产物。
- **「未做」大多是如实写的**：`3260e291` 明写「真机验收是人工步骤，未做，不声称做了」。真实缺陷是「漏项发现得太晚」，不是「谎报已验」。

## 6. 已定 / 待定（2026-10-06 拍板）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 桌面「真机」的范围 | **开发态真 Electron 窗口为主**（CDP 驱动真实窗口 + 截图 + 主进程日志），**打包产物冒烟作为条件分支**——只在改动触及打包 / 更新器 / asar / preload 时走 |
| 2 | skill 名字 | **`runtime-verification`**——名字即中心思想「证据来自哪个 runtime」。备选 `real-device-verification`（沿用语料里的「真机」，但名字里仍然只有移动端那半）被否 |
| 3 | 与 PR #582 的关系 | **已关闭**（评审后有 2 个硬缺陷：Windows 上 `.bat` 经 `spawnSync` 直起必 `EINVAL` → gradle 出不来且报错误诊为「路径太长」；三条 `dumpsys` 自检在流程内不可达 → 恒 `exit 1` 假失败）。判据模块 `dev-build-rules.mjs` + 6 个用例 + SKILL.md 的改写形状**沿用**进新 skill。issue #581 继续有效 |
| 4 | `git-workflow.md:79` 桌面条款 | **加**：碰 `src/main` / preload / IPC 契约 / 打包更新器 → 必须真 Electron 或打包产物；纯 renderer 几何 / 样式 → Chromium + stub 可接受，但 Evidence 必须**写明证据来自哪一层** |

§4.1 的目录结构随之确定；名字定了就能改名（8 处活文档引用）。

### 附：#582 的评审留痕

缺陷清单与证据在 PR #582 的评论里（`gh pr view 582 --comments`）。两条硬缺陷都属「没在真机上跑过一次」的直接代价，可作为新 skill「完成标准必须真跑一次才算数」的实例。

## 附录：证据索引

本轮取证的三份工作产物留在会话临时目录（`%TEMP%\mplayer-retro\`），**不入库**——本文是它们的结论，原始转录带会话 id 与现场日志，属一次性材料；要复核同一条结论时按同一方法重跑解码工具即可。

- 会话复盘（20 个 top-level 会话覆盖表、摩擦清单、重复动作、反证 8 条）：`retro-device-verification.md`
- 桌面侧盘点（能力表、12 步端到端、G1–G10 缺口、5 个方案排序、PR 正文样本）：`desktop-verification-survey.md`
- 移动侧盘点（脚本表、`e2e` 覆盖、`SKILL.md` 步骤 → 自动化映射、漂移 8 条）：`mobile-automation-inventory.md`
- 解码工具：`extract.py` —— 会话日志是多帧 zstd，`zlib.zstdDecompressSync` 只解得出第一帧（约 276B 的会话头）并静默给出无用结果；要用 `zstandard` 的 `stream_reader(fh, read_across_frames=True)`。
