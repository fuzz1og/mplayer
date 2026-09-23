# tier3 清单能力扩展：`{id}` 归一化、redirect 响应与护栏字段

日期：2026-09-23 · 状态：已接受 · 关联：#376、ADR-0014、ADR-0012 ·
依据：2026-09-23 源生态实测（能力拓展调查，不入库）、`docs/agents/tier3-manifest.md`

## 背景

tier3 的清单契约刻意只支持「可纯声明描述的源」：单步 GET/POST + JSON 响应 + `{id}` 模板。
2026-09-23 的源生态实测发现，**多个端点本身活着、能给标准音质直链，却因为契约能力缺口
而完全用不上**，且三类缺口各有实测证据：

1. **302 直跳型端点吃不下**。Meting 家族等端点以 302 把 `type=url` 直接跳到音频 CDN
   （实测某实例对 5 首 QQ 歌 5/5 返回 320k MP3）。而 `resolveFromRequestSpec` 只做
   `JSON.parse(body)`——axios 跟随重定向后 `body` 已是音频字节，必然解析失败 → 未命中。
2. **`{id}` 形态不匹配**。酷我直连自 #171 起把歌曲 id 写成 `MUSIC_<数字>`（`kuwoDirect.mapTrack`
   取 `MUSICRID`），而第三方酷我接口只认裸数字 rid；`stripSourceIdPrefix` 只剥
   `kuwo:` 这类**源前缀**，不剥酷我自己的命名空间标签 → 上游回「请输入歌曲id」。
   实测同一端点：裸数字 → 交付 320k、`guard=audio-header`；带 `MUSIC_` → 未命中。
3. **护栏字段盲区把好源整条拒掉**。`SOURCE_ARTIST_PATHS` 缺 `ar_name` / `singer_name`，
   实测两个能出链的源被判「歌名匹配、歌手缺失」而拒绝（护栏要求文本证据时歌名+歌手
   必须同时命中）。

**附带发现**：`api/transport.ts` 的 `finalUrl` 取 `resp.request.responseURL`，在 axios +
follow-redirects 下**恒为 undefined**（实测最终地址在 `resp.request.res.responseUrl`），
因此 `finalUrl` 永远等于请求 URL——这是缺口 1 的前置阻塞，必须先修。

**约束**：清单 `version` 仍为 1（存量订阅不能失效）；不改 `Song.id`、不改身份键
（ADR-0012）——否则酷我歌的身份键一次性变化，移动端按身份键持久化的探测标记与
歌曲缓存全部变成孤儿。

## 决策

1. **E0 护栏字段**：`SOURCE_ARTIST_PATHS` 增补 `ar_name`、`singer_name`。
   只加字段名，不改护栏判据与容差。
2. **E1 `idNormalize`**：source 级可选字段 `{ "stripPrefixes": ["…"] }`。模板填充
   `{id}` 前逐条剥离前缀（`resolveSourceUrl` 里对 `idOverride || song.id` 生效，
   搜索腿的 resolve 同样生效）。**只影响 tier3 模板**：`Song.id`、`identityKey`、
   sourceSwap、缓存键一律不动，因此零持久化迁移。
   归一化是**清单数据**而非 core 特例——酷我特例不写死进执行器。
3. **E2 `responseKind`**：`resolve`（含 `search.resolve`）可选字段
   `"json" | "redirect"`，默认 `json`（行为与校验完全不变）。
   `redirect` 时：候选 = `transport` 的 `finalUrl`（且必须 `≠` 请求 URL，否则视为未重定向）；
   `responseJsonPath` 变为可选；**域名白名单、64KB Range 字节嗅探、分级护栏对最终 URL
   照常执行**，文本证据为空（只剩音频头时长），与「解析响应不带 name/artist」的
   url-resolver 同档（L2/L3 或 `none`）。
4. **修 `finalUrl` 取值**：`request.responseURL || request.res.responseUrl`，
   并保留「非 http(s) 或缺失 → 回退请求 URL」的兜底。
5. **向后兼容**：三项均为可选字段/字段名增补，`version` 保持 1；`parse` 层对
   `responseKind` 做白名单校验，非法值在清单校验阶段报错。

## 备选与否决

- **在 `mapTrack` 里把酷我 id 改回裸数字**（或让 `stripSourceIdPrefix` 剥 `MUSIC_`）：
  否决。前者会让「已持久化的 `MUSIC_` id」与「新写入的裸数字 id」在身份键上分裂成两个
  （#307 的翻版）；后者把酷我特例写死进通用 utils，且同样改动身份键语义。E1 把归一化
  留在 tier3 模板层，影响面最小。
- **`{idBare}` / `{idNumeric}` 新模板变量**：否决。存量与生态里的清单都写 `{id}`，
  新变量等于要求每个清单改模板，兼容性收益为零。
- **在 core 里内置端点 / 内置 `kind:"script"` 跑 JS 源**：否决（前者违反「公开仓库零端点」，
  后者需要桌面沙箱 + 移动端原生 JS 引擎，见 2026-09-14 调研报告结论）。
- **多步 `resolve.steps[]`、HTML 正则取值（`responseKind:"text"`）**：本次不做。
  今天没有「非它不可」的源；留作后续按需扩展。
- **把 302 端点改写成「让上游返回 JSON」**：不可行，端点形态由上游决定。

## 后果

- 清单表达力：QQ 320k 通路从 2 条扩到 3 条（新增一条 302 型独立通路），酷我 320k
  从 0 条扩到 1 条（url-resolver 型；此前只有 128k 的搜索兜底）；两个「能出链但被
  歌手字段判死」的源恢复可用。实测（真实执行器，2026-09-23）：redirect 通路 QQ 3/3
  交付、`guard=audio-header`、1.2–1.3s；`idNormalize` 通路酷我 385ms 交付 320k。
- 安全边界不变：redirect 只改「候选从哪来」，白名单/嗅探/护栏全部复用；
  `finalUrl` 不在白名单或未发生重定向 → 未命中，不把 API 地址当音频。
- 代价：`Tier3RequestSpec` / `Tier3Source` 各多一个可选字段；`transport` 修一处取值；
  文档（`docs/agents/tier3-manifest.md`）与单测同步。
- 已知遗留：`redirect` 模式的文本证据为空，护栏只能靠音频头/体积码率，对「容器头
  不可信」（如无 Xing 头的 MP3）会退到 L3 或 `none`——与既有 url-resolver 同风险等级，
  未新增暴露面。
