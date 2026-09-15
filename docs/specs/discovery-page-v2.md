# 发现页 V2 + Audio Probe 规格

## Status

Implemented and verified. PR #62 merged; review fixes landed in `codex/fix-review-findings` (PR #73); `e2e/discover-v2.spec.ts` 14/14; child tickets #57-#61 closed. 2026-08-02 回归修复：新碟恢复多行网格、猜你喜欢恢复歌单网格、封面缓存 IPC 恢复路径语义、搜索探测改为 15 并发逐首更新。

## Destination

- 桌面端发现页重构为 V2：排行榜 / 新碟上架 / 猜你喜欢 / 歌单四个 Tab。
- 排行榜：**单元榜 + 源切换**（网易 / QQ / 酷狗各自的热歌榜与新歌榜）。
  （2026-09-14 对齐现状：原「三源聚合为一榜」已下线，见 Decisions。）
- 搜索结果音频质量探测：SongRow 显示 `preview` / `invalid` badge，搜索后每首并发探测。

## Decisions

- 排行榜形态（2026-09-14 改判，原决策「聚合为主 + 源筛选」作废）：**回归单元榜 + 源切换**。
  理由与证据见 [ADR/决策 #332](https://github.com/fuzz1og/mplayer/issues/332) 与
  `docs/wayfinder/2026-09-13-t2-charts-form-research.md`：单一流媒体产品里不存在「切换数据源」
  这个概念（Spotify/Apple/YouTube/Deezer 均为单源自有，切的是地区/流派）；跨源聚合只存在于
  聚合器（kworb/Last.fm）或拥有全量数据的数据商（Luminate/Billboard/TME 由你榜）。
  本项目只有名次、没有绝对量，`Σ1/rank` 在业界找不到对应物，且会制造「内容重复」的观感。
- 聚合内核已**整条下线**：core `chartAggregate`、`src/main/services/chartAggregator.ts`、
  `getAggregatedChart` IPC、`src/shared/chart.ts` 全部删除（不留「有测试无消费方」的内核）。
- 榜单详情：**通用组件 + 可选列**。各源提供程度不同——实测三源公共只有「名次」（由数组索引推导）；
  「上期名次 / 在榜周数」只有 QQ 提供（`cur_count`/`old_count`/`in_count`），故不做按源分支的组件，
  而是有值则渲染、无值则省略。
- UI 布局：顶部 tab 切换，桌面端网格卡片。
- audio probe：独立功能，但作为聚合前置依赖一起做；提取到 `packages/core`，desktop/mobile 共享。
- 多源 API：酷狗全功能免费（UA only），QQ 排行榜+新歌免费，其他源需签名/反爬。
- 搜索探测：搜索后每首并发探测，`PROBE_CONCURRENCY=15`，单首完成后立即更新 UI；旧搜索结果不会覆盖新搜索。
- 聚合去重：折叠显示最优一首（可展开）；完整度 > 排名 > 默认源序；未上榜源加权 `missing=51`；失败源不参与评分。
- 缓存：排行榜 30min、推荐 15min、新碟 1h；排行榜默认立即加载，其他 Tab 首次切换加载并缓存；切回排行榜按 TTL 刷新。
- 新碟上架：多行自适应网格卡片 + 地区筛选（全部/华语/欧美/韩国/日本）。
- 猜你喜欢：歌单网格。

## Child tickets

- #52 调研各源推荐/新碟/排行榜 API 能力 — resolved
- #53 调研 audio probe 桌面端移植方案 — resolved
- #54 确定多源排行榜聚合去重策略 — resolved
- #55 确定桌面端发现页 UI 布局方案 — resolved
- #56 整合发现页重构 + audio probe 完整 spec — resolved
- #57 Audio Probe 核心 + SongRow 标记 — closed
- #58 酷狗 API 封装 + 聚合服务 — closed
- #59 发现页 V2 骨架 + 排行榜面板 — closed
- #60 新碟上架 + 猜你喜欢板块 — closed
- #61 缓存策略 + 加载优化 — closed

## Out of scope

- MV/视频功能
- 心情/场景分类歌单
- QQ/酷狗推荐 API 深度接入

## Verification

- `e2e/discover-v2.spec.ts` 14/14
- `npm run typecheck`
- `npm run lint`
- `npm run test:run` 175/175
- `npm run test:chart` 3/3
