# 网易云「歌单搜索」接口调研（接入搜索 API 可行性）

> 调研日期: 2026-09-25 · 调研基线: `8f4957e`（master；工作树仅有 `docs/research/` 未跟踪文件）
> 行号校正: 2026-09-27（#415 落地后）· 行号基线: `feat/playlist-search`（自 `e97f754` 起）——本文所有 `文件:行` 已按该基线重新核对
> 已开票: [fuzz1og/mplayer#415](https://github.com/fuzz1og/mplayer/issues/415)（open / needs-triage）· 来源: [#407](https://github.com/fuzz1og/mplayer/issues/407) 探索过程中衍生的独立议题
> 调研方法: 本项目代码审读 + **当日线上实测（全程匿名、零 Cookie，一次性 Node 进程直接 fetch，未落任何临时脚本）**
> 本文为社区逆向、非官方接口调研，仅用于学习研究。
> 前置结论: [#126 各源 cookie 必需性](https://github.com/fuzz1og/mplayer/issues/126)（网易 cloudsearch weapi 无 cookie 必被风控 `code=50000005`）

---

## 0. 结论先行

1. **可行，且匿名可用（零 Cookie、零登录、零签名）。** 网易云有独立的歌单搜索能力，搜索 `type=1000` 即歌单。
2. **推荐端点：`POST https://music.163.com/api/cloudsearch/pc`**，form 体 `s=<kw>&type=1000&limit=&offset=` —— 这与仓库现有 `searchSongs` **是同一条腿**（`packages/core/src/api/neteaseDirect.ts:30` 常量 `CLOUDSEARCH_URL`、`:285-288` 实现 `neteaseSearchSongs`，现用 `type:'1'`；请求形态已抽成共用 `:242-282` `cloudsearchSearch`），**复用既有 `transport.request` 接缝与 UA/Referer 头，不新增加密、不新增头**，改动面最小。实测 `code=200, playlistCount=465`，`limit` 上限 100，`offset` 翻页正常，连续 10 发不限流。
3. **字段与 `DiscoverPlaylist` 1:1 可映射**（`packages/core/src/types/index.ts:127-136`）：`id/name/coverImgUrl/playCount/trackCount/creator.nickname/description` 全有；仅 `tags` 上游不返回（补 `[]`），`coverImgUrl` 是 `http://` 需转 https。**不需要新类型。**
4. **不要选 `/weapi/cloudsearch/get/web`**（也不选其明文同族 `/api/cloudsearch/get/web`）：实测无 Cookie 时两腿恒返回 `{"code":50000005}`（type=1 与 type=1000 都一样），与仓库既有结论一致（迁移说明见 `neteaseDirect.ts:518-528`、ADR `docs/adr/2026-09-27-netease-playlist-search.md`）。`POST /weapi/search/get`（type=1000）匿名可用，但要走 AES+RSA 加密，**不比明文 cloudsearch pc 更优**，仅作备选。
5. **`GET /api/search/get/web?type=1000` 干净态其实是可用的**（实测 `code=200, playlistCount=465, limit=30 → n=30`），**否决它的理由是「不要拿它当高频腿」，而不是它坏了**：限流是**突发 + 滚动窗口**触发 —— `1 发 / 3s × 10` **全部 `code=200`**（正常使用无问题），但**无间隔连打**时先连续 `code=500 system error!` 再转 `code=405/406 操作频繁，请稍候再试`，且**对所有 type（1/10/100/1000）统一封禁**；同一时间窗内 `/api/cloudsearch/pc` 全程 `code=200`（两条腿额度独立）。**「第几发触发」不是稳定常量，勿引用固定发数**（见 §3）。
6. **顺带记录一个既有弱点（非高频路径，优先级低）**：仓库 `searchArtists`（迁移前 `neteaseDirect.ts:475-493`）走这条明文腿，命中非 200（`405`/`500`）时**不抛错、静默返回 `[]`**，歌手 tab 显示「未找到」而非错误。但实测该调用**频次很低**（移动端搜索页的 `q` 是**路由参数、按提交触发**，不是逐键触发；歌手页每开一次 1 发），**正常使用不会触发限流**；且 `cacheManager.set` **拒绝缓存空数组**（`memoryCacheManager.ts:84-88`），失败**不会**被缓存、下次会自愈。→ 建议降级为「可选硬化」：迁到 `POST /api/cloudsearch/pc` `type=100`（实测匿名可用、`artistCount=83`），或让失败**可区分**。**（#415 已按前者落地：现为 `neteaseDirect.ts:518-539`，失败改为抛错、与「真没这个歌手」可区分。）**
7. **建议单独开票 —— 已开（#415）。** 本报告补齐/修正了 #415 的若干细节（见 §7）。

---

## 1. 端点实测矩阵（2026-09-25，全部匿名、零 Cookie）

| # | 端点 | 方法 | 参数 | HTTP | `code` | 结果 |
|---|---|---|---|---|---|---|
| 1 | `/api/cloudsearch/pc` | POST form | `s=周杰伦&type=1000&limit=5&offset=0` | 200 | **200** | `playlistCount=465`, `n=5`, 3 073 B, 127–179 ms ✅ **推荐腿** |
| 2 | `/api/cloudsearch/pc` | POST form | `type=1000&limit=100` | 200 | 200 | `n=100`, 57 615 B |
| 3 | `/api/cloudsearch/pc` | POST form | `type=1000&offset=5` | 200 | 200 | 返回**不同**歌单（第 6 条起，首条变为「薛之谦/周杰伦/林俊杰」） |
| 4 | `/api/cloudsearch/pc` | POST form | `type=1000&offset=990` / `1000` | 200 | 200 | `{"result":{"playlists":[],"playlistCount":0}}`（越界返回空，**不报错**） |
| 5 | `/api/cloudsearch/pc` | POST form | `type=100`（歌手） | 200 | 200 | `artistCount=83`, `n=3`, 1 442 B |
| 6 | `/api/cloudsearch/pc` | POST form | `type=1`（单曲，仓库现用） | 200 | 200 | `songCount=270`, `n=3` |
| 7 | `/api/cloudsearch/pc` | POST form | `limit=101` / `200` | 200 | **400** | `{"code":400}` → **limit 硬上限 100** |
| 8 | `/api/cloudsearch/pc` | POST form | `s=`（空关键词） | 200 | **400** | `{"code":400}` |
| 9 | `/api/search/get/web` | GET | `type=1000&limit=3` | 200 | **200** | `playlistCount=465`, `n=3`, 1 974 B（**干净态可用**） |
| 10 | `/api/search/get/web` | GET | `type=1000&limit=30` | 200 | 200 | `n=30`, 18 127 B |
| 11 | `/api/search/get/web` | GET | `limit=101` / `200` | 200 | **400** | `{"result":{},"code":400}` |
| 12 | `/api/search/get` | GET | `type=1000&limit=2` | 200 | 200 | `playlistCount=465` + **`hasMore`/`hlWords`**；每条歌单额外带 `track`（样例曲含完整 artist/album 对象）与 `alg` → 3 795 B/条 |
| 13 | `/api/search/get/web` | GET | 短窗口密集请求 | 200 | **405 / 406** | `操作频繁，请稍候再试`，全 type 统一封禁（见 §3） |
| 14 | `/weapi/search/get` | POST weapi | `type=1000&limit=5&offset=0` | 200 | **200** | `playlistCount=465`, 18 369 B ✅ 备选（需 AES+RSA） |
| 15 | `/weapi/cloudsearch/get/web` | POST weapi | `type=1000`（`type=1` 同） | 200 | **50000005** | `{"code":50000005}` ❌ 无 Cookie 必现 |
| 16 | `/api/cloudsearch/get/web` | GET | `type=1000` | 200 | **50000005** | `{"code":50000005}` ❌ 同族明文腿也死 |

**推荐腿的真实请求形态**（与仓库 `neteaseSearchSongs` 逐字一致，仅 `type` 不同）：

```http
POST https://music.163.com/api/cloudsearch/pc HTTP/1.1
content-type: application/x-www-form-urlencoded
accept: application/json, text/javascript, */*; q=0.01
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ... Chrome/120.0.0.0 Safari/537.36
Referer: https://music.163.com/

s=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1000&limit=30&offset=0
```

响应摘录（`type=1000`，`limit=5`）：

```jsonc
{
  "result": {
    "searchQcReminder": null,
    "playlistCount": 465,
    "playlists": [
      { "id": 6792103822, "name": "周杰伦-Jay 『网易云精选』",
        "coverImgUrl": "http://p1.music.126.net/WFQ4EKF5QabD33U3NUOPWQ==/109951169535051638.jpg",
        "trackCount": 144, "playCount": 33251026, "bookCount": 141942,
        "creator": { "nickname": "Buradarrr", "userId": 361038766, "avatarUrl": null },
        "description": "【持续更新】欢迎投稿…", "playlistType": "UGC", "highQuality": false }
    ]
  },
  "code": 200
}
```

`result` 的键：`searchQcReminder / playlists / playlistCount`（**没有 `hasMore`** → 翻页终止条件要用 `offset + limit < playlistCount` 推导；明文 `/api/search/get` 才有 `hasMore`，但那条腿被限流）。

> ⚠️ **弱关键词回退（实测）**：`s=zzzqqqxyz不存在的关键词&type=1000` 仍返回 `playlistCount=300, n=5`（首条「不存在的电台」）。网易对无命中关键词会回退到宽松/相关匹配 —— UI **不能**把「有结果」当作「关键词真的命中」。

---

## 2. 返回字段 → `DiscoverPlaylist` 映射

上游歌单对象完整字段（实测，`cloudsearch/pc` 与 `search/get/web` 两腿一致）：

```
id, name, coverImgUrl, creator{nickname,userId,userType,avatarUrl,authStatus,expertTags,experts},
subscribed, trackCount, userId, playCount, bookCount, specialType, officialTags,
action, actionType, recommendText, score, officialPlaylistTitle, playlistType,
description, highQuality
```

| `DiscoverPlaylist`（`packages/core/src/types/index.ts:127-136`） | 上游字段 | 处理 |
|---|---|---|
| `id: number` | `id` | 直取 |
| `name: string` | `name` | 直取 |
| `coverImgUrl: string` | `coverImgUrl` | **`.replace(/^http:/, 'https:')`**（上游实测为 `http://`；与 `getRecommendedPlaylists` `:545` 同款处理） |
| `playCount: number` | `playCount` | 直取（缺失兜底 0） |
| `trackCount: number` | `trackCount` | 直取（缺失兜底 0） |
| `creator: { nickname: string }` | `creator.nickname` | 需 `creator` 为空时兜底 `{ nickname: '' }`（同 `:548`） |
| `tags: string[]` | **无该字段** | 补 `[]`（`officialTags` 实测多为 `null`，且语义是官方推荐位标签，不建议当 `tags`） |
| `description: string` | `description` | 直取（可能为空串；`cloudsearch/pc` 已返回，无需详情接口补） |

→ **映射 1:1，无需新类型、无需二次请求**。

---

## 3. 限流与风控（全部实测）

| 观测 | 实测值 |
|---|---|
| 触发点 | **无固定发数，取决于滚动窗口内的请求密度**（三组独立观测）：① 子代理干净态观测到「短窗口内第 7 发」→ `405`；② 子代理另一轮 `limit=100` 后紧跟 `limit=200` 先出现 `406`，随后全部 405/406；③ **Lead 复核**：`1 发 / 3s × 10` → **10/10 全 `code=200`**；紧接着无间隔连打 → **前 5 发 `code=500 system error!`，第 6 发起 `code=405`**。→ 阈值随窗口变化，**不要引用某个固定发数** |
| 封禁范围 | **该腿全 `type` 一起挂**：`type=1`、`type=10`、`type=100`、`type=1000` 统一 405/406（HTTP 仍 200，错误只在 body 的 `code`） |
| 冷却时长 | 触发后连续轮询 **264 s + 210 s 两段（中间隔数分钟做其他工作）全程 405**，之后恢复（末次探测 `code=200`）→ **量级 ≥ 10 分钟** |
| 额度是否共享 | **不共享**：上述 405 窗口内，`POST /api/cloudsearch/pc` 的 `type=1` 与 `type=1000` **每一发都是 `code=200`**；随后对它**连打 10 发（type=1000）全部 200** |
| 参数错误 | `limit>100` → `code=400`（两腿一致）；空 `s` → `code=400`（`cloudsearch/pc`） |
| 越界翻页 | `offset=990/1000` → `code=200` 但 `playlistCount=0, playlists=[]`（**不是错误**，UI 需按此判「到底了」） |
| Cookie | **三腿（cloudsearch/pc、search/get/web、weapi search/get）全部匿名可用，无需 Cookie/登录**；只有 `/weapi/cloudsearch/get/web` 与 `/api/cloudsearch/get/web` 无 Cookie 恒 `50000005` |

**对本仓的含义**：`/api/cloudsearch/pc` 是双端搜索页**已经在用**的腿（桌面 `sourceType=all` 时每页对网易打 1 发）。若歌单搜索在关键词变化时**无条件**再打一发，等于把该腿的每页请求数翻倍；建议**懒加载**（切到「歌单」tab 才发，或复用 `searchArtists` 的「关键词变化触发一次 + seq 守卫」模式）。

---

## 4. 接入面（文件:行，已按 #415 落地后重新核对）

> 「#415 前现状」列描述改动前的形态；「改动」列**已在 #415 落地**，决策与两处签名偏离的理由见 ADR `docs/adr/2026-09-27-netease-playlist-search.md`。

| 位置（落地后行号） | #415 前现状 | 改动（已落地） |
|---|---|---|
| `packages/core/src/shared/sourceRouter.ts:141` | 内容能力区只有 `searchArtists?` | 已加可选 `searchPlaylists?: (keyword, limit, offset?) => Promise<{ playlists; total; more }>`（`:149-153`；比本报告原文的签名多 `offset` 与 `more`，理由见 ADR） |
| `packages/core/src/shared/sourceRouter.ts:188-205` | `CONTENT_METHODS`（`satisfies readonly (keyof DirectSourceClient)[]`） | 已登记 `'searchPlaylists'`（漏登记 = 编译期报错） |
| `packages/core/src/api/neteaseDirect.ts:285-288` | `neteaseSearchSongs(keyword, page)` 写死 `type:'1'`、`PAGE_SIZE=30`（`:31`） | 已抽成 `type` 可变的共用 `cloudsearchSearch(keyword, type, limit, offset)`（`:242-282`）；单曲/歌手/歌单三条腿共用同一份请求形态与头 |
| `packages/core/src/api/neteaseDirect.ts:499`（工厂） | `searchArtists` 用 `GET /api/search/get/web?type=100`（迁移前 `:470-489`） | 已注册 `searchPlaylists`（`:541-588`：缓存 key 含关键词+limit+offset、TTL `SEARCH_TTL_MS`=`:43` 6 h、空结果不入库、同键单飞）；**并把 `searchArtists` 迁到 `POST /api/cloudsearch/pc` `type=100`**（`:529-538`，实测 `artistCount=83`） |
| `src/shared/musicApiContract.ts:44,52-57` | `MUSIC_API_METHODS = [...BASE_METHODS, ...CONTENT_METHODS]`，`ContentMethodMap` 自接口派生 | **零手写改动**（已验证：随 `CONTENT_METHODS` 自动获得 `searchPlaylists(source, keyword, limit, offset?)` 签名） |
| `src/main/ipc/musicApiHandlers.ts:56-68` | 按 `CONTENT_METHODS` 循环泛型分派到 `getDirectClient(source)` | **零改动**（未实现源自动抛「源 X 未实现内容能力 searchPlaylists」） |
| `src/renderer/services/searchService.ts:72-74` | `searchArtists()` → `callMusicApi('searchArtists','netease',kw,limit)` | 已加 `searchPlaylists(kw, limit = 30, offset = 0)`（`:76-90`） |
| `src/renderer/pages/DiscoverPageV2.tsx:397`（tab state 联合类型）、`:519-521`（tab 列表数组）、`:590+`（tab 内容分支） | 二级 tab 只有「单曲 / 歌手」 | 已加第三个「歌单」（**懒加载**：切到该 tab 才发；同关键词只发一次）；内容复用 `src/renderer/components/PlaylistPageGrid.tsx`（`:6-22` 吃 `DiscoverPlaylist[]`，新增可选 `emptyText`）→ 点进既有 `DiscoverPlaylistDetailPage.tsx` |
| `packages/mobile/app/(tabs)/search.tsx:33-37`（`SEARCH_TABS`）、`:40`（`SearchTab` 类型）、`:68-73`（初始 tab）、`:109-136`（关键词 effect + seq 守卫）、`:87-106`（歌单懒加载入口 `searchPlaylists`）、`:146-156`（`TextTabs`，切 tab 才触发）、`:180+`（分支渲染） | 同样只有「歌曲 / 歌手」 | 已加「歌单」tab，调用 `getDirectClient('netease')!.searchPlaylists!(kw, 30)`（照 `:115` 的歌手腿），复用 `packages/mobile/components/DiscoverTabs.tsx:341-471`（卡片 `:421-437`）的歌单网格与 `app/discover-playlist/[id].tsx` 详情页 |

**注意（移动端）**：`@mplayer/core` 改动后必须 `npm run core:build`（Metro 吃 `packages/core/dist`）；跨端契约/来源路由变更按 AGENTS.md 需先补 ADR —— 本次的决策记录是 `docs/adr/2026-09-27-netease-playlist-search.md`（已加入 `docs/adr/README.md` 索引与根 `AGENTS.md` 指针）。

---

## 5. 「歌单搜索」与「歌单广场列表」的重叠辨析

| 能力 | 端点 | 语义 | 现消费方 |
|---|---|---|---|
| **新增** `searchPlaylists(keyword, limit, offset)` | `POST /api/cloudsearch/pc` `type=1000` | **按关键词搜索歌单** | 桌面 `DiscoverPageV2`「歌单」tab、移动 `(tabs)/search.tsx`「歌单」tab（**#415 已接，懒加载**） |
| 既有 `getPlaylists(cat, order, offset, limit)`（`neteaseDirect.ts:801-827`） | `GET /api/playlist/list` | 歌单**广场分类列表**（`cat`+`order`+`offset`，**无关键词**） | 桌面 `DiscoverPageV2.tsx:247`、`DiscoverPlaylistListPage.tsx:36`；移动 `DiscoverTabs.tsx:362,394` |
| 既有 `getRecommendedPlaylists(limit)`（`:631-666`） | `POST /weapi/personalized/playlist` | 个性化**推荐**歌单 | 移动 `app/(tabs)/recommend.tsx:53` |

**结论：三者能力不重叠**（搜索 vs 分类浏览 vs 推荐），命名规则也符合契约（`search<实体>s` / `get<实体>s`）。**真正的混淆风险在 UI 文案**：发现页一级 tab 已有一个「歌单」（= 广场），搜索结果页再加一个「歌单」（= 搜索）会让用户以为两者等价。建议搜索结果页的歌单空态写「没有搜到歌单，去发现页看看歌单广场」并复用同一张卡片组件，弱化概念冲突。**（已落地：`PlaylistPageGrid` 新增可选 `emptyText`，双端搜索页歌单空态即该文案。）**

---

## 6. 风险与是否需要 Cookie

1. **限流（实测已触发，但属突发触发，不是「这条腿坏了」）**：明文 `/api/search/get/*` 在**无间隔连打**时先 `code=500` 再全 type `405/406`；**正常节奏（1 发/3s × 10）完全不触发**。对 App 的实际含义是「**不要把它当高频腿用**」，而不是「它不可用」。`/api/cloudsearch/pc` 本次 10 连发未限流，但同属网易明文风控面，仍应纳入 #408（transport 并发闸门）治理，并做**懒加载 + 单飞 + 缓存**。
2. **不需要 Cookie**：推荐腿三腿均匿名可用（零 Cookie / 零登录 / 零签名）；需要 Cookie 的只有已死掉的 `/…/cloudsearch/get/web` 族（`50000005`）。**不要为了这个功能引入 Cookie 机制。**
3. **`searchArtists` 现存缺陷（#415 已修）**：迁移前 `neteaseDirect.ts:470-489` 走被限流的 `GET /api/search/get/web`，405 时 `catch` 里只 `console.error` 后 `return []`，用户看到「没有这个歌手」；影响 `packages/mobile/app/artist/[id].tsx:63`、`packages/mobile/app/(tabs)/search.tsx:115`。#415 已迁到 `cloudsearch/pc` `type=100`（`neteaseDirect.ts:518-539`），失败改为抛错，双端本就有错误态分支。
4. **弱关键词回退**：无命中仍返回相关结果（§1 注），UI 无法区分「真命中」与「回退」，只能接受（或提示「以下为相关歌单」）。
5. **翻页终止**：`cloudsearch/pc` 不返回 `hasMore`，须用 `offset + limit < playlistCount`；越界返回 `playlistCount=0` 而非错误。
6. **`coverImgUrl` 是 http**：桌面 Electron 混合内容会被拦，必须转 https。
7. **非官方逆向接口**：随时可能变；单测一律**零真实网络**（走 `transport.request` 注入，模式见 `packages/core/src/api/__tests__/neteaseContent.test.ts:26-50`，用 `fakeCache` + `mockTransport`；#415 新增零网络单测见 `packages/core/src/api/__tests__/neteasePlaylistSearch.test.ts`）。

---

## 7. 建议是否单独开票 + 验收标准草案

**建议：单独开票 —— 已开（[#415](https://github.com/fuzz1og/mplayer/issues/415)，open/needs-triage）。值得做**：改动面小（1 个可选契约方法 + 1 个客户端方法 + 两端各一个 tab），复用既有腿与既有歌单详情页，且能顺带修掉 `searchArtists` 的静默空数组缺陷。

本报告相对 #415 已写内容的**修正/补充**（建议在 #415 正文或评审评论中采纳）：

- (a) `GET /api/search/get/web?type=1000` **干净态是可用的**（`code=200, playlistCount=465, limit=30 → n=30`），否决它的原因是**限流**，不是不可用 —— 措辞应据此修正；
- (b) 限流是**突发 + 滚动窗口**触发，**没有固定发数**（Lead 复核：`1 发/3s × 10` 全 200；无间隔连打先 `code=500` 再 `405/406`），冷却量级 ≥10 分钟，且**按端点族独立**（`cloudsearch/pc` 不受牵连）→ 应表述为「**不要高频调用**」，而非「第 N 发必然被限」；
- (c) 补充三条边界到验收标准：`limit>100 → code=400`、空 `s → code=400`、`offset` 越界 → `playlistCount=0`；
- (d) `POST /weapi/search/get`（type=1000）匿名可用，作为**备选**记录（需 AES+RSA，不优于明文）；
- (e) `/api/search/get`（无 `/web`）会多返回 `hasMore/hlWords` 与每条歌单的 `track` 样例曲（3.8 KB/条）—— 不采用，但记录了 `hasMore` 的存在。

**验收标准草案**：

- [ ] `DirectSourceClient` 新增可选 `searchPlaylists?(keyword, limit): Promise<DiscoverPlaylist[]>`；`CONTENT_METHODS` 登记；未实现源走统一「源 X 未实现内容能力 searchPlaylists」错误
- [ ] 网易实现走 `POST /api/cloudsearch/pc` `type=1000`（**不新增 transport 头、不新增加密**），字段映射到 `DiscoverPlaylist`（`tags` 补 `[]`、`coverImgUrl` 转 https、`creator` 兜底）
- [ ] 分页语义：`limit ≤ 100` 内部钳制；`hasMore = offset + limit < playlistCount`；越界（`playlistCount=0`）视为到底
- [ ] 结果按关键词缓存（TTL 6 h，key 含关键词与 limit），且**懒加载**：切到「歌单」tab 才发请求（避免与 `searchSongs` 抢同一条腿的额度）
- [ ] 桌面 `DiscoverPageV2` 与移动端搜索页新增「歌单」二级 tab，复用既有歌单网格组件，点击进入既有歌单详情页
- [ ] `searchArtists` 迁离 `GET /api/search/get/web`（改 `cloudsearch/pc` `type=100`），或至少在 405/406 时返回**可区分**的失败语义，不再静默 `[]`
- [ ] ≥4 条**零真实网络**单测：请求形态（URL/表单/头）、字段映射、分页与越界、`code=405/406/400` 错误路径
- [ ] 跨端契约变更先补 ADR（AGENTS.md：跨源路由/契约先写 ADR）
- [ ] 移动端 `npm run core:build`；真机验收（`npm run mobile:e2e`）截图传 PR comment（不入库）

**落地时的两处签名偏离**（#415 原文写的是 `searchPlaylists?(keyword, limit): Promise<DiscoverPlaylist[]>`）：① 增加 `offset`（默认 0）—— `cloudsearch/pc` **不返回 `hasMore`**，翻页终止只能由 `offset + limit < playlistCount` 推导，没有 `offset` 就没有可测的翻页语义；② 返回 `{ playlists, total, more }`（与同族 `getPlaylists` 形状逐字一致）而非裸数组 —— 否则 `more` 无处安放，消费端只能靠「不足一页 = 到底」猜。两处均已写入 ADR 的「决策」与「备选与否决」。

**out-of-scope**：歌单搜索的历史记录/联想词；多源歌单搜索（QQ/Kugou/Migu/…）；歌单广场分类列表（已有 `getPlaylists`）；歌单详情与导入播放（已有）。

---

## 附录 A. 实测命令（可直接复跑）

```bash
# ① 推荐腿：歌单搜索（匿名，复用仓库 searchSongs 同一条腿）
curl -s -X POST "https://music.163.com/api/cloudsearch/pc" \
  -H "Referer: https://music.163.com/" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "s=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1000&limit=5&offset=0"
# → {"result":{"searchQcReminder":null,"playlists":[...],"playlistCount":465},"code":200}

# ② 对照腿：明文 GET（干净态可用，密集请求后全 type 405）
curl -s "https://music.163.com/api/search/get/web?s=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1000&limit=5" \
  -H "Referer: https://music.163.com/"

# ③ 已死腿：无 Cookie 恒 50000005
curl -s "https://music.163.com/api/cloudsearch/get/web?s=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1000&limit=5" \
  -H "Referer: https://music.163.com/"     # → {"code":50000005}

# ④ 边界
curl -s -X POST "https://music.163.com/api/cloudsearch/pc" -H "Content-Type: application/x-www-form-urlencoded" \
  -d "s=x&type=1000&limit=101&offset=0"    # → {"code":400}
```

## 附录 B. 外部资料

- [NeteaseCloudMusicApiEnhanced/api-enhanced `module/search.js`](https://cdn.jsdelivr.net/gh/NeteaseCloudMusicApiEnhanced/api-enhanced@main/module/search.js) —— 活跃维护的社区实现（★1.8k，2026-09-22 仍在推送），源码注释即类型表：`1: 单曲, 10: 专辑, 100: 歌手, 1000: 歌单, 1002: 用户, 1004: MV, 1006: 歌词, 1009: 电台, 1014: 视频`，并走 `/api/search/get`。
- [同仓 `module/cloudsearch.js`](https://cdn.jsdelivr.net/gh/NeteaseCloudMusicApiEnhanced/api-enhanced@main/module/cloudsearch.js) —— `request('/api/cloudsearch/pc', { s, type, limit, offset, total: true })`，同一份类型表；佐证 `/api/cloudsearch/pc` 是社区标准明文腿。
- [同仓 `util/option.js`](https://cdn.jsdelivr.net/gh/NeteaseCloudMusicApiEnhanced/api-enhanced@main/util/option.js) / [`util/request.js`](https://cdn.jsdelivr.net/gh/NeteaseCloudMusicApiEnhanced/api-enhanced@main/util/request.js) —— `createOption` 默认 `crypto: ''`（明文，不加密）与 `cookie: process.env.NETEASE_COOKIE`；仅当无 `MUSIC_U` 时用 `anonymous_token`（MUSIC_A）兜底 → 说明**明文腿不依赖任何 cookie/token**。
- [fuzz1og/mplayer#415](https://github.com/fuzz1og/mplayer/issues/415)（本议题已开票）· [#126](https://github.com/fuzz1og/mplayer/issues/126)（网易 cloudsearch weapi 无 cookie 必 `50000005` 的既有结论）· [#407](https://github.com/fuzz1og/mplayer/issues/407)（专辑数据面多源化，同批探索来源）。
- 原版 `Binaryify/NeteaseCloudMusicApi` 仓库页最后推送 2024-02-28，`module/search.js` 经 raw/cdn 取回均 404 / fetch failed（仓库已不可用），故上述引用改指活跃 fork。

## 附录 C. 本次调研的临时文件

**无。** 全部实测在一次性 Node 进程内直接 `fetch`（含现场实现的 weapi AES+RSA 加密用于对照 `/weapi/search/get`），**未创建任何临时脚本或测试文件**，工作区无需清理。仓库中本报告外的未跟踪文件（`docs/research/2026-09-25-artist-albums-endpoint.md`、`docs/research/2026-09-25-tier3-more-sources.md`）非本次调研产物。
