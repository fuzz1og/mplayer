---
name: release
description: MPlayer 版本发布流程——版本递增、验证、推 tag 触发 CI 构建发布、更新 release 介绍。当用户说"发布"、"发版"、"打包发布"、"release"、要发新版本时使用。
---

# MPlayer 发布流程

当前发布 = 推 `v*` tag 触发 GitHub Actions（release.yml）自动构建 + 发布，不本地构建。

## 流程

1. **一键发布**：`./scripts/release.sh <patch|minor|major|版本号> [--skip-verify]`
   - 内部按序执行：分支检查（必须 master）→ 验证（`scripts/verify.sh`）→ `node scripts/version-bump.js`（同步 package.json / package-lock.json / app.json / mobile+core package.json 共 5 处）→ commit → push master → 打 tag → push tag
2. **监控构建**：`gh run list --workflow=release.yml --limit 1` / `gh run watch`
3. **更新 release 介绍**：publish job 结束后，按 `.agents/skills/release-notes` 规格用详细文案覆盖自动生成介绍
4. **验证产物**：`gh release view <tag>`（桌面三平台 + APK 命名 `MPlayer-v{ver}.apk`）

## 要点

- 版本号唯一来源是 `package.json`，bump 走 `version-bump.js`（**不要用** `npm version`，它只改 package.json 不同步其他文件）。
- 发布入口是 tag push；本地无需 `electron:build`（CI 三平台矩阵构建）。
- 构建失败：`gh run view <id>` 看日志；修复推 master 后 `git tag -f` + `git push --force origin <tag>` 重触发。
- 回滚：`git revert HEAD` 后删 tag（`git tag -d v<x>` + `git push origin :refs/tags/v<x>`）。
- 移动端检查更新走 GitHub API（`releases/latest`），发布后新版本即可被发现。
