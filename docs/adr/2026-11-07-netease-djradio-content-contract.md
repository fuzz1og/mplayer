# 网易云 DJ 电台内容契约：电台 / 节目、歌手 accountId、复用歌曲收藏

日期：2026-11-07 · 状态：**已接受（#743 已于 2026-11-08 合入 master）** · 关联：**#742**（本票）· **#743**（实现 PR）· 依据：[`docs/research/2026-11-07-netease-djradio.md`](../research/2026-11-07-netease-djradio.md)（2026-11-07 匿名线上实测；文末有实现后差异）

## 背景

网易云 DJ 电台（djradio）是独立内容面：电台由用户/主播发布，包含节目（program）；节目的音频由 `mainSong` 承载。它与专辑/歌单的「详情 + 列表」形状相似，但身份、期号和简介字段不同。

用户的实际入口是**搜索歌手名**：搜索「邪热搜索」→ artist `12084453` → `accountId=79952226` → `/api/djradio/get/byuser` 返回 5 个电台（含 `1003897323`）。因此歌手页需要能展示「该歌手发布的电台」，而不是新增用户主页。

本决策只覆盖首版：电台详情、电台搜索、歌手页电台、节目播放/下载/收藏与保存全部到本地歌单。网易订阅、用户主页、发现页完整电台频道仍为后续；节目复用现有歌曲收藏。

## 决策

### 1. 内容模型与身份

- 新增 `DjRadio`：`id`（字符串，源内陆），`name`、`picUrl`、`desc`、`dj`（`userId` / `nickname` / `avatarUrl` / `signature`）、`programCount`、`subCount`、`createTime`、`lastProgramCreateTime`、`lastProgramId`、`category`、`secondCategory?`、`sourceType`（必填）。
- 新增 `DjRadioProgram extends Song`：额外带 `programId`、`radioId`、`serialNum`、`createTime`、`listenerCount`、`description`、`coverUrl`。
- **播放身份和内容身份分离**：`Song.id = String(mainSong.id)`；`program.id` 只作节目身份/路由，绝不拿来解析音频（实测 `song/media/outer/url?id=<programId>` 为 404）。
- `Song` 映射：`name=program.name`，`artist=mainSong.artists 的名字或 radio.dj.nickname`，`album=radio.name`，`duration=floor(program.duration/1000)`，`cover=program.coverUrl || radio.picUrl`，`lrc=''`，`sourceType='netease'`。
- 节目简介是 `program.description`（纯文本）与 `program.programDesc`（富文本，可能为 null）；`description` 不保证等于电台 `desc`（样本 43/126 期不同）。core `neteaseDirect` 归一为 `DjRadioProgram.description`：优先取 `programDesc` 文本，否则取 `description`，等于电台 `desc` 时留空，避免重复展示电台简介；两端行级说明只取该字段。
- `radio.programCount` 是上游制作计数，可能大于节目列表的 `count`（样本 133 vs 126）；页面展示可见期数用列表 `total`，不承诺 `programCount`。卡片只展示主播，不展示制作计数。

### 2. 歌手与主播的关联

- `Artist` 新增可选 `accountId`（网易用户 id），由 `/api/v1/artist/{id}` 的 `artist.accountId` 填充；它只对入驻艺人有值，可能缺省。
- 歌手页的电台列表走 `getArtistRadios(accountId)`（`/api/djradio/get/byuser`）。`accountId` 缺失或结果为空时，整块隐藏，不显示空 tab / 空区块。
- **不新增用户主页**。电台页的 `dj` 只展示主播信息，不链接到用户主页；歌手页是本期唯一「按人看电台」的入口。

### 3. core 能力与 IPC

新增可选内容能力（只有网易实现；全部已登记进 core `CONTENT_METHODS`，桌面 `musicApi:call` 按清单分派，移动经 core 门面或直接客户端消费）：

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

- 四个内容方法已登记进 `CONTENT_METHODS`；桌面 IPC 完整性测试与接线守卫钉住分发表，移动端直接走 `getDirectClient('netease')` 或 core 门面。
- 三态门面 `getDjRadioDetailRouted` / `getDjRadioProgramsRouted` / `getArtistRadiosRouted` 已登记进 `src/shared/musicApiContract.ts` 的 `BASE_METHODS`，桌面 `musicApiHandlers` 手写表逐项转发到 core `musicApi`，因此桌面详情页经单通道拿到同一份联合结果；节目 406/网络/unsupported 同样保留 `reason` 与 `message`。不存在桌面详情页 `callMusicApi('getDjRadioDetail')` 直调。
- 内容失败不静默：404 是「电台不存在」，406 是「操作频繁，稍后重试」，网络错误是「加载失败」，`unsupported` 是「源不支持」；四者不能共用一屏。
- 搜索 405/406 的归因、文案与 djradio body.code 收口到 core `api/djRadioErrors.ts`；`describeDjRadioFailure` 是双端 404/406/网络/unsupported 分屏文案的单一落点，搜索腿用 `describeDjRadioSearchFailure` 区分限流、源不支持与网络失败。节目腿只对 406 做最多两次指数退避（120ms / 240ms），不改全局 transport 的 5xx 语义；分页与全量拉取保持串行并有 60ms 间隔。
- 双端 `api/djRadioPrograms.ts` 的 `fetchAllDjRadioPrograms` 按 `limit=200` 串行收齐列表可见节目后才建队列或批量写入：桌面「播放全部 / 下载全部 / 保存全部」共用，移动「播放全部 / 下载全部」共用；全量失败不建半截队列，期间禁用重复点击并给可读失败提示。移动端「保存全部」因缺少对应歌单写入入口仍为后续。

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
- 桌面详情页：Hero（封面 / 电台名 / 主播 / 分类 / 简介 / 订阅数 / 可见期数 / 最近更新）+ 节目分页列表 + 播放全部 + 下载全部 + 保存全部到本地歌单。Hero 的可见期数只来自列表 `total`；详情与节目失败分别保留 `reason/message` 并分屏展示。
- 移动详情页：复用 `CollapsingHero` / `SongRow` / `setQueue/playSong`；播放全部、下载全部；详情与节目失败分别保留 `reason/message` 并分屏展示。保存全部因移动端尚无对应歌单写入入口，列为后续，不在本期硬造。
- 搜索入口：桌面 `DiscoverPageV2` 二级 tab 与移动搜索页各加「电台」tab；只展示 top 10，不显示无限滚动。
- 歌手页：桌面第四段 Segmented「电台」、移动专辑横滑区下方「电台」横滑区；都只在 `accountId` 存在且结果非空时渲染。
- 节目行复用普通歌曲行的收藏入口（资料库密度下是「更多 → 收藏/取消收藏」），收藏写入「我喜欢的音乐」；播放条收藏沿用现有歌曲语义。节目不是目录歌曲，跨源搜索会找错歌，故双端电台页都传 `hideSwap` 收掉「换源完整版」。
- 桌面 SongList 的电台行以 `programId` 为 React key，并把单期简介作为行 `title` 暴露；移动 `CollapsingHero` 也以 `programId` 为 key，`SongRow` 把单期简介并入 `accessibilityLabel`。节目 `description` 是单期简介，不把电台 `desc` 当单期简介复用。保存全部时 `radio.desc` 只作新歌单简介。

### 6. 收藏与订阅

- **本期已复用现有歌曲收藏，不做网易订阅。** 用户已明确：电台是内容面，节目又映射为 `Song`（`Song.id = mainSong.id`），收藏也应按歌曲身份进入「我喜欢的音乐」，不能把内容面从普通歌曲行里摘出去。因此不新增独立 `FavoriteRadio` 存储域和「我的电台」页。
- `DjRadioProgram extends Song` 表达的是「可被双端歌曲列表消费的内容面」；播放身份、收藏身份、队列身份一律沿用 `Song.id`，`programId` 只保留期号/内容身份与列表 key。收藏持久化仍按 `SongBase`，扩展字段丢失的既有代价不变。
- 网易 `POST /api/djradio/sub` / `/unsub` 匿名返回 `code=301`（需要登录）；MPlayer 没有网易登录入口，不在本票引入。
- 「保存全部到新歌单」是另一条留存方式：把列表可见节目快照成本地歌单，复用现有歌单写入编排；它与收藏互不替代。

## 备选与否决

- **独立 `FavoriteRadio` 存储域：否决。** 本期节目以歌曲身份进入播放、队列与列表，用户要求收藏同样按歌曲对象处理；另造一套电台收藏会割裂同一行的可见动作与持久化身份。
- **新增用户主页：否决。** 用户给的场景可以经歌手搜索 + 歌手页 accountId 完整覆盖；用户主页（歌单/节目/粉丝）是另一个内容面。
- **发现页完整电台频道（推荐/热门/分类/榜单）：不在本票。** 这些接口匿名可用，但需要单独的信息架构与分页设计。
- **把 `program.id` 当 `Song.id`：否决。** 直链 404；播放身份必须是 `mainSong.id`。
- **用详情 `programCount` 渲染「共 N 期」：否决。** 样本 133 与可见 126 不一致；以列表 `count` 为准。

## 后果

- 跨端类型新增 `DjRadio` / `DjRadioProgram`；`Artist.accountId` 为可选字段，所有构造点可不填。
- 已新增四个网易内容方法与三个三态门面；内容方法进 `CONTENT_METHODS`，门面进 `BASE_METHODS`，IPC 完整性测试与双端接线守卫钉住路由、入口、失败文案、全量 helper、`programId` key、收藏与 `hideSwap`；不改变播放器、原生播放或 tier3。
- 节目可经双端歌曲行收藏到「我喜欢的音乐」；双端通过 `hideSwap` 保留普通行一致性但避免跨源误匹配，移动 `hideActions` 仅作为通用能力保留，电台页不传。
- 歌手页电台与搜索电台失败时保留具体错误态与重试，不再静默隐藏；卡片不展示 `programCount`，详情页仍用列表 `total`。
- 代码里只保留非显然约束与一行 ADR 指针；方案理由（收藏语义、换源隐藏、错误不整页化、单期简介）统一收在本 ADR。
- 节目歌词在样本中全为空（`existLyric=false`），首版不承诺歌词；按 `mainSong.id` 的现有歌词路径保留，但不做正样本承诺。付费/下架电台、两条腿限流额度是否共享、链接导入、发现页完整电台频道、移动端「保存全部」、锁屏 / 后台 FGS 取证仍为后续或未验证边界；解析不到 URL 时走既有失败归因和跳歌护栏。
