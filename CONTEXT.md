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
换源候选的探测结果：可播（完整可听）、短时长（30 秒片段）、失效（链接不可用或 URL-ID 错位）。
_Avoid_: 播放状态、质量

**原位替换**:
单曲换源后的持久化语义：按旧歌曲 ID 找到收藏/本地歌单条目，整条换成新歌，保持排序位置与收藏时间；播放历史与下载记录不追溯改写。
_Avoid_: 删除后新增、覆盖更新

**音乐源**:
歌曲的提供方（netease / qq / kugou / migu / kuwo / qianqian / soda / local），换源候选只在非当前源中搜索。
_Avoid_: 来源、音源服务

**直连**:
终端直接请求音乐源官方接口获取搜索结果与播放地址的方式，不经过任何中转服务；探测语义即直连可播性。
_Avoid_: 官方源、源站直连、爬虫

**tier3 订阅源**:
用户以订阅清单配置的第三方解析源，提供播放地址解析与搜索兜底能力；不参与列表探测，解析受总预算约束。
_Avoid_: 第三方源、订阅 API、tier3 源、兜底源

**旧签名端点**:
已退役的自建 API 生成的带会话签名的资源地址（`api.php?get=…`），存量数据中的死链，刷新与播放流程须将其视为未命中。
_Avoid_: 死链、过期 URL、旧 API 地址

**预取缓存**:
探测阶段解析所得直链的短期缓存；播放命中时零等待出声，失效或不完整结果不入缓存。
_Avoid_: 探测缓存、URL 缓存、秒播缓存

**汽水歌词**:
汽水歌词可通过**分享页免登录**获取：`music.douyin.com/qishui/share/track?track_id={id}` 的 `_ROUTER_DATA.audioWithLyricsOption.lyrics.sentences[]`（结构化时间轴 startMs/endMs/text/words，lyricType=krc），无需登录态；分享页同时返回音频直链（encrypt=false 未加密）与 `trackInfo.playable_range`（试听窗口，付费歌非空 = 试听版）。track_v2 接口（`api.qishui.com/luna/pc/track_v2`）也含 `lyric.content`（KRC 文本），但需 PC 客户端登录态 Cookie（sessionid），匿名请求 200 空 body——完整版/高音质音频亦需凭证 + CENC 解密（社区方案 qishui-decrypt / musicdl，软件不实现，仅记录）。搜索接口当前路径为 `api.qishui.com/luna/search/track`（无 pc 段，免登录）；旧 `luna/pc/search/track` 已失效返回空 body。桌面歌词接线：`loadLyricsWithRetry` 的 soda 分支调 `getSodaLyrics`（分享页转 LRC，lrc=URL 契约不变）。移动端接线：PlayerOverlay 的 soda 歌 cacheKey 用 songid、load 走 `getSodaLyrics` 直取文本；`fetchLrcInBackground` 对 soda 只补封面不搜索歌词。下载侧车 .lrc 仍按 song.lrc（URL）驱动，soda 恒空故不生成——留待下载侧专项。
_Avoid_: 匿名 track_v2、汽水歌词源、soda 歌词（匿名直连取不回）
