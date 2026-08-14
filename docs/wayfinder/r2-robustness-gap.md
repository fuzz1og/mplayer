# 请求健壮性与反爬手法差距清单（musicdl 借鉴 · R2）

> wayfinder research ticket 的 /research AFK 研究资产。对照 musicdl（Python 下载器）的健壮性/反爬手法，逐一评估 MPlayer（Electron + React Native）请求层的现状与移植方案。以 primary source 源码为准，引用见各节。

**主参考**
- musicdl 源码：`C:\Users\Admin\AppData\Local\Temp\musicdl-clone\musicdl\`
  - `modules/sources/base.py`（`get`/`post` 重试、`_initsession`、`random_update_ua`、三阶段 header/cookie、curl_cffi）
  - `modules/utils/misc.py`（`usesearch|useparse|usedownloadheaderscookies` 装饰器、`AudioLinkTester`、`resp2json` 容错）
  - `modules/utils/ip.py`（`RandomIPGenerator`）
  - `modules/sources/netease.py`、`kugou.py`、`soda.py`（`default_search_headers`、`json_repair` 用法）
- MPlayer 现状：`packages/core/src/api/antiScrape.ts`、`musicApi.ts`、`neteaseWeapi.ts`、`memoryCacheManager.ts`（注：主进程另有一份 `src/main/api/musicApi.ts`，本文聚焦 core 内共享层，主进程独有部分单列）。

---

## 0. 现状速览（先对齐事实）

- `antiScrape.ts` 定义了**完整**的功力（10 条 UA 池 + 令牌桶 `RateLimiter(3,2)` + `getAntiScrapeHeaders(referer)` 全套 sec-ch UA/平台/请求头），但 grep 全仓显示 `beforeRequest` / `getAntiScrapeHeaders` **只在 `getQQToplist` 一处显式调用**（`musicApi.ts:968-971`）。**不是全局拦截器**——绝大多数请求仍走静态最小头，`neteaseWeapi.ts` 完全零反爬。
- `musicApi.ts` 的健壮性点：`getAudioUrl` 自带 max_retries=2 + 指数退避 `500*2^attempt` + abort（`musicApi.ts:528-571`）；`batchSearch` 可配并发上限（`:623-656`）；`healthCheck` + 歌曲黑名单带 TTL（`SEARCH_FAILED_TTL=10min`，`:54-59`）；缓存拒绝空数据（`memoryCacheManager.ts:64-75`），已避免把空响应写进缓存导致不重试。
- 反爬/重试**散落各处**，未抽象成统一层：`getAudioUrl` 自己写重试循环，`searchSongs` 没有重试，weapi 没有重试。与 musicdl 把重试收敛到 `get`/`post` 一个 wrapper 里形成对照——这是本清单最大的结构性差距。

---

## 1. 统一 `get`/`post` 重试包装（max_retries=3、TLS 失败 verify=false 重试一次、指数退避）

**现状**
- 无统一重试层。仅有 `getAudioUrl` 内的私有循环（`musicApi.ts:528-571`）：`MAX_RETRIES=2`、`BASE_TIMEOUT=5000`、退避 `500 * 2^attempt`、可 AbortSignal；其余接口（`searchSongs`、weapi、歌词、歌单、歌手）一次即败。
- 无「TLS 失败降级 verify=false」逻辑。

**musicdl 做法**
- `base.py:273-293` 的 `get(url, **kwargs)` / `post(url, **kwargs)` 把重试统一收敛：
  - `for _ in range(self.max_retries)` 循环，默认 `max_retries=3`（`base.py:68-90`，`max(max_retries,1)`）。
  - 每次 `resp.raise_for_status()` 抛错则 `continue`（无显式退避 sleep，靠 `as_completed` 多线程吞吐；错误只打日志）。
  - 每请求默认注入 `self.default_cookies`（若未显式传）。
  - **TLS 降级在 `_download`**（`base.py:220-221`）：`try: ...self.get(url, stream=True, **overrides).raise_for_status() except: ...self.get(url, stream=True, verify=False, **overrides)` ——对下载直链的 TLS 校验失败重试一次并把 `verify=False`（对 CDN/自签证书源很关键）。
  - `_autosetproxies`（`base.py:267-271`）在 `auto_set_proxies` 时每次请求拉随机代理。

**移植方案（进 `@mplayer/core`，两端共享）**
- 新增 `retryFetch(method, url, opts)` 或在 axios 单例上挂 `response.use` 拦截器做「失败→退回→退避→重试」。用 axios 拦截器比 wrapper 更适合现有散落的 `apiClient.get/post` 调用（无需全置换）。
- 参数：`maxRetries=3`（含首次尝试共 4）、`baseDelay=500`（对齐现状 `getAudioUrl`）、`retryDelay = baseDelay * 2^attempt`、可对特定 status/错误类别选择性重试。保留 AbortSignal 透传（`getAudioUrl` 已验过 abort 不能重试）。
- **TLS 降级**：对「音频/封面/歌词直链」类请求，捕获 `ECONNRESET`/`DEPTH_ZERO_SELF_SIGNED_CERT`/TLS 握手错误时，第二发把 `httpsAgent.rejectUnauthorized=false` 重试一次。必须**仅限内容直链**，绝不能对自有搜索 API 关校验（安全性分界）。
- 目前 axios 在 core 里同时被 `apiClient`、`createNeteaseClient`、`weapiClient`、`qqClient` 等并行实例使用——统一层要按实例接入，避免一处改了别处漏。

**桌面/移动端可行性**：两端均可行。axios 拦截器与 `setTimeout` 退避纯 JS，React Native 无兼容问题；`rejectUnauthorized=false` 需要 Node `https.Agent`（Electron 主进程有），RN 侧该类降级用 `cfork`/`Alo` 无等价原生开关，**仅在桌面主进程实现 TLS 降级**。

**优先级：P0**——重试是纯收益：成本低、直接提升弱 API/瞬时故障下的成功率，且能收拢现在 `getAudioUrl` 里重复写的逻辑。

---

## 2. 三阶段 header/cookie profile（search / parse-URL / download 装饰器切换）

**现状**
- header 按「模块/调用点」手写，不按「搜索/解析/下载」三类语义区分：`createNeteaseClient`（`musicApi.ts:89-99`）静态 UA+Referer；`getQQToplist`（`:969-979`）临时造 `qqClient` 带全套反探头；`searchSongs` 走 `apiClient` 的静态表单头；`getAudioUrl` 走 `apiClient.get` 无 Referer。
- 无 cookie 概念（除 weapi 加密依赖自身的 key 协商），无「每个源各自一套 headers」的源级 profile。

**musicdl 做法**
- `misc.py:91-124` 三个装饰器 `usedownloadheaderscookies` / `useparseheaderscookies` / `usesearchheaderscookies`，用 `functools.wraps` 包住方法：进入前把 `self.default_headers` / `self.default_cookies` / `self.enable_curl_cffi` 换成对应阶段的 profile，并 `self._initsession()` 重建会话。语义 = 同一个源里 search/parse/download 各用不同 UA/Referer/cookie/指纹，降低「同 session 连续请求行为一致」被风控识别。
- 各源在 `__init__` 定义自己的默认头，例：netease `default_search_headers = {UA: Chrome134, Referer: music.163.com}`、`default_parse_headers` 同、`default_download_headers={}`（`netease.py:38-41`）；quark 专门写了带 `origin`/`referer`/独立 UA 的 `quark_default_download_headers`（`base.py:110`）。
- cookie 经 `cookies2dict` 规范化，每请求注入（`base.py:274,285`）。

**移植方案（进 `@mplayer/core`）**
- 给每个源建 `SourceProfile { searchHeaders, parseHeaders, downloadHeaders, cookies?, enableFingerprint? }`，用一个 `withPhase(profile, phase)` 的轻量 helper（等价装饰器的 TS 版：`request(phase, ...)` 在进入时替换该次请求的 headers）。
- 价值判断：当前只打自有搜索 API + 少量直连源站（网易/QQ/汽水）。**搜索 API 阶段差异小**（都是表单 JSON GET/POST），真正需要差异化的是「源站 HTML/直链」（网易雷区、汽水分享页、歌手 HTML）与「下载直链/探测」（要 Referer 防 403/防盗链）。所以**价值中等偏上但不要过重**——每源三套头若八成都相同反而增加维护噪音。
- 落地建议：先只做**两态**（`api` 态 vs `page/parse` 态）+ 源级 Referer 表，把现在散落在各处手写的 Referer/UA 收敛为数据；download 态特别要用独立 Referer（防盗链关键）。cookie 目前只有网易可加（`MUSIC_U`），作为后续项。

**桌面/移动端可行性**：两端均可，纯配置化。

**优先级：P1**——收益是「行为不一致更抗风控」+「把散落 header 集中管理」，但当前受限源站数少，成本要控制（别一步到位三套）。

---

## 3. 随机 UA「每次请求重滚」vs 现状「池随机」

**现状**
- `antiScrape.ts:21-23` `getRandomUserAgent()` 从固定 10 条池 `Math.random` 取一条；`getAntiScrapeHeaders` 每次调用都会 `getRandomUserAgent()`（`:106`），即**每次请求已重滚**（只要该请求用了 `getAntiScrapeHeaders`）。问题是覆盖率低（仅 QQ 一处）。
- 池是**硬编码 10 条**（Chrome/Edg/Firefox/Safari 新旧版），无版本兜底、无「同源连续请求不同 UA」的显式策略。

**musicdl 做法**
- `base.py:277,288`：`self.random_update_ua and self.session.headers.update({'User-Agent': UserAgent().random})` ——在**不维护 session 的每个重试轮**都重新 `UserAgent().random`。`fake_useragent` 提供几百条真实浏览器 UA 数据库（非 10 条池）。
- `random_update_ua` 默认关（`base.py:98-100`），可选开。与 `maintain_session` 正交：`maintain_session=False` 时甚至每请求 `_initsession` 换全新 Session。

**移植方案**
- 保留现在每次调用即重滚的模式（与 musicdl 一致），但改两处：
  1. **扩充 UA 池**：从硬编码 10 条换成内嵌的浏览器 UA 数据集（可打包 30–50 条覆盖近 3 年各版本，或引入 `fake-useragent` 的 JS 等价物）。
  2. **增加「同源连续性约束」**：musicdl 是靠换 session 天然隔断；axios 无 session，需在 cookie jar/header 组装处保证「同一源相邻请求 UA 尽量不重复」（最简：上一 UA 记下来，`getRandomUserAgent(excludePrev)`）。对带 `Referer` 的源站请求尤其重要——连续同 UA + 同 Referer 高并发最易被识别。

**桌面/移动端可行性**：两端均可行（纯 JS）。UA 池扩充体积小，RN 打包无压力。

**优先级：P1**——成本低；但收益天花板有限（UA 是低级反爬，真正被 Alpaca/AK 拦的是 TLS 指纹，见下节）。把 UA 池 + 反重连续性做好即可，不必过度。

---

## 4. TLS 指纹伪装（curl_cffi）在 Node/Electron 的等价物，及 RN 可行性

**现状**
- 完全缺失。electron 主进程 `apiClient` 用 Node 默认 `https.Agent`（除非经 `injectProxyAgents`，`musicApi.ts:44-49`），走 OpenSSL 默认 TLS 指纹，极易被源站 JA3/JA4 + HTTP/2 指纹识别。这是当前反爬最大盲区。

**musicdl 做法**
- `base.py` 全流程可选 curl_cffi：`enable_search/parse/download_curl_cffi` 三个独立开关（`:33-36,103-107`）；`_initsession` 在开启时用 `curl_cffi.requests.Session()`（`:126`）；`get`/`post` 里 `if ... enable_curl_cffi: kwargs['impersonate'] = random.choice(self.cc_impersonates)`（`:275,286`）。
- `_listccimpersonates`（`:115-120`）从 curl_cffi 二进制里正则扫出支持的全部 `chrome/edge/safari/firefox/tor*` 指纹字符串，随机取一个 `impersonate` —— 即**随机选择浏览器指纹**而非固定 Chrome。curl_cffi 是 libcurl-impersonate 的 cffi 绑定，重放真实浏览器的 JA3 + HTTP/2 指纹。

**Node/Electron 等价物（可行性分层）**
- **`curl-impersonate`（含 node 绑定 / `curl-impersonate` 子进程）**：最接近，能重放 Chrome JA3/HTTP2 指纹。成本高：需要随应用分发编译好的 curl-impersonate 二进制（Electron 打包要带 `.exe`/`.so`，跨平台三份），且要串到 axios 需绕 `httpAdapter`/自定义 transport。中重投入。
- **`got` 的 `tls` 选项 / `https.Agent` 自定义 cipher 组合**：Node 的 `tls.connect` 允许指定 `ciphers`、`secureProtocol`、`sigalgs`。利用 [tls-client](https://github.com/bogdanfinn/tls-client) 的 Go 库思路（Node 侧无官方等价）或社区 `cycletls`（JS）能模拟部分指纹。但仅调 cipher 组合**无法完整模拟 JA4**（还要 HTTP/2 SETTINGS、ALPN、header 顺序）。中投入，效果中等偏上。
- **undici `connect` 自定义 / `Client(..., connect: { ... })`**：undici 底层用 `http-parser` + Node TLS，可注入自制 `connect`，能控 TLS 参数但与「完整浏览器指纹」仍有差距，且 axios 默认 adapter 是 XHR/`http(s)`，要切 undici transport，改造大。
- **推荐且务实的一档**：很多源站（网易、QQ）对「未伪装」也会放行，只是对高频/签名请求严。先用 **`curl-impersonate` 子进程或 cycletls 仅对「源站关键请求」（weapi、QQ 网关、汽水分享页）**，不全局启用——与 musicdl 的 `enable_*_curl_cffi` 独立开关思路完全一致，按险情开启。P0 甚至可先只对 **weapi** 加指纹（网网易风控最严，`musicApi.ts` 已有 weapi 加密却无指纹，是明显短板）。

**RN 可行性：大概率不可行。** 原因：
- RN 网络层用系统栈（Android OkHttp / iOS NSURLSession），**不开放原生 TLS 握手参数 / 指纹定制**。
- `fetch`/`axios` 在 RN 里无法注入自定义 TLS verify / cipher / JA3；OkHttp 是 Java 侧指纹、CFURLCreate 是 Apple 侧，与 Chrome JA3 完全不同（移动 WebView 是另一套）。
- 商业级移动伪装需拿到源站移动端 API + 对应 App 指纹签名（如汽水移动 API），不是「把 Web TLS 指纹搬过来」能做到。
- **结论：TLS 指纹工程仅桌面主进程；RN 一律放弃，转向「降低请求频率 + 显式限速 + 换移动端点」策略。**

**优先级：P0（桌面 subset）**——这是当前差距清单里技术价值最高的一项；但落地范围要收敛到「关键源站请求」，别全量。

---

## 5a. 会话复用（keep-alive agent）

**现状**
- `injectProxyAgents`（`musicApi.ts:44-49`）允许桌面注入 http/https Agent，但**默认 `apiClient` 无自定义 agent** → 用 Node 默认 agent（Node 有 keep-alive，但代理解析时 `proxy:false` 也建独立 agent）。QQ 临时 client 每次新建（`getQQToplist` 里 `axios.create`）。weapi 单独 `weapiClient` 一直复用（keep-alive 隐式 OK）。
- 信号：多实例 client（apiClient / neteaseClient 每次 create / qqClient 每次 create / weapiClient）各自建连接池，无统一复用的 HTTP/1.1 keep-alive。

**musicdl 做法**
- `maintain_session`（`base.py:88`、`_initsession:123`）：为 True 则复用同一 `requests.Session`（连接池 + cookie jar 保留），仅更新 headers；为 False 则每请求 `_initsession` 重建 Session（更大随机性，牺牲性能）。默认 False，个别源（deezer `:32`、twot58 `:29`、gequhai `:32`、jbsou `:23`）显式开。

**移植方案（进 `@mplayer/core`）**
- core 内**统一为每个源建单例 axios client**（而不是每次 `axios.create`），让 Node keep-alive 生效：请求密集（歌单 1000 首批量 `weapiRequest`，`musicApi.ts:1331-1336`）退避明显下降。
- 可选暴露 `reuseFingerprintSession` 概念：默认开复用以性能优先；对高风控源可「每 N 请求换 agent」压缩连接，模拟 musicdl 的重建策略。

**桌面/移动端可行性**：两端可行；RN 无独立 agent 概念（系统栈自带连接复用），意义主要在桌面批量场景。

**优先级：P2**——性能优化，非健壮性必需，批量请求已能工作。

---

## 5b. 随机 IP 头（网易/twot58 的 X-Forwarded-For）

**现状**
- 无任何 XFF / X-Real-IP 伪装。所有请求不携带转发头（正常浏览器也不带，所以「不伪造」其实更像个真浏览器——伪造成随机内网/公网 IP 反而不真实，见下）。

**musicdl 做法**
- `ip.py:42-47` `RandomIPGenerator.addrandomipv4toheaders`：随机生成一个「全球公网 IP」（`_randomglobalipv4:71-78`，`getrandbits(32)` 且 `is_global` 过滤，或从 APNIC 拉的**真实中国 IPv4 网段**里采样，`_loadcnipv4blocks:49-58`），写入 `X-Forwarded-For` / `X-Real-IP` / `Forwarded` 三个头。
- 用途：绕「按 IP 维度限频」的源站。网易 `netease.py:151`（随机 IP 参与 URL/加密请求）、spotify `:109`、twot58 `:85`。

**移植方案**
- 技术上可做：随机生成一个合法公网 IPv4（排除私网/保留段），写 `X-Forwarded-For` + `X-Real-IP`。JS 实现是一段 rand + 段过滤。
- **但价值存疑且要慎重**：随机 XFF 可能触发 WAF/反向代理把请求「按 XFF 里的 IP 视为一次新来源」而扩大自由度，但也可能被 CDN 判定为「代理流量」直接拦。musicdl 用在 Python 服务器端直连源站场景，MPlayer 是「桌面客户端 → 自有搜索 API / 源站」。对**自有搜索 API** 加 XFF 无意义（同出口）。对**直连源站**（网易/汽水）是唯一用处，而这时它的 IP 是你的真实出口，XFF 头对服务端识别无效（反代不认客户端 XFF）。**实际收益低，且可能反噬。**
- 结论：**不建议移植**，或仅作为「给源站制造 IP 维度随机性」的探测候选（P2 极低优先）。

**优先级：P2（不建议默认启用）**——低收益、有被 CDN 拦截反噬风险；记录以便知悉 musicdl 有此招即可。

---

## 5c. json_repair 容错解析的 JS 等价（jsonrepair 包）

**现状**
- 大部分解析都是直接 `JSON.parse`（`musicApi.ts:297-304`、`:986-999` 连 `JSON.stringify` 后 `JSON.parse`）。源站返回「带尾逗号 / 单引号 / 前导垃圾 / HTML 包裹 JSON」时直接崩。
- 已有少量兜底：`processSong` 的字段级 get、`searchSongsSoda` 的 `match[1]` 正则 + `JSON.parse`。但无通用容错。

**musicdl 做法**
- `misc.py:73-74` `resp2json`：`try resp.json() except: return json_repair.loads(resp.text)`——**任何 JSON 解析失败降级到 `json_repair`**。全仓库大量在 HTML/script 标签里提取 JSON 后过 `json_repair.loads`（netease AES 解密 `:163`、soda `_ROUTER_DATA :101`、joox `:172`、kugou `:65` 等）。`json_repair` 能修尾逗号、单引号、截断、漏花括号等。

**移植方案（进 `@mplayer/core`）**
- 引入 `jsonrepair` npm 包（对应 Python `json_repair`），封装 `safeParseJSON(text): any` 做 `JSON.parse → JSON5-lite → jsonrepair` 三级降级。凡是从源站 HTML/正则提取 JSON 的地方（汽水 `_ROUTER_DATA`、QQ 网关、歌手 HTML）统一走它。
- 对「自己搜索 API」无须容错（形态固定），**只对源站脆弱响应**启用，避免掩盖自有 API 的格式退化。

**桌面/移动端可行性**：两端均可行（纯 JS 小包，RN 兼容）。

**优先级：P1**——低成本高实用性，直接减少「解析崩→整接口失败」。

---

## 6. 归属划分：进 `@mplayer/core`（两端共享）vs 仅桌面主进程

**进 `@mplayer/core`（两端共享）：**
- 统一重试包装（`retryFetch`/axios 拦截器）——P0
- 三阶段 header profile / 源级 Referer 表（纯配置）——P1
- UA 池扩充 + 反同源连续（纯 JS）——P1
- 会话复用（每源单例 client）——P2
- `safeParseJSON`/jsonrepair 容错——P1

**仅桌面主进程：**
- **TLS 指纹伪装**（curl-impersonate/cycletls/自定义 agent，`rejectUnauthorized=false` 降级）——P0。依赖 Node 原生 TLS/网络栈，RN 无等价。
- 随机 IP 头：不建（见 5b），如做也在桌面。P2。

**移动端专属替代策略：** RN 放弃 TLS 伪装（技术上不可行），用其端到端手段（显式限速、降低并发、必要时接源站移动 API 签名）。core 的限速/重试/容错对移动端同样生效，因此「进 core」的项天然覆盖移动端。

---

## 优先级汇总

| # | 手法 | 现状 | 去向 | 优先级 |
|---|------|------|------|--------|
| 1 | 统一 get/post 重试 + TLS 降级 | 仅 getAudioUrl 有 | core | **P0** |
| 4 | TLS 指纹伪装（curl_cffi 等价） | 无 | 桌面主进程 | **P0** |
| 2 | 三阶段 header/cookie profile | 散落手写 | core | P1 |
| 3 | UA 池扩充 + 反同源连续 | 10 条池 | core | P1 |
| 5c | json_repair 容错（jsonrepair） | 直接 JSON.parse | core | P1 |
| 5a | 会话复用（keep-alive 单例 client） | 多实例各建池 | core | P2 |
| 5b | 随机 IP 头（XFF） | 无 | 不建/仅桌面探测 | P2 |

---

## 核心结论（最高价值 3 项）

1. **【P0】统一重试 + TLS 降级收进 core 请求层**：现在 `getAudioUrl` 里那套 max_retries/退避/abort 应上提取代成 axios 拦截器，覆盖 search / weapi / 歌词 / 歌单全部调用；并对内容直链加 `rejectUnauthorized=false` 重试一次。纯收益、成本低、两端共享。
2. **【P0】TLS 指纹伪装——仅桌面主进程，收敛到关键源站**：这是当前最大盲区（weapi 有加密却零指纹）。对齐 musicdl 的 `enable_*_curl_cffi` 按险情独立开关思路，用 curl-impersonate/cycletls **只对 weapi、QQ 网关、汽水来源**打指纹；RN 明确放弃（系统网络栈不可定制 TLS 指纹）。
3. **【P1】把反爬从「一处可用」变成「全局默认」**：`getAntiScrapeHeaders` + `beforeRequest` 目前只被 QQ 一处调用，应接到所有源站请求（每源单例 client + 源级 Referer profile），并顺带接入 jsonrepair 容错。价值在于**一致性**——风控看的是整体行为，局部强、整体弱等于没做。

> 附：`docs/wayfinder/gap-list.md` 的桌面/移动功能差距是「功能面」；本文件是「请求管道健壮性面」，二者互补，落地时建议并进同一迭代。
