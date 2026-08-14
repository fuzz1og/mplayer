# R6 — 移动端网络能力与技术栈选项评估（直连源站 · 网络能力视角）

> wayfinder research ticket 的 /research AFK 研究资产。为「直连源站替代自建 API」做**移动端可行性评估**，聚焦**网络能力视角**，不做全量 UI 评估。
> 背景：MPlayer = Electron 桌面 + Expo/React Native 移动端，两端复用 `@mplayer/core`（axios 客户端，`packages/core/package.json` 依赖仅 `axios` + `crypto-js`）。
>
> 已知约束（同地图 R1/R2 结论，可信，直接引用）：
> - **RN 无 `zlib`/`gb18030` 内建**（酷我歌词 XOR+zlib+gb18030、酷狗部分响应受影响）——R2 §10。
> - **RN 系统网络栈（Android OkHttp / iOS NSURLSession）不可定制 TLS 指纹**——R2 §4：「TLS 指纹 RN 不可行」。
> - 自定义 DES（酷我）/XOR 换位（咪咕）需手写位运算——R1 §10。
> - 汽水 m4a `PlayAuth` AES-CTR 解密需 `react-native-quick-crypto`——R1 §10。
> - 网易 weapi 大整数 RSA + AES-CBC 已纯 JS 过 RN——`packages/core/src/api/neteaseWeapi.ts:11`「纯 JS 实现(crypto-js + BigInt),兼容 Node / Electron / React Native」。
>
> 全篇引用以「官方文档/源站/仓库源码」为 primary source。

---

## 0. 首屏结论

**三个选项里，唯一在「移动端直连源站」上明显加成的原生技术是「RN + 原生模块（OkHttp 拦截器 / JSI 原生模块）」——但它也只解决 zlib/gb18030/原生 TLS 信任面，不能解决 JA3/JA4 浏览器指纹伪装，因为移动端 TLS 基底是系统栈（Conscrypt / SecureTransport），与 Chrome 的 BoringSSL 不一致，结构性无法伪装。**

- **保留 RN 是低风险默认**：网易/汽水/千千/咪咕这四类（weapi+XOR+MD5 签名）**当前 `@mplayer/core` 就已 100% 移动端可直连**；只有酷我（自定义 DES + zlib + gb18030）和酷狗（gateway 设备注册）是 RN 天花板。
- **Flutter 没有带来移动端 TLS 指纹能力**（dart:io 的 `HttpClient` 同样走系统 BIO，`connectionFactory`/`badCertificateCallback` 只管连接与信任，不改 ClientHello 指纹），却要推倒重写整个 UI 栈 → 网络能力收益接近零、迁移成本最高，**不建议**。
- **Kotlin/Swift 原生**提供最全控制（OkHttp `ConnectionSpec`/`CertificatePinner`/自定义 `SSLSocketFactory` + 原生 `zlib`/GB18030），但代价是抛弃 `@mplayer/core` 共享层、全套源逻辑重写。**仅当「必须做到某源在移动端完整直连」且「该源强依赖桌面反爬功力」时才值得**。
- 推荐：**保持 RN + 轻量原生模块增强（针对酷我歌词 zlib/gb18030、汽水 AES-CTR），其余源继续走 `@mplayer/core` 纯 JS 直连；酷狗 gateway、酷我 URL 两个高成本源在移动端保留自建 API。**

---

## 1. RN 网络/加密能力盘点

### 1.1 axios / fetch 在 RN 的行为（primary：官方 network.md + 仓库 `musicApi.ts`）

RN 的 `fetch`/`XMLHttpRequest`（axios RN 用 XHR adapter）**不是 whatwg 实现，而是原生栈的 JS 桥**：Android 由 OkHttp、iOS 由 NSURLSession/Core Foundation 实际发请求（官方 network.md；StackOverflow #41132167 同证）。因此 JS 侧能配置的只有 XHR 层可见面（method/headers/url/body/timeout），无法触达 TLS 握手细节。

仓库 `musicApi.ts` 已**用代码记录**若干 RN 实测约束（可作 primary 引用）：
- **cookie jar 开关**：`:430-436`「RN Android 的 NetworkingModule 只在 `withCredentials=true` 时启用 cookie jar（否则 `CookieJar.NO_COOKIES`），axios 在 RN 的默认值有历史坑（PR #1441），显式指定保证原生栈 fallback 能携带会话 cookie」。
- **JS 读不到 `Set-Cookie`**：`:446-448`「RN（Android）原生 OkHttp cookie jar 自动托管会话 cookie，**JS 读不到 Set-Cookie 响应头（被 RN networking 过滤）**——此模式下 JS 只负责引导一次首页请求建立 jar，不读取也不手动携带 cookie 值」。
- **`maxRedirects` 失效**：`:701-702`「部分环境（RN 的 XHR 适配器、axios fetch 适配器）会**无视 maxRedirects 自动跟随**，此时只会返回原 URL——调用方应自行兜底」。即逐跳手动 302 解析在 RN 上不成立，只能依赖自动跟随。
- 官方 network.md「Known Issues」：`redirect:manual`、`credentials:omit` 在 RN 的 fetch 下不可用；iOS 302 重定向携带 `Set-Cookie` 时 cookie 不被正确设置、可能无限重定向；Android 同名字段只有最后一个生效。

**可配置面小结（RN 内 JS 能控制）**：UA/普通 header（同名字段受限）/method/timeout/withCredentials/body。**控制不到**：TLS 版本、cipher 顺序、扩展顺序、HTTP/2 SETTINGS、重定向策略（`maxRedirects` 无效）、读 `Set-Cookie`。

### 1.2 OkHttp / NSURLSession 的「可配置面」

**JS 层为零**，但 **Android 原生可换整个 OkHttp 客户端**：
- primary：square.github.io/okhttp/features/https/ —— `OkHttpClient.Builder()` 可设 `.connectionSpecs()`（自定 TLS 版本 + cipher 列表）、`.certificatePinner()`（SPKI SHA256/SHA1 pin）、`.sslSocketFactory(sslContext, trustManager)`（自定信任面/自签证书）。
- primary：RN 侧 `com.facebook.react.modules.network.OkHttpClientProvider.setOkHttpClientFactory / replaceOkHttpClient(...)`（StackOverflow #40240321 与 callstack SSL-pinning 文章），可注入换入的 `OkHttpClient`，全 App `fetch`/XHR 共用。
- iOS：NSURLSession 不可整体替换，但可用 TrustKit 的 `kTSKSwizzleNetworkDelegates` 动态插桩做证书/SPKI pin（primary：TrustKit 文档 + SEO #40240321）。

**关键边界（决定「TLS 指纹」结论）**：OkHttp/custom trust **只能改信任面与 cipher/extension 子集，不能把 ClientHello 伪装成特定浏览器**。JA3/JA4 由 TLS 版本+**cipher 顺序**+**extension 顺序与集合**+supported groups+sigalgs+**ALPN**+GREASE 共同决定；Chrome 的 cipher 顺序/扩展顺序是 BoringSSL 编译期内置（primary：crawlnex *cipher-suite-ordering* 分析，引 RFC 8446 与 chromium-cipher-suite-customizer；blink-dev「ClientHello extension permutation」确认 Chrome 随机化扩展顺序以抗 ossification）。移动端 TLS 基底是 Conscrypt（Android）/SecureTransport（iOS），**不是 BoringSSL**，产物天然与 Chrome 不一致。→ **R2「RN 不可做 TLS 指纹伪装」成立；原生模块也救不了 JA3/JA4，只能做证书/信任面和 cipher 子集定制。**

### 1.3 `react-native-quick-crypto` 覆盖度（primary：margelo 仓库 `implementation-coverage.md`）

功能上覆盖全部所需原语，但**随版本而变，落地前须按锁定版本核对**：
- Node-style 模块：`createCipheriv`/`createDecipheriv`（`aes-*`）、`createHash`（SHA1/SHA256/384/512、SHA3、MD5 属 hash 列表）、`createHmac`、`publicEncrypt`/`publicDecrypt`/`privateDecrypt`、`sign`/`verify`、`generateKey[Pair]`（`aes`/`hmac`/`rsa`/`rsa-pss`/`ec` 均 ✅）、`randomBytes` ✅（`docs/implementation-coverage.md` on `main`）。
- WebCrypto `subtle`：`encrypt`/`decrypt` 的 `AES-CTR`/`AES-CBC`/`AES-GCM`、`RSA-OAEP` ✅；`digest` 的 `SHA-*` ✅（当前 main 分支已全部 implemented；**注意 1.x 时代的旧 `.docs/implementation-coverage.md` 里 subtle 大量 ❌，实际以所装版本为准**）。
- **对本场景覆盖判定**：汽水 `PlayAuth` AES-CTR 解密（R1 §7.2）→ ✅（node-style `createDecipheriv('aes-128-ctr')` 或 subtle `decrypt`）。酷我自定义 DES 是**自实现位运算**（R1 §5.2），quick-crypto **不提供标准 DES** → 仍需 `node:crypto`/crypto-js 或手写，quick-crypto 无帮助。网易/QQ/酷狗的 AES-CBC+RSA 已经在 RN 用 crypto-js+BigInt 跑通（`neteaseWeapi.ts`），quick-crypto 只是可选提速，非必需。

### 1.4 zlib 替代（pako）能否覆盖酷我歌词（primary：nodeca/pako + 仓库）

酷我歌词 `newlyric.lrc` 的需要是 **zlib raw inflate + gzip/UNGZIP 之一**（R1 §5.1，`kuwoutils.decodelyrics`：`tp=content` 头部后 zlib 解压）。
- primary（pako API/README）：提供 `pako.inflate` / `pako.inflateRaw` / `pako.ungzip` / `pako.inflate(…,{toText:true})`；`inflate` **自动按头识别 deflate/gzip**（README「`pako.inflate` autodetect deflate/gzip by header content」）；纯 JS、浏览器/Node 通用、完整包 <15K gzip。**够用**：酷我 zlib 场景 `pako.inflate` 一项可覆盖，无需 `ungzip`。
- 收尾解码仍要 gb18030（见 1.5）；`pako.inflate` 的 `toText` 只做 UTF-8，不能处理 gb18030 → 必须 `Uint8Array` 输出后交给 gb18030 解码器。

### 1.5 gb18030 解码替代方案（primary：各解码器仓库 + hermes issue）

RN/Hermes 的 `TextDecoder` 仅支持 UTF-8/部分子集，**不支持 gb18030**（primary：Hermes issue #1403 —— 多位开发者报「Unknown encoding」；`@exodus/bytes` 作者确认 Hermes TextDecoder 精简、缺 utf-16le 等）。仓库 `cacheKernel.ts:34` 现只用默认 UTF-8 `TextDecoder`，无 gb18030。
- 方案 A（**JS 纯解码，推荐**）：`iconv-lite` —— README 明确 **React Native 受支持**（需 `stream` 装 Streaming API）；覆盖 `GB18030`/`GBK`/`GB2312`/`CP936` 等。RN 常规解码可只取 decode 路径，不用 Streaming。
- 方案 B（Polyfill `TextDecoder('gb18030')`）：`text-encoding-gbk`（仅 gb18030，`encoding-indexes.js` 188KB gzip，可裁剪）；或 `@exodus/bytes`（WHATWG 全编码，含 legacy 多字节表；比 `inexorabletash/text-encoding` 快，但 full 版本包体大）。适合「第三方库内部依赖 `TextDecoder('gb18030')`」时打补丁。
- 方案 C（原生模块）：`expo-gbk-converter` —— Expo native module 解码 GBK/GB18030（iOS/Android ✅、Web ❌），性能最好但引入原生代码。
- **判定**：酷我歌词一次性小数据 → **`iconv-lite` decode 即可**（S 成本，纯 JS，两端共享）。只有遇到「必须注入全局 `TextDecoder('gb18030')` 给第三方库」才考虑 polyfill。

### 1.6 cookie 持久化：AsyncStorage vs 原生 cookie 栈

- primary（`@react-native-cookies/cookies` + RN network 行为 + 仓库）：RN 原生栈自带 cookie（Android OkHttp CookieJar / iOS NSHTTPCookieStorage），`withCredentials=true` 即启用并自动持久化。**但 JS 读不到 `Set-Cookie`（`musicApi.ts:446-448`）**，Session cookie 由 jar 托管跨请求复用，靠「引导首页 GET 建 jar」。
- 若要 JS 显式控制（存用户 cookie、注入 `Cookie`、跨 jar 同步）：`@react-native-cookies/cookies` v6（吃原生 stale 栈的增删改查、`setFromResponse`）或 New-Arch 版 `react-native-cookie-manager`。iOS 双栈注意：`NSHTTPCookieStorage`(URLSession) *vs* `WKHTTPCookieStore`(WebView)，URLSession 流默认前一个。
- **本项目判定**：网易 `MUSIC_U`/QQ `musickey`/酷狗设备 cookie（R1 §4）+ R4（需匿名 cookie 无感获取）——这些**均可由 jar 自动托管**，JS 只做「引导 + 声明 withCredentials」，与 `musicApi.ts` 现有 `ensureApiSession` 模式一致；**不需要 AsyncStorage 存 cookie**。AsyncStorage 在本项目已有（R1 stores/zustand persist），可作「过期设备指纹/伪设备」这类键值缓存，而非 cookie 本体。

### 1.7 并发 / 限速在 RN 的控制手段

- RN 并发数由 JS 层排队控制（无 `p-limit` 也能手写信号量）；仓库已有 `batchSearch` 的 `concurrency` 模式可复用（R2 §5a）。RN 每个源站请求本就是独立 TCP，连接复用由系统栈自动做。
- **限速主要靠令牌桶 + 退避，纯 JS，两端共享**（R2 §1：axio response 拦截器 + `setTimeout` 退避；RN 无兼容问题）。注意 RN 的 `min()` 批并发阈值：仓库注释「手机网络并发超过 5 后严重劣化」——移动端建议并发上限 ≤ 3–5。
- 原生侧额外手段：OkHttp 换入 `Dispatcher(maxRequests)`/超时；对自签/TLS 握手失败重试一次可经原生 `sslSocketFactory` 做 `rejectUnauthorized=false` 等价物（R2 §1 的桌面 TLS 降级在 RN 需经由原生 trustManager 实现，不能像 Node `https.Agent` 那样 JS 开关）。

### 1.8 能力盘点表

| 能力 | RN 现成可用 | 依赖 | 结论 |
|---|---|---|---|
| UA/普通 header/method/timeout | ✅ | axios/fetch | 直接可用；同名字段 Android 受限 |
| withCredentials 带 cookie | ✅ | `withCredentials=true` | OK；需显式声明（`musicApi.ts:430`） |
| 读 `Set-Cookie` | ❌ | 无效（RN networking 过滤） | 走原生 jar 引导，不读头 |
| 手动 302 逐跳 | ❌ | `maxRedirects` 在 RN 忽略 | 依赖自动跟随 + 兜底（`musicApi.ts:701`） |
| 自定义 TLS 指纹（JA3/JA4） | ❌ | 系统栈基底非 BoringSSL | **结构性不可行**（R2 §4 + cipher-order 证据） |
| 证书 pin / 自签信任面 | ✅(Android 原生)/🟡(iOS TrustKit) | `OkHttpClientProvider.replaceOkHttpClient` / 插桩 | 原生模块，JS 不可达 |
| AES-CBC/CTR/GCM、RSA、SHA、MD5 | ✅ | crypto-js（已用）/ quick-crypto（可选） | 网易/QQ/汽水/酷狗已覆盖 |
| 自定义 DES（酷我） | ❌ | 需手写位运算（quick-crypto 无标准 DES） | 纯 JS 手写，S–M |
| 自定义 XOR 换位（咪咕） | ✅ | 手写循环 <10 行 | R1 §10 S |
| zlib/gzip inflate（酷我歌词） | ✅ | **pako** | `pako.inflate` 自动识别 gzip/zlib |
| gb18030 解码 | ❌→✅ | **iconv-lite**（或 polyfill/原生模块） | S，recommend iconv-lite |
| BigInt RSA（weapi） | ✅ | 已验证（`neteaseWeapi.ts`） | 已过 RN |

---

## 2. 「其他网络方案」：RN 内增强 vs 下沉纯 JS

### 2.1 RN 内增强（原生模块 / OkHttp 拦截器）

**可做清单（按收益排序）：**
1. **OkHttp 拦截器 / 客户端替换**（Android 原生，`OkHttpClientProvider.setOkHttpClientFactory`）：注入自定 `CookieJar`（统一 jar → 与 JS 手动 cookie 打通）、`Dispatcher(maxRequests)` 限并发、`CertificatePinner`、`connect/read` 超时、**自定义 `SSLSocketFactory`（处理自签/信任降级）**。成本 S–M，收益主要是「信任面 + 会话 cookie + 并发」。
2. **JSI 原生模块桥：zlib / gb18030 / AES-CTR**。可写 TurboModule 把原生 `zlib`（Java `java.util.zip` / iOS `libz`）和 GB18030（系统编码）暴露给 JS，速度最快。**成本 M**，收益是替代 pako+iconv-lite。
3. 桥 TLS 指纹：**不可行**（见 1.2），不投入。

**判定**：RN 增强**只解决「信任面/性能/原生编码」，不解决伪装**。若目标是「酷我歌词 zlib+gb18030 在移动端能跑」，pako+iconv-lite JS 就够了，**不值得为它写 JSI 原生模块**；原生模块价值最高的场景是「React Native 的桥」（`musicApi.ts` 已有 `bridgeOrDefaultAdapter`，走 WebView/Chromium 栈）或「需要原生 TLS 信任降级」。

### 2.2 下沉纯 JS（手写 DES / pako / TextDecoder polyfill）

- **pure JS 手写酷我 DES**（`ylzsxkwm`，R1 §5.2）：成本 M，无现成 npm 库，照搬 `kuwoutils.py` 位运算；**任何环境跑**（Node/RN/浏览器）。
- **pako**（zlib/gzip）纯 JS，RN 兼容（1.4）。
- **iconv-lite**（gb18030）纯 JS，RN 兼容（1.5）。
- `TextDecoder('utf-8')` 已在仓库用（`cacheKernel.ts:34`），RN 可用。

**判定**：酷我歌词全链路（XOR+zlib+gb18030）**可整体纯 JS**，无需原生。真正迫使原生的是「酷我 URL 自定义 DES + 播放直连风控」与「酷狗 gateway 设备注册 + 签名」——这些不在纯 JS 能力之外，而是**反过来依赖 TLS/设备反爬**，纯 JS 解决不了（见 R1 §5、§3）。

### 2.3 两方案对照

| | RN 内原生增强 | 下沉纯 JS |
|---|---|---|
| 覆盖 | 信任面/证书 pin/并发/会话 jar/zlib/gb18030(原生) | 加解密/DES/zlib/gb18030/限速/容错 |
| 不可覆盖 | ——（TLS 指纹两者都救不了） | 同上 |
| 成本 | M（TurboModule + 原生 shell） | S（pako+iconv-lite+手写 DES） |
| 与核心复用 | 只加移动端原生壳，`@mplayer/core` 不动 | `@mplayer/core` 全共享 |
| 推荐度 | **仅当需要原生 TLS 信任/桥** | **默认优先** |

---

## 3. 技术栈选项（网络能力视角）

### 选项 ① 保持 RN（+ 原生模块）

- **直连可行性提升**：低–中。网易/汽水/千千/咪咕纯 JS 已可直连；加 pako+iconv-lite 后酷我歌词可直连；酷我 URL、酷狗 gateway 仍需自建 API。
- **TLS 指纹**：不可行（结构性）。
- **迁移成本**：近零（沿用现状）。`@mplayer/core` 100% 复用。
- **共享逻辑复用度**：**最高**——所有源逻辑、`neteaseWeapi.ts`、`cacheManager`、抗爬头全在 core，桌面/移动共用一份。

### 选项 ② Flutter（dart:io HttpClient）

- **直连可行性提升**：与 RN 基本持平——`dart:io HttpClient` 明确「连接重定向/证书由系统 BIO 处理」，`connectionFactory` 只管 socket 创建、`badCertificateCallback` 只管信任判定、`SecurityContext` 只加 CA/客户端证书（primary：Dart API docs）。**没有 JA3/JA4 浏览器指纹 API**。加密能力：官方 `crypto`（SHA/MD5/HMAC，**无 AES/RSA**）需 `pointycastle`（AES/DES/RSA 全有，可做酷我 DES），压缩官方 `archive`（zlib/gzip ✅），GB18030 需 `fast_gbk`/手写表。
- **TLS 指纹**：不可行（同样走系统 BIO；若要 uTLS 级伪装仍需 C FFI，环境内无现成且非官方）。
- **迁移成本**：**最高**——UI/Router/Store/播放器全重写；`@mplayer/core`（TS/axios）**不可复用**，源逻辑要译成 Dart。
- **共享逻辑复用度**：最低（0）。

### 选项 ③ Kotlin (Android) / Swift (iOS) 原生

- **直连可行性提升**：最高。Android：OkHttp 全量可定制（`ConnectionSpec` cipher 列表、`CertificatePinner`、自定 `SSLSocketFactory`、自定 `CookieJar`、`Dispatcher` 并发）、系统 `java.util.zip`（zlib/gzip）、GBK/GB18030 原生 `Charset`、JCA `Cipher`（AES-CBC/CTR/DES）全有。iOS：NSURLSession + 可插桩 pinning；`libz`/`CFStringConvertEncodingToNSStringEncoding`（GB18030）。
- **TLS 指纹**：仍**不可行**（JA3/JA4 冒充 Chrome 需 BoringSSL 级改写，系统栈给不了；除非嵌入自编译 BoringSSL/boringssl-impersonate，成本极高）。若只是做「自定义 cipher 子集 + 证书 pin」→ ✅。
- **迁移成本**：最高——双平台各自 UI/逻辑，`@mplayer/core` 不可复用。
- **共享逻辑复用度**：最低（0）。

### 3.1 三选项对照表

| 维度 | ① RN + 原生模块 | ② Flutter | ③ Kotlin/Swift 原生 |
|---|---|---|---|
| JA3/JA4 指纹伪装 | ❌ | ❌ | ❌（除非嵌入自编译 BoringSSL，成本极高）|
| 证书 pin / 自签信任 | ✅ Android 原生 / 🟡 iOS | 🟡 SecurityContext | ✅✅ |
| zlib/gzip | ✅ pako | ✅ archive/原生 | ✅ 原生 |
| gb18030 | ✅ iconv-lite | 🟡 需第三方 | ✅ 原生 |
| AES-CBC/CTR、RSA、DES | ✅ crypto-js/手写/quick-crypto | 🟡 需 pointycastle | ✅ JCA |
| 酷我/酷狗完整直连 | 差分保留 | 差分保留 | 完全可做（除指纹）|
| `@mplayer/core` 复用 | **100%** | 0 | 0 |
| 迁移成本 | 近零 | **最高** | **最高**（双平台）|
| 见效速度 | 最快（纯 JS 增量） | 慢（平台级重写） | 最慢 |

---

## 4. 结论与 G6 决策推荐

### 4.1 明确推荐（先读）

**维护选项 ①：保持 RN + `@mplayer/core` 纯 JS 直连为主，按需加轻量原生模块。** 同时确认三个事实给 G6：
1. **移动端可直连的源（无需额外投入）**：网易（weapi/歌词/热榜）、汽水（搜索/share/track_v2）、千千（MD5 签名）、咪咕（XOR 解密）——R1 §1/§6/§7/§4 这些**已是纯 JS，RN 原生就能跑**。R6 只是确认其网络面无额外阻塞。
2. **移动端需补两个 S 级 JS 依赖就能用的能力**：`pako`（酷我歌词 zlib/gzip）＋ `iconv-lite`（gb18030）——R1 §5.1 的酷我歌词链（XOR+zlib+gb18030）因此可纯 JS 直连，连原生模块都不必写。可选 `react-native-quick-crypto` 提速汽水 AES-CTR。
3. **移动端结构性留差**（继续走自建 API）：酷我 URL（自定义 DES + 播放直连风控）、酷狗 gateway（设备注册 + 签名）；以及所有源在「面对强 TLS 指纹风控」时的降级——**移动端无 JA3/JA4 伪装手段**，这类源在移动端维持自建 API 是理性选择，不是缺陷。

### 4.2 保守选项（默认采纳）

**保持 RN、接受「部分源在移动端不可直连／继续走自建 API」。** 具体：
- 移动端直连承诺上限 = 网易/汽水/千千/咪咕 + 酷我歌词；酷我 URL 与酷狗 gateway 在移动端**不直连**。
- 直连实现一律落在 `@mplayer/core`（桌面/移动共享），做「`auto`(直连优先→失败回退自建 API)」源开关（对齐 R1 §13.8），避免移动端比桌面少源。
- **不要为了移动端直连切换 Flutter/Kotlin/Swift**：两项都不能带来 JA3/JA4（唯一没能触达的硬墙），却要付出推倒重写 + 丢弃 `@mplayer/core` 的巨大成本——网络能力视角收益为负。

### 4.3 若 G6 决策「务必让 X 源移动端完整直连」

按该源类型选择，优先级从低风险到高风险：
1. **强加密但弱指纹依赖**（酷我 URL 的 DES/AES）：纯 JS 手写位运算即可，**无需换栈**。
2. **强原生编码/信任依赖**（酷狗 gateway 需设备注册 + 原生 jar/TLS 信任）：加 Android OkHttp 客户端替换 + JSI 桥（选项 ① 扩展），**仍不换栈**。
3. **必须完全模拟 Web 反爬（JA3/JA4）**：只能走「移动端内嵌自编译 BoringSSL-impersonate / 或把该源请求经桌面主进程/C 层代理转发」——这是极高成本路线，建议**明确否决**，移动端该源改走自建 API 或 WebView 桥（`musicApi.ts` 已有桥模式）。

### 4.4 与 R2/R1 的口径对齐

- R2 §4「RN 不可做 TLS 指纹」→ 本报告用 cipher-suite-ordering + OkHttp 官方 HTTPS 文档把**机理**说透（移动端 TLS 基底非 BoringSSL、JA3/JA4 需字节级一致），并指出**证书 pin / ConnectionSpec / 自签信任面仍可通过原生模块做**，补 R2 未展开的原生可定制面。
- R1 §10「RN 侧成本显著（zlib/gb18030）」「汽水需 quick-crypto」→ 本报告给出 pako / iconv-lite / quick-crypto 三个具体落点，把成本从「显著/硬骨头」降到 S 级。

---

## 5. 新增依赖建议（移动端，S 成本，仅按需引入）

| 依赖 | 用途 | 何时要 |
|---|---|---|
| `pako` | 酷我歌词 zlib/gzip inflate | 做酷我歌词直连时 |
| `iconv-lite` | 酷我歌词 gb18030 解码 | 同上 |
| `react-native-quick-crypto` | 汽水 m4a AES-CTR 解密 | 做汽水 VIP m4a 离线/完整解码时（R1 §13.2） |
| `@react-native-cookies/cookies` | 显式管理会话 cookie（跨 jar 注入/清理） | 需要把伪设备 cookie 注入 `Cookie` 头时 |
| （可选，原生）`expo-gbk-converter` | GBK/GB18030 原生解码 | 数据量大、性能敏感时替代 iconv-lite |

> 附：以上均**可选增量**。保守基线（保持 RN + 现有 `@mplayer/core`）无需新增任何依赖即可完成网易/汽水/千千/咪咕四源移动端直连。
