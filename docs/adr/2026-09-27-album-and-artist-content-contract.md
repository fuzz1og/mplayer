# 专辑与歌手内容契约：source 贯通、缓存键含源、可区分失败语义

日期：2026-09-27 · 状态：已接受 · 关联：**#407**（专辑数据面多源化 P0）、**#406**（移动端专辑页 UI）、**#417**（歌手页数据不全）·
依据：本 PR 实现期于 2026-09-27 对网易匿名端点做过一次实测（下文的「实测」均为该次结果）

## 背景

专辑/歌手这条内容面有四处**独立**的成因，堆在同一屏上：

1. **类型承载不了元数据，也没有源归属。** `Album` 只有
   `{ id, name, picUrl, artist, publishTime }` 五个字段，**没有 `sourceType`**；而
   `Artist` 有，且是宽松的 `string`。上游同响应里的公司/简介/子类型/曲目数在
   `normalizeNeteaseAlbum` 里被直接丢弃。
2. **缓存键不含源。** 详情腿的键是 `album_detail_${albumId}`。同一数字 id 在不同源语义
   完全不同，多源后必然串键——这是**埋雷**，不是当前可复现路径（今天 4 个入口全部来自网易）。
3. **失败与「真的没有」不可区分。** 页面用
   `getDirectClient('netease')!.getAlbumDetail!(id)`（双重断言）：无客户端、无能力、返回
   `null` 三种情况静默降级成同一屏「路由参数 + 暂无歌曲」；`getArtistAlbums` 的 catch
   也直接 `return { albums: [], total: 0, more: false }`。
4. **翻页与歌手身份都用了错的东西。** `getArtistAlbums` 直接透传上游 `total`，而
   `more=true` 时它被 `limit` 截断、甚至**直接缺失**（实测
   `GET /api/artist/albums/5196?offset=0&limit=3` 的响应体里没有 `total` 字段，
   `hotAlbums` 只有 3 条）→ 桌面头部显示偏小的「共 N 张专辑」；移动端硬编码
   `getArtistAlbums(id, 0, 20)`，陶喆实测 31 张只看到最新 20 张。
   歌手页还用 `searchArtists(名字, 1)` 取第一条拿头像/名字，网易存在同名多实体
   （「陶喆」有 `5196` 与 `31213543`），从其中一个进去会显示另一个的名字/头像。

实测补充（决定了兜底腿怎么写）：

| 端点 | 实测 | 用途 |
|---|---|---|
| `POST /weapi/v1/album/{id}` | 加密腿，主路径 | 详情（主） |
| `GET /api/v1/album/{id}` | **code=200**，匿名可用，同响应含 `company/description/subType/size/songs[].no` | **明文兜底腿** |
| `GET /api/album/{id}` | **code=-462**（风控） | **不可用**（旧文档若按它写会误判成签名问题） |
| `GET /api/v1/artist/{id}` | **code=200**，`artist.albumSize=31`（权威） | 歌手信息按 id 校正 |
| `GET /api/artist?id={id}` | **code=404（死链，对照请求正常）** | 旧实现用的就是它 → `getArtistDetail.artist` 恒 null |
| `GET /api/artist/albums/{id}` | **code=200**，与 weapi 同数据同 `more` | 专辑列表明文兜底腿 |

另外，`CONTENT_METHODS` 的 `as const satisfies readonly (keyof DirectSourceClient)[]` **只校验子集**：
清单里写了接口没有的名字会编译报错，但**接口加了方法漏登记清单不报错**，该方法会静默不进桌面 IPC。

## 决策

1. **`Album` 加 `sourceType: SourceKey`（必填）**，并加可选元数据
   `artistId / company / description / genre / language / trackCount / subType`；
   消费方一律「有则渲染、无则省略」，不做按源分支的组件（同 `RankMeta` 取向）。
   `Artist.sourceType` 由 `string` 收紧为 `SourceKey`；抽具名 `AlbumDetail = { album; songs }`。
2. **发行时间统一为 epoch ms 字符串**（新 `utils/publishTime`，`''` = 源未提供）。
   各源原始格式互不相同（网易毫秒数字 / QQ `2026-07-26` / 酷狗 `2026-07-04 00:00:00` /
   千千 `releaseDate`），消费方一律 `new Date(Number(publishTime))` 取年份——
   `Number('2026-07-26')` 是 NaN，所以原始串不能透传。日期串按 **UTC 零点** 解析（发行日期是
   「日」粒度的日历事实，按本地时区解析会随设备时区漂移一天）。
3. **内容腿缓存键一律含源**（`album_detail_netease_${id}`）；空结果不缓存的既有语义保留。
4. **失败语义可区分。**
   - `getAlbumDetailRouted(source, albumId)` 返回判别联合
     `{ ok: true; album; songs } | { ok: false; reason: 'unsupported' | 'failed'; message }`；
   - `getArtistAlbums` 的返回增 `ok: boolean`，并把 `total` 改为 `number | null`：
     `more=false` 时是精确值 `offset + albums.length`，`more=true` 时为 `null`（未知）。
   > 为什么这条腿返回联合而 `getToplistSongs` 抛错：榜单没有 UI 三态需求，专辑页要**按失败
   > 原因选文案**（「该来源暂不支持专辑详情」vs「加载失败，重试」），抛错只能靠字符串匹配。
5. **新增按 id 的歌手信息能力** `getArtistInfo?(artistId)` + `getArtistInfoRouted`；
   歌手页不再调用 `searchArtists`。网易实现走 `GET /api/v1/artist/{id}`（同时修掉
   `fetchArtistInfo` 的死链，`getArtistDetail.artist` 不再恒为 `null`）。
6. **翻页只以 `more` 为准**；页大小默认 100（社区口径），core 自控上限 1000
   （实测 `limit >= 2000` → `code=-460`）。
7. **明文兜底腿**按上表接；`/api/album/{id}` 明确不用。
8. **`CONTENT_METHODS` 补反向断言** `ContentMethodCoverage`（`Exclude<keyof
   DirectSourceClient, ContentMethod | BasicCapability>` 必须为 `never`），把「接口加了方法
   漏登记清单」变成编译期错误。新增非内容的基础能力时把名字加进 `BasicCapability`。

## 备选与否决

- **用上游 `total` 渲染「共 N 张专辑」**：否决。`more=true` 时它被截断、甚至整个字段缺失
  （实测 `limit=3` 的响应里没有 `total`），拿它渲染必然偏小——那正是 #417 ③ 的成因。
  改为「未翻完显示『已加载 N 张』、翻完显示精确总数」。
- **给 `Song` 增加曲目序号字段（用上游 `songs[].no`）**：否决。`no` 确实存在（实测
  `songs[0].no = 1`），但同一语义不该有两个来源；沿用「由数组索引推导」，页面把 index 交给
  `SongRow` 的 `rank`（#407 §5 的既定口径）。
- **改用 `getArtistDetail` 一次拿 artist + hotSongs + albums 修歌手页**：否决。它内部固定
  `getArtistAlbums(artistId, 0, 30)` 且不透出 `more`，会和专辑分区的分页腿重复请求；
  按 id 的独立信息腿更省也更准。
- **把 `getAlbumDetailRouted` 做成抛错（对齐 `getToplistSongs`）**：否决，理由见决策 4。
- **#407 方案 7 的「按专辑名 + 歌手走各源 searchSongs 严格匹配补曲目」**：本轮不做。当前只有
  网易实现专辑详情，`unsupported` 分支在真实链路上**不可达**；且该兜底需要签名带上专辑名与
  歌手（现在只有 id）。等逐源专辑腿（P1+）落地时一并实现。
- **逐源专辑详情（千千/咪咕/QQ/酷狗/酷我/汽水）**：不在本决策范围。六源端点全部标着「待验证」、
  需逐个抓包，属独立工作量与独立失败模式。
- **面内源切换 UI**（发现页三面把 `'netease'` 改成可切源）：不在本决策范围，属 #327 判定的
  1.9.0 新 UI。本决策只做**契约层的 source 贯通**。

## 后果

- **跨端契约变更**：`Album.sourceType` 必填——所有构造点必须给出源；核心/桌面/移动端共享同一
  类型。列表结果里的专辑元数据字段**可能缺失**（有则渲染）。
- **桌面「共 N 张专辑」的语义变化**：未翻完时显示「已加载 N 张」，翻完后显示精确「共 N 张
  专辑」。旧行为（显示被 `limit` 截断的偏小数字）不再存在。
- **`getArtistAlbums` 的失败不再静默**：双端必须处理 `ok === false`（桌面走既有
  `albumsError` + 重试；移动端走「加载失败，点此重试」），否则失败会退化成空态。
- **`getArtistDetail.artist` 不再恒为 `null`**（死链已换）；但它仍只有网易实现。
- **本 PR 未解决 / 仍挂着的**：
  - 逐源专辑详情与 `Album` 元数据的非网易填充；
  - 方案 7 的搜索兜底；
  - `publishTime` 归一目前只在网易腿接入，其余源实现时复用同一 helper；
  - `Artist.albumSize` 各源口径不一（网易 `/api/v1/artist` 权威，专辑对象内嵌的会偏小：
    实测 30 vs 31），本轮不统一。
