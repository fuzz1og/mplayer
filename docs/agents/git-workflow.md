# Git workflow: issue → worktree → PR

进 `master` 只有两条路，先按改动性质分流：

- **默认走 worktree 路径** —— 一切非文档类修改（feat / **fix** / chore / refactor / test / perf，修 bug 与做功能同待遇）。流程：开/认领 issue → 从最新 `master` 建 worktree → 实现 + 验证 → 推分支开 PR → CI 绿后交人工审核。**agent 到此为止，不自行合并。**
- **例外是文档直推** —— 只改 Markdown（`*.md`、`docs/**`，含 AGENTS.md / GLOSSARY.md / ADR）且不碰代码、配置、依赖时，可在主克隆直接 commit + push `master`，commit 前缀 `docs:`，无需 issue。代码+文档混合改动不算文档类，整单走 worktree 路径。

## 1. 认领工作

- 动手前确认有对应 GitHub issue；没有就先建（操作命令见 `issue-tracker.md`）。认领已有 issue 就 assign 自己。
- **issue 标题用模板预置前缀**（`[Bug]:` / `[Feature]:`，见 `.github/ISSUE_TEMPLATE/`），不要套 `type(scope)` —— 那套只用于 commit 与 PR 标题。
- 涉及跨端契约、IPC 协议、来源路由策略这类架构取舍：先写 ADR（`docs/adr/`）再动工。

## 2. 开 worktree

```bash
git fetch origin
git worktree add .claude/worktrees/<slug> -b <type>/<slug> origin/master
cd .claude/worktrees/<slug>
```

完成标准：worktree 已建好，新分支基于最新 `origin/master`。

- 分支命名 `<type>/<slug>`：`feat/` `fix/` `docs/` `chore/` `refactor/` `perf/`（与 commit type 同表；`perf/` 是本仓既有的性能类分支前缀），slug 用短英文（如 `fix/mobile-parity-tier3`）。
- 一个任务一个新 worktree + 新分支；不在旧分支上叠新工作。
- `.claude/worktrees/` 已 gitignore，是默认的 worktree 位置。
- worktree 缺 node_modules 就地 `npm install`，不要从主克隆复制（依赖漂移）；软链同理——真机调试时 `expo-router` 按「被转换文件的真实路径」反推 app root，会把源码解析回主克隆、打包到主克隆的 `app/`（见 `mobile-device-debugging` skill）。
- **跳过 `npm install` 会让类型检查静默对着主克隆的 core 跑**：worktree 没有自己的 `node_modules` 时，`@mplayer/core` 会沿目录向上解析到主克隆的 `node_modules/@mplayer/core`（指向主克隆的 `packages/core`），于是 `typecheck` / `typecheck:mobile` 检查的是**主克隆的 core，而不是你正在改的那份**——改了 core 的公开接口却全绿（或反之报一堆莫名其妙的错）都出自这里。绕开安装只做局部验证时，**以 CI 为准**（CI 会 `npm ci` + `core:build`）。
- **rebase 到「动过 `packages/core` 的新 master」之后必须重跑 `core:build`**：Metro 吃 `packages/core/dist`，而 TypeScript 从 `core/src` 解析——两条路不一致时 `typecheck` 与 CI **全绿**，真机却 **runtime undefined** 崩在第一个用到新导出量的地方（实测：#507 把 `COVER_SIZE` 加进 core，rebase 后未重建 dist 的 worktree 首启直接 `Render Error: Cannot read property 'row' of undefined`）。`npm run core:build` + 重启 Metro 即解；CI 之所以看不出来，是因为它每步都先 `core:build`。
- 调试/测试必须在 worktree 内构建运行，不要 cd 回主克隆目录（缓存不一致难排查）。
- **Metro 必须在 `packages/mobile` 里起**，不要在 worktree 根目录跑 `npx expo start`：根 `package.json` 的 `main` 指不到 app 入口（`ConfigError: Cannot resolve entry file`），而且 Expo 会顺手改写根 `tsconfig.json`（`extends` 改成 `expo/tsconfig.base`）并把 worktree 弄脏——记得 `git checkout -- tsconfig.json`。
- 新 worktree 检出的 `scripts/*.sh` 在本机 Windows（`core.autocrlf=true`）**被检出成 CRLF** —— git 里存的本来就是 LF，仓库 `.gitattributes` 已对 `*.sh` 固定 `eol=lf`（若你看到 CRLF，说明本机是 `.gitattributes` 生效前克隆的，重新克隆即可）。CRLF 会让 `bash scripts/*.sh` 直接报 `$'\r': command not found` / `syntax error`；就地归一成 LF 再跑即可。这只改工作区、不改仓库内容，**不需要**为此做 `git checkout` 或把它排除在提交之外。**验证入口已不吃这一条**：`verify` / `design-lint` 是 Node 脚本（#500），CRLF 只影响剩余的真 bash 脚本（`release.sh` / `mobile-*.sh`）。
- **Windows 上不要用 `bash` 跑验证**：`Get-Command bash` 的第一顺位常常是 `C:\WINDOWS\system32\bash.exe`（WSL），于是 WSL 的 **Linux** node 去用 Windows 装的 `node_modules` —— 报错却落成 `Cannot find module @rollup/rollup-linux-x64-gnu`，完全不指向成因（#500）。用 `npm run verify -- <scope>`；`verify.mjs` 起跑前会自检平台并直接给出人话提示。

## 3. 实现并验证

在 worktree 内跑全量验证，全绿才算任务完成：

```bash
npm run verify        # 全量（Windows / PowerShell / cmd / Git Bash 通用；实现在 scripts/verify.mjs）
./scripts/verify.sh   # 等价写法（两行 shim，转调 scripts/verify.mjs）
                      # 全量：static（core:build → lint → design-lint → 双端 typecheck → build）
                      #      + renderer / main / core / mobile 四套测试 + expo（SDK 依赖一致性）
                      #      也可只跑某个 scope：npm run verify -- static
```

改了 `packages/core` 不需要额外步骤：`verify` 每个 scope 都会先 `core:build`（Metro 与测试吃 dist 产物，不重建等于白改）。验证项与 CI job 的对应关系见 `docs/agents/testing.md` 的矩阵与 ADR `docs/adr/2026-09-29-ci-verification-boundary.md`。

## 4. 提交

Commit 信息用 Conventional Commits：`type(scope): 中文描述`。type 取 feat/fix/docs/chore/refactor/test/perf；scope 取涉及端（core/desktop/mobile/ci），多端逗号并列（如 `feat(core,desktop): …`），与现有历史一致。

- 一个 commit 讲一件事；纯格式化/重命名不与行为改动混提。
- commit 里关联 issue（`Closes #N`，合并时自动关闭）。
- 敏感信息不入库：tier3 订阅地址、个人 API key、本地真实缓存数据不进 commit。

## 5. 开 PR

```bash
git push -u origin <branch>
# 正文先写进临时文件；gh 不会自动套模板，别把模板文件本身当 --body-file
gh pr create --base master --title "<type(scope): 中文摘要>" --body-file /tmp/pr-body.md
```

- **PR 模板是唯一事实源**：正文按 `.github/PULL_REQUEST_TEMPLATE.md` 的段写（一句话 / 要重点看什么 / 验证证据 / 深挖），流程文档只引用、不重写模板内容。**会话里挂载的外部/harness skill（如 `pr`）给的模板段名不同时，以本仓模板为准**，不要套用外部模板——它对别的仓成立，对本仓就是漂移。`gh` **不会**自动套模板——把模板文件直接当 `--body-file` 提交的是模板原件，必须自己按段填。
- **面向人写，不写工作日志**：先给结论（改了什么、要 reviewer 做什么），再给细节；一段一个意思；箭头链、名词堆叠与 `文件:行` 留给 ADR 与 issue。**正文预算 ≤ 40 行 / ≤ 1500 字**，CI 已证明的（lint / typecheck / 四套测试 / `core:build` / `build`）不要抄。
- **长文去该去的地方**：取舍与方案对比写 ADR，排查过程写 issue 评论，正文只留 reviewer 决策所需——**只链接，不复述**。
- **PR 之前 issue 要可开工**：`Fixes #N` 指向的 issue 应已带 `ready-for-agent`（验收标准明确）；纯文档 / chore / 依赖升级 / 紧急修复不受此限。
- **自动关闭 issue 靠关闭关键字**：`Fixes #N` / `Closes #N` / `Resolves #N` 必须**独立成行、前后留白**——粘在中文标点后面（`「…」。Fixes #123。`）不会被识别；`Refs #N` 只是引用、**不关闭**；标题里的 `（#123）` 也不算。要关就写 `Closes`，并同时写进提交信息（见 §4）。
- **合并前自查关闭引用**：`gh pr view <N> --json closingIssuesReferences`，**为空不要慌**——该字段在 PR **创建时**解析，实测会漏（#506 创建时为空、合并后 #491 **照常自动关闭**）。判据仍是关键字**独立成行、前后留白**；`Refs #N` 与标题里的 `（#N）` 不算。事后改正文**不会回填**这个字段（别靠改正文去「修」它）。要确定性，仍在正文补一行「合并后请手动关闭 #N」当兜底。
- **`--base` 必须是 `master`**：`ci.yml` 的 `pull_request.branches` 只监听 `master`，**base 指向功能分支的「堆叠 PR」拿不到任何 CI**（`gh pr checks` 回 `no checks reported`），等于绕过硬门槛。需要「B 依赖 A 的改动」时：分支照旧从 A 的分支起（或 rebase 到它），但 PR 的 base 用 `master`，正文写明依赖与合并顺序——A 合并后本 PR 的 diff 会自动收敛到只剩自己的改动。⚠️ **改 base 不会重跑 CI**（Actions 只认 opened / synchronize / reopened），要触发就 push 一次或 close + reopen。
- **验证以 CI 为准**：`check` + 四个 `test` + `expo-check` 绿是硬门槛（**CI 红不合**）。正文只勾 CI 证明不了的两条（真机 / UI 证据、文档同步），不要逐条抄 lint / typecheck / 测试 / `core:build`。
- 截图 / 录屏传 **PR 正文或验收评论**（`gh pr edit <PR> --attach '<png>#<图注>'` / `gh pr comment <PR> --attach '<png>#<图注>'`，两者同一套机制：正文里没被引用的附件会追加到末尾，排版走两步法，见 `mobile-device-debugging` skill），**不入库** `docs/**/assets` —— 仓库只留活文档，以及 ADR 正文引用的资产。**追加一条验收评论**（不动 PR 正文）用后者；正文用模板结构时尤其别把图塞进正文。
- **附图后要验引用**：读回来逐个检查（正文 `gh pr view <PR> --json body --jq .body`，评论 `gh api repos/{owner}/{repo}/issues/comments/<id> --jq .body`）——每个图片引用都必须是 `user-attachments` URL，残留本地路径就是裂图；公开仓库可再抓一次 PR 页面 HTML 确认 asset id 在渲染产物里。
- **CI 绿后停在人审**：PR 交给人工 review 与合并，agent 不自行合并、不设 auto-merge。收到 review 意见回本 worktree 继续修，push 自动更新同一 PR。
- 改了 `packages/mobile` 或 `packages/core` 的 PR 必须附真机验收结论与**证据图**（没上真机就照实写「未做 + 原因」，不许写「已附截图」而没附；流程见 `.agents/skills/mobile-device-debugging`；固化断言可跑 `npm run mobile:e2e` 一条龙，见 `e2e/README.md`）。
- 行为/命令/架构有变化的，同一个 PR 里更新 AGENTS.md / GLOSSARY.md / 相关 ADR。
- **分支可能被并发会话动过**：`--force-with-lease` 被拒（`stale info`）就是「远端有你没见过的提交」的信号——先 `git log --oneline HEAD..origin/<branch>` 看多了什么，再决定 merge 还是真的覆盖；直接重试会覆盖别人的提交。
- 开 PR 前先合入最新 `origin/master`，冲突就地解决。

## 6. 人工合并后清理

人工 merge 进 `master` 之后，回主克隆执行：

```bash
git pull origin master
git worktree remove .claude/worktrees/<slug>
git branch -d <type>/<slug>
git push origin --delete <type>/<slug>   # 远端未随合并自动删除时
```

完成标准：worktree、本地与远程分支均已删除，主克隆在最新 `master`。squash 合并后 `-d` 会报未合并，用 `-D`。