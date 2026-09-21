# tier3 兜底：只替换 URL、分级护栏与验证等级

日期：2026-09-21 · 状态：已接受 · 关联：#361（实现 spec）、#332（排行榜单元榜）、#340、ADR-0014 ·
依据：本次会话实测（2026-09-21）、`docs/wayfinder/2026-09-14-t3-tier3-mechanism-audit.md`、`docs/research/2026-09-14-t6-tier3-source-matching.md`

## 背景

tier3（用户自配的第三方解析源）是直连失败后的唯一兜底。当前实现有两处结构性缺口：

1. **url-resolver 源零内容级校验**：只做域名白名单 + 字节嗅探；`search-then-resolve` 源有
   `isExactMatch`（歌名归一 + 歌手拆分任一相等 + 拒 Live/remix），url-resolver 没有。
2. **跨源错播通道**：ADR-0014 背景第 6 条已记录（只支持 QQ 的 url-resolver 对任意源 id
   都返回同一 URL 且全被接受）。

用户对兜底的诉求只有两条：**听到完整版**（时长对）与**是点的那一首**（同一首）。
中间过程（用了哪个源、验证到哪一级）用户无感知、也不在乎。

**跨源互补是必要的**：同一首歌上架多个平台，网易源拿不到的歌酷狗源能拿到。

**业界证据**（2026-09-21 调研）：lx-music / MusicFree / listen1 / UnblockNeteaseMusic /
YesPlayMusic / SPlayer / Nuclear **全部**以 (源, id) 为规范身份，**没有一个**建模跨源作品身份；
ISRC/MBID 在六个 OSS 客户端 `gh search code` 零命中。静默兜底的通行做法是**保留原身份、
只替换流 URL**。SPlayer PR #1008 是"取搜索结果第一条、不校验歌名"导致放错歌的真实事故，
修法为归一化歌名 + 歌手匹配。

**本次实测**（2026-09-21，本机）：

- 容器能力异构：qq 三源（hk0cc / tangapi / xunhuisi）返回 M4A，头解析出精确时长；
  gdstudio（netease）返回 ADTS/MPEG-2/AAC，`music-metadata` **在任何尺寸下都给不出 `duration`**。
- 源元数据能力异构：kugou 官方搜索自带 `Duration`；hk0cc 解析响应自带 `song_play_time=308`；
  gdstudio 只回 `url/br/size`；mitu 搜索无时长且 `downurl` 是网盘分享链；mgmp3 已不可达。
- **ADTS 可用 `size × 8 ÷ br` 估算**：真值 166.416s（ffprobe）；`size ÷ 自称 br(986)` = 166.5s
  （误差 **+0.08s**）；`size ÷ 帧实测 br(976.67)` = 168.1s（误差 **+1.7s**）。
- 酷狗直连 `resolvePlayableUrl`（trackercdn `i/v2` + `md5(hash + 'kgcloudv2')`）实测 **0/12 成功**，
  上游返回 `{"status":2}`。**这是风控要求设备校验（SSA），不是签名错误**：错 key 会返回
  `status:0 "Bad key"`，而本地客户端的 key 是正确的（大写 hash 得 status:2，小写得 Bad key）。
  改走**免签名、免 cookie、免设备注册**的 `m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=`
  实测 **4/12**，失败 8 首全部为 `status:0 / 需要付费`（权益，不是签名）→ 付费歌按既有链路走 tier3 兜底。

## 决策

1. **身份**：保留 (音乐源, id) 为规范身份。tier3 只替换**流 URL**，**绝不铸造新身份**，
   绝不改写队列 / 收藏 / 历史 / 本地歌单 → 跨源兜底**零状态同步成本**。
2. **时长取证源无关**：不要求第三方源提供时长（契约不把 `durationPath` 作为前置）；
   优先从**音频本身**取证。
3. **分级护栏**，参考值 = 标称 `Song.duration`，容差 **±2s**：
   - **L1** 源自带时长（kugou `Duration`、hk0cc `song_play_time`）
   - **L2** 音频头解析（`music-metadata`：M4A / MP3 / FLAC / Ogg）
   - **L3** `size × 8 ÷ br` 估算（ADTS 等无全局头的容器；**优先源自称 `br`**，缺失才用帧实测码率）
   - L1–L3 任一可用 → **歌名 + 歌手 + 时长三指标全达标**才接受
   - **L4** 以上全无 → **降级特化：只验歌名 + 歌手精确匹配**（临时特例，待更好方案）
   - **L5** 连文本都没有（url-resolver 且响应无 name/artist）→ 只剩 `source` 声明这一条**信任**
4. **url-resolver 维持 source gate**（不跨源）：跨源时它连 L5 都没有。
5. **保证不了就不静默播**：护栏不过 → 换下一个源；全不过 → 摊候选让用户显式换源，
   **绝不取搜索结果第一条**。
6. **UI 不新增常驻来源徽标**：护栏通过不打扰；时长不符复用现有 `AudioTagBadge tag="preview"`；
   全失败时文案说清原因（不是"请检查网络连接"）。

## 后果

- 跨源兜底不再产生状态同步成本（身份不变）。
- url-resolver 源首次获得内容级校验（时长；能拿到文本时加文本）。
- ADTS 不再是死路：L3 实测误差 0.1–1.7s。
- **±2s 对 L3 余量很薄**：用"帧实测码率"分支时，估算 168.1s 与标称 166s 相差 **2.1s > 2s**
  → **会被误判**。因此 L3 **必须优先用源自称 `br`**（0.5s，通过）；帧实测码率分支要么不用、
  要么单独放宽阈值。实现里必须分别记录两条分支的命中与误判。
- 酷狗缺口的定性改变：**直连被风控闸住，不是缺第三方源、也不是签名写错** → 优先修
  `kugouDirect.ts`（改用免签名端点）；修后热歌榜直连命中 4/12，其余为付费歌、按既有链路走 tier3。
- 探测成本：一次 Range（64KB）。探测在主进程 transport、播放在渲染进程 Chromium，
  **连接不复用**；字节重复 <1%，且 ADR-0014 已实测 Range 字节数与延迟无关。
- **残余风险如实记录**：L4 / L5 存在"只剩信任"的档位；`source` 声明是**契约不是证据**。

## 备选与否决

- **播放器加载即探测**：否决。Howler `_canPlayEvent = 'canplaythrough'`（`howler.js:45/2265`）
  + 默认 `preload='auto'`（`:2274`）→ 会缓冲到"能播完"而非取头，是最贵的探测；
  且探测走主进程 transport（有重试 / TLS 降级 / 代理注入），播放走 Chromium 网络栈，
  代理配置不对称；护栏逻辑也将无法进 core 单测。
- **取第三方搜索结果第一条**：否决。SPlayer PR #1008 真实事故；酷狗实测首条即 `晴天 (Live)`。
- **把 url-resolver 变通用（跨源）**：否决。复现 ADR-0014 已堵的跨源错播通道，
  且跨源时无任何内容证据。
- **新增常驻"来源"徽标**：否决。用户明确不在乎机制，只在保证失效时需要知道。
- **把 `durationPath` 设为契约必需**：否决。源能力异构（gdstudio 无、mitu 无），
  且从音频取证源无关。
- **静默拒绝无法验证的源**：否决。会因"我们无法预校验"牺牲一首可能完全正常的歌。
- **ISRC/MBID 实体映射库**：暂缓（非否决）。行业做法，但中文源公开接口可得性未知，
  属另一量级工程。
