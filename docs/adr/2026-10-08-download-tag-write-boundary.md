# ADR: 下载内嵌元数据的容器口径：只承诺 MP3，两端消费同一份计划（#607）

- 状态：已接受
- 日期：2026-10-08
- 关联：**#607**（本决策票）· #189 与 `2026-10-04-mobile-download-metadata-boundary.md`（移动端先行的同口径决策；本 ADR 把**同一条口径扩到桌面**，那个 ADR 的正文与移动端决策不变）· 术语见 `GLOSSARY.md`（内嵌元数据 / 歌词侧车）
- 落地：core `packages/core/src/download/tagging.ts` 的 `planAudioTagging` 单点；守卫见 `src/__tests__/main/downloadTaggingRoundTrip.test.ts`（真 mp3tag.js + music-metadata）

## 背景

同一个 core 决策值在两端含义相反，且都不报错（#607 的「沉默的分叉」）：

- core `tagStrategyForContainer` 把 `m4a` 判成 `mp4`；
- 桌面 `src/main/services/downloadService.ts` 只对 `skip` 早退 → 于是**往 `.m4a` 写标签**，注释还写着「M4A 走 mp3tag.js 的 MP4/ID32 容器写入」；
- 移动 `packages/mobile/services/downloadService.ts` 只认 `id3` → **静默跳过**。

同一首歌下载下来，桌面有标签、移动没有。动手前必须裁定口径——两处说法互相对撞：`tagging.ts` 的注释说「桌面 mp3tag.js 支持」，`2026-10-04` 的移动 ADR 说「mp3tag.js 写的是 ID32，media3/ExoPlayer 与 Apple 系读不到」。**先实测，再收敛。**

## 实测（2026-10-08，本机；脚本与输出原文）

判据：用 `mp3tag.js@3.17` 按**桌面当时的调用序列**写，再用 `music-metadata@11.16.1`（纯读取方，仓里已依赖）读回——**读得回才算支持**。脚本放 `%TEMP%`，不入库。

输入是仓库自带的真 fixture（`packages/core/src/shared/__tests__/fixtures/sample.m4a`，2994 字节的真 MP4/AAC）。

```text
$ node %TEMP%/m4a-tag-experiment/experiment.mjs
（脚本：拷 fixture 到 %TEMP% → core detectAudioContainer/tagStrategyForContainer
  → 桌面同款 mp3tag read/写 TIT2/TPE1/TALB/APIC → save({id3v2:{padding: isM4a?0:2048}})
  → dump MP4 atom 树 → music-metadata.parseFile 读回）

################ m4a ################
original: size=2994 sha256=abde14e096524b73 head=0000001c667479704d34412000000200
--- atom tree: BEFORE ---
  ftyp size=28
  moov size=1631
    ...
    udta size=98
      meta size=90
        hdlr size=33
        ilst size=45
          ©too size=37
  free size=8
  mdat size=1327
=== music-metadata parseFile: BEFORE ===
format.container = "M4A/isom/iso2"   format.codec = "MPEG-4/AAC"
common.title = undefined   common.artist = undefined   common.album = undefined   common.picture = null

[desktop path] detectAudioContainer -> m4a | tagStrategyForContainer -> mp4
[desktop path] wrote back 2994 -> 3285 bytes

--- atom tree: AFTER ---
    udta size=389
      meta size=381
        hdlr size=33
        ilst size=45          ← 原样未动（仍只有 ©too）
          ©too size=37
        ID32 size=291         ← 新增：ID3v2-in-MP4
=== music-metadata parseFile: AFTER ===
format.container = "M4A/isom/iso2"   format.codec = "MPEG-4/AAC"
common.title = undefined   common.artist = undefined   common.album = undefined   common.picture = null

################ mp3(control，同一段代码路径) ################
original: size=20420 sha256=4db9380f04671f11 head=49443304000000000023545353450000
[desktop path] detectAudioContainer -> mp3 | tagStrategyForContainer -> id3
after: size=20420 -> 22725
=== music-metadata parseFile: AFTER ===
format.container = "MPEG"   format.codec = "MPEG 1 Layer 3"
common.title = "晴天"   common.artist = "周杰伦"   common.album = "叶惠美"
common.picture = [ 'image/jpeg:160B' ]
```

读法：

1. **M4A 写进去了，但标准读取方读不回。** 标签全部落在 `moov > udta > meta > ID32`（ID3v2-in-MP4），原 `ilst` 一个字节不动——`music-metadata` 读回 title/artist/album 全是 `undefined`、封面 `null`。容器没被毁（`format.codec` 仍是 `MPEG-4/AAC`），产出却是「看不见的标签」。
2. **MP3 阳性对照通过。** 同一段调用序列往 MP3 写，读回标题/歌手/专辑/封面俱全——所以第 1 条不是测试坏了。
3. 依赖侧佐证：`mp3tag.js@3.17` 的实现是 `findID32Box` 沿 `moov > udta > meta > ID32` 找 box（`dist/mp3tag.mjs`，无任何 `ilst`/`©nam` 写路径）；`music-metadata@11.16.1` 的 `lib/` 里 `ID32` **零命中**（只有 `ilst`），即读取方根本没有这个分支。

结论：**M4A 属于「不能写」**——不是「桌面能写、移动是缺口」，也不是「错灌 ID3 毁文件」，而是**写了个两端都读不回的假标签**。桌面在假达标，移动的 skip 才对。

## 决策

1. **口径：只对 MP3 承诺内嵌元数据。** m4a / flac / ogg / unknown 一律不写——宁可不写，也不写标准读取方看不见的数据。
2. **`TagStrategy` 去掉 `mp4`**，只剩 `'id3' | 'skip'`；`tagStrategyForContainer('m4a')` 返回 `'skip'`。没有任何容器映射的策略值留着，只会被下一个读代码的人当成「支持」。
3. **core 单点 = `planAudioTagging(container)`**，返回 `{ container, strategy, skipReason }`。两端下载 adapter 只消费它，不再各自判断容器；跳过原因（如「M4A 无标准标签写入路径（…ID32…）」）也出自 core，两端日志同一句。
   帧构造仍走 `buildID3Frames`，**不进计划**：封面是要发网络请求的 I/O，只有确定 `strategy === 'id3'` 时才该抓；把封面塞进计划会逼着不写的容器也去抓一次封面。
4. **桌面改为不写**：`plan.strategy !== 'id3'` 早退（原为 `strategy === 'skip'`），并删掉 M4A 专用的 `padding: 0` 分支。
5. **移动改为消费同一 plan**（行为不变，它本来就只写 ID3）。
6. **守卫**：core 的策略/计划用例 + 桌面「m4a 产物零字节不变」+ `downloadTaggingRoundTrip.test.ts` 用**真包**把上面这条实测钉进 CI（故意不 mock——mock 掉就只剩自说自话）。

## 备选与否决

- **维持桌面写 ID32**（「至少 AOSP 自家栈能读」）：否决。最关心「换个播放器还能看见」的那批读取方（iTunes/Apple 系、media3/ExoPlayer、music-metadata）恰好读不到；写进去还占掉该文件名下唯一的 m4a 标签形态，将来补标准 `ilst`/`covr` 时要二次处理。
- **引跨格式 tag 写入库**（`music-tag` / `node-taglib-sharp`）写标准 `ilst`/`covr` 与 FLAC `PICTURE`：不在本票范围，不否决其价值。属新依赖 + 移动端需原生模块的量级，另票评估。
- **只把移动端改成「跟桌面一样写」**（对齐到错误的一侧）：否决。收敛的是**口径**，不是把桌面继续留在假达标上。
- **保留 `mp4` 策略值「以后可能用」**：否决，同决策 2。
- **给历史 `.m4a` 批量清理已写入的 ID32**：否决。在一段用户不可预期、不可见的窗口里对存量文件做 read→write→replace，失败面不可控；ID32 不影响音频播放，留着无害。

## 后果

- **用户可见**：MP3 下载仍有内嵌标签（任意播放器可见）；**`.m4a` 下载不再被重写**——此前会被加一个其它播放器看不到的 ID32。桌面与移动的产物从此一致。
- **行为变化**：桌面 `.m4a` 下载产物**字节不变**（此前的 ID32 追加消失）；不区分新旧下载，历史文件不清理。
- **回归保护**：mp3tag.js 升级后若真支持 iTunes `ilst`，`downloadTaggingRoundTrip.test.ts` 的 M4A 断言会变红——那是重开本决策的信号，而不是删断言的理由。
- **仍缺**：m4a 的标准内嵌标签（`ilst`/`covr`）两端都没实现，**显式不承诺**；FLAC/Ogg 同样不写。
- **已知差距（本票不动）**：桌面写回仍是**原地覆写**（`fsp.writeFile` 直接写回原路径），不是移动端那种「临时文件 + 原子 move」；MP3 写标签中途失败会留下半截文件。属 #412 一带的既有问题，另票处置。
- **诊断差异（有意保留）**：桌面跳过时打 `console.log`（主进程日志），移动端静默——`skipReason` 已由 core 统一，移动端要接随时可接，但本票不引入新的用户可见日志噪音。
