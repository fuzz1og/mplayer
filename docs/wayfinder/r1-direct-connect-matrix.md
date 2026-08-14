# 直连可行性矩阵报告（wayfinder research 资产 — 7 源直连评估）

> 目标：借鉴 musicdl（Python）的**直连**手法，让 MPlayer 客户端直接请求源站接口、逐步替代自建 API（POST `/`，参数 `input/filter/type/page`）。
> 主参考（primary source，均已读源码）：
> - musicdl 克隆：`C:\Users\Admin\AppData\Local\Temp\musicdl-clone\musicdl\modules\sources\{netease,qq,kugou,migu,kuwo,qianqian,soda}.py` 与 `utils\{neteaseutils,qqutils,kugouutils,kuwoutils,sodautils}.py`
> - MPlayer 现状：`packages/core/src/api/musicApi.ts`、`packages/core/src/api/neteaseWeapi.ts`、`src/main/config.ts`
> 结论一律以**源码本身**为准，标「需 R4 核实」处表示源码未覆盖或跨实现不一致、需实测。

---

## 0. 总览：MPlayer 已有直连基础

| 已有直连 | 位置 | 形态 |
|---------|------|------|
| 网易 weapi | `packages/core/src/api/neteaseWeapi.ts`（`weapiEncrypt`/`weapiRequest`）+ `musicApi.ts` 的 `fetchNeteaseSongUrlMap`/`getNeteaseToplist`/`getNeteasePlaylistSongs` 等 | 纯 JS（crypto-js + BigInt-RSA），匿名可用 |
| 网易歌词 | `musicApi.ts:getLyricsBySongId`（`music.163.com/api/song/lyric`，明文） | 明文 GET |
| QQ 热榜 | `musicApi.ts:getQQToplist`（`c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?g_tk=5381`） | 无指纹老接口 |
| 汽水 Soda | `musicApi.ts:searchSongsSoda`（`api.qishui.com/luna/pc/search/track`）、`getSodaAudioUrl`/`fetchSodaSharePage`/`parseSodaShareLink`（`music.douyin.com/qishui/share/track` 的 `_ROUTER_DATA`、`api.qishui.com/luna/pc/track_v2`） | 全直连已落地 |

> `src/main/api/musicApi.ts` 仅是 HTTP 客户端壳（baseURL 动态来自 `src/main/config.ts`），无源逻辑；源逻辑集中在 `packages/core`。**自建 API 当前承载**：网易/QQ/酷狗/咪咕/酷我/千千的通用搜索（`searchSongs`/`searchSongById` POST `/`）、播放 URL 解析（`getAudioUrl` 走源返回 URL）、歌词。

---

## 1. NetEase（网易）—— 已基本可用，补 cloudsearch 即可

### 1.1 端点（musicdl 直连实现）
- **搜索**：`POST https://music.163.com/api/cloudsearch/pc`（`netease.py:_constructsearchurls`），form `{s: keyword, type: 1, limit, offset}`。**无加密**，返回 `result.songs`。
- **歌曲元数据**（解析 URL 兜底时补 title/ar/al/dt）：`POST https://interface3.music.163.com/api/v3/song/detail`，data `{"c": "[{\"id\":<id>,\"v\":0}]"}`（`_getsongmetainfo`）。
- **播放 URL**：musicdl 走 **EAPI** `POST https://interface3.music.163.com/eapi/song/enhance/player/url/v1`，body `{"params": EapiCryptoUtils.encryptparams(...)}`（AES-ECB，见下），callback 解析 `data[0].url`。MPlayer 已用**等价 weapi** 端点 `/song/enhance/player/url/v1`（`fetchNeteaseSongUrlMap`）。
- **歌词**：`POST https://interface3.music.163.com/api/song/lyric`，data `{id, cp:"false", tv:"0", lv:"0", rv:"0", kv:"0", yv:"0", ytv:"0", yrv:"0"}`，解析 `lrc.lyric`（`_parsewithofficialapiv1`）。**无加密**。MPlayer 已实现（`getLyricsBySongId`）。

### 1.2 加密/签名
- EAPI：`neteaseutils.py:EapiCryptoUtils.encryptparams` —— body = `"{urlpath}-36cd479b6b5-{json}-36cd479b6b5-{md5}"`，AES-ECB(pkcs7) 用 key `e82ckenh8dichen8`，输出 hex。JS 重实现成本 **S**（node:crypto `createCipheriv('aes-128-ecb')` 即可，比 weapi 的 AES-CBC+RSA 更简单）。
- **MPlayer 已实现 weapi**（`neteaseWeapi.ts`）：AES-128-CBC 双加密（presetKey `0CoJUm6Qyw8W8jud` + 随机 secretKey）+ RSA-1024 raw 加密 encSecKey，纯 JS（crypto-js + BigInt）已过 RN/Electron。**不用再写 EAPI**——weapi 端点语义一致。

### 1.3 Cookie
- musicdl 硬编码 `DEFAULT_COOKIES['MUSIC_U']`（`neteaseutils.py:23`）。MPlayer 的 weapi 走匿名（注释明确「匿名可用，无需登录 cookie」）。→ **无需用户 cookie**（`MUSIC_U` 用于提音质/去 VIP 检测，不影响免费直连）。

### 1.4 风控
- **较高**：cloudsearch weapi 已被风控，注释指出 `code=50000005, 无 cookie 必现`（`musicApi.ts:676` 附近）。明文 `api/cloudsearch/pc` 与 `api/v3/song/detail`、`api/song/lyric` 仍有匿名可用路径，但搜索接口对匿名请求敏感。**已知反爬阈值**：无 cookie 下搜索/详情高频会触发 `50000005`/`401`。

### 1.5 与 MPlayer 现状差距
- 已有：weapi 播放 URL、weapi 歌单/热榜/歌手、明文歌词、明文歌单旧接口。
- **要新写**：① cloudsearch 搜索直连（现走自建 API）；② EAPI 可选（作 weapi 被限时的备用，成本极低）。→ 差距 **S**。

### 1.6 工作量：**S**。已在 weapi 全家桶上，补一个明文搜索 + 声明的 `url` 直连即可。

---

## 2. QQ（腾讯）—— 直连可行但 QIMEI/签名成本高，热榜已落地

### 2.1 端点
- **搜索**：`POST https://u.y.qq.com/cgi-bin/musicu.fcg`（统一网关，`qq.py:_constructsearchurls`），JSON `{"comm":{...},"music.search.SearchCgiService.DoSearchForQQMusicMobile":{"module":"music.search.SearchCgiService","method":"DoSearchForQQMusicMobile","param":{searchid,query,search_type:0,num_per_page,page_num,highlight:1,grp:1}}}`。回调 `music.search...DoSearchForQQMusicMobile.data.song.list`。
- **歌曲元数据**：同网关 `music.pf_song_detail_svr.get_song_detail_yqq`，param `{song_mid}`（`_getsongmetainfo`）。
- **播放 URL**：同网关 `music.vkey.GetVkey.UrlGetVkey`（`_parsewithofficialapiv1`），param `{filename:["M800"+mid+mid+".mp3"], guid, songmid:[mid], songtype:[0]}`，回调 `...data.midurlinfo[0].purl` → `urljoin("https://isure.stream.qqmusic.qq.com/", purl)`。**若走加密端点 `musics.fcg`** 则需附加 `sign`（`GetEVkey`，mflac/mgg）。
- **歌词**：`GET https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?`，params `{songmid, g_tk:"5381", loginUin:"0", hostUin:"0", format:"json", inCharset, outCharset, platform:"yqq"}`，需 `Referer: https://y.qq.com/portal/player.html`，`lyric` 字段为 **base64** 解码（`_parsewithofficialapiv1`）。

### 2.2 加密/签名
- 非加密 `/musicu.fcg` 的关键是 **comm 里的 QIMEI 设备指纹**。
- `qqutils.py`：`obtainqimei` POST `https://api.tencentmusic.com/tme/trpc/proxy`，body 里 AES-CBC(随机 key 作为 CBC key+iv) + RSA-PKCS1v15 打包 payload，另带 `sign`（MD5 组合）。JS 重实现成本 **M**（node:crypto RSA + AES 齐备）。
- 若用 `musics.fcg` 加密端点：`QQMusicClientUtils.sign(request)`（SHA1 of JSON + 索引/混淆 + base64，`qqutils.py:214`）——**成本 M**，且需 RSA 加密 key（有 PUBLIC_KEY）。

### 2.3 Cookie
- `musicu.fcg` 匿名可获取**免费/低音质** URL；QQ 音乐登录凭据（`musickey`/`uin`）只在 callback `comm` 追加 `qq`/`authst`/`tmeLoginType`（`buildcommonparams`）提升音质/解锁 VIP。→ **匿名 cookie 可无感获取**（低音质+部分 320k）；要完整音质需用户 cookie（**需 R4 核实**当前免登录能拿哪些质量档）。

### 2.4 风控
- **中-高**：QIMEI 本身就是腾讯反爬指纹，多源并发/无 cookie 高频搜索易被要求登录或返回 `code:10001`/空 songlist。热榜旧接口 `fcg_v8_toplist_cp.fcg?g_tk=5381` 已证明匿名可用但属**旧版**，有被下线风险。

### 2.5 与 MPlayer 现状差距
- 已有：热榜 `getQQToplist`（旧接口，非 musicu）。
- **要新写**：QIMEI 获取、musicu 网关搜索+`GetVkey` URL断言、旧接口歌词。→ 差距 **M**（QIMEI 是主要成本）。

### 2.6 工作量：**M**。

---

## 3. Kugou（酷狗）—— 搜索/歌词简单，播放 URL 极难（注册设备+签名）

### 3.1 端点
- **搜索**：`GET https://songsearch.kugou.com/song_search_v2?`，query `{format:"json", keyword, platform:"WebFilter", page, pagesize}` → `data.lists[].hash`（`kugou.py:_constructsearchurls`）。
- **歌曲元数据**：`GET https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=`（`_getsongmetainfo`）。
- **播放 URL（两套）**：
  - **gateway Android（native 主路径）**：`https://gateway.kugou.com/v5/url`，param 含 `{hash,quality,cmd:26,behavior:"play",pid:411,...}`（`kugouutils.py:getsongurl`）+ **`signature`（Android MD5）**，且**必须先注册设备**（`risk/v2/r_register_dev`，AES-CBC + RSA + 设备信息，得到 cookie `dfid`/`KUGOU_API_MID` 等）。
  - **trackercdn 兜底**：`GET https://trackercdn.kugou.com/i/v2/?cdnBackup=1&behavior=download&pid=1&cmd=21&appid=1001&hash=<h>&key=MD5(<h>+"kgcloudv2")`（`kugou.py:254`）——**仅 MD5，无需注册**，但质量受限。
- **歌词**：`GET http://lyrics.kugou.com/search?{keyword,duration,hash}` → `candidates[0].{id,accesskey}`，再 `GET http://lyrics.kugou.com/download?ver=1&client=pc&id=&accesskey=&fmt=lrc&charset=utf8`，`content` **base64** 解码。

### 3.2 加密/签名
- **Android gateway**：`kugouutils.py` `signatureandroid`（MD5，secret `OIlwieks28dk2k092lksi2UIkp`，key 用 `signkey`=MD5(hash+secret+appid+mid+userid)），且注册设备用 AES-CBC（随机 key→MD5 前 16/后 16 作 key/iv）+ RSA-PKCS1v15。JS 重实现成本 **M**（AES/RSA/MD5 都齐，但设备注册协议繁琐）。
- 兜底 `i/v2` 只需 MD5(hash+`kgcloudv2`)——**S**。

### 3.3 Cookie
- **必须匿名设备 cookie**（`KUGOU_API_GUID/MID/MAC/DEV` + `dfid`），由 `initdevice`/`registerdevice` 生成，**非用户登录 cookie、可程序化自建**。→ 无用户 cookie；属「匿名可无感获取」但需**一次设备注册交互**。

### 3.4 风控
- **高**：gateway 要求设备注册正是反爬；无注册直接打 `/v5/url` 会被 403/风控盾。trackercdn `i/v2` 兜底相对宽松但对高并发也限流。搜索接口基本无风控。

### 3.5 与 MPlayer 现状差距
- MPlayer 当前酷狗全部走自建 API（core 无酷狗直连）。
- **要新写**：搜索、设备注册+gateway URL、歌词。→ 差距 **L**（主要是 gateway 设备协议）。

### 3.6 工作量：**L**（若只做 trackercdn MD5 兜底则可降为 **M**，但质量打折）。

---

## 4. Migu（咪咕）—— 中等，注意「AES-CBC」实际是自定义 XOR 流

### 4.1 端点
- **搜索**：`GET https://c.musicapp.migu.cn/v1.0/content/search_all.do?`，query `{text, pageNo, pageSize, isCopyright:1, sort:1, searchSwitch:{song:1,...}}`（`migu.py:_constructsearchurls`）。**正文明文**（`_decryptresp` 仅在带 `signature` 头时走解密）。头含 `ua:Android_migu, version:6.8.8, channel, Origin/Referer: h5.nf.migu.cn`。
- **播放 URL**：`GET https://c.musicapp.migu.cn/strategy/listen-url/h5/v2.4`，query `{contentId, copyrightId, resourceType, netType:"01", toneFlag, scene:"", lowerQualityContentId}`（`_parsewithofficialapiv1`），**头带 `signature:"1"`、`birth:"h5page"`、`Content-Type: application/json`**；响应经 `_decryptresp` 解密后取 `data.url`。兜底 URL 是 `https://app.pd.nf.migu.cn/MIGUM3.0/v1.0/content/sub/listenSong.do?...`（hardcode userId）。
- **歌词**：`search_result['lyricUrl']` 或 `GET https://app.c.nf.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0?...toneFlag=PQ` 取 `data.lrcUrl`，再 GET lrcUrl（`Referer: y.migu.cn`）。

### 4.2 加密/签名
- 任务描述「咪咕 AES-CBC」需修正：源码 `migu.py:_decryptresp` 用的是**自定义 XOR 换位流**（`raw[3]` 取 seed，`(byte + seed - key[i%len]) & 0xFF`，key=`Jk8qzuePiJ1qE3mDYhLQ3T73DtDoAhLP`），触发条件为响应头 `signature=="1"` 或正文以 `\xab\xcd\x01` 开头。
  - JS 重实现成本 **S**（纯字节运算，几行）。
- 无 MD5/HMAC/RSA 请求签名（与千千/酷狗不同）。

### 4.3 Cookie
- 匿名可获取（靠 `ua/version/channel` 伪装 + listen-url 可选 userId）。无用户 cookie。播放 URL 有时钟/活——**需 R4 核实**免登录音质档。

### 4.4 风控
- **中**：`c.musicapp.migu.cn` 对高频无 cookie 请求会返回验证/限流；`signature` 加密响应的存在说明站点会切换加密。相对稳定，反爬不激进。

### 4.5 与 MPlayer 现状差距
- MPlayer 咪咕全部走自建 API。**要新写**：搜索、listen-url+XOR 解密、歌词。→ 差距 **M**。

### 4.6 工作量：**M**（XOR 解密简单，主要在两个官方域 + 可用性核实）。

---

## 5. Kuwo（酷我）—— 复杂（自定义 DES + XOR），建议仅做搜索/歌词

### 5.1 端点
- **搜索**：`GET http://www.kuwo.cn/search/searchMusicBykeyWord?`（`kuwo.py:_constructsearchurls`），query `{vipver:1, client:"kt", ft:"music", cluster:0, strategy:2012, encoding:utf8, rformat:"json", mobi:1, issubtitle:1, show_copyright_off:1, pn, rn, all:keyword}` → `abslist[]`（id 形如 `MUSIC_xxx`）。
- **歌曲元数据**：`GET https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=`（iPhone UA）；兜底 HTML `https://www.kuwo.cn/play_detail/{rid}`（`_getsongmetainfo`）。
- **播放 URL**：`GET http://mobi.kuwo.cn/mobi.s?f=kuwo&q=<encryptquery>`，`encryptquery = base64( DES-CBC(key='ylzsxkwm') of "user=0&corp=kuwo&source=kwplayer_ar_5.1.0.0_B_jiakong_vh.apk&p2p=1&type=convert_url2&sig=0&format=mp3&rid=<rid>" )`，响应文本里正则提取 `http...`（`_parsewithofficialapiv1`）。备选 mflac/mgg 加密档通过 `convert_url2&format=mp3` 换成 320k/flac 亦可，但加密音频解码不稳定。
- **歌词**：`GET http://newlyric.kuwo.cn/newlyric.lrc?<params>`，`params = base64( XOR("user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_<id>&lrcx=1", key='yeelion') )`；响应 `tp=content` 头部后 zlib 解压 → base64 → XOR('yeelion') → **gb18030** 解码（`kuwoutils.buildlyricsparams/decodelyrics`）。

### 5.2 加密/签名
- 任务描述「酷我 AES-CBC」需修正：native URL 用的是**自实现 DES**（`kuwoutils.crypt/des64/subkeys`，key `ylzsxkwm`），JS 需迁移整套位运算 DES（**M**——无现成 npm 库，要照搬 `kuwoutils.py` 纯 JS）。歌词用 **XOR + zlib**（**S**）。
- 对 RN 尤其不友好：`zlib`/`gb18030` 在 RN 无内建。

### 5.3 Cookie
- **无 cookie**（全部匿名，靠 app 协议头伪装）。

### 5.4 风控
- **中-高**：播放 URL 走 `mobi.kuwo.cn` app 协议，url 时效短、频繁请求易 403；站点历史对第三方触发强风控。

### 5.5 与 MPlayer 现状差距
- MPlayer 酷我全走自建 API。**要新写**：搜索、mobi.s URL（自定义 DES）、newlyric 歌词。→ 差距 **L**（URL）。

### 5.6 工作量：**L**（自定义 DES 是硬骨头；若先只做搜索 + 歌词、URL 维持自建 API，则可降 **M**）。

---

## 6. Qianqian（千千/太合）—— 简单，MD5 签名即可，推荐早期直连

### 6.1 端点
- **搜索**：`GET https://music.91q.com/v1/search?`，query `{word, type:"1", pageNo, pageSize:"10", appid:"16073360"}` **+ sign**（`qianqian.py:_constructsearchurls`），头含 `referer: https://music.91q.com/player`、`from: web` → `data.typeTrack[]`。
- **播放 URL**：`GET https://music.91q.com/v1/song/tracklink?`，query `{TSID, appid, rate（'320'等）}` + sign → `data.path` 或 `data.trail_audio_info.path`（`_parsewithofficialapiv1`）。
- **歌词**：直接 GET `search_result['lyric']`（明文 lrc URL），UTF-8 文本（`_parsewithofficialapiv1`）。

### 6.2 加密/签名
- **`sign = MD5( sorted_param_string + secret )`**，secret=`0b50b02fd0d73a9c4c8c3a781c30845f`，并先加 `timestamp`（`_addsignandtstoparams`）。JS 成本 **S**（node:crypto md5）。
- 可选 `authorization: access_token <token>` 头（有登录 cookie 时）。

### 6.3 Cookie
- **匿名优先**：`from:web` + referer + MD5 签名即可，**无需 cookie**。登录 access_token 仅当提供时附加。

### 6.4 风控
- **低-中**：签名固定 secret、appid 公开，反爬主要通过 referer/UA 校验；对普通用户量级稳定（源流量较小，流量小即反爬轻）。

### 6.5 与 MPlayer 现状差距
- MPlayer 千千全走自建 API。**要新写**：搜索、tracklink 签名、歌词。→ 差距 **S**。

### 6.6 工作量：**S**。

---

## 7. Soda（汽水）—— **已直连落地**，仅差播放加密/全尺寸

### 7.1 端点（musicdl 与 MPlayer 一致）
- **搜索**：`GET https://api.qishui.com/luna/pc/search/track?`，query `{q, cursor, search_method:"input", aid:"386088", device_platform, channel}` 等（`soda.py:_constructsearchurls`；MPlayer `searchSongsSoda` 同）。
- **播放 URL（非 VIP）**：**无登录路径** —— 抓 `https://music.douyin.com/qishui/share/track?track_id=` 的 `_ROUTER_DATA.loaderData.track_page.audioWithLyricsOption.url`（audition URL，`soda.py:_getsongmetainfo`；MPlayer `fetchSodaSharePage` 同）。**VIP 路径**：`POST https://api.qishui.com/luna/pc/track_v2?...` body `{media_type:"track",track_id}` → `track.track_player.url_player_info` → `Result.Data.PlayInfoList[].MainPlayUrl`，附 `PlayAuth`（`_parsewithofficialvipapiv1`；MPlayer `getSodaAudioUrl` 同）。
- **歌词**：share 页 `_ROUTER_DATA` 的 `sentences`；或 `track_v2` 的 `lyric.content`（需 `SodaTimedLyricsParser` 结构化→LRC）。

### 7.2 加密/签名
- 无请求签名，但有**设备指纹参数**：`device_id`/`fp`（`uid`/`iid` 固定可复用）。
- **VIP 加密音频**：`PlayAuth` → `SpadeDecryptor.extractkey` 提取 hex key → `AudioDecryptor` AES-**CTR** 逐 sample 解密 m4a（`sodautils.py:SpadeDecryptor/AudioDecryptor`，需解析 mp4 box `moov/trak/mdia/minf/stbl/senc/mdat`）。JS 成本 **M**（node:crypto aes-ctr 齐，mp4 box 解析要手写）。

### 7.3 Cookie
- 非 VIP 走 share 页 `_ROUTER_DATA`：**完全无 cookie**。VIP 走 `track_v2` 需 `X-Helios`/`X-Medusa`/`device_id` **（需 R4 核实免登录是否能拿非 m4a 直链）**——MPlayer 现已用 track_v2 且声明「无需 Cookie」。

### 7.4 风控
- **低-中**：share 页路径近乎公开（分享页本就是公开资源）；track_v2 对匿名较宽容（MPlayer 已线上稳定）。抖音系整体反爬强，但 share 页是弱口。

### 7.5 与 MPlayer 现状差距
- **几乎无差距**：搜索、share 页 URL、track_v2 URL、分享链接解析**全部已实现**。
- **要新写**：① 播放时若拿到的是 `play_auth` 加密 m4a 的完整下载/离线；② 歌词直连组织（LRC 解析已有 `SodaTimedLyricsParser` 思路，MPlayer 歌词走自建 API 或 share 页）。→ 差距 **S~M**。

### 7.6 工作量：**S**（若不算 m4a 解密）~ **M**（含 play_auth 加密音频解码）。

---

## 7.7 与自建 API 的替换路线（横向）

现自建 API（`musicApi.ts:searchSongs`/`searchSongById` POST `/`，参数 `input/filter/type/page`）统一承载「搜索+按 ID 解析」两件事。直连化时应**保持 `Song` 数据模型不变**（`id/name/artist/album/url/cover/lrc/duration/sourceType`），在每个 `SourceKey` 分支内提供直连 `searchSongs`/`searchSongById`/`resolvePlayableUrl`，使上层渲染/播放零改动。Soda 已是此模式的范例（`searchSongs` 内 `if (sourceType === 'soda')` 走直连）。

### 7.8 目标态：直连层放哪
- 直连逻辑建议落在 **`packages/core/src/api/`**（与现有 weapi/soda 同层、可被桌面与移动端共用），按源拆 `netease/qq/kugou/migu/kuwo/qianqian` 子模块，复用 `packages/core/src/api/antiScrape.ts` 的 `getAntiScrapeHeaders` 与 `beforeRequest` 与资源缓存（`cacheManager`）。
- 播放 URL 的「取直链→重定向展开」已由 `musicApi.ts:getAudioUrl` + `packages/core/src/utils/songResolver.ts` 承载，直连只负责产出**未展开**的源直链即可。

---

## 8. 汇总矩阵

| 源 | 搜索 | 播放 URL | 歌词 | Cookie 需求 | 加密封装 | 风控 | 实现缺口 | 工作量 |
|----|------|---------|------|------------|---------|------|---------|--------|
| NetEase | 明文 `/api/cloudsearch/pc`（需新写） | weapi `/song/enhance/player/url/v1` **已有** | `/api/song/lyric` 明文 **已有** | 免 cookie（匿名 weapi） | weapi AES-CBC+RSA（已有）；EAPI AES-ECB（可选） | 高（cloudsearch 触发 50000005） | **S**：补 cloudsearch | **S** |
| QQ | musicu.fcg `DoSearchForQQMusicMobile`（需新写） | musicu.fcg `GetVkey`（需新写） | `fcg_query_lyric_new.fcg` base64（需新写） | 匿名获取低/320k；VIP 音质需用户 cookie（**需 R4 核实**） | QIMEI 指纹（AES+RSA，成本 M） | 中-高 | **M**：QIMEI + 网关三接口 | **M** |
| Kugou | `song_search_v2`（需新写） | gateway `/v5/url` 设备注册 + 签名 或 trackercdn MD5 兜底（需新写） | lyrics.kugou.com base64（需新写） | 匿名，但需程序化设备注册（非用户 cookie） | Android MD5(AES+RSA 注册，M)；兜底仅 MD5(hash+kgcloudv2) | 高 | **L**：gateway 协议最重 | **L**（兜底 M） |
| Migu | `search_all.do`（需新写） | `listen-url/h5/v2.4` XOR 解密（需新写） | `pc/listen/v1.0` lrcUrl（需新写） | 免 cookie | 自定义 XOR 流（实为 XOR 非 AES-CBC，S） | 中 | **M** | **M** |
| Kuwo | `searchMusicBykeyWord`（需新写） | `mobi.s convert_url2` 自定义 DES（需新写，最重） | `newlyric.lrc` XOR+zlib+gb18030（需新写，RN 不友好） | 免 cookie | 自定义 DES（M）+ XOR/zlib（S） | 中-高 | **L** | **L**（仅搜索+歌词 M） |
| Qianqian | `/v1/search` MD5 签名（需新写） | `/v1/song/tracklink` MD5 签名（需新写） | 歌词直接 lrc URL（需新写） | 免 cookie | MD5(sorted+secret+ts)（S） | 低-中 | **S** | **S** |
| Soda | `luna/pc/search/track` **已有** | share 页 `_ROUTER_DATA` + `track_v2` **已有** | share 页 `sentences`/`track_v2` lyric（需组织） | 非 VIP 免 cookie；track_v2 免 cookie（**需 R4 核实**音质） | 无请求签名；登录路径 `PlayAuth` → AES-CTR 解码 m4a（M） | 低-中 | **S~M**：仅差 m4a 解密/歌词组织 | **S~M** |

---

## 9. 建议直连优先级初排

1. **NetEase（S）**——weapi/歌词/热榜已就绪，补一个明文 cloudsearch 搜索即可 100% 替代网易侧自建 API；对整体曲库覆盖率最高。
2. **Soda（S~M）**——几乎全部已直连（搜索/分享页 URL/track_v2），只需补歌词组织 + 可选 m4a 解密；差异最小、见效最快。
3. **Qianqian（S）**——MD5 签名简单、免 cookie、风控低；小量级源，顺手直连替代。
4. **Migu（M）**——XOR 解密简单，成本中等，可作为第二梯队。
5. **QQ（M）**——依赖 QIMEI 设备指纹（腾讯反爬核心），需仔细实测免登录音质档；热榜旧接口已有一条匿名曲线可先替代热榜，再决定是否做完整网关。
6. **Kugou（L / MD5 兜底 M）**——native gateway 设备注册最重；**建议先做 trackercdn MD5 兜底**拿有质量无保障的直链，native 延后。
7. **Kuwo（L）**——自定义 DES + RN 无 zlib/gb18030，成本最高、收益有限；**建议仅直连搜索+歌词，播放 URL 暂留自建 API**。

> 关键澄清（务必并入结论）：任务说明中的「咪咕 AES-CBC、酷我 AES-CBC」与源码不符：
> - 咪咕播放响应解密是**自定义 XOR 换位**（非 AES-CBC）。
> - 酷我 native URL 是**自实现 DES**（`ylzsxkwm`）+ 歌词 **XOR/zlib**（非 AES-CBC）。
> 据此调整实现与库选型（JS 都用 `node:crypto` + 手写位运算，`crypto-js`/forge 对这两种自定义算法帮助有限）。

---

## 10. 实现库选型与跨端注意（汇总）

| 算法 | 出现源 | 推荐 JS 库 |
|------|--------|-----------|
| AES-128-CBC（weapi 双加密 + QIMEI payload、kugou 注册） | NetEase / QQ / Kugou | `node:crypto`（`createCipheriv`）；RN 下 `crypto-js`（MPlayer weapi 已用，RN 友好） |
| AES-128-ECB + MD5（EAPI） | NetEase（可选） | `node:crypto`/`crypto-js`，均 S |
| RSA-1024/AES-CBC（weapi encSecKey、QQ QIMEI、kugou 设备注册） | NetEase / QQ / Kugou | `node:crypto`；MPlayer weapi 已用 BigInt 自实现，可复用 |
| AES-CTR 解密 m4a（PlayAuth） | Soda | `node:crypto`（`createDecipheriv('aes-128-ctr')`），RN 需 `react-native-quick-crypto` |
| 自定义 XOR 换位（MIGU_KEY） | Migu | 手写循环，<10 行，任何环境 |
| 自定义 DES（`ylzsxkwm`）+ XOR/zlib/gb18030 | Kuwo | **无现成库**，需照搬 `kuwoutils.py` 位运算；`zlib`/`gb18030` 在 RN 无内建 → **RN 侧成本显著** |
| MD5(sorted+secret+ts) | Qianqian | `node:crypto`/`crypto-js`，S |

**跨端硬约束**：
- RN 依赖 `zlib`、`TextDecoder('gb18030')` 的源（Kuwo 歌词、Kugou 部分响应）在 `packages/core` 层不可直接跑，需在 Electron 侧（`src/main`）做或引入 polyfill —— 这是 Kuwo 判 L 的关键原因之一。
- JS 大整数 RSA（weapi）已证 RN 可行；QIMEI/设备注册的 RSA-AES 组装逻辑同理，可迁但需逐字节对齐 Python `padding` 行为（PKCS7/PKCS1v15）。

---

## 11. 风险登记（直连化的共性开关）

| 风险 | 受影响源 | 缓解 |
|------|---------|------|
| 无 cookie 时播放 URL 时效短、音质档收窄 | 全部（尤其 QQ/Kugou/Migu） | 走 `getAudioUrl` 重定向缓存（TTL 12h）；对 URL 缓存做 fresh 重试（MPlayer 已有 `searchSongById(force)` 路径） |
| 搜索接口被风控（code 50000005/401） | NetEase | weapi 兜底旧接口 + cloudsearch 降频；保留自建 API 作 last-resort |
| QIMEI/设备注册被识别 | QQ / Kugou | 复用固定伪设备指纹、控制并发（参考 MPlayer `batchSearch` 的 `concurrency` 参数） |
| 自定义算法迁移出错 | Kuwo / Migu | 以 Python 源码为唯一基准，落地时逐样本对照 musicdl 输出（单元测试） |
| 自建 API 与直连并存的语义漂移 | 全部 | 每个源直连输出先对齐 `findExactMatch`/`Song` 模型，双跑对比后再切流量 |

---

## 12. 优先级打分（成本×风险×覆盖率加权）
| 排名 | 源 | 工作量 | 风控 | 覆盖收益 | 理由 |
|----|----|-------|------|---------|------|
| 1 | NetEase | S | 中-高 | 高 | 基础设施已 90% 就位 |
| 2 | Soda | S~M | 低-中 | 中 | 已直连，收尾成本最低 |
| 3 | Qianqian | S | 低 | 低 | 签名简单、免 cookie |
| 4 | Migu | M | 中 | 中 | XOR 简单，价值稳定 |
| 5 | QQ | M | 中-高 | 高 | QIMEI 是主要投入 |
| 6 | Kugou | L（兜底 M） | 高 | 中 | native 太重，建议 MD5 兜底先行 |
| 7 | Kuwo | L | 中-高 | 低 | RN 不友好 + 自定义 DES |

---

## 13. 落地拆解（每源具体步骤）

> 供直接 transition 到实现使用；每源均按「先替代本源的搜索/播放/歌词三类请求之一」拆分，可各自独立上线并保留自建 API 兜底。

### 13.1 NetEase（第一批）
1. 新增 `packages/core/src/api/neteaseDirect.ts`：`searchCloud(kw, page)` → `POST music.163.com/api/cloudsearch/pc`（form `s/type:1/limit/offset`），映射 `result.songs` 到 `Song`（复用 `processNeteaseTrack`）。
2. 在 `musicApi.ts:searchSongs` 的 `sourceType==='netease'` 分支优先走 `searchCloud`，失败回退现自建 API。
3. 播放 URL / 歌词已由 weapi + `getLyricsBySongId` 直连，不需动。
4. （可选）补 `neteaseEapi.ts`：`encryptparams`（AES-ECB）作为 weapi 被 `50000005` 阻断时的备用。

### 13.2 Soda（收尾）
1. 新增 `sodaLyrics(trackId)`：解析 share 页 `_ROUTER_DATA.loaderData.track_page.audioWithLyricsOption.lyrics.sentences` → LRC（照 `SodaTimedLyricsParser`）。
2. 评估是否做 `track_v2` 的 `PlayAuth` AES-CTR m4a 解密（纯播放如已能拿非 m4a 直链则可跳过）。
3. 已在用的 `searchSongsSoda`/`getSodaAudioUrl`/`parseSodaShareLink` 纳入直连层统一管理。

### 13.3 Qianqian（第一批）
1. `qianqianSign(params)`：补 `timestamp`，`sign=md5(sorted_kv+secret)`，secret=`0b50b02fd0d73a9c4c8c3a781c30845f`。
2. 新增 `searchSongs` → `GET music.91q.com/v1/search`（`word/type/pageNo/pageSize/appid`+sign）；`resolvePlayableUrl` → `GET music.91q.com/v1/song/tracklink`（`TSID/appid/rate`+sign）取 `data.path`；歌词取 `search_result.lyric`。
3. 头固定带 `referer: https://music.91q.com/player`、`from: web`。

### 13.4 Migu（第二梯队）
1. `decryptMigu(resp)`：按 `body` 是否以 `\xab\xcd\x01` 开头或 `signature=="1"` 头，走 XOR 换位（seed=byte[3]，key=`Jk8qzuePiJ1qE3mDYhLQ3T73DtDoAhLP`）再 `JSON.parse`。
2. 搜索 `search_all.do`；URL `strategy/listen-url/h5/v2.4`（头带 `signature:"1"`/`birth:"h5page"`）；歌词经 `pc/listen/v1.0` 取 lrcUrl。
3. 播放 URL 用 `toneFlag` 轮询 LQ/PQ/HQ/SQ，取首个 `data.url` 以 http 开头的档。

### 13.5 QQ（第三梯队）
1. 先摘热榜：现有 `getQQToplist` 已用 `fcg_v8_toplist_cp.fcg?g_tk=5381`；建议稳它的新歌榜路径，不动 QIMEI。
2. 再做完整 gateway（需 QIMEI）：`QQMusicClientUtils.obtainqimei` 的 AES-CBC+RSA 组装迁 JS；`musicu.fcg` 搜索 + `GetVkey` 取 `purl`；歌词 `fcg_query_lyric_new.fcg`（base64 解码）。
3. 若走 `musics.fcg` 加密端点再引 `sign`，否则跳过以省成本。

### 13.6 Kugou（第三梯队，MD5 兜底优先）
1. 搜索 `song_search_v2` 拿 `hash`。
2. **优先** trackercdn 兜底：`GET trackercdn.kugou.com/i/v2/?cmd=21&pid=1&appid=1001&hash=&key=MD5(hash+"kgcloudv2")`（S 成本，质量受限）。
3. 歌词 lyrics.kugou.com search/download（base64）。native gateway（设备注册+签名）延后单独立项。

### 13.7 Kuwo（最后，仅搜索+歌词）
1. 搜索 `searchMusicBykeyWord` → `abslist`。
2. 歌词 `newlyric.lrc`（XOR+zlib+gb18030）——RN 需 polyfill。
3. 播放 URL 的自定义 DES 成本高、收益低：**不迁，维持自建 API**，标记为「长期保留自建 API 的源」。

### 13.8 切换策略与退回开关
- 每源用一个来源开关（建议并入 `packages/core` 常量表，仿现有 `MULTI_SOURCE_LIST`）：`'auto'|'direct'|'api'`，默认 `auto`（直连优先，失败自动回退自建 API），上线后逐源切到 `direct`。
- 播放 URL 失败一律走 `getAudioUrl` 的重试 + fresh 重试，避免把瞬时 403 误判为「该源不可直连」。
