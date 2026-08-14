# R4 — 各源 Cookie 必需性与「无感获取」方案矩阵

> 背景：MPlayer 计划直连 NetEase / QQ / Kugou / Migu / Kuwo / Qianqian / Soda 七个源替代自建 API。
> 产品约束：不引入「用户手动配置 cookie」负担；某源若必须用户 cookie 才能直连工作，必须点名上报用户重新决策；
> 匿名 cookie 若可「无感获取」（程序化自动获得、缓存、轮换）则可采纳。
>
> 本矩阵以 primary source（musicdl 源码 + MPlayer 现状代码）为准，每个结论都标注文件路径与函数/variable 名。
> 三个动作定义：**搜索**、**播放 URL 解析**、**歌词**。

---

## 结论先行（点名清单）

**必须用户 cookie 才能直连工作的源：无。**

七个源在「搜索 / 播放 URL / 歌词」三动作上的 cookie 需求，全部可被「无 cookie」或「匿名 cookie + 无感获取」覆盖。
没有哪个源被判定为「离开用户登录态 cookie 就无法直连」。

具体区分：

- **完全无需 cookie（三动作全匿名无感）**：QQ、Migu、Soda。
- **需匿名 cookie、可程序化无感获取**：Kugou（播放需匿名设备 cookie，本地生成即可）、Netease（播放/搜索需一个匿名 MUSIC_U 快照，可借他人「无感借用」或自动抓取）、Kuwo（FLAC 播放需用户态 cookie，但 MP3 匿名即可；仅当要求无损时才触达用户态）。
- **播放 URL 高清度/无损档位需用户态 cookie，但提供匿名保底**：Kuwo、Soda（无损/母带档走 VIP 接口，但分享页音频直链本来就匿名可拿）。

因此 **不需要把任何源列入「必须点名上报用户重新决策」**。唯二需要向用户透明说明的折中：
1. **Netease**：要拿到稳定完整结果必须带一个匿名 MUSIC_U，源站不发放给纯匿名请求，需「无感借用/抓取」维护；这是唯一带灰色借用的源，需产品明知同意。
2. **Kuwo**：无损档位离开登录态拿不到；若产品坚持无损，需用户态 cookie（属用户手动负担）。

---

## 逐个源判定

### 1. NetEase（网易云）

**源码**：`musicdl\modules\sources\netease.py`、`musicdl\modules\utils\neteaseutils.py`、`D:\Playground\mplayer\packages\core\src\api\musicApi.ts`

| 动作 | cookie 必需性 | 说明 |
|---|---|---|
| 搜索 | **匿名 cookie 必须** | musicdl `_search` 走 `https://music.163.com/api/cloudsearch/pc`（netase.py `_constructsearchurls` 第 52 行 `base_url`）。MPlayer `musicApi.ts` L676-677 明确注释：「cloudsearch weapi 已被网易云风控(code=50000005, 无 cookie 必现)，直接走旧接口」。musicdl 靠 `default_search_cookies = DEFAULT_COOKIES`（netease.py L42）带上一个 MUSIC_U 才能打通 cloudsearch。旧接口 `/api/search/get/web`（MPlayer L680）可无 cookie 兜底，但结果带会员过滤/缺字段。 |
| 播放 URL | **匿名 cookie 必须** | musicdl `_parsewithofficialapiv1`（netase.py L634-637）用 `EapiCryptoUtils.encryptparams` 打 `/eapi/song/enhance/player/url/v1`，且显式 `cookies := {...}.update(self.default_cookies)`（L636）——播放接口强制携带 MUSIC_U 类 cookie。 |
| 歌词 | **无 cookie 可用** | netase.py L649-650 打 `/api/song/lyric`，未附加 cookie，匿名可拿。 |

- **具体 cookie**：`MUSIC_U`（neteaseutils.py `DEFAULT_COOKIES` L23）。这是**登录态衍生字段**——纯匿名的第一次访问源站不会下发它。
- **无感获取可行性**：**低（需「无感借用」而非纯匿名生成）**。
  - musicdl 直接内置了一个 `DEFAULT_COOKIES['MUSIC_U']` 快照（neteaseutils.py L23）作为免费/借用样本。也就是「借他人已有的一枚匿名 MUSIC_U 常量」。
  - 纯程序化无法从 `music.163.com` 首页 Set-Cookie 获得 MUSIC_U——它只在登录/内部接口下发。可选低摩擦方案：①（产品需知情）内置一枚轮换用的 MUSIC_U 白名单快照，违背「纯匿名」但零用户负担；②注册一个无人认领的网易云账号程序自动登录取 MUSIC_U（涉及账号策略，不建议）；③退回旧接口 `/api/search/get/web` + `/api/song/lyric`（完全无 cookie），播放用 eapi 无 cookie 试（大概率失败，落 50000005）。
  - **有效期/轮换**：MUSIC_U 是长期态（月级），但单账号会有频率风控，需维护 1~N 枚快照轮换；过期后需重新补充。musicdl 的 `cachecookies`（cookies.py L31）提供了一条「写进本地 pickle 缓存」的持久化思路，但获取源头仍是「借用/抓取」而非纯匿名。

> **结论**：网易搜索/播放**匿名 cookie 必须**，且 cookie 无法用「纯匿名 Set-Cookie」无感获得，只能「无感借用」或降级走旧接口。不属「必须用户 cookie」（有匿名快照与无 cookie 旧接口双保底），但需产品明知「借用」性质。

---

### 2. QQ 音乐

**源码**：`musicdl\modules\sources\qq.py`、`musicdl\modules\utils\qqutils.py`

| 动作 | cookie 必需性 | 说明 |
|---|---|---|
| 搜索 | **无 cookie 可用** | qq.py `_search` L390-391 打 `music.u.fcg` 模块 `DoSearchForQQMusicMobile`；`_constructsearchurls` L47 用 `Credential().fromcookiesdict(self.default_cookies or ...)`，QQ 构造器（qq.py L29-36）**未设任何 default cookie**，即 `Credential()` 空凭证。 |
| 播放 URL | **无 cookie 可用（匿名保底）** | qq.py `_parsewithofficialapiv1`：非加密 endpoint（music.u.fcg `UrlGetVkey` L360）用 `Credential().fromcookiesdict(self.default_cookies or {})` + `randomguid()`，免费歌匿名即可出直链；`buildcommonparams`（qqutils.py L277-282）只在有 `musicid+musickey` 时才注入 `qq`/`authst`，空凭证时仅带固定 `uid=3931641530`。 |
| 歌词 | **无 cookie 可用** | qq.py L374-375 打 `c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg`，参数硬编码 `g_tk=5381, loginUin=0`，匿名可用。 |

- **具体 cookie**（仅在与用户登录相关需求时触达）：`uin` + `qqmusic_key`（`musickey`）/微博 `psrf_qqaccess_token` 系。qqutils.py `Credential.fromcookiesdict` L174 映射它们。这些都是登录态字段，但**搜索/匿名播放并不需要**。
- **无感获取可行性**：搜索/普通播放/歌词 **无需 cookie，不涉及获取**。破解/无损档位才触发 `use_encrypted_endpoint`（enc.fcg `CgiGetEVkey`）认证，它需要登录态 musickey——那是「会员破解」范畴，不在本项目匿名直连目标内。
- **有效期/轮换**：不适用。

> **结论**：三动作均可**无 cookie** 工作。不点名。

---

### 3. Kugou（酷狗）

**源码**：`musicdl\modules\sources\kugou.py`、`musicdl\modules\utils\kugouutils.py`

| 动作 | cookie 必需性 | 说明 |
|---|---|---|
| 搜索 | **无 cookie 可用** | kugou.py `_search` L284 打 `songsearch.kugou.com/song_search_v2`（`_constructsearchurls` L47），无免 cookie，纯 UA。 |
| 播放 URL | **匿名 cookie 必须** | kugou.py `_parsewithofficialapiv1` L251 把 `self.default_cookies` 传给 `KugouMusicClientUtils.getsongurl`；其 `initdevice`（kugouutils.py L95-98）**程序化生成**匿名设备四元组 cookie：`KUGOU_API_GUID / KUGOU_API_MID / KUGOU_API_MAC / KUGOU_API_DEV`（`mid=calculatemid(uuid)`，MD5 本地算出）。fallback `trackercdn.kugou.com/i/v2/`（L254）需 `key=MD5(hash+'kgcloudv2')`，本地可算。 |
| 歌词 | **无 cookie 可用** | kugou.py L269 打 `lyrics.kugou.com/search` + `lyrics.kugou.com/download`，纯匿名。 |

- **具体 cookie**：`KUGOU_API_GUID / KUGOU_API_MID / KUGOU_API_MAC / KUGOU_API_DEV`（kugouutils.py L97）——**匿名可分**，`initdevice` 纯本地 UUID+MD5 生成，无需源站任何返回。
- **无感获取可行性**：**高且 100% 程序化**。直接调用等价逻辑本地算出设备 cookie 即嵌到请求，无需先 GET 任何页面收集 Set-Cookie。这正是 musicdl 的 `initdevice` 思路（cookies.py `cachecookies` 可作持久化落盘）。
- **有效期/轮换**：设备 cookie 本身长期稳定；酷狗按 IP/频次风控，建议每会话/每 N 次搜索轮换一组新 `initdevice` cookie。

> **结论**：播放需**匿名 cookie**，可程序化无感获取（本地生成）。不点名。

---

### 4. Migu（咪咕）

**源码**：`musicdl\modules\sources\migu.py`

| 动作 | cookie 必需性 | 说明 |
|---|---|---|
| 搜索 | **无 cookie 可用** | migu.py `_search` L107 打 `c.musicapp.migu.cn/v1.0/content/search_all.do`（`_constructsearchurls` L50）；仅 headers（含 `ua: Android_migu`、`version`、`channel`），无 cookie。 |
| 播放 URL | **无 cookie 可用** | migu.py `_parsewithofficialapiv1` L79 打 `c.musicapp.migu.cn/strategy/listen-url/h5/v2.4`，仅 headers；fallback `listenSong.do` 硬编码 `userId=15548614588710179085069`（L81）。响应可能带 `MIGU_KEY` 对称加密（`_decryptresp` L58-65），但密钥内置于客户端，与 cookie 无关。 |
| 歌词 | **无 cookie 可用** | migu.py L94-95 从 `lyricUrl`/`lrcUrl` 匿名拉取。 |

- **具体 cookie**：无。
- **无感获取可行性**：不适用。
- **有效期/轮换**：不适用。

> **结论**：三动作全 **无 cookie**。不点名。

---

### 5. Kuwo（酷我）

**源码**：`musicdl\modules\sources\kuwo.py`、`musicdl\modules\utils\kuwoutils.py`

| 动作 | cookie 必需性 | 说明 |
|---|---|---|
| 搜索 | **无 cookie 可用** | kuwo.py `_search` L317 打 `www.kuwo.cn/search/searchMusicBykeyWord`（`_constructsearchurls` L51），纯 UA。 |
| 播放 URL | **无 cookie 可用（MP3 档）；用户态 cookie 必须（FLAC 22000 档）** | kuwo.py `_parsewithofficialapiv1` L288-292：`MUSIC_QUALITIES = [(22000,'flac'),(320,'mp3')]`（L36）。MP3(320) 走 `mobi.kuwo.cn/mobi.s`（encryptquery + okhttp UA），匿名可用；FLAC(22000) 与部分星级会员曲目需登录态 cookie。 |
| 歌词 | **无 cookie 可用** | kuwo.py L303-304 打 `newlyric.kuwo.cn/newlyric.lrc`（`buildlyricsparams` + `decodelyrics` 内部解密），匿名可用。 |

- **具体 cookie**：登录态 cookie（VIP/星级会员），**用户态必有**（kuwoutils `buildlyricsparams` 内含 `csrfToken` 式校验量，但仅用于歌词签名，非登录）。
- **无感获取可行性**：MP3/歌词/搜索全部匿名无感；**仅无损档需用户态 cookie**，无法无感。若产品允许以 MP3（320k）作主力、无损仅在登录态用户开启时补，则不构成硬性点名。
- **有效期/轮换**：匿名路径无需轮换。

> **结论**：搜索/歌词/MP3 播放**无 cookie**；**无损播放必须用户 cookie**。若无损是硬性要求则点名，否则不点名。**视为条件性点名项**。

---

### 6. Qianqian（千千/太合）

**源码**：`musicdl\modules\sources\qianqian.py`

| 动作 | cookie 必需性 | 说明 |
|---|---|---|
| 搜索 | **无 cookie 可用** | qianqian.py `_search` L105 打 `music.91q.com/v1/search`（`_constructsearchurls` L62），params 带 `sign`（`_addsignandtstoparams` L50-55 md5 签名），无需登录。 |
| 播放 URL | **无 cookie 可用（access_token 仅为可选增强）** | qianqian.py `__init__` L36/L43/L46：`if self.default_search_cookies: self.default_search_headers['authorization'] = f"access_token {...}"`——**cookie 存在才注入 authorization 头，缺省时匿名请求照常发送**。`_parsewithofficialapiv1` L80 打 `tracklink` 带 sign，匿名可用。 |
| 歌词 | **无 cookie 可用** | qianqian.py L92 直接抓 `search_result['lyric']` 外链，匿名。 |

- **具体 cookie**：`access_token`（从 `default_search_cookies` 注入到 `authorization: access_token` 头，qianqian.py L36）。这是可选的登录态增强，**匿名路径完全不需要**。
- **无感获取可行性**：不需要。若想启用更高档位，access_token 来自百/太合登录，需用户态——但匿名额度已够直连搜索+播放+歌词。
- **有效期/轮换**：不适用（匿名路径）。

> **结论**：三动作**无 cookie**；access_token 是可选增强非必需。不点名。

---

### 7. Soda（汽水音乐）

**源码**：`musicdl\modules\sources\soda.py`、`D:\Playground\mplayer\packages\core\src\api\musicApi.ts`

| 动作 | cookie 必需性 | 说明 |
|---|---|---|
| 搜索 | **匿名 cookie / 设备指纹必须（可无感生成）** | soda.py `_search` L169 打 `api.qishui.com/luna/pc/search/track`（`_constructsearchurls` L63）；查询参数含 `device_id: self.device_id`（L61），`device_id` 可取默认硬编码 `"3753066532709850"`（L35）或任意生成，匿名单设备即可搜索。 |
| 播放 URL | **匿名可用（分享页直链，无 cookie）** | soda.py `_getsongmetainfo` L100 抓 `music.douyin.com/qishui/share/track?track_id={id}` 的 `_ROUTER_DATA`，解析 `audioWithLyricsOption` 直链——**全程无 cookie**。MPlayer `musicApi.ts` `fetchSodaSharePage` L287-316 已实现并注释「无需 Cookie」。VIP/无损档需 `X-Helios/X-Medusa` 认证头（soda.py L37-38 硬编码缺省），但非无损场景可完全绕开。 |
| 歌词 | **无 cookie 可用** | 分享页 `_ROUTER_DATA` 的 `lyrics.sentences` 一并带出（soda.py L104-108），或 VIP 接口 lyric content（L153），匿名可用。 |

- **具体 cookie**：完整登录态需 `X-Helios` / `X-Medusa` / `device_id`（soda.py L34-38）。但 `default_search_cookies` **缺省时使用硬编码缺省值**（L35/37/38 各带 fallback），即匿名设备指纹即可。
- **无感获取可行性**：**高**。`device_id` 本地随机生成即可（MPlayer 已内置固定设备指纹）；`X-Helios` 用 soda.py 内置缺省常量即可支撑匿名档。分享页直链（音乐.douyin.com）完全不依赖 cookie，是最稳妥的匿名播放通道。
- **有效期/轮换**：匿名 `device_id` 长期稳定；高频访问需轮换 device_id + 换 IP。

> **结论**：**匿名即可**（分享页直链无 cookie；搜索/无损用匿名 device 指纹 + 硬编码 X-Helios 缺省）。不点名。若坚持无损档，需登录态 X-Helios/X-Medusa（条件性点名）。

---

## 汇总矩阵

| 源 | 搜索 | 播放 URL | 歌词 | 匿名 cookie 无感获取可行性 | 点名上报用户？ |
|---|---|---|---|---|---|
| **NetEase** | 匿名 cookie 必须（MUSIC_U；cloudsearch 无 cookie 必现 50000005）| 匿名 cookie 必须（eapi player/url 强制带 MUSIC_U）| 无 cookie | **低/借用制**：MUSIC_U 系登录态衍生，源站不向纯匿名下发；仅能内置白名单快照「无感借用」或降级旧接口 `/api/search/get/web` + `/api/song/lyric` | ⚠️ **条件性**：因「借用」非纯匿名需产品明知；但有双保底不属硬点名 |
| **QQ** | 无 cookie | 无 cookie（匿名 GetVkey + guid）| 无 cookie（g_tk=5381）| 不需要 | **否** |
| **Kugou** | 无 cookie | 匿名 cookie 必须（KUGOU_API_GUID/MID/MAC/DEV）| 无 cookie | **高/纯本地生成**：`initdevice` 用 UUID+MD5 本地算出，无需源站返回；`cachecookies` 可落盘 | **否** |
| **Migu** | 无 cookie | 无 cookie（内置 MIGU_KEY 对称解密，非 cookie）| 无 cookie | 不需要 | **否** |
| **Kuwo** | 无 cookie | MP3 档无 cookie；**FLAC/星级 需用户 cookie** | 无 cookie | MP3/歌词匿名 OK；**无损档无法无感** | ⚠️ **条件性（仅当要求无损）** |
| **Qianqian** | 无 cookie | 无 cookie（access_token 为可选头增强）| 无 cookie | 不需要 | **否** |
| **Soda** | 匿名 device 指纹必须（可生成）| 无 cookie（分享页 `_ROUTER_DATA` 直链，MPlayer 已实现）| 无 cookie | **高**：device_id 本地生成 / 内置 X-Helios 缺省；分享页直链最佳匿名通道 | **否**（无损档才需登录态） |

---

## 补充说明

- **通用无感获取脚手架**：musicdl 的 `cookies.py`（`cachecookies` L31 + `cookies2dict` L15）提供「按 client 名把 cookie dict pickle 缓存到本地文件」的通用思路，可复用到 MPlayer 作为 Kugou 设备 cookie 的落盘/复用管理器（不用每次都生成）。它不是「从源站抓取」的通道，仅缓存。
- **NetEase 旧接口保底**：MPlayer `musicApi.ts` L676-680 的注释确认，cloudsearch weapi 无 cookie 必现 `50000005`，故已实现 `/api/search/get/web`（搜索歌手）+ `/api/lyric`（歌词）作为无 cookie 兜底。播放 URL 的匿名直连是目前没有无 cookie 兜底的唯一缺口。

## 参考文件索引

- `C:\Users\Admin\AppData\Local\Temp\musicdl-clone\musicdl\modules\sources\{netease,qq,kugou,kuwo,migu,qianqian,soda}.py`
- `C:\Users\Admin\AppData\Local\Temp\musicdl-clone\musicdl\modules\utils\{misc,neteaseutils,cookies,qqutils,kugouutils,kuwoutils,sodautils}.py`
- `D:\Playground\mplayer\packages\core\src\api\musicApi.ts`（`fetchSodaSharePage`、netease cloudsearch 注释）
