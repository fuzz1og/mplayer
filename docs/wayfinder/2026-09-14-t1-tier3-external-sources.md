# T1 · 外部可用解析源生态：GitHub 上的第三方音源能不能接进 tier3

- **日期**：2026-09-14
- **仓库基线**：`f664a1745937be6bfa92bf4e466ebc44c3330c2f`（2026-09-13，master）
- **调研问题**：用户抱怨 tier3「源会过期、有并发限制、源太少、覆盖面窄」。GitHub 上还有哪些可用解析源/解析方法？它们能否落到 MPlayer 现有的 tier3 声明式契约上？如果源是 JS 插件，tier3 是不是根本吃不下？
- **证据纪律**：只采 primary source —— 项目官方文档、仓库真实源码、GitHub API 返回的 commit/issue 时间戳、以及**调研当日对源站端点的实测**。实测结果标注抓取时间。找不到的写「未找到」，不编造字段名。
- **前置研究**：`r5-unofficial-sites.md`（musicdl 的 17 站爬虫 + 30 个解析 API）已把 A/B/C 三类源与合规结论做了一遍，本报告**不重复**其内容，只做生态（开源客户端插件体系）维度的增量，并复核其结论。

---

## 0. 一句话结论

> **本节已按 §6.5 的独立复跑结果修订**（原文有两处论断被实测推翻，见各条 ⚠️ 标记）。

1. **tier3 只能吃「参数化 JSON 解析 API」**；当前最活跃、最有生命力的第三方源生态（lx-music 自定义源脚本、MusicFree 插件）**都是 JS 插件**，tier3 契约**没有任何字段能表达它们**——「JS 插件 tier3 根本吃不下」**成立**，且这是本次调研最重要的结论。
   ⚠️ **但「吃不下」的理由需要更正**：原文把「移动端 Hermes 不支持 `eval`」列为理由之一。**该论断错误**——Hermes 排除的是 **local eval**，`new Function()` 一直受支持（维护者原话，见 §3.1 勘误）。**真正的墙是「MPlayer 移动端没有任何原生模块」，而 lx-music-mobile 的做法是在 `hermesEnabled=true` 之外另带 QuickJS + JNI + 独立线程。**
2. 能被 tier3 **零改动或极小改动**吃下的，实际只有 **GD Studio**（公开文档、匿名可用、实测可拿 320k 直链）和 **vkeys（落月 API）**（匿名可用、V3 有公开文档）等少数「参数化 API」源，而不是那些「源清单仓库」。
3. 用户抱怨的三个症状（过期、并发限制、源太少）**不是 MPlayer 特有的实现问题，而是整个生态的固有属性**：lx-music 官方在 2023-10-18 因腾讯投诉**移除了所有内置源**；MusicFree 示例插件仓库**因收到告知函不再提供国内厂商源**；GD Studio 自述**5 分钟 50 次**限流；Huibq 的源在 README 里直接写「反复请求会被封禁 IP」。
4. 换句话说：**接入更多源 ≈ 把用户从一个失效面挪到另一个失效面**，边际收益低，而合规风险（会员/SVIP/无损破解）与许可证冲突（AGPL/CC BY-NC vs PolyForm NC）是新增的、明确的。
5. r5 的「破解类不引入」结论**今天仍然成立**，且获得新的直接证据：vkeys V3 官方文档自述「v2 版本接口因腾讯官方接口调整，**无法获取会员歌曲以及高音质音乐**」——反过来证明其返回的 SQ 无损 / Hi-Res / 臻品母带档位就是**会员内容**。本子代理进一步**实测了全部 10 个 quality 档位**：一条 `pay:"免费"` 的曲目在 `quality=10` 拿到 1644kbps FLAC、`quality=14` 拿到 5549kbps 母带（见 §6.5.1），**坐实「匿名端点默认档位即破解档」**。

6. **【本报告最直接的答案，见 §6.6】在「tier3 零改动可表达 + 匿名无凭据 + 不涉会员/SVIP/无损破解」三项同时成立的前提下：结构上可接 2 个源（GD Studio、vkeys），实质上有价值的 0–1 个。** 且这一个（GD Studio）的价值还被一个**未验证的阻塞**悬着——**它现在挂在 Cloudflare managed challenge 后面**（本机 curl 换 UA / 补 `Sec-Fetch-*` 头 / 走 http **全部 403 + `cf-mitigated: challenge`**，只有浏览器型抓取器通关，见 §6.5.2）。**「再接几个源就能解决覆盖面窄」在这条路上不成立。**

7. **「源会过期」是生态结构性事实，不是 MPlayer 的实现缺陷。** 四条一手证据：lx-music 因腾讯投诉于 2023-10-18 移除全部内置源；MusicFreePlugins 因**收到告知函**撤下全部国内厂商源（且 `plugins.json` 已整体迁往 gitee）；`xxnuo/MusicFreePluginsHub`（3.2k★）整仓清空（README 仅一句 `This repository has been cleared.`）；作者本人 2024-05-26 在 issue #1912 宣布 LX 进入维护模式。

---

## 1. tier3 契约的字段级说明（能吃什么、不能吃什么）

来源：`packages/core/src/tier3/tier3Api.ts`、`packages/core/src/shared/sourceRouter.ts`、`CONTEXT.md:40`。

### 1.1 顶层结构

| 概念 | 字段 | 位置 | 约束 |
|---|---|---|---|
| 清单 | `{ version: 1, sources: Tier3Source[] }` | `tier3Api.ts:80-83`、`285-304` | `version` 只接受 1（`293`）；`sources` 必填且 `id` 唯一（`296-302`） |
| 源类型 | `kind: 'url-resolver' \| 'search-then-resolve'` | `tier3Api.ts:31`、`186`、`255` | **白名单只有这两个值**，其它一律 `清单校验失败：source.kind 不支持` |
| 订阅形态 | `kind: 'url' \| 'text' \| 'file'` | `tier3Api.ts:85` | URL 订阅走 `fetchTier3ManifestFromUrl`（`694-716`），只允许 http(s) |

### 1.2 `Tier3Source` 逐字段

| 字段 | 语义 | 位置 | 备注 |
|---|---|---|---|
| `id` | 源代号，仅日志/UI/统计 | `62` | 必填非空 |
| `name` | 展示名 | `63` | 可选 |
| `source` | 该源适用的原始音源（`qq`/`netease`/…） | `66`、`807-822` | 未声明时从 URL 域名**推断**（`tencent`/`qqmusic`→qq、`music.163`/`126.net`→netease、`kuwo`→kuwo…）；推断出的源必须等于 `song.sourceType`，否则**跳过该源**（`836-840`） |
| `kind` | 见上 | `67` | 必填 |
| `allowedDomains` | **返回音频 URL 的域名白名单** | `69`、`405-424` | 非空数组；普通域只匹配自身，`*.example.com` 才放行子域（`411-413`） |
| `timeoutMs` | 单源超时，默认 15000 | `71`、`113` | |
| `headers` | 合并进 API 请求与嗅探请求 | `73`、`375-379` | 纯静态字符串，**不支持函数/计算签名** |
| `resolve` | 取链步骤 | `75`、`225-235` | |
| `search` | 仅 `search-then-resolve` 必填 | `77`、`265-267` | |

### 1.3 请求规格 `Tier3RequestSpec`（`33-41`）

| 字段 | 语义 | 实现 |
|---|---|---|
| `method` | `'GET' \| 'POST'`，默认 GET | `227-230` |
| `url` | **必须是 http(s) 模板字符串** | `199-205`，`file://` 等拒绝 |
| `body` | POST 体模板，**原始填充不 URL 编码** | `37`、`384` |
| `responseJsonPath` | JSON 取值路径，如 `data.url` | `233`、`308-322` |

模板变量只有 5 个：`{id} {source} {name} {artist} {keyword}`（`33`、`344-350`）。`url` 里用 `encodeURIComponent`（`382`），`body` 里不编码（`384`）。`{id}` 取 `stripSourceIdPrefix(song.id)`，即**剥掉源前缀后的源站真实 ID**（`354`、`utils/sourceIdPrefix.ts`）。

### 1.4 `Tier3SearchSpec`（`43-58`）

`itemsPath` / `namePath` / `artistPath?` / `idPath?` / `urlPath?` / `coverPath?` / `albumPath?` —— 全部是**字符串 JSON 路径**，没有回调、没有分支、没有表达式。

### 1.5 执行期硬行为（决定了「能吃什么」）

1. **响应必须是 JSON**：`JSON.parse`，解析失败即未命中（`496-500`；`541` 干脆直接 `JSON.parse`）。HTML/JS 变量页一律吃不下。
2. **业务错误封套识别**：HTTP 200 但 `{code, message}` 且 `code !== 0` → 记 warn 并返回空串（`501-508`）。这是为 vkeys 那类 `{code:110000}` 设计的，**但前提是路径固定为顶层 `code`/`message`**。
3. **返回值必须是 http(s) URL**：`toUrlCandidate` 只认字符串 URL 或对象的 `url`/`src`/`audioUrl` 三键（`324-336`）。返回 base64、加密串、`ekey` 一律无效。
4. **强制域名白名单**（`510`、`564`）——音频 CDN 域名必须预先枚举，无法「任意域」。
5. **强制字节嗅探**（`434-482`）：对候选 URL 发 `Range: bytes=0-1023`，要求前 1KB 命中 `utils/sniffers.ts` 的音频魔数（ID3/fLaC/OggS/ftyp/MPEG 帧头），且 `totalBytes < 1MB` 判为**试听片段**而跳过（`477-480`、阈值 `118`）。`text/html` 直接否（`450`）。
6. **搜索命中要求名字+歌手严格匹配**（`544-558`），且搜索兜底还做了关键词分词过滤（`652-666`）——宽松模糊匹配的源会被这段过滤掉大半。
7. **单源失败继续下一个源**（`856-861`），全体失败返回空串交给 sourceRouter 回退（`864-865`）。
8. **总预算 6 秒**：`sourceRouter.ts:314 TIER3_BUDGET_MS = 6_000`，超过即按未命中处理（`366-370`）。**多源串行遍历**（`834-835`）——订阅里源越多，慢源越容易吃光预算。
9. **零 I/O + 零代码执行**：模块只依赖 `request`/`bodyToText`（`2`）。全文件 grep 无 `eval`/`new Function`/`require`/`import()`（实测：唯一命中的是 `110` 行的 `import(...)` **类型标注**）。契约里**没有任何执行字段**。

---

## 2. 同类开源项目的第三方解析源生态

### 2.1 lx-music（洛雪音乐）——JS 脚本 + 公开源清单仓库

**项目事实**（GitHub API，2026-09-14 抓取）

| 仓库 | 许可证 | stars | 最后 push |
|---|---|---|---|
| `lyswhut/lx-music-desktop` | Apache-2.0 | 53,582 | 2026-09-13 |
| `lyswhut/lx-music-mobile` | Apache-2.0 | 18,232 | 2026-09-12 |
| `lyswhut/lx-music-sync-server` | Apache-2.0 | 842 | 2025-09-08 |

**怎么拿播放地址**：应用不内置解析逻辑。脚本通过 `globalThis.lx.on(EVENT_NAMES.request, ({source, action, info}) => ...)` 注册回调，`action === 'musicUrl'` 时返回 Promise<url>。官方文档给的最小例子：

```js
const { EVENT_NAMES, request, on, send } = globalThis.lx
on(EVENT_NAMES.request, ({ source, action, info }) => {
  case 'musicUrl':
    return apis[source].musicUrl(info.musicInfo, qualitys[source][info.type])
})
send(EVENT_NAMES.inited, { sources: { kw: { name:'酷我音乐', type:'music', actions:['musicUrl'], qualitys:['128k','320k','flac','flac24bit'] } } })
```

- 宿主提供的运行时工具：`lx.request`（**不受跨域限制**）、`lx.utils.crypto.{aesEncrypt,md5,randomBytes,rsaEncrypt}`、`lx.utils.buffer`、`lx.utils.zlib.{inflate,deflate}`、`lx.send(updateAlert)`。
- 支持的源 key 固定为 `kw/kg/tx/wy/mg/local`，质量档固定为 `128k/320k/flac/flac24bit`。
- 来源：<https://lxmusic.toside.cn/desktop/custom-source>（官方文档，页面「最后更新 2026年9月10日」）。

**真实脚本长什么样**（决定「tier3 能不能吃」的关键证据）：`pdone/lx-music-source` 收录 8 个源，逐个实测（2026-09-14）：

| 源 | 体积 | 形态 |
|---|---|---|
| `lx/latest.js`（独家音源 v6） | 64 KB | 混淆 + 服务端下发配置（`SERVER_SCRIPT_CONFIG` 含 apiUrl/apiKey/signSalt/fingerprint） |
| `sixyin/latest.js`（六音 v1.2.1） | 333 KB | 重度混淆 |
| `qdy/latest.js`（全豆要聚合 v9.3） | 31 KB | 明文，但**内含 8 个上游端点 + 多链路回退 + 6 小时缓存** |
| `juhe/latest.js`（聚合API v3） | 0.99 KB | 明文，转发到 `api.music.lerd.dpdns.org` |
| `huibq/latest.js` | 2.7 KB | 明文，转发到 `lxmusicapi.onrender.com` + `X-Request-Key` |
| `ikun/latest.js` | 5.0 KB | 明文，转发到 `api.ikunshare.com` + `SCRIPT_MD5` 自校验 |
| `flower/latest.js`、`grass/latest.js` | 10 KB、9 KB | 混淆 |

即：**连「只是转发到一个 JSON API」的源，也是以 JS 脚本形态交付的**。脚本的 `@name/@version/@author` 头注释是宿主识别源的唯一元数据（`src/main/modules/userApi/utils.ts` 的 `parseScriptInfo`/`matchInfo`）。

**源的配置形态**：单个 `.js` 文件。用户两种导入方式（`src/renderer/views/Setting/components/UserApiOnlineImportModal.vue`）：本地文件，或填一个 URL 让应用 GET 下来 —— **GET 到的内容必须是脚本本体，不是清单**。没有「manifest JSON」这种形态，也没有多源订阅清单。

**宿主安全模型**：脚本在一个独立的 Electron `BrowserWindow` 里跑（`src/main/modules/userApi/main.ts:58 createWindow`，`contextIsolation: true`、`nodeIntegration: false`，见同文件 `74-87`），Host 侧 `request()` 带 20 秒超时（`rendererEvent/rendererEvent.ts` 的 `timeout = 20000`）。脚本以 deflate+base64 存盘（`utils.ts` `deflateScript`）。

**是否需要登录态/会员凭据**：框架不要求，但**生态里的源普遍要求**。六音源的脚本头注释里出现 `@netease MUSIC_U=;`、`@tencent ts_last=y.qq.com/n/ryqq/album;` 这类字段（实测 `sixyin/latest.js` 头部）；另有一整个目录叫「自定义源（说白了就是用自己的账号，不然听不了（注意有封号概率））」（实测 `Macrohard0001/lx-ikun-music-sources` 目录名），明说**用用户自己账号、有封号概率**。

**最近活跃度**
- 客户端：2026-09-13 有 push（活跃）。
- 官方内置源：**已于 2023-10-18 移除**，官方 FAQ 原文：「由于收到腾讯投诉，要求停止内置其平台的在线播放及下载服务，所以从 2023-10-18 起，LX Music 本身不再提供上述服务——桌面版 v2.6.0 移除了所有内置自定义源，且旧版本内置的源也已失效。你需要编写或寻找别人分享的自定义源导入」。来源：<https://lxmusic.toside.cn/desktop/faq/cannot-play-and-download>（页面 2026-09-10 更新）。

### 2.2 MusicFree / MusicFreeDesktop 及其插件生态

**项目事实**

| 仓库 | 许可证 | stars | 最后 push |
|---|---|---|---|
| `maotoumao/MusicFree`（Android/HarmonyOS） | AGPL-3.0 | 26,846 | 2026-09-13 |
| `maotoumao/MusicFreeDesktop` | AGPL-3.0 | 8,839 | 2026-06-25 |
| `maotoumao/MusicFreePlugins`（示例插件） | GPL-3.0 | 1,838 | 2026-03-19 |
| `maotoumao/MusicFreePluginTemplate` | MIT | 52 | 2023-09-04 |
| `qwerwhr/musicfree-plugins`（76 插件订阅） | 无 LICENSE 文件 | 102 | 2026-06-05 |
| `xxnuo/MusicFreePluginsHub` | 无 | 3,220 | **已归档**（archived=true，2026-03-25） |

**怎么拿播放地址**：插件是 CommonJS 模块，导出 `getMediaSource(musicItem, quality)`，返回 `{ url, headers?, userAgent?, quality? }`。注意它**允许返回请求头**：

```ts
// maotoumao/MusicFreePlugins/types/plugin.d.ts
interface IMediaSourceResult {
  headers?: Record<string, string>;
  url?: string;
  userAgent?: string;
  quality?: IMusic.IQualityKey;   // "low" | "standard" | "high" | "super"
}
interface IPluginDefine {
  platform: string; version?: string; srcUrl?: string;
  search?: ISearchFunc;
  getMediaSource?: (musicItem, quality) => Promise<IMediaSourceResult | null>;
  getMusicInfo?; getLyric?; getAlbumInfo?; getArtistWorks?;
  importMusicSheet?; importMusicItem?; getTopLists?; getTopListDetail?;
}
```
来源：<https://raw.githubusercontent.com/maotoumao/MusicFreePlugins/master/types/plugin.d.ts>；协议文档 <https://musicfree.catcat.work/plugin/protocol.html>。

**运行模型**：正式文档明说「插件是一开始就通过 `Function` 的形式 hook 进了 js 引擎中，也就是**插件和 app 的代码运行在同一个环境下**」「由于上文所说，插件使用的内置 npm 包也和 app 是共用的 … **这也会有潜在的安全问题**，使用者也要注意大概看下插件中有没有恶意请求之类的」。来源：<https://musicfree.catcat.work/plugin/caution.html>。（即：插件不是沙箱执行，而是同进程 `Function` 求值。）

**源的配置形态**：`.js` 文件（单插件的 `module.exports`），或 **`plugins.json` 订阅清单**——这是与 lx-music 的关键差异。清单格式极简：

```json
{"desc":"...","plugins":[{"name":"bilibili","url":"https://.../bilibili/index.js","version":"0.2.3"}]}
```
（实测 `plugins.json` 与 `qwerwhr/musicfree-plugins/plugins.json`，两处格式一致。）

**关键限制（官方声明 + 实测）**：
- 示例插件仓库 README 原文：「收到了告知函，因此**本示例插件仓库不再提供国内音乐厂商的源**」；主 README：「示例仓库基于互联网公开接口封装，并**过滤掉所有 VIP、试听、付费歌曲**，且示例仓库以后也**不会提供具备破解功能的插件**」。
- 实测 `plugins.json` 只剩 12 个插件：Audiomack / 歌词网 / 歌词千寻 / Navidrome / suno / udio / 猫耳FM / 快手 / 音悦台 / Youtube / bilibili / WebDAV —— **没有 netease/qq/kugou/kuwo**。
- 国内厂商源只存在于第三方清单（`qwerwhr/musicfree-plugins` 76 个，含「QQ Vip」「汽水vip」「酷我JHMS」等；`Huibq/keep-alive` 5 个）。
- 另一条硬限制：源码里大部分官方插件依赖 `require("axios")`、`cheerio`、`crypto-js` 等 npm 包（实测 `GD音乐台.js` 第一行即 `const axios_1 = require("axios")`），这些包由宿主内置（官方文档「内置的 npm 包」一页）；Android 版还限制「尽量使用 ES8 以下的语法」「异步箭头函数可能不支持」。

**是否需要登录态/会员凭据**：框架不需要；生态里的部分插件需要（存在插件名「哔哩哔哩_Cookie」「QQ Vip」等），**未核实每个插件的具体凭据要求**。

**最近活跃度**：客户端活跃（2026-09-13）；示例插件仓库 `plugins.json` 的**最后一次改动是 2025-05-15**（`gh api /repos/maotoumao/MusicFreePlugins/commits?path=plugins.json`），仓库最后一次 commit 2025-11-02。

**一个值得注意的旁证**：`timeshiftsauce/CeruMusic`（1,917 stars）README 第一句已经是「**为保护版权,此仓库不再维护**」，且仓库已归档（2026-06-20）。它自称「借鉴洛雪音乐插件思想，提供插件运行框架」。同类项目的退场方式高度一致。

### 2.3 listen1 / Listen1_chrome_extension

**项目事实**

| 仓库 | 许可证 | stars | 最后 push | 最后 commit |
|---|---|---|---|---|
| `listen1/listen1_chrome_extension` | MIT | 12,092 | 2025-06-17 | 2025-06-17 `bump: v2.33.0` |
| `listen1/listen1_desktop` | MIT | 11,399 | 2025-06-17 | 2025-06-17 `bump: v2.33.0` |

**怎么拿播放地址**：**没有第三方源机制**。解析器是**编译进仓库的固定 provider 文件**：`js/provider/{netease,qq,kugou,kuwo,migu,bilibili,taihe,xiami,localmusic}.js`（合计 5,257 行；实测 `grep` 全仓库无 plugin/extension 加载逻辑）。每个 provider 是硬编码的官方接口调用（如 `netease.js` 内联了 weapi 的 AES+RSA 实现、`kuwo.js` 有 `kw_get_token`/`kw_cookie_get`）。桌面版通过 git submodule 复用扩展仓库（`.gitmodules: app/listen1_chrome_extension`）。

**源的配置形态**：**无**。想要新源 = fork 仓库改 provider 文件。

**是否需要登录态/会员凭据**：默认匿名，但 provider 内置 cookie 处理（`cookieSet/cookieGet`）。

**活跃度**：最后 commit 2025-06-17，约 **15 个月前**。历史事件：2017-11 收到 QQ 音乐 DMCA Takedown（README 原文记录，链接 <https://github.com/github/dmca/blob/master/2017/2017-11-17-Listen1.md>），仓库一度被关停。

**对 MPlayer 的启示**：listen1 的模式（内置 provider + 跟随官方接口变化打补丁）**就是 MPlayer 现在直连层在做的事**；它不提供「可插拔外部源」这一层，因此对「tier3 源太少」这个问题**没有增量**。

### 2.4 GD Studio / gdstudio API

**当前状态（2026-09-14 实测）**
- `https://music-api.gdstudio.xyz/api.php` 返回 **200 + 公开接口文档主页**（HTML）。文档里自述：「当前稳定音乐源：**netease、joox、bilibili**」「当前访问频率限制：**5分钟内不超50次请求**」「更新日期：**2026-06-26**」。
- 许可证自述：`Written by GD Studio. License: CC BY-NC 4.0. This platform is for study purposes only. Do NOT use it commercially!`，并声明「严禁下载、传播或商用」、使用需注明出处「GD音乐台(music.gdstudio.xyz)」。
- 关联主站 `music.gdstudio.xyz` **当前打不开**（TLS 直连失败 / 403）；`gdstudio.xyz` 已跳转到作者的 B 站主页。B 站是文档里给的唯一反馈渠道（「使用过程如遇问题可B站私信：GD-Studio」）。

**接口（全部为 GET + query，纯声明式）**

| 功能 | 端点形态 | 关键返回字段 |
|---|---|---|
| 搜索 | `api.php?types=search&source=<src>&name=<kw>&count=<n>&pages=<p>` | **顶层就是 JSON 数组**：`id / name / artist(数组) / album / pic_id / url_id / lyric_id / source` |
| 取链 | `api.php?types=url&source=<src>&id=<trackId>&br=<128/192/320/740/999>` | `url / br / size` |
| 封面 | `api.php?types=pic&source=&id=<picId>&size=<300/500>` | `url` |
| 歌词 | `api.php?types=lyric&source=&id=<lyricId>` | `lyric / tlyric` |

**实测（2026-09-14）**

| 测试 | 结果 |
|---|---|
| `source=netease` 搜索「恋人 李荣浩」 | 200，返回 `[{"id":"2600493765","name":"恋人","artist":["李荣浩"],...}]` |
| `source=netease&id=2600493765&br=320` | 200，`{"url":"https://m801.music.126.net/.../....mp3","br":320,"size":10242285}` |
| 对上面 url 发 `Range: bytes=0-1023` | **206 `audio/mpeg; charset=UTF-8`，前 4 字节 `ID3`** —— 通过 tier3 的字节嗅探 |
| 任意 netease id（347230，非本站搜索所得） | 200，同样返回 320k 直链 → **url 接口可独立使用（url-resolver 可行）** |
| `source=tencent / kugou / migu / tidal` | **400 `{"detail":"Value of \`source\` is not supported."}`** |
| `source=kuwo` 搜索 | 200，返回结果正常；但 `types=url&source=kuwo&id=<任意id>&br=320` **恒返回 `{"url":"","br":-1,"size":0}`**（实测 4 个不同 id） |
| `source=joox / bilibili` | 搜索 200 |
| 连续 10 次快速搜索 | 10/10 返回 200（**未复现 5min/50 次限流**；限流是否生效**未验证**） |

**是否需要登录态/会员凭据**：**匿名可用**（上述全部请求未带任何凭据）。`br` 支持 740（16bit 无损）/999（24bit 无损）——**这两个档位属会员/无损内容，本次未测试**。

**r5 的差异说明**：r5 依据 musicdl 源码记录 gdstudio 需要「自研 MD5(`gdstudiomd5`)+时间/版本签名」。**实测当前公开端点不需要任何签名**（文档主页也无 `s=sign` 字样）。可能的原因：musicdl 走的是 r5 记录的旧调用方式，或签名只对某些端点/某段时间生效。**未验证**。

### 2.5 其他（本轮补充，与「能否接 tier3」相关）

| 项目 | 许可证 | stars | 最后 push | 与 tier3 的关系 |
|---|---|---|---|---|
| `any-listen/any-listen` | **自定义许可（基于 AGPL v3 + 禁商用）** | 3,540 | 2026-09-13 | 同类播放器，活跃 |
| `any-listen/any-listen-extension-lx-api-source-loader` | Apache-2.0 | 4 | 2026-08-31 | **为 any-listen 加载 lx-music JS 源脚本**；主进程有 `isolate/` 目录（隔离执行），启动方式为「isolate preload + envAPI + vendors/aes、md5」——即：**要在 Electron 里跑 lx 源，必须自建一套 JS 隔离运行时**，这是它存在的理由 |
| `MeoProject/lx-music-api-server` | MIT（+非商业补充条款） | 844 | 2026-01-10 | Python 实现的「lx 解析接口服务器」，提供 `/url/{source}/{id}/{quality}`。README 自述「搜索(可能会在近期实现)」= **没有搜索**；且注明「主开发因学业原因无法维护」 |
| `metowolf/Meting` | MIT | 2,186 | 2026-03-29 | Node 版多平台 API 框架（netease/tencent/kugou/baidu/kuwo），是**库**不是服务；可作为「自己起一个 tier3 源」的参考 |
| `UnblockNeteaseMusic/server` | LGPL-3.0 | 7,830 | 2026-09-13 | 网易变灰歌曲解锁，**代理**形态（HTTP/HTTPS 代理 + PAC），不是 URL 解析接口 —— 与 tier3 契约正交 |
| `asxez/MusicBox` | MIT | 499 | 2026-06-01 | **本地**音乐播放器（Electron 41），插件系统是 VSCode 风格的 `manifest.json + activate/deactivate + 贡献点(commands/views/themes)`，**不提供在线音源插件**。与 MPlayer 目标无关 |
| `timeshiftsauce/CeruMusic` | 无 | 1,917 | **已归档** | 「为保护版权,此仓库不再维护」 |
| `Binaryify/NeteaseCloudMusicApi` | 无 | 30,262 | 2024-02-28 | **已归档**（曾经的网易 API 事实标准） |
| `nondanee/UnblockNeteaseMusic` | MIT | 17,352 | 2023-06-25 | 3 年无更新 |
| `jixunmoe/qmc-decode` | MIT | 35 | 2021-12-12 | 已归档；README 称「腾讯现在已淘汰该加密方案」 |

---

## 3. 能否落到 tier3 契约上（逐项判定）

判定口径：**能否用现有 `Tier3Source` 字段完整表达该源的取链逻辑，不改 core 代码**。

| 生态 | 源的真实形态 | 能落到 tier3 吗 | 要适配什么 |
|---|---|---|---|
| **lx-music 自定义源** | 单个 JS 脚本，`globalThis.lx.on(request)` 回调返回 URL；脚本内可有混淆、加密、轮询、缓存、多上游回退 | **否** | 需要的是**JS 执行环境**（沙箱/Worker/isolate）+ 宿主 API（`lx.request`、crypto、zlib）。tier3 的 `Tier3Source` 无任何执行字段 |
| **MusicFree 插件** | CommonJS 模块导出 `search`/`getMediaSource` 等函数；依赖宿主内置 npm 包；与宿主同进程 `Function` 求值 | **否** | 同上；且它比 lx 更重（需要 search/getMediaSource/getLyric/getTopList 等一套接口 + npm 包 + 可能返回 `headers/userAgent`） |
| **MusicFree `plugins.json` 订阅清单** | `{"plugins":[{"name","url","version"}]}` —— **它订阅的是 JS 文件** | **否**（清单本身不是解析规格） | 需要先有插件执行器；清单只是分发层 |
| **listen1 provider** | 仓库内硬编码 JS（无插件机制） | **否** | 想用只能 fork 移植代码（且是 MIT，见 §4.3） |
| **GD Studio** | GET + query 两步（search → url），JSON 数组返回，匿名，无签名 | **是**（`search-then-resolve`，见下） | 仅两处小适配 |
| **vkeys（落月 API）** | GET + query，返回 JSON 对象（`data.url`），匿名 | **是**（`url-resolver`，见下） | 一处字段差异 |
| **Meting / lx-music-api-server** | 都是「**自己部署一个服务**」的库 | 部署后可当 tier3 源 | 需要用户自建服务（与「用户不引入登录态」不冲突，但增加使用门槛） |

### 3.1 特别回答：「如果源是 JS 插件，tier3 这种声明式契约根本吃不下——这是否成立？」

**成立。** 证据链：

1. `tier3Api.ts:21` 模块自述设计目标：「仅执行**「可纯声明描述的源」**：url-resolver（按 id 直取）与 search-then-resolve（先搜再解）」——这是**刻意的设计边界**，不是疏漏。
2. `tier3Api.ts:31/186/255`：`kind` 白名单只有两值；`__tests__/tier3Api.test.ts:196` 显式构造 `kind: 'script'` 并断言抛「不支持」。
3. `Tier3Source` 全部字段（`62-78`）都是字符串/字符串数组/数字：没有函数、没有表达式、没有可执行载荷。
4. 模块**零代码执行**：grep 全文件无 `eval`/`new Function`/`require`/`import()`（真实 import 语句除外）。
5. lx-music 与 MusicFree 的源**必须**是代码：混淆（六音 333KB 混淆脚本）、`SERVER_SCRIPT_CONFIG` 服务端下发签名盐、AES/RSA/MD5 工具、多链路回退、按质量降档循环 —— 这些**没有任何一种能用「URL 模板 + JSON 路径」表达**。
6. 就算强行加 `kind: 'script'`，MPlayer 的**移动端**还有第二堵墙，但**这堵墙不是 Hermes 的 `eval`**（见下方勘误）：

   > **⚠️ 勘误（本子代理独立复核后修正）**：本报告早期版本写「Hermes 官方文档明确把 `eval()` 列在 Excluded From Support」，据此推出「Hermes 跑不了脚本源」。**这个推论不成立。**
   >
   > Hermes `doc/Features.md` 的排除项原文是 `Local mode `eval()` (use and introduce local variables)`——排除的是 **local eval**（读写外层词法作用域），**不是 eval 本身**。Hermes 维护者 John Paul 在 <https://github.com/facebook/hermes/issues/785> 明确回复：
   > > `Global eval (`eval()` at the global scope or `new Function()`) has always been supported.`
   >
   > 而 MusicFree 恰恰用的就是 `new Function(code)(...)`（见其 `plugin.ts`）。**所以 `new Function` 形态的脚本源在 Hermes 上跑得起来。**
   >
   > **真正的墙是「MPlayer 移动端没有任何原生模块」**：实测 `packages/mobile/android/app/src/main/java/` 下只有 `com/mplayer/mobile/{MainActivity.kt, MainApplication.kt}`。而 lx-music-mobile **在 `hermesEnabled=true` 的同时另外引入 QuickJS 专做源沙箱**：
   > - `android/gradle.properties:41` → `hermesEnabled=true`
   > - `android/app/build.gradle:196` → `implementation 'wang.harlon.quickjs:wrapper-android:2.4.0'`
   > - `android/app/src/main/java/cn/toside/music/mobile/userApi/QuickJS.java` → `QuickJSLoader.init()` + `QuickJSContext` + `__lx_native_call__*` 桥接 AES/MD5/RSA/base64/zlib
   > - `.../userApi/{JsHandler,JavaScriptThread,UserApiModule}.java` → 源脚本跑在**独立线程**
   >
   > 这是一条**公开的工程判决**：在 RN/Hermes 宿主里跑用户 JS，lx-music 的选择是**再带一个 JS 引擎 + JNI 原生模块 + 独立线程**，而不是复用 Hermes。MPlayer 若要接 JS 源，移动端等于从 0 写一个 Android 原生模块，并接进 CI 的 `assembleRelease`/`bundleRelease` 链路。

**代价参照**：`any-listen` 为了在 Electron 里加载 lx 源脚本，专门做了一个扩展包 `any-listen-extension-lx-api-source-loader`（Apache-2.0），内部有 `src/main/isolate/*`、`src/isolate-preload/envAPI.ts`、`vendors/aes|cbc|cfb|ctr|ecb|ofb`、`md5.js`、`base64.js`——**这就是「吃下 JS 插件」的真实工程量**：一套独立的 JS 隔离运行时 + lx API 面（request/crypto/zlib/buffer）+ 跨进程消息桥。

### 3.2 GD Studio 落到 tier3 的具体形状（可行性最高的一项）

```json
{
  "version": 1,
  "sources": [{
    "id": "gdstudio-netease",
    "name": "GD 音乐台（网易）",
    "source": "netease",
    "kind": "search-then-resolve",
    "allowedDomains": ["*.music.126.net", "*.126.net"],
    "timeoutMs": 8000,
    "search": {
      "method": "GET",
      "url": "https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name={keyword}&count=20&pages=1",
      "responseJsonPath": "0.url",
      "itemsPath": ".",
      "namePath": "name",
      "artistPath": "artist",
      "idPath": "id"
    },
    "resolve": {
      "method": "GET",
      "url": "https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id={id}&br=320",
      "responseJsonPath": "url"
    }
  }]
}
```

需要核对的三点：

1. **`itemsPath` 必须写 `"."`（不能写 `""`）。** GD Studio 的搜索**响应顶层就是 JSON 数组**（实测）。`itemsPath` 走 `assertString`（`tier3Api.ts:192-197`）校验**非空字符串**，`""` 在**校验阶段**就被拒（`assertString` 里 `!value.trim()` → throw）。
   用 Node 复刻 `assertString` + `isRecord` + `getByPath`（`tier3Api.ts:192-196 / 308-322`）对实测的 GD Studio 根数组跑的**完整实测结果**：

   | `itemsPath` | 校验 | `getByPath(root, path)` | 是数组？ |
   |---|---|---|---|
   | `""` | **REJECTED**（非空校验） | （到不了这步）根数组 | ✅ |
   | `" "` | **REJECTED**（trim 后为空） | `undefined` | ❌ |
   | `"."` | **通过** | **根数组** | ✅ |
   | `"0"` | 通过 | 第 0 个元素（对象） | ❌ |
   | `"data.list"` | 通过 | `undefined`（数组无 `data` 属性） | ❌ |

   `"."` 可行是因为 `split('.') → ['','']`，两段都被 `if (!part) continue` 跳过 → 原样返回 root。**它能用纯属 `getByPath` 的实现副作用**：契约未承诺、**仓库内无测试覆盖**（`tier3Api.test.ts` 中所有 `itemsPath` 都是 `data.list` 形态，无根数组用例）。**建议按 §9 路线 B 把它正式化。**

   > **⚠️ 另需修正上文清单示例**：§3.2 的 JSON 里 `search.responseJsonPath` 写了 `"0.url"`——**这是错的**。`Tier3SearchSpec` 的 `responseJsonPath` 继承自 `Tier3RequestSpec`（必填），但 search 步骤**从没用过它**：`resolveSearchThenResolve`（`:539-542`）只读 `source.search.itemsPath` 取数组，`responseJsonPath` 只在 `resolve` 步骤（`resolveFromRequestSpec`，`:509`）被消费。写 `"0.url"` 无害但**语义为空**；应写一个存在的路径（如 `"0.id"`）或直接说明它不被使用。
2. **`artist` 是数组 → 恰好可用，且比预想的好。** `asString` 是 `String(value)`（`338-340`），`["初音ミク","MusikM"]` → `"初音ミク,MusikM"`。而 MPlayer 的 `isExactMatch`/`splitArtists` 按 `[、,，;；/＆&|]+` 拆分**双方**（`utils/songMatcher.ts`），逗号正在其中 → **多歌手能正确逐人匹配**。（原先以为会失败，读 `songMatcher.ts` 后更正。）
3. **`source` 防护必须显式声明。** hostname `music-api.gdstudio.xyz` 不含 netease/qq 等关键词，`tier3SourceSource`（`807-822`）返回 undefined；若不声明 `source`，该源会被拿去解析任意源的歌。声明 `source:'netease'` 后只有 netease 的歌会走它。

**另一个实测风险**：`types=url` 对**部分合法 id 会返回 nginx `503` HTML**（实测 `id=3313203938` 命中 503），而 tier3 对非 JSON 响应直接判未命中（`496-500`）——表现为「这条链偶尔不命中」，属正常降级，但会消耗 6 秒预算。

### 3.3 vkeys 落到 tier3 的形状

```json
{
  "version": 1,
  "sources": [{
    "id": "vkeys-qq",
    "name": "落月 API（QQ）",
    "source": "qq",
    "kind": "url-resolver",
    "allowedDomains": ["*.qqmusic.qq.com", "ws.stream.qqmusic.qq.com", "*.qq.com"],
    "timeoutMs": 12000,
    "resolve": {
      "method": "GET",
      "url": "https://api.vkeys.cn/music/tencent/song/link?mid={id}&quality=8",
      "responseJsonPath": "data.url"
    }
  }]
}
```

- `{id}` 由 `stripSourceIdPrefix(song.id)` 得到。MPlayer 的 QQ 歌 id **优先取 songmid**（`packages/core/src/api/qqDirect.ts:328` 注释：「GetVkey 直连腿按 songmid 键控，数字 id 走直连恒为空」），与 vkeys 的 `mid` 参数**语义一致**（实测 `?mid=0039MnYb0qxYhV` 返回 200 + 直链，`?id=0039MnYb0qxYhV` 返回「Input id must be of type int」）。
- vkeys 的错误封套是顶层 `{code, message}`（实测 `code:110000`），**正好命中** tier3 的封套识别（`tier3Api.ts:501-508`）。
- 实测 `quality=8`（HQ 高音质）返回 320kbps MP3；`quality=0/4` 返回试听/标准档。**quality ≥ 10 是会员档**（见 §4.2）。

---

## 4. 合规与风险

### 4.1 风险分级（严格区分「匿名公开解析」与「会员/SVIP/无损破解」）

| 类别 | 代表 | 内容性质 | 风险等级 |
|---|---|---|---|
| **A. 匿名 JSON 解析 API（标准音质）** | GD Studio `br≤320`；vkeys `quality≤8` | 匿名即可拿到的有损音质直链 | **中**（第三方站点合法性不可验证；但未突破付费墙） |
| **B. 匿名 JSON 解析 API（会员档位）** | GD Studio `br=740/999`（16/24bit 无损）；vkeys `quality=10 SQ无损 / 11 Hi-Res / 12 杜比全景声 / 13 臻品全景声 / 14 臻品母带2.0` | **明确绕过会员付费墙**，且 vkeys 文档自证：v2「因腾讯官方接口调整，**无法获取会员歌曲以及高音质音乐**」 | **高** |
| **C. 账号型源** | 「用自己的账号，不然听不了（注意有封号概率）」目录中的脚本；MusicFree「哔哩哔哩_Cookie」「QQ Vip」类插件 | 需要用户自己的会员凭据 | **高** + 与「用户明确不引入登录态」直接冲突 |
| **D. 混淆/闭源分发的脚本源** | pdone 的 lx / sixyin / flower / grass | 代码不可审计，含服务端下发配置（`apiUrl/apiKey/signSalt/fingerprint`）、可含任意网络请求与本地行为 | **中-高**（供应链风险；lx-music 官方也把「第三方插件安全性」写进文档警告） |
| **E. 纯转发型脚本源** | huibq / juhe / ikun | 脚本本身可读，但实际解析在后端服务器，使用者无法验证后端行为 | **中** |
| **F. 无关** | listen1（硬编码官方接口）、Metting（库）、MusicBox（本地） | 无新增风险 | — |

### 4.2 复核 r5 的「破解类不引入」结论

**结论仍然成立，且今天有了更直接的一手证据。**

r5 的判断依据是 musicdl 源码里的分层注释（`l1=[svip...]`）。今天补上「源方自己怎么说」：

- vkeys V3 官方文档：「当前文档为 v3 版本（正在开发），**v2 版本接口因腾讯官方接口调整，无法获取会员歌曲以及高音质音乐**」。（<https://doc.vkeys.cn/v3/>）
  → 反推：v3 提供的 SQ/臻品母带档位，就是**会员歌曲与高音质音乐**。
- vkeys 音质参数表（<https://doc.vkeys.cn/v3/音乐模块/QQ音乐/点歌相关接口/2-link.html>）列出：`10 SQ无损音质`、`11 Hi-Res音质`、`12 杜比全景声`、`13 臻品全景声`、`14 臻品母带2.0`（默认值 14）。
- **实测确认这些档位匿名可拿**：`quality=14` 返回 `.../AI00001diEF43yBtZk.flac`，`Range: bytes=0-1023` 嗅探得到 **FLAC 24bit / 192kHz**（`file` 判定：`FLAC audio bitstream data, 24 bit, stereo, 192 kHz`）。QQ 音乐侧 24bit/192kHz 属付费会员内容。
- GD Studio 的 `br=740/999` 同理（本次**未实测**）。

**后果**：MPlayer 自身是 **PolyForm Noncommercial 1.0.0**（`package.json:101`、`LICENSE:3`），这**只约束 MPlayer 的使用/分发**，**不构成「允许突破他人付费墙」的授权**。把 B/C 类源作为默认可选项，等于软件替用户实施规避技术措施，风险从「第三方站点合法性」上升到「软件自身行为」。

### 4.3 许可证冲突（本轮新增的硬约束）

MPlayer 自身：**PolyForm Noncommercial License 1.0.0**。关键条款（`LICENSE`）：
- 「Noncommercial Purposes：Any noncommercial purpose is a permitted purpose.」（`33-35`）
- 「Personal Uses：Personal use for research, experiment, and testing … personal study, private entertainment, hobby projects …」（`37-39`）
- 「**No Other Rights：These terms do not allow you to sublicense or transfer any of your licenses to anyone else** … These terms do not imply any other licenses.」（`49-51`）

由此产生三条具体约束：

1. **不能搬运 MusicFree 的插件运行时代码**：MusicFree / MusicFreeDesktop 是 **AGPL-3.0**（copyleft，且网络服务条款）。把它的 pluginManager 搬进 MPlayer 会让 MPlayer 整体落入 AGPL 的传染范围，而 PolyForm NC 的「No Other Rights」不允许再许可/转移许可 —— **两许可不兼容**。要参考只能做**独立的再实现**（clean-room）。
2. **MusicFreePlugins 示例插件仓库是 GPL-3.0**：其插件若被第三方分发给 MPlayer 用户，是**用户自担的第三方内容**；MPlayer 若**内置或镜像**这些插件，就落入 GPL 的传染范围。**不要把插件打进发行包**（现 tier3 设计「公开仓库零端点」`tier3Api.ts:20` 正是这个思路，应保持）。
3. **GD Studio 的 API 是 CC BY-NC 4.0** —— 这一条需要一个更细的判断（本子代理独立复核）：

   **(a) 许可证关系的前提先要成立。** MPlayer **不复制、不改编、不再分发** GD Studio 的材料：它只是**调用一个 HTTP API**，按用户配置取回 URL。CC BY-NC 4.0 的 `Licensed Rights`（参见其 §1 Definitions「Copyright and Similar Rights」）只约束**版权及类似权利**（复制、改编、发行、公开传播）。**调用 API ≠ 行使这些权利**；接口返回的音频文件也不是 GD Studio 拥有版权的客体（它自述「资源来自网络」）。
   ⇒ **只要不把 GD Studio 的页面/文档文本内嵌进仓库，CC BY-NC 与 PolyForm NC 之间不存在许可证叠加问题。** 这一点比原文的表述更强：不是「都要署名，注意一下」，而是**根本不在同一层权利义务上**。

   **(b) 若确实发生叠加（例如仓库里内嵌它的文档/清单文本），两者能否同时满足？**
   - **方向一致**：CC BY-NC §2(a)(1) 定义 NonCommercial = 主要目的**不是**商业优势或金钱报酬；PolyForm NC 1.0.0 的 `Noncommercial Purposes` 原文：`Any noncommercial purpose is a permitted purpose`，并把 `Personal Uses`（research / experiment / testing / personal study / private entertainment / hobby projects）与 `Noncommercial Organizations` 明列为许可用途。**两者都只禁商业使用。**
   - **义务不互斥**：CC BY-NC 要**署名 + 许可证链接 + 标注修改**；PolyForm NC 要**随发行附带本条款或 URL + 保留 `Required Notice:` 行**（其 `Notices` 节）。同时履行在实践中可行。
   - ⚠️ **但我必须如实说**：**未找到任何官方或权威来源声明 CC BY-NC 4.0 与 PolyForm Noncommercial 1.0.0 之间「存在互操作性/兼容性」。** Creative Commons 长期声明其公共许可证**不是为软件设计的**；两份不同许可的分层叠加在多数法域需逐条比对，**不能因为「都是 NC」就假定兼容**。**本报告不给法律结论。**

   **(c) 可落地的边界条件（工程上安全的下界）**：
   1. **不把 GD Studio 的页面/文档内容打进仓库**（只以 URL 形式让用户填订阅）——这也正是 tier3 现设计「公开仓库零端点」(`tier3Api.ts:20`) 的既有做法；
   2. 若必须在仓库/UI 中引用，**加一句署名**：`GD音乐台 (music.gdstudio.xyz)`（其页面自述的要求）；
   3. **不把 `br=740/999` 写进任何随附清单**（这是合规分档要求，不是许可证要求）。
4. **lx-music 客户端是 Apache-2.0 + 补充条款**：官方「许可协议」页写明「本项目基于 Apache License 2.0 许可证发行，以下协议是对于 Apache License 2.0 的补充，如有冲突，以以下协议为准」，其中 8.1「本项目仅用于对技术可行性的探索及研究，**不接受任何商业（包括但不限于广告等）合作及捐赠**」、1.2「本项目本身没有获取某个音频数据的能力，本项目使用的在线音频数据来源来自软件设置内『音乐来源』设置所选择的『源』返回的在线链接」。——即 **lx-music 自己也在法律上把「解析」责任完整推给用户导入的源**，这与 tier3 的「公开仓库零端点 + 用户自配清单」策略**是同一套自保设计**，可作为 MPlayer 的合规参照。（来源：<https://lxmusic.toside.cn/desktop/license>）
5. **Huibq/keep-alive 与 pdone/lx-music-source 都无 LICENSE 文件**（GitHub API `license: null`）→ 默认**保留所有权利**，不可复制其代码进 MPlayer。Macrohard0001 的「巨硬简易许可证」明确禁止商业使用与未经授权转载。

---

## 5. 可用源清单：公开维护的「源清单/订阅地址合集」

> **本报告不复制任何密钥/卡密**。需要 key 的只在「key 从何处获得」列说明。以下 URL 均为**订阅地址**（用户自行导入），来源为各仓库 README 原文。所有数据 2026-09-14 实测抓取。

### 5.1 lx-music 脚本源（JS，**tier3 吃不下**，仅供了解生态）

| 仓库 | 格式 | 许可证 | 最后更新 | 内含源数 | 需要 key？ |
|---|---|---|---|---|---|
| `lyswhut/lx-music-source` | JS 源（基于 listen1 provider 改写） | MIT | **2024-06-12**（约 15 个月前） | 5（kw/kg/mg/tx/wy） | 否 |
| `pdone/lx-music-source` | 8 个 `latest.js` | **无 LICENSE** | **2026-09-11**（活跃） | 8（sixyin/huibq/flower/lx/ikun/grass/juhe/qdy） | 部分源有付费卡密版本（如「聆澜音源」「IKUN 音源」），key 从各自店铺购买 |
| `Macrohard0001/lx-ikun-music-sources` | 按版本目录归档的 JS + APK | 巨硬简易许可证（禁商用/禁转载） | 2026-08-17 | 大量 | — |
| `Huibq/keep-alive` | lx JS + MusicFree `myPlugins.json` | **无 LICENSE** | **2026-01-21**（8 个月未更新） | lx 1 个（转发型）/ MusicFree 5 个 | 否 |
| `ZxwyWebSite/lx-source` | JS | MIT | 2024-06-22，**已归档** | — | — |
| `ZxwyWebSite/lx-source-next` | Golang 实现 | MIT | 2026-08-29（内测） | — | — |
| `cdyUuu/lx-music-xinghai-source` | JS | 无 | 2026-08-24 | 聚合 GDAPI/ChKSz | 需自配（含酷我加密音频解密） |
| `a97083435/lxmusic-source` | JS 汇总 | Apache-2.0 | 2025-10-14 | 汇总型 | — |
| `skxingyu/lx_music-` | JS | 无 | 2026-09-12 | — | — |
| `LuoXiaohei-2025/LX-music-collection` | JS + 安装包 | 无 | 2025-12-06，**已归档** | — | — |

### 5.2 MusicFree 插件订阅清单（JSON，**订阅的是 JS 插件，tier3 同样吃不下**）

| 仓库/地址 | 格式 | 许可证 | 最后更新 | 插件数 | 备注 |
|---|---|---|---|---|---|
| `maotoumao/MusicFreePlugins` → `plugins.json` | MusicFree 清单 | GPL-3.0 | 清单 **2025-05-15**；仓库 2025-11-02 | **12**，已无国内厂商源 | 官方示例，README 声明「不再提供国内音乐厂商的源」 |
| `qwerwhr/musicfree-plugins` → `plugins.json` | MusicFree 清单 | **无 LICENSE** | 2026-06-05 | **76** | 含大量第三方国内源（含 VIP 类） |
| `Huibq/keep-alive` → `Music_Free/myPlugins.json` | MusicFree 清单 | 无 | 2026-01-21 | 5 | 转发型 |
| `xxnuo/MusicFreePluginsHub` | 聚合 hub | 无 | 2026-03-25，**已归档** | — | — |

### 5.3 真正能被 tier3 直接使用的「参数化 API 源」

| 源 | 端点 | 文档 | 许可证/声明 | 文档最后更新 | 登录态 | tier3 kind |
|---|---|---|---|---|---|---|
| **GD Studio** | `https://music-api.gdstudio.xyz/api.php?types=search\|url\|pic\|lyric&source=&id=&br=` | <https://music-api.gdstudio.xyz/api.php>（端点自述文档） | **CC BY-NC 4.0**，禁商用，需署名「GD音乐台(music.gdstudio.xyz)」 | 文档自述 **2026-06-26** | 匿名 | `search-then-resolve` |
| **落月 API / vkeys** | `https://api.vkeys.cn/music/tencent/{search/song, song/link, song/info}` | <https://doc.vkeys.cn/>（V3 文档） | 站点未声明开源许可证 | V3 文档「最后编辑于 **6 个月前**」；接口自述「仍在开发中，可能会经常变更」 | 匿名（标准档位） | `url-resolver` 或 `search-then-resolve` |
| 备用域名 | `api.epdd.cn`（vkeys 自述「后端接口备用域名，用于测试」） | 同上 | — | — | 匿名 | 同上 |

**限流（实测与自述）**
- GD Studio 自述「5分钟内不超50次请求」；本次实测**连续 10 次均 200**（限流未复现，**未验证**）。
- vkeys `jieshao.html` 自述「**QPS 限制：暂无**」「数据缓存时间：5分钟~1天」；V3 页自述「**使用接口限流，防止接口被封**」——两处说法不一致，**实际限流阈值未验证**。
- lx-music 生态里的源普遍在 README 明写限流/封 IP：Huibq 的 README「反复请求可能会导致**封禁 IP**」「尽量避免频繁切换歌曲，否则将导致**封禁 IP**」「仅供在线试听，禁止批量下载」。这与用户抱怨的「有并发限制」完全一致——**这是生态常态，不是 MPlayer 的 bug**。

---

## 6. 稳定性证据（逐个源）

| 源 | 类型 | 最好的稳定性证据 | 破裂历史 |
|---|---|---|---|
| **GD Studio** | API | 文档主页自述「更新日期 2026-06-26」；本次实测（2026-09-14）netease 搜索/取链/字节嗅探全通；连续 10 次无失败 | 自述稳定源从 netease/qq/kuwo/… 收缩到**仅 netease、joox、bilibili**；实测 **tencent/kugou/migu/tidal 直接 400 不支持**，**kuwo 搜索可用但取链恒空** → 即**已经发生过一次大面积源收缩**；关联主站 `music.gdstudio.xyz` 当前打不开 |
| **vkeys（落月）** | API | 文档 V3 页自述重构原因：「**腾讯官方接口调整**，导致 v2 无法获取会员歌曲以及高音质音乐」「腾讯官方也在接口中加入了**接口限流、风控机制**，导致高并发时账号被风控」；本次实测 2026-09-14 可用（含 `quality=14` FLAC 24bit/192kHz） | **正在发生**：V3 文档通篇标注「**此接口仍在开发中，在此期间接口可能会经常变更，不建议使用**」；部分路径 404（如 `/music/netease/song/link`、`/music/kuwo/song/link`）；V3 承诺「不再使用版本号作为路径」 |
| **lx-music 客户端** | 宿主 | commit 2026-09-13 | **内置源已于 2023-10-18 全部移除**（收到腾讯投诉），官方 FAQ 明确「旧版本内置的源也已失效」 |
| **lx-music 生态源（pdone 收录）** | JS 脚本 | pdone 仓库 2026-09-11 仍在更新 | 脚本自带「如失效请前往 www.sixyin.com 下载最新版本」；issue #2704（2026-03-08）用户原话：「经常使用的音源总是更新，总是需要手动通过链接进行重新导入，最重要的是**他总是在我开车要听歌的时候音源失效**」 |
| **Huibq/keep-alive** | JS 转发 | 仓库 2026-01-21 最后更新 | **其依赖的后端 `lxmusicapi.onrender.com` 本次实测返回 503 `This service has been suspended by its owner`** → **源已失效**（脚本还在，后端没了） |
| **MusicFree 官方插件** | JS 插件 | 仓库 2026-03-19 | **「收到了告知函，因此本示例插件仓库不再提供国内音乐厂商的源」**（README 原文）；实测 `plugins.json` 12 个插件已无国内厂商 |
| **MusicFree 第三方清单** | JSON 订阅 | qwerwhr 2026-06-05 | 3 个月未更新；`xxnuo/MusicFreePluginsHub`（3.2k stars）**已归档** |
| **listen1** | 内置 provider | 最后 commit **2025-06-17**（15 个月前） | 2017-11 遭 QQ 音乐 DMCA，仓库一度关停；changelog 里有大量「修复酷我播放接口失效/修复 QQ 音乐无法搜索」类条目，是**接口变更导致破裂**的直接记录 |
| **CeruMusic** | 插件宿主 | — | **已归档**，README 首句「为保护版权,此仓库不再维护」 |
| **Binaryify/NeteaseCloudMusicApi** | 服务 | — | **已归档**（2024-02-28） |
| **vkeys 关联的 lx 生态脚本源** | 混淆 JS | — | **无证据**（无法审计其内部上游，稳定性无从判断） |

**一个跨项目的共性是可靠的**：这类源的生命周期由**上游官方接口变更**驱动（腾讯/网易收紧 → 第三方 API 失效 → 用户侧表现为「换源失败」）。lx-music 用户 issue 里能查到持续不断的同类报告：#2631（2025-12-24「换源失败，请尝试手动在搜索页指定其他来源」）、#2752（2026-04-08「QQ音乐进行搜索和换源时经常失效 需要重复多次才能正常显示」）、#2882（2026-06-24「所有歌曲显示切换源失败」）、#2885（2026-06-30「什么时候增加一个音源批量验证、批量上传的功能」）。

---

## 6.5 补充实证（本子代理独立复跑，2026-09-14 00:40–00:46 UTC）

> 以下全部为**本机实测**，端点与原始响应片段见各条。这一节补上原文**没有实测**、但对「能不能接 / 值不值得接」有决定性的几条。

### 6.5.1 vkeys 的 quality 档位全枚举（原文标为「未测试」，现补实测）

同一天、同一 `mid=0039MnYb0qxYhV`（《晴天》，响应里 `pay:"免费"`），逐个请求 `GET https://api.vkeys.cn/music/tencent/song/link?mid=…&quality={n}`：

| quality | `kbps` | 返回文件名 | 文档 qualityInfo 名称 |
|---|---|---|---|
| 1 | `0kbps` | `C100…m4a` | 试听/低档 |
| 2 | `48kbps` | `C200…m4a` | 有损 |
| 4 | `191kbps` | `C600…m4a` | 标准 |
| 6 | `128kbps` | `M500….mp3` | — |
| **8** | `320kbps` | `M800….mp3` | **HQ高音质** |
| **10** | `1644kbps` | `F000….flac` | **SQ无损音质** |
| **11** | `0kbps`（`size:0`） | `RS01….flac` | **Hi-Res音质** |
| **12** | — | `code:110000` 未知错误 | 杜比全景声 |
| **13** | — | `code:110001` **`cookie异常：账号被风控无法获取`** | 臻品全景声 |
| **14** | `5549kbps` | `AI0000…flac` | **臻品母带2.0** |

- 对返回直链 `HEAD -r 0-1023` → **`206` + `content-range: bytes 0-1023/55397039` + `content-type: audio/x-ogg`**（55MB 的 FLAC，`content-type` 标错为 ogg；tier3 只拒 `text/html`（`:450`），故不影响嗅探判定）。
- **一条 `pay:"免费"` 的曲目，`quality=10` 就能拿到 1644kbps FLAC、`quality=14` 拿到 5549kbps 母带**——这是「**匿名端点 + 默认档位即破解档**」的一手证据。V3 文档称 `quality` **默认值为 14**。
- `quality=8`（320kbps MP3）是唯一落在「与官方直连重叠」区间的档位（r1 已确立 QQ 直连可拿 320k）→ **vkeys 的低档位对 MPlayer 的边际价值 ≈ 0**。
- 另：vkeys 的**两条 API 代际字段名不同**，写清单时极易踩坑——
  - 1 代：`GET /music/tencent/search/song?keyword=&page=&num=&type=0` → `data.list[]` 字段是 `songMID / title / singer / singerList`
  - 2 代：`GET /v2/music/tencent?word=&num=` → `data[]` 字段是 `mid / song / singer / singer_list`
  - 参数名是 `keyword`；漏传返回 `{code:3,message:"参数错误：Missing input parameter keyword"}`。

### 6.5.2 GD Studio 的访问前置条件（原文未遇到的阻塞，实测发现）

- `curl 'https://music-api.gdstudio.xyz/api.php?types=…'` → **`403` + `cf-mitigated: challenge`**（Cloudflare managed challenge，响应体是 `Just a moment...` 挑战页）。
- **换浏览器 UA（Chrome/131）、补全 `Sec-Fetch-*` / `Accept-Language` / `sec-ch-ua` 头、改走 http —— 全部仍然 403。** 三次重试均 403。
- 只有**浏览器型抓取器**能通关。
- **这一条直接推翻原文「GD Studio 匿名可用、实测全通」的可复现性**：原文的实测很可能发生在**该站尚未挂 Cloudflare 挑战时**，或经由某个能过挑战的客户端。**结论仍可能是「可接」，但必须先答「MPlayer 的 Node/RN 请求链能否过 CF 挑战」**——这与 r5 §4.1 记的「Electron 无 `curl_cffi`」是**同一类问题**（原文写的是「无签名所以更简单」，实测是「有 CF 挑战所以更难」）。
- 经可通关通道复测端点本身**确实正常**：
  - `types=search&source=netease&name=晴天&count=3&pages=1` → **根级数组**，元素 `{id, name, artist: string[], album, pic_id, url_id, lyric_id, source, from}`
  - `types=url&source=netease&id=3391116218&br=320` → `{"url":"https://m801.music.126.net/…/…mp3","br":320,"size":9143946,"from":"music.gdstudio.xyz"}`
  - `HEAD -r 0-1023 <该 url>` → **`206` + `content-range: bytes 0-1023/9143946` + `content-type: audio/mpeg`** ⇒ 满足 tier3 的嗅探（`:449-454`）且 >1MB ⇒ 不触发试听拒收（`:477`）
  - `types=url&source=netease&id=186016&br=320` → **`{"url":"","br":0,"size":0}`** ⇒ **取链失败是静默空 URL，不是错误封套**（与 vkeys 的 `code:110001` 风格不同；tier3 的封套识别 `:501-508` 对它无效，只会走「未命中」）

### 6.5.3 「并发限制」的定量结论（原文缺这一条）

- GD Studio 官方口径：**5 分钟 ≤ 50 次请求** ⇒ 平均 **1 次 / 6 秒**。
- tier3 每次成功解析 = **1 次 API 请求**（`:493`，打到 `music-api.gdstudio.xyz`）+ 1 次 CDN Range 请求（`:511`，打到 `m801.music.126.net`）。**CDN 请求不计入该 API 域的配额。**
- ⇒ **理论上限 ≈ 50 首 / 5 分钟 ≈ 1 首 / 6 秒。**
- 对照 MPlayer 两条调用路径：
  - **播放兜底**（`resolvePlayableSongRouted`）：单曲。配额**绰绰有余**。
  - **批量探测**（`probeSongsBatch`）：走 tier3 的批量解析。100 首要 100 次 API 请求 = **超配额 100%（需 10 分钟）**；200 首 = **超 300%**。且 tier3 内部**串行**（`:834-863`），不会因并发更差，但**也不会更快**。
- **结论**：GD Studio 的限流对**单曲播放兜底无害**，对**批量探测致命**。若接，必须确保 tier3 **不进探测路径**（CONTEXT.md:40 对 tier3 的定义本就是「不参与列表探测，解析受总预算约束」，需核实实现是否已如此）。
- vkeys 侧：文档自述 `QPS限制：暂无` / 缓存 5min~1天；**实测连续 5 次全 200**。⚠️ **5 次连续请求不足以证明「无限制」**，只能说明「未观察到该量级下的限流」。

### 6.5.4 前一轮两处需一并确认的细节

- **listen1 桌面版与扩展版的最后 commit 日期一致（2025-06-17 `bump: v2.33.0`）**——因为桌面版通过 git submodule 复用同一份 provider 代码；**「桌面版 2026-04-07 有 push」的说法需要区分**：GitHub `pushed_at` 反映的是仓库任意分支的推送，不等于 provider 代码更新。
- **MusicFreePlugins 的 `plugins.json` 全部 URL 指向 `gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/…`**（实测 2026-09-14）——即**官方示例清单已整体迁移到码云**，这是「国内分发渠道撤退」的又一直接痕迹，值得与「告知函撤源」并记。

---

## 6.6 双约束下的「实际还剩几个源」（本报告最直接的答案）

**对象**：只收「tier3 零改动可表达 + 匿名无凭据 + 不涉会员/SVIP/无损破解」三项同时成立的源。

| 候选 | tier3 零改动可表达？ | 匿名无凭据？ | 不涉破解档位？ | 可用 | 边际价值 |
|---|---|---|---|---|---|
| GD Studio `types=url`（`br∈{128,192,320}` 锁定） | ✅ `url-resolver`，`responseJsonPath:"url"` | ✅ | ✅（须在清单写死 `br`） | ⚠️ 受 **CF 挑战**阻塞，是否可过未验证 | **中**——为 netease/joox/bilibili 提供另一条匿名通路 |
| GD Studio `types=search`（同上锁 br） | ⚠️ 需 `itemsPath:"."`（未定义副作用） | ✅ | ✅ | 同上 | **低**——实测搜「晴天 周杰伦」返回**全是翻唱/钢琴版/同名他歌手，无原唱**（周杰伦在网易云无版权）；tier3 严格匹配（`:548-558`）会全部拒掉 ⇒ **对主流热门曲无效** |
| vkeys（`quality≤8`） | ✅ `url-resolver`，`responseJsonPath:"data.url"` | ✅ | ⚠️ 320k 是付费权益边界且**与官方直连重叠** | ✅ 实测通 | **≈0** |
| vkeys（`quality∈{10,11,14}`） | ✅ | ✅ | ❌ **SQ无损/Hi-Res/臻品母带2.0 = SVIP 破解** | 不可用（合规） | — |
| vkeys（`quality=12,13`） | ✅ | ✅ | ❌ | **实测亦不可用**（`110000`/`110001` 账号风控） | — |
| lx-music JS 源 | ❌ 缺执行层 | — | — | — | 需重建整套执行子系统 |
| MusicFree 插件 | ❌ 缺执行层 | — | — | — | 同上 + AGPL 不可参考 |
| 卡密音源（聆澜/IKUN…） | ❌ | ❌ 凭据 | ❌ | — | 双重不可用 |
| listen1 provider | ➖ 非可配置源 | — | — | — | 不适用 |
| lx-music-api-server / Meting | 部署后即可当源 | ✅ | ✅ | 需用户自建服务 | **中低**——但门槛在用户侧，且 `lx-music-api-server` **没有搜索**（README 自述「搜索(可能会在近期实现)」） |

**答**：**结构上可接 2 个（GD Studio、vkeys），实质上有价值的 0–1 个。** 且这一个（GD Studio）的价值还被「Cloudflare 挑战能否通过」这一未验证问题悬着。**「再接几个源就能解决覆盖面窄」在这条路上是不成立的。**

### 6.6.1 用户「源太少 / 会过期 / 有并发限制」的根因归属（可直接对外答复）

1. **源会过期** —— **生态结构性事实，不是 MPlayer 缺陷。** 一手证据：① lx-music 因腾讯投诉于 **2023-10-18 移除全部内置源**；② MusicFreePlugins 因**收到告知函**撤下全部国内厂商源，且 `plugins.json` 整体迁到 gitee；③ `xxnuo/MusicFreePluginsHub`（3.2k★）整仓清空；④ `CeruMusic` 归档时 README 首句「为保护版权，此仓库不再维护」。**源的生命周期由上游版权压力决定。tier3 的「用户自备订阅」正是对这件事的正确响应。**
2. **有并发限制** —— **可定量，且 tier3 当前用法刚好踩线。** GD Studio = 1 首 / 6 秒。播放兜底无碍，**批量探测必超**（100 首需 10 分钟）。
3. **源太少** —— **因为公开匿名的源本来就少且在减少**；高覆盖的源全部绑卡密/账号。不是没找到，是真的没有。
4. **覆盖面窄** —— **tier3 契约的自觉取舍。** tier3 只做「把已知歌曲换成可播 URL」，不做「扩曲库」。扩曲库只能靠 `search-then-resolve`，而它的严格精确匹配门（`:548-558`，为防错播而设）恰好把弱匹配的长尾挡在门外——**这是用「覆盖面」换「不错播」。**

---

## 6.7 三条可选路线（按代价从低到高）

> 前文 §6.6 提到「§9 路线 B」，即本节。

**路线 A · 接受现状，把 tier3 的定位讲清楚（零代码）**
- 把「订阅源用户自备、会过期、并发受限、契约只支持声明式 JSON」写进产品文案/文档；每源已有命中/失败统计（`getTier3Stats()`，`tier3Api.ts:127`）可直接上设置页。
- 代价：0。收益：把「源太少」从 bug 变成预期。

**路线 B · 补齐「声明式 JSON 源」的可用性（小改动，建议先做）**
1. 把 `itemsPath:"."`（根级数组）从**未定义副作用**变成**正式支持**：加测试（`tier3Api.test.ts` 现在无根数组用例）+ 文档，或在 `getByPath` 里显式处理根路径。实测已证明它能救活 GD Studio 的搜索端点（§3.2 表格）。
2. **先核实 tier3 是否已被排除在 `probeSongsBatch` 之外**（`sourceRouter.ts:556` 注释提示已排除，但未逐行核实）。若未排除，必须先排除——否则 GD Studio 的 50 req/5min 会在探测路径上直接爆掉（§6.5.3）。
3. 把「按 `br`/`quality` 分档」写进清单约定与文档：随附带示例清单时**只写 `br≤320`**。
- 代价：S（core 一个函数 + 测试 + 文档）。收益：把「实际可接的源」从 1 个变成 2 个。

**路线 C · 引入 JS 执行层（= 重建一个子系统，需 ADR + 独立 issue）**
- 必须**同时**交付：
  1. 新 `kind`（改 `tier3Api.ts:31` 的联合类型 + `:186` 白名单 + `parseSource`）；
  2. 桌面：独立沙箱窗口（**与现状 `contextIsolation:false` 相反**——见 `AGENTS.md` Architecture 节）；
  3. 移动：原生 JS 引擎 + JNI 模块 + 独立线程（**MPlayer 目前 `com/mplayer/mobile/` 下只有两个 .kt，等于从 0 开始**），并接进 CI 的 `assembleRelease`/`bundleRelease`；
  4. 一套威胁模型与权限收口（现行 `allowedDomains`/`headers`/`sniffAudioUrl` **全部会被脚本绕过**，见 §3.1）；
  5. **许可证隔离**：**MusicFree 的 AGPL-3.0 实现不可参考复制**，只能 clean-room。
- 代价：**L–XL**，且引入「执行用户代码」这一全新的安全面。
- **在 MPlayer 的许可证与「不引登录态 + 不引破解源」双约束下，本报告不建议作为当前投入方向。**

**推荐**：先做 **B**，把 **A** 的定位文案一并落地，**C** 写成 ADR 留档但不启动。

---

## 7. 参考索引

### MPlayer 侧（primary）
- `packages/core/src/tier3/tier3Api.ts`：`31` kind 联合类型、`33-58` 请求/搜索规格、`60-95` 源/清单/订阅、`113-118` 超时与试听阈值、`186/255` kind 白名单、`199-205` URL 模板校验、`308-322` `getByPath`、`324-336` `toUrlCandidate`、`362-388` 模板填充与请求构造、`405-424` 域名白名单、`434-482` 字节嗅探、`486-512` 取链与业务错误封套、`534-580` search-then-resolve、`641-690` 搜索兜底、`694-716` 订阅拉取、`807-822` 源推断/防护、`824-866` 顶层解析
- `packages/core/src/tier3/__tests__/tier3Api.test.ts:196`：显式拒绝 `kind:'script'`
- `packages/core/src/shared/sourceRouter.ts:314`：`TIER3_BUDGET_MS = 6_000`；`366-370` 预算截断
- `packages/core/src/utils/sniffers.ts`：`isAudioBytes` 魔数白名单
- `packages/core/src/utils/sourceIdPrefix.ts`：`{id}` 的真实语义
- `packages/core/src/api/qqDirect.ts:328`：QQ id 优先 songmid
- `packages/mobile/android/gradle.properties:43`：`hermesEnabled=true`
- `LICENSE:33-51`、`package.json:101`：PolyForm Noncommercial 1.0.0
- `CONTEXT.md:40`：tier3 订阅源定义
- 姊妹报告：`docs/wayfinder/r5-unofficial-sites.md`

### 外部（primary，2026-09-14 抓取）
- lx-music 自定义源脚本规范：<https://lxmusic.toside.cn/desktop/custom-source>
- lx-music 许可协议：<https://lxmusic.toside.cn/desktop/license>
- lx-music FAQ「歌曲无法试听与下载」（内置源移除）：<https://lxmusic.toside.cn/desktop/faq/cannot-play-and-download>
- lx-music 移动版自定义源差异：<https://lxmusic.toside.cn/mobile/custom-source>
- lx-music 宿主实现：`lyswhut/lx-music-desktop` → `src/main/modules/userApi/{index,utils,main,rendererEvent/rendererEvent}.ts`、`src/renderer/utils/musicSdk/api-source{,-info}.js`、`src/common/types/user_api.d.ts`
- MusicFree 插件机制/协议/注意事项：<https://musicfree.catcat.work/plugin/introduction.html> 、`/plugin/protocol.html`、`/plugin/caution.html`
- MusicFree 插件安装与订阅：<https://musicfree.catcat.work/usage/mobile/install-plugin.html>
- MusicFree 插件类型定义：`maotoumao/MusicFreePlugins` → `types/plugin.d.ts`
- MusicFree 插件运行模型：`maotoumao/MusicFree` → `src/core/pluginManager/plugin.ts`；桌面版 `src/shared/plugin-manager/main/plugin.ts`
- listen1 扩展 provider 源码：`listen1/listen1_chrome_extension` → `js/provider/*.js`
- GD Studio API 文档（端点自述）：<https://music-api.gdstudio.xyz/api.php>
- 落月 API 文档：<https://doc.vkeys.cn/> 、`/jieshao.html`、`/v3/`、`/v3/音乐模块/QQ音乐/点歌相关接口/{1-info,2-link}.html`
- any-listen lx 源加载扩展：`any-listen/any-listen-extension-lx-api-source-loader` → `src/main/isolate/`、`src/isolate-preload/`
- Hermes 语言特性（**勘误后**）：`facebook/hermes` → `doc/Features.md`。**排除的是 `Local mode eval()`，不是 `new Function()`**；维护者确认 `Global eval (eval() at the global scope or new Function()) has always been supported` —— <https://github.com/facebook/hermes/issues/785>
- **lx-music-mobile 的移动端源沙箱（Hermes 之外另带 JS 引擎）**：`android/gradle.properties:41 hermesEnabled=true`；`android/app/build.gradle:196 implementation 'wang.harlon.quickjs:wrapper-android:2.4.0'`；`android/app/src/main/java/cn/toside/music/mobile/userApi/{QuickJS,JavaScriptThread,JsHandler,UserApiModule,UtilsEvent}.java`
- **lx-music-desktop 的源沙箱**：`src/main/modules/userApi/main.ts`（`createWindow` 的 `webPreferences` + `denyEvents` + `setPermissionRequestHandler` + `setWindowOpenHandler`）、`src/main/modules/userApi/renderer/preload.js`（`case 'musicUrl'` 的 URL 长度/协议校验）
- **lx-music 源生态萎缩的一手证据**：`lyswhut/lx-music-desktop` issue #1912（2024-05-26，作者自述进入维护模式）；`lxmusic.toside.cn/desktop/faq/cannot-play-and-download`（2023-10-18 因腾讯投诉移除内置源）
- **vkeys 档位全枚举与错误码（实测）**：`GET https://api.vkeys.cn/music/tencent/song/link?mid=0039MnYb0qxYhV&quality={1,2,4,6,8,10,11,12,13,14}` → 见 §6.5.1
- **vkeys 两条 API 代际**：`/music/tencent/search/song?keyword=`（1 代，`data.list[]`）vs `/v2/music/tencent?word=`（2 代，`data[]`）
- **PolyForm Noncommercial 1.0.0 全文**：<https://polyformproject.org/licenses/noncommercial/1.0.0>
- **CC BY-NC 4.0 法律文本**：<https://creativecommons.org/licenses/by-nc/4.0/legalcode.en>
- lx-music 相关 issue：#2704（音源自动更新诉求）、#2882（换源失败）、#2885（批量验证源）、#2631/#2752（换源失效）

## 附：本次实测的原始命令与抓取时间

**抓取时间**：2026-09-14（本机 UTC，`date -u` = `Mon Sep 14 00:40–00:46 UTC 2026`）。

- **tier3 路径语义复现**：本地 node 复刻 `tier3Api.ts:192-196`（`assertString`/`isRecord`）与 `:308-322`（`getByPath`），输入 = 实测的 GD Studio 根级数组响应。脚本路径 `/tmp/tier3-pathcheck.mjs`（临时文件，未入库）。
- **vkeys 搜索**：`curl 'https://api.vkeys.cn/music/tencent/search/song?keyword=%E6%99%B4%E5%A4%A9&page=1&num=3&type=0'`
- **vkeys 取链档位扫描**：`for q in 1 2 4 6 8 10 11 12 13 14; do curl -s 'https://api.vkeys.cn/music/tencent/song/link?mid=0039MnYb0qxYhV&quality=$q'; done`
- **vkeys v2 端点**：`curl 'https://api.vkeys.cn/v2/music/tencent?word=%E6%99%B4%E5%A4%A9&num=2'`
- **vkeys 连续请求**：`for i in 1 2 3 4 5; do curl -s -o /dev/null -w '%{http_code} ' 'https://api.vkeys.cn/music/tencent/search/song?keyword=test&page=1&num=1'; done` → `200 200 200 200 200`
- **GD Studio 被 CF 拦截**：`curl -H 'User-Agent: Mozilla/5.0 … Chrome/131 …' -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-Site: none' 'https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=test&count=1&pages=1'` → **403 + `cf-mitigated: challenge`**；改 http 协议同 403。
- **GD Studio 经浏览器型抓取器通关**：
  - `?types=search&source=netease&name=晴天&count=3&pages=1` → 根级数组
  - `?types=url&source=netease&id=3391116218&br=320` → `m801.music.126.net/…mp3`，`size=9143946`
  - `?types=url&source=netease&id=186016&br=320` → `{"url":"","br":0,"size":0}`（旧 id 静默失败）
- **返回直链核验**（tier3 嗅探条件的等价检查）：
  - `curl -sI -r 0-1023 '<GD url>'` → `206` + `content-range: bytes 0-1023/9143946` + `content-type: audio/mpeg`
  - `curl -sI -r 0-1023 '<vkeys quality=10 url>'` → `206` + `content-range: bytes 0-1023/55397039` + `content-type: audio/x-ogg`
- **GitHub 元数据**：`api.github.com/repos/{lyswhut/lx-music-desktop, lyswhut/lx-music-mobile, lyswhut/lx-music-doc, maotoumao/MusicFree, maotoumao/MusicFreeDesktop, maotoumao/MusicFreePlugins, listen1/listen1_chrome_extension, listen1/listen1_desktop, any-listen/any-listen, any-listen/any-listen-extension-lx-api-source-loader, pdone/lx-music-source, Macrohard0001/lx-ikun-music-sources, xxnuo/MusicFreePluginsHub, MeoProject/lx-music-api-server}`（其中 `Huibq/keep-alive` 与 `TZB679/USEFUL-LX-MUSIC-SOURCES` 返回 **404/None**）
- **许可证原文**：`raw.githubusercontent.com/{lyswhut/lx-music-desktop/master/LICENSE, maotoumao/MusicFree/master/LICENSE, 7878gyc/gdstudio-lx-source/main/LICENSE, maotoumao/MusicFreeDes/**/…}`；PolyForm NC 1.0.0 <https://polyformproject.org/licenses/noncommercial/1.0.0>；CC BY-NC 4.0 <https://creativecommons.org/licenses/by-nc/4.0/legalcode.en>
- **Hermes**：`raw.githubusercontent.com/facebook/hermes/main/doc/Features.md`；维护者答复 <https://github.com/facebook/hermes/issues/785>
- **lx-music 移动端源沙箱**：`raw.githubusercontent.com/lyswhut/lx-music-mobile/master/{android/gradle.properties, android/app/build.gradle, android/app/src/main/java/cn/toside/music/mobile/userApi/QuickJS.java, …/UserApiModule.java}`
- **lx-music 桌面端源沙箱**：`raw.githubusercontent.com/lyswhut/lx-music-desktop/master/{src/main/modules/userApi/main.ts, src/main/modules/userApi/renderer/preload.js}`
- **lx-music 自定义源规范**：`raw.githubusercontent.com/lyswhut/lx-music-doc/master/docs/desktop/custom-source.mdx`

---


## 8. 未验证 / 不知道清单

1. **`itemsPath: "."`（根即数组）能否通过真实清单校验并跑通** —— 只从 `assertString` + `getByPath` 实现推断可行（`""` 会被 assertString 拒），**无测试覆盖，未在真实清单上跑通**。
2. **GD Studio 多歌手经 `asString` 变逗号串后，是否真能被 `isExactMatch` 拆分匹配** —— 按 `songMatcher.ts` 的 `splitArtists` 正则推断**可以**（逗号在分隔符集里），**未跑通真实调用链验证**。
3. **GD Studio `br=740/999`（无损档）是否匿名可用、返回什么** —— **仍未测试**（本子代理只测了 `br=320/128/999`；`br=999` 对旧 id 返回空 URL，**未用新 id 复测**）。按分档原则，即使可用也**不应接**。
4. **vkeys 的实际限流阈值** —— 文档两处说法矛盾（`jieshao.html` 说「QPS 限制：暂无」，V3 页说「使用接口限流」），**未压测**（本子代理只做了 5 次连续请求，全 200，**不足以证明无限制**）。
4b. **GD Studio 的 Cloudflare 挑战 MPlayer 能否通过** —— **未验证，且这是接 GD Studio 的第一必答问题**。本机 curl / 带浏览器 UA 的 curl / 补全 `Sec-Fetch-*` 的 curl **全部 403 + `cf-mitigated: challenge`**；只有浏览器型抓取器通关。MPlayer 的 `transport`（乃至 `tlsFingerprint` 开关）能否过，**未测**。
4c. **GD Studio 返回的直链是否带时效签名** —— URL 内含 `/20260914090819/` 形态的时间戳段，**疑似有 TTL，未验证**。
4d. **vkeys `quality=12/13` 是否永远不可用** —— `12` 返回 `code:110000`、`13` 返回 `code:110001 cookie异常：账号被风控无法获取`。是稳定失败还是**瞬时风控**，**未复测**。
4e. **`itemsPath:"."`（根即数组）在真实清单上端到端跑通** —— 我用 Node **复刻 `assertString`+`getByPath` 已证明「校验通过且返回根数组」**（见 §3.2 表格），但**未在真实 tier3 调用链上跑过**（未构造真实清单 + `makeRequestMock`）。
4f. **tier3 是否已被排除在 `probeSongsBatch` 之外** —— `sourceRouter.ts:556` 注释（「慢源（20s 超时）拖死整批探测。播放仍走 resolvePlayableSongRouted（含 tier3 兜底）」）**提示已排除**，但**未逐行核实实现**。§6.7 路线 B 执行前必须先确认，否则 GD Studio 的 50/5min 会在探测路径上直接爆掉。
5. **vkeys 是否提供 netease/kuwo/kugou/migu 的等价端点** —— `/music/netease/song/link` 等路径实测 404，**是否有其它路径未找到**（V3 文档 sitemap 只列了 QQ 音乐相关）。
6. **vkeys 的非 QQ 源公开文档** —— 文档站 V3 侧边栏只有「音乐模块 / QQ音乐 / 其他模块 / 腾讯云COS」，**未见网易/酷狗条目**；v2 文档是否覆盖未查。
7. **MusicFree 各第三方插件的具体凭据要求** —— 只从插件名（「QQ Vip」「哔哩哔哩_Cookie」）推断，**未逐个读源码**。
8. **`/music/tencent/song/link` 返回的 `quality` 字段语义** —— 实测响应里 `quality` 键不存在（文档示例里有），**当前返回结构与文档不完全一致**，未深究。
9. **GD Studio 是否需要签名** —— r5 记录 musicdl 里要「自研 MD5 + 时间/版本签名」，本次公开端点**不需要**；两个版本的差异原因**未查明**。
10. **各源清单仓库的「源有效率」** —— 没有任何权威统计；无法给出「接进来能提升多少可播率」的量化结论。
11. **任何「已实测可用」的源站内音频内容的版权状态** —— 未做、也做不到合法性判定。
12. **`music.gdstudio.xyz` 是否永久下线** —— 本次 TLS 连接失败 + 403，**是网络原因还是站点原因未区分**。

