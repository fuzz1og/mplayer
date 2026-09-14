# ADR 索引

> **命名规则（2026-09-13 起）**：文件名 = `YYYY-MM-DD-<slug>.md`（日期 = 决策定稿日）。
> 决策编号 `ADR-NNNN` 是**内容内的稳定引用标识**（历史沿用，不再作为文件名前缀）。
> 新 ADR 不再顺序取号，直接用日期文件名；引用旧决策时继续用 `ADR-NNNN`，查下表定位文件。
> —— 这消除了并发开发时「读目录取 max+1」的编号冲突（原 0004 双份即由此产生）。

| 编号 | 决策 | 文件 | 状态 |
|---|---|---|---|
| ADR-0001 | musicApi IPC 单通道分发 | `2026-08-15-musicapi-ipc-single-channel.md` | 已接受 |
| ADR-0002 | 缓存单一语义层 | `2026-08-15-cache-single-semantic-layer.md` | 已接受 |
| ADR-0003 | 搜索编排器 | `2026-08-15-search-orchestrator.md` | 已接受 |
| ADR-0004 | 动效弹簧预设契约 | `2026-08-23-design-motion-presets.md` | 已接受 |
| ADR-0005 | 移动端毛玻璃 Chrome | `2026-08-26-mobile-frosted-chrome.md` | 已接受 |
| ADR-0006 | 源文字对比度 token | `2026-08-26-source-text-contrast-tokens.md` | 已接受 |
| ADR-0007 | 移动端底部弹层壳 | `2026-08-26-mobile-bottom-sheet-shell.md` | 已接受 |
| ADR-0008 | 空队列隐藏迷你播放栏 | `2026-08-26-empty-playerbar-hidden.md` | 已接受 |
| ADR-0009 | 不引入大标题导航 | `2026-08-26-mobile-large-title-nav.md` | 已接受（否决记录） |
| ADR-0010 | Android BlurView blurTarget | `2026-08-26-android-blur-blurtarget.md` | 已接受 |
| ADR-0011 | 应用更新镜像通道 | `2026-08-28-update-mirror-channels.md` | 已接受 |
| ADR-0012 | 歌曲身份与可播资源值语义 | `2026-09-10-song-identity-and-playable-resource.md` | 已接受 |
| ADR-0013 | 桌面端深色模式 + 语义 token 全面化 | `2026-08-23-desktop-dark-mode-tokens.md` | 已接受（原编号 0004，让号说明见文件内） |

## 归档类文档命名总则

- **存档类**（定稿即不再改：ADR / spec / 调研 / 验证记录）→ `YYYY-MM-DD-<slug>.md`
- **活文档**（原地长期维护：本目录 6 份契约/指南 + CONTEXT.md / AGENTS.md）→ 裸 `kebab-case.md`
- 目录分工：`adr/` 决策 · `specs/` 规格 · `research/` 调研 · `wayfinder/` 会话资产 · `agents/` 仅活文档