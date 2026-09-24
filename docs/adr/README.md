# ADR 索引

> **身份规则（2026-09-13 起）**：文件名 = `YYYY-MM-DD-<决策-slug>.md`（日期 = 决策定稿日），文件名就是这份决策的**稳定引用**，也可直接当它引用。
> **新决策不取号。** 日期文件名让并发写作者各挑各的 slug，天然不冲突；顺序编号需要的「读目录取 max+1」正是原 0004 双份撞号的成因，已废止。
> `ADR-NNNN` 只作为**历史决策的冻结引用标识**保留：代码与文档里已有约 90 处按编号引用，它们靠文末对照表解析到文件，因此不删除、不重编号。**新决策不再分配编号，新引用请直接写日期文件名。**

## 索引

按文件名（即决策定稿日）排序。

| 决策 | 文件 | 状态 |
|---|---|---|
| 缓存单一语义层 | `2026-08-15-cache-single-semantic-layer.md` | 已接受 |
| musicApi IPC 单通道分发 | `2026-08-15-musicapi-ipc-single-channel.md` | 已接受 |
| 搜索编排器 | `2026-08-15-search-orchestrator.md` | 已接受 |
| 动效弹簧预设契约 | `2026-08-23-design-motion-presets.md` | 已接受 |
| 桌面端深色模式 + 语义 token 全面化 | `2026-08-23-desktop-dark-mode-tokens.md` | 已接受（原编号 0004，让号说明见文件内） |
| Android BlurView blurTarget | `2026-08-26-android-blur-blurtarget.md` | 已被 `2026-09-23-mobile-chrome-solid-gradient.md` 取代 |
| 空队列隐藏迷你播放栏 | `2026-08-26-empty-playerbar-hidden.md` | 已接受 |
| 移动端底部弹层壳 | `2026-08-26-mobile-bottom-sheet-shell.md` | 已接受 |
| 移动端毛玻璃 Chrome | `2026-08-26-mobile-frosted-chrome.md` | 已被 `2026-09-23-mobile-chrome-solid-gradient.md` 取代 |
| 不引入大标题导航 | `2026-08-26-mobile-large-title-nav.md` | 已接受（否决记录） |
| 源文字对比度 token | `2026-08-26-source-text-contrast-tokens.md` | 已接受 |
| 应用更新镜像通道 | `2026-08-28-update-mirror-channels.md` | 已接受 |
| 歌曲身份与可播资源值语义 | `2026-09-10-song-identity-and-playable-resource.md` | 已接受 |
| tier3 调度、预算与源归属 | `2026-09-14-tier3-scheduling-and-source-ownership.md` | 已接受（决策 1 的「并行」与决策 4 的「不做软降权」已被 `2026-09-25-tier3-source-scheduling.md` 取代） |
| tier3 源的会话内调度 | `2026-09-25-tier3-source-scheduling.md` | 已接受 |
| tier3 兜底：只替换 URL、分级护栏与验证等级 | `2026-09-21-tier3-url-substitution.md` | 已接受 |
| 悬浮 chrome 去毛玻璃（纯色+渐变） | `2026-09-23-mobile-chrome-solid-gradient.md` | 已接受 |
| tier3 交付口径与播放失败归因 | `2026-09-23-tier3-failure-attribution.md` | 已接受 |
| tier3 清单能力扩展：`{id}` 归一化、redirect 响应与护栏字段 | `2026-09-23-tier3-manifest-capability-extensions.md` | 已接受 |
| 播放解析链结构化 trace（core trace + 宿主 sink） | `2026-09-23-playback-trace-sink.md` | 已接受 |

## 历史编号对照（冻结）

> 仅为解析 `ADR-NNNN` 形式的旧引用而保留，**此表不再增加行**。历史 ADR 不可重命名或重编号，因此这些编号永久有效；新决策一律以文件名引用。

| 编号 | 文件 |
|---|---|
| ADR-0001 | `2026-08-15-musicapi-ipc-single-channel.md` |
| ADR-0002 | `2026-08-15-cache-single-semantic-layer.md` |
| ADR-0003 | `2026-08-15-search-orchestrator.md` |
| ADR-0004 | `2026-08-23-design-motion-presets.md` |
| ADR-0005 | `2026-08-26-mobile-frosted-chrome.md` |
| ADR-0006 | `2026-08-26-source-text-contrast-tokens.md` |
| ADR-0007 | `2026-08-26-mobile-bottom-sheet-shell.md` |
| ADR-0008 | `2026-08-26-empty-playerbar-hidden.md` |
| ADR-0009 | `2026-08-26-mobile-large-title-nav.md` |
| ADR-0010 | `2026-08-26-android-blur-blurtarget.md` |
| ADR-0011 | `2026-08-28-update-mirror-channels.md` |
| ADR-0012 | `2026-09-10-song-identity-and-playable-resource.md` |
| ADR-0013 | `2026-08-23-desktop-dark-mode-tokens.md` |
| ADR-0014 | `2026-09-14-tier3-scheduling-and-source-ownership.md` |

## 新增决策

1. 在 `docs/adr/` 下新建 `<日期>-<决策-slug>.md`，slug 写决策本身，不取号。
2. 四节必填：背景 / 决策 / 备选与否决 / 后果——没有备选则记录的是偏好，不是决策。
3. 同一 PR 里在上表加一行（**只加索引行，不取编号**），并在根 `AGENTS.md` 指出的路径处补指针。
4. 反转既有决策时写新 ADR、把旧的 `状态` 改为 `已被 <稳定引用> 取代` 并互相链接，不重写已接受的 ADR。

文档命名的通用规则（存档类 `YYYY-MM-DD-<slug>.md` vs 活文档裸 `kebab-case.md`、目录分工）见 `docs/agents/domain.md` 的「Doc naming convention」小节；本文件只承载 ADR 自身的身份与索引规则。
