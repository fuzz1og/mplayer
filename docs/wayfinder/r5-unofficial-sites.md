# R5 — musicdl 非官方下载站与爬虫源研究报告

> 背景：MPlayer 计划直连源站替代不稳定的自建 API。musicdl（Python）除 7 个官方源外还有两类第三方源，本报告评估它们对 MPlayer 的价值与风险——尤其是作为 **VIP/版权歌曲兜底解析** 的可行性。
>
> 主参考（primary source，均直接读源码）：
> - 爬虫下载站：`C:\Users\Admin\AppData\Local\Temp\musicdl-clone\musicdl\modules\thirdpartysites\`（17 站）
> - 通用/聚合源：`C:\Users\Admin\AppData\Local\Temp\musicdl-clone\musicdl\modules\common\`（6 源）
> - VIP/版权兜底链：`sources\netease.py` 的 `_parsewiththirdpartapis`（≈30 个解析 API）与 `sources\qq.py` 的 `_parsewiththirdpartapis`
> - 会话/反爬基础：`sources\base.py`、`utils\misc.py`（`AudioLinkTester`/`usesearchheaderscookies`）
>
> 结论一律以源码函数/路径为准。工作量 S/M/L 按「Electron 主进程 Node/TS 移植」口径估。

---

## 0. 最重要的先决结论（先读）

**「非官方源」在 musicdl 里是三个完全不同的东西**，价值天差地别。看完别混为一谈：

| 层级 | 位置 | 是什么 | 对 MPlayer 的价值 |
|---|---|---|---|
| **A. 解析 API 聚合兜底** | `netease.py:_parsewiththirdpartapis`（L607）、`qq.py:_parsewiththirdpartapis`（L315） | 一串**第三方 Parse API**（JSON），会员/版权歌专用兜底，`netease` 约 30 个、`qq` 约 12 个 | **最高。这就是 ticket 问的「VIP/版权兜底解析」** |
| **B. 下载站爬虫** | `thirdpartysites\`（17 站） | 网页刮取（HTML/CSS/JS 变量），多经夸克/蓝奏网盘中转 | 中低。真正的「版权兜底」——搜到官方源没有的再发布/网盘版 |
| **C. 通用聚合/镜像 API** | `common\`（6 源） | 单站形如 MPlayer 自建 API 的聚合/镜像；及另类源 | 中。其 A 类中的 `gdstudio` 同时被挂进网易兜底链 |

> **关键澄清**：ticket 把「VIP/版权歌曲兜底解析」与「非官方下载站」当成一回事，但源码显示**真正承担「VIP/版权兜底」的是 A 类**（`_parsewiththirdpartapis` 是网易/QQ 官方直连失败后的自动降级链），**而非 B 类下载站**。B 类是「正规官方源 / A 类都拿不到的稀有/版权被下架曲目」才用得上。下面逐层展开，末尾给明确推荐。

---

## 第一部分：A 类 — 官方源自带的第三方解析 API 兜底链（重点评估对象）

### 1.1 网易 `netease.py:_parsewiththirdpartapis`（L607-617）

搜索 `_search`（L674）与歌单 `parseplaylist`（L706）里，每个搜索结果先跑一遍 `_parsewiththirdpartapis`，得到 `song_info_flac`；再跑官方 `_parsewithofficialapiv1`（L624）。若官方因无会员/版权返回空，兜底结果会被采用（L647、L678）。

```python
# netease.py L607-617
def _parsewiththirdpartapis(self, search_result, request_overrides=None):
    if (cookies := self.default_cookies or (...)) and (cookies != DEFAULT_COOKIES):
        return SongInfo(...)          # 用户设了 cookie 就跳过第三方链
    l1 = [tmetu, xuanluoge, chksz, rrvenn, bugpk, znnu, xingmian, xunjinlu,
          xiaoqin, jfjt, vincentzyu233]        # svip 级
    l2 = [kangqiovo, haitangw, guyuei, cgg, bileizhen, cunyu, yutangxiaowu] # svip 不稳
    l3 = [nanorocky, qjqq, cocodownloader, rxtool, gdstudio, byfuns, xianyuw, xcvts, manshuo] # vip
    l4 = [xiaot, ceseet]            # vip 不稳
    for parser in (l1+l2+l3+l4):
        ...
        if song.with_valid_download_url and ext in VALID_AUDIO_EXTS: break
    return song_info_flac
```

- **端点是 30 个独立的第三方 JSON API**，形如 `https://api.vkeys.cn/music/tencent/song/link`、`https://nextmusic.toubiec.cn/api/getSongUrl`（L69）、`https://api-v2.cenguigui.cn/api/netease/music_v1.php`（L98）、`https://api.xingmian.bbroot.com/API/netease_music_api.php`（L284）、`https://music-api.gdstudio.xyz/api.php`（L547）等。
- **手法**：全部 `requests.get/post`，参数多为 `song_id + level/quality`；个别带解密（`xingmian` 的 `REQUKEY` base64 解码、`guyuei` 的 XOR、`xunyinlu` 的 base64 key）。
- **触发条件**（L608）：`default_cookies` 非 `DEFAULT_COOKIES` 即跳过。即**只有匿名/借用的默认 MUSIC_U 才会走第三方链**；一旦用户登录态 cookie 就退回官方高音质，不再依赖第三方。

### 1.2 QQ `qq.py:_parsewiththirdpartapis`（L315-325）

结构相同，分层更清晰，注释直接写明用途（L317-320）：

```python
# qq.py L315-325
l1 = [vkeys, xcvts, xingmian, 317ak]     # svip
l2 = [xianyuw, nki, hk0cc, tang]         # vip
l3 = [cy, xunhuis, lxmusic, yutangxiaowu] # vip 但仅 mp3/m4a
l4 = [lpz]                               # 无效或不稳
```

- **前提**：`self.default_cookies or request_overrides.get('cookies')` 为空才进入（L316）——QQ 默认无 cookie，所以这条链默认生效。
- 每个 parser 内部还会自测（`AudioLinkTester`）并做**跳档**：从 SVIP 音质往下试到 320k，直到 `file_size_bytes*8 >= 320000*duration`（L69）——即校验返回的不会是空壳/试听。
- **`vkeys`（L54-77）是 QQ 兜底链里最「正统」的**：`GetVkey` 语义等价腾讯官方 `UrlGetVkey`，只换到第三方网关返回直链。

### 1.3 评价 A 类

- **它们不是「下载站爬虫」**，而是**会员代理 JSON API 聚合**——输入 song_id，输出高质量直链。这正是 MPlayer 直连官方失败时需要的「VIP/版权兜底解析」。
- **风险/稳定性**：第三方 API 单点随时下线/改版/加签名（源码里已有大量 `with suppress(Exception)` 容错与分层降级，说明作者自己就预期它们会挂）。`verify=False` 频繁出现。
- **合规**：A 类本质是**绕过会员/版权校验**的代理解析，部分 API（`xingmian`/`xcvts`/`vnkeys`）明确标注「SVIP/无损/母带」，是**破解会员**性质，风险高于普通搜索。

---

## 第二部分：B 类 — 非官方下载站爬虫（`thirdpartysites\`，17 站）

### 2.1 按「下载通道」的三大家族（这是最重要的同构分类）

爬虫站绝大多数**并不直接给直链**，而是把歌曲文件放到**网盘**（夸克 `pan.quark.cn`、或蓝奏 `lanzouy.com`），站点只给 share 链接；musicdl 再用 `QuarkParser`/`LanZouYParser` 解析成真直链。

| 家族 | 站点（类名） | 下载通道 | 是否需网盘 cookie |
|---|---|---|---|
| **纯网页直链** | htqyy（`HTQYYMusicClient`）、itingwa（`ITingWaMusicClient`） | 网页 JS 变量里的 CDN 直链 | 否 |
| **夸克网盘中转** | kkws、livepoo、liziyy、fivesong、xiageba、xmfwav、yinyuedao、mgmp3、mitu、sgogo、buguyy、fangpi、gequbao、gequhai | `pan.quark.cn` share → `QuarkParser` 解析 | **是**（`quark_parser_config.cookies`），个别 `assert` 强校验 |
| **蓝奏网盘中转** | zhuolin | `lanzouy.com` → `LanZouYParser` | 否（蓝奏免登录） |

- **纯网页直链**（最接近 MPlayer 想要的「点开即播」）：`htqyy` 抓 `fileHost+mp3` JS 变量（regex），`itingwa` 抓 `#tw_player init-data`。无签名、无 JSON，纯 HTML regex → 直链。**稳定性最低**（CSS/JS 结构调整即废），但架构最简单。
- **夸克网盘中转（多数）**：歌曲文件存夸克网盘，站点给 share 链接 `https://pan.quark.cn/s/...`。需要用户提供**夸克 cookie** 且依赖外部 `QuarkParser` 解析（`xmfwav.py` L50-55、`fivesong` 在 `__init__` 里直接 `assert quark_parser_config.get('cookies')`）。**对 MPlayer 基本不可用**：① 需要真实夸克账号 cookie（登录态）；② 解析链路又多一跳，双向不稳定。

### 2.2 逐站速查

| 站 | 域 | 搜索 | 详情/下载 | 下载通道 | 工作量 |
|---|---|---|---|---|---|
| buguyy | buguyy.top | `GET /api/search`(JSON) | `GET /api/getdown·/geturl`(JSON) | quark+http | M |
| fangpi | www.fangpi.net | HTML `div.card` | `window.appData`+`POST /member/common-play-url` | quark+web | L |
| fivesong | www.5song.xyz | HTML `div.list ul li` | 详情页 `li[data-url]` | 仅 quark | M |
| gequbao | www.gequbao.com | HTML `div.card` | `window.appData`+`POST /member/common-play-url` | quark+web | L |
| gequhai | www.gequhai.com | 表格 `table#myTables` | JS 变量+`POST /api/music`(form) | quark+web | L |
| htqyy | www.htqyy.com | HTML | JS 变量 `fileHost+mp3` | 网页直链 | S |
| itingwa | itingwa.com | HTML | `#tw_player init-data` | 网页直链 | S |
| kkws | www.kkws.cc | HTML | `getdown`端点 | quark | M-L |
| livepoo | livepoo.cn | HTML | `const detailJson` blob | quark+`audio/play` | M-L |
| liziyy | liziyy.top | HTML | `detailJson` blob | 仅 quark | M-L |
| mgmp3 | www.mgmp3.top | `GET /api/search`(JSON) | `GET /api/getdown·geturl`(JSON) | quark+http | S |
| mitu | api.qqmp3.vip | `GET /api/songs.php`(JSON) | `GET /api/kw.php`(JSON) | quark+http | S |
| sgogo | www.sgogo.com | HTML `.song-list` | APlayer 脚本 regex | quark+web | M |
| twot58 | www.2t58.com | HTML `.play_list` | `plug/down.php?ac=music`(HEAD/CDN) | 网页直链 | M |
| xiageba | xiageba.liumingye.cn | `GET /api/music/search`(JSON) | `_payload.json` | 仅 quark（assert）| S |
| xmfwav | www.xmfwav.com | HTML `allsrc` | `/song/{id}` JS-key regex | quark+web | M |
| yinyuedao | *(musicdl yinyuedao)* | HTML | `/mdetail/` base64 + `geturl` JSON | quark+web | M |
| zhuolin | music.zhuolin.wang | `POST /plugns/api.php`(JSON) | 同端点 `types=lyric` | 蓝奏+http | S |

### 2.3 同构性归类（可抽公共基类）

对 `ScraperClientBase` 的抽取有三档：

1. **强同构族（可抽公共基类 + 参数化域名/端点）**：
   - `fangpi == gequbao`：**近乎逐字节同模板**（`window.appData`+`JSON.parse` / `LiteralEval` / `base64` / `to_seconds_func` lambda / 同一 `POST member/common-play-url`），仅域名与 UA 不同。**一份实现参数化即可**。
   - `mgmp3 ≈ mitu`：同一「search-JSON + quark 兜底 + web 播放兜底」模板，字段名（`rid/name/artist/pic/downurl`）与 `MUSIC_QUALITY_RANK` 略异。
   - `kkws ≈ livepoo ≈ liziyy`：共享 `MUSIC_QUALITY_RANK`、`QuarkParser`、`quark_audio_link_tester`，「按 quality 循环下载、首个有效即 break、LRC 时长兜底」同一块；`livepoo`/`liziyy` 连 `const detailJson` blob 提取都相同（livepoo 更防御式：`ast.literal_eval`+`json_repair`、双 quark/web 兜底、`warn` 而非 `assert`）。
   - `htqyy ≈ itingwa`：纯网页直链族，JS 变量 regex 提取。
2. **同骨架异实现（共用 `_search` 流程，但解析方法独立）**：`sgogo`（APlayer 脚本）、`gequhai`（表格+JS 变量+form POST+base64 混淆）、`xmfwav`（JS-key regex+`<section id=demo>` 歌词）、`fivesong`（仅 quark）。
3. **完全独立**：`xiageba`（单 quark 精简模板）、`zhuolin`（蓝奏 + form-POST JSON）、`twot58`（含「人机验证」CAPTCHA/CSRF POST 流程——唯一带反爬验证码的站）。

### 2.4 B 类共性脆弱点

- **全依赖 DOM/CSS 类名 / JS 变量名 / 表格选择器**（如 `div.card`、`h1.mark`、`#myTables`、`#content-lrc`、`[data-url]`、`srcsong-item`），站点任何改版即崩。musicdl 作者用 `with suppress(Exception)` 全部吞掉，坏一个源不影响别的——**这是「武器库」设计，默认接受高失效率**。
- **夸克/蓝奏网盘中转 = 双重不稳定**：share 链接本身就是「有一次性的、要网盘 cookie/登录态解析」的东西。对「点开即播」的 MPlayer 是灾难。
- **`verify=False` 普遍**（xmfwav L48、mgmp3、jbsou L55 等关 TLS 校验），传输是明文/关闭证书校验，中间可被篡改。
- **安全校验是有的**：所有下载 URL 最终过 `AudioLinkTester.test()`（`misc.py` L339-375：HEAD→GET stream→URL 后缀 / Content-Type / Content-Disposition / 字节嗅探 `filetype`/`puremagic` 综合判定是否真音频），**不会把 HTML/钓鱼页当音频返回**。关键词全部经 `quote`/`urlencode` 编码，无注入。这是值得保留的移植点。

---

## 第三部分：C 类 — 通用/聚合源（`common\`，6 源）

### 3.1 两个模板族 + 三个另类

| 源 | 域 | 协议 | 定位 | 工作量 |
|---|---|---|---|---|
| **jbsou** | www.jbsou.cn | `POST /` form `{input,filter,type(page)}`(JSON)，`urljoin`+`HEAD` 还原直链 | **聚合镜像**——单站内搜 netease/qq/kugou/kuwo | S |
| **xiaobai** | *(musicdl xiaobai)* | 同 form-POST 模板 | 与 jbsou 同模板变体 | S |
| **myfreemp3** | myfreemp3 | form-POST+`session.head` | 同族 | M |
| mp3juice | *(mp3juice)* | 4 跳 ThetaCloud JSON 链 + 预下载全音频 | 索引/快照源 | M |
| tunehub | *(tunehub)* | 聚合 4 后端，硬编码 `X-API-Key` + 伪造 QQ `Cookie: uin=` | 聚合 | L |
| **gdstudio** | music-api.gdstudio.xyz | `GET /api.php?types=url&id=&source=&br=`(JSON) | **同时被挂进网易兜底链**（`netease.py:_parsewithgdstudioapi` L541-547）| L（免其 MD5 签名）|

### 3.2 关键同构发现：`jbsou`/`xiaobai` 就是「自建 API 的镜像版」

`jbsou.py L38` 的请求参数 `{'input': keyword, 'filter': 'name', 'type': source, 'page': 1}` —— **与 MPlayer 自建 API 的 POST `/` 参数 `input/filter/type/page`（`musicApi.ts:searchSongs`）几乎一模一样**。也就是说：

> **`jbsou` 这类源在做的，正是 MPlayer 自建 API 想做的事**（一个统一网关按 `source` 分发到官方源）。对 MPlayer 而言这不是「要接入的第三方源」，而是「可被直连替代的同类」——直连化应该消灭依赖它的动机，而不是把它当目标。

`ALLOWED_SITES = ['netease','qq','kugou','kuwo']`（L21，注释：qianqian/migu 无用），说明它自己就是个跨源聚合。**引入它 = 换一个更不稳定的自建 API**，无意义。

### 3.3 `gdstudio` 是 A/B/C 三类的粘合点

它同时作为 `common\gdstudio.py` 独立客户端存在，又被 `netease.py::_parsewithgdstudioapi`（L541）纳入网易兜底链。说明 **C 类里的泛解析 API 与 A 类 vip 兜底 API 在 musicdl 作者眼里是同一种东西**——按 `source` 参数能解网易/QQ 等任意官方源。这对 A 类评估是加分项：这类「参数化的多源解析 API」比「单站下载站」泛化得多，移植价值更高。

---

## 第四部分：MPlayer 适配度（跨域/CORS/UA/RN）

### 4.1 平台约束（决定性差异）

- **electron 主进程（Node）**：无 CORS；Node 21+ 原生 `fetch`/`undici` 可任意设 `User-Agent`、`Referer`、`Origin`、临用 TLS。B 类「网页直链」与 A 类「JSON API」都可接入。**唯一限制**：没有 `curl_cffi` 的 TLS 指纹欺骗（`fangpi`/`gequbao` 开了 `enable_search_curl_cffi=True`，靠 TLS 指纹过反爬）——Node 的 TLS ClientHello 与 Chrome 不同，**这恰好是这两个站最依赖的反爬**，Electron 里很可能被拒。
- **electron 渲染进程 / RN（packages/core 被两处共用）**：**CORS/混合内容是大闸**。渲染进程 fetch 跨域站受 CORS 限制（`packages/core` 现走自建 API 正是为绕 CORS）；RN 的 `XMLHttpRequest` 更受限制。B 类大量 `verify=False`（HTTP/关校验）在 RN 内不可直接承载。
- **结论**：若要做 B 类，**必须在 Electron 主进程（`src/main`）加一个 Node 代理层**（像 `api/musicApi.ts` 那样），渲染/RN 统一走 `ipc`/本地网关——这等于又造一个「小自建 API」。**成本高昂且与「直连替代自建 API」的目标自相矛盾**。

### 4.2 与直连策略的关系

R1 报告（`r1-direct-connect-matrix.md`）已把 7 官方源直连排了优先级（NetEase S、Soda S、Qianqian S、Migu M、QQ M、Kugou L、Kuwo L）。R5 的定位是**官方直连覆盖不到的长尾**：

- **官方直连能拿到的**（QQ/网易免费与 320k、Soda share 页、Kugou trackercdn 兜底）——**不该用 B/C 类**，用 A 类升级音质即可。
- **官方直连与 A 类都拿不到**的（绝版、版权被下架、需登录态曲库）——才轮到 B 类下载站撞运气。收益小、风险大、维护量高。

---

## 汇总矩阵

| 源 | 类型 | 抓取目标 | 直链/中转 | 稳定性 | 合规/安全风险 | 工作量 | 推荐引入？ |
|---|---|---|---|---|---|---|---|
| `netease._parsewiththirdpartapis`（30 API） | A 解析 API 聚合 | 网易 vip 直链 | 直链 | 低-中（作者已多层容错） | **高**（会员破解）| M | 可选试验（单 API 抽测）|
| `qq._parsewiththirdpartapis`（12 API，vkeys 等）| A 解析 API 聚合 | QQ svip/无损 | 直链 | 低-中 | **高**（SVIP/无损破解）| M | 可选试验 |
| gdstudio（common+网易链）| A/C 泛解析 API | 按 source 解析官方 URL | 直链 | 中 | 中-高（会员绕过）| M | **最值得试** |
| jbsou | C 聚合镜像 | 跨 4 官方源搜索 | 直链 | 低 | 中 | S | **否**（即自建 API 镜像，引入即悖论）|
| xiaobai / myfreemp3 | C 同模板 | 同 jbsou | 直链 | 低 | 中 | S/M | 否（随 jbsou）|
| tunehub / mp3juice | C 另类 | 聚合/快照 | 预下载/多跳 | 更低 | 中高（硬编码 key/伪造 cookie）| L | 否 |
| htqyy / itingwa | B 网页直链 | 老站 CDN | **直链** | 很低（DOM 崩）| 低-中 | S | **可试**（唯一直链家族）|
| twot58 | B 网页直链+CAPTCHA | CDN 直链 | 直链 | 很低（反爬人机验证）| 中 | M | 否（验证码流程重）|
| fangpi/gequbao | B HTML+curl_cffi | quark+web | 网盘中转 | 很低 | 中高（TLS 指纹）| L | 否（Electron 无 curl_cffi）|
| gequhai | B 表格+JS 变量 | quark+web | 网盘中转 | 很低 | 中 | L | 否 |
| sgogo/xmfwav/yinyuedao | B DOM/正则 | quark+web | 网盘中转 | 很低 | 中 | M | 否 |
| fivesong/xiageba | B 仅 quark | 仅网盘 | 网盘中转 | 很低（assert cookie）| 中 | S/M | 否（依赖夸克 cookie）|
| mgmp3/mitu/buguyy | B JSON API | quark+http | 网盘+直链 | 低 | 中 | S/M | 可试（JSON API 族）|
| kkws/livepoo/liziyy | B quark blob | 仅网盘 | 网盘中转 | 很低 | 中 | M-L | 否 |
| zhuolin | B 蓝奏 | 蓝奏+http | 网盘+直链 | 低 | 中 | S | 可试（蓝奏免登录）|

---

## 明确结论

### 是否值得引入？——**不建议作为正式源；A 类可抽测，B/C 类整体不建议。**

**为什么：**
1. **A 类（`_parsewiththirdpartapis`）是唯一与「VIP/版权兜底」直接对应的**，但它本质是**会员代理/破解解析 API**，且第三方单点随时下线、`verify=False`、需要维护一个 30 个 API 的白名单与轮换逻辑。移植成本 M+，合规风险高（SVIP/无损/母带破解），收益只在「官方直连+320k 不够、非要无损/母带」时才有。
2. **B 类下载站**面向「网页下载/网盘中转」而非 API；多数要**真实夸克/蓝奏账号 cookie**，在 Electron 渲染/RN 有 CORS 与无 `curl_cffi` 的硬墙，必须再造一层 Node 代理——与「直连替代自建 API」目标相悖。
3. **C 类（jbsou/xiaobai）就是自建 API 的镜像**，接入=换更不稳定的自建 API，直接否。

### 若只抽测 2–3 个最值得试的站（作为后续可开关的“试验源”）：

1. **`gdstudio`（`netease.py:_parsewithgdstudioapi` + `common/gdstudio.py`）**——A/C 粘合点，参数化多源解析 API（`?types=url&id=&source=netease&br=`），普适性最高，已内置在网易兜底链。
2. **`vkeys`（`qq.py:_parsewithvkeysapi`，`api.vkeys.cn/music/tencent/song/link`）**——QQ svip 兜底链首位，`GetVkey` 语义等价官方，返回 JSON 直链，最容易测通。
3. **`htqyy`（`thirdpartysites/htqyy.py`）或 `mgmp3`**——仅有的「网页/JSON→直链」不依赖网盘族；`htqyy` 是纯网页直链（S），`mgmp3` 是 JSON API（S）。（任选其一探测，别都做。）若坚持 `jbsou` 式单网关探测，则 `mgmp3` 优先。

### 合规风险评级

- **B/C 类下载站与聚合**：**中**。站方本身多为无版权授权/转载的「镜像站」，响应的可信度不可保证，但 musicdl 的 `AudioLinkTester` 字节嗅探已挡掉「HTML/钓鱼当音频」的注入面，且关键词无不安全拼接。主要风险是**帮用户绕版权/下架曲目**与**站方随时被关停**，而非技术注入。
- **A 类解析 API**：**高**。本质是**会员/SVIP/无损/母带破解**（`xingmian`/`xcvts`/`vkeys` 等均明确标注破解档）。对 C 端播放 App 属明确的规避付费墙风险，需法律/产品合规审查。

---

## 替代方案（若整体不引入）

1. **保持官方直连为主，明确失败即提示不可播**：沿用 R1 方案把 7 官方源直连做完，对拿不到 VIP/版权的曲目，在 UI 明确标注「版权受限/需要会员」，不提供绕过。这是最稳妥、工作量确定、无新增合规风险的路线。
2. **把 A 类做成「可开关的实验源」而非默认源**：在 `packages/core/src/api` 新增 `tier3Api.ts`（仿 Soda 的多源分发），把 `gdstudio`+`vkeys`+`htqyy` 这几个探测通过的源做成**白名单 + 用户显式开启**的试验源，失败自动降级回官方，不纳入默认播放路径。
3. **维护一份「下架/版权」清单 + 优雅提示**：对已知版权下架曲目提前给「无法在线播放」反馈，避免盲目撞第三方。

---

## 参考文件索引

- `musicdl\modules\sources\netease.py`：`_parsewiththirdpartapis`(L607)、`_parsewithofficialapiv1`(L624)、`_parsewithgdstudioapi`(L541)、`_search`(L657)
- `musicdl\modules\sources\qq.py`：`_parsewiththirdpartapis`(L315)、`_parsewithvkeysapi`(L54)、`_parsewithxcvtsapi`(L100)、`_parsewithlxmusicapi`(L143)
- `musicdl\modules\sources\base.py`：`BaseMusicClient`（`get/post/get/session`、`enable_curl_cffi`、`maintain_session`、`quark_parser_config`）
- `musicdl\modules\utils\misc.py`：`AudioLinkTester.test`(L339)、`VALID_AUDIO_EXTS`(L182)、`usesearchheaderscookies`(L116)
- `musicdl\modules\thirdpartysites\*.py`：17 个下载站（见 2.2 表）
- `musicdl\modules\common\{jbsou,xiaobai,myfreemp3,mp3juice,tunehub,gdstudio}.py`
- `D:\Playground\mplayer\packages\core\src\api\musicApi.ts`：`searchSongs`（form `input/filter/type/page`，与 jbsou 同构）
- 姊妹报告：`docs\wayfinder\r1-direct-connect-matrix.md`（7 官方源直连优先级）、`r4-cookie-matrix.md`
