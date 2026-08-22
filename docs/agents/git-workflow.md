# Git workflow: issue → worktree → PR

功能开发的标准路径：**开/认领 issue → 从最新 `master` 新建本地 worktree → 在 worktree 内实现并验证 → 推分支开 PR → 合并后清理**。所有变更经 PR 进入 `master`。

## 1. 认领工作

- 动手前确认有对应 GitHub issue；没有就先建（操作命令见 `issue-tracker.md`）。认领已有 issue 就 assign 自己。
- 涉及跨端契约、IPC 协议、来源路由策略这类架构取舍：先写 ADR（`docs/adr/`）再动工。

## 2. 开 worktree

```bash
git fetch origin
git worktree add .claude/worktrees/<slug> -b <type>/<slug> origin/master
cd .claude/worktrees/<slug>
```

完成标准：worktree 已建好，新分支基于最新 `origin/master`。

- 分支命名 `<type>/<slug>`：`feat/` `fix/` `docs/` `chore/` `refactor/`，slug 用短英文（如 `fix/mobile-parity-tier3`）。
- 一个功能一个新 worktree + 新分支；不在旧分支上叠新工作。
- `.claude/worktrees/` 已 gitignore，是默认的 worktree 位置。
- worktree 缺 node_modules 就地 `npm install`，不要从主克隆复制（依赖漂移）。
- 调试/测试必须在 worktree 内构建运行，不要 cd 回主克隆目录（缓存不一致难排查）。

## 3. 实现并验证

在 worktree 内跑完仓库验证顺序，全绿才算任务完成：

```bash
npm run lint && npm run typecheck && npm run test:run
```

改了 `packages/core` 追加：`npm run core:build` → mobile typecheck → mobile vitest（Metro 吃 dist 产物，不重建等于白改）。

## 4. 提交

Commit 信息用 Conventional Commits：`type(scope): 中文描述`。type 取 feat/fix/docs/chore/refactor/test/perf；scope 取涉及端（core/desktop/mobile/ci），多端逗号并列（如 `feat(core,desktop): …`），与现有历史一致。

- 一个 commit 讲一件事；纯格式化/重命名不与行为改动混提。
- commit 里关联 issue（`Closes #N`，合并时自动关闭）。
- 敏感信息不入库：tier3 订阅地址、个人 API key、本地真实缓存数据不进 commit。

## 5. 开 PR

```bash
git push -u origin <branch>
gh pr create --base master --title "<type(scope): 中文摘要>" --body "$(cat <<'EOF'
## 做了什么

## 为什么
（关联 issue，写 Closes #N）

## 怎么验证的
（贴 lint/typecheck/test 结果或手动步骤）
EOF
)"
```

- 描述三段齐全：做了什么 / 为什么 / 怎么验证的。**CI 红不合**：验证顺序绿且 CI 绿才算可合并。
- 改了 `packages/mobile` 或 `packages/core` 的 PR 必须附真机验收结论（流程见 `.agents/skills/mobile-device-debugging`）。
- 行为/命令/架构有变化的，同一个 PR 里更新 AGENTS.md / CONTEXT.md / 相关 ADR。
- 开 PR 前先合入最新 `origin/master`，冲突就地解决。
- review 意见继续在本 worktree 修，push 自动更新同一 PR。

## 6. 合并后清理

回主克隆执行：

```bash
git pull origin master
git worktree remove .claude/worktrees/<slug>
git branch -d <type>/<slug>
git push origin --delete <type>/<slug>   # 远端未随合并自动删除时
```

完成标准：worktree、本地与远程分支均已删除，主克隆在最新 `master`。squash 合并后 `-d` 会报未合并，用 `-D`。
