---
name: runtime-verification
description: MPlayer 双端真机验真：在真实 Electron / 真机上跑出可复核证据，并声明证据来自哪个 runtime。PR Evidence、UI/IPC/preload/原生/播放链/更新器改动时用；用户要求实测也算。纯逻辑改动不必。
---

# 真机验真

**验真** = 在真实目标上跑出可复核证据，并写明证据来自哪个 runtime（jsdom / Chromium+stub / Expo Go / dev build / 真 Electron / 打包产物，证明力不同）。CI 已覆盖的 lint / typecheck / 四套测试 / build 不重复证。

## 0. 先列命题

从 issue / spec / diff 抄出「这次要证明什么」，一条一行，动手前写成表：

| # | 可观察行为 | 端 | runtime | 证据类型 | 状态 |
|---|---|---|---|---|---|
| 1 | 切随机模式后队列稳定、当前曲不重复 | 移动 | dev build | logcat 断言 | |
| 2 | 表头拖出视口时缝为 0 | 桌面 | 真 Electron | CDP 截图 + 偏移量 | |

漏项都出在「没有清单、边验边想」。

## 1. 选目标

- 桌面 Electron：`src/renderer` / `src/main` / preload / IPC / 托盘 / 打包与更新器 → `references/desktop.md`
- 移动 Android：`packages/mobile`，或 `packages/core` 影响双端 → `references/mobile.md`

`packages/core` 对两端都是行为改动；只验一端，结论只覆盖一端。

## 2. 身份锚

取证前先从运行中的目标取回产物/状态，认出这次改动的新符号。跑错源码，后面全部作废（实测：设备装旧 APK，日志 `changed=true` 是假成功，拉回 `base.apk` 扫 dex 才推翻）。两端命令见 references「身份锚」。

## 3. 取证强度（高→低）

1. **可断言日志**：移动端 `console` → logcat；桌面主进程 stdout / 渲染层 console。能用日志判读就不截图。
2. **结构化文本**：移动端 `uiautomator dump`（`text=` / `bounds=`）；桌面 CDP `page.evaluate` 读 DOM。要坐标/文案断言，先 dump/evaluate。
3. **截图**：只做视觉复核；先裁区域，图注写「证明了什么」，不写文件名。

量化结论必须配「真的动了」：零告警 / 零掉帧要同时给跑到哪一步（第 N 名、第几首、哪个页面）。

## 4. 附到 PR

证据图不入库：传 PR 正文/验收评论，`--attach` 后读回验引用。格式与两步法见 `docs/agents/git-workflow.md` §5 与 `.github/PULL_REQUEST_TEMPLATE.md`。

## 完成标准

每行收尾为：
- **PASS**：命令+输出或图+图注，且来自 §1 的 runtime；
- **未做 + 原因**：没设备 / 需真人手指 / 改动不触达这一层。

PR 正文自查：Evidence 写明证据层级；图片全是 `user-attachments` URL，本地路径为 0。「已附图」没附、或「等价环境」不说清，都不算完成。
