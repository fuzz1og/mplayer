# tier3 订阅清单（manifest）参考

> 关联：ADR-0014（[tier3 调度、预算与源归属](../adr/2026-09-14-tier3-scheduling-and-source-ownership.md)）·
> 依据：[t6 源归属匹配调研](../research/2026-09-14-t6-tier3-source-matching.md)、[t1 第三方源清单](../wayfinder/2026-09-14-t1-tier3-external-sources.md)
>
> 本文件是清单 schema 与 `source` 字段的权威说明。设置页只放了摘要，完整字段以本文为准。

tier3 订阅源 = 用户自配的第三方解析源，作为官方直连失败后的兜底。清单是 MPlayer 自定义格式（不是生态公共格式），当前只接受 `version: 1`。仓库不内置任何端点，订阅地址不入库。

## 顶层结构

```json
{
  "version": 1,
  "sources": [ /* Tier3Source[] */ ]
}
```

## source 条目字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 源代号，清单内唯一；日志与统计按它归类 |
| `name` | — | 展示名（设置页） |
| `source` | ⚠️ | 该源**服务的音乐源**（见下节）。`url-resolver` 不写会被拒绝；`search-then-resolve` 不写＝通用兜底 |
| `kind` | ✅ | `url-resolver`（按 ID 直取）或 `search-then-resolve`（先搜再解） |
| `allowedDomains` | ✅ | 返回音频 URL 的域名白名单；`*.example.com` 才放行子域，普通 `example.com` 只放行自身 |
| `timeoutMs` | — | 单源超时，**不写 = 取该 kind 的硬墙**（`url-resolver` 2s / `search-then-resolve` 2.5s）。**只能收紧、不能放大**：实际生效值 = `min(timeoutMs ?? 该 kind 默认值, 该 kind 单源硬墙, 整链剩余预算)`；硬墙按 kind 分档来自 ADR `2026-09-25-tier3-source-scheduling` 决策 7（两步源三段网络串行在同一个墙内，2s 会切掉实测 2047ms 的成功路径）。**默认值也按 kind**（决策 7 补记，2026-09-25 #394 验收发现）：原实现沿用扁平默认 2s，导致明明显式给了两步源 2.5s 的墙，任何没手写 2500 的清单都拿不到它。解析腿源间串行，一个挂起的死源若被允许跑 15s 会吃光整链 6s 预算，后面的好源一次都不会被请求（#365） |
| `headers` | — | 合并进解析请求与嗅探请求的请求头 |
| `idNormalize` | — | 按源归一化模板变量 `{id}`：`{ "stripPrefixes": ["…"] }`，填充前逐条剥离前缀。**只影响模板**，不改 `Song.id` / 身份键 / 已持久化数据。例：酷我直连 id 是 `MUSIC_<数字>`，而第三方酷我接口只认裸数字 |
| `resolve` | ✅ | 取链步骤：`{ method?, url, body?, responseKind?, responseJsonPath? }` |
| `search` | search-then-resolve ✅ | 搜索步骤：`resolve` 的字段 + `itemsPath/namePath/artistPath/idPath/urlPath/coverPath/albumPath` |

模板变量（`url`/`body` 中可用）：`{id}` `{source}` `{name}` `{artist}` `{keyword}`。`{source}` 填的是 MPlayer 的规范源键（`qq`、`netease`…），不是上游 API 自己的叫法。

`{id}` 是**源站真实 ID**（剥掉 `kuwo:` 这类源前缀后的值）。若上游要的形态与 MPlayer 的 id 不一致（例：酷我直连产出 `MUSIC_<数字>`，第三方酷我接口只认裸数字），用 `idNormalize.stripPrefixes` 归一——**不要把源站特例写进上游参数或指望执行器猜**。

## `source` 字段：源归属是安全边界，不是标签

同一个「源键」在不同上游里叫法不同：MPlayer 用 `qq`、GD Studio 用 `tencent`、lx-music 用 `tx`。清单里这些写法都会被归一化。

**合法值**：`netease` `qq` `kugou` `kuwo` `migu` `qianqian` `soda`。

**常见别名**（自动归一化）：`tencent`/`tx`/`qqmusic` → `qq`；`163`/`126`/`neteasecloud` → `netease`；`kg` → `kugou`；`kw` → `kuwo`；`mg` → `migu`；`91q`/`baidu` → `qianqian`；`qishui`/`douyin` → `soda`。

**不认识的值视为未声明**（例如 `tidal`、`spotify`、拼写错误）：它永远不会匹配任何歌，还会污染搜索候选的来源标记，导致播放时报「可能为 VIP/无版权」这种指错方向的错误。请只用上表的值。

### 归属规则（ADR-0014 决策 6）

| 条目 | `source` | 行为 |
|---|---|---|
| `url-resolver` | 写了且匹配 | ✅ 可用（只服务该源） |
| `url-resolver` | 写了但不匹配 | ⛔ 跳过（计入「跳过」统计） |
| `url-resolver` | **没写 / 不认识** | ⛔ **拒绝**——它按歌曲 ID 直取，而 ID 空间是源私有的（QQ songmid ≠ 酷我 rid）：把 A 源的 ID 发给 B 源的接口，轻则查不到，重则返回**另一首歌的合法音频**（域名白名单与字节嗅探都拦不住） |
| `search-then-resolve` | 写了且匹配 | ✅ 只服务该源 |
| `search-then-resolve` | 不写 / 不认识 | ✅ **通用兜底**（任意源都试）——它按歌名/歌手搜索并做严格匹配，不存在 ID 错配 |

设置页的「跳过」计数 = 因归属不匹配被跳过的次数，用来区分「源没命中」和「源被归属过滤」。

### 响应取值：`responseKind`

`resolve` / `search.resolve` 的 `responseKind` 决定候选 URL 从哪来：

| 值 | 行为 |
|---|---|
| `json`（默认） | 解析响应体 JSON，按 `responseJsonPath` 取值；`responseJsonPath` 必填 |
| `redirect` | 取 **transport 的重定向终点 URL**——用于 302 直跳音频的端点（响应体是音频字节，无法 JSON.parse）；`responseJsonPath` 可省略 |

`redirect` 只改变「候选从哪来」：**域名白名单、64KB Range 字节嗅探、分级护栏对最终 URL 照常执行**。所以 `allowedDomains` 要写**最终音频域名**；未发生重定向（终点 == 请求 URL）或终点不在白名单 → 未命中。文本证据为空（响应没有 name/artist），护栏落在 L2/L3，探不到就 L5 `none`——与「解析响应不带 name/artist」的 url-resolver 同档。

### 聚合端点：一条端点服务多个源

`source` 是**单值**。一个同时支持 QQ/网易/酷我的聚合 API（例如 `?types=url&source=tencent&id={id}`），正确写法是**同一端点拆成多条条目，各自声明一个 source 和对应参数**：

```json
{
  "id": "gd-qq",
  "kind": "url-resolver",
  "source": "qq",
  "allowedDomains": ["music-api.gdstudio.xyz", "*.gdstudio.xyz"],
  "resolve": { "url": "https://music-api.gdstudio.xyz/api.php?types=url&source=tencent&id={id}&br=320", "responseJsonPath": "url" }
}
```

注意：上游参数要写它自己的词汇表（GD 认 `tencent`，不认 `{source}` 传出的 `qq`）。

如果不想逐源拆，另一个省事的通用兜底是放**一条不声明 `source` 的 `search-then-resolve` 源**。

## 兜底护栏：只替换 URL，分级验证（#361）

tier3 只替换**流 URL**，绝不铸造新的歌曲身份（队列 / 收藏 / 历史 / 本地歌单零改写）。但第三方源返回的音频不保证就是点的那一首，因此每条候选在采用前要过护栏：

| 等级 | 证据 | 来源 |
|---|---|---|
| L1 `source-duration` | 源自带时长 | 解析响应 / 搜索条目里的常见字段（`duration` / `Duration` / `song_play_time` / `play_time` / `playTime` 等，**自动探测**） |
| L2 `audio-header` | 音频头解析时长 | 已取的头部字节（music-metadata；仅全局头容器可信：M4A/FLAC，或 MP3 带 Xing/Info、或已取全文件） |
| L3 `size-bitrate` | `体积 × 8 ÷ 码率` | 体积 = Range 的 `content-range` 总量；码率优先**源自称 `br`**（自动探测），缺失才用帧实测 |
| L4 `text-only` | 只验歌名 + 歌手精确匹配 | 搜索条目自带 / 解析响应里的常见字段（歌名 `name`/`title`/`songName`…，歌手 `artist`/`singer`/`author`/`ar_name`/`singer_name`…，**自动探测**） |
| L5 `none` | 只剩 `source` 声明这一条**信任**（契约不是证据） | url-resolver 且响应无 name/artist |

- 判据：`|候选时长 − 标称 Song.duration| ≤ 2s`。**不需要**在清单里声明 `durationPath`：常见字段自动探测，探不到就降级，不影响可用性。
- 不过护栏**不静默播**：换下一个候选源；全部不过 → 走既有失败链路（返回空 URL）。
- 预取缓存命中的试听版换完整版时，同样过护栏。
- `auto` / `direct` 来源开关语义不变（`direct` 模式下直连抛错仍不回退 tier3）。

## 示例

URL 直取型（声明归属）：

```json
{
  "version": 1,
  "sources": [{
    "id": "demo-url",
    "name": "Demo",
    "kind": "url-resolver",
    "source": "netease",
    "allowedDomains": ["cdn.example.com"],
    "resolve": { "url": "https://api.example.com/url?id={id}", "responseJsonPath": "data.url" }
  }]
}
```

搜索再取链型（可作通用兜底，不写 `source`）：

```json
{
  "version": 1,
  "sources": [{
    "id": "demo-search",
    "kind": "search-then-resolve",
    "allowedDomains": ["*.example.com"],
    "search": {
      "url": "https://api.example.com/search?keyword={keyword}",
      "responseJsonPath": "data",
      "itemsPath": "data",
      "namePath": "name",
      "artistPath": "artist",
      "idPath": "id"
    },
    "resolve": { "url": "https://api.example.com/url?id={id}", "responseJsonPath": "data.url" }
  }]
}
```

302 直跳型（`responseKind: "redirect"`；`allowedDomains` 写**最终音频域名**）：

```json
{
  "version": 1,
  "sources": [{
    "id": "demo-redirect",
    "kind": "url-resolver",
    "source": "qq",
    "allowedDomains": ["cdn.example.com"],
    "resolve": { "responseKind": "redirect", "url": "https://api.example.com/go?id={id}" }
  }]
}
```

需要归一 `{id}` 形态时（`idNormalize`）：

```json
{
  "version": 1,
  "sources": [{
    "id": "demo-normalize",
    "kind": "url-resolver",
    "source": "kuwo",
    "allowedDomains": ["cdn.example.com"],
    "idNormalize": { "stripPrefixes": ["MUSIC_"] },
    "resolve": { "url": "https://api.example.com/url?id={id}", "responseJsonPath": "data.url" }
  }]
}
```

## 安全与限制

- **域名白名单 + 字节嗅探**：返回的 URL 必须落在 `allowedDomains` 且取到的头部字节是音频（拒 `text/html` 错误页）；完整大小 <1MB 的候选视为试听片段，跳过（宁可不播也不把试听当完整版）。护栏取证与嗅探共用**一次 64KB Range**。
- **预算**：单源硬墙按 kind 分档——`url-resolver` 2s / `search-then-resolve` 2.5s（`timeoutMs` 只能收紧；连 transport 的重试一起算在墙钟内），整链 6s（预算用尽即停止启动后续源）；搜索腿 6s（耗尽返回已收集的部分候选）+ 同款分档硬墙。嗅探独立 1s。
- **跨歌在飞上限 K=3**（ADR 决策 8）：全局 FIFO 排队，排队时间不计入各调用方的 6s 预算——防「批量下载 × 快速切歌 × 失败跳歌」把上游在飞数放大（#388 实测 qq 搜索 200ms 间隔 10/12 撞 `code=2001`）。
- **统计仅会话内**，不持久化、不做熔断/软降权（ADR-0014 决策 4/5）。
- **已知未解决**：服务器忽略 `Range` 时会缓冲整个响应直到超时，好 URL 可能被误判为坏源（需 transport 支持响应字节上限/提前中断）。
