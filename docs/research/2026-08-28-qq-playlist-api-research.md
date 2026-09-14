# QQ 音乐歌单原生接口调研（链接导入直连化）

> 调研日期: 2026-08-28 · 关联: [fuzz1og/mplayer#270](https://github.com/fuzz1og/mplayer/issues/270)（part of #238 / #244 resolution）
> 调研方法: 本项目代码审读 + **curl/python 实测 QQ 接口（2026-08-28 全部当日验证）** + 社区逆向项目源码比对
> 本文为社区逆向、非官方接口调研，仅用于学习研究，见 [风险面 / 合规](#5-风险面)。

---

## 0. 结论先行

**判定：可行（推荐走 musicu 网关匿名 module，不需要 unmeta，也不需要签名/cookie）。**

QQ 音乐存在可匿名直连的歌单详情接口：`POST https://u.y.qq.com/cgi-bin/musicu.fcg` + module `music.srfDissInfo.DissInfo / CgiGetDiss`。**无需登录、无需 cookie、无需 QIMEI、无需签名、无需 Referer**，走本项目 qqDirect 已验证的 musicu POST 通道（RN 真机安全），实测可分页拉全量曲目（songmid/歌曲数字 ID/歌名/歌手/专辑/封面/时长齐全）。短链 → disstid 解析为 302 Location 提取，机制当日实测打通。旧版 `c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg` GET 接口对公开歌单同样匿名可用（社区双项目在用），但强制 Referer（移动端 RN 有已知被拒风险，见 `packages/core/src/api/qqDirect.ts` 歌词注释）且对部分歌单报 `check privacy error`，只建议作桌面端兜底腿。

与旧调研 [`multi-source-api-research.md`](multi-source-api-research.md) 中「QQ 推荐歌单 ❌ 需登录」**不矛盾**：该结论针对个性化推荐歌单列表（personalized）；本文调研的是**按 disstid 拉指定歌单详情**，两者是不同接口，后者匿名可用（且旧调研第 1 节实测的 fcg GET 家族鉴权结论——仅需 UA + Referer——与本文实测一致）。

---

## 1. 接口清单（全部 2026-08-28 实测）

### 1.1 推荐：musicu 网关 `music.srfDissInfo.DissInfo / CgiGetDiss` ✅ 当日实测匿名可用

- **URL / 方法**: `POST https://u.y.qq.com/cgi-bin/musicu.fcg`
- **鉴权**: 无。无 cookie、无 sign、无 Referer 均实测通过；`comm` 用最小 `{ct:24, cv:0}` 或本项目 `buildCommon()` 形态 `{cv:1601, v:1601, QIMEI36:<静态兜底>}` 都返回 code 0（实测）。
- **请求体**（实测可用形态）:

```json
{
  "comm": { "ct": 24, "cv": 0 },
  "req_0": {
    "module": "music.srfDissInfo.DissInfo",
    "method": "CgiGetDiss",
    "param": {
      "disstid": 7729596131,
      "dirid": 0,
      "tag": true,
      "song_begin": 0,
      "song_num": 100,
      "userinfo": true,
      "orderlist": true,
      "onlysonglist": false
    }
  }
}
```

- **返回结构**（实测 `req_0.data`）:
  - `dirinfo`: `{ id, title, picurl(https 封面，600px), songnum(总曲数), creator{nick,encrypt_uin,...}, desc, tag, listennum, ctime/mtime }`
  - `songlist[]`: **新版歌曲对象**，字段 `{ id(数字歌曲ID), mid(songmid), title(歌名), singer[{mid,id,name}], album{id,mid,name}, interval(秒), file{media 信息}, pay, ... }` —— 与本项目 qqDirect `mapTrack()` 期望的新版形态（`mid/title/singer/album.mid/interval`）**逐字段吻合，可原样复用**
  - 分页: `hasmore`(0/1) + `songlist_size`(本页条数) + `total_song_num`(总数)；`song_begin`/`song_num` 翻页实测正常（begin=5 返回第 6 首起）
  - **单次大页实测**: `song_num=1400` 一次返回全部 1233 首，`hasmore=0` —— 导入场景可一枪全量
- **边界（实测）**:
  - 歌单不存在/已删除: `req_0.data.code = -100006`，msg `get diss info from tmem error`
  - 主人设隐私: 仍 `code=0`，但 `dirinfo.title = "歌单被主人设为隐私"` 且 `songnum=0` —— 以此信号给用户友好报错
- **来源**:
  - 实测（本文当日 curl/python，实测命令见附录 A）
  - [luren-dc/QQMusicApi `qqmusic_api/modules/songlist.py`](https://github.com/luren-dc/QQMusicApi/blob/main/qqmusic_api/modules/songlist.py)（活跃维护的 Python 逆向库，`get_detail` 同 module/method/param，含同款分页策略 `song_begin/song_num + hasmore`）
  - [luren-dc/QQMusicApi `qqmusic_api/core/api_context.py`](https://github.com/luren-dc/QQMusicApi/blob/main/qqmusic_api/core/api_context.py)（musicu.fcg POST 封装；sign 为可选开关，URL 在 `musicu.fcg`/`musics.fcg` 间切换）

### 1.2 同族备选：`music.srfDissInfo.aiDissInfo / uniform_get_Dissinfo` ✅ 当日实测匿名可用

- 同 URL/同鉴权（无 sign/cookie/Referer），param `{disstid, enc_host_uin:"", tag:1, userinfo:1, song_begin, song_num}`，返回同 1.1（`mid/title/...` 新版字段）。
- **来源**: [Bistutu/GoMusic `misc/models/qqmusic.go`](https://github.com/Bistutu/GoMusic/blob/main/misc/models/qqmusic.go)（在线歌单迁移工具，生产在用）+ 当日实测（7729596131，code 0，1233 首）。
- 与 1.1 二选一即可；GoMusic 按每页 30 首翻页，本项目可用更大 `song_num` 减少请求次数。

### 1.3 旧版兜底（仅桌面）：qzone fcg GET `fcg_ucc_getcdinfo_byids_cp.fcg` ⚠️ 匿名可用但有硬伤

- **URL / 方法**: `GET https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&utf8=1&format=json&disstid={id}&loginUin=0&hostUin=0&notice=0&platform=yqq&needNewCode=0&g_tk=5381&inCharset=utf8&outCharset=utf-8`
- **实测结论**:
  - 匿名（无 cookie）可拉公开歌单全量：实测 7729596131 返回 `cdlist[0].songlist` 1233 首（与 `total_song_num` 一致），歌单封面 `cdlist[0].logo`
  - **强制 Referer**: 不带 `Referer: https://y.qq.com/` → `{"code":0,"subcode":1,"msg":"invalid referer"}`（实测）。RN 真机网络栈发 c.y.qq.com fcg GET 会被拒（本项目已在歌词链路踩过，见 `packages/core/src/api/qqDirect.ts` `fetchLyricViaGateway` 注释）→ **移动端不可依赖此腿**
  - 部分歌单 → `{"code":0,"subcode":4000,"msg":"check privacy error!"}`（实测 7707261125/7578943835；同 id 在 1.1 接口正常返回 66 首）——旧接口比 1.1 **能力更弱**
  - 返回字段为旧版名：`songmid/songname/singer[]/albummid/albumname/interval/strMediaMid/size128/size320`
- **来源**: 实测 + [jsososo/QQMusicApi `routes/songlist.js`](https://github.com/jsososo/QQMusicApi/blob/master/routes/songlist.js)（同 URL + `Referer: https://y.qq.com/n/yqq/playlist`）+ [Rain120/qq-music-api `src/services/songLists/songListDetail.ts`](https://github.com/Rain120/qq-music-api/blob/main/src/services/songLists/songListDetail.ts)（同 URL，param `type:1, utf8:1, onlysong:0, new_format:1`）

### 1.4 实测**不可**匿名直连的 module（排除项）

| module / method | 实测结果 | 结论 |
|---|---|---|
| `music.srfDissDetail.SIGetDissInfo`（y.qq.com web 页面用的签名版） | 无 sign → `code 500003 / subcode 860100001` | 需 zzc 签名，不选 |
| `music.playlist.PlaylistInfo / get_playlist_by_id` | `code 500003 / subcode 860100001` | 排除 |
| `playlist.PlaylistSonglistPage / GetSonglistPage` | `code 500003 / subcode 860100005` | 需签名，排除 |

签名参考（若未来必须走签名 module 才需要）: zzc 签名算法（SHA1 + 位混淆 + base64）见 [luren-dc/QQMusicApi `algorithms/sign.py`](https://github.com/luren-dc/QQMusicApi/blob/main/qqmusic_api/algorithms/sign.py)；GoMusic 用旧版 `zzb` 签名（[`misc/utils/qqmusic_sign.go`](https://github.com/Bistutu/GoMusic/blob/main/misc/utils/qqmusic_sign.go)，走 `u6.y.qq.com/cgi-bin/musics.fcg?sign=...`）。**推荐路径不涉及签名，不存在签名轮换风险。**

### 1.5 短链/分享链接 → disstid 解析 ✅ 机制当日实测打通

QQ 歌单分享链接的已知形态（[GoMusic `logic/qqmusic_test.go`](https://github.com/Bistutu/GoMusic/blob/main/logic/qqmusic_test.go) 收录的真实样例 + 本项目 `parsePlaylistUrl` 现状）:

| 形态 | 解析方式 | 来源/实测 |
|---|---|---|
| `https://c6.y.qq.com/base/fcgi-bin/u?__=xxx`（短链，App 分享默认） | **不跟随重定向**，读 302 `Location` 头，对目标 URL 递归解析 | 实测: 歌曲分享短链 302 → `https://i.y.qq.com/v8/playsong.html?...&songmid=000XjcLg0fbRjv&type=0`（机制当日打通）；[qaiu/netdisk-fast-download `MqqsTool.java`](https://github.com/qaiu/netdisk-fast-download/blob/main/parser/src/main/java/cn/qaiu/parser/impl/MqqsTool.java) 同样读 Location |
| 302 目标 A: `i.y.qq.com/n2/m/share/details/taoge.html?id={disstid}&...`（歌单 H5 分享页） | 取 `id` 参数（纯数字） | GoMusic 测试样例；实测 taoge.html 302 → `i2.y.qq.com/n3/other/pages/details/playlist.html?id={disstid}&redirect_from=node_v2`（id 保留）；实测这些 id 在 1.1 接口正常（5204875759 → 817 首、930054744 → 289 首） |
| 302 目标 B: `y.qq.com/n/ryqq/playlist/{disstid}`（web 歌单页） | 路径取 `playlist/` 后数字 | GoMusic 测试样例；实测 `y.qq.com/n/ryqq/playlist/7729596131` → 302 `y.qq.com/n/ryqq_v2/playlist/7729596131`（id 在路径，前缀会升级 ryqq→ryqq_v2，解析须兼容） |
| 302 目标 C: `i.y.qq.com/v8/playsong.html?songmid=.../songid=...`（歌曲分享，非歌单） | 无 disstid，应提示「这是歌曲链接」 | 实测 |
| ⚠️ 短链 token 有时效 | 旧 token 会 404（GoMusic 2024 样例 `__=4V33zWKDE3tI` 实测已 404）；新鲜生成的分享链接有效 | 实测 |

### 1.6 附带验证：歌单列表接口（本次不需要，仅佐证家族活性）

`GET https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg?format=json&platform=yqq&hostUin=0&sin=0&ein=29&sortId=5&categoryId=10000000` + Referer —— 匿名 code 0 返回歌单列表（disstid/dissname/imgurl/listennum），当日实测。

---

## 2. 与现有 qqDirect 的复用评估

对照 `packages/core/src/api/qqDirect.ts`：

| 现有基建 | 复用评估 |
|---|---|
| `musicuPost()`（POST musicu.fcg + `MUSICU_HEADERS`） | **直接复用**。1.1 接口即普通 musicu POST；实测带不带 Referer 都通过，现有 headers 不用动 |
| `buildCommon()`（cv1601 + QIMEI36）/ `ensureQ36()` | **直接复用**。实测该 comm 形态对 CgiGetDiss 返回 code 0；甚至可退化到 `{ct:24,cv:0}`（不依赖 QIMEI），二选一 |
| `mapTrack()` | **原样复用**。CgiGetDiss 的 songlist 是新版字段（`mid/title/singer/album.mid/interval`），与 `mapTrack` 的取值路径完全吻合；歌词 URL `buildLyricUrl(mid)` 也随之可用 |
| `transport.request`（T01 接缝，测试注入） | **直接复用**。新函数照 qqDirect 模式走 transport，测试 mock 传输 |
| QIMEI RSA/AES（`obtainQimei`） | 不涉及改动。歌单接口对 QIMEI36 不敏感（静态兜底值实测可用） |

**与网易参考实现的对位**：`musicApi.getNeteasePlaylistSongs/Page`（`packages/core/src/api/musicApi.ts` 2212–2295 行，weapi trackIds + `/v3/song/detail` 分批 + 缓存）的模式可以照搬：`getQqPlaylistSongs(disstid)`（全量导入用）+ 可选 `getQqPlaylistSongsPage`（详情页分页用，`song_begin/song_num` 天然支持）+ `cacheManager` 缓存。差异点：QQ 一次 `song_num=1400` 即可全量，不需要 1000-id 分批取详情的两段式。

**现有调用链（需替换的 unmeta 段）**：`ImportPlaylistModal.tsx` → `parsePlaylistUrl`（`packages/core/src/api/playlistImport.ts`，type `'qq'` 仅匹配 `__=` 短链）→ IPC `getPlaylistSongsFromThirdParty`（`musicApi.ts` 2474–2517 行，POST `sss.unmeta.cn` 拿「歌名 - 歌手」文本 → `batchSearch` 按名识别）→ `musicApiContract.ts` / `musicApiHandlers.ts`。

---

## 3. 对接建议

1. **core 新增 `qqPlaylist.ts`**（或并入 `qqDirect.ts`）两个函数：`resolveQqPlaylistDisstid(url: string): Promise<number | null>`（多形态正则：`__=` 短链 → transport 发 HEAD/GET 不跟随读 Location → 对目标递归解析 `taoge.html?id=`/`playlist/\d+`；直连 taoge/ryqq 链接直接正则）与 `getQqPlaylistSongs(disstid, limit=0)`（`musicuPost` CgiGetDiss，`song_num` 一次给大值拿全量，`hasmore` 兜底翻页；`dirinfo.title="歌单被主人设为隐私"`/`data.code=-100006` 映射为带语义的错误）。歌曲经 `mapTrack` 映射，`url` 留空交给现有 `resolvePlayableSongRouted`（播放时解析，导入无需逐首 GetVkey）。
2. **先做 core 内部函数 + musicApi 方法，暂不加进 DirectSourceClient 能力面**。`DirectSourceClient` 现只有 `search/resolvePlayableUrl/resolveUrlInfo` 三个播放系能力（`packages/core/src/shared/sourceRouter.ts` 38–46 行），歌单导入是 musicApi 层的关注点——网易对位实现 `getNeteasePlaylistSongs` 也在 musicApi 而非 sourceRouter，保持对称。等将来「源间歌单迁移/浏览」要泛化时再提升为能力面方法。
3. **`parsePlaylistUrl` 需扩容**（见 §4 冲突清单第 1 条），否则只认识 `__=` 短链，直接粘贴的 web/taoge 链接仍走不进原生腿。
4. **接线**：`musicApiContract.ts` 增加 `getQqPlaylistSongsFromLink`（或复用现有通道改语义），`musicApiHandlers.ts` 注册，`ImportPlaylistModal` 的 `type==='qq'` 分支改走原生；`DiscoverPlaylistDetailPage` 的 unmeta fallback 按废弃计划移除。移动端当前无链接导入功能，无需同步改动；将来若做，musicu POST 通道已被真机验证（qqDirect 歌词兜底同通道），无需额外适配。
5. **缓存与节流**：照网易模式 `cacheManager.set(key, songs, 10 * 60 * 1000)`（空结果不缓存）；导入批量解析播放地址复用现有并发闸门（参考 `resolveNeteaseSongUrlsBySearch` 限 10 并发的先例）。

---

## 4. 与现有实现冲突 / 需改动清单

1. **`parsePlaylistUrl`（`packages/core/src/api/playlistImport.ts` 39 行）QQ 正则只匹配 `__=` 短链**，不认识 `y.qq.com/n/ryqq/playlist/{id}` 与 `taoge.html?id={id}` 直链——直连化必须扩展，且要把 `id` 提出来（现返回 `{type:'qq', url}`，建议改为尽量返回 `{type:'qq', id}` + 短链才带 `url`）。
2. **`getPlaylistSongsFromThirdParty`（unmeta）退役涉及 4 处**：`musicApiContract.ts`（通道清单）、`musicApi.ts`（实现）、`musicApiHandlers.ts`（IPC 注册）、`ImportPlaylistModal.tsx` + `DiscoverPlaylistDetailPage.tsx`（调用方）。`ImportPlaylistModal` 里 `type==='qq' ? 'qq' : 'netease'` 的 sourceType 逻辑随原生腿一起简化。
3. **无 QIMEI/签名类冲突**：歌单 module 对 comm 形态宽容（实测），qqDirect 现有 comm/headers 不需要为它做任何调整。
4. **若实现 qzone GET 兜底腿**：桌面可用，但**不要**在移动端调用（Referer 强制 + RN 网络栈已知拒绝，见 qqDirect 歌词注释）；`fetchNeteasePlaylistLegacy` 式的「weapi 失败回退旧接口」模式在 QQ 侧应写成「CgiGetDiss 失败 → 桌面才有 qzone GET 兜底」或直接不兜底。

---

## 5. 风险面

- **匿名口子可能收紧（最主要风险）**：腾讯对 musicu module 是分模块设防的——`srfDissInfo` 家族当前匿名开放（GoMusic、luren-dc/QQMusicApi 等生产工具 2024–2025 持续在用），而 `srfDissDetail.SIGetDissInfo`、`playlist.PlaylistSonglistPage` 等已要求签名（实测 500003）。无公开契约保证现状永续；签名版 `srfDissDetail` 可作为 B 计划（zzc 签名算法社区有完整实现，见 §1.4）。
- **频控/风控**：无公开频控文档；本次调研单会话 ~25 次请求无任何限流迹象；GoMusic 对歌单结果做 Redis 缓存（`qq_music:%d`）并限最大 10000 首。建议：结果缓存 10 分钟、导入默认不逐首预解析播放地址、对超大歌单设上限（如 1000 首）并提示。
- **短链时效**：分享 token 会过期（实测旧 token 404），需把「短链失效」作为独立错误文案；解析务必不跟随重定向读 Location，避免多跳到 JS 渲染页。
- **隐私/删除边界**：隐私歌单（`dirinfo.title="歌单被主人设为隐私"`）与已删除歌单（`data.code=-100006`）都返回外层 code 0，必须检查内层信号再给用户报错，不能当成空歌单静默成功。
- **字段时效**：songlist 为新版字段（`mid/title`），旧接口才是 `songmid/songname`；`mapTrack` 已兼容两种，但新代码不要往返回体里硬编码不存在字段的期待。
- **合规**：QQ 音乐无公开开放 API；上述接口为社区逆向的非官方接口，随时可能变更或加固，仅限学习研究用途，不得用于商业或大规模抓取。与仓库现有 qqDirect 直连方案（T06/#152）采取同一立场与风险声明。

---

## 附录 A：当日实测记录（2026-08-28）

```bash
# 歌单列表（佐证）: code 0, 返回 disstid 列表
curl -s "https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg?format=json&platform=yqq&hostUin=0&sin=0&ein=4&sortId=5&categoryId=10000000" \
  -H "Referer: https://y.qq.com/" -H "User-Agent: Mozilla/5.0"

# 1.1 CgiGetDiss 匿名（无 Referer/无 cookie/无 sign）: code 0, dirinfo+songlist, song_num=1400 一次返回 1233 首
curl -s -X POST "https://u.y.qq.com/cgi-bin/musicu.fcg" -H "Content-Type: application/json" -H "User-Agent: Mozilla/5.0" \
  -d '{"comm":{"ct":24,"cv":0},"req_0":{"module":"music.srfDissInfo.DissInfo","method":"CgiGetDiss","param":{"disstid":7729596131,"dirid":0,"tag":true,"song_begin":0,"song_num":3,"userinfo":true,"orderlist":true,"onlysonglist":false}}}'

# 1.3 qzone GET: 公开歌单 code 0 全量 / 隐私歌单 subcode 4000 "check privacy error!" / 去 Referer 则 "invalid referer"
curl -s "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&utf8=1&format=json&disstid=7729596131&loginUin=0&hostUin=0&notice=0&platform=yqq&needNewCode=0&g_tk=5381&inCharset=utf8&outCharset=utf-8" \
  -H "Referer: https://y.qq.com/" -H "User-Agent: Mozilla/5.0"

# 1.4 排除项: SIGetDissInfo / PlaylistInfo / PlaylistSonglistPage 无签名均 500003
curl -s -X POST "https://u.y.qq.com/cgi-bin/musicu.fcg" -H "Content-Type: application/json" \
  -d '{"comm":{"ct":24,"cv":0},"playlist":{"module":"playlist.PlaylistSonglistPage","method":"GetSonglistPage","param":{"disstid":7578943835,"page_index":0,"page_size":30}}}'

# 1.5 短链: 歌曲 token 实测 302 → i.y.qq.com/v8/playsong.html?...songmid=...; 歌单 web 页 302 → ryqq_v2/playlist/{id}
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://c6.y.qq.com/base/fcgi-bin/u?__=w3lqEpOHACLO"
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://y.qq.com/n/ryqq/playlist/7729596131"
```

社区参考仓库（本地浅克隆审读）：jsososo/QQMusicApi、Rain120/qq-music-api、luren-dc/QQMusicApi、Bistutu/GoMusic、qaiu/netdisk-fast-download（仅 MqqsTool.java）。
