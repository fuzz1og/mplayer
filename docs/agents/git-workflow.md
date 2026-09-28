# Git workflow: issue → worktree → PR

进 `master` 只有两条路，先按改动性质分流：

- **默认走 worktree 路径** —— 一切非文档类修改（feat / **fix** / chore / refactor / test / perf，修 bug 与做功能同待遇）。流程：开/认领 issue → 从最新 `master` 建 worktree → 实现 + 验证 → 推分支开 PR → CI 绿后交人工审核。**agent 到此为止，不自行合并。**
- **例外是文档直推** —— 只改 Markdown（`*.md`、`docs/**`，含 AGENTS.md / CONTEXT.md / ADR）且不碰代码、配置、依赖时，可在主克隆直接 commit + push `master`，commit 前缀 `docs:`，无需 issue。代码+文档混合改动不算文档类，整单走 worktree 路径。

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

- 分支命名 `<type>/<slug>`：`feat/` `fix/` `docs/` `chore/` `refactor/`，slug 用短英文（如 `fix/mobile-parity-tier3`）。
- 一个任务一个新 worktree + 新分支；不在旧分支上叠新工作。
- `.claude/worktrees/` 已 gitignore，是默认的 worktree 位置。
- worktree 缺 node_modules 就地 `npm install`，不要从主克隆复制（依赖漂移）；软链同理——真机调试时 `expo-router` 按「被转换文件的真实路径」反推 app root，会把源码解析回主克隆、打包到主克隆的 `app/`（见 `mobile-device-debugging` skill）。
- **跳过 `npm install` 会让类型检查静默对着主克隆的 core 跑**：worktree 没有自己的 `node_modules` 时，`@mplayer/core` 会沿目录向上解析到主克隆的 `node_modules/@mplayer/core`（指向主克隆的 `packages/core`），于是 `typecheck` / `typecheck:mobile` 检查的是**主克隆的 core，而不是你正在改的那份**——改了 core 的公开接口却全绿（或反之报一堆莫名其妙的错）都出自这里。绕开安装只做局部验证时，**以 CI 为准**（CI 会 `npm ci` + `core:build`）。
- 调试/测试必须在 worktree 内构建运行，不要 cd 回主克隆目录（缓存不一致难排查）。
- 新 worktree 检出的 `scripts/*.sh` 在本机（`core.autocrlf=true` 且脚本以 CRLF 入库）**带 CRLF**，`bash scripts/verify.sh` 会直接报 `$'\r': command not found` / `syntax error`。就地归一成 LF 再跑；`git status` 会因此显示这 6 个脚本被改，**提交前 `git checkout -- scripts/` 还原**，不要把它们混进业务 PR。

## 3. 实现并验证

在 worktree 内跑全量验证，全绿才算任务完成：

```bash
./scripts/verify.sh   # lint → design-lint → 双端 typecheck → test:run；加 fast 跳过测试
```

改了 `packages/core` 追加：`npm run core:build` 后重跑验证（Metro 吃 dist 产物，不重建等于白改）。

## 4. 提交

Commit 信息用 Conventional Commits：`type(scope): 中文描述`。type 取 feat/fix/docs/chore/refactor/test/perf；scope 取涉及端（core/desktop/mobile/ci），多端逗号并列（如 `feat(core,desktop): …`），与现有历史一致。

- 一个 commit 讲一件事；纯格式化/重命名不与行为改动混提。
- commit 里关联 issue（`Closes #N`，合并时自动关闭）。
- 敏感信息不入库：tier3 订阅地址、个人 API key、本地真实缓存数据不进 commit。

## 5. 开 PR

```bash
git push -u origin <branch>
gh pr create --base master --title "<type(scope): 中文摘要>" --body-file .github/PULL_REQUEST_TEMPLATE.md
```

- **PR 模板是唯一事实源**：正文一律用 `.github/PULL_REQUEST_TEMPLATE.md`（四段：变更内容 / 关联 issue / 验证 / 备注），流程文档只引用、不重写模板内容，不要在 `--body` 里手写别的格式。
- 验证清单逐项勾选（双端核对）：`core:build`、双端 typecheck、真机验收、UI 截图、文档同步。**CI 红不合**：验证顺序绿且 CI 绿才进入下一步。
- 截图 / 录屏传 **PR 正文或验收评论**（`gh pr edit <PR> --attach '<png>#<图注>'` / `gh pr comment <PR> --attach '<png>#<图注>'`，两者同一套机制：正文里没被引用的附件会追加到末尾，排版走两步法，见 `mobile-device-debugging` skill），**不入库** `docs/**/assets` —— 仓库只留活文档，以及 ADR 正文引用的资产。**追加一条验收评论**（不动 PR 正文）用后者；正文是模板四段结构时尤其别把图塞进正文。
- **附图后要验引用**：读回来逐个检查（正文 `gh pr view <PR> --json body --jq .body`，评论 `gh api repos/{owner}/{repo}/issues/comments/<id> --jq .body`）——每个图片引用都必须是 `user-attachments` URL，残留本地路径就是裂图；公开仓库可再抓一次 PR 页面 HTML 确认 asset id 在渲染产物里。
- **CI 绿后停在人审**：PR 交给人工 review 与合并，agent 不自行合并、不设 auto-merge。收到 review 意见回本 worktree 继续修，push 自动更新同一 PR。
- 改了 `packages/mobile` 或 `packages/core` 的 PR 必须附真机验收结论与**证据图**（没上真机就照实写「未做 + 原因」，不许写「已附截图」而没附；流程见 `.agents/skills/mobile-device-debugging`；固化断言可跑 `npm run mobile:e2e` 一条龙，见 `e2e/README.md`）。
- 行为/命令/架构有变化的，同一个 PR 里更新 AGENTS.md / CONTEXT.md / 相关 ADR。
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
