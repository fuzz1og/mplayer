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
| `timeoutMs` | — | 单源超时（默认 2s；整链另有 6s 预算） |
| `headers` | — | 合并进解析请求与嗅探请求的请求头 |
| `resolve` | ✅ | 取链步骤：`{ method?, url, body?, responseJsonPath }` |
| `search` | search-then-resolve ✅ | 搜索步骤：`resolve` 的字段 + `itemsPath/namePath/artistPath/idPath/urlPath/coverPath/albumPath` |

模板变量（`url`/`body` 中可用）：`{id}` `{source}` `{name}` `{artist}` `{keyword}`。`{source}` 填的是 MPlayer 的规范源键（`qq`、`netease`…），不是上游 API 自己的叫法。

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
| L4 `text-only` | 只验歌名 + 歌手精确匹配 | 搜索条目自带 / 解析响应里的 `name`/`artist` 常见字段 |
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

## 安全与限制

- **域名白名单 + 字节嗅探**：返回的 URL 必须落在 `allowedDomains` 且取到的头部字节是音频（拒 `text/html` 错误页）；完整大小 <1MB 的候选视为试听片段，跳过（宁可不播也不把试听当完整版）。护栏取证与嗅探共用**一次 64KB Range**。
- **预算**：单源解析默认 2s（`timeoutMs` 可覆盖），整链 6s；搜索腿 6s（耗尽返回已收集的部分候选）。嗅探独立 1s。
- **统计仅会话内**，不持久化、不做熔断/软降权（ADR-0014 决策 4/5）。
- **已知未解决**：服务器忽略 `Range` 时会缓冲整个响应直到超时，好 URL 可能被误判为坏源（需 transport 支持响应字节上限/提前中断）。
