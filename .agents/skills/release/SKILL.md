---
name: release
description: MPlayer 版本发布流程——发版前文档同步、版本递增、验证、推 tag 触发 CI 构建发布、更新 release 介绍。当用户说"发布"、"发版"、"打包发布"、"release"、要发新版本时使用。
---

# MPlayer 发布流程

当前发布 = 推 `v*` tag 触发 GitHub Actions（release.yml）自动构建 + 发布，不本地构建。

## 流程

1. **文档同步**（发版前必做，步骤见下节）：把活文档对齐到当前代码，改完提交后再发。
2. **一键发布**：`./scripts/release.sh <patch|minor|major|版本号> [--skip-verify]`
   - 内部按序执行：分支检查（必须 master）→ 验证（`scripts/verify.sh`）→ `node scripts/version-bump.js`（同步 package.json / package-lock.json / app.json / mobile+core package.json 共 5 处）→ commit → push master → 打 tag → push tag
3. **监控构建**：`gh run list --workflow=release.yml --limit 1` / `gh run watch`
4. **更新 release 介绍**：publish job 结束后，按 `.agents/skills/release-notes` 规格用详细文案覆盖自动生成介绍
5. **验证产物**：`gh release view <tag>`（桌面三平台 + APK 命名 `MPlayer-v{ver}.apk`）

## 文档同步（发版前）

发布前把活文档对齐到当前代码，避免 README / AGENTS.md / `docs/agents/*` 的描述与实现脱节。

**只改活文档**：`docs/adr/` 的 ADR 与所有 `YYYY-MM-DD-<slug>.md` 存档（research / wayfinder / specs）是历史记录，不回改；决策变了另写一份 ADR。

逐类核对，每条都以代码为准：

1. **目录地图与清单**（最易腐烂）：`docs/agents/architecture.md` 的 components / hooks / stores / services 列表、`AGENTS.md` 与 `README.md` 的架构与目录描述 —— 对着 `ls`、`package.json`、`git grep` 逐条改。
2. **能力 / 数量陈述**：README 的「N 种播放模式」、Tab 数、详情页清单、技术栈版本 —— 与实现和依赖版本比对。
3. **测试与验证描述**：`docs/agents/testing.md` 的 setup mock 清单、`AGENTS.md` 的 `verify.sh` 覆盖范围 —— 与 `vitest.config.ts` / `scripts/verify.sh` 对齐。
4. **截图与资产**：真机 / UI 截图传 PR comment、**不入库**；`docs/**/assets` 只留 ADR 正文引用的资产，无任何文档引用的孤儿截图直接 `git rm`。
5. **本轮行为变化**：命令 / 行为 / 架构有变时，同一批改动里更新 `AGENTS.md` / `CONTEXT.md` / 相关 ADR。

提交走文档直推（`docs:` 前缀直接 push `master`），不需要 issue 与 worktree。

**完成标准**：`master` 与 `origin/master` 一致、`git status` 干净，且上面每一类都真的在代码里核过（不是"看起来对"）。

## 要点

- 版本号唯一来源是 `package.json`，bump 走 `version-bump.js`（**不要用** `npm version`，它只改 package.json 不同步其他文件）。
- 发布入口是 tag push；本地无需 `electron:build`（CI 三平台矩阵构建）。
- 构建失败：`gh run view <id>` 看日志；修复推 master 后 `git tag -f` + `git push --force origin <tag>` 重触发。
- 回滚：`git revert HEAD` 后删 tag（`git tag -d v<x>` + `git push origin :refs/tags/v<x>`）。
- 移动端检查更新走 GitHub API（`releases/latest`），发布后新版本即可被发现。
