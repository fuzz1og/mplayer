---
name: release
description: MPlayer 发版全流程——文档同步、验证、bump、推 tag 触发 CI 构建、release 介绍规格。要发新版本时用。
---

# MPlayer 发布流程

当前发布 = 推 `v*` tag 触发 GitHub Actions（release.yml）自动构建 + 发布，不本地构建。

## 流程

1. **文档同步**（发版前必做，须在 bump / 打 tag / 触发 CI 构建之前完成）：**先调用 `writing-for-agents` skill**，再按 `.agents/skills/release/references/doc-sync.md` 的清单逐类核对活文档；改完提交后再发版。
2. **一键发布**：`npm run release -- <patch|minor|major|版本号> [--skip-verify]`
   - 入口用 `npm run release`（`./scripts/release.sh` 是 shim；Windows 上别用 bash 调它——那个 bash 可能是 WSL 的，见 #500）
   - 内部按序执行：分支检查（必须 master）→ 验证（`scripts/verify.mjs`）→ `node scripts/version-bump.js`（同步 package.json / package-lock.json / app.json / mobile+core package.json 共 5 处）→ commit → push master → 打 tag → push tag
3. **监控构建**：`gh run list --workflow=release.yml --limit 1` 取 run id，再用 `gh run view <id> --json status,conclusion` 轮询（要分片状态就 `.jobs[]`）——`gh run watch` 每 20s 重印整棵 job 树，读回来几乎全是重复
4. **写 release 介绍**（publish job 结束后必做——CI 的 `generate-notes` 只是兜底平铺 PR 列表）：按本文末「介绍规格」收集 `git log v{prev}..v{ver}` 与 `gh release view v{ver} --json assets`，写进临时文件后 `gh release edit v{ver} --notes-file <file>` 覆盖。
5. **验证产物**：`gh release view <tag>`（桌面三平台 + APK `MPlayer-v{ver}.apk` + AAB `MPlayer-v{ver}.aab`，AAB 供上架 Google Play）

提交走文档直推（`docs:` 前缀直接 push `master`），不需要 issue 与 worktree。

**完成标准**：`master` 与 `origin/master` 一致、`git status` 干净；doc-sync 清单的每一类都真的在代码里核过（不是"看起来对"）；`gh release view <tag> --json body` 显示的是新介绍——亮点 3-5 条且每条用户可感、变更按 Desktop/Mobile/core/CI 分类、下载清单与 `--json assets` 一一对应（含大小）、末尾有 compare 链接。

## 要点

- 版本号唯一来源是 `package.json`，bump 走 `version-bump.js`（**不要用** `npm version`，它只改 package.json 不同步其他文件）。
- 发布入口是 tag push；本地无需 `electron:build`（CI 三平台矩阵构建）。
- 构建失败：`gh run view <id>` 看日志；修复推 master 后 `git tag -f` + `git push --force origin <tag>` 重触发。
- 回滚：`git revert HEAD` 后删 tag（`git tag -d v<x>` + `git push origin :refs/tags/v<x>`）。
- 移动端检查更新走 GitHub API（`releases/latest`），发布后新版本即可被发现。

## 介绍规格

```markdown
# MPlayer {tag}

## 🚀 版本亮点
- **{加粗能力词}**：{一句话，说明用户能得到什么}（3-5 条，按价值排序）

## ✨ 变更详情
### Desktop（Electron）
### Mobile（Expo/React Native）
### CI / 构建
- {每条 = commit 标题去 conventional 前缀、合并同类项；dependabot 依赖升级合并为一行或省略}

## 📥 下载
- **Windows**: `MPlayer-Setup-{ver}.exe`（安装包，~XMB）
- **macOS**: `MPlayer-{ver}.dmg`（x64）/`MPlayer-{ver}-arm64.dmg`（Apple Silicon）
- **Linux**: `MPlayer-{ver}.AppImage` / `mplayer_{ver}_amd64.deb`
- **Android**: `MPlayer-v{ver}.apk`（安装包）/`MPlayer-v{ver}.aab`（Google Play 上架包）

**Full Changelog**: https://github.com/fuzz1og/mplayer/compare/{prev}...{tag}
```

- 版本号从 tag 剥 `v` 前缀；`prev` 是上一 release tag。
- 文案中文；亮点聚焦用户可感变化（新功能/修复/性能），不列内部重构（除非影响用户）。
- 产物大小以 release 实际资产为准，不臆测。
- 若 release body 已被人工改过（非自动生成格式），先读现有 body 再决定覆盖。
