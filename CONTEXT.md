# MPlayer

MPlayer 是一个跨平台音乐播放器（桌面 Electron + React，移动端 React Native），统一由 `@mplayer/core` 提供歌曲识别、播放地址解析与多源搜索能力。

## Language

**单曲换源**:
把列表或队列中的一首歌替换为目标音乐源的同曲版本（歌名、歌手、封面、ID 一起换成目标源版本），用于处理失效或不满意的音源。
_Avoid_: 换源完整版（界面文案）、切源、换版本

**换源候选**:
目标源搜索返回的、按“精确匹配优先 + 相似度降序”排出的候选版本列表（最多 3 个），每个候选带有可播性状态。
_Avoid_: 搜索结果、备选版本

**完整版**:
与当前歌曲同名同歌手的换源候选（精确匹配），界面用绿色“完整版”标记，区别于 Live/翻唱/混音等相似版本。
_Avoid_: 原版、官方版

**可播性**:
换源候选的**零请求**判定：URL-ID 错位（源数据错位，链接指向另一首歌）的候选直接剔除，不进候选列表。#391 起不再有任何可播性网络探测（判据反向、产物无消费者）。
_Avoid_: 播放状态、质量

**跳歌护栏**:
播放失败后的处置决策（core `shared/skipGuard`）：同曲 fresh 重试一次，仍失败即「终局失败」——连续失败**固定上限 3 首**（与队列长度无关）、**离线直接暂停不进解析链**、**坏歌会话内记忆**（跳歌时跳过）、**「失败即跳」偏好默认开启**。语义与文案双端同一来源。
_Avoid_: 跳歌阈值、失败重试策略

**原位替换**:
单曲换源后的持久化语义：按旧歌曲 ID 找到收藏/本地歌单条目，整条换成新歌，保持排序位置与收藏时间；播放历史与下载记录不追溯改写。
_Avoid_: 删除后新增、覆盖更新

**歌曲身份**:
一首歌**在某个音乐源内**唯一的标识推导：音乐源 + 去源前缀的真实 ID（多层嵌套前缀按最外层源折叠，如 `kuwo:kugou:123` 归为 `kuwo:123`）；用于缓存键、可播性标记与去重，不等同于 `Song.id` 字段本身。设计上同 rawId 不同源必不相等——它回答「同源同 ID」，**不**回答「跨源是否同一首」。
_Avoid_: 歌曲 key、复合 ID、songKey、全局 ID

**跨源录音身份**:
断言「两个不同音乐源的条目是同一次录音」所需的标识。本项目**不建模**：跨源同一性目前只靠歌名 + 歌手的文本精确匹配（`isExactMatch`），时长只能作一致性护栏、不能作证明（且直连失败时无权威时长可比）。业界对应物是实体映射库（ISRC / UPC / MBID），本仓无 ISRC/MBID。
_Avoid_: 同一首歌（有歧义）、作品 ID、跨源歌曲身份

**音乐源**:
歌曲的提供方（netease / qq / kugou / migu / kuwo / qianqian / soda / local），换源候选只在非当前源中搜索。
_Avoid_: 来源、音源服务

**直连**:
终端直接请求音乐源官方接口获取搜索结果与播放地址的方式，不经过任何中转服务。播放解析腿有**独立 3s 墙钟**（#389，超时即视为该腿失败、进 tier3 兜底）；无权威时长的源（netease/soda 之外）在播放时对直连 URL 做**一次**时长取证以标记试听片段（#392）。
_Avoid_: 官方源、源站直连、爬虫

**tier3 订阅源**:
用户以订阅清单配置的第三方解析源，提供播放地址解析与搜索兜底能力；不参与列表探测，解析受总预算约束。
_Avoid_: 第三方源、订阅 API、tier3 源、兜底源

**tier3 交付**:
第三方解析源产出的候选被路由层在整链预算内真正采纳、交给播放层；与之相对的是「产出」（resolver 拿到过护栏的候选）与「丢弃」（预算超时后到达的迟到命中）。设置页「交付」= 采纳数，不再等于 resolver 的产出数。
_Avoid_: 命中（有歧义）、成功数

**来源开关**:
按音乐源设置的解析模式，双端设置页共用同一份选项：自动（auto，直连优先、失败进 tier3 兜底）与仅直连（direct，只走直连、失败不回退）；存量 'api' 模式在加载时自动洗白为自动。
_Avoid_: 来源模式、解析模式、渠道开关、api 开关

**播放诊断 trace**:
一次播放解析的结构化记录（core `shared/playbackTrace`）：命中层级、各段耗时、每源 outcome 与护栏等级；core 只产出 trace，宿主落 sink、常驻内存环形缓冲、会话内不落盘，用户点「导出诊断」才写文件。
_Avoid_: 埋点日志、耗时日志、遥测

**旧签名端点**:
已退役的自建 API 生成的带会话签名的资源地址（`api.php?get=…`），存量数据中的死链，刷新与播放流程须将其视为未命中。
_Avoid_: 死链、过期 URL、旧 API 地址

**预取缓存**:
core 门面 `prefetchPlayableSong` 解析所得直链的短期缓存（core `prefetchCache`，30min TTL，失败可遗忘）；桌面经 `musicApi:call` 在**主进程**写入（播放解析读的就是那一份）；移动端不写这一份（它用自己的 12h `songResourcesCache`）。播放命中时零等待出声，拿不到 URL 的结果不入缓存。
_Avoid_: 探测缓存、URL 缓存、秒播缓存

**汽水歌词**:
汽水歌词可通过**分享页免登录**获取：`music.douyin.com/qishui/share/track?track_id={id}` 的 `_ROUTER_DATA.audioWithLyricsOption.lyrics.sentences[]`（结构化时间轴 startMs/endMs/text/words，lyricType=krc），无需登录态；分享页同时返回音频直链（encrypt=false 未加密）与 `trackInfo.playable_range`（试听窗口，Cover 歌也有该字段却给完整版，**不能**作试听/完整判别依据；可靠判别 = `trackInfo.preview.duration` 或实际音频时长）。track_v2 接口（`api.qishui.com/luna/pc/track_v2`）也含 `lyric.content`（KRC 文本），但需 PC 客户端登录态 Cookie（sessionid），匿名请求 200 空 body——完整版/高音质音频亦需凭证 + CENC 解密（社区方案 qishui-decrypt / musicdl，软件不实现，仅记录）。搜索接口当前路径为 `api.qishui.com/luna/search/track`（无 pc 段，免登录）；旧 `luna/pc/search/track` 已失效返回空 body。桌面歌词接线：`loadLyricsWithRetry` 的 soda 分支调 `getSodaLyrics`（分享页转 LRC，lrc=URL 契约不变）。移动端接线：PlayerOverlay 的 soda 歌 cacheKey 用 songid、load 走 `getSodaLyrics` 直取文本；`fetchLrcInBackground` 对 soda 只补封面不搜索歌词。双端歌词决策（songid 直取/搜索补全/soda 特判）共用 core `songLyrics` helper 防漂移。下载侧 .lrc 仍按 song.lrc（URL）驱动，soda 恒空故不生成——留待下载侧专项。
_Avoid_: 匿名 track_v2、汽水歌词源、soda 歌词（匿名直连取不回）
