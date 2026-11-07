# 网易云 DJ 电台内容契约：电台 / 节目、歌手 accountId、无收藏订阅

日期：2026-11-07 · 状态：已接受 · 关联：**#742**（本票）· 依据：[`docs/research/2026-11-07-netease-djradio.md`](../research/2026-11-07-netease-djradio.md)（2026-11-07 匿名线上实测）

## 背景

网易云 DJ 电台（djradio）是独立内容面：电台由用户/主播发布，包含节目（program）；节目的音频由 `mainSong` 承载。它与专辑/歌单的「详情 + 列表」形状相似，但身份、期号和简介字段不同。

用户的实际入口是**搜索歌手名**：搜索「邪热搜索」→ artist `12084453` → `accountId=79952226` → `/api/djradio/get/byuser` 返回 5 个电台（含 `1003897323`）。因此歌手页需要能展示「该歌手发布的电台」，而不是新增用户主页。

本决策只覆盖首版：电台详情、电台搜索、歌手页电台、保存全部到本地歌单。收藏、网易订阅、用户主页、发现页完整电台频道不在本期。

## 决策

### 1. 内容模型与身份

- 新增 `DjRadio`：`id`（字符串，源内陆），`name`、`picUrl`、`desc`、`dj`（`userId` / `nickname` / `avatarUrl` / `signature`）、`programCount`、`subCount`、`createTime`、`lastProgramCreateTime`、`lastProgramId`、`category`、`secondCategory?`、`sourceType`（必填）。
- 新增 `DjRadioProgram extends Song`：额外带 `programId`、`radioId`、`serialNum`、`createTime`、`listenerCount`、`description`、`coverUrl`。
- **播放身份和内容身份分离**：`Song.id = String(mainSong.id)`；`program.id` 只作节目身份/路由，绝不拿来解析音频（实测 `song/media/outer/url?id=<programId>` 为 404）。
- `Song` 映射：`name=program.name`，`artist=mainSong.artists 的名字或 radio.dj.nickname`，`album=radio.name`，`duration=floor(program.duration/1000)`，`cover=program.coverUrl || radio.picUrl`，`lrc=''`，`sourceType='netease'`。
- 节目简介是 `program.description`（纯文本）与 `program.programDesc`（富文本，可能为 null）；`description` 不保证等于电台 `desc`（样本 43/126 期不同）。UI 优先取 `programDesc` 文本，否则取 `description`；两者都不作为电台简介复用。
- `radio.programCount` 是上游制作计数，可能大于节目列表的 `count`（样本 133 vs 126）；页面展示可见期数用列表 `total`，不承诺 `programCount`。

### 2. 歌手与主播的关联

- `Artist` 新增可选 `accountId`（网易用户 id），由 `/api/v1/artist/{id}` 的 `artist.accountId` 填充；它只对入驻艺人有值，可能缺省。
- 歌手页的电台列表走 `getArtistRadios(accountId)`（`/api/djradio/get/byuser`）。`accountId` 缺失或结果为空时，整块隐藏，不显示空 tab / 空区块。
- **不新增用户主页**。电台页的 `dj` 只展示主播信息，不链接到用户主页；歌手页是本期唯一「按人看电台」的入口。

### 3. core 能力与 IPC

新增可选内容能力（只有网易实现）：

```ts
getDjRadioDetail?: (radioId: string) => Promise<DjRadio | null>;
getDjRadioPrograms?: (
  radioId: string,
  offset: number,
  limit: number,
  asc?: boolean,
) => Promise<{ programs: DjRadioProgram[]; total: number; more: boolean }>;
getArtistRadios?: (userId: string) => Promise<{
  radios: DjRadio[];
  total: number;
  more: boolean;
  subCount: number;
}>;
searchDjRadios?: (keyword: string, limit?: number) => Promise<DjRadio[]>;
```

- 全部登记进 `CONTENT_METHODS`，桌面 IPC 自动获得分派；移动端直接走 `getDirectClient('netease')` 或 core 门面。
- `getDjRadioDetailRouted` 返回三态联合：`{ ok: true; radio }` / `{ ok: false; reason: 'unsupported' | 'not-found' | 'failed'; message }`。`getDjRadioProgramsRouted` 沿用 `unsupported | failed`；空列表是 `ok: true`。
- 内容失败不静默：404 是「电台不存在」，406 是「操作频繁，稍后重试」，网络错误是「加载失败」；三者不能共用一屏。

### 4. 搜索与缓存

- 电台搜索只走 `POST /api/cloudsearch/pc` `type=1009`，匿名可用，但上游只返回 top 10、`offset>0` 为空；**不做分页**，桌面/移动搜索 tab 只展示首屏 10 条。旧 `/api/search/get?type=1009` 可回 30 条但有限流记录，不采用。
- 缓存键必须含源：
  - `djradio_detail_netease_<id>`，TTL 10 分钟；
  - `djradio_programs_netease_<id>_<offset>_<limit>_<asc>`，TTL 10 分钟；
  - `artist_radios_netease_<userId>`，TTL 6 小时；
  - `search_djradios_<keyword>_<limit>`，TTL 6 小时。
- 空结果不缓存；404 / 406 不缓存；同键单飞；节目列表连续请求按退避处理，不拿固定「第几发」当常量。

### 5. 页面与入口

- 桌面路由 `/djradio/:id`；移动 `app/djradio/[id].tsx`。
- 桌面详情页：Hero（封面 / 电台名 / 主播 / 分类 / 简介 / 订阅数 / 可见期数 / 最近更新）+ 节目分页列表 + 播放全部 + 下载全部 + 保存全部到本地歌单。
- 移动详情页：复用 `CollapsingHero` / `SongRow` / `setQueue/playSong`；播放全部、下载全部；保存全部若移动端尚无对应歌单写入入口，列为后续，不在本期硬造。
- 搜索入口：桌面 `DiscoverPageV2` 二级 tab 与移动搜索页各加「电台」tab；只展示 top 10，不显示无限滚动。
- 歌手页：桌面第四段 Segmented「电台」、移动专辑横滑区下方「电台」横滑区；都只在 `accountId` 存在且结果非空时渲染。
- 节目行不显示收藏按钮，也不默认显示「换源」动作；节目不是目录歌曲，跨源搜索会找错歌。

### 6. 收藏与订阅

- **本期不做收藏，也不做网易订阅。** 现有「我喜欢的音乐」是歌曲收藏语义，不能把节目塞进去；本地电台收藏需要独立 `FavoriteRadio` 存储域和「我的电台」页，另开票。
- 网易 `POST /api/djradio/sub` / `/unsub` 匿名返回 `code=301`（需要登录）；MPlayer 没有网易登录入口，不在本票引入。
- 首版的留存方式是「保存全部到新歌单」：把当前电台可见节目快照成本地歌单，复用现有歌单写入编排。

## 备选与否决

- **复用现有歌曲收藏：否决。** 会让电台节目出现在「我喜欢的音乐」，污染既有术语与页面语义。
- **新增用户主页：否决。** 用户给的场景可以经歌手搜索 + 歌手页 accountId 完整覆盖；用户主页（歌单/节目/粉丝）是另一个内容面。
- **发现页完整电台频道（推荐/热门/分类/榜单）：不在本票。** 这些接口匿名可用，但需要单独的信息架构与分页设计。
- **把 `program.id` 当 `Song.id`：否决。** 直链 404；播放身份必须是 `mainSong.id`。
- **用详情 `programCount` 渲染「共 N 期」：否决。** 样本 133 与可见 126 不一致；以列表 `count` 为准。

## 后果

- 跨端类型新增 `DjRadio` / `DjRadioProgram`；`Artist.accountId` 为可选字段，所有构造点可不填。
- 新增四个网易内容方法；IPC 清单自动扩展；不改变播放器、原生播放或 tier3。
- 节目歌词在样本中全为空（`existLyric=false`），首版不承诺歌词；按 `mainSong.id` 的现有歌词路径保留，但不做正样本承诺。
- 付费/下架电台未验证；解析不到 URL 时走既有失败归因和跳歌护栏。
