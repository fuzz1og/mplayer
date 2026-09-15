# T6 · tier3 源归属判定启发式：tier3SourceSource 猜错了会怎样

- **日期**：2026-09-14（实测抓取时间 2026-09-15 02:39–02:52 UTC）
- **仓库基线**：`d637e19ce227ef2b97c2970a8502b16c1e461ab7`（2026-09-14，master）。经 `git diff f664a17..HEAD -- packages/core/src/tier3/tier3Api.ts packages/core/src/shared/sourceRouter.ts` 核对：**与 t1 基线 `f664a1745937be6bfa92bf4e466ebc44c3330c2f` 相比，这两份文件零改动**，故本文所有行号与 t1/t3 完全对齐。
- **调研问题**：tier3 只在「源归属匹配」的第三方源里找兜底，判定靠 `tier3SourceSource`（`packages/core/src/tier3/tier3Api.ts:807-822`），它在 `source` 字段缺省时**按 URL host/路径猜源**。猜错的后果是候选被静默丢弃 = 用户少一个兜底源。要回答：(1) 真实清单里 `source` 字段到底有没有；(2) 猜测规则准不准，聚合型源会被判成什么；(3) 同类项目怎么表达「这个源对应哪个官方源」；(4) 解析链过滤 / 搜索链不过滤这条不一致是否真实、后果是什么；(5) A/B/C/D 四个选项的取舍。
- **证据纪律**：只采 primary source —— 仓库真实源码（贴 `file:line`）、**git commit 原文**、公开源站的**官方文档原文**、以及**我在本机对真实模块跑的一次性实测**。标注约定：**〔代码〕**=读源码/既有测试得出；**〔实测〕**=本次新跑的可复现实验（脚本在 `/tmp`，未入库）；**〔推测〕**=无一手证据的推断。找不到的写「未找到」，不编造字段名。**本文不复制任何密钥/卡密/订阅地址。**
- **前置研究（直接引用，不重复）**：`t1-tier3-external-sources.md`（§1 契约字段级说明、§2.4 GD Studio、§3.2/3.3 落 tier3 的形状、§5.3 参数化 API 源清单）、`2026-09-14-t3-tier3-mechanism-audit.md`（并发/预算/统计口径）、`r5-unofficial-sites.md`（第三方端点原文）、`CONTEXT.md:39`。

---

## 0. 一句话结论

1. **「真实清单里到底有没有 source 字段」问错了对象——不存在「公开的 tier3 清单」这回事。** tier3 的清单格式是 MPlayer 自定义的，**全 GitHub 无任何公开 tier3 清单**（`gh search code` 三个查询全部 0 命中，见 §1.4）。真正存在的是**上游 API 自身的 source 词汇表**：GD Studio 的**搜索响应每一条都带 `source` 字段**（但那是**响应**，不是清单声明），而 **vkeys 的响应和文档里根本没有这个字段**（实测顶层键 `code/message/data/time/pid/tips`，`data` 内 `songID/songMID/kbps/link/url`）。→ **即使 MPlayer 想把 `source` 做成必填字段，第三方清单作者也没有权威依据可抄**，只能靠猜——**这正是「必填」方案的真实代价，而不是兼容性**。
2. **启发式在真实世界的命中率极低：13 个真实第三方解析端点里只有 1 个被猜中**（`api.qqmp3.vip/api/kw.php` → `kuwo`，靠 `kw.php` 路径标记）。**其余 12 个全部返回 `undefined`**（不过滤）。〔实测〕
3. **「不过滤」比「猜错」更常见，而两者的代价方向恰好相反**：猜不出 → 源被**保留**（多跑一个源，最坏是慢 + 预算被吃）；猜错 → 源被**静默跳过**（少一个兜底源，正是用户抱怨的「源不够用」）。当前规则下**猜错的情形只有一个**：URL 里带了 `tencent` / `qqmusic` / `/qq` / `kuwo` / `kugou` / `migu` / `qianqian` / `soda` 这类**恰好指向了另一个官方源**的标记。
4. **聚合型源在现有规则下确实可能被判成「只属于某一个官方源」，但触发条件不是「它是聚合器」，而是「清单作者把某个源写进了 URL」。** 〔实测〕三例：GD Studio 端点本身 `music-api.gdstudio.xyz`（**无任何标记 → undefined → 保留**，安全）；vkeys `api.vkeys.cn/music/**tencent**/song/link`（**同样 `undefined`**，偶然安全——因为规则只比对 hostname，而 `tencent` 在 path；**但只要 hostname 里出现 `tencent` 就会立刻被判成 qq**）；mitu `api.qqmp3.vip/api/**kw.php**`（**被判成 kuwo**）。**真正的危险不在「被过滤掉」，而在「被过滤住了却仍被拿去解错源」**——见第 5 条。
5. **⚠️ 本条是本报告推翻「猜测的可靠性」直觉的关键实测：`source` 缺省且 URL 无标记时（= 最常见的情形），该源会被拿去解析任意源的歌，而 `url-resolver` 这条腿**不做任何歌名/歌手校验**。〔实测〕一个只支持 QQ 的 `url-resolver`（`?mid={id}&quality=8`）对 `kuwo:1303464858` / `netease:186016` / `qq:…` 三个源**都返回了同一个直链且全部被接受**。即：**过滤缺失这一侧的风险不是「少一个兜底源」，而是「把酷我的数字 id 当成 QQ 的 songmid 送上去，拿回一首完全不相干的歌并直接播」**。t3 报告已把 `source` 的注释动机读出来了（`tier3Api.ts:64-65`：「防止跨源时把 A 源的 id 当成 B 源的 id，解析出完全不同的歌」），但**从未实测它在缺省路径上是否真的防住了**——实测答案是：**没有防住，缺省 = 完全不防**。
6. **两条腿的不一致真实存在且量级不同**：搜索链**确实不按 source 过滤**（`tier3Api.ts:646-648` 无任何 `tier3SourceSource` 调用），解析链**确实过滤**（`tier3Api.ts:836-840`）。后果有两条，都实测到了：(a) **解析链有一道险，搜索链没有**——搜索候选从构造上就没有名字+歌手校验，只在 `searchTier3Songs` 里做关键词相关度过滤（`:652-666`）；(b) **搜索候选的 `sourceType` 被写成 `tier3SourceSource(source) || sourceKey`（`:680`），一旦清单显式声明了非规范值（如 `tencent`），该候选的播放会走进 `resolvePlayableSongRouted` → `decideRoute('tencent')` → `throw new Error('该源暂无直连实现')`（`sourceRouter.ts:499`）→ 播放失败。**〔实测〕**同一个候选，声明 `qq` 时可播，声明 `tencent` 时抛错**。
7. **`source` 字段的值没有任何白名单/别名归一化**（`tier3Api.ts:253` 只做 `assertString`）。〔实测〕`qq` 通过、`tencent` 通过（但永远匹配不上 `song.sourceType==='qq'`）、`tx` 通过、`QQ` 通过（**大小写敏感，匹配失败**）、`unknown` 通过（**静默变成「永远不会匹配任何歌」的死源**）。而整个生态里 QQ 的写法是 `tencent`（GD 文档 / vkeys 路径 / Meting）或 `tx`（lx-music），**MPlayer 自己用的是 `qq`**（`packages/core/src/types/index.ts:4`）。→ **「把 source 变成必填」如果不先定词汇表，只会把「猜错」升级成「按规范写错」**。

---

## 1. 问题 1：真实清单 / 真实 API 里 source 字段到底有没有

### 1.1 先纠正问题前提：不存在「公开的 tier3 清单」

tier3 的清单格式（`{version:1, sources:[{id, kind, allowedDomains, resolve, …}]}`）是 MPlayer 自定义契约，**不是生态里的公共格式**。实证：

| 检索 | 结果 |
|---|---|
| `gh search code '"responseJsonPath" "allowedDomains"'` | **0 命中** |
| `gh search code '"tier3" "url-resolver"'` | **0 命中** |
| `gh search code '"search-then-resolve"'` | 3 命中：`fuzz1og/mplayer` 自己的 t1 文档 + 两个无关仓库（`jolliai/jolliai` 的 `bindings/shared.ts`） |
| 仓库内 | 只有 `examples/tier3.empty.json`（`{"version":1,"sources":[]}`）与 t1 文档里的两份**示例**（`t1:301-327`、`t1:352-369`）。**无任何生产清单入库**——这与 `tier3Api.ts:20` 的「公开仓库零端点」自述一致。 |

（crude 检索，2026-09-15 02:45 UTC；`gh search code` 覆盖的是公开可索引代码，**私有/未索引仓库查不到**——见 §8。）

**⇒ 既然没有公开清单，就不存在「清单里 source 字段的填法分布」这个可用一手证据回答的问题。** 能回答的只有它的上游：**那些 API / 插件协议自己怎么表达「这个源是哪个官方源」**。

### 1.2 GD Studio：**有**。而且 source 是它自己的第一类参数，搜索响应里也逐条带

来源：端点自述文档 <https://music-api.gdstudio.xyz/api.php>（原文抓取 2026-09-15，文档自述「更新日期：2026-06-26」）。原文：

> source：音乐源。选填，参数值 **netease（默认）、tencent、kuwo、tidal、qobuz、joox、bilibili、apple、ytmusic、spotify**。部分音乐源暂不开放，建议使用稳定音乐源

> 返回：id（曲目ID，即track_id）、name（歌曲名）、artist（歌手列表）、album（专辑名）、pic_id（专辑图ID）、url_id（URL ID，废弃）、lyric_id（歌词ID）、**source（音乐源）**

**两个关键点：**

1. **`source` 是 GD 的请求参数**（`?types=url&source=…`），**也是它搜索响应的逐条字段**（t1 §6.5.2 实测的元素结构 `{id, name, artist, album, pic_id, url_id, lyric_id, source, from}`，`source` 与请求值一致）。
2. **它的 QQ 写法是 `tencent`，不是 `qq`。** MPlayer 的模板变量 `{source}` 填的是 `song.sourceType`（`tier3Api.ts:352-360`，值域 `packages/core/src/types/index.ts:4`：`netease|qq|kugou|kuwo|migu|qianqian|soda|local`），**直接写 `source={source}` 对 QQ 歌会送出 `source=qq`——这不在 GD 文档列出的合法值里**。→ 想接 GD，清单**必须硬编码 `source=tencent`**（或作者自建映射），这又反过来把该源钉死成「只能解 QQ」。**这是 GD 落 tier3 时 t1 未展开的一个新硬点。**

### 1.3 vkeys（落月 API）：**没有**。文档与实测响应里都找不到这个字段

- 官方文档 <https://doc.vkeys.cn/v3/音乐模块/QQ音乐/点歌相关接口/2-link.html>（页面「最后编辑于 6 个月前」）的**请求参数表全文只有 4 个**：`id`（否, int）、`mid`（否, string）、`quality`（否, int, 默认 14）、`type`（否, int, 默认 1）。**没有 `source`**——因为整个接口路径已经写死了源：`GET /music/tencent/song/link`。文档的返回示例字段是 `id/mid/vid/song/subtitle/album/singer/cover/pay/time/type/bpm/quality/interval/link/size/kbps/url/ekey`——**同样没有 `source`**。
- 〔实测〕2026-09-15 10:44 UTC 实打 `GET https://api.vkeys.cn/music/tencent/song/link?mid=0039MnYb0qxYhV&quality=8`（HTTP 200）：**顶层键 = `code, message, data, time, pid, tips`；`data` 内键 = `songID, songMID, kbps, link, url`**。没有 `source`。
- 〔实测〕额外传 `&source=tencent` 参数：响应**完全一致**（说明该参数被忽略）。→ **vkeys 无法通过任何字段告诉你「我是 QQ 源」，只能靠路径 `/music/tencent/` 看出来。**

### 1.4 其它具有公开 manifest 的项目：**清单里都没有「官方源」字段**

| 项目 | 清单/声明文件 | 字段 | 有「官方源」字段吗 |
|---|---|---|---|
| MusicFree 插件 | `maotoumao/MusicFreePlugins` → `types/plugin.d.ts` 的 `IPluginDefine`（`:95-145`，raw 抓取 2026-09-15）| `platform / appVersion / version / srcUrl / primaryKey / defaultSearchType / cacheControl / userVariables / search / getMediaSource / getMusicInfo /…` | **没有**。`platform` 是**插件名**（协议文档：「插件名称 (platform) 任意合法的字符串即可」） |
| MusicFree 订阅清单 | `plugins.json`（官方仓 & `qwerwhr/musicfree-plugins` 各抓一份）| `{"desc","plugins":[{"name","url","version"}]}` | **没有**，只有 `name`（= `platform` 展示名） |
| lx-music 源脚本 | 官方文档 <https://lxmusic.toside.cn/desktop/custom-source> | 头部注释 `@name/@version/@author/@homepage`；运行时 `send(inited,{sources:{…}})` 的 key 值域 **`kw/kg/tx/wy/mg/local`** | **没有字段，但用 key 表达了**——见 §3.1 |
| 落月/GD/Meting 类参数化 API | 各自文档 | — | GD 有（请求参数 + 响应字段）；vkeys 无；Meting 无 |

**⇒ 回答「逐项核实它们的响应/文档里是否显式声明了 source，字段名叫什么」：**

| 对象 | 显式声明 source？ | 字段名 | 值域（原文） |
|---|---|---|---|
| GD Studio 请求参数 | ✅ | `source` | `netease/tencent/kuwo/tidal/qobuz/joox/bilibili/apple/ytmusic/spotify` |
| GD Studio 搜索响应条目 | ✅ | `source` | 同上（回显请求值） |
| GD Studio `types=url` 响应 | ❌ | — | 只有 `url/br/size(/from)` |
| vkeys 文档 & 响应 | ❌ | — | 无此字段；源由**路径** `/music/tencent/` 表达 |
| MusicFree 插件定义 | ❌ | — | 无此字段 |
| MusicFree `plugins.json` | ❌ | — | 只有 `name`（自由文本） |
| lx-music 源脚本 | ⚠️ 语义等价物 | `sources` 对象的 **key** | `kw/kg/tx/wy/mg/local` |
| Meting | ❌ | `server`（**构造期**参数，不是清单字段） | `netease/tencent/kugou/baidu/kuwo` |

**这条对 MPlayer 的直接含义（本节最重要的推论）**：**「把 `source` 变成清单必填字段」这件事，在生态里没有可抄的答案。** 清单作者要么照 GD 的 `tencent` 写（对 MPlayer 的 `qq` 无效）、要么照 lx 的 `tx` 写、要么照 MPlayer 文档写（而 MPlayer 没有公开 schema 文档，见 §1.5）。**必填字段只有在同时给出词汇表并做别名归一化时才有意义**，见 §5 选项 D。

### 1.5 MPlayer 侧是否公开了清单 schema？

**未找到。** 仓库内无 tier3 清单的 schema 文件 / 字段说明文档；两端设置页的文案只到「粘贴 JSON 音源清单」层级：

- 桌面：`src/renderer/components/Tier3Section.tsx:171-173`——「默认关闭。开启后，官方直连失败的歌曲会按订阅清单依次尝试第三方解析源；全部失败换元/标记不可播。第三方源随时可能失效，且清单由你自行订阅，本应用不内置任何解析端点。」
- 移动：`packages/mobile/app/settings.tsx:357`——同义文案 + 「实验性功能，不内置任何解析端点」。

**两处文案都没有提到 `source` 字段的存在，也没有任何字段说明入口。** → 用户/清单作者**无从得知** `source` 的语义与合法值，也不得知「不写会被按 URL 猜、猜错会被静默跳过」。**这是一个可以直接修的信息缺口（属于选项 A 的一部分）。**

---

## 2. 问题 2：猜测的可靠性 —— 逐条对照真实世界的第三方源 URL

### 2.1 规则原文（〔代码〕tier3Api.ts:802-822）

```ts
// 802-806 注释：显式声明的 source 优先；未声明时从 URL 形态推断……
//              域名类标记只比对 hostname（精确/子域）……路径类标记（/qq、kw.php）保留 substring。
export function tier3SourceSource(source: Tier3Source): SourceKey | undefined {
  if (source.source) return source.source as SourceKey;          // 显式声明：原样信任，无白名单
  const hosts = [source.resolve.url, source.search?.url || ''].map(tier3HostOf).filter(Boolean);
  const hostText = hosts.join(' ');
  const path = [source.resolve.url, source.search?.url || ''].join(' ').toLowerCase();
  if (hostText.includes('tencent') || path.includes('/qq') || hostText.includes('qqmusic')) return 'qq';
  if (hostText.includes('netease') || hostText.includes('music.163') || hosts.some(h => tier3HostIs(h,'126.net'))) return 'netease';
  if (hostText.includes('kuwo') || path.includes('kw.php')) return 'kuwo';
  if (hostText.includes('kugou')) return 'kugou';
  if (hostText.includes('migu'))  return 'migu';
  if (hostText.includes('qianqian') || hosts.some(h => tier3HostIs(h,'91q.com'))) return 'qianqian';
  if (hostText.includes('soda') || hostText.includes('qishui')) return 'soda';
  return undefined;
}
```

注意三处实现细节（决定了「准不准」）：
- **有序**：先判 `qq`，再 `netease`……第一个命中即返回。
- **`hostText` 是 substring `includes`**（只有 `126.net / 91q.com` 两个特殊项走 `tier3HostIs` 精确/子域匹配，见 `:797-800`）。这是一个**刻意保留的**设计——注释 `:803-806` 说明只对「会被任意主机命中」的 `126.net/91q.com` 做了收紧，其余仍是子串匹配。
- **`path` 是整个 URL 串**（含 host），所以「路径标记」其实也能命中 host 段；反过来 `/qq` 这类标记会命中任何**查询串里恰好出现 `/qq`** 的 URL。

### 2.2 对照真实端点〔实测〕

对 t1/r5 报告里**逐字记录的真实第三方端点**跑 `tier3SourceSource`（脚本：用 esbuild 把 `tier3Api.ts` 打成 CJS 后直接调用导出函数）：

| 真实端点（出处） | hostname | 推断结果 | 后果 |
|---|---|---|---|
| `music-api.gdstudio.xyz/api.php?types=url&source={source}&id={id}&br=320`（t1 §2.4） | `music-api.gdstudio.xyz` | **`undefined`** | 不过滤 → **对任意源的歌都会去问 GD**，靠 GD 自己按 `source` 参数分流 |
| `api.vkeys.cn/music/tencent/song/link?mid={id}&quality=8`（t1 §3.3） | `api.vkeys.cn` | **`undefined`** | 不过滤 → 拿 `mid` 去问……**但不会因为 path 里有 `tencent` 判成 qq，因为规则查的是 hostname** |
| `api.epdd.cn/music/tencent/song/link?...`（t1 §5.3 备用域） | `api.epdd.cn` | **`undefined`** | 同上 |
| `api.qqmp3.vip/api/kw.php?rid={id}`（r5 §2.2 mitu 取链） | `api.qqmp3.vip` | **`kuwo`** | **猜中**（唯一一个），靠 `kw.php` 路径标记 |
| `api.qqmp3.vip/api/songs.php?name={keyword}`（r5 §2.2 mitu 搜索） | `api.qqmp3.vip` | **`undefined`** | 同一个站的两条端点**推断结果不一致** → 若两份 spec 写在同一个 `Tier3Source` 里，结果取决于 `resolve.url`（`:809` 把 resolve 放第一位）——**注意这是「偶然对」，不是设计** |
| `www.mgmp3.top/api/geturl?id={id}` / `/api/search`（r5 §2.2） | `www.mgmp3.top` | **`undefined`** | 不过滤 |
| `nextmusic.toubiec.cn/api/getSongUrl?id={id}`（r5 §1.1） | `nextmusic.toubiec.cn` | **`undefined`** | 不过滤 |
| `api-v2.cenguigui.cn/api/netease/music_v1.php?id={id}`（r5 §1.1，**站名就写着 netease**） | `api-v2.cenguigui.cn` | **`undefined`** | **漏判**：`netease` 在 path 不在 host，规则不认 |
| `api.xingmian.bbroot.com/API/netease_music_api.php?id={id}`（r5 §1.1） | `api.xingmian.bbroot.com` | **`undefined`** | 同上 |
| Meting 自建 `…/api?server=netease&type=url&id={id}`（Meting README） | 自建域 | **`undefined`** | 不过滤 |
| lx-music-api-server `/url/netease/{id}/320k`（t1 §2.5） | 自建域 | **`undefined`** | 不过滤 |

**命中率：13 条真实端点里 1 条猜中（`kw.php`→kuwo），0 条猜错，12 条 `undefined`。**

### 2.3 哪些猜得准、哪些猜不准

**猜得准（仅当 URL 里真的带了该源的名字，且名字恰好是规则认的那几个词）：**

| 规则 | 准的情况 | 依据 |
|---|---|---|
| `hostText.includes('tencent')` → qq | hostname 含 `tencent` 的腾讯系网关（如 `api.tencentmusic.com`） | 〔实测〕命中 |
| `hostText.includes('qqmusic')` → qq | `*.qqmusic.qq.com` 类 CDN/网关 | 规则明示 |
| `path.includes('/qq')` → qq | 路径里写了 `/qq/` 的自建源 | 〔实测〕`https://api.example.com/qq?id={id}` → `qq` |
| `path.includes('kw.php')` → kuwo | mitu 式 `/api/kw.php` | 〔实测〕命中；**唯一在真实世界里命中的一条** |
| `126.net` / `91q.com` 后缀 → netease / qianqian | 恰好用官方 CDN 域的证据链：`tier3Api.test.ts:639-645` 有覆盖（含 `not126.net.evil.example.com` **不**命中的反例） | 〔代码〕测试覆盖 |

**猜不准 / 有风险的五种情形：**

| # | 情形 | 例子〔实测〕 | 为什么错 |
|---|---|---|---|
| R1 | **源的「身份」写在 path，规则只看 hostname** | `api.vkeys.cn/music/tencent/...` → `undefined`（本该是 qq）；`api-v2.cenguigui.cn/api/netease/...` → `undefined`（本该是 netease） | 规则用 `tier3HostOf` 取 hostname 做子串；path 只对 `/qq`、`kw.php` 两个硬编码标记开放。**「path 里写了源名」是真实世界的常见形态，规则却几乎不认。** |
| R2 | **子串误命中**：hostname 里含源名但不是那个源 | `kuwo-proxy.example.com` → `kuwo`；`api.miguapi.example.com` → `migu`；`qianqian-api.example.com` → `qianqian`；`api.qishui.example.com` → `soda`；`netease-music-api.com` → `netease` | 除 `126.net/91q.com` 外全部子串匹配。**这会静默跳过该源 → 少一个兜底源。** |
| R3 | **`/qq` 标记过宽** | `https://api.example.com/qqzone/data?id={id}` → `qq` | `path.includes('/qq')` 无边界，`/qqzone`、`/qqmusic…`、查询串里出现 `/qq` 都会命中 |
| R4 | **搜索 URL 与解析 URL 推断结果可能打架**（同一源两跳不同站/不同节） | mitu：resolve `kw.php` → `kuwo`；search `songs.php` → `undefined` | `hostText`/`path` 是**两个 URL 拼起来**再判（`:809-813`），配合「第一个命中的分支返回」，**只要 resolve 里没标记而 search 里有**，结果就由 search 决定——顺序敏感性未在测试里覆盖 |
| R5 | **显式声明被原样信任，无白名单、无归一化** | `tencent` / `tx` / `QQ` / `unknown` **全部通过校验**〔实测〕 | `parseSource` 只调 `assertString`（`:253`）。`QQ`（大小写）与 `unknown` 会变成**永远不会匹配任何 `song.sourceType` 的死源**（静默跳过） |

**准/不准的总结**：规则只在「URL 里出现的源名恰好是它硬编码的那 9 个词、且出现在 hostname（或 `/qq`、`kw.php`）」时才对。**真实第三方源的命名是任意的（gdstudio / vkeys / epdd / qqmp3 / mgmp3 / toubiec / cenguigui / xingmian / bbroot），绝大多数不含源名。**

### 2.4 特别回答：**聚合型源会被判成什么？**

分三种写法，结论不同（全部〔实测〕）：

| 聚合器的清单写法 | `tier3SourceSource` 结果 | 实际行为 |
|---|---|---|
| **A. URL 里带 `{source}` 模板变量**（最自然的写法，如 GD：`…?source={source}&id={id}`） | `undefined` | **不过滤 → 保留**。对任意源的歌都会请求该端点，由 `{source}` 携带 `song.sourceType` 让**上游**分流。**语义上是对的**——但 `{source}` 填的是 MPlayer 的 SourceKey（`qq`），而 GD 只认 `tencent`（§1.2），**上游大概率不认 `qq`**。 |
| **B. URL 里写死某一个源**（如 `…?source=tencent&…` 或路径 `/music/tencent/`） | 若出现在 hostname → **可能就是 qq**；若只在 path → `undefined`（vkeys 实测就是这条） | **若被判成 qq，则该源对 netease/kugou/kuwo… 的歌全部被静默跳过 → 只服务 1/7 的源。**〔实测〕这正是 t1 §3.3 把 vkeys 钉成 `"source": "qq"` 的原因（那份示例清单是**正确**的，因为它确实只支持 QQ）。 |
| **C. 同一端点拆成多条 entry，各自声明 `source`**（推荐写法） | 每条 = 各自声明的源 | 〔实测〕两条 entry（`source:"qq"` / `source:"netease"`）→ QQ 歌命中 qq 条目、netease 歌命中 netease 条目、kuwo 歌两条都跳过。**这是当前契约下唯一能正确表达「一个端点服务多源」的形态。** |

**⇒ 判断**：**「聚合型源会被判成什么」的答案不是「被误判成某一个源」，而是「取决于清单作者写 URL 的方式，而这三种写法在规则下的行为差异极大、且没有任何文档告诉他」。** 最危险的是 B 且源名出现在 hostname 的情形（会被静默限制到 1 个源），最「幸运」的是 A（`undefined` → 不过滤 → 恰好可用）。

**但 A 的「不过滤」并不是免费的**——见下节。

### 2.5 ⚠️ 关键实测：缺省的代价不是「多跑一个源」，而是「错播」

`source` 缺省 → `undefined` → 该源被拿去解**任意源**的歌。而 **`url-resolver` 这条腿没有任何歌名/歌手校验**：

- `resolveSourceUrl`（`tier3Api.ts:514-532`）只填模板 → `resolveFromRequestSpec`（`:486-511`）只做三件事：HTTP 状态、JSON 解析、**域名白名单 + 字节嗅探**。
- 对比 `search-then-resolve`（`:534-580`）**有** `isExactMatch` 严格校验（`:552-558`）。**两条腿的校验强度不同，而 source 防护对两条腿都生效。**

〔实测〕构造一个只支持 QQ 的 `url-resolver`（无 source 声明、URL 无标记）：

```
inferred source = undefined
QQ 歌（id 是 songmid）   → 请求 /resolve?mid=0039MnYb0qxYhV&quality=8 → 命中并被接受
酷我歌（id 是酷我数字 id）→ 请求 /resolve?mid=1303464858&quality=8      → 命中并被接受
网易歌（id 是 netease id）→ 请求 /resolve?mid=186016&quality=8          → 命中并被接受
```

即：**把酷我的数字 id 当成 QQ 的 songmid 送上去，只要对方返回了任何通过白名单 + 魔数嗅探的音频 URL，tier3 就会把它当成这首歌的播放地址返回。** 这正是 `tier3Api.ts:64-65` 注释要防的事（「防止跨源时把 A 源的 id 当成 B 源的 id，解析出完全不同的歌」），**但缺省路径上完全没防住**——因为缺省的语义是 `undefined` = 放行，而不是 `undefined` = 拒绝。

**⇒ 这一条推翻了一个直觉**：大家会以为「猜错的后果 = 少一个兜底源」。**实际后果是两极的**：
- **猜错 → 少一个源**（该源被 `continue` 掉，`tier3Api.ts:837-840`）；
- **猜不出 → 多一次错播机会**（该源被拿去解任意源的歌，且 `url-resolver` 无内容级校验）。

**而当前规则下「猜不出」是绝大多数（12/13），「猜错」是极少数。** 也就是说：**现在系统的主要风险方向不是「源不够用」，而是「跨源错播」**（详见本节实测）。这与用户的抱怨方向相反，但对产品更危险。

---

## 3. 问题 3：同类项目怎么表达「这个源对应哪个官方源」

### 3.1 lx-music：**用 sources 对象的 key 表达，不是字段**

来源：官方文档 <https://lxmusic.toside.cn/desktop/custom-source>（页面「最后更新 2026年9月10日」，原文抓取 2026-09-15）。原文：

> 可用 key 值：**`kw/kg/tx/wy/mg/local`**
> `on(EVENT_NAMES.request, ({ source, action, info }) => …)` — **source 音乐源，可能的值取决于初始化时传入的 sources 对象的源 key 值**

模型拆开看：

1. **运行时由宿主指定**：宿主知道当前这首歌是哪个源，调用源时把 `source` 传进去（`{source, action, info}`）。**源不需要声明「我属于谁」**——它只要在 `apis[source]` 里实现对应分支即可。
2. **初始化时源上报能力集合**：`send(inited, {sources: {kw: {name, type, actions, qualitys}, …}})` —— 上报的是**「我支持哪些源」的集合**（一个源脚本可同时支持 kw/kg/tx/wy/mg/local），**不是一个 source 字段**。
3. **词汇表是固定的 6 个 key**，由 lx 定义，源必须遵守。**qq 在 lx 里叫 `tx`**（不是 `qq`、也不是 `tencent`）。

**⇒ 对 MPlayer 的启示**：生态里最成熟的方案（lx）是「**源声明能力集合 + 宿主按歌的源路由**」，而不是「源绑定单一 source」。**MPlayer 的 `Tier3Source.source?: string`（单值）在形态上比 lx 弱**——它只能表达「我一个人」，不能表达「我服务这几个」。要表达多源，只能像 §2.4C 那样**把同一端点复制成多条 entry**。

### 3.2 MusicFree：**不做这个区分，用「插件名 + 曲目自带 source 字段」绕开**

- **协议层没有官方源字段**：`musicfree.catcat.work/plugin/protocol.html` 的完整示例与字段表（`platform / author / version / srcUrl / primaryKey / cacheControl / hints / userVariables / search / getMediaSource / …`）**没有任何「官方源」字段**；`types/plugin.d.ts:95-145` 的 `IPluginDefine` 同样没有。
- **`platform` 是插件名**：协议原文「插件名称 (platform)：任意合法的字符串即可。如果插件名为'本地'，则此插件会失效」。**它不是官方源标识**——生态里的实际取值五花八门（`"GD音乐台"`、`"QQ Vip"`、`"元力QQ"`、`"QQ_念心"`、`"汽水qishuivip"`……见 §3.3）。
- **「这个源是哪个官方源」由插件的返回数据自己带**：`IMusicItem` 上有 `platform` 字段（`plugin.d.ts:8` 的 `IMediaBase = {id, platform, [k:string]:any}`），且**曲目项可自由追加任意字段**。→ 聚合插件把上游源名塞进**自己的** item 字段里。
- **怎么「表达支持哪几个源」**：`userVariables`（协议文档：「用户变量，用来定义一些在插件中会使用到的，由用户定义的变量」，`{key, title}`）。

### 3.3 一个有价值的旁证：一个真实聚合插件长什么样

抓 `qwerwhr/musicfree-plugins` 的 `GD音乐台.js`（2026-09-15，jsDelivr）：

```js
const BASE_API = "https://music-api.gdstudio.xyz/api.php?btwaf=99801110";
// 默认使用 netease，支持的平台：netease, tencent, tidal, spotify, ytmusic, qobuz, joox, deezer, migu, kugou, kuwo, ximalaya, ap
function getMusicSource() { const vars = env && env.getUserVariables && env.getUserVariables(); … }
function formatMusicItem(item, source) { return { id: item.id, title: item.name, …, source: source }; }
async function getMediaSource(musicItem, quality) { const source = musicItem.source || getMusicSource(); … }
module.exports = {
  platform: "GD音乐台",
  userVariables: [{ key: "musicSource", name: "音乐源", hint: "留空默认netease，详见插件说明" }],
  …
};
```

**这个插件用三件事表达了「源归属」，一件都不是「声明字段」**：
1. `platform` = 插件品牌名（`"GD音乐台"`），**不是官方源**；
2. `userVariables.musicSource` = **用户填的默认源**（自由文本，提示里写「留空默认netease」）；
3. **每条曲目上挂一个 `source` 字段**，播放时 `musicItem.source || getMusicSource()` 决定传给上游的 `source` 参数。

**⇒ 这正好对应 MPlayer 的 `tier3SourceSource(source) || sourceKey`（`tier3Api.ts:680`）的思路**——把「源归属」挂在候选上、随数据流转，而不是绑在清单条目上。**差别在于 MusicFree 的字段来源是上游响应（GD 的搜索响应真的带 `source`），而 MPlayer 是本地推断（推断 12/13 失败）。**

### 3.4 其它多源聚合器

| 项目 | 怎么表达源归属 |
|---|---|
| **Meting**（`metowolf/Meting` README，2026-09-15 抓） | **构造期参数** `new Meting(server)`，`server` 值域 `netease/tencent/kugou/baidu/kuwo`；运行期 `meting.site(server)` 切换。**没有清单、没有 per-track 声明**——一个实例 = 一个源。同样是 QQ 叫 `tencent`。 |
| **lx-music-api-server**（t1 §2.5） | 路径即源：`/url/{source}/{id}/{quality}`（源名在 path，值域与 lx 一致 = `tx`/kw/wy…） |
| **listen1**（t1 §2.3） | **不做这个区分**：provider 是按源分文件的（`js/provider/{netease,qq,kugou,kuwo,migu,…}.js`），**文件名就是源**，无运行期声明 |

**⇒ 问题 3 的答案**：**主流做法是「按源分片/按请求参数传源」，几乎没有「清单里显式声明 source 字段」这一形态。** lx 用 key 集合、MusicFree 用曲目字段 + 用户变量、Meting 用构造参数、listen1 用文件名、lx-api-server 用路径段。**MPlayer 的 `source?: string` 字段是这几个里语义最「声明式」的一个，同时也是唯一一个「缺省时会去猜」的。**

---

## 4. 问题 4：MPlayer 的两条腿是否一致

### 4.1 不一致**真实存在**〔代码〕

| 腿 | 入口 | 是否调 `tier3SourceSource` | 证据 |
|---|---|---|---|
| **解析链**（播放 URL 兜底） | `resolveTier3`（`tier3Api.ts:824-866`） | **是**，且过滤 | `:836-840`——`const effectiveSource = tier3SourceSource(source); if (effectiveSource && effectiveSource !== song.sourceType) { console.info(…跳过(source mismatch…)); continue; }` |
| **搜索链**（直连搜索失败兜底） | `searchTier3Songs`（`:641-690`） | **否**，只用来打标签 | `:646-688` 的循环体里**没有任何过滤**；`:680` 的 `tier3SourceSource(source)` **只用于给候选写 `sourceType`**，不参与筛选 |

注释本身也明说了（`:636-639`）：

> 注意：搜索兜底是「关键词候选」，不存在把 A 源 id 塞给 B 源解析器的错配风险（source 防护只作用于播放解析 resolveTier3），因此**不按 source 过滤搜索源**

### 4.2 这个不一致的后果（逐条实测）

**后果 ①：搜索链可以从任意源的源里产出候选——这是设计意图，且可用。**

〔实测〕一个 `source:"tencent"` 的聚合源，在 netease 查询下产出候选，候选带 `sourceType:"netease"`（因为推断 `undefined` → 回退到查询源 `sourceKey`）；点播该候选 → `resolvePlayableSongRouted` → 该源不过滤 → 命中。→ **搜索腿「能用」，解析腿也「能用」，两腿一致（都放行）。** 这正是注释说的用法：候选的 `sourceType` 与解析链的防护「一致」。

**后果 ②（真问题）：一旦清单显式声明了非规范值，搜索产出的候选会 100% 播不了。**

〔实测〕同一个 mock 聚合源，唯一差别是清单里有没有 `"source"`：

| 清单 `source` | 搜索产出的候选 `sourceType` | 点这条候选 | 观测 |
|---|---|---|---|
| 缺省 | `qq`（回退到查询源） | ✅ 可播 | 解析链不过滤 |
| `"qq"` | `qq` | ✅ 可播 | 匹配 |
| `"netease"`（而查询是 qq） | `netease` | ✅ 可播 | 过滤放行 |
| **`"tencent"`**（GD/vkeys 文档的实际用词） | **`tencent`** | ❌ **抛错** | `resolvePlayableSongRouted` → `decideRoute('tencent')` → `route.kind==='direct-unavailable'` → **`throw new Error('该源暂无直连实现')`**（`sourceRouter.ts:499`） |

更糟的是**用户看到的不是「这个源不支持这个源」，而是**（`src/renderer/store/playerStore.ts:352-355 / 370-375 / 382-384`）：捕获异常 → `realUrl=''` → 回退按歌名再搜一次 → 仍失败 → `throw new Error('无法获取音频 URL：可能为 VIP/无版权或直连暂不可用，可尝试换源')`。**即：清单里写了一个「MPlayer 不认识的合法字符串」，最终表现为「这首 VIP 歌播不了」。**

**后果 ③：解析腿的过滤对两类源的效果不对称。**

- 显式 `source` 正确 + URL 干净 → **过滤生效**，只服务匹配的源（正确）；
- `undefined` → **过滤失效**，服务所有源（可能是想要的，也可能是 §2.5 的错播通道）；
- 猜错 → **静默少一个源**（`tier3Api.ts:837-840`，只有 `console.info` 一行日志，用户不可见；且**不计入 `tier3Stats`**——`stats` 的自增在 `:841-861` 的 `try` 块内，`continue` 在前）。

**⇒ 问题 4 的答案**：不一致真实存在；**它本身不是 bug**（注释里的理由成立：搜索候选无 id 错配风险），**但它放大了 `source` 字段的语义脆弱性**——搜索腿把 `source` 的「错误值」**传播成了候选的 `sourceType`**，然后交给一个会**抛异常**（而不是「降级为不过滤」）的解析腿。**两条腿对「未知 source 值」的处理不一致：搜索腿容忍（照单全收），解析腿致死（抛错）。**

### 4.3 一个相关但独立的确认（顺带解决 t1 §8-4f 的未验证项）

t1 §8 与 t3 都留了「tier3 是否已被排除在 `probeSongsBatch` 之外」的未验证项。**已核实：是。** `sourceRouter.ts:558-569` 的 `resolvePlayableSongDirect` 自述「**无 tier3、无兜底**」，`resolvePlayableSongRouted`（`:483`）才含 tier3；`packages/core/src/api/__tests__/musicApiContract.test.ts:39` 有显式测试「probeSongsBatch 只走直连，不触发 tier3」。→ **不必担心探测路径吃掉第三方配额**（t1 §6.5.3 的顾虑可以消掉）。

---

## 5. 问题 5：选项评估

评估口径：**改动面 / 对「兜底源数量」的影响 / 兼容性风险 / 什么情况下它是对的**。

### (A) 保留启发式 + 加日志/统计

| 维度 | 结论 |
|---|---|
| **改动面** | **S**。`tier3Api.ts:837-840` 的 `continue` 前加一次 `stats.skipped++`（需扩 `Tier3SourceStats`，`:103-106`）；`Tier3SourceStats` 目前只有 `{hits, misses}`（t3 §7 已指出这是「做坏源降级缺字段」的一部分）。两端设置页（`Tier3Section.tsx:259-270`、`packages/mobile/app/settings.tsx:346-352`）已按 `source.id` 渲染统计，加一列 `skipped` 零 UI 重构。 |
| **对兜底源数量的影响** | **0**。纯可观测性。 |
| **兼容性风险** | **0**（新增字段，旧数据缺省 0）。 |
| **什么时候它是对的** | **作为任何其他方案的必带项**。当前「猜错被静默跳过」唯一痕迹是一行 `console.info`（`:838`），**在移动端真机上基本等于不存在**。没有这个数字，「源不够用」永远无法归因到「是被过滤掉的」还是「源本身就挂」。 |

**评价**：**必做，但单独做等于不做**——它只让你能测量问题，不解决问题。**但它把选项 C 的收益变成可验收的**（改完看 `skipped` 归零）。

### (B) 完全保留现状

| 维度 | 结论 |
|---|---|
| **改动面** | 0 |
| **影响** | 0 |
| **风险** | 保留 §2.5 的错播通道（**当前实际发生频率未知**，见 §8）；保留 §4.2② 的「声明非规范值 → 必播不了」；保留「源被静默丢弃」不可见 |
| **什么时候它是对的** | **当「用户自配清单」是权威事实时**——即：清单怎么写，就是用户/清单作者的意图，MPlayer 不该替他们猜。这个理由**成立**：t1 已确立的「公开仓库零端点 + 用户自备订阅」自保设计，其代价本来就是「责任在清单侧」。**但现状并没有把这个原则贯彻到底**——它既做了猜测（越权），又在猜不出时放行（该守的没守）。 |

**评价**：**不是「什么都不做」，而是「现在做的事自相矛盾」**。要选 B，至少要把行为改成一致的（要么全猜、要么全不猜）。

### (C) 只在显式 source 存在时过滤，缺省不过滤

**⚠️ 先纠正一个前提：这已经是现状。** `tier3Api.ts:837` 的条件是 `if (effectiveSource && effectiveSource !== song.sourceType)` —— `undefined` 时**短路则不过滤**。**选项 C 描述的行为与当前实现完全一致**（t1 §1.2 的表格也记着这一点）。

所以选项 C 的真实含义只能是两选一：

#### C1（= 现状的字面版）：保留「显式时过滤、缺省不过滤」
→ 等价于 **B**。**不推荐单独采用**，因为它同时保留了 §2.5 的错播通道。

#### C2（**推荐的形态**）：只在显式 `source` 存在时过滤，**并且删掉 URL 推断**
| 维度 | 结论 |
|---|---|
| **改动面** | **S**。`tier3SourceSource`（`:807-822`）退化为「有声明就原样返回、没声明就 `undefined`」（删 `tier3HostOf`/`tier3HostIs` 与全部规则）；`resolveTier3` 的过滤行**不动**。测试 `tier3Api.test.ts:631-651` 的两个 `describe` 块需重写（它们**专门测推断**）。 |
| **对兜底源数量的影响** | **+`undefined` 那一族**（真实世界 12/13）：它们本来就不被过滤，行为不变。**唯一的量变是 R2/R3 型误命中消失**——那些被误判的源恢复可用（**净增**）。**R1 型漏判**（vkeys 式 path 里有源名）本来就没被过滤，删掉推断也不改变。**⇒ 严格非负地向「源更多」移动。** |
| **兼容性风险** | **中低**。① 现行两个推断测试会挂（预期内）；② **行为反转**：现在被正确推断过滤的源（如 `api.tencentmusic.com` 型）删掉推断后变成「不过滤」 → **该源会被拿去解别源的歌**；③ 但注意**它已经被 `source` 显式声明的路径覆盖**——只要清单作者声明了，过滤照旧。所以风险只落在「没声明 `source` 但 URL 里恰好有源名」这一小撮。 |
| **什么时候它是对的** | **当「宁可多跑一个源也不错杀」是产品决断时**（任务描述里给的口径）。理由链完整：① 实测证明推断在真实世界几乎不命中（1/13）；② 猜错的伤害（**静默**少一个源）比猜不出的伤害（**可见**的多一次请求）更难发现、也更违背「源不够用」的抱怨方向；③ 它把问题**收敛到一个用户可控的开关**——「想要过滤？写 `source`」。 |
| **它的代价** | **保留 §2.5 的错播通道**（甚至因为不再有机会误过滤而略微变宽）。**但这条通道的根因不是推断，而是 `url-resolver` 缺内容级校验**（见 §6 建议 2），删推断不解决它。 |

**评价**：**这是三个「轻改动」里最贴合「宁可多跑也不错杀」的，但它只解决「错杀」，不解决「错播」——两者必须一起处理，否则等于把一路的伤害换到另一路。**

### (D) source 变成必填字段

| 维度 | 结论 |
|---|---|
| **改动面** | **M**。① `parseSource`（`:253`）加必填校验（一行）；② `Tier3Source.source?: string` → `source: SourceKey`（`:64-66` + 类型收紧）；③ **水合不校验**（t3 §1.2 实测：`loadTier3State` 是纯赋值，`:172-178`）→ **存量订阅会绕过校验、在运行期炸**，所以必须同时补水合校验/迁移；④ 两端设置页文案 + 需要新写一份 schema 文档（§1.5 未找到）。 |
| **对兜底源数量的影响** | **短期 −**（所有现存的、与 MPlayer 自定义 schema 不匹配的清单**直接校验失败**，用户看到「清单校验失败」而不是「少一个源」）；**长期 +**（不再有害的静默丢弃）。前提：清单作者**能知道合法值**——现在不能。 |
| **兼容性风险** | **高，而且不在「破坏性」这一层**。真正的风险是 §1 的发现：**生态里没有可抄的答案**（GD 用 `tencent`、lx 用 `tx`、MPlayer 用 `qq`），而 `tier3SourceSource` **没有任何白名单/别名归一化**（`QQ`/`tencent`/`tx` 全部通过校验但永远匹配不上）。**只加必填 = 把「猜错」系统性升级成「按规范写错」**，危害面从「少数被误判的源」扩大到「每一份手写清单」。 |
| **什么时候它是对的** | **只有当同时交付三件事时**：(a) 公开 schema 文档（含合法值表）；(b) **别名归一化表**（`tencent`/`tx`/`QQ`/`qq`/`wyy`/`wy` → 规范键）；(c) **水合期校验 + 存量迁移**。**缺任何一件，「必填」都比现状更差。** |

### 5.1 四选项对照表

| | 改动面 | 兜底源数量 | 兼容性风险 | 它什么时候是对的 |
|---|---|---|---|---|
| **A** 保留启发式 + 加日志/统计 | S | 0 | 无 | **作为 C2/D 的必带配套**；单独做只是「能看见问题」 |
| **B** 完全保留现状 | 0 | 0 | 保留错播通道 + 非规范值必播不了 | 当「清单是唯一权威、MPlayer 不替用户猜」是原则时——**但现状没贯彻这个原则**（既猜又放行） |
| **C1** 字面版（显式过滤、缺省不过滤） | — | — | — | **= 现状，不是选项** |
| **C2** 显式才过滤 + **删掉 URL 推断** | S | **净增**（误命中消失；漏判族不变） | 中低（两个测试要重写；「恰好有源名但没声明」的源从被过滤变成不过滤） | 当「宁可多跑也不错杀」是决断时；**必须与「补 url-resolver 内容校验」同时做** |
| **D** 必填 | M（含 schema + 迁移） | 短期 −、长期 + | **高**（生态无标准词汇表；无归一化时反而扩大伤害面） | 只有 (a) 公开 schema (b) 别名归一化 (c) 水合校验+迁移 **三件齐全**时 |

---

## 6. 建议（按代价从低到高）

> 与 t1 §6.7（路线 A/B/C）正交——那三条是「怎么把源接进来」，本节是「接进来之后怎么不被错杀/错播」。

**建议 1（S，先做）· 让「被跳过」可见 + 让「声明了但认不出」可诊断。**
- `Tier3SourceStats` 加 `skipped`（`:103-106`），在 `tier3Api.ts:837-840` 的 `continue` 前自增；两端设置页各加一列。
- `resolveTier3` 在 `effectiveSource` 不是合法 `SourceKey` 时**打一条 warn**（`unknown source 'tencent'；合法值见文档`），而不是让它静默变成死源。
- 这是 A，但它把后面所有改动的收益**变成可验收的数字**：改完看 `skipped` 是否归零。

**建议 2（S，与建议 3 同时）· 补 url-resolver 的内容级校验（错播通道的真正根因）。**
- 现状：`search-then-resolve` 有 `isExactMatch`（`:552-558`），`url-resolver` 什么都没有（`:486-511`）。
- 最小可行做法：**当 `tier3SourceSource(source) === undefined` 时禁止 `url-resolver`**（理由：无源归属声明的 id 直取 = 不知道 id 语义 = 只能错播），或要求此时必须显式声明 `source`。**这是一条能在不改契约的前提下堵住 §2.5 的规则。**
- 〔推测〕这条会与 t1 §3.3 的 vkeys 示例冲突吗？**不会**——那份示例**显式声明了** `"source":"qq"`。

**建议 3（S）· 采纳 C2：删掉 URL 推断，只在显式 source 存在时过滤。**
- 依据：真实世界命中率 1/13（§2.2）；猜错的伤害是**静默**的、且方向与用户抱怨相反（§0.3/§2.5）；推断规则本身有 R1–R4 四种不确定性（§2.3）。
- 配套：重写 `tier3Api.test.ts:631-651`（现在整块在测推断）；在 `Tier3Source.source` 的 doc 注释（`:64-66`）里把「url-resolver **建议**必填」改成「**不写 = 不做源防护，任何源的歌都会试**」——**现在这句注释把风险说小了**。
- **必须与建议 2 一起做**：单独做 C2 会把「错杀」清零、把「错播」留满。

**建议 4（M，需 ADR）· 若要做 D，先做词汇表与归一化，不要先做必填。**
- 别名表（§1.2/§1.3/§3 的实证支撑）：`qq ← qq | QQ | tencent | tx`；`netease ← netease | wy | 163 | music.163`；`kuwo ← kuwo | kw`；`kugou ← kugou | kg`；`migu ← migu | mg`。**实际取值应做 `trim + toLowerCase` 后查表**（`assertString` 已经 `trim` 了，但**没小写**——〔实测〕`"QQ"` 原样通过）。
- 归一化先上、必填后上：**归一化是纯增益**（把死源救活），**必填是纯风险**（把可用清单变成校验失败）。
- 顺带补 §1.5 的信息缺口：把 schema 与合法值写进文档，两端设置页放一行链接。

**建议 5（M）· 若要长期支持聚合型源，考虑把 source 从单值扩成集合。**
- 依据：生态里 lx 用「源 key 集合」、MusicFree 用「曲目自带 source 字段」（§3.1/§3.3），**MPlayer 的单值 `source?: string` 是这几个里表达能力最弱的**（§3.1 末段）。
- 现状下表达多源只能「同一端点复制成多条 entry」（§2.4C，已实测可行）——**这条可以作为文档推荐写法先落地，不必改契约**。

---

## 7. 参考索引

### MPlayer 侧（primary，含行号）
- `packages/core/src/tier3/tier3Api.ts`
  - `:60-78` `Tier3Source`（`:64-66` `source?` 与其 doc 注释「url-resolver **建议**必填」）
  - `:103-106` `Tier3SourceStats`（只有 `hits/misses`）
  - `:113-118` 超时与试听阈值；`:124` `tier3Stats`
  - `:172-178` `loadTier3State`（**水合不校验**，t3 §1.2 已证）
  - `:250-279` `parseSource`（`:253` `source` 走 `assertString`，**无白名单/别名**）
  - `:352-360` `songVars`（`source: song.sourceType`）；`:362-367` `fillTemplate`
  - `:486-511` `resolveFromRequestSpec`（**url-resolver 无内容级校验**）
  - `:514-532` `resolveSourceUrl`
  - `:534-580` `resolveSearchThenResolve`（`:552-558` `isExactMatch` 严格匹配）
  - `:641-690` `searchTier3Songs`（`:646-648` **无 source 过滤**；`:652-666` 关键词过滤；`:680` `sourceType: tier3SourceSource(source) || sourceKey`）
  - `:788-800` `tier3HostOf` / `tier3HostIs`
  - `:802-822` `tier3SourceSource`（推断规则全文）
  - `:824-866` `resolveTier3`（`:836-840` **过滤**；`:841-861` 统计自增）
- `packages/core/src/tier3/__tests__/tier3Api.test.ts:631-651`（推断的既有测试；`:639-645` `126.net/91q.com` 精确匹配反例；`:647-650` `/qq` 与 `kw.php`）
- `packages/core/src/types/index.ts:4` `SourceKey` 值域
- `packages/core/src/shared/sourceRouter.ts`
  - `:172-186` `registerDirectClient` / `getDirectClient`
  - `:314` `TIER3_BUDGET_MS = 6_000`；`:366-370` 预算截断
  - `:400-408` `decideRoute`（`direct-unavailable`）
  - `:417-441` `searchSongsRouted`（`:423-426` `direct-unavailable` → 走 tier3 搜索）
  - `:483-499` `resolvePlayableSongRouted`（**`:499` `throw new Error('该源暂无直连实现')`**）
  - `:558-569` `resolvePlayableSongDirect`（**探测不含 tier3**，解掉 t1 §8-4f）
- `packages/core/src/api/__tests__/musicApiContract.test.ts:39`（探测不触发 tier3 的显式测试）
- `src/renderer/store/playerStore.ts:352-384`（解析抛错 → 按歌名重搜 → 失败文案「无法获取音频 URL…」）
- `src/renderer/components/Tier3Section.tsx:171-173`、`packages/mobile/app/settings.tsx:357`（两端 tier3 文案，**均未提 `source` 字段**）
- `examples/tier3.empty.json`（仓库唯一清单样例：`{"version":1,"sources":[]}`）
- **commit `68844b5`**「feat(core/desktop): 探测转预取缓存 + preview 秒播回写徽标 + tier3 每源统计 (#171)」——**`source` 字段与 `tier3SourceSource` 推断同一次引入**；其 commit message 自述「跨源 source 防护覆盖 search-then-resolve（mitu→kuwo）」，即推断规则是为 mitu 那一条路径设计的。
- 姊妹报告：`docs/wayfinder/2026-09-14-t1-tier3-external-sources.md`、`2026-09-14-t3-tier3-mechanism-audit.md`、`2026-08-14-r5-unofficial-sites.md`；`CONTEXT.md:39`

### 外部（primary，2026-09-15 抓取）
- **GD Studio API 文档（端点自述全文）**：<https://music-api.gdstudio.xyz/api.php> —— `source` 参数值域「netease（默认）、tencent、kuwo、tidal、qobuz、joox、bilibili、apple、ytmusic、spotify」；搜索返回含 `source（音乐源）`。文档自述更新日期 2026-06-26。
- **vkeys 文档「获取播放链接API」**：<https://doc.vkeys.cn/v3/音乐模块/QQ音乐/点歌相关接口/2-link.html> —— 请求参数表**只有 `id/mid/quality/type`**；返回示例**无 `source`**；源由路径 `GET /music/tencent/song/link` 表达；`quality` 默认 14、档位表 0–16。
- **vkeys 实测响应**（2026-09-15 10:44 UTC，`GET https://api.vkeys.cn/music/tencent/song/link?mid=0039MnYb0qxYhV&quality=8`，HTTP 200）：顶层键 `code/message/data/time/pid/tips`；`data` 键 `songID/songMID/kbps/link/url`；`kbps:"320kbps"`、`url` 指向 `ws.stream.qqmusic.qq.com`。附传 `&source=tencent` 响应不变（参数被忽略）。
- **lx-music 自定义源规范**：<https://lxmusic.toside.cn/desktop/custom-source> —— `sources` key 值域 `kw/kg/tx/wy/mg/local`；`on(EVENT_NAMES.request, ({source, action, info}) => …)`；`send(EVENT_NAMES.inited, {sources})`。
- **MusicFree 插件协议**：<https://musicfree.catcat.work/plugin/protocol.html> —— 插件字段全表（`platform` = 插件名，「任意合法的字符串即可」），**无官方源字段**；`userVariables`（`{key,title}`）+ `env.getUserVariables()`。
- **MusicFree 插件类型定义**：<https://raw.githubusercontent.com/maotoumao/MusicFreePlugins/master/types/plugin.d.ts> —— `IPluginDefine`（`:95-145`）、`IMediaBase {id, platform, [k]:any}`（`:8`）、`IMediaSourceResult`（`:77-85`）。
- **MusicFree 官方订阅清单**：<https://raw.githubusercontent.com/maotoumao/MusicFreePlugins/master/plugins.json> —— `{"desc","plugins":[{"name","url","version"}]}`（12 项，URL 全指向 gitee，t1 §6.5.4 已记）。
- **第三方 MusicFree 清单 + 聚合插件源码**：`qwerwhr/musicfree-plugins` → `plugins.json`（76 项）与 `GD音乐台.js`（`platform:"GD音乐台"`、`userVariables:[{key:"musicSource"}]`、`formatMusicItem(item, source)` 写入 `source`、`getMediaSource(musicItem) → musicItem.source || getMusicSource()`）。
- **Meting README**：<https://raw.githubusercontent.com/metowolf/Meting/master/README.md> —— `new Meting(server)`，`server ∈ {netease, tencent, kugou, baidu, kuwo}`；`meting.site(server)`。
- lx-music-mobile 的 `sources` 相关实现（t1 §3.1 已引）不作重复。

---

## 附：本次实测的方法与原始输出

**环境**：WSL，Node v24.10.0，`date -u` = `Tue Sep 15 02:39–02:52 UTC 2026`。仓库基线 `d637e19`。

**方法（可复现）**：
1. 把真实模块打成 CJS，**不复制源码**：
   `./node_modules/.bin/esbuild packages/core/src/tier3/tier3Api.ts --bundle --format=cjs --platform=node --target=node20 --outfile=/tmp/t6/tier3.cjs --external:axios --external:crypto-js --external:pako --external:iconv-lite`
   同理对 `packages/core/src/index.ts` → `/tmp/t6/core.cjs`（206 KB）用于路由级测试。运行加 `NODE_PATH=<repo>/node_modules`。
2. 起本地 `http.createServer` 当「假第三方源」（返回 JSON + 一个 `Range: bytes=0-1023` 的 MP3 头 + `content-range: bytes …/9000000`，以通过 tier3 的域名白名单与字节嗅探、且 `>1MB` 不触发试听拒收）。
3. 用 `setTier3Subscriptions` / `setTier3Enabled` / `createTier3Resolver()` / `searchTier3Songs` / `resolvePlayableSongRouted` 驱动真实调用链；`registerDirectClient({key, searchSongs, resolvePlayableUrl})` 注入能力桩（**注意 `registerDirectClient(client)` 只收一个对象、以 `client.key` 建索引**，`sourceRouter.ts:174-176`——我第一版误传 `(key, client)` 导致「该源暂无直连实现」，已修正）。
4. `tier3SourceSource` 的对照表直接在 `/tmp/t6/real.cjs` 里对硬编码的真实端点 URL 调用导出函数。

**原始输出（关键几条，逐字）**：

```
# 真实端点推断（/tmp/t6/real.cjs）
{"label":"GD Studio (t1 §2.4)","host":"music-api.gdstudio.xyz","inferred":"undefined"}
{"label":"vkeys 落月 (t1 §3.3)","host":"api.vkeys.cn","inferred":"undefined"}
{"label":"vkeys 备用域 (t1 §5.3)","host":"api.epdd.cn","inferred":"undefined"}
{"label":"mitu 取链 (r5 §2.2)","host":"api.qqmp3.vip","inferred":"kuwo"}
{"label":"mitu 搜索 (r5 §2.2)","host":"api.qqmp3.vip","inferred":"undefined"}
{"label":"mgmp3 取链 (r5 §2.2)","host":"www.mgmp3.top","inferred":"undefined"}
{"label":"nextmusic (r5 §1.1)","host":"nextmusic.toubiec.cn","inferred":"undefined"}
{"label":"cenguigui 网易 (r5 §1.1)","host":"api-v2.cenguigui.cn","inferred":"undefined"}
{"label":"xingmian 网易 (r5 §1.1)","host":"api.xingmian.bbroot.com","inferred":"undefined"}
```

```
# 显式声明值（过真实 parseTier3Manifest 后，/tmp/t6/decl2.cjs）
{"declared":"qq","afterParse":"\"qq\"","effectiveSource":"qq","equalsQQ":true}
{"declared":"QQ","afterParse":"\"QQ\"","effectiveSource":"QQ","equalsQQ":false}
{"declared":" qq ","afterParse":"\"qq\"","effectiveSource":"qq","equalsQQ":true}
{"declared":"tencent","afterParse":"\"tencent\"","effectiveSource":"tencent","equalsQQ":false}
{"declared":"tx","afterParse":"\"tx\"","effectiveSource":"tx","equalsQQ":false}
{"declared":"unknown","afterParse":"\"unknown\"","effectiveSource":"unknown","equalsQQ":false}
{"declared":"","parse":"THROW 清单校验失败：source(a).source 必须是非空字符串"}
```

```
# 两腿行为矩阵（/tmp/t6/matrix.cjs；mock 源 = 单端点、按 ?source= 参数分流）
== 腿1：解析腿（歌直接来自官方直连）==
{"declared":"qq","song":"qq","resolveLeg":"命中"}
{"declared":"qq","song":"netease","resolveLeg":"未命中"}
{"declared":"tencent","song":"qq","resolveLeg":"未命中"}      ← 声明非规范值 → 永远匹配不上
{"declared":"netease","song":"netease","resolveLeg":"命中"}
{"declared":"qq ","song":"qq","resolveLeg":"命中"}             ← assertString 会 trim
{"declared":"QQ","song":"qq","resolveLeg":"未命中"}             ← 大小写敏感
{"declared":"(none)","song":"qq","resolveLeg":"命中"}           ← 缺省 = 不过滤 = 放行
{"declared":"(none)","song":"netease","resolveLeg":"命中"}
== 腿2：搜索腿产出的候选，能否播 ==
{"declared":"qq","candidateSourceType":"qq","playCandidate":"可播"}
{"declared":"tencent","candidateSourceType":"tencent","playCandidate":"THROW 该源暂无直连实现"}
{"declared":"netease","candidateSourceType":"netease","playCandidate":"可播"}
{"declared":"(none)","candidateSourceType":"qq","playCandidate":"可播"}
```

```
# 错播通道（/tmp/t6/mismatch.cjs）：无 source 声明、URL 无标记的单源 url-resolver
inferred source = undefined
{"label":"QQ 歌（id 是 songmid）","requested":["/resolve?mid=0039MnYb0qxYhV&quality=8"],"accepted":true}
{"label":"酷我歌（id 是酷我数字 id）","requested":["/resolve?mid=1303464858&quality=8"],"accepted":true}
{"label":"网易歌","requested":["/resolve?mid=186016&quality=8"],"accepted":true}
```

```
# 聚合器「多条 entry 分片」写法可行（/tmp/t6/shard.cjs）
{"songSource":"qq","url":"命中","requests":["/r?source=qq&id=1"]}
{"songSource":"netease","url":"命中","requests":["/r?source=netease&id=1"]}
{"songSource":"kuwo","url":"未命中","requests":[]}
```

```
# 上游实测（curl，2026-09-15）
GET https://api.vkeys.cn/music/tencent/song/link?mid=0039MnYb0qxYhV&quality=8  → 200
  {"code":0,"message":"访问成功","data":{"songID":97773,"songMID":"0039MnYb0qxYhV","kbps":"320kbps","link":"…","url":"http://ws.stream.qqmusic.qq.com/M800…"}}
  顶层键: [code, message, data, time, pid, tips]   data 键: [songID, songMID, kbps, link, url]
```

---

## 明确「未验证 / 不知道」

1. **不存在公开的 tier3 清单，因此「清单里 source 字段的填写分布」无法用一手证据回答。** 我用 `gh search code`（3 个查询）**未找到**任何公开 tier3 清单；这只覆盖**公开可索引**代码，**私有/未索引仓库中的清单（含真实用户订阅）未查**——**不知道**真实用户的清单里 `source` 的填写率。这是本报告最大的证据空档。
2. **「用户少一个兜底源」的实际规模未知。** §2.2 证明推断在**真实端点样本**上命中率 1/13，但那是 t1/r5 记录的**公开源**样本，不是**用户实际订阅的清单**。**「猜错导致跳过」在真实用户身上发生过几次，不知道**（靠建议 1 的 `skipped` 统计才能测）。
3. **§2.5 的跨源错播通道是否真的在真实源上发生，未验证。** 我用的是 mock 源（无内容校验、无条件返回同一 URL）。真实源（mitu/mgmp3 类）对错误的 id 形态**多半会返回空或报错**，因此真实发生率可能远低于 mock 演示。**「真实源上错播概率」未测**。〔实测〕与〔推测〕的边界必须说清：**「通道存在」是实测，「通道被走通」是构造出来的，不是观测到的。**
4. **哪个第三方源支持哪些 MPlayer SourceKey，没有任何权威清单。** GD 文档列了它支持的源名，但**没说明哪些当前真的可用**（文档自述「部分音乐源暂不开放」），且 t1 §6.6 实测 `tencent/kugou/migu` 当返回 400。**「某源支持哪几个官方源」这一位信息，在生态里没有任何机器可读的声明**——这直接削弱了选项 D（必填）的可行性。
5. **`{source}` 模板变量的合法值映射，未验证。** 文档证明 GD 认 `tencent` 不认 `qq`（§1.2），但**没有实测 MPlayer 填 `qq` 时 GD 的实际响应**：我用 Exa 抓 `source=qq` / `source=tencent` / `source=migu` 时拿到了**三份完全相同的 netease 结果**（连页面标题都被写成 `source=netease`），**判定为抓取器的缓存/串味，故不予采信**；同一原因下**「GD 是否仍被 Cloudflare 挑战拦截」本文未复测**——t1 §6.5.2 测到 403 + `cf-mitigated: challenge`，我今天用 curl + 浏览器 UA 复现了 **403 + `cf-mitigated: challenge` + `Just a moment...`**（与 t1 一致），但经 Exa 通道能拿到 200 结果，说明「能否过挑战取决于客户端」成立、**具体到 MPlayer 的 transport 能否过仍未验证**。
6. **R2/R3 类误命中的实际发生率未测。** `kuwo-proxy.example.com` 这类是**我构造的**，不是观测到的真实域。**未找到**任何真实第三方源使用「含源名子串但非该源」的域名。
7. **`/qq` 与 `kw.php` 两个路径标记当初为什么这么选，只有 commit message 层面的解释**（`68844b5`：「跨源 source 防护覆盖 search-then-resolve（mitu→kuwo）」）。**是否有别的真实源依赖这两个标记、删掉会不会伤到谁，未查**（仓库零端点，无从枚举）。
8. **建议 2 的「无 source 声明时禁止 url-resolver」是否会误伤现有清单，不知道。** 依据是「vkeys 示例显式声明了 `source`」（t1 §3.3），但**没有其他清单样本可核对**，因此这是**基于单个样本的推断，不是统计**。
9. **未做真机验证**：全部实测在 Node 上跑 core 模块；**桌面 Electron 与移动端 Hermes/RN 上的行为差异未测**（t3 报告同样只有 Node 侧数据）。`packages/mobile` 的 tier3 水合路径（`stores/settingsStore.ts`）**未在本文重查**。
10. **`source` 字段是否在其他地方被消费，未穷举。** 我只 grep 了 `tier3SourceSource`（3 处调用点 + 导出）与 `sourceType` 的主要消费方；**动态引用 / 序列化路径未穷举**。
11. **产品层面的决断未做**：「宁可多跑一个源也不错杀」与「宁可少一个源也不错播」哪个对 MPlayer 更优——**本报告只给证据与取舍，不给结论**。这是 issue #334（tier3 失效隔离与兜底策略）要裁决的事。
