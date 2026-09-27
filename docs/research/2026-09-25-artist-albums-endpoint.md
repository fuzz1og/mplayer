# 网易云「歌手专辑」接口调研（专辑列表不全的根因与补全方案）

> 调研日期: 2026-09-25 · 仓库基线: `8f4957e`（master）· 已开票: [fuzz1og/mplayer#417](https://github.com/fuzz1og/mplayer/issues/417)（移动端歌手页数据不全，合并了 §7 P0 与 §9）· 关联: [fuzz1og/mplayer#407](https://github.com/fuzz1og/mplayer/issues/407)（专辑数据面多源化）
> 调研方法: 本项目代码审读 + **当日实测网易云线上接口（匿名、无 Cookie）** + 社区逆向项目源码比对 + MusicBrainz 交叉校验
> 触发问题: 陶喆的《David Tao》《I'm OK》《黑色柳丁》《太平盛世》在 App 里看不到，怀疑「接口返回不全 / 需要 Cookie」
> 本文为社区逆向、非官方接口调研，仅用于学习研究。
>
> **入库时补注（2026-09-27，随 #417 的实现 PR 提交）**
> - 本文行号以基线 `8f4957e` 为准；此后 `master` 已前进，引用前请在当前 `master` 上重新核对
>   （例：`sourceRouter.ts` 的接口已从 `:128/:141` 扩到 `:128-168`，`CONTENT_METHODS` 在 `:176-192`；
>   `neteaseDirect.ts` 的 `getArtistAlbums` 在 `:687-712` 一带）。
> - §9 提出的「专辑搜索接入」（`searchAlbums?`）**已被产品决定否决**：产品路径是「搜歌手 → 歌手页 → 专辑」，
>   见 #415 / #417 的 out-of-scope。§9 保留为调研记录，不代表待实现的契约变更。
> - §7 P0 的另外两条已随 #417 落地：`fetchArtistInfo` 的死链换成 `GET /api/v1/artist/{id}`；
>   `getArtistAlbums` 增 `ok` 且 `total` 改为 `number | null`（`more=true` 时不可信）。决策记录见
>   ADR `docs/adr/2026-09-27-album-and-artist-content-contract.md`。

---

## 0. 结论先行

1. **上游接口没有不全，也不需要 Cookie。** `POST /weapi/artist/albums/{id}` 匿名（零 Cookie）返回陶喆 **全部 31 张专辑**，包含全部 8 张录音室专辑：《David Tao》(1997)、《I'm OK》(1999)、《黑色柳丁》(2002)、《太平盛世》(2005)、《太美丽》(2006)、《六九乐章》(2009)、《再见你好吗》(2013)、《STUPID POP SONGS》(2025)。用户点名的 4 张全部在响应里。
2. **「不全」是客户端截断**：移动端 `packages/mobile/app/artist/[id].tsx:87` 硬编码 `getArtistAlbums(id, 0, 20)`，只取最新 20 张（截断到 2008-05）；桌面端 `ALBUM_PAGE_SIZE = 30` 有无限滚动、能翻全（`src/renderer/pages/ArtistDetailPage.tsx:15,91`）。**移动端 limit=20 的截断集合与用户点名的 4 张完全吻合**。
3. **一个附带的真实数据缺陷**：该接口的 `total` 字段被 `limit` 截断（`total = min(真实总数, limit)`），所以桌面头部「共 30 张专辑」对陶喆（实际 31）、周杰伦（44）、张学友（136）都是错的。**不能拿 `total` 当总数展示**。
4. **不需要其它源来「辅助补全」。** 与 MusicBrainz 逐条比对：网易这边覆盖了全部正式录音室专辑，甚至比 MB 多（多出的多是单曲/OST）；MB 独有的是合辑与少量单曲/演唱会盘。跨源补全只会引入翻唱/合辑噪声。
5. **有零成本的兜底腿**：明文 `GET https://music.163.com/api/artist/albums/{id}?offset=&limit=` 实测与 weapi **同数据、同顺序、同样匿名**，且**不需要 weapi 加密**。当前 `getArtistAlbums` **没有明文兜底**（对比 `getNewAlbums`/`getArtistSongs` 都有），可照抄。
6. **专辑搜索：已决定不做**（2026-09-25 决策）。技术上 `type=10` 在 `/api/cloudsearch/pc`(POST) 与 `/api/search/get/web`(GET) 都匿名可用、字段可直接映射 `Album`，但产品路径定为「**搜歌手 → 进歌手页 → 看专辑**」，搜索不加「专辑」tab。实测结论仅存档于 §6。
7. **「降序」其实已经是现状**：接口返回严格按 `publishTime` 降序且跨请求稳定；桌面 `AlbumGrid` 已按 `publishTime` 降序 + 年份降序分组（`src/renderer/components/AlbumGrid.tsx:70,78-82`）。移动端只要不截断、按序渲染即可，**无需额外排序逻辑**。

---

## 1. 复现与根因

### 1.1 上游实测（2026-09-25，全部无 Cookie）

陶喆 artistId = **5196**（`/api/search/get/web?type=100` 得到，`albumSize` 报 30，实际 31 —— 该字段不准）。

```
weapi  /artist/albums/5196 offset=0 limit=30  -> n=30  total=30  more=true
weapi  /artist/albums/5196 offset=0 limit=100 -> n=31  total=31  more=false
weapi  /artist/albums/5196 offset=30 limit=30 -> n=1                （王八蛋 Remix 1997-12-02）
plaintext /api/artist/albums/5196?offset=0&limit=100 -> n=31 more=false（与 weapi 集合完全一致）
```

limit=30 时第 30 条正是 `David Tao (1997-12-05)` —— 所以桌面（limit=30）**能看到**用户点名的那 4 张。

### 1.2 根因：移动端 limit=20

`packages/mobile/app/artist/[id].tsx:87`：

```ts
// 专辑区块:前 20 张,横向滚动
getDirectClient('netease')!.getArtistAlbums!(id as string, 0, 20)
```

limit=20 的截断点落在 `好好活下去 (2008-05-25)`，**被丢掉的 11 张**：

| 发行 | 专辑 |
|---|---|
| 2007-10-25 | Power Of Live 影音记录珍藏盘 |
| 2006-08-03 | 太美丽 |
| **2005-01-20** | **太平盛世** |
| 2003-12-18 | Soul Power Live 陶喆现场原音专辑 |
| 2003-08-07 | Ultrasound 乐之路 1997-2003 |
| **2002-08-08** | **黑色柳丁** |
| 2001-07-31 | I Believe |
| 2000-02-29 | 陶喆I'm OK演唱会 |
| **1999-12-09** | **I'm OK** |
| **1997-12-05** | **David Tao** |
| 1997-12-02 | 王八蛋 Remix |

用户点名的 4 张全在这个集合里 —— **这是根因成立的强证据**。

### 1.3 附带的真实缺陷：`total` 被 limit 截断

`packages/core/src/api/neteaseDirect.ts:688-710` 直接把上游 `total` 透传；但实测 `total = min(真实总数, limit)`：

| 歌手 | artistId | limit=20/30/50 | limit=200 | limit=1000 | 真实总数 |
|---|---|---|---|---|---|
| 陶喆 | 5196 | total=30 | total=31 | total=31 | **31** |
| 周杰伦 | 6452 | — | total=44 | total=44 | **44** |
| 张学友 | 6460 | total=50 | total=136 | — | **136** |
| 久石让 | 14408 | — | **total=200（more=true）** | total=243 | **243** |

→ 桌面 `ArtistDetailPage.tsx:222` 的「共 {albumsTotal} 张专辑」在 `more=true` 时必然偏小（久石让会显示 200 而实际 243）。**只有 `more===false` 时 `total` 才可信。**

### 1.4 附带的第三个缺陷：失败 / 空 不可区分

`getArtistAlbums` 的 catch 直接 `return { albums: [], total: 0, more: false }`（:706-708）。风控、超时、`code=-460` 与「这歌手真的没专辑」在调用方看来完全一样 —— 与 #407 里指出的「专辑详情 null → 页面静默降级」是同一类问题。

---

## 2. 接口清单（全部 2026-09-25 实测，匿名无 Cookie）

| # | 端点 | 方法 | 签名/鉴权 | 实测结果 | 建议 |
|---|---|---|---|---|---|
| 1 | `/weapi/artist/albums/{id}` | POST | weapi 加密，匿名 | n=31/44/136/243，字段 `hotAlbums/more/code` | **主腿（现状已用）** |
| 2 | `/api/artist/albums/{id}?offset=&limit=` | GET | **无**（仅 UA+Referer） | **与 #1 集合完全相同**，字段多 `kindTabs` | **推荐补作兜底腿** |
| 3 | `/weapi/v1/artist/{id}` / `/api/v1/artist/{id}` | POST/GET | weapi / 无 | 只回 `artist`+`hotSongs`，**无 hotAlbums** | 与专辑无关 |
| 4 | `/api/cloudsearch/pc` `type=10` | POST | 无 | 专辑搜索，陶喆 `albumCount=160` | 搜索接入见 §6 |
| 5 | `/api/search/get/web` `type=10` | GET | 无 | 同上，字段齐全 | 搜索接入见 §6 |
| 6 | `/weapi/artist/head/info/get` | POST | 匿名 | 歌手详情（lx-music 用），**不含专辑列表** | 备查 |

- #1 与 #2 的字段：`normalizeNeteaseAlbum` 只取 5 个字段，而上游对象实际含 `company / description / subType / size / tags / briefDesc / alias / artists / publishTime` —— 直接支撑 #407「同一响应补字段、不新增请求」的验收项（与 #407 正文的【待验证】一致，此处已实测确认）。
- 两者都**不需要 Cookie**。用户「可能那个接口是需要 Cookie」的顾虑实测不成立。

---

## 3. 社区知名项目怎么取歌手专辑

| 项目 | 端点 | 关键参数 | 与 MPlayer 的差异 |
|---|---|---|---|
| **NeteaseCloudMusicApi**（30.2k★，**已 archived**，仓库只剩 README） | `POST /weapi/artist/albums/{id}` | `offset` / `limit`(默认 **30**) / `total:true` / `csrf_token:''`，cookie 透传但可空 | 算法一致；**默认 limit 也是 30** |
| **lx-music**（`wy/artist.js` `getAlbums`，活跃维护） | `POST /weapi/artist/albums/{id}` | `{limit, offset, total:true}`，**默认 `limit = 100`**，用返回的 `more` 翻页 | **同一个端点，只是页大小 100** |
| **lx-music** `getDetail` | `POST /weapi/artist/head/info/get` | `{id}` | 新一代歌手详情端点 |
| **music-lib**（Go 多源库，本仓 #407 引用源） | — | **完全没有歌手专辑能力**，只有 `/weapi/v1/album/{id}` 专辑详情 | 不能作为补全来源 |
| **musicbox**（Python，18k★）/ 各 vue-music 项目 | 均内联 vendored `artist_album.js` | 同上 | 无第三种做法 |

**结论：社区做法与我们完全一致，唯一的差别是页大小（lx-music=100 vs 我们=20/30）。没有「更神奇的接口」。**

> 证据链接：
> - [NeteaseCloudMusicApi router/artist_album.js（vendored 副本）](https://github.com/yllg/xbyjMusic/blob/master/NeteaseCloudMusicApi/router/artist_album.js)
> - [lx-music `src/utils/musicSdk/wy/artist.js`](https://github.com/souvenp/lx-netease-music-mobile/blob/master/src/utils/musicSdk/wy/artist.js)
> - [guohuiyuan/music-lib `netease/netease.go`](https://github.com/guohuiyuan/music-lib/blob/main/netease/netease.go)
> - [Binaryify/NeteaseCloudMusicApi（archived 状态）](https://github.com/Binaryify/NeteaseCloudMusicApi)

---

## 4. 边界与配额（实测）

| 项 | 实测结论 |
|---|---|
| 排序 | **严格按 `publishTime` 降序**（周杰伦 44 条逐条校验通过）；两次独立请求 id 顺序完全一致 |
| `publishTime` | 全部为有效 epoch ms（0/NaN 计数 = 0），可直接 `new Date(t)` 取年 |
| 分页 | `offset/limit` 正常；`offset` 超总数返回空 + `more=false`（久石让 offset=500 → 0 条） |
| `more` | 语义可靠（limit<总数 → true），**推荐用它驱动翻页**，不要用 `total` |
| `total` | **被 limit 截断**（§1.3），`more=true` 时不可信 |
| `limit` 上限 | 1000 / 1200 / 1500 / 1800 成功；**2000 / 5000 → `code=-460`**（参数非法）。安全规则：**limit ≤ 1000** |
| 风控 | `/weapi/artist/albums/*` 连续约 15 次请求无异常；但明文 `/api/search/get/web` 在密集请求后返回 `code=405 操作频繁，请稍候再试` —— 搜索腿需退避，专辑腿暂未见 |
| Cookie | 全程未带任何 Cookie，全部 200 |

---

## 5. 其它源能不能「辅助补全」？——不需要

用 **MusicBrainz**（`38fe7fb3-2bde-4672-8016-2ba6f7d1808f`，26 条 release-group）对账陶喆：

- **网易覆盖了全部 8 张录音室专辑**，且额外提供大量单曲/OST/演唱会盘（31 条）。
- **MB 有而网易没有的**：`作品精選`(2001 合辑)、`So Beautiful`(2006 Single)、`Love Can 就是爱你演唱会`(2006)、`Bring The Light In 欢迎光临台北演唱会`(2023)、`全世界会唱的歌`(2023 Single)、`讓愛再繼續`(2024 Single)、`Power of Live`(2003 重复条目)。
- **网易有而 MB 没有的**：约 11 条（`小子`、`圣诞之吻`、`黑色星期二`、`万事如意`、`告别飞行`、`勿忘我`、`小小的你`、`崛起`、`好好活下去`、`暗恋 电影原声带`、`王八蛋 Remix` 等）。

→ **跨源补全的收益只剩「合辑 + 个别演唱会/单曲」，而用户的要求是「录音室正式发行的必须有」——这条已经 100% 满足。** 引入 QQ/咪咕专辑腿只会带来合辑/翻唱噪声与 id 跨源串键风险（#407 §3 已警示）。**建议：不为此做跨源补全。**

---

## 6. 专辑能否接入搜索 API？——技术上可以，但**已决定不做**（技术存档）

> **决策（2026-09-25）**：产品路径定为「搜歌手 → 进歌手页 → 看专辑」，搜索 API **不加「专辑」tab**。本节保留实测结论**仅作技术存档，不是待办**。

`type=10` 专辑搜索，两个端点都匿名可用（2026-09-25 实测）：

```
POST /api/cloudsearch/pc   s=陶喆&type=10&limit=10&offset=0 -> code=200 albumCount=160
GET  /api/search/get/web   s=陶喆&type=10&limit=10&offset=0 -> code=200 albumCount=160
```

返回对象可直接映射 `Album`（实测 `黑色柳丁` id=15190）：

```jsonc
{ "id": 15190, "name": "黑色柳丁", "type": "专辑", "size": 12,
  "picUrl": "https://p2.music.126.net/...jpg",
  "publishTime": 1028822400000, "company": "华纳音乐",
  "artists": [{ "id": 5196, "name": "陶喆" }] }
```

接入面（现状搜索 UI 只有两个二级 tab）：

- `src/renderer/pages/DiscoverPageV2.tsx:458-480` —— 「单曲 / 歌手」二级 tab，需加第三个「专辑」
- `packages/core/src/shared/sourceRouter.ts:128,141` —— 契约只有 `searchSongs` / `searchArtists`，需加可选 `searchAlbums?`
- `packages/core/src/shared/sourceRouter.ts:176-192` —— `CONTENT_METHODS` IPC 清单需登记
- 移动端搜索页同理

**注意**：`type=10` 的结果是**按相关度**排的（陶喆 albumCount=160 里含合辑/翻唱），**不能**用它当「歌手完整专辑列表」——完整列表仍应走 §2 的 #1/#2。

---

## 7. 对 #407 / 专辑列表票的建议改动（按性价比排序）

**P0（修「不全」这一条主诉）**

> 专辑的**唯一入口**已定为「搜歌手 → 歌手页 → 专辑」，因此下面第 1 条移动端截断是**主路径上的阻断性缺陷**，不是边角问题。

1. **移动端补全**：`packages/mobile/app/artist/[id].tsx:87` 的 `limit=20` 改为可翻页（复用 `more`），或一次性 `limit=100`；并给「查看全部专辑」入口。横滑 20 张的版式承载不了 243 张（久石让）。
2. **契约收紧**：`getArtistAlbums` 返回体已经带 `more`，把 **`more` 定为翻页唯一依据**，UI 不要用 `total` 当「共 N 张」；或仅在 `more===false` 时展示精确总数（`ArtistDetailPage.tsx:222`）。
3. **补明文兜底腿**：照 `getNewAlbums`(:592-602) / `getArtistSongs`(:671-679) 的写法加 `/api/artist/albums/{id}`，**不需要加密、不需要 Cookie**，与 weapi 同日实测同数据同序。
4. **失败语义**：catch 里返回空数组改为可区分的失败信号（`ok` 或抛错），页面给「加载失败，重试」而不是「暂无专辑」（与 #407 §7 兜底取向一致）。

**P1（顺手，属 #407 本体）**

5. `normalizeNeteaseAlbum` 补 `company / subType / size / description`（同一响应已有，零新增请求），并给 `Album` 加 `sourceType`。
6. 页大小对齐社区：默认 **limit=100**（lx-music 口径），上限自控 **≤1000**（≥2000 会 `code=-460`）。
7. 缓存键补源：`artist_albums_${artistId}_${offset}_${limit}` → 加 source（同 #407 §6）。
8. 删除或接线 `getArtistDetail`：全仓**无生产调用方**，仅测试引用，其内部 limit=30 同样会截断 —— 属潜在第二处同类 bug。

**P2（另票）**

9. ~~专辑搜索接入~~ —— **已决定不做**（产品路径改为「搜歌手 → 歌手页 → 专辑」，见 §6 决策）。
10. 歌单搜索接入——已开票 [fuzz1og/mplayer#415](https://github.com/fuzz1og/mplayer/issues/415)，调研见 [`2026-09-25-netease-playlist-search.md`](2026-09-25-netease-playlist-search.md)。
11. 「专辑页降序」——**经核实现状已是降序**（§0.7），若仍要单独跟踪，应澄清指的是专辑 *详情页曲目* 还是 *歌手专辑列表*。

---

## 8. 待验证 / 风险

1. `limit` 上限的精确边界（实测 1800 成功 / 2000 失败，未二分到具体值）——实现里按 ≤1000 自控即可，无需精确。
2. **跨源 id 不可互送**：网易 albumId 是纯数字，QQ/Kugou 是字符串且语义不同；`album_detail_${albumId}` 键在接入第二源后必然串键（#407 §6 已列）。
3. **合作专辑/feat 归属**：`/artist/albums/{id}` 只列「该 artistId 为专辑歌手」的盘，合作盘不会出现在被 feat 歌手下（与网易官方歌手页一致，属预期行为，非缺陷）。
4. `albumSize`（搜索结果字段）**不可信**：陶喆 30 vs 实际 31、周杰伦 41 vs 44、久石让 235 vs 243 —— 不要用它做分页/计数。
5. 真机可达性：本文全部在 Node 侧实测；RN 真机（Android）走同 `transport.request` 接缝，风控表现需真机复测（#407 已列）。

---

## 9. 附带建议：歌手页不要「按名字搜歌手」，改成「入口参数直出 + 按 id 校正」

### 9.1 现状（手机端）

入口只有两个，**都已经把 `name` 和 `pic` 带上了**：

- `packages/mobile/components/DiscoverTabs.tsx:535`（歌手分类列表）
- `packages/mobile/app/(tabs)/search.tsx:157`（搜索结果歌手 tab）

两者都是 `router.push(\`/artist/${a.id}?name=...&pic=...\`)`。

而歌手页首屏（`packages/mobile/app/artist/[id].tsx:58-79`）却额外发了一次**按名字的搜索**：

\`\`\`ts
const [artistResults, songResult] = await Promise.all([
  getDirectClient('netease')!.searchArtists!(artistName, 1),   // ← 只为拿头像/名字
  getDirectClient('netease')!.getArtistSongs!(id as string, 0, 50),
]);
const info = artistResults[0] || null;
setArtist({ ...info, name: info?.name || artistName, picUrl: pic || info?.picUrl || '' });
\`\`\`

注意第 71 行：`picUrl` 已经是 **`pic`（入口参数）优先**，搜索结果的 `picUrl` 只是兜底；但 **`name` 反过来是搜索结果优先**。

### 9.2 四个问题

1. **可能显示成别的歌手**（正确性）：`searchArtists(name, 1)[0]` 是「这个名字搜索排第一的实体」，**不是「这个 id 对应的歌手」**。网易存在同名多实体，例如「陶喆」有 `5196`（407 首歌 / 31 张专辑）与 `31213543`（2 首歌 / 0 张专辑）。从后者进入歌手页，页面会显示前者的名字与头像。翻唱/山寨号同理。
2. **纯冗余**：两个入口都已传 `name`+`pic`，头像本来就有。
3. **脆弱**：依赖 `GET /api/search/get/web`——突发限流那条腿，失败时静默 `[]`（§0.6）。
4. **计数不准**：搜索结果里的 `albumSize` 是陈旧的（陶喆报 30，实际 31）；按 id 取是准确的 31 / 407。

### 9.3 推荐的改法（三层，可独立落地）

**第 1 层 · 入口参数直出（零请求、秒出图）**
首屏直接用路由的 `name`/`pic` 渲染，不等网络。桌面端已经是这个模式（`src/renderer/services/artistMetaCache.ts`：`location.state` 优先、模块级缓存兜底，注释写明就是为了解决「返回导航丢头像」）。

**第 2 层 · 按 id 校正（唯一正确来源）**
拿到 id 后异步取一次歌手信息覆盖。可用端点（2026-09-25 实测）：

| 端点 | 结果 | 说明 |
|---|---|---|
| `POST /weapi/artist/head/info/get` `{id}` | 未本机实测 | lx-music 现用；只回歌手信息，**需 weapi 加密**（仓库已有 `weapiRequest`） |
| `GET /api/v1/artist/{id}` | **code=200** ✅ | 明文，回 `artist`（含 https `picUrl`/`img1v1Url`）+`hotSongs`；与仓库「weapi 优先 + 明文兜底」模式契合 |
| `GET /api/artist/{id}` | **code=200** ✅ | 同上，等价 |
| `GET /api/artist?id={id}` | **code=404** ❌ **死链路** | ⚠️ 仓库 `fetchArtistInfo`（`neteaseDirect.ts:434-440`）用的正是这条 |

> **顺带修一个既有 bug**：因为 `fetchArtistInfo` 指向死链路，`getArtistDetail(artistId)` **实测恒返回 `artist: null`**（`hotSongs`/`albums` 正常）。它目前无生产调用方，所以没暴露；但任何「改用 `getArtistDetail` 修歌手页」的方案都会踩空。

**第 3 层 · 删掉按名字搜**
移除 `artist/[id].tsx:62` 的 `searchArtists`，`name` 以入口参数为准、异步按 id 校正。

### 9.4 好处

| 维度 | 现状 | 改后 |
|---|---|---|
| 正确性 | 同名多实体可能显示成别的歌手 | 一定属于该 id |
| 首屏 | 等 2 个请求（其中一个可能被限流） | 入口参数**立即出图**，校正请求后台跑 |
| 请求数 | 2 发（1 发纯冗余） | 1 发（且不再碰限流腿） |
| 计数 | `albumSize` 陈旧（30） | 准确（31 / 407） |
| 依赖 | 依赖突发限流的 `search/get/web` | 只依赖明文/weapi 的 by-id 腿 |

> 与 §7 P0 的移动端 `limit=20` 截断**在同一个文件**（`packages/mobile/app/artist/[id].tsx`），已合并开票 [fuzz1og/mplayer#417](https://github.com/fuzz1og/mplayer/issues/417)。

---

## 附录 A. 实测命令（可复现）

```bash
# 1) 取 artistId
curl -s "https://music.163.com/api/search/get/web?s=%E9%99%B6%E5%96%86&type=100&limit=5" -H "Referer: https://music.163.com/"

# 2) 明文歌手专辑（无需加密、无需 Cookie）
curl -s "https://music.163.com/api/artist/albums/5196?offset=0&limit=100" -H "Referer: https://music.163.com/"

# 3) limit 上限
curl -s "https://music.163.com/api/artist/albums/14408?offset=0&limit=2000" -H "Referer: https://music.163.com/"   # -> code=-460

# 4) 专辑搜索
curl -s -X POST "https://music.163.com/api/cloudsearch/pc" -H "Referer: https://music.163.com/" \
  -d "s=%E9%99%B6%E5%96%86&type=10&limit=10&offset=0"
```

```js
// 5) 走本仓已构建的 weapi 客户端（等价于线上调用路径）
const mod = await import('./packages/core/dist/index.js');
const c = mod.createNeteaseDirectClient(mod.defaultContentCache);
await c.getArtistAlbums('5196', 0, 100);  // -> 31 张，含 David Tao / I'm OK / 黑色柳丁 / 太平盛世
```
