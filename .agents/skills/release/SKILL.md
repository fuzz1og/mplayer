---
name: release
description: MPlayer 版本发布流程——发版前文档同步、版本递增、验证、推 tag 触发 CI 构建发布、更新 release 介绍。当用户说"发布"、"发版"、"打包发布"、"release"、要发新版本时使用。
---

# MPlayer 发布流程

当前发布 = 推 `v*` tag 触发 GitHub Actions（release.yml）自动构建 + 发布，不本地构建。

## 流程

1. **文档同步**（发版前必做，须在 bump / 打 tag / 触发 CI 构建之前完成）：**先调用 `writing-for-agents` skill**，再按 `references/doc-sync.md` 的清单逐类核对活文档；改完提交后再发版。
2. **一键发布**：`npm run release -- <patch|minor|major|版本号> [--skip-verify]`
   - 入口用 `npm run release`（`./scripts/release.sh` 是 shim；Windows 上别用 bash 调它——那个 bash 可能是 WSL 的，见 #500）
   - 内部按序执行：分支检查（必须 master）→ 验证（`scripts/verify.mjs`）→ `node scripts/version-bump.js`（同步 package.json / package-lock.json / app.json / mobile+core package.json 共 5 处）→ commit → push master → 打 tag → push tag
3. **监控构建**：`gh run list --workflow=release.yml --limit 1` 取 run id，再用 `gh run view <id> --json status,conclusion` 轮询（要分片状态就 `.jobs[]`）——`gh run watch` 每 20s 重印整棵 job 树，读回来几乎全是重复
4. **更新 release 介绍**：publish job 结束后，按 `.agents/skills/release-notes` 规格用详细文案覆盖自动生成介绍
5. **验证产物**：`gh release view <tag>`（桌面三平台 + APK `MPlayer-v{ver}.apk` + AAB `MPlayer-v{ver}.aab`，AAB 供上架 Google Play）

提交走文档直推（`docs:` 前缀直接 push `master`），不需要 issue 与 worktree。

**完成标准**：`master` 与 `origin/master` 一致、`git status` 干净，且已加载 `writing-for-agents` skill、`references/doc-sync.md` 的每一类都真的在代码里核过（不是"看起来对"）。

## 要点

- 版本号唯一来源是 `package.json`，bump 走 `version-bump.js`（**不要用** `npm version`，它只改 package.json 不同步其他文件）。
- 发布入口是 tag push；本地无需 `electron:build`（CI 三平台矩阵构建）。
- 构建失败：`gh run view <id>` 看日志；修复推 master 后 `git tag -f` + `git push --force origin <tag>` 重触发。
- 回滚：`git revert HEAD` 后删 tag（`git tag -d v<x>` + `git push origin :refs/tags/v<x>`）。
- 移动端检查更新走 GitHub API（`releases/latest`），发布后新版本即可被发现。
