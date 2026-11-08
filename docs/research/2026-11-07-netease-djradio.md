# 网易云 DJ 电台（djradio）内容面调研

> 调研日期：2026-11-07 · 行号基线：`cf7a5c4`（#741 合并前；#741 只改音量 CSS / 测试，不影响本文引用文件）
> 样本：`https://music.163.com/#/djradio?id=1003897323`（「AI 陶喆」）
> 方法：仓库代码审读 + 当日匿名线上实测（零 Cookie / 零登录；Node 一次性 fetch + core dist 的 `createNeteaseDirectClient`）。
> 性质：社区逆向接口，非官方文档；仅用于学习研究。

## 0. 结论先行

1. **可行，且匿名可用。** 详情 `GET /api/djradio/v2/get?id=<radioId>`、节目列表 `GET /api/dj/program/byradio?radioId=<id>&limit=&offset=&asc=`、节目详情 `GET /api/dj/program/detail?id=<programId>` 均返回 `code=200`，不需要 Cookie、签名或登录。
2. **播放可以完全复用现有网易直连。** 用 `program.mainSong.id`（样本中 126/126 等于 `mainTrackId`）作为 `Song.id`；core `resolvePlayableUrl` 对最早与最新两期都返回可播 https CDN URL，音频大小与 128kbps × 时长吻合。**不能把 `program.id` 当歌曲 id**（`song/media/outer/url?id=<programId>` 返回 404）。
3. **它是「电台 + 节目」，不是「歌单 + 歌曲」。** 节目有 `serialNum`、`duration`、`createTime`、`listenerCount`、`existLyric`、`programDesc`；`description` 是单期简介的纯文本落点，但多数期沿用电台简介（样本 83/126 相同，43/126 有独立简介），不能一律当电台简介。`programDesc` 是它的富文本形态（样本 10/126 非空）。样本 126 期全部 `existLyric=false`，全部免费（`programFeeType=0`、`mainSong.fee=0`、`copyright=1`）。
4. **页面结构高度可复用。** 桌面沿用 `PageHero + SongList + playerStore`；移动沿用 `CollapsingHero/AlbumHero + SongRow + setQueue/playSong`。播放器、队列、收藏、历史、下载、加入歌单都不需要为新内容面改协议，只要把节目映射成 `Song`。
5. **真正新增的是契约与入口。** core 需要新增 `DjRadio` / `DjRadioProgram` 数据与直连方法，登记进 `CONTENT_METHODS`（IPC 自动分派）；两端各新增详情页。首版入口建议做**搜索「电台」tab（只展示 top 10）+ 直接路由**；链接导入/发现页电台 tab 可后续加。
6. **最大风险是限流与计数口径。** 节目列表快速连打会返回 `code=406`（冷却后恢复）；详情 `programCount=133`，但节目列表 `count=126`，有 7 期不可见，UI 不应直接把 133 当可见期数。付费/下架/登录态未验证。

## 1. 产品模型与样本

官方页面（非 hash 形式）`https://music.163.com/djradio?id=1003897323` 的 `<title>` 为「AI 陶喆 - 主播电台 - 网易云音乐」，说明网易把该内容面叫「主播电台」，页面由「电台 Hero + 节目列表」组成。

### 1.1 电台元数据（`/api/djradio/v2/get`）
样本关键字段：

```jsonc
{
  "id": 1003897323, "name": "AI 陶喆", "desc": "这里都是AI陶喆翻唱的歌曲…",
  "picUrl": "https://p2.music.126.net/.../109951169668455066.jpg",
  "programCount": 133, "subCount": 11625, "shareCount": 87,
  "likedCount": 0, "playCount": 0, "commentCount": 192,
  "createTime": 1713869429607, "lastProgramCreateTime": 1793794952345,
  "lastProgramId": 3731935266, "category": "创作翻唱", "secondCategory": "歌曲翻唱",
  "radioFeeType": 0, "feeScope": 0, "subed": false, "original": true, "privacy": false,
  "dj": { "userId": 79952226, "nickname": "邪热搜索",
          "avatarUrl": "http://p1.music.126.net/.../109951172476949958.jpg",
          "signature": "希望大家能喜欢！！!!" }
}
```

注意：`playCount`、`likedCount` 在样本中为 0，不能当作可信播放量；可展示的是 `subCount`、节目列表可见数、`lastProgramCreateTime`。`dj.avatarUrl` 是 http，渲染前要转 https。

### 1.2 节目（program）模型
节目列表元素的关键字段（完整对象还带 `songs`、`radio`、`mainSong` 等大对象）：

```jsonc
{
  "id": 3731935266, "name": "读心术陶第二版", // 节目 id；只用于节目详情/路由
  "serialNum": 126, "duration": 191173,       // 期号；时长（毫秒）
  "mainTrackId": 3457566808,
  "mainSong": { "id": 3457566808, "name": "读心术陶第二版", "duration": 191173,
                "fee": 0, "copyright": 1, "artists": [{ "name": "邪热搜索", "id": 0 }],
                "album": { "id": 0, "name": null } },
  "coverUrl": "https://p2.music.126.net/.../109951169668455066.jpg",
  "createTime": 1793794952345, "listenerCount": 2195, "existLyric": false,
  "programFeeType": 0, "feeScope": 0, "pubStatus": 1, "isPublish": true, "privacy": false,
  "description": "这里都是AI陶喆翻唱的歌曲…",   // 本期与电台 desc 相同；43/126 期不同
  "programDesc": null                          // 单期简介富文本；10/126 非空
}
```

实测样本统计（列表返回的 126 期；详情 `programCount=133`，另有 7 期不在匿名列表）：

| 观察 | 结果 |
|---|---|
| 节目列表 `count` | 126 |
| 详情 `programCount` | 133 |
| `serialNum` | 1..126 连续、无缺口 |
| `mainSong` 缺失 | 0 |
| `mainSong.id === mainTrackId` | 126/126 |
| `program.duration === mainSong.duration` | 126/126 |
| `mainSong` 唯一 | 126/126 |
| `existLyric=true` | 0 |
| `programFeeType=0` / `feeScope=0` | 126/126 |
| `mainSong.fee=0` / `copyright=1` | 126/126 |

`programDesc` 是单期简介的富文本数组（如 `[{type:1, content:"..."}]`），列表里通常为 `null`（样本 10/126 非空）；`description` 是同一段简介的纯文本落点，不能假定它等于电台 `desc`（样本 83/126 相同、43/126 不同）。UI 应优先取 `programDesc` 的文本，其次取 `description`；当 `description` 与电台 `desc` 相同视为本期未单独填写简介，不要重复展示电台简介。

### 1.3 排序与分页

- 默认（不传 `asc` 或 `asc=false`）：按 `serialNum` **降序**（最新在前）；`asc=true`：升序（最早在前）。
- 实测 `limit=5&offset=0` 默认返回 126..122；`asc=true` 返回 1..5。
- `limit=100&offset=0` 返回 100 条，`more=true`；`limit=30&offset=100` 返回 26 条，`more=false`；`limit=200&offset=0` 一次返回 126 条、`more=false`（响应 736KB）。
- 页面大小建议 20–30（移动）或 30–50（桌面）；单页 100 条响应约 586KB，没必要一次拉满。
- `radioId=999999999` 时列表返回 `{"code":200,"count":0,"programs":[],"more":false}`；不存在的电台应先由详情接口判 404，不要把「列表空」直接当网络失败。

### 1.4 歌手页电台（2026-11-07 补测）

`GET /api/v1/artist/{id}` 会返回 `artist.accountId`（网易用户 id；只对入驻艺人有值，普通歌手可能缺省）。用这个 id 调：

```http
POST https://music.163.com/api/djradio/get/byuser
content-type: application/x-www-form-urlencoded

userId=79952226
```

匿名返回 `code=200`、`count`、`subCount`、`hasMore` 和电台数组；`limit` 实测被忽略，`offset` 可跳过前缀（样本 5 个电台）。真实链路：

```text
搜索歌手名「邪热搜索」
  → cloudsearch/pc type=100 → artist 12084453
  → /api/v1/artist/12084453 → accountId 79952226
  → /api/djradio/get/byuser → 5 个电台（含 AI 陶喆 1003897323）
```

因此「歌手页电台」不需要新增用户主页：歌手页拿到 `accountId` 后追加一块电台列表即可。`accountId` 缺失或返回 0 个电台时整块隐藏。样本陶喆（artist 5196 / accountId 1104594）返回 1 个电台；周杰伦/林俊杰/陈奕迅在匿名 `/api/v1/artist/{id}` 中没有 `accountId`，应隐藏。

## 2. 接口实测矩阵（2026-11-07，匿名零 Cookie）

| 能力 | 端点 | 实测 | 备注 |
|---|---|---|---|
| 电台详情 | `GET /api/djradio/v2/get?id=1003897323` | `code=200`，1.9KB | 推荐；参数名是 `id`，不是 `radioId` |
| 电台详情（旧） | `GET /api/djradio/get?id=1003897323` | `code=200`，`djRadio` 对象 | 可作兜底；参数同样是 `id` |
| 不存在 | `GET /api/djradio/v2/get?id=999999999` | `code=404, msg="radio not exist", data=null` | HTTP 仍 200，必须看 body.code |
| 节目列表 | `GET /api/dj/program/byradio?radioId=1003897323&limit=5&offset=0` | `code=200`，`count=126`, `more=true` | 参数名是 `radioId`；limit=3/100/200 均正常 |
| 节目升序 | 同上 + `asc=true` | `code=200`，serial 1..5 | 默认降序 |
| 节目分页 | `limit=30&offset=100` | `code=200`，26 条，`more=false` | 连续快速请求会 406 |
| 节目详情 | `GET /api/dj/program/detail?id=3731935266` | `code=200`，`program` 对象 | 与列表项同形；只有单期深链需要，列表页可省 |
| 节目不存在 | `GET /api/dj/program/detail?id=1` | `code=404` | 只有 code，没有 message |
| 电台搜索 | `POST /api/cloudsearch/pc`，form `s=AI 陶喆&type=1009&limit=5&offset=0` | `code=200`，`result.djRadiosCount=10`，10 条结果 | limit=3/5/30 均只回 10 条，offset>0 空 → **只能 top 10、无分页**；旧 `/api/search/get?type=1009` 回 30 条但同样不能翻页，且有限流记录 |
| 精选电台（可选） | `GET /api/djradio/recommend/v1` | `code=200`，返回电台数组 | 匿名可用；发现页入口可后置 |
| 热门电台（可选） | `GET /api/djradio/hot/v1?limit=5&offset=0` | `code=200`，返回电台数组 + `hasMore` | 匿名可用；独立复核 category/toplist 等发现端也可用 |

上述端点 GET 与普通 POST form 均可，不需要 weapi；请求头只需要浏览器特征（实际实测使用）：

```http
User-Agent: Mozilla/5.0 ... Chrome/131.0.0.0 Safari/537.36
Referer: https://music.163.com/
```

**错误语义**：这些接口 HTTP 常是 200，错误只在 body 的 `code`。`code=406` 是限流（`操作频繁`），不是「没有节目」；`code=400` 是参数错误；`code=404` 是实体不存在。实现必须把 406/404/空结果分开。

**限流实测**：连续无间隔请求节目列表时，`limit=100&offset=100`、`limit=20&offset=120` 曾返回 `code=406`；同一 burst 里 `limit=200` 也曾 406，但单独复核 `limit=200` 正常返回 126，说明 406 是限流不是上限。等待后恢复 200。不要引用固定「第几发触发」，按退避 + 缓存 + 单飞处理。

搜索响应里的电台数组字段与详情基本同形，含 `id/name/picUrl/desc/dj/programCount/subCount/category/radioFeeType` 等；`picUrl` 为 http，需转 https。

## 3. 播放与歌词

### 3.1 播放 URL

用仓库自己的 `createNeteaseDirectClient().resolvePlayableUrl()` 实测（core dist，匿名）：

| 节目 | `mainSong.id` | 结果 |
|---|---|---|
| serial 126（最新） | `3457566808` | 返回 https CDN URL，`br=128000`，`size=3,059,923` |
| serial 1（最早） | `2148819020` | 返回 https CDN URL，`br=128000`，`size=3,631,691` |

按 128kbps 计算，3,059,923 bytes ≈ 191.2s，3,631,691 bytes ≈ 227.0s，分别对应节目时长 191.173s / 226.925s，说明拿到的是完整音频，不是短试听片段。

另外 `GET https://music.163.com/song/media/outer/url?id=<mainSongId>.mp3` 对最新一期返回 302 到 CDN mp3；用 `program.id` 请求则 302 到 `/404`。因此 **`Song.id` 必须取 `mainSong.id`（= `mainTrackId`）**。

`resolveUrlInfo` 的 `playTime` 在这两期返回 0；`isNonFullDirect` 的 `classifyLength(0, duration)` 是 `unknown`，不会因此误判试听版。`size/br` 未参与该判定。现有播放链不需要改。

### 3.2 歌词

`GET /api/song/lyric?id=3457566808&lv=1&kv=1&tv=-1` 返回 `code=200`、`lrc.lyric=""`（130B）。样本 126 期 `existLyric` 全为 false；另测电台 1 的前 100 期也全为 false，**没有找到 `existLyric=true` 的正样本**。因此「有歌词的节目」未验证；按现有 `getNeteaseLyrics(mainSong.id)` 的按 id 取词路径应当可用，但实现后要另找正样本验真。样本上列表直接给 `lrc=''` 即可，取词由现有歌词预取按需触发（空词会被缓存，不会重复请求）。

### 3.3 映射到现有 `Song`

建议在 core 里做一次映射，页面和队列只消费 `Song`：

```ts
{
  id: String(mainSong.id),          // 不是 program.id
  name: program.name || mainSong.name,
  artist: (mainSong.artists || []).map(a => a.name).filter(Boolean).join(' / ')
          || radio.dj.nickname,
  album: radio.name,                // 语义见下方取舍
  duration: Math.floor((program.duration ?? mainSong.duration) / 1000),
  sourceType: 'netease',
  url: '',
  cover: program.coverUrl || radio.picUrl,
  lrc: '',
}
```

取舍：`mainSong.artists[0].id` 与 `mainSong.album.id` 在样本中都是 0，不能拿来做歌手/专辑跳转；`album` 用电台名是「内容上下文」，不是真实专辑。若担心污染收藏/历史里的专辑字段，可改为空串并在电台页隐藏专辑列；两种都可行，但需要 ADR 明确，不能各页面各自决定。

## 4. 与现有内容面的复用点

| 层 | 现有实现 | 电台可复用 / 需新增 |
|---|---|---|
| core 类型 | `Song`（`packages/core/src/types/index.ts:40`）、`Album`（`:140`）、`DiscoverPlaylist`（`:124`） | 新增 `DjRadio` / `DjRadioProgram`；节目映射成 `Song` 后队列/收藏/下载不改 |
| core 客户端 | `DirectSourceClient`（`packages/core/src/shared/sourceRouter.ts:216`）、`CONTENT_METHODS`（`:293`） | 新增 `getDjRadioDetail` / `getDjRadioPrograms` / `getDjRadioProgram` / `searchDjRadios`；只有网易实现 |
| IPC | `src/main/ipc/musicApiHandlers.ts:49` 按 `CONTENT_METHODS` 循环分派 | 只要接口加方法 + 清单登记，IPC 自动获得；`MusicApiMethodMap` 随契约派生 |
| 桌面详情 | `AlbumDetailPage.tsx:122` PageHero + `:188` SongList；`DiscoverPlaylistDetailPage.tsx:207` PageHero + 分页 | Hero/播放全部/批量下载/加入歌单可复用；节目序号需要自定义行或给 SongRow 加 `indexLabel` |
| 桌面搜索 | `DiscoverPageV2.tsx:56` TABS（榜单/专辑/歌单/歌手），`:435` 歌单搜索 | 加「电台」tab，走 `searchDjRadios`，懒加载 |
| 移动详情 | `app/album/[id].tsx:96` AlbumHero；`app/discover-playlist/[id].tsx:199` CollapsingHero；`AlbumHero.tsx:110` | 新建 `app/djradio/[id].tsx`，复用 CollapsingHero/SongRow 与 `setQueue/playSong` |
| 移动搜索 | `app/(tabs)/search.tsx:34` SEARCH_TABS | 加「电台」tab，和现有歌单 tab 同一懒加载/seq 守卫模式 |
| 歌手页电台 | `ArtistDetailPage` 现有 Segmented / `ArtistDetailPage` 移动版专辑区 | 新增「电台」tab / 横滑区；`Artist.accountId` 存在且结果非空才显示 |
| 链接导入 | `packages/core/src/api/playlistImport.ts:21` 只解析 `/playlist` | 可另加 `djradio` 链接解析；不要混进「歌单导入」语义 |

**建议的最小数据契约**（字段级）：

```ts
export interface DjRadio {
  id: number; name: string; picUrl: string; desc: string;
  dj: { userId: number; nickname: string; avatarUrl: string; signature?: string };
  programCount: number; subCount: number; createTime: number;
  lastProgramCreateTime: number; lastProgramId: number;
  category: string; secondCategory?: string;
  radioFeeType: number; feeScope: number; sourceType: 'netease';
}
export interface DjRadioProgram extends Song {
  programId: string; // 节目 id，用于路由；Song.id 仍是 mainSong.id
  radioId: number; serialNum: number; createTime: number;
  listenerCount: number; existLyric: boolean; programDescription?: string;
}
export interface DjRadioDetail {
  radio: DjRadio; programs: DjRadioProgram[];
  total: number; // 节目列表 count，样本 126；不要用 radio.programCount=133
  more: boolean;
}
```

`DjRadioProgram extends Song` 的好处：桌面 `SongList` / 移动 `SongRow` / `playerStore.setQueue` 可以直接吃；额外字段只用于渲染期号/日期/节目链接，不影响播放。坏处：收藏/历史持久化的是 `SongBase`，重新打开时节目扩展字段会丢失；首版可接受。

身份与缓存：电台和专辑一样是**源内实体**，身份 = `源 + 源内 id`；缓存键必须含源（`djradio_detail_netease_<id>`、`djradio_programs_netease_<id>_<offset>_<limit>_<asc>`），空结果不缓存、406 不缓存、同键单飞。失败返回建议沿用专辑的三态联合：`unsupported | not-found | failed`（详情 404 单独归 `not-found`，不能和网络失败共用一屏）。

**UI 差异（需要明确设计）**：
- `SongRow` 的序号列当前显示 `index + 1`（`src/renderer/components/SongRow.tsx:182`）；默认最新在前时 index 1 对应的是期号 126，不是期号 1。建议给行加 `indexLabel`/`serial` 插槽，或电台页用专用 ProgramRow。
- 节目单期简介优先取 `programDesc` 的富文本；为空时取 `description`，但 `description === radio.desc` 视为本期未单独填写简介，不要重复展示电台简介。
- 电台页要显示「订阅数 / 可见期数 / 最近更新」；`playCount`、`likedCount` 不可靠，不要展示。
- 节目音频是网易上传的翻唱/播客，不是目录歌曲；建议在电台页隐藏「换源」（`Song.artist` 是上传者，跨源搜索会找错歌）。
- 「播放全部」要决定：只播已加载页，还是先拉全 126 期再建队列。126 期全量列表约 740KB，建议按需分页；播放全部可串行拉全量（带缓存/退避），避免队列只剩第一页。

## 5. 入口与双端影响

**路由**：桌面 `/#/djradio/:id`（`src/renderer/router/index.tsx` 加 lazy 页）；移动 `app/djradio/[id].tsx`。路由 state 可带 name/pic/dj 作首屏兜底，详情返回后覆盖（与 AlbumDetailPage 同模式）。

**入口优先级**：

1. **歌手搜索名链路**（用户主路径）：搜索歌手名 → 歌手页 → 歌手页「电台」tab / 横滑区 → 电台详情；`accountId` 是这条链路的桥。
2. **搜索「电台」tab**（辅助入口）：桌面 `DiscoverPageV2` 的二级 tab + 移动搜索页 `SEARCH_TABS`；`POST /api/cloudsearch/pc type=1009` 匿名可用，结果数组直接进新页面。搜索响应 10 条约 17KB，成本可控。
3. **链接打开/导入**：用户给的就是 `music.163.com/#/djradio?id=...`；可扩展 `parsePlaylistUrl` 的兄弟函数 `parseDjRadioUrl`，但不要把它归到「导入歌单」，否则语义会坏。
4. **发现页热门/精选电台**：`/api/djradio/recommend/v1`、`/api/djradio/hot/v1` 已实测匿名可用；作为独立发现面后置，避免首版铺太大。

**范围边界（用户后续修订）**：首版 = 电台详情页 + 搜索电台入口（top 10）+ 歌手页电台（仅 `accountId` 入驻艺人）+ 直接路由 `/djradio/:id` + 保存全部到新歌单；节目行复用歌曲收藏，不做网易订阅、不做用户主页、不做发现页完整电台频道。

**双端影响**：
- core：新增类型/方法/缓存；播放器、原生播放、tier3 都不改。
- 桌面：新页面 + 路由 + 搜索 tab；复用 PageHero/SongList/playerStore。
- 移动：新页面 + 路由 + 搜索 tab；复用 CollapsingHero/SongRow/setQueue/playSong；Android 原生播放器不感知内容面。
- 服务端：无 MPlayer 自建 API；全部官方直连。

## 6. 风险与未验证

1. **限流（已实测）**：节目列表连续快速请求出现 `code=406`，冷却后恢复；`limit=200` 单独复核正常返回 126 条，406 不是 limit 上限。本次没有做「节目腿被限时搜索腿是否仍可用」的并发对照，**两条腿的额度是否共享未验证**。必须做 30/50 分页、同键单飞、详情/列表缓存和退避；不要把 406 当空列表。
2. **计数口径（已实测）**：`programCount=133` vs 列表 `count=126`；7 期在匿名列表不可见，原因未知（下架/审核/定时/隐私均未证实）。UI 用列表 `total`，不要用详情 `programCount` 承诺「共 133 期」。
3. **付费/下架（未验证）**：样本全部免费；付费电台/单集的 `radioFeeType`、`feeScope`、`programFeeType`、`buyed`、`authDTO` 行为未测。解析不到 URL 时走现有失败归因/跳歌护栏，不新增猜测。
4. **歌词（未验证正样本）**：样本 126 期与另一电台前 100 期都 `existLyric=false`；按 id 的歌词路径有正样本前不能宣称「节目歌词可用」。
5. **`programDesc` / `description`（已实测）**：`programDesc` 是富文本数组（样本 10/126 非空），列表通常为 null；`description` 是纯文本，但 43/126 期与电台 `desc` 不同，不能一律当电台简介。两者都要归一，不能直接当 string 渲染。
6. **`playCount`/`likedCount`（已实测异常）**：样本电台 GET/POST 均为 `playCount=0`、`likedCount=0`（独立复核提到的 509 未在样本响应出现），不能当真实热度。
7. **非官方接口**：随时可能变；单测全部走 transport 注入、零真实网络（参照 `neteaseContent.test.ts` / `neteasePlaylistSearch.test.ts`）。
8. **链接解析**：`parsePlaylistUrl` 只认 `/playlist`，新增 `djradio` 要独立解析；`music.163.com/#/djradio?id=` 的 hash 路由必须自己解析 `id`。
9. **mainSong 潜在重复**：样本 126 期 mainSong id 唯一；一般电台未保证，列表 key / 队列去重要用 `programId` 或 index 兜底，不能假设一号一期。
10. **收藏/订阅（已确认不做）**：`POST /api/djradio/sub` 匿名返回 `code=301`（需要登录）；现有「我喜欢的音乐」只存歌曲；本地电台收藏需要独立存储域和「我的电台」页，另开票。
11. **歌手页 accountId（已实测）**：只有入驻艺人返回 `accountId`；不要把 artist id 当 userId 调 `get/byuser`（5196 返回 0 个电台）。无 `accountId` 时隐藏电台区块，不做按名字兜底搜索。

## 7. 建议的后续票拆分

| 票 | 范围 | 验收标准 | 依赖 |
|---|---|---|---|
| 母票 #742 | 网易云 DJ 电台内容面 | 能搜索歌手名/电台、从歌手页进入电台，看到 Hero + 节目分页；播放全部走现有队列；双端一致 | — |
| core 契约 | `DjRadio`/`DjRadioProgram`、详情/节目分页/按用户取电台/搜索、`Artist.accountId`、缓存/单飞/错误语义 | 零网络单测覆盖字段映射、`program.id` vs `mainSong.id`、`programCount` vs `count`、404/406、分页 | 母票 |
| 桌面页 | `/djradio/:id`、Hero、节目行、分页、播放全部、下载全部、保存全部到新歌单 | 真实 Electron 点进样本电台，播放第 1/126 期；保存全部可用 | core |
| 桌面入口 | 搜索「电台」tab + 歌手页「电台」tab | 搜索「邪热搜索」→ 歌手页 → AI 陶喆；搜索「AI 陶喆」电台能进详情 | core |
| 移动页 | `app/djradio/[id].tsx`、CollapsingHero、播放全部/下载 | 真机进入样本电台，播放并切后台/锁屏；队列正确 | core |
| 移动入口 | 搜索「电台」tab + 歌手页电台横滑区 | 真机走歌手名链路进入样本电台 | core |
| ADR | 跨端契约：`Song` 映射、`accountId`、计数/排序/失败语义、复用歌曲收藏 | ADR 接受并进 `docs/adr/README.md`；GLOSSARY 更新 | 母票 |

## 8. 参考来源

- 官方页面：`https://music.163.com/djradio?id=1003897323`（title「AI 陶喆 - 主播电台 - 网易云音乐」）。
- 本次实测端点：`/api/djradio/v2/get`、`/api/djradio/get`、`/api/dj/program/byradio`、`/api/dj/program/detail`、`/api/cloudsearch/pc`（type=1009）、`/api/djradio/recommend/v1`、`/api/djradio/hot/v1`。
- 社区实现（端点形状对照）：[`module/dj_detail.js`](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/module/dj_detail.js)、[`dj_program.js`](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/module/dj_program.js)、[`dj_program_detail.js`](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/module/dj_program_detail.js)、[`dj_radio_hot.js`](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/module/dj_radio_hot.js)、[`dj_recommend.js`](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/module/dj_recommend.js)。
- 仓库：`packages/core/src/api/neteaseDirect.ts`、`packages/core/src/shared/sourceRouter.ts`、`packages/core/src/types/index.ts`、`src/main/ipc/musicApiHandlers.ts`、`src/renderer/pages/AlbumDetailPage.tsx`、`src/renderer/pages/DiscoverPlaylistDetailPage.tsx`、`src/renderer/pages/DiscoverPageV2.tsx`、`packages/mobile/app/album/[id].tsx`、`packages/mobile/app/discover-playlist/[id].tsx`、`packages/mobile/components/AlbumHero.tsx`、`packages/mobile/app/(tabs)/search.tsx`、`packages/core/src/api/playlistImport.ts`。
- 既有同类调研：`docs/research/2026-09-25-netease-playlist-search.md`；既有内容契约：`docs/adr/2026-09-27-album-and-artist-content-contract.md`。
