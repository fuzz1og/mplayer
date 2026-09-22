# tier3 交付口径与播放失败归因

日期：2026-09-23 · 状态：已接受 · 关联：#362（统计虚报）、#357（失败文案分级）、#355（源归属配套）、ADR-0014 ·
依据：`docs/wayfinder/2026-09-21-t5-playback-chain-baseline.md`、`docs/research/2026-09-14-t6-tier3-source-matching.md`

## 背景

tier3（用户自配的第三方解析源）是直连失败后的唯一兜底。ADR-0014 一期落地后，两处
「用户能看到的信息与真实发生的事不一致」仍然成立：

1. **`hits` 虚报命中（#362 缺陷 1）**：`hits++` 在 `resolveTier3` 的源循环内部，而整链预算是
   `sourceRouter.tryTier3` 用 `Promise.race` 施加的（`TIER3_BUDGET_MS = 6s`）。预算超时后
   resolver 仍在后台跑完并 `hits++`，但 URL 已被丢弃。实测一次会话末某源记 `hits=17`，
   而同一批 QQ 歌 21/21 全部以 6.1s 超时失败——设置页显示「源命中很多」，与体验相反。
   所有「按源质量排序 / 决定删哪个源」的后续优化都会被这份统计带偏。
2. **播放失败文案单句且指错方向（#357）**：直连 + tier3 全失败后统一报
   「无法获取音频 URL：可能为 VIP/无版权或直连暂不可用」。它把四种完全不同的原因
   （没有声明对应 source 的源 / 有源但全被归属跳过 / 适用源都试了没命中 / 直连失败且
   tier3 未开启）压成一句，并把用户引向「VIP/无版权」。t6 §4.2② 的实测正是这个坑：
   清单写了不认识的 `source` 值 → 搜索候选 `sourceType` 被污染 → `decideRoute` 抛
   「该源暂无直连实现」→ 用户看到的就是这句 VIP 提示。

**现状约束**：tier3 只把「命中 URL / 空串」回传 `sourceRouter`；每源统计（core 内存 Map）
不回传播放层，且是**全局会话累计**，不是「本次解析为什么失败」（ADR-0014 决策 5）。
把失败原因塞进 `resolvePlayableSongRouted` 的返回属**契约改动**（ADR-0012 的可播资源值）；
而桌面播放解析走 `musicApi:call` 单通道 IPC，主进程抛出的错误到渲染层只剩 message，
自定义字段（如 `reason`）会被 IPC 序列化吞掉。

## 决策

1. **交付口径**：`hits` 语义收紧为**真正交付**——只有路由层在整链预算内采纳该候选才算。
   resolver 内部只记 `resolved`（产出的、过护栏的候选，含迟到被丢弃的）；`discarded`
   在读取时按 `resolved - hits` 派生。跨层交付通过 `Tier3Resolution.commit?()` 回调完成
   （幂等，同歌去重下多个调用方共享一条解析也只计一次）；预算超时丢弃的迟到命中
   永不触发 `commit`。
2. **失败归因是纯读诊断，不改解析链契约**：core 新增 `explainPlaybackFailure(song)`，
   返回 `{ kind, declared, usable, skipped, message }`。它在「直连 + tier3 都没拿到 URL」
   之后调用，按**当前配置**（订阅清单 + 来源开关 + tier3 开关）推导，不读会话累计统计。
   `resolvePlayableSongRouted` 的返回类型与抛错语义**不变**。
3. **六类归因**（`PlaybackFailureKind`）：`direct-only`（该源设为仅直连）、`tier3-disabled`、
   `no-subscription`、`no-declared-source`（有源但声明的是其他平台）、`all-skipped`
   （有源但 url-resolver 未声明 source / source 值不认识被拒）、`sources-missed`
   （适用源都试了没命中或超时）。每类都带可操作建议与计数。
   **优先级**：`tier3-disabled` → `direct-only` → 其余——先报「改了就能生效」的开关；
   tier3 全局关闭时把用户引去改「仅直连→自动」是无效操作，会误导。
4. **双端共用一份文案**：`message` 由 core 生成（中文文案在 core 已有先例：
   `SOURCE_DISPLAY_NAMES` / `SOURCE_MODE_OPTIONS`）。桌面经 `musicApi:call` 新增基础方法
   `explainPlaybackFailure` 取回，移动端直调 core；两端不再各自拼文案。
5. **单源 2s 硬墙**（#362 缺陷 2）已由既有实现落地（`effectiveSourceTimeout` =
   `min(清单 timeoutMs, 2s, 整链剩余预算)`），本 ADR 不再重复决策，仅记录其为既定口径。

## 后果

- 设置页「交付」= 真正被采纳的命中，不再出现「命中数 > 实际交付数」；「丢弃」让
  「源产出了但被预算丢掉」可归因——这是 ADR-0014 决策 4「坏源只做统计」能成立的前提。
- 播放失败文案可操作且不误导；`skipped` / `usable` 计数让「源不够用」能定位到是
  「没配对应 source」还是「配了但被过滤」还是「源本身挂了」。设置页同时展示
  `guardRejected`（拿到 URL 但护栏不过），护栏上线后「命中很多但放不出来」可归因。
- 代价：`Tier3Resolution` 多一个可选回调（core 内部契约，自定义 resolver 可省略）；
  桌面 `musicApi` 基础方法多一条（契约派生，签名零重复）。
- 归因按**当前配置**推导，不做「上一次解析」的会话快照：配置是用户可操作的唯一变量，
  而「都试了没命中」在 `usable > 0` 时由解析链的必经路径保证成立。

## 备选与否决

- **把 `failure` 加进 `RoutedPlayable` / 让解析链抛带 `reason` 的类型化错误**：否决。
  抛错路径经 `musicApi:call` IPC 后自定义字段丢失（只剩 message）；且要把
  `direct-unavailable` 等既有抛错改成返回，属解析链语义改动，收益不抵风险。
- **core 暴露一次性「上次解析诊断」快照（按歌身份）**：否决。需要按歌身份的会话状态与
  清理策略，且同歌并发/重试下「上次」归属含糊；纯读推导已能覆盖六类归因。
- **保留 `hits`=产出、另加 `delivered`**：否决。字段能区分，但设置页仍会并列显示
  「命中 > 交付」的误导数字，正是 #362 要消掉的观感；直接收紧 `hits` 语义更诚实。
- **让用户看统计来决定删源**：不做。ADR-0014 已否决熔断/降权/持久化；本 ADR 只保证
  统计数字不撒谎。
- **播放失败时提示「可能为 VIP/无版权」**：保留为兜底文案（`explainPlaybackFailure`
  取不到时），但不再是主路径文案。
