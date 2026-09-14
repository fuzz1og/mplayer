# 多音乐源 API 调研报告

> 调研日期: 2026-07-29
> 调研目标: 评估各音乐源「推荐歌单 / 推荐新歌 / 新碟上架 / 排行榜」的**免登录公开 API** 可用性
> 调研方法: WebSearch 检索公开文档 + curl 实际请求验证

---

## 调研总览

| 源 | 推荐歌单 | 推荐新歌 | 新碟上架 | 排行榜 | 鉴权要求 | 集成难度 |
|---|---|---|---|---|---|---|
| **QQ音乐** | ❌ 需登录 | ✅ 公开 | ❌ 需登录 | ✅ 公开 | 无 | ⭐⭐ 低 |
| **酷狗** | ✅ 公开 | ✅ 公开 | ✅ 公开 | ✅ 公开 | 无 | ⭐ 最低 |
| **酷我** | ❌ 需签名 | ❌ 需签名 | ❌ 需签名 | ❌ 需签名 | Cookie+签名 | ⭐⭐⭐⭐ 高 |
| **咪咕** | ❌ 需签名 | ❌ 需签名 | ❌ 需签名 | ❌ 需签名 | 签名+设备指纹 | ⭐⭐⭐⭐ 高 |
| **汽水/抖音** | ❌ 不可用 | ❌ 不可用 | ❌ 不可用 | ❌ 不可用 | TT反爬 | ⭐⭐⭐⭐⭐ 不可行 |
| **千千/百度** | ❌ 需签名 | ❌ 需签名 | ❌ 需签名 | ❌ 需签名 | 签名算法 | ⭐⭐⭐⭐ 高 |

---

## 1. QQ音乐 (QQ Music)

### 基本信息
- **文档来源**: [jackspeng/QQMusicSpiders](https://github.com/jackspeng/QQMusicSpiders)、[Rain120/qq-music-api](https://github.com/Rain120/qq-music-api)
- **Base URL**: `https://u.y.qq.com/cgi-bin/musicu.fcg` (新) / `https://c.y.qq.com/v8/fcg-bin/` (旧)
- **鉴权要求**: 无需登录、无需签名，仅需 `User-Agent` + `Referer: https://y.qq.com/`

### 1.1 排行榜 ✅ 公开可用

**新 API (POST)**:
```bash
curl -s "https://u.y.qq.com/cgi-bin/musicu.fcg" \
  -X POST \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://y.qq.com/" \
  -H "Content-Type: application/json" \
  -d '{"comm":{"ct":24,"cv":0},"toplist":{"module":"musicToplist.ToplistInfoServer","method":"GetAll","param":{}}}'
```

**响应示例**:
```json
{
  "code": 0,
  "toplist": {
    "code": 0,
    "data": {
      "group": [{
        "groupId": 0,
        "groupName": "巅峰榜",
        "toplist": [
          {"topId": 62, "title": "飙升榜", "totalNum": 100, "song": [...]},
          {"topId": 4, "title": "流行指数榜", ...},
          {"topId": 26, "title": "热歌榜", ...},
          {"topId": 27, "title": "新歌榜", ...}
        ]
      }]
    }
  }
}
```

**旧 API (GET, 仍可用)**:
```bash
curl -s "https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg?g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://y.qq.com/"
```

**排行榜歌曲 (旧 API)**:
```bash
curl -s "https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0&tpl=3&page=detail&type=top&topid=62" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://y.qq.com/"
```

**响应示例**:
```json
{
  "code": 0,
  "cur_song_num": 100,
  "date": "2026-07-28",
  "songlist": [{
    "data": {
      "songid": 710185115,
      "songmid": "001pfooo4GOPDm",
      "songname": "唯我论者的独白",
      "singer": [{"name": "马嘉祺"}],
      "albumid": 98120915,
      "albummid": "002SyJWd06jbh4",
      "albumname": "唯我论者的独白",
      "size128": 3532383,
      "size320": 8830642,
      "interval": 220,
      "pay": {"paydownload": 1, "paytrackprice": 200}
    }
  }]
}
```

**排行榜歌曲 (新 API POST)**:
```bash
curl -s "https://u.y.qq.com/cgi-bin/musicu.fcg" \
  -X POST \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://y.qq.com/" \
  -H "Content-Type: application/json" \
  -d '{"comm":{"ct":24,"cv":0},"toplist":{"module":"musicToplist.ToplistInfoServer","method":"GetDetail","param":{"topId":62,"offset":0,"num":30,"period":"2026-07-28"}}}'
```

**数据结构**: 可提取 songId, songMid, songName, singerName, albumMid, cover, file size, pay info

### 1.2 推荐新歌 ✅ 公开可用

```bash
curl -s "https://u.y.qq.com/cgi-bin/musicu.fcg" \
  -X POST \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://y.qq.com/" \
  -H "Content-Type: application/json" \
  -d '{"comm":{"ct":24,"cv":0},"newsong":{"module":"newsong.NewSongServer","method":"get_new_song_info","param":{"type":0}}}'
```

**响应示例**:
```json
{
  "newsong": {
    "code": 0,
    "data": {
      "lanlist": [
        {"name": "new_song", "lan": "最新", "type": 5},
        {"name": "neidi", "lan": "内地", "type": 1},
        {"name": "gangtai", "lan": "港台", "type": 6},
        {"name": "oumei", "lan": "欧美", "type": 2},
        {"name": "hanguo", "lan": "韩国", "type": 4},
        {"name": "riben", "lan": "日本", "type": 3}
      ],
      "songlist": [
        {
          "id": 710739706,
          "mid": "000OjdvG2PkNGo",
          "name": "Sunburst",
          "singer": [{"id": 14353727, "name": "RIIZE"}],
          "album": {"id": 98310336, "name": "Sunburst", "time_public": "2026-07-26"},
          "file": {"size_128mp3": 3137419, "size_320mp3": 7843222}
        }
      ]
    }
  }
}
```

**数据结构**: 可提取 id, mid, name, singer, album, file size, time_public

### 1.3 推荐歌单 ❌ 需登录

```bash
curl -s "https://u.y.qq.com/cgi-bin/musicu.fcg" \
  -X POST \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://y.qq.com/" \
  -H "Content-Type: application/json" \
  -d '{"comm":{"ct":24,"cv":0},"recomPlaylist":{"module":"playlist.RecommendServer","method":"get_recommend","param":{"cmd":1,"page":0,"size":30}}}'
```

**响应**: `{"recomPlaylist":{"code":500003,"subcode":860100005}}` — 需要登录态

### 1.4 新碟上架 ❌ 需登录

```bash
curl -s "https://u.y.qq.com/cgi-bin/musicu.fcg" \
  -X POST \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://y.qq.com/" \
  -H "Content-Type: application/json" \
  -d '{"comm":{"ct":24,"cv":0},"albumlib":{"module":"music.library.AlbumServer","method":"get_album_by_tags","param":{"area":1,"company":-1,"genre":-1,"type":-1,"year":-1,"sort":2,"sin":0,"num":30}}}'
```

**响应**: `{"albumlib":{"code":500003,"subcode":860100001}}` — 需要登录态

### 1.5 焦点图/首页推荐 ✅ 公开可用

```bash
curl -s "https://u.y.qq.com/cgi-bin/musicu.fcg" \
  -X POST \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://y.qq.com/" \
  -H "Content-Type: application/json" \
  -d '{"comm":{"ct":24,"cv":0},"focus":{"module":"QQMusic.MusichallServer","method":"GetFocus","param":{}}}'
```

**响应**: 返回焦点图列表，包含 id, pic_info.url, jump_info.url, type

### 1.6 评估

- **优势**: 排行榜和新歌 API 完全公开，无需任何鉴权，JSON 结构清晰
- **劣势**: 推荐歌单和新碟上架需要登录态（Cookie: `qm_keyst`, `uin` 等）
- **数据结构**: 歌名、封面、ID、歌手、专辑、文件大小、付费信息均可提取
- **集成建议**: 排行榜 + 推荐新歌可直接集成；推荐歌单可考虑用「焦点图」+「排行榜」替代

---

## 2. 酷狗 (Kugou)

### 基本信息
- **文档来源**: [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)、[shichunlei/-Api](https://github.com/shichunlei/-Api)
- **Base URL**: `http://m.kugou.com/` (移动端) / `http://mobilecdn.kugou.com/api/v3/` (CDN)
- **鉴权要求**: 无需登录、无需签名，仅需 `User-Agent` (移动端效果更佳)

### 2.1 排行榜 ✅ 公开可用

**排行榜列表**:
```bash
curl -s "http://m.kugou.com/rank/list&json=true" \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"
```

**响应示例**:
```json
{
  "rank": {
    "total": 55,
    "list": [
      {
        "rankname": "TOP500",
        "rankid": 8888,
        "update_frequency": "每天",
        "intro": "数据来源：全曲库歌曲\n排序方式：按歌曲喜爱用户数的总量排序",
        "songinfo": [{"songname": "甲乙丙丁 (你我怎么两清)", "authors": [{"author_name": "李佳薇"}]}],
        "play_times": 11292936
      }
    ]
  }
}
```

**排行榜歌曲**:
```bash
curl -s "http://m.kugou.com/rank/info/8888&json=true" \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"
```

或

```bash
curl -s "http://mobilecdn.kugou.com/api/v3/rank/song?rankid=8888&page=1&pagesize=30" \
  -H "User-Agent: Mozilla/5.0"
```

**响应示例**:
```json
{
  "data": {
    "total": 500,
    "info": [
      {
        "hash": "213D580CA0BDCC28A5FDBA995FFDA106",
        "songname": "甲乙丙丁 (你我怎么两清)",
        "filename": "李佳薇 - 甲乙丙丁 (你我怎么两清)",
        "album_id": "197648995",
        "authors": [{"author_name": "李佳薇", "author_id": 83922}],
        "duration": 210,
        "filesize": 8420641,
        "320filesize": 8420641,
        "sqfilesize": 23193434,
        "album_sizable_cover": "http://imge.kugou.com/stdmusic/{size}/20260630/...",
        "pay_type": 3,
        "price": 200
      }
    ]
  }
}
```

**数据结构**: 可提取 hash, songname, album_id, authors, duration, filesize, cover, pay info

### 2.2 推荐歌单 ✅ 公开可用

```bash
curl -s "http://m.kugou.com/plist/index&json=true" \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"
```

**响应示例**:
```json
{
  "plist": {
    "list": {
      "total": 600,
      "info": [
        {
          "specialid": 4151064,
          "playcount": 17885650,
          "songcount": 29,
          "publishtime": "2021-08-25 00:00:00",
          "songs": [{"hash": "...", "filename": "...", "album_id": "..."}]
        }
      ]
    }
  }
}
```

**数据结构**: 可提取 specialid, playcount, songcount, songs (含 hash, filename, album_id)

### 2.3 新碟上架 ✅ 公开可用

```bash
curl -s "http://mobilecdn.kugou.com/api/v3/album/list?page=1&pagesize=30&plat=2" \
  -H "User-Agent: Mozilla/5.0"
```

**响应示例**:
```json
{
  "data": {
    "timestamp": 1785258957,
    "total": 988,
    "info": [
      {
        "albumid": 59530541,
        "albumname": "小小的世界",
        "singername": "王小乱",
        "singerid": 810892,
        "publishtime": "2026-07-04 00:00:00",
        "intro": "小小的我 小小的世界",
        "imgurl": "http://imge.kugou.com/stdmusic/{size}/20260704/..."
      }
    ]
  }
}
```

**数据结构**: 可提取 albumid, albumname, singername, singerid, publishtime, intro, imgurl

### 2.4 推荐新歌 ✅ 公开可用

```bash
curl -s "http://m.kugou.com/newsong/index&json=true" \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"
```

**响应示例**:
```json
{
  "type": 1,
  "newSongList": [
    {
      "hash": "A5C409E406846E97CE195D36971C82ED",
      "songname": "一斩",
      "filename": "正太Monster - 一斩",
      "album_id": "200552312",
      "authors": [{"author_name": "正太Monster", "author_id": 22255443}],
      "duration": 187,
      "filesize": 7491103,
      "album_sizable_cover": "http://imge.kugou.com/stdmusic/{size}/20260728/...",
      "remark": "一斩 (一斩苍穹 动画片头曲)"
    }
  ]
}
```

**数据结构**: 可提取 hash, songname, album_id, authors, duration, filesize, cover, remark

### 2.5 歌曲详情/播放链接 ✅ 公开可用

```bash
curl -s "http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=213D580CA0BDCC28A5FDBA995FFDA106" \
  -H "User-Agent: Mozilla/5.0"
```

**响应示例**:
```json
{
  "songName": "甲乙丙丁",
  "hash": "213D580CA0BDCC28A5FDBA995FFDA106",
  "author_name": "李佳薇",
  "album_id": "197648995",
  "backup_url": ["https://sharefs.tx.kugou.com/202607290112/.../v3/213d580ca0bdcc28a5fdba995ffda106/yp/full/ap1000_us0_pi409_s148391198.mp3"],
  "fileName": "李佳薇 - 甲乙丙丁",
  "privilege": 8
}
```

### 2.6 评估

- **优势**: 四大功能（推荐歌单、推荐新歌、新碟上架、排行榜）**全部公开可用**，无需任何鉴权
- **劣势**: 部分 API 返回的 JSON 结构较老（字段名如 `specialid`、`newSongList` 不够语义化）
- **数据结构**: 歌名、封面、ID、歌手、专辑、文件大小、付费信息均可提取
- **集成建议**: **最易集成的源**，推荐作为首选集成目标

---

## 3. 酷我 (Kuwo)

### 基本信息
- **文档来源**: [2061360308/MusicLibrary](https://github.com/2061360308/MusicLibrary)
- **Base URL**: `http://www.kuwo.cn/api/www/` (Web) / `http://search.kuwo.cn/` (搜索)
- **鉴权要求**: 需要 Cookie + 签名（`Secret` header 或 `Hm_Iuvt` cookie）

### 3.1 排行榜 ❌ 需签名

```bash
curl -s "http://www.kuwo.cn/api/www/bang/bang/bangList?bangId=93&pn=1&rn=30&httpsStatus=1" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: http://www.kuwo.cn/rankList"
```

**响应**: `{"success":false,"message":"The request is illegal!","now":"2026-07-28T17:10:16.413Z"}`

### 3.2 推荐歌单 ❌ 需签名

```bash
curl -s "http://www.kuwo.cn/api/www/playlist/playListInfo?pid=100&pn=1&rn=30&httpsStatus=1" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: http://www.kuwo.cn/"
```

**响应**: `{"success":false,"message":"The request is illegal!"}`

### 3.3 新碟上架 ❌ 需签名

```bash
curl -s "http://www.kuwo.cn/api/www/album/albumList?page=1&rn=30&httpsStatus=1" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: http://www.kuwo.cn/"
```

**响应**: `{"success":false,"message":"The request is illegal!"}`

### 3.4 推荐新歌 ❌ 需签名

```bash
curl -s "http://www.kuwo.cn/api/www/music/musicList?category=1&page=1&rn=30&httpsStatus=1" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: http://www.kuwo.cn/"
```

**响应**: `{"success":false,"message":"The request is illegal!"}`

### 3.5 搜索 ✅ 公开可用

```bash
curl -s "http://search.kuwo.cn/r.s?client=kt&all=%E5%91%A8%E6%9D%B0%E4%BC%A6&pn=0&rn=30&uid=0&ver=kwplayer_ar_9.2.2.8&vipver=1&show_copyright_off=1&newver=3&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1" \
  -H "User-Agent: Mozilla/5.0"
```

**响应示例**:
```json
{
  "ARTISTPIC": "",
  "HIT": "3306",
  "PN": "0",
  "RN": "30",
  "TOTAL": "3306",
  "abslist": [
    {
      "ARTIST": "周杰伦",
      "ARTISTID": "336",
      "ALBUM": "叶惠美",
      "ALBUMID": "1293",
      "NAME": "晴天",
      "DURATION": "269",
      "MUSICRID": "MUSIC_228908",
      "FORMAT": "wma",
      "MVFLAG": "1"
    }
  ]
}
```

### 3.6 评估

- **优势**: 搜索 API 公开可用
- **劣势**: 排行榜、推荐歌单、新碟上架、推荐新歌**全部需要签名**，返回 "The request is illegal!"
- **鉴权**: 需要 `Hm_Iuvt` cookie + `Secret` header，签名算法需逆向 JS
- **集成建议**: 集成难度高，需要逆向签名算法或维护 Cookie 池

---

## 4. 咪咕 (Migu)

### 基本信息
- **文档来源**: [JumpAlang/MiguMusicApi](https://github.com/JumpAlang/MiguMusicApi)、[skyour.cn](https://www.skyour.cn/archives/265)
- **Base URL**: `https://jadeite.migu.cn/music_search/v3/search/searchAll` (搜索) / `https://music.migu.cn/v3/api/` (Web)
- **鉴权要求**: 需要签名 (`sign` header) + 时间戳 + 设备指纹 (`ms`, `channel`, `uiVersion`, `ua`, `msisdn`)

### 4.1 搜索 ✅ 公开可用（需静态签名头）

```bash
curl -s "https://jadeite.migu.cn/music_search/v3/search/searchAll?feature=1111000000&pageNo=1&comprehensivePage=1&pageSize=20&sort=0&text=%E4%BA%94%E6%9C%88%E5%A4%A9&sid=USSab7de0bd38234653ac85a3591a566297409eda027553446b9824718c90fa290f&isCopyright=1&isCorrect=1" \
  -H "User-Agent: Mozilla/5.0 (Linux; U; Android 9; zh-cn; MI 6 Build/PKQ1.190118.001)" \
  -H "ms: 46222b35d5efc10c" \
  -H "channel: 0146921" \
  -H "sign: d98e82581dc8f0b62725084ba8a0bcf2" \
  -H "uiVersion: A_music_3.17.0" \
  -H "ua: Android_migu" \
  -H "msisdn: MTUwMDEzNjAxNTc=" \
  -H "timestamp: 1743651699474"
```

**响应示例**:
```json
{
  "code": "000000",
  "resultNum": 831,
  "songResultData": {
    "totalCount": "244",
    "resultList": [[{
      "id": "1057289",
      "contentId": "600929000006555974",
      "songId": "1057289",
      "songName": "你不是真正的快乐",
      "albumId": "25609",
      "album": "后青春期的诗",
      "singerList": [{"id": "529", "name": "五月天"}],
      "img1": "/data/oss/resource/00/2h/7l/k2.webp",
      "audioFormats": [{"formatType": "PQ", "showTags": ["vip"]}]
    }]]
  }
}
```

**注意**: 上述 `sign` 和 `timestamp` 是文档中的静态示例，实际可能需要动态生成。

### 4.2 排行榜 ❌ 需签名/重定向

```bash
curl -s "https://music.migu.cn/v3/api/rank/list?page=1&pageSize=30" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.migu.cn/"
```

**响应**: 301 重定向到登录页

### 4.3 推荐歌单 ❌ 需签名/重定向

```bash
curl -s "https://music.migu.cn/v3/api/homePage/recommend?page=1&pageSize=30" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.migu.cn/"
```

**响应**: 301 重定向

### 4.4 新碟上架 ❌ 需签名/重定向

```bash
curl -s "https://music.migu.cn/v3/api/album/list?page=1&pageSize=30" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.migu.cn/"
```

**响应**: 301 重定向

### 4.5 推荐新歌 ❌ 需签名/重定向

```bash
curl -s "https://music.migu.cn/v3/api/homePage/getHomePage?page=1&pageSize=30" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.migu.cn/"
```

**响应**: 301 重定向

### 4.6 播放链接 ❌ 需动态签名

```bash
curl -s "http://app.c.nf.migu.cn/MIGUM2.0/strategy/listen-url/v2.4?albumId=1115511351&lowerQualityContentId=600913000003763282&netType=00&resourceType=2&songId=1115511372&toneFlag=PQ" \
  -H "User-Agent: Mozilla/5.0 (Linux; U; Android 9; zh-cn; MI 6)" \
  -H "channel: 0146921"
```

**响应**: `{"code":"201007","info":"请求失败，请稍候再试"}` — 需要动态签名

### 4.7 评估

- **优势**: 搜索 API 可用（需静态签名头）
- **劣势**: 排行榜、推荐歌单、新碟上架、推荐新歌**全部需要动态签名**或返回 301
- **鉴权**: 需要 `sign` header（基于请求参数+时间戳的 MD5/SHA256）+ 设备指纹
- **集成建议**: 集成难度高，签名算法需逆向；播放链接需要动态生成

---

## 5. 汽水/抖音 (Soda/Douyin)

### 基本信息
- **文档来源**: [app966.cn](https://www.app966.cn/post/cf85313.html)、[go-music-api](https://github.com/guohuiyuan/go-music-api)
- **Base URL**: `https://music.douyin.com/api/` / `https://music.douyin.com/aweme/v1/music/`
- **鉴权要求**: TT 反爬 token (`gfkadpd` cookie) + 设备指纹

### 5.1 排行榜 ❌ 不可用

```bash
curl -s "https://music.douyin.com/api/rank/board/?aid=6383&app_name=music_web&region=CN" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.douyin.com/"
```

**响应**: `404 Not Found`

```bash
curl -s "https://music.douyin.com/aweme/v1/music/rank/board/?aid=6383&app_name=music_web&region=CN" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.douyin.com/"
```

**响应**: 返回 HTML（TT 反爬 JavaScript 挑战页面，设置 `gfkadpd` cookie）

### 5.2 推荐歌单 ❌ 不可用

```bash
curl -s "https://music.douyin.com/api/category/playlist/?category_id=0&page=1&pageSize=30" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.douyin.com/"
```

**响应**: `404 Not Found`

```bash
curl -s "https://music.douyin.com/aweme/v1/music/category/playlist/?category_id=0&page=1&pageSize=30&aid=6383" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.douyin.com/"
```

**响应**: 返回 HTML（TT 反爬）

### 5.3 新碟上架 ❌ 不可用

```bash
curl -s "https://music.douyin.com/aweme/v1/music/home/getHomePage?aid=6383&app_name=music_web&region=CN" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.douyin.com/"
```

**响应**: 返回 HTML（TT 反爬）

### 5.4 推荐新歌 ❌ 不可用

```bash
curl -s "https://music.douyin.com/aweme/v1/music/playlist/getPlaylistDetail?playlist_id=0&aid=6383" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.douyin.com/"
```

**响应**: 返回 HTML（TT 反爬）

### 5.5 评估

- **优势**: 无
- **劣势**: 所有 API 端点要么返回 404，要么返回 TT 反爬 HTML 页面
- **鉴权**: 需要 TT 反爬 token（`gfkadpd` cookie），需要执行 JavaScript 挑战
- **集成建议**: **不可行** — 需要完整的浏览器环境执行 JS 挑战，无法通过简单 HTTP 请求集成

---

## 6. 千千静听/百度音乐 (Qianqian/Baidu)

### 基本信息
- **文档来源**: [go-music-api](https://github.com/guohuiyuan/go-music-api)
- **Base URL**: `https://music.91q.com/v1/`
- **鉴权要求**: 需要 `sign` 参数（基于请求参数的签名算法）

### 6.1 排行榜 ❌ 需签名

```bash
curl -s "https://music.91q.com/v1/track/list?appid=16073360&timestamp=$(date +%s)&pagesize=30&page=1" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.91q.com/" \
  --compressed
```

**响应**: `{"state":false,"errno":22001,"errmsg":"签名错误:缺少sign参数","elapsed_time":"0.007","data":[]}`

### 6.2 推荐歌单 ❌ 需签名

```bash
curl -s "https://music.91q.com/v1/playlist/list?appid=16073360&timestamp=$(date +%s)&pagesize=30&page=1" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.91q.com/" \
  --compressed
```

**响应**: `{"state":false,"errno":22001,"errmsg":"签名错误:缺少sign参数"}`

### 6.3 新碟上架 ❌ 需签名

```bash
curl -s "https://music.91q.com/v1/album/list?appid=16073360&timestamp=$(date +%s)&pagesize=30&page=1" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.91q.com/" \
  --compressed
```

**响应**: `{"state":false,"errno":22001,"errmsg":"签名错误:缺少sign参数"}`

### 6.4 推荐新歌 ❌ 需签名

```bash
curl -s "https://music.91q.com/v1/search/song?appid=16073360&timestamp=$(date +%s)&keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6&pagesize=30&page=1" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://music.91q.com/" \
  --compressed
```

**响应**: `{"state":false,"errno":22001,"errmsg":"签名错误:缺少sign参数"}`

### 6.5 评估

- **优势**: API 端点存在，结构清晰
- **劣势**: 所有 API **都需要 `sign` 参数**，签名算法未知
- **鉴权**: 需要 `sign` 参数（基于请求参数的签名，可能是 MD5/SHA256）
- **集成建议**: 集成难度高，需要逆向签名算法（可从 Web 端 JS 或 go-music-api 的 music-lib 库中查找）

---

## 综合评估

### 集成优先级排名

| 排名 | 源 | 可集成功能 | 集成难度 | 推荐指数 |
|---|---|---|---|---|
| 1 | **酷狗** | 排行榜 + 推荐歌单 + 新碟上架 + 推荐新歌 | ⭐ 最低 | ⭐⭐⭐⭐⭐ |
| 2 | **QQ音乐** | 排行榜 + 推荐新歌 + 焦点图 | ⭐⭐ 低 | ⭐⭐⭐⭐ |
| 3 | **咪咕** | 搜索（需静态签名头） | ⭐⭐⭐⭐ 高 | ⭐⭐ |
| 4 | **酷我** | 搜索（公开） | ⭐⭐⭐⭐ 高 | ⭐⭐ |
| 5 | **千千/百度** | 端点存在但需签名 | ⭐⭐⭐⭐ 高 | ⭐⭐ |
| 6 | **汽水/抖音** | 无 | ⭐⭐⭐⭐⭐ 不可行 | ⭐ |

### 详细分析

#### 🥇 酷狗 (Kugou) — 首选集成

**推荐理由**:
- 四大功能**全部公开可用**，无需任何鉴权
- 仅需 `User-Agent` 头，移动端域名 (`m.kugou.com`) 效果更佳
- JSON 结构清晰，可提取歌名、封面、ID、歌手、专辑、文件大小、付费信息
- 歌曲详情 API (`getSongInfo.php`) 返回直接播放链接 (`backup_url`)

**注意事项**:
- 部分 API 返回的 JSON 字段名较老（如 `specialid`、`newSongList`、`plist.list.info`）
- 播放链接需要先从排行榜/歌单获取 `hash`，再调用 `getSongInfo.php` 获取 `backup_url`
- 付费歌曲 (`pay_type=3`) 可能无法获取播放链接

#### 🥈 QQ音乐 (QQ Music) — 次选集成

**推荐理由**:
- 排行榜 API 完全公开，新旧两套 API 都可用
- 推荐新歌 API 公开，可按语言分类（最新/内地/港台/欧美/韩国/日本）
- 焦点图 API 公开，可获取首页推荐内容
- JSON 结构清晰，字段语义化（`songId`, `songName`, `singerName`, `albumMid`）

**注意事项**:
- 推荐歌单和新碟上架**需要登录态**（Cookie: `qm_keyst`, `uin`）
- 推荐歌单可考虑用「焦点图」+「排行榜」替代
- 播放链接需要额外的 `vkey` 获取流程（不在本次调研范围）

#### 🥉 咪咕 (Migu) — 备选

**推荐理由**:
- 搜索 API 可用（需静态签名头）
- 返回数据质量高（`songName`, `album`, `singerList`, `audioFormats`）

**注意事项**:
- 排行榜、推荐歌单、新碟上架、推荐新歌**全部需要动态签名**或返回 301
- 播放链接需要动态签名（`sign` header 基于请求参数+时间戳）
- 签名算法需逆向，集成难度高

#### ❌ 汽水/抖音 (Soda/Douyin) — 不推荐

**不推荐理由**:
- 所有 API 端点要么返回 404，要么返回 TT 反爬 HTML 页面
- TT 反爬需要执行 JavaScript 挑战，无法通过简单 HTTP 请求集成
- 需要完整的浏览器环境（Puppeteer/Playwright）才能获取 `gfkadpd` cookie

#### ⚠️ 酷我 (Kuwo) / 千千 (Qianqian) — 谨慎评估

**注意事项**:
- 酷我：所有功能 API 返回 "The request is illegal!"，需要 Cookie + 签名
- 千千：所有 API 需要 `sign` 参数，签名算法未知
- 两者都需要逆向签名算法，集成难度高
- 可从 Web 端 JS 或开源项目（如 go-music-api 的 music-lib）中查找签名逻辑

---

## 推荐集成方案

### 方案 A: 酷狗为主 + QQ音乐为辅（推荐）

```
排行榜:     酷狗 (m.kugou.com/rank/list&json=true)
推荐歌单:   酷狗 (m.kugou.com/plist/index&json=true)
新碟上架:   酷狗 (mobilecdn.kugou.com/api/v3/album/list)
推荐新歌:   酷狗 (m.kugou.com/newsong/index&json=true)
            + QQ音乐 (u.y.qq.com newsong 模块) 作为补充
```

**优势**: 全部公开可用，无需鉴权，实现最简单
**劣势**: 酷狗 JSON 结构较老，需要适配

### 方案 B: QQ音乐为主 + 酷狗补充

```
排行榜:     QQ音乐 (u.y.qq.com toplist 模块)
推荐新歌:   QQ音乐 (u.y.qq.com newsong 模块)
推荐歌单:   酷狗 (m.kugou.com/plist/index&json=true) — 替代 QQ 需登录的接口
新碟上架:   酷狗 (mobilecdn.kugou.com/api/v3/album/list) — 替代 QQ 需登录的接口
```

**优势**: QQ音乐 JSON 结构更现代，酷狗补充需登录的功能
**劣势**: 需要适配两套 API 结构

---

## 附录: 验证命令速查

### QQ音乐
```bash
# 排行榜列表
curl -s "https://u.y.qq.com/cgi-bin/musicu.fcg" -X POST \
  -H "User-Agent: Mozilla/5.0" -H "Referer: https://y.qq.com/" \
  -H "Content-Type: application/json" \
  -d '{"comm":{"ct":24,"cv":0},"toplist":{"module":"musicToplist.ToplistInfoServer","method":"GetAll","param":{}}}'

# 排行榜歌曲 (旧 API)
curl -s "https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0&tpl=3&page=detail&type=top&topid=62" \
  -H "User-Agent: Mozilla/5.0" -H "Referer: https://y.qq.com/"

# 推荐新歌
curl -s "https://u.y.qq.com/cgi-bin/musicu.fcg" -X POST \
  -H "User-Agent: Mozilla/5.0" -H "Referer: https://y.qq.com/" \
  -H "Content-Type: application/json" \
  -d '{"comm":{"ct":24,"cv":0},"newsong":{"module":"newsong.NewSongServer","method":"get_new_song_info","param":{"type":0}}}'

# 焦点图
curl -s "https://u.y.qq.com/cgi-bin/musicu.fcg" -X POST \
  -H "User-Agent: Mozilla/5.0" -H "Referer: https://y.qq.com/" \
  -H "Content-Type: application/json" \
  -d '{"comm":{"ct":24,"cv":0},"focus":{"module":"QQMusic.MusichallServer","method":"GetFocus","param":{}}}'
```

### 酷狗
```bash
# 排行榜列表
curl -s "http://m.kugou.com/rank/list&json=true" \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"

# 排行榜歌曲
curl -s "http://mobilecdn.kugou.com/api/v3/rank/song?rankid=8888&page=1&pagesize=30" \
  -H "User-Agent: Mozilla/5.0"

# 推荐歌单
curl -s "http://m.kugou.com/plist/index&json=true" \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"

# 新碟上架
curl -s "http://mobilecdn.kugou.com/api/v3/album/list?page=1&pagesize=30&plat=2" \
  -H "User-Agent: Mozilla/5.0"

# 推荐新歌
curl -s "http://m.kugou.com/newsong/index&json=true" \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"

# 歌曲详情/播放链接
curl -s "http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=213D580CA0BDCC28A5FDBA995FFDA106" \
  -H "User-Agent: Mozilla/5.0"
```

### 酷我
```bash
# 搜索 (公开可用)
curl -s "http://search.kuwo.cn/r.s?client=kt&all=%E5%91%A8%E6%9D%B0%E4%BC%A6&pn=0&rn=30&uid=0&ver=kwplayer_ar_9.2.2.8&vipver=1&show_copyright_off=1&newver=3&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1" \
  -H "User-Agent: Mozilla/5.0"
```

### 咪咕
```bash
# 搜索 (需静态签名头)
curl -s "https://jadeite.migu.cn/music_search/v3/search/searchAll?feature=1111000000&pageNo=1&comprehensivePage=1&pageSize=20&sort=0&text=%E4%BA%94%E6%9C%88%E5%A4%A9&sid=USSab7de0bd38234653ac85a3591a566297409eda027553446b9824718c90fa290f&isCopyright=1&isCorrect=1" \
  -H "User-Agent: Mozilla/5.0 (Linux; U; Android 9; zh-cn; MI 6)" \
  -H "ms: 46222b35d5efc10c" -H "channel: 0146921" \
  -H "sign: d98e82581dc8f0b62725084ba8a0bcf2" \
  -H "uiVersion: A_music_3.17.0" -H "ua: Android_migu" \
  -H "msisdn: MTUwMDEzNjAxNTc=" -H "timestamp: 1743651699474"
```

---

> **免责声明**: 本报告仅供学习研究使用。各音乐源的 API 可能随时变更，集成时请遵守相关平台的服务条款和法律法规。严禁将本报告中的接口用于商业用途。
