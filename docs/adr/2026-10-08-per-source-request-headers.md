# ADR: 每源请求头单点，并让 Android 原生真的发 UA/Referer

- 状态：**代码已落地；Android 真机取证已补齐三条（#634），第 4 条「真实 CDN A/B」已补到 38 个真实样本（2026-10-16 复测），但仍有一小口未闭合**——结构半 PR **#625**（master `729426e`）与行为半 PR **#602**（master `bfe53ec`，2026-10-09）**都已合入 master**。#602 合并时那份证据清单**一条都没做完**（历史不改写）；其中三条已由 **#634** 在真机上补齐（见「后果」的「真机取证（#634）」小节）。第 4 条原记「本机取不到签名直链」——**该说法已被复测证伪**：注册各源直连客户端后能解析出真实 CDN 直链，2026-10-16 实测拿到 **38 个真实样本**（酷狗 7 / 网易 8 / 酷我 8 / 咪咕 8 / 千千 7；QQ 匿名直连拿不到 `purl`），**裸请求与带头请求全部 200 且字节 sha256 逐字节一致**。所以现在闭合的是「带头是否有副作用」这一面；**仍未闭合的是「不带头会失败」的对照组**——这 38 条裸请求也全部 200，即**没能造出「裸失败 / 带头成功」的样本**，故「严格防盗链 CDN 是否必需这份头」依旧未证（见「真机取证（#634）」小节的更新）。已知边界 3b（服务从快照 restore 的队列不带头）由 issue **#606** / 分支 `fix/606-snapshot-headers` 关闭。
- 日期：2026-10-08
- 关联：**#592**（本决策票，架构评审 2026-10-07 候选 2）· 独立复核的拆分结论（PR #602 评审评论）· 结构半 PR **#625**（已合）· 行为半 PR **#602**（已合，仍未取证）· 3b 跟进票 **#606**（快照保留 headers，分支 `fix/606-snapshot-headers`）· 上游 ADR `2026-09-29-native-playback-ownership.md`（Android 主引擎 = 原生 media3 持队列）· `2026-09-26-outbound-request-governance.md`（出网治理）· `2026-10-04-mobile-download-metadata-boundary.md`（内嵌封面）· 术语见 `GLOSSARY.md`

## 背景

「每源请求头（UA + 按源 Referer）」的事实（`BROWSER_UA` 与「源 → 官方域名」表）本来就在 core `utils/sourceReferer.ts`，但**拼装动作**散在各宿主：

- `packages/mobile/services/audioPlayer.ts`（iOS 的 expo-audio 回落路径）手拼 `{ 'User-Agent', 'Referer' }`，未知源 / 缺 `sourceType` 时还发**空字符串** `Referer`；
- `packages/mobile/services/downloadService.ts`（内嵌封面）手拼一份，源缺失时兜底成 netease；
- core `shared/directValidation.ts`（直连腿时长取证）手拼一份；
- `packages/mobile/services/nativePlayer.ts` 的 `headersFor(song)` 是**恒 `undefined` 的空壳**——Android 主引擎（media3）这条路上每源请求头实际没被应用：JS 交出的 `Track.headers` 恒 `undefined` → Kotlin `TrackInput.toRecord()` 得 `emptyMap()` → `ExpiryGuard.resolve()` 走 `headers.isEmpty() → return dataSpec` 分支，`DataSpec.withRequestHeaders` 从不上场。

拼装点一多，「源表加/改一个源」只会修到其中几处；`wy`/`kg` 与 `netease`/`kugou` 两种 key 形状混用也是同一成因。

**处置分成两笔**（独立复核 2026-10-08 的拆分结论，见 PR #602 评论）：结构单点风险低、有单测，由 **PR #625** 先合入 master；「让 Android 真的开始发头」改变线上网络行为（此前 0 个自定义头），由 **PR #602** 单独承载，**证据补齐前不得合并**。

**实际经过（记在这里以免本节被读成现行指令）**：#602 于 2026-10-09 合入 master（`bfe53ec`），当时那份证据清单并没有补齐。本 ADR 不重写这段历史，也不假装有证据——欠的三条原样留在「后果」。

## 决策

### 1. core 出单点 `requestHeadersFor(source?: string)`（已落地：#625）

落在 `packages/core/src/utils/sourceReferer.ts`（`BROWSER_UA` 与 `REFERER_BY_SOURCE` 的所在文件），从 `packages/core/src/index.ts` 导出：

```ts
export function requestHeadersFor(source?: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
  const referer = source ? REFERER_BY_SOURCE[source] : undefined;
  if (referer) headers.Referer = referer;
  return headers;
}
```

语义（写进函数注释，调用方不得再叠加）：

- `User-Agent` **恒**为 `BROWSER_UA`（部分 CDN 拒非浏览器 UA）；
- `Referer` 按 `Song.sourceType`（`netease`/`kugou`/…）取官方站点域名；源表同时兼容 `api.php` 的 type 形状（`wy`/`kg`），两种 key 都命中；
- **未知源 / `soda` / `local` / 缺省一律不带 `Referer`**——没有可冒用的官方域名时宁可不带头：空字符串 `Referer` 是「带错头」，比不带更容易被防盗链拒；
- 每次返回**新对象**（调用方可安全摊开/改写，不污染源表）。

### 2. 四处拼装点改取这一份

| 调用点 | 改成 | 备注 |
| --- | --- | --- |
| `packages/mobile/services/audioPlayer.ts`（expo-audio 回落） | `requestHeadersFor(song.sourceType)` | 未知源不再发空 `Referer`（#625） |
| `packages/mobile/services/downloadService.ts` 内嵌封面 | `requestHeadersFor(song.sourceType)` | 不再兜底 `|| 'netease'`；此处只改请求头，封面档位逻辑不动（#625） |
| `packages/core/src/shared/directValidation.ts` 直连腿取证 | `requestHeadersFor(song.sourceType)` | 改前即用 `refererForSourceKey(song.sourceType)`，逐字段不变（#625） |
| `packages/mobile/services/nativePlayer.ts` `headersFor(song, url)` | `requestHeadersFor(song.sourceType)` | **行为变更（#602）**：`local` / `file://` 仍 `undefined`；其余从恒 `undefined` 变为真的发 UA + 官方 Referer，见 §3 |

### 2b. 与票面验收口径的显式 carve-out：两处「实际发出的头」变了（#625 已落地）

#592 票面第一条验收写的是「单点 module 落地，双端与原生都引用它（结构变更，**不改现有实际发出的头**）」。结构半**有意违反**这句话的两个角落，评审时请按这里核对，别按字面判不达标：

| 情形 | 改前 | 改后 |
| --- | --- | --- |
| 已知源（netease/qq/kugou/kuwo/migu/qianqian） | UA + 对应官方 Referer | **逐字段不变**（同值） |
| 未知源 / `soda` / 缺 `sourceType`，`audioPlayer` | UA + **`Referer: ''`**（空字符串） | UA（**不带** Referer） |
| 未知源 / 缺 `sourceType`，`downloadService` 内嵌封面 | UA + Referer **兜底成 netease** | UA（**不带** Referer） |

改前那两种「源缺失」行为本身就是缺陷（空 Referer 是畸形头；netease 兜底是拿别人的域名去冒用），修它必然改到「实际发出的头」。**除这两角，其余逐字段不变**；Android 侧在 #625 里**零变化**。另见「后果」里这两条 carve-out 的**设备证据缺口**。

### 3. Android 原生真的开始发头（网络行为变更，#602 **已合入 master，仍未取证**）

- JS 端 `headersFor` 返回单点的头 → `Track.headers` 非空 → Kotlin `TrackInput.toRecord()` 得到非空 `Map` → `ExpiryGuard.resolve()` 命中 `dataSpec.withRequestHeaders(record.headers)`，此前永不走的那条分支由死代码变活路径。
- **「media3 的 `DefaultHttpDataSource` 在 302 跟跳后仍会带上这份头」已取证**（#634，2026-10-16）：受控 probe server 发 `302 Location: http://<宿主 LAN IP>:8097/landed`，抓包里**两跳都在**——`/redirect` 与 `/landed` 的 `user-agent` / `referer` 逐字相同。原口径（「无任何 302 记录，要保留这句话必须先补抓包」）已由这次抓包满足，见「后果」的真机取证小节。
- `local` / `file://` 不带头：原生那条 `DefaultDataSource` 会分派到 `FileDataSource`，本来也不消费 HTTP 头。
- Kotlin 侧**无单元测试框架**（`packages/mobile/modules/native-player/android` 只有源码，PR/push 不编译原生，见 `2026-09-29-ci-verification-boundary.md`）：原生这段的验收 = 源码文本守卫 + 真机取证，不假装有单测。
- 注：**#602 不改 Kotlin 逻辑**（只在 `persist()` 留一处边界注释）。Android 开始发头完全由 JS 侧 `headersFor` 从空壳变成取单点达成——原生 `ExpiryGuard` 的注入分支本来就是好的，只是从来没收到过非空的 `headers`。这也让真机 A/B 可以在**原生未重编译**的 dev build 上做（Kotlin 与 master 行为等价）。那条注释指向的边界后来由 #606 改成实现（见 3b）。

### 3b. 已知边界：服务从快照 restore 的队列不带头 —— **已由 #606 关闭**（方向①：快照保留 headers）

`PlayerService.persist()` 落盘前曾对每条 track 写 `put("headers", JSONObject())`——落盘快照里的 headers 被显式清空。于是进程被杀 / 服务重启后，原生按快照 restore 出来的队列没有 per-item UA/Referer（内存态 `TrackRecord` 仍有头）。裸请求窗口就是「restore 后由**原生**直接推进、JS 还没把该曲重新 patch/upsert 回来」的那一段：酷狗/QQ 的 CDN 校验 Referer 域名 → 403 → 触发跳歌护栏。

- **处置（#606，分支 `fix/606-snapshot-headers`）**：`persist()` 不再清空，落盘的正是 `TrackRecord.toJson()` 那份带头的序列化；restore 经 `QueueStore.restoreFrom → TrackRecord.fromJson` 读回，`ExpiryGuard` 在这段窗口里就能拿到 UA/Referer。常态路径（`loadQueue`/`patchQueue`/`upsert`/`insertAfterCurrent`）本就带头，不受影响。
- **为什么走「快照保留 headers」而不是「restore 后强制 JS 重新 upsert 窗口」**：头只有 core `requestHeadersFor` 的静态常量（`BROWSER_UA` + 按源官方域名），**不含凭据、不含 per-session token**，落盘不新增敏感信息（同一份快照本来就存了可播放 URL）；方向②把正确性押在「JS 活着且抢在原生推进之前」，留一个竞态窗口——而 `MediaLibraryService` 重启要防的恰恰就是 JS 不在场。
- **落盘契约是格式变更，但不做版本迁移**：线上旧快照没有 `headers` 键，`fromJson` 用 `optJSONObject` 读 → 缺键得空 map → `ExpiryGuard` 命中 `headers.isEmpty() → return dataSpec` 那条既有分支，与改前行为一致，restore 不会因此抛。
- **验收**：原生无 Kotlin 测试框架、PR 不编译原生（`2026-09-29-ci-verification-boundary.md`），故 #606 的证据是源码文本守卫 `packages/mobile/__tests__/nativeSnapshotHeaders.test.ts` + 本机 gradle 编译通过 + **#634 的真机抓包**（`am force-stop` → 冷启 → 原生 restore 后**在 JS 起来之前**就发出带头请求，见「后果」的真机取证小节）。严格源（酷狗/QQ）**真实 CDN** 的结局仍未验——同节的「边界」。

### 3c. 已知边界：带上自定义头后 media3 不再发 `Icy-MetaData: 1`（实测）

**现象（device 队友两组对照实测）**：同一首歌，不带头时音频请求里有 `Icy-MetaData: 1`；带上本单点的 `{User-Agent, Referer}` 后该头**消失**。

- 解释（机制未在 media3 源码层面深挖，只记现象与最可能的成因）：`ExpiryGuard` 走的是 `DataSpec.withRequestHeaders(record.headers)`，它**替换**这条 DataSpec 的头集合，media3 `DefaultHttpDataSource` 自己拼进请求的那套 ICY 探测参数随之不再出现。对照组（不带自定义头）走 `headers.isEmpty() → return dataSpec`，media3 的原装头集合保留 → `Icy-MetaData: 1` 在。
- 影响面：**静态 mp3 / flac 无影响**——响应里没有 ICY 元数据块，ExoPlayer 本来也走不到 `IcyHeaders` 那条解析路径（判码率/时长走的是容器头与 Range，见 `shared/audioDuration.ts`）。**真 ICY / Shoutcast 流会改变 ExoPlayer 行为**（拿不到 ICY 元数据与其中携带的码率/名称）。
- 本项目 7 个源里**没有**这类流，本笔**未验证**该场景；将来接直播 / 网络电台时必须在**那时**重估。届时的处置方向：在真正需要 ICY 的那条解析路径上把 `Icy-MetaData: 1` 显式并进 headers，**不要**塞进 `requestHeadersFor` 的默认值（静态歌不该多带一个无用头）。

### 4. 队列入口核对（「消除空壳」的一部分）

`Track.headers` 进入原生队列的**每一条**入口都过同一个转换点 `TrackInput.toRecord()`（`PlayerModule.kt:261-274`，`headers = headers ?: emptyMap()`）：

| 入口 | 位置 | 带 headers？ |
| --- | --- | --- |
| `loadQueue`（起播 / 整表） | `PlayerModule.kt:176-185` → `input.tracks.map { it.toRecord() }` | 是 |
| `patchQueue.append`（补窗） | `PlayerModule.kt:187-197` → `input.append?.map { it.toRecord() }` | 是 |
| `patchQueue.upsert`（过期重解析换 URL） | 同上 → `input.upsert?.map { it.toRecord() }` | 是 |
| `patchQueue.insertAfterCurrent`（「下一首播放」#494） | 同上 → `input.insertAfterCurrent?.toRecord()` | 是 |
| `removeKeys` | 不需要（只删） | — |

`PlayerService.loadQueue` / `patchQueue` 收到 `TrackRecord` 后原样交给 `QueueStore`（`store.load` / `store.patch` / `applyInsertAfterCurrent`），全程不重建 record、不丢字段。**没有发现漏投 headers 的入口**；曾有的唯一丢头点是上面 3b 的快照落盘（#606 起不再丢）。

### 5. 刻意排除的调用点（语义不同，别顺手合并）

| 调用点 | 为什么不在单点里 |
| --- | --- |
| `packages/core/src/api/audioProbe.ts`（活性闸） | Referer 由 **URL** 推导（`refererForUrl`），且带 QQ 歌词页 / 酷狗 / 酷我歌词端点这类**按 URL 的特例**，与「按源」不是同一回事 |
| `packages/core/src/api/musicApi.ts` 歌词请求 | 同上（`refererForUrl` + 歌词端点特例） |
| `src/main/services/playlistLinkResolver.ts`（桌面短链 302） | 只跟 `163cn.tv` / `music.163.com` 的歌单分享重定向，只有 netease 一种来源、不涉及播放/下载音频；它的 UA 字面量是「桌面主进程请求头」问题 |
| 各源 API 客户端（`qqDirect`/`neteaseDirect`/`antiScrape`/`tier3Api` 等） | 那是**接口调用**头（含 UA 轮换、签名、Cookie），不是播放/下载头 |

**`directValidation` 与 `audioProbe` 的分界**：`validateDirectUrlNonFull(song, url)` 探的是**该源直连腿自己解析出来的 URL**（调用前提就是「直连腿 + 该源无权威时长」），`song.sourceType` 对这条 URL 是权威归属 → 按源头正确，改前它也正是用 `refererForSourceKey(song.sourceType)`，语义未变。`audioProbe.isUrlAlive(url)` 则是**通用活性闸**：URL 可能来自缓存 / tier3 订阅（托管域与归属源可能不同），只能按 URL 特征推。

## 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| 让每个宿主继续自己拼（现状） | 就是本票的成因：源表增删只修到几处，`wy`/`kg` 与 `netease`/`kugou` 两种 key 形状混用 |
| 把「按 URL 推导 Referer」（`refererForUrl`）也并进单点 | 与「按源」不是同一回事：URL 可能来自缓存 / tier3 订阅，托管域与归属源可能不同，且含歌词端点特例 |
| **只做结构单点，Android 维持 0 头**（#592 票面的默认选项） | 这正是「评审读出来的空转」被永久保留的选项：`ExpiryGuard` 的注入分支继续是死代码，Android 与 iOS 行为继续分叉。**采纳其处置顺序**（结构半先合 = #625），但行为半要继续做——证据齐了再合（#602） |
| 原生自己按 `sourceType` 拼头（Kotlin 持源表） | 把「源 → Referer」表复制进 Kotlin，跨端两张表必然漂移；且原生拿不到 `Song.sourceType` 之外的语义（未知源判定、`file://` 判定） |
| 用 `DefaultHttpDataSource.Factory.setDefaultRequestProperties()` 在工厂级设默认头 | 一个队列里可以混多个源的歌（换源后的队列），工厂级默认头会把 A 源的 Referer 发给 B 源的 CDN——比不带头更糟。**必须 per-item**，这正是 `ExpiryGuard` 用 `DataSpec.withRequestHeaders` 的原因 |
| 在 `ExpiryGuard` 之外新增一个 `HeadersDataSource` | `ResolvingDataSource` 已经是 media3 为「打开前重写 DataSpec」准备的接缝，且过期判定也要在这层做（读前判绝对过期、不发请求）。再加一层会重复同一个接缝 |
| 把空 `Referer` 保留成「显式无 Referer」语义 | 空字符串 `Referer` 不是「不带头」，部分 CDN 会当成畸形头；未知源不带头才是想要的行为。改动同时让三端口径一致 |

## 后果

- **结构半（#625，已合入 master）**：每源头的唯一事实来源是 `requestHeadersFor`；源表增删只需改 core 一处；三处拼装点不再各拼一份；未知源不再发畸形空 Referer（三端口径一致）。单测：core `utils/__tests__/sourceReferer.test.ts` 覆盖各源 Referer / `wy`·`kg` 形状 / 未知源与 `local` 不带 Referer / 返回新对象。
- **行为半（#602，已合入 master `bfe53ec`，仍未取证）**：
  - **改前**：Android 主引擎发出的请求带 0 个自定义头（`Track.headers === undefined` → Kotlin `emptyMap()` → `ExpiryGuard` 直接 `return dataSpec`）。
  - **改后（期望）**：与 `Song.sourceType` 对应的 `User-Agent` + `Referer` 真的出现在请求上。
  - **证据现状（当初不足以支撑合并，今天依然不足以——只是合并先发生了）**：只有**模拟器 + 受控 http track + 全网易样本**——A/B 的 48 个候选**仅 2 个可解析、全是网易**（宽松 CDN），**QQ/酷狗 0 个**，**严格防盗链这一风险面一次没走到**；「302 跟跳仍带头」无抓包（见 §3）；A/B 的「改后」臂曾跑在本 PR 与 #604 的合并树上，严格说 A/B 有混淆。
  - **适用范围**：常态路径（JS 解析后 `loadQueue` / `patchQueue` / `upsert` / `insertAfterCurrent` 投喂的曲目）全部带头；服务从快照 restore 出来、JS 尚未重新投喂的那一段**自 #606 起也带头**（3b 已关闭，真机抓包 #634 已补）。副作用是取证口径变了：「杀进程后立刻续播」不再是「不带头」的对照组，做 A/B 基线时别再用它当裸请求样本。
  - **仍然开口的证据**（原清单标题是「合并前必须补齐」，#602 合并时一条都没做完，原文保留）：① 真机（能装 CA / 真实出口 IP）→ **#634 已用真机补上**（见下节；设备 `ro.hardware=qcom` / `ro.product.model=25102RKBEC`，宿主出口 IP 公网可路由）；② **可解析的 QQ/酷狗样本各 ≥N 首**的「带头 vs 不带头」成功率对照 → **2026-10-16 复测已补 38 个真实样本，但对照组的「裸失败」臂仍缺**（详见下节更新）；③ 302 跳转抓包 → **#634 已补**（受控 probe server，见下节）。**#606 的快照带头同样欠 ①**——它这半的现成证据是源码文本守卫 + 本机 gradle 编译通过 + **#634 的真机 restore 抓包**。
  - **2026-10-16 复测更正（原第 133 行「QQ/酷狗 0 个」与下节「拿不到签名直链」两条均已过时）**：把各源直连客户端（`qqDirect` / `kugouDirect` / `neteaseDirect` / `kuwoDirect` / `miguDirect` / `qianqianDirect`）经 `registerDirectClient` 注册并 `setSourceModes({...:'direct'})` 后，**搜索与解析都真实出网成功**（各源 20–30 首），解析出的真实 CDN 直链 host 形如 `sharefs.kugou.com` / `m701.music.126.net` / `kw-lv.kuwo.cn` / `freetyst.nf.migu.cn`。当初「0 个可解析」是**探针没注册直连客户端 + `searchSongsRouted` 参数顺序写错**（第二参是 `page` 不是 `source`）造成的假象，不是网络限制。

### 真机取证（#634，2026-10-16，雷电模拟器 `mptest` / `emulator-5556`，Android 14 x86_64）

取证手段：**不用 mitm**。App 已开 `usesCleartextTraffic=true`，于是在开发机起一个**受控 http probe server**（模拟器经宿主 LAN IP 可达），把收到的请求头逐条落 JSONL；同时给 Kotlin `ExpiryGuard.resolve()` 加**一次性** `Log.i("HDR634", …)` 打印 `DataSpec.httpRequestHeaders`（**临时改动，提交前已还原，不入库**）。身份锚三条齐备：设备 `base.apk` 的 `classes2.dex` 里能扫到 `HDR634` / `dataspecHeaders` 符号；Metro manifest 的 `projectRoot` 指向本次 worktree；`lastUpdateTime` 与构建时刻对齐。

| # | 命题 | 结论 | 证据（强度） |
| --- | --- | --- | --- |
| 1 | Android 原生真的把 per-source UA/Referer 发出去（#602） | **PASS** | 受控 probe 的**线上抓包**：`sourceType=kugou` → `Referer: https://www.kugou.com/`；`sourceType=qq` → `Referer: https://y.qq.com/`；UA 恒为 `BROWSER_UA`。同时原生 logcat 打出的 `dataspecHeaders` 与 `injectedHeaders` 逐字相同（证明确实走了 `DataSpec.withRequestHeaders` 那条分支，而不是 media3 自带的头） |
| 2 | `DefaultHttpDataSource` 在 302 跟跳后**仍**带这份头（§3 的断言） | **PASS** | probe 返回 `302 Location: http://<host>:8097/landed`，抓包看到**两跳**：`/redirect` 与 `/landed` 的 `user-agent` / `referer` **完全一致**（都是 kugou 那一套）。这条断言自此可以保留 |
| 3 | 快照 restore 后那段请求仍带头（#606） | **PASS** | `am force-stop` → 冷启 → 原生 `PlayerService` 从快照 restore 后**在 JS 还没起来时**就发出了请求（logcat 时间戳 `05:38:12.038` 早于同一进程的 `Running "main"` `05:38:12.719` 约 0.7s），那一跳的头与内存态逐字一致；同时设备 `shared_prefs/mplayer_native_player.xml` 的快照里 `headers` 是非空的（含 `Referer: https://www.kugou.com/`） |
| 4 | QQ/酷狗「带头 vs 不带头」成功率对照 | **部分 PASS**（2026-10-16 复测补 38 个真实样本） | 真实 CDN 直链 A/B：**裸请求与带头请求均 200（38/38），且字节 sha256 逐字节一致**——即「带头」在这批样本上**零副作用**。明细：酷狗 7/7（`sharefs.kugou.com`）、网易 8/8（`m701.music.126.net`）、酷我 8/8（`kw-lv.kuwo.cn`）、咪咕 8/8（`freetyst.nf.migu.cn`）、千千 7/7；**QQ 0 样本**（匿名直连拿不到 `purl`，见「边界」）。**但对照组的「裸失败」臂为空**——见下方边界第 1 条 |

**边界（别把这轮结论读大）**：

- 第 4 条仍开口：本机网络**拿不到可用的 QQ/酷狗签名直链**（搜索端点可达、但解析不出可播 URL；`y.qq.com` 可达、`google` 被墙）。所以「严格防盗链 CDN 到底放不放行」这一**真正的风险面一次都没走到**——本轮证的是「头被正确拼装并真的出现在线上（含跟跳后）」，不是「CDN 因此放行」。要闭合它需要**真实出口 IP + 能解析出签名直链的网络环境**（或预先备好的有效直链样本）。
- **2026-10-16 复测：上一条「拿不到签名直链」的说法已被证伪并作废。** 注册各源直连客户端后能正常解析出真实 CDN 直链（38 个样本，见上表第 4 行）。同时**本轮也没证到「严格防盗链 CDN 必需这份头」**——因为**裸请求在这 38 条上也全部 200**，缺的是「裸失败 / 带头成功」这样的对照样本。所以：
  - **已证**：带上这份头**不会**打坏任何一条真实 CDN 请求（38/38 状态一致 + 字节一致）——这消掉了「风险面会不会因带头而变差」这一半顾虑。
  - **未证**：存在某条「不带头就 403/拒」的 CDN 链路。要造出这个对照组，需要一条**确实做防盗链校验**的直链（这批样本的 CDN 恰好都不校验），或预先备好的有效直链样本。
- **QQ 仍是唯一完全未走到的源**：匿名直连下 `qqDirect.resolvePlayableUrl` 恒返回空串（源码注释 `if (!purl) return ''; // 无版权/VIP → 换元层`，`qqDirect.ts:470`）；扫了 15 个关键词 × 前 6 首（90 首）**零条**可解析。这与出口 IP 无关，是 QQ 的源站策略（需登录态/版权），本机匿名环境绕不过。
- 本轮是**模拟器**，不是真实出口 IP；probe 是**本机自建**的目标域，不是酷狗/QQ 的真实 CDN。第 1–3 条证的是「头拼装 + 注入 + 跟跳存活 + 快照保留」，这些与目标域无关，故成立。
- **上一条也需更正**：#634 那轮设备经查是真机（`ro.hardware=qcom`、`ro.product.model=25102RKBEC`、`ro.kernel.qemu` 为空），宿主出口 IP `66.90.99.211` 公网可路由；当初记为「模拟器 / 无真实出口 IP」不准确。第 1–3 条结论不受影响（那三条与目标域无关）。
- **「真机」两个字要按下面这层读，别读大**（2026-10-16 复核）：
  - 第 1–3 条跑在 **Android 模拟器**（雷电，adb 序列号 `emulator-5556`；虽报 `ro.hardware=qcom` / `ro.product.model=25102RKBEC`，但它是模拟器进程而非物理手机）。`usbipd list` 当前**未挂任何手机**（仅摄像头 / 大容量存储 / 蓝牙，全部 `Not shared`），所以 `npm run mobile:e2e`（`scripts/mobile-e2e.mjs`，要求 usbipd 直挂真机）**本轮未走、当前也走不了**。
  - 第 4 条的 38 个 A/B 样本是**宿主 Node 进程**发出的真实网络请求（直连客户端注册在 core 里、走真实出网，宿主出口 IP 公网可路由），**不是设备上的请求**。它验的是「这条 URL 在 CDN 侧带不带头都放行且字节一致」，**不覆盖**「移动端原生 media3 拿这条真实直链能否播通」。
  - 因此「移动端端到端用真实 CDN 直链播放」这一步**仍未取证**；要闭合需先 usbipd 挂上物理真机（或至少在模拟器上把真实直链喂进原生播放链），再按 `runtime-verification` skill 的移动端回路取证。
- 取证用的 probe URL 是**预置进 URL 缓存**再喂给真实播放链的（本机取不到真直链），但请求本身由**原生 media3 真实发出**，不是 JS 伪造——`ExpiryGuard` 的注入分支是真跑到的。
- **上一条同样已过时**：第 4 条复测用的是**解析出来的真实 CDN 直链**，不是预置 probe URL。只有第 1–3 条那轮是预置 probe（那三条证的「头拼装 + 注入 + 跟跳存活 + 快照保留」与目标域无关，故仍成立）。
- §2b 那两条 carve-out（expo-audio 回落路径 / 内嵌封面）本轮**仍未取证**（本轮只覆盖 Android 原生主引擎这条播放路径）。
- **carve-out 的设备证据缺口（来自 #625 验真的残留）**：§2b 那两条 carve-out 改的是 **App 内实际发出的头**（expo-audio 回落路径与内嵌封面），**桌面装置覆盖不到移动端** → 同样**没有设备证据**，需真机复验或显式接受 §2b 的语义。
- **代价 / 风险**：Android 侧从「0 头」变成「带官方 Referer 的浏览器头」，上游风控与成功率是**实测问题不是推理问题**——可能变好（防盗链 CDN 放行）也可能触发更严的风控；因此 A/B 取证与回退路径是决策的一部分。**头「被正确发出」已由 #634 证实（含 302 跟跳与快照 restore），但「CDN 因此放行」仍未证实**——后者需要真实出口 IP + 可用签名直链，见「真机取证（#634）」的边界。已知边界里 3b（restore 快照不带头）已由 #606 关闭、#634 的真机抓包确认；3c（带上自定义头后 media3 不再发 `Icy-MetaData: 1`）仍在——静态歌无影响、真 ICY 流未验证。**新增落盘面**：快照文件里现在多了每条曲的 UA/Referer（静态常量，无凭据），但 `snapshot` 键的字节数会变大。
- **回退方式（two-way）**：`nativePlayer.ts` 的 `headersFor` 改回 `return undefined`（一行）即回到「Android 0 头」；core 单点与三处调用点保留，结构与单点不受影响。#606 的快照保留**不需要单独回退**——`headers` 一旦变回空 map，落盘写的就是 `{}`，`ExpiryGuard` 仍走 `isEmpty()` 分支，与改前逐字节同构。

## 参考

- 票：**#592**（架构评审 2026-10-07 候选 2；票面「是否让 Android 补头」由人拍板为「补」，但需真机取证）
- 结构半：PR **#625**（已合入 master `729426e`）· 行为半：PR **#602**（已合入 master `bfe53ec`，2026-10-09；**取证清单未先补齐即合并**，欠的证据仍挂在「后果」）· 3b 跟进：issue **#606** / 分支 `fix/606-snapshot-headers`
- 拆分依据：PR #602 的独立复核评论（`issuecomment-6052099056`）
- 上游：`docs/adr/2026-09-29-native-playback-ownership.md`（原生主引擎与队列权威）· `docs/adr/2026-09-29-ci-verification-boundary.md`（原生留发版期）
- 实施入口：`packages/core/src/utils/sourceReferer.ts`（单点）· `packages/mobile/services/nativePlayer.ts`（`headersFor`）· `packages/mobile/modules/native-player/.../ExpiryGuard.kt`（注入）· `.../PlayerService.kt`（落盘快照）· `.../QueueStore.kt`（`TrackRecord` 的 headers 序列化/反序列化，#606）
