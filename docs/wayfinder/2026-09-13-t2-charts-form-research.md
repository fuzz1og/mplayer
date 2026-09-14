# T2 · 排行榜形态调研：聚合榜 vs 单元榜 + 源切换

- **日期**：2026-09-13
- **调研问题**：主流音乐产品的榜单是单源自有还是跨源聚合？「切数据源」是否常见交互？多源榜单聚合在什么情况下有意义？MPlayer 现状（三源聚合 + 折叠展开）的真实读解与可选方案？
- **仓库基线**：`f664a1745937be6bfa92bf4e466ebc44c3330c2f`（2026-09-13，master）
- **证据纪律**：结论只用 primary source（官方帮助文档 / 官方开发者文档 / 源站接口实测 / 仓库源码）。实测数据为调研当日抓取，并标注抓取时间与端点。

---

## 0. 一句话结论

**「单源自有 + 地区/流派/时间窗细分」是主流产品的普遍形态，「切换数据源」在单一流媒体产品里不存在**；**跨源聚合只出现在「聚合器/元搜索」与「全市场榜单」两类产品**（Songwhip、Last.fm、kworb、TME 由你榜、Billboard）。因此「回归单元榜 + 切源」对 MPlayer 是**回到业界常态**的方案；保留聚合要成立，必须把「聚合」这件事本身做成一个**有名字、有解释的产品对象**（跨平台热歌榜），否则它就是三份榜单的机械叠加，正好解释了用户看到的「内容重复、质量低」。

---

## 1. 主流产品的榜单形态（逐个说清）

### 1.1 Spotify —— 单源自有，无切源交互

- 数据来源：**只有 Spotify 自己的播放流**。官方帮助文档：We generate chart stream numbers using a formula that protects the integrity of our charts… not every stream on Spotify is eligible for charts.
  来源：<https://support.spotify.com/us/artists/article/charts/>
- 入口：charts.spotify.com 或 App 内 Search > Charts（同上）。
- 颗粒度：
  - 时间窗：日榜 / 周榜（周榜 = 周五 00:00 → 次周四 23:59 UTC）；
  - 地区：Global / 65 个市场 / 200+ 城市（City Charts，仅网站有）；
  - 流派：17 个 genre 的 Top 200（按用户歌单上下文 + 编辑反馈归类）；
  - 实体：Songs / Albums / Artists。
    来源：<https://artists.spotify.com/blog/celebrating-artist-success-with-spotify-charts>
- 详情页字段：chart entry date（上榜时间）、peak position（最高位）、streaks（连续在榜周数）、credits（词曲/制作）、label/distributor；另有 Local Pulse（相对全球热度、本地独热）。
  来源：同上 + <https://support.spotify.com/us/artists/article/charts/>（A streak is the number of consecutive weeks or days a song or album has been on a chart… When a song or album falls off a chart and re-enters, its streak count resets. Its peak position… doesn't reset.）
- **切源**：无。产品里连「数据源」这个概念都不存在。

### 1.2 Apple Music —— 单源自有，storefront × genre × chart type

- 官方开发者文档 Get Catalog Charts：`GET /v1/catalog/{storefront}/charts?types=songs,albums,playlists&genre={id}&limit=`
  响应形如 `{"chart":"most-played","name":"Top Songs","orderId":"most-played:songs","data":[…按 popularity 排序]}`
  来源：<https://developer.apple.com/documentation/applemusicapi/get_catalog_charts>
- 颗粒度：storefront（= 地区）/ chart type / date / genre（Chart Explorer 过滤器），并有 Top Rising Content 跃升榜、Total Number of Chart Appearances。
  来源：<https://musicpartners.apple.com/support/5386-navigating-chart-explorer>
- 历史：Chart Explorer 可回溯到 2015-07，可按日期查历史名次。
- **切源**：无。storefront 是「地区」，不是「数据提供方」。

### 1.3 YouTube Music —— 单源自有，且明确写清「跨视频形态合并」

- 官方帮助（YouTube Charts & Insights）：Weekly Top Songs 合并 **官方 MV + UGC 使用该歌的视频 + 歌词视频** 的播放量；覆盖 61 个国家/地区；日榜 + 周榜。
  App 内展示规则也写死在文档里：优先显示你所在国的本地榜；若不在本地榜则显示全球榜；若两者都在榜，显示更高的那个；若名次相同显示全球榜。
  来源：<https://goo.gle/4n39o3J>（YouTube Help YouTube Charts & Insights）
- 站点：<https://charts.youtube.com/charts/TopSongs/global>（Weekly Top Songs，周窗口）
- **注意**：YouTube 确实做了「聚合」，但聚合的是**同一平台内不同视频形态**，不是「多个音乐服务」。这对本调研是个关键对照：**平台拥有全部原始播放数据时，聚合才有定义。**
- **切源**：无。

### 1.4 Deezer —— 单源自有，地区 × Top 100

- 官方 Charts 频道（`/en/channels/module/6956d235-…`）：列出 Top Worldwide 100 tracks、Top USA 100 tracks、Top France 100 tracks…… 按国家。
  来源：<https://www.deezer.com/en/channels/module/6956d235-bf37-4e04-a7b4-92554f259fc9>
- **切源**：无（切的是国家）。

### 1.5 Bandcamp —— 自营榜单 = 销量榜；同时是别人的**数据供应商**

- Bandcamp 自家榜单是站内 Best Selling（销量驱动，无「热播」概念，因为不按流播计费）。
- 更关键的是它同时**把销售数据上报给第三方榜单**：Luminate（Billboard）、Official Charts（UK/IE）、ARIA（AU）、NZ Music Charts。Fresh sales information is delivered daily, shortly after midnight UTC, and most charts run on a Friday through Thursday schedule.
  来源：<https://get.bandcamp.help/en/articles/15263062-which-charts-does-bandcamp-report-to-and-when>
- **启示**：跨源聚合在这个行业里由**专业数据商（Luminate）**承担，而不是由某一家播放器把别人的榜单页面拼起来。

### 1.6 Last.fm —— 唯一「真跨源」的主流消费级榜单（因为它是 scrobble 聚合器）

- 数据 = 用户 scrobble 上报，来自任意播放器/服务（含 Spotify 连接）。
  来源：<https://www.last.fm/about/trackmymusic>、<https://www.last.fm/charts>
- 形态：Weekly Charts 给出 Listeners 与 Scrobbles 两个绝对量、并显示名次 Up/Down 箭头。
  来源：<https://www.last.fm/charts/weekly>
- 榜单语义 = 「Last.fm 用户群体的收听」，**不是**「全网热歌」，页面从不声称代表某个源。
- 播放器里可 Change playback source（Spotify/YouTube 试听），但那是**播放出口**，不是**榜单数据源**。
- **切源**：无（不存在的概念）。

### 1.7 中文三源（也正是 MPlayer 的三源）—— 各自单源自有 + 地区/流派细分

| 源 | 榜单入口 | 榜单数量 | 颗粒度示例 |
|---|---|---|---|
| 网易云 | `GET https://music.163.com/api/toplist/detail`（实测 2026-09-13） | **63 个榜** | 飙升榜/新歌榜/原创榜/热歌榜 + 古典/电音/说唱/ACG/韩语/日语/摇滚/国风/民谣 + 车友爱听榜 ×7 |
| QQ 音乐 | `GET https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg`（实测 2026-09-13） | 巅峰榜矩阵 | 热歌榜 26 / 新歌榜 27 / 飙升榜 / 流行指数榜 / 地区榜（内地·香港·台湾·欧美·韩国·日本）/ 特色榜（说唱·电音·游戏·动漫·影视·国风·抖音热歌·DJ·网络歌曲）/ 全球榜（Billboard·Melon·UK·Oricon） |
| 酷狗 | `GET http://mobilecdn.kugou.com/api/v3/rank/list`（实测 2026-09-13） | **56 个榜** | TOP500 8888 / 新歌榜 74534 / 飙升榜 / 国潮 / 民谣 / 电音 / 摇滚 / DJ / 粤语 / 欧美 / 韩国 / 日本 / 香港 / JOOX / KKBOX / 90 后·00 后 / 儿歌… |

- 三个源的榜单**各自独立统计、互不合并**，也**都没有「切换数据源」**；「切换」只发生在榜单之间与地区/流派之间。
- QQ 榜单页明确带「榜单规则」链接（`https://y.qq.com/n/ryqq/toplist/26` 抓取到 2026-08-21 榜单规则），说明榜单在本源内是有规则文档的产品对象。

### 1.8 行业级反例：跨源聚合榜存在的真实形态

**(a) 腾讯音乐由你榜（TME UniChart / 由你音乐榜）—— 唯一在中文市场成立的多源聚合榜**

- 官方：目前，榜单数据包含**QQ音乐、酷狗音乐、酷我音乐、波点音乐、JOOX、腾讯视频、新浪微博**七大平台。
- 计分：五项指数加权 —— 播放指数 35% / 传播指数 20% / 喜好度 10% / 付费指数 15% / 人气指数 20%，原始数据经尺度压缩 + 公式合成（`y=(1-e^{-6x})/(1+e^{-6x})`）。
- 上下榜机制：发布 1–12 周恒可上榜；13–26 周须 TOP100；27–52 周须 TOP50；>52 周须 TOP25。
- 更新：每十分钟；周榜 + 日榜。榜单对外有独立域名 `yobang.tencentmusic.com` / `chart.tencentmusic.com`。
  来源：<https://www.tencentmusic.com/zh-cn/uni-chart.html>、<https://y.qq.com/m/client/toplist/uni_rule.html>
- **关键**：它由**集团数据侧**做聚合（拥有全部原始行为数据），并且**对外是一个独立品牌**（由你榜），不叫「QQ 音乐热歌榜」。

**(b) Billboard Hot 100 —— 行业标杆的「跨源」是数据源混合，不是页面拼接**

- 官方图例：RANKED BY STREAMING ACTIVITY DATA BY ONLINE MUSIC SOURCES TRACKED BY LUMINATE, RADIO AIRPLAY AUDIENCE IMPRESSIONS AS MEASURED BY MEDIABASE… AND SALES DATA AS COMPILED BY LUMINATE.
- 三个数据池：sales（Luminate 面板，覆盖 >90% 美国零售）、airplay（Mediabase，140+ 市场音频指纹）、streaming（leading online music services）。规则含 recurrent 下榜（Hot 100 上，78 周后掉出 No.5 / 52 周后掉出 No.10 / 26 周后掉出 No.25 / 20 周后掉出 No.50 即移除）。
  来源：<https://www.billboard.com/charts/hot-100/>、<https://www.billboard.com/billboard-charts-legend/>
- **关键**：聚合是**数据供应商**在原始行为层做的，且每个源的数据是**绝对量**（销售额/播放量/印象数），可以加权相加。

**(c) kworb.net —— 聚合器的商品化形态**

- 自述：iTunes / iTunes WW 复合榜（worldwide + European）/ Spotify 日榜周榜 + 各国榜统计 / YouTube / Radio / Shazam 全部并置，并有一个 Global Digital Artist Ranking 把 Apple Music / Spotify / iTunes / YouTube / Shazam / Deezer 的位次汇总成分数表（列：Pos / P+ / Artist / Points / Apple M / Spotify / iTunes / YouTube / Shazam / Deezer / Top Country / #）。
  来源：<https://kworb.net/>、<https://kworb.net/charts/>、<https://kworb.net/itunes/index.html>
- **关键**：kworb 是**第三方数据站**，卖点正是「跨源对照」；它不做「把 6 个源合成 1 张榜」的伪装，而是**并列展示 + 明确的 composite 标注**（ITUNES WW is where you find my composite iTunes charts）。

**(d) Songwhip / Songlink —— 聚合器解决的是「链接」，不是「榜单」**

- 官方首页：In one click Songwhip finds your music everywhere & makes a page you can share with everyone.
  来源：<https://songwhip.com/>
- 它跨源匹配的是**同一首歌的多个平台链接**（跨源实体归一问题），不做热度排名。

**(e) MusicBrainz —— 不生产榜单**

- MusicBrainz 是开放音乐元数据百科（collects music metadata），有 `series` 实体可以**引用**榜单（如 Billboard Hot 100 的 series 页，字段 = 官网链接 + Wikidata ID），但不自己统计热度。
  来源：<https://musicbrainz.org/>、<https://musicbrainz.org/series/e6ef9b62-cc8c-4513-8dd6-ef28de0c33fd>
- **关键**：在「跨源 id 不一致」这件事上，业界做法是**建实体映射库**（ISRC/UPC/MBID），而不是靠模糊匹配硬合。

---

## 2. 「多源榜单聚合」何时有意义 / 何时无意义

### 2.1 判断依据（从上面反例里抽出来的三条必要条件）

1. **有跨源可比的原生量**：Billboard/由你榜能合，因为拿到的是销售额、播放次数、印象数（绝对量）；用**名次**做加权本质是信息损失（见 3.1 实测）。
2. **聚合方拥有或代理数据**：Luminate 是数据面板，TME 是集团内数据，Last.fm 是自己收 scrobble。**没有一家把「竞品公开榜单页」抓下来合成「我们的榜」。**
3. **聚合结果是一个独立命名产品**：由你榜、Last.fm Weekly Charts、kworb composite、Billboard Hot 100 —— 用户一眼知道「这是谁的口径」。**合并出来的东西不自称是某一家源的榜。**

### 2.2 有意义的场景

- **元搜索/链接聚合器**（Songwhip、Songlink、MusicBrainz、kworb）：用户目的就是「同一个东西在几个源分别是什么」。
- **全市场/行业榜单**（Billboard、由你榜、Last.fm、ARIA）：有跨源可比口径 + 独立品牌。
- **平台内跨形态合并**（YouTube：MV + UGC + lyrics video）：同一平台拥有全部数据。
- **第三方数据站做对照**（kworb）：并列展示 + 明确 composite 语义。

### 2.3 无意义的场景（= MPlayer 现在的处境）

- **单一播放器把 N 个源的热榜机械叠加**：没有得到任何绝对量，只有名次 → 只能做 `Σ1/rank`，语义是「这首歌在几个榜上、排多前」，**在业界找不到对应物**。
- 三源用户群高度重叠（中国大陆主流听众），热歌榜 Top100 重合度很高 → 聚合结果的边际信息 ≈ 0，但用户要让渡「这是谁的榜」的确定性（换取的是「重复内容」的观感）。
- 用户自己**没有登录态**：榜单首页本质上就是「推荐位」，而推荐位的价值来自「我信任这家平台的口味」。聚合后变成了无主体口味（见 3.5）。

---

## 3. MPlayer 现状的具体读解（含代码证据与真实数据复算）

### 3.1 聚合当前怎么算分（确切规则）

`packages/core/src/shared/chartAggregate.ts`

- **归一化键** `normalizeSongKey`（:25-34）：歌名小写 → **去掉括号内容** `[（(].*?[)）]` → 去空白 → 只留中文/字母/数字；歌手小写 → 去空白 → 去 `·•`。键 = `name|artist`。
- **排名**：榜单结构不落 rank（`sourceRouter.ts:43` 注释明确 rank 不落结构——消费方按 songs 数组索引推导），聚合时 `rank = 组内索引 + 1`（`chartAggregate.ts:103-108`）。
- **计分** `aggregateScore`（:38-45）：`score += rank ? 1/rank : 1/CHART_DEFAULT_MISS`，`CHART_DEFAULT_MISS = 51`（:15）。**实际循环对象是 `sourceRanks`，而 `sourceRanks` 只写入「真实上榜的源」（:112）**，因此那个 `1/51` 分支在当前调用路径上**不可达**——即：**未上榜源既不惩罚也不加分**。
- **缺失源处理**：源失败/未实现 → 由 `chartAggregator.ts:49-52` 的 `Promise.allSettled` 过滤掉整条腿，连「缺省权重」都没有（tests：`src/__tests__/main/chartAggregator.test.ts` 失败/未实现的源整体跳过……也不占缺省权重）。**后果：一个源挂掉，聚合结果会静默变成「剩下源的榜」，用户看不到降级。**
- **同组选优** `pickBest`（:57-70）：① `audioTag !== 'preview'` 优先（完整版 > 试听版）；② `rank` 更小优先；③ `sourceOrder` 更靠前优先，默认序 `['netease','qq','kugou']`（:18）。
  ⚠️ 第②条与第③条的比较对象是**不同源的 rank**（跨源比名次）。第③条在全局源序里找不到源时会得到 `indexOf = -1`，此时「更靠前」判定失效——实际影响有限，但逻辑不成立。
- **排序**：`groups.sort((a,b) => b.score - a.score)`（:137），**没有 tie-breaker**。
- **榜单腿** `src/main/services/chartAggregator.ts:26-32`：`getToplistSongs(source, TOPLIST_SOURCE_IDS[source][type])`；`TOPLIST_SOURCE_IDS`（`sourceRouter.ts:61-65`）只有三源：
  `netease { hot: 3778678, new: 3779629 } / qq { hot: 26, new: 27 } / kugou { hot: '8888', new: '74534' }`。
- 缓存：`CHART_CACHE_TTL = 30min`（`src/shared/chart.ts:3`），key = `chart_${type}_${sorted sources}`。

### 3.2 用真实榜单数据复算（2026-09-13 实测抓取）

抓取三源各自的热榜 Top100（netEase 前 100 / QQ 前 50，接口单页 50 / 酷狗前 100），按上述规则离线复算：

| 指标 | 实测值 |
|---|---|
| 原始条目 | 250 |
| 聚合后组数 | **186**（去重 64 条，25.6%） |
| 三源都命中 | 19 组 |
| 双源命中 | 26 组 |
| 单源独占 | **141 组**（netease 71 / kugou 59 / qq 11） |
| 聚合 Top50 里三源齐备的 | 19 组 |

**排位被改写的幅度（聚合位次 vs 源内位次）**：

| 源 | 源内 Top10 在聚合榜的位次 |
|---|---|
| netease | 1→3, 2→1, 3→7, 4→2, 5→9, 6→17, 7→6, 8→21, 9→12, 10→29 |
| qq | 1→4, 2→2, 3→1, 4→5, 5→6, 6→10, 7→13, 8→15, 9→16, 10→23 |
| kugou | 1→1, 2→2, 3→8, 4→11, 5→14, 6→5, 7→24, 8→18, 9→19, 10→30 |

典型个案：
- 网易**热歌榜 #1**《海屿你》→ 聚合 **#3**（只有网易有）。
- 网易 **#43**《泪海》→ 聚合 **#5**（QQ #4 + 酷狗 #6 托举）。
- QQ **#1**《世界如此》→ 聚合 **#4**。

**结论（可以直接拿去回答「为什么质量低」）**：
- 聚合榜的头部被「**多源共振歌**」（老歌/经典曲目，如《我不难过》《情歌》《开始懂了》《富士山下》）占据，因为它们在三个榜都常年在位；
- 各源榜单真正的**新歌/爆款信号**（网易 #1、QQ #1）被挤到 3–4 位；
- 有 **141/186 = 76%** 的条目压根没有参与「聚合」，只是被顺带排了一遍。

### 3.3 归一化合并的误差（代码 + 复算）

`normalizeSongKey` 只做「歌名 + 歌手」字符串归一，**没有 id 层归一**（core 没有 ISRC/UPC/MBID 映射，`CONTEXT.md` 的「歌曲身份」也只是「音乐源 + 去源前缀 ID」）。

实测复算（用实现同款正则跑真实数据）暴露的两个真实偏差：

1. **一条 raw 内自撞**：酷狗 #6《泪海 / 许茹芸》与 #20《泪海 (你怎么舍得让我的泪流向海) / 许茹芸》——歌名去掉括号后同为「泪海」→ 同键 → 归为同组（`sourceRanks[item.source] = item.rank`，同源重复命中去重后取更靠前的那条）。**同一源的两首不同实体（原版 / 别名重发）被合成一条**。
2. **归一化的单向性**：`李佳薇 (Live)` vs `李佳薇` 这种只会**多合**；`我好想你` vs `我好想你 (苏打绿版)` 会因为歌手串不同而**漏合**（实测两者各成一组）。归一只做「去」不做「补」，误差方向不可控。
3. **跨源选优偏差**：`pickBest` 的「rank 优先」在**不同源之间比名次**（:63-64）。酷狗榜 Top500 的 #1 与网易热歌榜 #1 语义不同（酷狗 TOP500 是每天更新的全曲库综合榜），却直接比大小。

### 3.4 当前 UI 实际暴露了什么

`src/renderer/pages/DiscoverPageV2.tsx`
- 发现页排行榜 = **并排两个 ChartPanel**：热歌榜 / 新歌榜（:616-636）。`const SOURCES = ['netease','qq','kugou']`（:40）**是硬编码常量，页面上没有任何地方能改它**——用户无法切源，也无法感知「源」的存在。
- 顶部右侧写死一行灰字「网易云 · QQ · 酷狗」（:568）——这是页面上唯一一处数据来源声明。

`src/renderer/components/ChartPanel.tsx`
- 折叠结构：`topGroups = groups.slice(0,3)` 显示为「精选卡」（`renderFeatured`，:233），`restGroups = groups.slice(3,50)` 显示为紧凑行（`renderGroup`，:284-285）。
- 折叠时**只有一条信息**：`bestSong` 的歌名 / 歌手 / `<SourceBadge>`（:152-159）。**没有「来自几个榜」「分别第几」的任何提示**——用户看到的是「一首歌 + 一个源标签」，这正好等于「这是一个单源榜」的观感，但排序却是聚合的。
- 展开后（:169-217）每行显示该源内的 `#${sourceRank}`（:213-216）+ `<SourceBadge>`。**这就是「能不能看出这首歌来自哪个榜」的全部答案：只有主动点开 chevron 才能看到，且只看到「源内名次」，看不到「聚合名次变化」。**
- `isCurrentSong`（DiscoverPageV2:255）按 `chartId` 区分热/新，UI 不接受 `chartId=null`（展开行里播放按钮 `onPlay(song)` 不传 chartId，:220）。

`packages/mobile/stores/discoverStore.ts` + `packages/mobile/components/DiscoverTabs.tsx` + `packages/mobile/app/hotlist.tsx`
- **移动端已是单元榜形态**：四张卡片并排（网易云音乐 · 热歌榜 / QQ 音乐 · 热歌榜 / 网易云音乐 · 新歌榜 / QQ 音乐 · 新歌榜），各取 10 首；`hotlist.tsx` 的 `API_MAP` 也是四张独立单元榜（neteaseHot/neteaseNew/qqHot/qqNew），**不做跨源合并**，`rank = index + 1`。
- **关键事实：两端对同一个产品概念给出两套形态**（桌面聚合 / 移动单源并列），而 `docs/specs/discovery-page-v2.md` 的 Decisions 只写了桌面：排行榜聚合：聚合为主 + 源筛选，不单独分源 tab。**「源筛选」在桌面端从未落地**（无任何 UI），这条决策与代码不符——按该规格的「变更纪律」（Tab 集合变更须同步规格），改排行榜形态时也应同步更新 spec。

### 3.5 保留聚合的**真实成本**（用代码/数据说话，不是泛泛而谈）

1. **重复观感的产生机制**：折叠视图只显示 `bestSong` → 用户看不到「这首歌同时来自 3 个榜」这唯一的价值信息；而 19 组三源共振歌 + 26 组双源歌（共 45 组）在头部密集出现 → 用户感知为「怎么又是这些老歌」。**聚合的信息量被 UI 藏起来了，代价却全部暴露出来。**
2. **来源不明**：折叠态只有一个 `<SourceBadge>`（= bestSong 的源），顶部写死三源。用户无法知道「第 5 名是三源共振，第 8 名只有酷狗一家」。→ 一旦 bestSong 落在酷狗（`DEFAULT_SOURCE_ORDER` 之外的源），整体观感会像「这是一个酷狗榜」。
3. **一条腿挂掉会静默改变口径**：酷狗 `getKugouRank` 失败**返回空数组**（`kugouDirect.ts:169-190` `catch` 里 `return []`），QQ `fetchToplistSongs` 失败同样返回空数组（`qqDirect.ts:384-387`）。返回空数组的源**不会**被 `filter(r => r.status==='fulfilled')` 剔除 → 它仍然进聚合，只是 `sourceRanks` 里没有它。**净效果：用户看到的榜在「三源聚合」和「两源聚合」之间无声切换，分数整体缩水（少了一个 1/rank 项），排序随之变化。**
4. **跨源 id 不一致导致选优偏差**：`pickBest` 无法跨源对齐实体（没有 ISRC/MBID），只能靠 rank 和硬编码源序；`normalizeSongKey` 是「只去不补」的弱归一，同一源内两首不同实体都能被合并（3.3 的《泪海》）。
5. **工程面**：聚合把三源榜单的**网络依赖串成了单点**（三腿都拿到才好看）；单元榜可以让每个源独立失败、独立重试。目前后端缓存是单 key（`chart_hot_kugou_netease_qq`），任一腿异常都会写进同一份结果。

---

## 4. 可选项与取舍

> 通用前提：`TOPLIST_SOURCE_IDS` 与 `getToplistSongs` 已在 core 提供**按源取单榜**的现成能力（`sourceRouter.ts:61-82`），且**移动端已经在用**。因此「单元榜」在 core/契约层**零新增**。

### 选项 A · 纯单元榜 + 源切换（推荐）

- **改动面**：
  - 删除/停用 `src/main/services/chartAggregator.ts` 与 `getAggregatedChart` IPC（`src/shared/musicApiContract.ts:64`、`src/main/ipc/musicApiHandlers.ts:48`）；
  - core 侧 `aggregateChartSongs`/`normalizeSongKey`（`packages/core/src/shared/chartAggregate.ts`）可先保留（`index.ts:54` 导出）但**不再有消费方**，或随之下线；`chartAggregate.test.ts` 同步处理；
  - `ChartPanel.tsx` 改为接收 `Song[]`（单榜）+ `title`，去掉折叠/展开与 `sourceRanks`；
  - `DiscoverPageV2.tsx` 增加源切换（桌面上已有同类 UI 范式：新碟的 `area` 筛选、歌单的分类 chip），`SOURCES` 常量保留但由 state 驱动；
  - 更新 `docs/specs/discovery-page-v2.md` 的 Decisions（现有「聚合为主 + 源筛选，不单独分源 tab」必须改写）。
- **用户收益**：榜单语义恢复「谁说的算」；新歌/爆款信号回到头部（网易 #1 就是 #1）；消除 3.5 全部 5 项成本；与移动端形态统一。
- **风险**：失去「跨平台综合热度」这一个（目前未被正确使用的）卖点；`chartAggregate` 内核下线需要一次清理 PR，测试要改。
- **什么时候是对的**：用户抱怨「重复、质量低」且**没有登录态**（本案）——因为榜单对无登录用户就是「编辑推荐位」，必须有主体口味。
- **什么时候是错的**：如果产品定位明确是「跨平台综合热度榜」并且愿意为它做品牌与口径解释（那就应该走选项 D 而不是 A）。

### 选项 B · 单元榜为主 + 聚合作为可选视图

- **改动面**：A 的全部 + 保留 `aggregateChartSongs` 与 `getAggregatedChart`；在源切换控件末尾加一个「综合」项（或「三源综合」独立 Tab），`ChartPanel` 需要**同时**支持两种数据形状 —— 建议让 `ChartPanel` 只吃「行模型」（`{ song, sourceRank?, score? }`），由页面决定模型来源（深度模块化：把「聚合」藏在数据层，UI 只有一个列表组件）。
- **用户收益**：保留了默认的推荐位语义；重度用户能主动去看综合。
- **风险**：**两套语义并存，最容易做错**——「综合」视图若不解释口径（它是名次汇编、不是热度榜），用户仍会把它当「权威榜」；同时后端要维护两条数据链路与缓存。
- **什么时候是对的**：如果实测发现「综合榜」确有用户点击（有埋点证据），并且愿意为它写一句口径说明（如「综合名次 = 三源名次加权，非播放量榜」）。

### 选项 C · 保留聚合但改展示（去掉折叠分组，直接一列）

- **改动面**：只动 `ChartPanel.tsx`（把 `renderGroup` 的展开逻辑删掉，每行固定显示 歌名/歌手 + 源徽 + 各源 #rank 徽）+ `chartAggregator.ts` 不变。**core 契约零改动。**
- **用户收益**：把已经算出来的 `sourceRanks` 直接摊开——用户能看见「这首歌在 3 个榜分别第几」，「聚合」这件事变得可解释；重复观感会部分缓解（至少知道为什么它在前面）。
- **风险**：**不解决根本问题**——3.2 的排位改写依然存在（网易 #43 变第 5）；`AllSettled` 静默降级依然存在；纯单源的新歌依然被压。且每行多 1–3 个徽章，视觉噪音上升。
- **什么时候是对的**：**只把「展示」当成 bug、把「聚合」当成既定产品决策**时；改动最小（1 个文件），适合作为过渡。
- **什么时候是错的**：如果用户的抱怨核心是「我不信这个榜」，那它只是把疑虑变成了看得见的数字。

### 选项 D · 把聚合升级为**独立的、有名字的跨平台榜**（业界唯一站得住脚的聚合形态）

- **做法**：仿「由你榜/kworb composite」，不把它藏在「热歌榜」里：
  - 独立 Tab / 独立入口，名字明确（如「跨平台热度」），副标题写清口径：「综合网易云 / QQ / 酷狗三榜名次（Σ1/rank），非播放量」；
  - 详情行展示每个源的位次（同 C 的展示）与**上榜源数**（`Object.keys(sourceRanks).length`）；
  - 明确定义缺失源：要么按 `CHART_DEFAULT_MISS` 补缺省权重（**把现在不可达的 `1/51` 分支变成真实语义**），要么在 UI 标注「仅 2/3 源上榜」；
  - 修 `AllSettled` 的静默降级：返回空数组与「抛错」必须可区分（现在 `getKugouRank` 失败返回空数组，等于假装成功）。
- **改动面**：`ChartPanel.tsx` + `DiscoverPageV2.tsx` + `chartAggregator.ts`（缺省语义）+ core `chartAggregate.ts`（可选：名字/口径字段）+ spec。
- **风险**：产品复杂度上升，需要长期维护口径文档；收益高度依赖「用户是否真的想看跨平台」。
- **什么时候是对的**：产品决定长期做「跨平台音乐数据」这件事（那时它不该叫「热歌榜」，而该像由你榜一样独立命名）。**在当前「发现页推荐位」语境下，它是过度设计。**

### 选项 E（额外）· 单元榜 + 榜单矩阵（对齐三源自己的产品形态）

- **做法**：不做「源切换」，而是直接暴露**各源自己的多榜**：`GET /api/toplist/detail`（网易，**实测 63 个榜**）、`rank/list`（酷狗，**实测 56 个榜**）、QQ 巅峰榜矩阵。用户选「源 → 榜」（两级），而不是「合成一个榜」。
- **改动面**：core 加一个「榜单目录」能力（网易的 `getToplists` 目前只硬编码了 2 个榜 `NETEASE_TOPLISTS`，`neteaseDirect.ts` 内部常量；酷狗同样 `KUGOU_TOPLISTS` 只有 2 条），需要新方法（如 `getToplistCatalog()`）或把榜单目录提到 core 的 `TOPLIST_SOURCE_IDS` 上。**这是本报告唯一需要新契约的选项。**
- **用户收益**：最贴近「主流产品形态」（1.7），榜单价值最高（飙升榜/流派榜/地区榜都是现成的、有编辑签名的）。
- **风险**：改动最大；榜单目录的 id 会变（运营商随时增删榜），需要容错。
- **什么时候是对的**：把「排行榜」当核心功能做时（现在它只是发现页 1/4 个 Tab，所以是过度投入；但作为 A 的自然续作最合适）。

**推荐**：先做 **A**（最小改动、直接消除用户抱怨、契约零新增、与移动端统一），把 **C 的展示改良**顺手带进 A 的单元榜（单元榜本来就要显示源内名次）；**B/D/E 作为后续可选项**，其中 E 需要新契约，需先开 issue + ADR。

---

## 5. 榜单详情页还能拿到什么字段（如实说明）

### 5.1 MPlayer 现在实际拿到的（`Song` 形状）

三条榜单腿都只映射成 `Song`（`types/index.ts:19-37`：id / name / artist / album / duration / sourceType + url / cover / lrc / audioTag? / nonFull? / tags?），**rank 完全由数组索引推导**（`sourceRouter.ts:43`）。

- netease：`weapiRequest('/v6/playlist/detail', {id, n:100000, s:8})` → `playlist.tracks[]` → `mapTrack`（`neteaseDirect.ts:298-316`）；**丢掉了全部上榜元数据**。
- QQ：`fcg_v8_toplist_cp.fcg`（`qqDirect.ts:292-388`）→ `data.songlist[].data` → `mapToplistTrack` 只取 mid/name/singer/album.mid/interval。
- 酷狗：`mobilecdn.kugou.com/api/v3/rank/song`（`kugouDirect.ts:145-190`）→ `data.info[]` → `mapRankSong` 只取 hash/songname/authors/album/duration。

### 5.2 已在响应里、**现在没接但可直接取**的字段（无需新接口）

**(a) 网易云** —— `GET https://music.163.com/api/playlist/detail?id={id}`（实测 2026-09-13，**免登录可用**）

- **榜单级**（`result` 对象）：`name` / `description`（编辑器文案，如「云音乐热歌榜：云音乐用户一周内收听所有线上歌曲官方TOP排行榜，每日更新。」）/ `updateTime` / `updateFrequency`（字符串枚举，实测值如「刚刚更新」「每周四更新」「更新19首」）/ `playCount` / `subscribedCount` / `commentCount` / `shareCount` / `trackCount` / `coverImgUrl` / `commentThreadId` / `tags` / `ToplistType`（`S`=飙升/`N`=新歌/`O`=原创/`H`=热歌）。
- **曲目级**：`no`、`position`、`lastRank`、`popularity`、`score`、`playedNum`、`dayPlays`、`publishTime`、`alias`（副标题）、`transName`、`fee`、`mvid`。
  ⚠️ **`lastRank` 不可当「上期名次」用**：实测热歌榜 200 首里 18 首为 `null`，其余取值分布 0..N 且与当前位次无对应关系（例：第 3 名 `lastRank=4`，第 6 名 `lastRank=13`，第 15 名 `lastRank=5`，`no` 字段取值 0..19 混杂）——语义不明，**需再实测或放弃**。`popularity`/`score` 实测恒为 100，无区分度。
- **榜单目录**：`GET /api/toplist/detail`（无 id 参数）返回 **63 个榜**的 id/name/updateFrequency/trackCount/ToplistType/coverImgUrl/description——这是「做真榜单」最划算的一步。
- 契约里现用的 3778678（热歌）/3779629（新歌）与官方值一致。

**(b) QQ 音乐** —— `fcg_v8_toplist_cp.fcg`（实测 2026-09-13）

- 响应级：`code` / `date`（榜单日期，如 2026-09-12）/ `update_time` / `cur_song_num` / `total_song_num` / `comment_num` / `day_of_year`。
- **曲目级（现成可取的「名次变化」三件套）**：`cur_count`（当前名次）、`old_count`（上期名次）、`in_count`（在榜周数）、`Franking_value`。实测样例：`1 0 0 0`（新进榜）/`2 1 156 1`/`3 2 71 1`/`4 3 58 3`（《泪海》在榜 58 周）。**这正是「上榜周数 + 名次变化」所需字段，且已在线拿到、只是被 `mapToplistTrack` 丢掉了。**
- 曲目级还有：`pay.pay_status/price_track`、`file.size_320mp3` 等码率信息、`album.time_public`、`mv.vid`、`isonly`；**没有**播放量绝对值。
- ⚠️ `musicu` 网关的 `musicToplist.ToplistInfoServer.GetToplist` 匿名恒拒（code 500005，仓库内注释 `qqDirect.ts:287-289` 已记录实测），所以 QQ 侧的「榜单目录/完整规则」目前没有可用端点。

**(c) 酷狗** —— `mobilecdn.kugou.com/api/v3/rank/*`（实测 2026-09-13）

- `rank/info?rankid=8888`：`rankname`（TOP500）、`ranktype`、`intro`（**榜单规则文案**，实测值：「数据来源：全曲库歌曲 / 排序方式：按照歌曲产生的完整播放，收藏和分享数据综合进行排名 / 更新频率：每天」）、`imgurl` / `bannerurl`。
- `rank/list`：**56 个榜**的 `rankid` / `rankname` / `ranktype` / `update_frequency`（实测值如「每天」「周四」「周五凌晨更新周榜」）。
- `rank/song` 曲目级：`sort`（名次）、`addtime`（入榜时间戳，实测同榜全为同一天，看不出个体差异）、`rank_cid`/`rank_count`/`rank_id_publish_date`（疑似在榜统计，**未验证语义**）、`recommend_reason`（实测多为空串）、`remark`、`privilege`/`pay_type`、`320hash`/`sqhash`、`authors[]`、`album_id`、`musical`。

### 5.3 现在拿不到、必须新接口的

- **播放量 / 收听量的绝对值**：QQ 与酷狗的热榜接口都不返回（QQ 只有 `comment_num` 级别；酷狗 `rank/song` 的 `rank_count` 语义未验证）；网易 `playlist.playCount` 是**榜单累计**播放量（实测热歌榜 14,128,345,088），不是单曲。→ 若要做「播放量」列，需要单曲级统计接口（可能只在各家的创作者后台/艺人端，公开匿名接口没有）。
- **「上榜时间」的权威值**：酷狗 `addtime` 是同榜统一时间（进榜时间戳不像个体值）；网易 `publishTime` 是**发行**时间不是入榜时间。QQ 有 `in_count`（在榜周数）但**没有**首周入榜日期。
- **编辑推荐语**：网易 `description` 是**榜单级**的，曲目级没有；QQ/酷狗曲目级无编辑文案（酷狗 `recommend_reason` 实测为空）。
- **跨源统一的「最高名次/峰值位」**：三个源都不公开 peak（Spotify/Apple 有，因为那是自家数据）。要做得像 Spotify 的 peak/streak，必须**自己按日抓取并落库**（这就是「自建榜单历史的活」，不是「取一个接口」）。
- **榜单规则页文本的机器可读版**：QQ 有榜单规则页（`y.qq.com/n/ryqq/toplist/26` 页面上的「榜单规则」），酷狗有 `rank/info.intro`，网易有榜单级 `description`/`updateFrequency`——**可不新增接口、静态引用**。

### 5.4 落到 MPlayer 的最小实现建议（如走 A/C）

- `Song` 上加**可选**的榜单元数据字段（如 `rankChange?: { cur: number; prev: number | null; weeks: number | null }`），或更干净的做法：在 `ToplistGroup`（`sourceRouter.ts:45-49`）上加 `meta`（榜单名/描述/更新频率/封面），曲目级元数据走一个**榜单条目类型**而不是往 `Song` 里塞（`Song` 已被播放/收藏/缓存多处消费）。
- **唯一能立刻兑现的「真榜单」字段是 QQ 的 `cur_count/old_count/in_count`**（网易 `lastRank` 语义不明，酷狗无对应字段）。→ 若要做「名次变化 ↑↓ / 在榜 N 周」，第一步是 **QQ 单源**，并接受「其他源该列为空」。
- 榜单描述 / 更新频率 / 规则文案：网易 + 酷狗现成，QQ 无（除榜单页 HTML）。

---

## 附：本次实测的原始命令与抓取时间

- 抓取时间：2026-09-13（本机），端点与响应片段见上文各节标注。
- 网易榜单目录：`curl 'https://music.163.com/api/toplist/detail' -H 'Referer: https://music.163.com/'` → 63 榜。
- 网易榜单曲目：`curl 'https://music.163.com/api/playlist/detail?id=3778678'` → 200 首 + 榜单级字段；`?id=3779629` → 100 首。
- QQ：`curl 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?newsong=1&tpl=3&page=detail&date={yyyy-mm-dd}&topid=26&type=top&song_begin=0&song_num=50&g_tk=5381&format=json&inCharset=utf-8&outCharset=utf-8&notice=0' -H 'Referer: https://y.qq.com/'` → code 0，`songlist[].{cur_count,old_count,in_count,Franking_value}`。
- 酷狗：`curl 'http://mobilecdn.kugou.com/api/v3/rank/list?json=true&page=1&pagesize=40&withsong=0'` → 56 榜；`rank/info?rankid=8888` → intro 规则文案；`rank/song?rankid=8888&page=1&pagesize=100&version=9108` → 100 首。
- 聚合复算脚本：按 `packages/core/src/shared/chartAggregate.ts` 的 `normalizeSongKey` / `aggregateScore` / `pickBest` 规则在 Python 里复刻，输入 = 上述三源榜单原始条目。

### 明确「未验证 / 不知道」

- 网易 `lastRank` / `no` / `position` 的确切语义**未能确认**（实测与当前位次无对应）；若要用必须再做一次跨日对比抓取。
- 酷狗 `rank_count` / `rank_cid` / `rank_id_publish_date` 语义**未验证**（疑似在榜统计）。
- 酷狗 `addtime` 是否为个体「入榜时间」**未验证**（实测同榜全为同一时间戳）。
- MPlayer 产品是否已有「综合榜」的使用埋点/用户调研：**未在仓库中找到**（`docs/` 下无榜单形态相关研究，本文件是首份）。
- Spotify/Apple/YouTube 的**移动端 App 内**榜单页具体渲染字段：只以官方文档为准，未做真机实测（文档已足以回答「是否聚合/是否切源」）。
- QQ 是否还有**匿名可用**的榜单目录端点（musicu 已拒）：未找到，不排除存在未公开端点。
- 各源榜单接口是否有「分页拉到 200+ 名」的稳定路径（本次 QQ 单页取到 50，`total_song_num=300`）：未逐一验证。
