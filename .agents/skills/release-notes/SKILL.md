---
name: release-notes
description: 为 MPlayer 的 GitHub Release 生成并更新详细介绍（版本亮点/变更分类/下载清单），替代 CI 自动生成的平铺 PR 列表。当用户要求"更新/写 release 介绍"、"release notes"、或发布完成（publish job 结束）后维护 release 时使用。
---

# MPlayer Release 介绍

给 GitHub Release 写"人看的"介绍：亮点 + 分类变更 + 下载清单。CI 的 `generate-notes` 只是兜底，发布后应被本规格覆盖。

## 流程

1. **确认 release 存在**：`gh release view {tag}`（tag 形如 `v1.7.1`）。下载清单必须与实际资产一致——`gh release view {tag} --json assets --jq '.assets[].name'` 为准。
2. **收集变更**：`git log --oneline {prev}..{tag}`（`prev` 用 `git describe --tags --abbrev=0 {tag}^` 取上一 tag）；`gh api repos/fuzz1og/mplayer/releases/generate-notes -f tag_name={tag} --jq '.body'` 兜底捡漏。以 commit 为准。
3. **按规格写**（见下），notes 先写临时文件。
4. **更新**：`gh release edit {tag} --notes-file /tmp/{tag}-notes.md`。

**完成标准**：`gh release view {tag} --json body --jq '.body'` 显示新版介绍；亮点 3-5 条且每条用户可感；变更按 Desktop/Mobile/CI 分类；下载清单与 release 资产一一对应（含大小）；末尾有 compare 链接。

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
- **macOS**: `MPlayer-{ver}.dmg`（x64）/ `MPlayer-{ver}-arm64.dmg`（Apple Silicon）
- **Linux**: `MPlayer-{ver}.AppImage` / `mplayer_{ver}_amd64.deb`
- **Android**: `MPlayer-v{ver}.apk`

**Full Changelog**: https://github.com/fuzz1og/mplayer/compare/{prev}...{tag}
```

## 要点

- 版本号从 tag 剥 `v` 前缀；`prev` 是上一 release tag。
- 文案中文；亮点聚焦用户可感变化（新功能/修复/性能），不列内部重构（除非影响用户）。
- 产物大小以 release 实际资产为准，不臆测。
- 若 release body 已被人工改过（非自动生成格式），先读现有 body 再决定覆盖。
