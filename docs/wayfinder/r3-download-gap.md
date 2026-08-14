# 下载增强与可播放性预检差距清单（wayfinder research /r3）

> 主参考 musicdl（primary source 源码）：`C:\Users\Admin\AppData\Local\Temp\musicdl-clone\musicdl\modules\`
> MPlayer 现状（源码）：`D:\Playground\mplayer\`
> 结论按「现状 → musicdl 做法 → TS 移植方案 → 桌面/移动端可行性 → 优先级」逐项给出。
> 优先级：**P0** = 花小钱大收益、应先做；**P1** = 价值高但需解耦/引依赖；**P2** = 成本高或收益尚不确定。
> 注：CLAUDE.md 中 `src/main/cache/cacheManager.ts` 已拆分，实为 `src/main/cache/diskBackend.ts` + `src/main/ipc/cache.ts`，报告据此引用。

---

## 背景速览：两端现状的关键事实（影响后续每项）

- **downloadService.ts**（436 行）：主进程 axios `responseType:'stream'` 下载，`onDownloadProgress` 仅用 `Content-Length` 算百分比（`L277-283`）；`Content-Type` 只有一段白名单 `audio/mpeg|mp4|flac|ogg`（`L287-295`）；写完文件后**无条件**走 `writeMetadata()`（`L346-347`）。重试用 `downloadFileWithRetry` 指数退避（`L202-229`）。
- **歌曲 URL 解析**：`packages/core/src/api/musicApi.ts` 的 `getAudioUrl()`（`L518-574`）`maxRedirects:3`、`validateStatus:<400`、拿 `responseUrl` 后写 URL 缓存，但**不校验 Content-Type / 扩展名 / 是否真的音频**——解析成功≠可播放。
- **playable 解析链**：`packages/core/src/shared/resolvePlayableUrl.ts` 的 `resolvePlayableUrl()`/`resolvePlayableSong()` 只保证拿到 http URL，无预检；`getAudioUrl` 在这里兜底（`L60`）。
- **缓存**：`src/main/ipc/cache.ts` + `src/main/cache/diskBackend.ts`。已按 URL md5 缓存音频，`diskBackend.isAudio()` 已做首字节嗅探（ID3/fLaC/OggS/ftyp/MPEG sync，`L142-149`）——**字节嗅探的基建在桌面端已部分存在**，只差 URL 级预检层。
- **依赖现状**（package.json）：已依赖 `music-metadata@11`（**只读解析器，可读但不写标签**）与 `mp3tag.js@3.17`（**只写 ID3/MP3**）。**无任何 ffmpeg / tag 写多格式库**。
- **.lrc**：全仓无下载后写 `.lrc` 的逻辑（grep `.lrc` 仅 lyrics 缓存/解析用）。

---

## 1. AudioLinkTester 的 HEAD→GET 可播放性预检（P0）

### 现状
- MPlayer 没有任何「URL 可播放性预检」。`getAudioUrl()` 只做重定向+重试，命中 `<400` 即视为成功（`musicApi.ts L539-553`）；播放链路 `resolvePlayableUrl()` 直用 http URL。
- 失败后才在 playback 层暴露（getAudioUrl 返回原 URL 兜底 `L564` 或 `L573`），无提前探测。

### musicdl 做法（`misc.py` AudioLinkTester）
- `test()`（`L339-375`）：先 `HEAD`（`request('HEAD',...)`，L344-356）拿 `headers→file_size/ctype/redirect final_url（download_url）`。HEAD 成功且能从 `inferext()` 推出合法音频 ext 就直接返回。
- HEAD 失败/推不出 ext → 退 `GET stream`（`L358-369`），`sampleresponsebytes(8192)`（`L281-289`）首 8KB 参与**字节嗅探**。
- 格式推断链 `inferext()`（`L305-337`）优先级：**URL 后缀（original/final）→ Content-Disposition 文件名 → mimetypes.guess_type(URL) → MIME_TO_PREFERRED_EXT(content-type) → mimetypes.guess_extension → filetype.guess(首字节) → puremagic.from_string(首字节)**。每级不合法就记入 `reason` 降级下一级。
- 结果对象含 `ok/ctype/ext/download_url/file_size_bytes/method/reason`——给调用方完整诊断。

### TS 移植方案
- 新增 `src/main/services/audioLinkTester.ts`（主进程，可用 axios/https agent）：
  - `test(url)` → `{ok, ctype, ext, finalUrl, sizeBytes, method, reason[]}`
  - `inferext(originalUrl, finalUrl, ctype, contentDisposition, sampleBytes)` 照搬五级链；TS 无 `mimetypes`/`filetype`/`puremagic`，用 `music-metadata` 的 `parseBuffer(sampleBytes)` 判断格式（**注意 music-metadata 是只读解析器，正合适做字节嗅探**），MIME→ext 映射表手写（musicdl `MIME_TO_PREFERRED_EXT`，`misc.py L197-201`）。
  - HEAD 用 axios `method:'HEAD'` + `maxRedirects:10`（比 MPlayer 现在 `getAudioUrl` 的 3 级更宽松）；HEAD 失败降级 GET+`responseType:'arraybuffer'` 拿前 8KB。
- **接入点**（三选一并建议都做，见 L63）：
  1. `getAudioUrl()` 内联预检——解析 URL 后顺手 `AudioLinkTester.test()`，把 `ext/ok` 存进缓存。
  2. `resolvePlayableUrl/resolvePlayableSong` 尾部——把原来「只看 http」提升为「检测到非音频就标记不可用、触发 refresh/换源」。
  3. `downloadService.downloadFile()` streaming 前预检——**与下载天然合并**：反正要 GET stream，可把预检的 HEAD 结果用于选扩展名、判失败，省一次整套下载。

### 桌面/移动端可行性
- **桌面可行（P0）**：主进程 Node axios 全能力，`isAudio` 嗅探基建已在 `diskBackend`。改动集中在一个新 service + 3 个调用点。
- **移动端受限（P1）**：core 的 `getAudioUrl` 被 RN 复用，但 RN 无 Node `Agent`（已有已知 proxy 限制）。可把**无字节嗅探、仅 URL 后缀+Content-Type+HTTP 状态**的轻量预检放 core，供两端共用；MOV 移动端不做首 8KB 嗅探（成本/收益不划算）。

---

## 2. 质量阶梯 + 位率门控（判伪高音质）（P0）

### 现状
- 零质量阶梯、零位率门控。`fetchNeteaseSongUrlMap`（`musicApi.ts L1186-1203`）用了 `level:'standard'` 固定档；soda `getSodaAudioUrl` 只按 `size` 取最大（`L355-357`）。下载直接拿「当前这条 URL」。

### musicdl 做法
- `songinfoutils.py`：
  - `estimatedurationwithfilesizebr(file_size_bytes, br_kbps)`（`L264-270`）→ `duration_s = file_size*8/(br*1000)`，可反推**期望文件大小**。
  - `estimatedurationwithfilelink`（`L271-276`）用 mutagen 读远端音频 `info.length` 拿真实时长。
- **位率门控的判断思路**：拿 `Content-Length（file_size_bytes）` + 已知 `duration`（Song.duration）反推实际平均位率，若 `file_size*8 < bitrate_claimed*duration` 显著偏低 → 判定为「伪高音质 / 被源降级」。结合质量阶梯（lossless→hires→320 等）**逐档尝试**，拿不到目标档就如实降档，而不是静默给低质。

### TS 移植方案
- 下载前（或 `getAudioUrl` 内）做 **位率门控**：
  `const estKbps = file_size_bytes*8 / (durationMs/1000) / 1000`，与期望档位（如 flac≈900+、320、128）比较。
- 网易云质量阶梯：`/song/enhance/player/url/v1` 的 `level` 参数从 `lossless/hires → exhigh → higher → standard → lower` 逐档降级尝试，取第一个返回非空 `url` 的档（保留现有 `encodeType:'mp3'`）。
- soda：`play_info_list` 已含多档，目前只按 `size`，改为**从大到小命中「合规位率」**（避免 point 桶远大于实际）。

### 桌面/移动端可行性
- **桌面可做（P0）**：纯计算 + API 参数调整，主进程 `getAudioUrl/UrlMap`。建议只加在下载链路和「音质选择」设置项，播放链路默认不动（避免预检拖慢播放首响）。
- **移动端可做（P1）**：若 `resolveNeteaseSongUrls` 迁 core 或加参数，移动端复用同一门控函数（纯 TS 无 Node 依赖）。注意与现有 `resolveNeteaseSongUrls(skipSearchFallback)` 兼容。

---

## 3. 下载后补全：真实位率/采样率 + .lrc + 标签/封面（P0/P1）

### 现状
- **真实位率/采样率：无。** 下载后不重新解析，只有「服务器说的 ext/Content-Length」。
- **.lrc：无。** `downloadService.writeMetadata` 只写 ID3；Song 带 `lrc` 字段但从未落盘。
- **标签/封面嵌入（差距点）**：
  - 用 `mp3tag.js`（`MPlayer downloadService L53-102`）：只 cover **MP3/ID3**。对 `.flac/.ogg/.m4a/.wav` 也灌 ID3（`writeMetadata` 不看格式，只对 m4a 改 padding `L85-88`），**是错的做法**——FLAC 落 ID3 是垃圾数据，且封面用 `APIC`（MP3 专属）。M4A 封面应走 `covr`、FLAC 应走 `METADATA_BLOCK_PICTURE`。
  - 写标签会**整体 read+save 覆写文件**（`L55-98`），无 `audioreadable` 校验、无原子写/临时文件回滚——比 musicdl 的 `safeeditaudio`（`songinfoutils.py L78-96`）弱。
  - `music-metadata` 是**纯解析器，不写**；`mp3tag.js` 是**纯 MP3 写入**。多格式写入二者都缺。

### musicdl 做法（`songinfoutils.py`）
- `supplsonginfothensavelyricsthenwritetags`（`L39-59`）：下载后 `TinyTag.get(path)` 解析真实 `bitrate/samplerate/channels/duration/codec`，回填 SongInfo。
- `savelyricsthenwritetagstoaudio`（`L61-71`）三件套：另存 `.lrc`、内嵌 USLT/\xa9lyr/LYRICS、`embedbasictags`+`embedcover`。
- `embedbasictags`/`embedcover`/`embedlyrics`（`L97-203`）按格式分支：MP3→ID3(TIT2/TALB/TPE1/APIC/USLT)、MP4→`covr/\xa9nam/\xa9alb/\xa9ART/\xa9lyr`、FLAC/OGG→`METADATA_BLOCK_PICTURE`+Vorbis tags、ASF→`WM/Picture`。
- `safeeditaudio`（`L78-96`）+ `atomicwritetext`（`L245-251`）：临时文件 + `os.replace` 原子化，写前 `audioreadable` 校验，失败自动回滚。
- `loadimagebytesandmime`（`L205-221`）：封面下载后按**首字节签名**判 mime（JPEG `FFD8FF` / PNG `8950`），避免错 mime。

### TS 移植方案
- **真实参数**：用已有 `music-metadata` 的 `parseFile(filePath)` 拿 `format.bitrate/sampleRate/numberOfChannels/duration + common.tags`（`localMusicService.ts L20-24` 已验证可主进程懒加载）。
- **.lrc 写入**（P0，成本极小）：在 `downloadFile` 末尾，若 `song.lrc` 存在，`fs.writeFileSync(pathWithExt('.lrc'), song.lrc)`（参照 musicdl `savelrctofile` L73-77：`\r\n→\n`、空/None 跳过、已存在不覆盖）。
- **多格式标签/封面**：**决策点**——`mp3tag.js` 只够 MP3。移植方案二选一：
  - A（P1，推荐）：引入 `music-tag` / `node-taglib-sharp` 之类**跨格式 tag 写入库**，按 ext 分支写（MP3/FLAC/M4A/WAV）。改动大但一劳永逸。
  - B（P2，轻量）：保留 mp3tag.js 仅限 `.mp3`；其他格式跳过标签或仅 `.lrc`，并**修复现在对 FLAC/M4A 错灌 ID3 的行为**（至少按 ext 判断，不写就不写）。
- **脚手架**：照 `safeeditaudio` 加「写临时文件 + 校验 + `os.replace`」+ `audioreadable` 前置，避免半截文件。

### 桌面/移动端可行性
- **桌面可行**：`.lrc` 与真实参数 P0 低成本；多格式标签 = 引依赖的 P1。
- **移动端边界**：expo-file-system 可写 `File`，但**无 fs 原子 replace、无 mp3tag/music-metadata 写入**。最小可做 = 另存 `.lrc`（字符串写文件）+ 真实参数（`music-metadata` 可 bundle）；**多格式标签嵌入移动端不做**（RN 生态无等价写入库）。

---

## 4. HLS 下载 + ffmpeg remux 的 Electron 可行性（P1/P2）

### 现状
- **无 HLS 支持**。`ext` 判定白名单不含 `m3u8`；`downloadService.ts L287-295` 会把 HLS 直链当普通 GET 下成坏文件。
- **无 ffmpeg 捆绑**。package.json 无 ffmpeg-static/ffmpeg；electron-builder.yml `files`（`L9-24`）无 extraResources 携带二进制；`afterPack: scripts/afterPack.js` 未见 ffmpeg 逻辑。

### musicdl 做法
- `utils/hls.py` `HLSDownloader`：解析 master/m3u8（`loadm3u8`/`resolvemediaplaylist`，L125-138）→ variant 选择（带宽/分辨率，`selectvariant` L146-152）→ 分段并发下载（`downloadsegments` 16 并发）→ AES-128/CTR 解密（`decryptsegment`，CBC 手工 + PKCS7 去 padding）→ 合并（`mergesegments`）→ `finalizeoutput`（L229-237）：**有 ffmpeg 走 `ffmpegcopyaudio` remux（`-vn -map 0:a:0 -c:a copy`，cmd.py ExtractAudioFromVideoFFmpegCommand L173-176）**，无 ffmpeg 退直接 copy。
- 还支持 `ffmpeg -decryption_key`（cmd.py FFmpegDecryptRemuxCommand L190-198）解 FairPlay 类 DRM。

### Electron 可行性判断
- **ffmpeg 捆绑**：可行，二选一：
  - 桌面推荐做法：`ffmpeg-static`（devDependency）→ 打 `extraResources:[{from:'node_modules/ffmpeg-static/ffmpeg.exe', to:'ffmpeg/ffmpeg.exe'}]`，运行时 `app.isPackaged ? path.join(process.resourcesPath,'ffmpeg/ffmpeg.exe') : 开发路径`。electron-builder `files` 需在 packaged 下把资源放 `resources/`（不在当前 `files` 白名单，需加一项）。
- **纯 JS 替代（P2，不需 ffmpeg）**：多数 HLS 纯 AES-128 分段，可用 Node `crypto` 手工 AES-CBC 解密 + 合并，等价 `hls.py` `decryptsegment` + `mergesegments`——**已下载内容为未 remux 的 `.aac/.ts`，多数播放器可直放**。ffmpeg 主要解决「m4a 容器 remux / 需要统一格式」时才有刚需。
- **建议切分**：先把 `HLSDownloader` 的 **JS 版（分段并发+AES 合并）** 作为 P1，保证「能下能播」；ffmpeg 仅当需要 remux 成统一 m4a 时才引入（P2）。

### 桌面/移动端可行性
- **桌面可行（P1 JS 版；P2 +ffmpeg remux）**。Electron 主进程有 fs/crypto/并发，和 Python 版完全等价；ffmpeg-static 打 package 是已知路径。
- **移动端边界**：**无 ffmpeg、无主进程、无 Node crypto 高性能 AES**。HLS 移动端建议：分段下载 + 合并交 `expo-file-system`，AES 解密用 JSI 或 `react-native-aes-crypto`；产出 `.aac/.ts` 直放（expo-av 可播），**remux 明确不做**。

---

## 5. HTTP Range / 断点续传 / 批量队列增强（P1/P2）

### 现状
- **无 Range/断点续传**：`downloadFile` 每次从头 GET 重下（`L269-285`）。重试（`downloadFileWithRetry`）也只重开；中断无 `.part` 恢复。
- **批量队列已基本成型**：`maxConcurrentDownloads=3`（`L31`）、`queue[]`+`activeDownloads`（`L27-29`）、`addBatchDownloads`（`L145-180`）、abort（`cancelDownload` L358）。相对 musicdl base.py `download()`（ThreadPool，主进程无队列）MPlayer **已在并发/取消上领先**。
- Content-Length 缺失时无进度（`L277-283` 只算 `total` 存在时）。

### musicdl 做法
- `base.py _download`（`L216-231`）：`chunk_size` 流式循环写；**未知总量进度**——`total_size==0` 时用「重算 total=已下载量」维持进度条（`L227-228`），避免卡 0%。
- `verify=false` 重试：第一次 `raise_for_status` 失败就 `verify=False` 重下（`L220-221`）——对**自签/证书链问题 CDN**的韧性。这个点 MPlayer 代理/https 场景可借鉴。
- Range 体现在 AudioLinkTester `request(range_bytes)`（`misc.py L299-302`）与 HLS segment Range。

### TS 移植方案
- **未知总量进度**（P0,直接受益）：`onDownloadProgress` 里 `!progressEvent.total` 时改用「字节累计换算成 *indeterminate*（转圈）或按已下载 MB 数展示」，而不是无进度。
- **verify=false 二次重试**（P1）：主进程 axios `httpsAgent` 在证书错误时 `rejectUnauthorized:false` 重试一次（对齐 musicdl；MPlayer 仍调 `getHttpAgent/getHttpsAgent`，需暴露一个宽松 agent）。
- **断点续传（P2）**：响应支持 `Accept-Ranges/Content-Range` 时，落 `.part` + 记录已写 offset，中断后用 `Range: bytes=<offset>-` 续传。存量 `diskBackend` 已会 Content-Range 解析（不在 MPlayer，但 `parsesizefromheaders` 思路在 misc.py L260-264）。桌面做、移动端不做。
- **队列增强（P1 小）**：给 `addBatchDownloads` 加失败歌曲重排/隔离，暴露「每任务按 ID 拿新 url 后仍失败则标 error」；同时把 `getAudioUrl`（可能产生新的可播放 URL）与下载文件 URL 分离，避免缓存串味。

### 桌面/移动端可行性
- **未知总量进度：两端均可（core 可共享）。**
- **verify=false、断点续传：桌面做。** 移动端 http 栈（expo/fetch）不受控，Range 续传不做。

---

## 6. 移动端（RN/expo-file-system）下载增强的边界（P1 综述）

### 现状
- mobile 下载是**占位**（`packages/mobile/app/(tabs)/download.tsx` 纯占位；gap-list.md 已列为最大单点缺口）。播放走 core 内存 URL（AsyncStorage `songUrl:`）。
- RN 无主进程、无 fs 原子写、无 mp3tag/music-metadata 写入、无 ffmpeg。

### 可移植 / 不可移植清单（对齐前面各项）
- **可移植到 core（两端共用纯 TS）**：AudioLinkTester 的**轻量版**（URL 后缀+Content-Type+HTTP 状态，不做字节嗅探）；位率门控计算；`.lrc` 文本写文件；未知总量进度逻辑；队列/并发/去重逻辑。
- **必须 desktop-only**：多格式 tag/封面写入（需 fs+tag 库或 ffmpeg）、HLS remux、断点续传 `.part`+Range、verify=false agent、首 8KB 字节嗅探（可在 core 用 `music-metadata.parseBuffer` 但仅当能拿到 buffer；网络拉 8KB 在 RN 可行，靠 expo-file-system `downloadAsync` + 读头部，成本中等，作为 P2）。
- **建议架构边界**：把「URL 解析→预检→（下载/播放）」的纯计算抽到 `packages/core`；下载 I/O 留给各端 adapter。这样桌面主进程与移动端 Share 同一套门控/预检判定，只有落地写文件分支不同。

### 移动端最小 P0 落地建议
1. 先做 `.lrc` 落地（expo-file-system 写文本）+ 真实参数（music-metadata bundle，部分格式）。
2. 借 core 位率门控做「下载成功即如实报告实际档位」。
3. HLS 承接桌面 JS 版逻辑，但移动端不 remux。

---

## 优先级总表

| 项 | 内容 | 端 | 优先级 |
|----|------|----|--------|
| 1 | HEAD→GET 可播放性预检 + 格式推断链（≤8KB 嗅探） | 桌面全量 P0 / core 轻量 P1 | **P0** |
| 2 | 质量阶梯 + 位率门控（`file_size*8 < bitrate*duration`） | 桌面+core | **P0**（下载/音质选择侧） |
| 3 | `.lrc` 落盘 + music-metadata 真实参数 | 两端 | **P0** |
| 3b | 多格式标签/封面（修正 mp3tag 错灌 ID3 → 按 ext 分支/引跨格式库） | 桌面 | **P1** |
| 4 | HLS JS 版（AES 合并） | 桌面 P1 / 移动端 P1（不 remux） | **P1** |
| 4b | ffmpeg-static 捆绑 + remux | 桌面 | P2 |
| 5a | 未知总量进度 | 两端 core | P0 |
| 5b | verify=false 二次重试、断点续传 Range | 桌面 | P1 / P2 |
| 6 | 移动端边界界定（I/O 抽 core adapter） | core 架构 | P1（架构先行） |

---

## 最高价值的 3 个增强（核心结论）

1. **可播放性预检（P0）**：移植 `AudioLinkTester` 的 HEAD→GET + 五级格式推断链（URL 后缀→Content-Type→**首 8KB 字节嗅探**），接入 `getAudioUrl()` / `downloadService.downloadFile()` 前。这是性价比最高的改动——现有链路「解析成功=假可播」是根源问题，`diskBackend.isAudio()` 的嗅探基建已经存在，只缺一层干这件事的 URL 预检器。
2. **质量阶梯 + 位率门控（P0）**：`file_size*8 < claimed_bitrate*duration` 判伪高音质 + 网易/soda 逐档降级。改 API 参数与一处纯计算，直接解决「下了个低质/降级源还显示无损」的用户可见痛点。
3. **`.lrc` 落盘 + 真实参数补全（P0）**：下载末尾落 `.lrc`（字符串写文件，代价极小）+ 用已依赖的 `music-metadata.parseFile` 回填真实 bitrate/sampleRate。顺手**修复现有对 FLAC/M4A 错灌 ID3** 的 bug（`writeMetadata` 不看格式）——这是把「下载增强」的一小步变成「不产生坏元数据」的硬修复。
