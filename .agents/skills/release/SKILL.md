---
name: release
description: MPlayer 版本发布流程——发版前文档同步、版本递增、验证、推 tag 触发 CI 构建发布、更新 release 介绍。当用户说"发布"、"发版"、"打包发布"、"release"、要发新版本时使用。
---

# MPlayer 发布流程

当前发布 = 推 `v*` tag 触发 GitHub Actions（release.yml）自动构建 + 发布，不本地构建。

## 流程

1. **文档同步**（发版前必做，须在 bump / 打 tag / 触发 CI 构建之前完成）：**先调用 `writing-for-agents` skill**，用它的规则更新并同步全部活文档，再按下节清单逐类核对；改完提交后再发版。
2. **一键发布**：`./scripts/release.sh <patch|minor|major|版本号> [--skip-verify]`
   - 内部按序执行：分支检查（必须 master）→ 验证（`scripts/verify.sh`）→ `node scripts/version-bump.js`（同步 package.json / package-lock.json / app.json / mobile+core package.json 共 5 处）→ commit → push master → 打 tag → push tag
3. **监控构建**：`gh run list --workflow=release.yml --limit 1` / `gh run watch`
4. **更新 release 介绍**：publish job 结束后，按 `.agents/skills/release-notes` 规格用详细文案覆盖自动生成介绍
5. **验证产物**：`gh release view <tag>`（桌面三平台 + APK `MPlayer-v{ver}.apk` + AAB `MPlayer-v{ver}.aab`，AAB 供上架 Google Play）

## 文档同步（发版前）

**入口是 `writing-for-agents` skill**：先加载它、按它写（context pointer / 信息层级 / 剪除），本节的清单只规定 MPlayer 要核对**哪些**文档与事实。

发布前把活文档对齐到当前代码，避免 `README.md` / `AGENTS.md` / `CONTEXT.md` / `docs/agents/*` 的描述与实现脱节。

**只改活文档**：`docs/adr/` 的 ADR 与所有 `YYYY-MM-DD-<slug>.md` 存档（research / wayfinder / specs）是历史记录，不回改；决策变了另写一份 ADR。

逐类核对，每条都以代码为准：

1. **目录地图与清单**（最易腐烂）：`docs/agents/architecture.md` 的 components / hooks / stores / services 列表、`AGENTS.md` 与 `README.md` 的架构与目录描述 —— 对着 `ls`、`package.json`、`git grep` 逐条改。
2. **能力 / 数量陈述**：README 的「N 种播放模式」、Tab 数、详情页清单、技术栈版本；`docs/agents/domain.md` 的活文档份数与清单 —— 与实现、依赖版本、目录实际内容比对。
3. **测试与验证描述**：`docs/agents/testing.md` 的 setup mock 清单与四套件矩阵、`AGENTS.md` 的 `verify.sh` 覆盖范围 —— 与 `vite.config.ts` 的 `test` 段 / `vitest.main.config.ts` / `packages/*/vitest.config.ts` / `scripts/verify.sh` 对齐（**根目录没有 `vitest.config.ts`**）。
4. **截图与资产**：真机 / UI 截图传 PR comment、**不入库**；`docs/**/assets` 只留 ADR 正文引用的资产，无任何文档引用的孤儿截图直接 `git rm`。
5. **本轮行为变化**：命令 / 行为 / 架构有变时，同一批改动里更新 `AGENTS.md` / `CONTEXT.md` / 相关 ADR。
6. **常驻预算**：`AGENTS.md` 每轮都载入，只放「所有分支都要」的内容 + 指针；细节推给 `docs/agents/*` / `CONTEXT.md` / ADR。要新增长内容时先问它是否只服务某一条分支——是，就加指针、不要就地展开。
7. **`.github/` 模板与文档里对它的描述**：模板的段 / 勾选项 / 标题前缀的表述散在 `AGENTS.md`、`git-workflow.md`、`issue-tracker.md`，改模板时同批改描述——这类描述最容易被上一次改动落空（实测：删掉验证清单后 `AGENTS.md` 仍写着「验证清单含双端核对」）。

提交走文档直推（`docs:` 前缀直接 push `master`），不需要 issue 与 worktree。

**完成标准**：`master` 与 `origin/master` 一致、`git status` 干净，且已加载 `writing-for-agents` skill、上面每一类都真的在代码里核过（不是"看起来对"）。

## 要点

- 版本号唯一来源是 `package.json`，bump 走 `version-bump.js`（**不要用** `npm version`，它只改 package.json 不同步其他文件）。
- 发布入口是 tag push；本地无需 `electron:build`（CI 三平台矩阵构建）。
- 构建失败：`gh run view <id>` 看日志；修复推 master 后 `git tag -f` + `git push --force origin <tag>` 重触发。
- 回滚：`git revert HEAD` 后删 tag（`git tag -d v<x>` + `git push origin :refs/tags/v<x>`）。
- 移动端检查更新走 GitHub API（`releases/latest`），发布后新版本即可被发现。
