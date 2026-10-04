# ADR: 移动端下载文件的内嵌元数据边界：只承诺 MP3 + 歌词侧车

- 状态：已接受
- 日期：2026-10-04
- 关联：**#189**（本决策票）· #409（歌词按 ID 直取）· #412（桌面下载侧 .lrc 缺口）· 验证归档 `docs/wayfinder/2026-09-13-mobile-download-metadata-verification.md` · 术语见 `GLOSSARY.md`（内嵌元数据 / 歌词侧车 / 列表封面）

## 背景

移动端下载的歌曲没有元数据：文件里没有封面/标题/歌手，网易/汽水的 `.lrc` 侧车恒缺失（列表结果 `Song.lrc` 恒空，#409），下载页列表只有 `Music` 占位图标。票面设想的路径是「移动端对齐桌面 `writeMetadata`」。

动手前的核查（2026-10-04，本机实测 + AOSP/media3 源码）推翻了票面的三处假设：

1. **m4a 的「对齐桌面」是假达标。** mp3tag.js 的 MP4 支持写的是 `ID32` box（ID3v2-in-MP4），README 明写不支持 iTunes `ilst` atoms；实测原文件的 `ilst` 原样未动、另插一个 ID32。AOSP `MPEG4Extractor` 解析 ID32（`payload+6` 偏移与 mp3tag 输出严丝合缝，含 APIC→`AMEDIAFORMAT_KEY_ALBUMART`），但 media3/ExoPlayer 与 Apple 系只认 `ilst`/`covr`——也就是最关心「其他播放器可见」的那批读取方恰好读不到。
2. **歌词侧车不能一律搜索补词。** #409 已否决对**按 ID 直取歌词源**（网易/汽水）的搜索兜底，并明确记录「下载侧 `.lrc` 仍按 `song.lrc` 驱动，网易/汽水恒空故不生成」为 #412 缺口。
3. **FLAC/Ogg 必须不写。** 实测把 FLAC 喂给 mp3tag：8962 → 701 字节，`fLaC` magic 消失、音频被毁。

同时，2026-08-14 的 `docs/wayfinder/2026-08-14-r3-download-gap.md` 曾判定「多格式标签嵌入移动端不做（RN 无等价写入库）」——该前提的前半已不成立（Metro 能打包 mp3tag 的 ESM 入口，expo File 有 `bytes()`/`write()`/`move(overwrite)`），后半仍成立（RN 无写标准 m4a/FLAC 标签的库）。

## 决策

1. **内嵌元数据只承诺 MP3**：走 mp3tag.js 写 ID3v2（TIT2/TPE1/TALB/TLEN/APIC），字段由 core `buildID3Frames` 统一构造，容器由 core `detectAudioContainer` + `tagStrategyForContainer` 判定。
2. **m4a 不写**（不写 ID32）。理由见背景 1：写进去只有 AOSP 自家栈可见，且占用文件名下唯一的 m4a 标签形态，将来补标准 `ilst`/`covr` 时还要二次处理。标准 m4a 写入属原生模块的量级，另票评估。
3. **FLAC/Ogg/unknown 一律 skip**，宁可不写也不错灌；这条由 `tagStrategyForContainer` 单点决定，且测试必须用**真 mp3tag 包**（mock 掉就测不出「喂 FLAC 会毁文件」这个真实陷阱）。
4. **写回用「临时文件 + `move(dest, { overwrite: true })`」，不原地覆写**。原地改标签是社区最常见的文件损坏来源（非原子、大小变化）；expo-file-system 的 `RelocationOptions.overwrite` 已在原生层实现（`FileSystemPath.move` → `moveTo(asCopyOrMoveDestination(overwrite))`），同目录 rename 天然原子。写失败时原文件保持完好。
5. **元数据写入失败静默 + 日志**，不得影响下载结果（对齐现有「侧车失败不阻断」口径）。
6. **歌词侧车按源分派**：存量内联文本直接用；`song.lrc` 为 URL 走 `getLyrics`；网易走 `getNeteaseLyrics(songId)`；汽水走 `getSodaLyrics(trackId)`；其余源 `lrc` 为空才搜索补全（#409 允许的唯一搜索场景）。取词决策**收敛为 core 单点**（纯函数），播放与下载共用，避免第三次「双端歌词决策漂移」。
7. **列表封面存远端直链**（下载记录新增 `cover` 字段），渲染统一走 `LazyCover`（空值同形占位 + 失败重试一次），失败回退占位；不落本地缩略图。
8. **只对新下载生效，不回填历史文件**；用户重新下载即自然修复。
9. 封面内嵌上限 **1 MB**（对齐桌面 `MAX_EMBEDDED_COVER_BYTES`），抓封面按源带 Referer；`mp3tag.js` 显式声明进 `packages/mobile/package.json`。

## 备选与否决

- **移动端完全不碰文件（只做列表封面 + 侧车）**：否决为终态，但它是本决策的降级档（若 Hermes 上 mp3tag 运行时不通过，退回此档不影响 6/7/8）。
- **m4a 写 ID32**（票面隐含方案）：否决，见决策 2。
- **原生模块写 m4a `ilst`/`covr` 与 FLAC `PICTURE`**：不在本票范围，不否决其价值。原生构建只在发版期验证（ADR `2026-09-29-ci-verification-boundary.md`），反馈环长，值得单开一票配真机验收。
- **歌词侧车用 `searchStrictMatch` 统一补词**（票面快档②）：否决。对按 ID 直取源是「多打一次请求且结果更差」；对非直取源才是允许路径。
- **历史文件启动后批量回填**：否决。在一段用户不可预期、不可见的窗口里对全部存量文件做 read→write→replace，失败面不可控；收益可用「重新下载」替代。
- **列表封面落本地缩略图**：否决。等于自建第二套图片缓存；ADR `2026-09-30-mobile-cover-loading.md` 已定「封面直链 + CDN 尺寸参数 + 失败重试一次」。

## 后果

- **用户可见能力**：MP3 下载在任意播放器/文件管理器可见标题/歌手/专辑/封面；**m4a 与 FLAC/Ogg 下载仍然没有内嵌元数据**——这是显式不承诺，不是遗漏。
- **TLEN 仍然写**（对齐桌面），但 **Android 不用它推导时长**（`MP3Extractor` 的 key map 无 TLEN，时长来自帧/Xing/VBRI），因此「时长」不得作为验收项。
- **`.lrc` 侧车在网易/汽水歌上首次可用**（按 ID 直取）。桌面侧仍按 `song.lrc` 驱动，#412 消费 core 单点后才对齐。
- **列表封面与文件封面是两份独立副本**：CDN 直链失效时行内是占位（`LazyCover` 重试一次），不做搜索兜底（行内没有可用的 `Song`）。
- **新增移动端依赖 `mp3tag.js`**（根已有，显式声明到 mobile 清单）；移动端 bundle 增大，换取文件级元数据。
- **Hermes 风险已从「未知」降级**：删掉 `globalThis.Buffer` 的代理实测（真包、ESM 入口、四种容器往返）无异常，`save()` 在无 Buffer 环境返回 raw ArrayBuffer——类型归一化必须覆盖这一分支。真机侧仍需一次运行验收。
