---
name: release
description: MPlayer 发版全流程：文档同步、验证、bump、推 tag 触发 CI、写 release 介绍。要发新版本时用。
---

# MPlayer 发布流程

发布 = 推 `v*` tag 触发 GitHub Actions（`.github/workflows/release.yml`）构建并发布；本地不构建。

## 流程

1. **文档同步**（bump / tag 前）：先调用 `writing-for-agents` skill，再按 `references/doc-sync.md` 逐类核对活文档；提交后再发版。
2. **一键发布**：`npm run release -- <patch|minor|major|版本号> [--skip-verify]`。入口是 `scripts/release.mjs`；`release.sh` 是 shim，Windows 别用 bash 调（可能是 WSL，#500）。内部顺序：master 检查 → `verify.mjs` → `version-bump.js`（同步 5 处版本）→ commit → push master → tag → push tag。
3. **监控**：`gh run list --workflow=release.yml --limit 1` 取 run id，`gh run view <id> --json status,conclusion` 轮询；要分片看 `.jobs[]`。别用 `gh run watch`（每 20s 重印整棵树）。
4. **写 release 介绍**（publish 后必做；CI `generate-notes` 只是兜底）：收集 `git log v{prev}..v{ver}` 与 `gh release view v{ver} --json assets`，写临时文件后 `gh release edit v{ver} --notes-file <file>`。
5. **验证产物**：`gh release view <tag>` 确认桌面三平台 + `MPlayer-v{ver}.apk` + `.aab`。

文档提交走 `docs:` 直推 `master`，不开 issue/worktree。

**完成标准**：`master` = `origin/master`，`git status` 干净；doc-sync 每类都在代码里核过；release body 是新介绍（亮点 3-5 条、用户可感、按 Desktop/Mobile/core/CI 分类、下载清单与 assets 一致含大小、末尾 compare 链接）。

## 要点

- 版本唯一来源 `package.json`；bump 走 `version-bump.js`，不用 `npm version`（不同步其他文件）。
- 构建失败：`gh run view <id>`；修复推 master 后 `git tag -f` + `git push --force origin <tag>`。
- 回滚：`git revert HEAD` 后删本地/远端 tag。
- 移动端检查更新走 GitHub API `releases/latest`。

## 介绍规格

```markdown
# MPlayer {tag}

## 🚀 版本亮点
- **{能力词}**：{用户能得到什么}（3-5 条，按价值排序）

## ✨ 变更详情
### Desktop（Electron）
### Mobile（Expo/React Native）
### CI / 构建
- {commit 标题去 conventional 前缀；同类合并；dependabot 合并为一行或省略}

## 📥 下载
- **Windows**: `MPlayer-Setup-{ver}.exe`（~XMB）
- **macOS**: `MPlayer-{ver}.dmg` / `MPlayer-{ver}-arm64.dmg`
- **Linux**: `MPlayer-{ver}.AppImage` / `mplayer_{ver}_amd64.deb`
- **Android**: `MPlayer-v{ver}.apk` / `MPlayer-v{ver}.aab`

**Full Changelog**: https://github.com/fuzz1og/mplayer/compare/{prev}...{tag}
```

- 版本号从 tag 剥 `v`；`prev` 是上一 release tag。
- 中文；只写用户可感变化；产物大小以实际 assets 为准。
- release body 若已被人工改过，先读再决定是否覆盖。
