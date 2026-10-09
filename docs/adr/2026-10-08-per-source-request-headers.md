# ADR: 每源请求头单点，并让 Android 原生真的发 UA/Referer

- 状态：**代码已落地，取证仍欠**——结构半 PR **#625**（master `729426e`）与行为半 PR **#602**（master `bfe53ec`，2026-10-09）**都已合入 master**；但 #602 合并时下面「合并前必须补齐」那份证据清单**一条都没做完**，那三条至今是开口（见「后果」，不在这里替它圆）。已知边界 3b（服务从快照 restore 的队列不带头）由 issue **#606** / 分支 `fix/606-snapshot-headers` 关闭。
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
- **「media3 的 `DefaultHttpDataSource` 在 302 跟跳后仍会带上这份头」是待验证的断言，不是已取证的事实**：现有受控 probe server 只发 200/206，抓包里**没有任何 302 记录**。**要保留这句话，必须先补一个 302 跳转抓包**；不补则一律按「未验证」读。
- `local` / `file://` 不带头：原生那条 `DefaultDataSource` 会分派到 `FileDataSource`，本来也不消费 HTTP 头。
- Kotlin 侧**无单元测试框架**（`packages/mobile/modules/native-player/android` 只有源码，PR/push 不编译原生，见 `2026-09-29-ci-verification-boundary.md`）：原生这段的验收 = 源码文本守卫 + 真机取证，不假装有单测。
- 注：**#602 不改 Kotlin 逻辑**（只在 `persist()` 留一处边界注释）。Android 开始发头完全由 JS 侧 `headersFor` 从空壳变成取单点达成——原生 `ExpiryGuard` 的注入分支本来就是好的，只是从来没收到过非空的 `headers`。这也让真机 A/B 可以在**原生未重编译**的 dev build 上做（Kotlin 与 master 行为等价）。那条注释指向的边界后来由 #606 改成实现（见 3b）。

### 3b. 已知边界：服务从快照 restore 的队列不带头 —— **已由 #606 关闭**（方向①：快照保留 headers）

`PlayerService.persist()` 落盘前曾对每条 track 写 `put("headers", JSONObject())`——落盘快照里的 headers 被显式清空。于是进程被杀 / 服务重启后，原生按快照 restore 出来的队列没有 per-item UA/Referer（内存态 `TrackRecord` 仍有头）。裸请求窗口就是「restore 后由**原生**直接推进、JS 还没把该曲重新 patch/upsert 回来」的那一段：酷狗/QQ 的 CDN 校验 Referer 域名 → 403 → 触发跳歌护栏。

- **处置（#606，分支 `fix/606-snapshot-headers`）**：`persist()` 不再清空，落盘的正是 `TrackRecord.toJson()` 那份带头的序列化；restore 经 `QueueStore.restoreFrom → TrackRecord.fromJson` 读回，`ExpiryGuard` 在这段窗口里就能拿到 UA/Referer。常态路径（`loadQueue`/`patchQueue`/`upsert`/`insertAfterCurrent`）本就带头，不受影响。
- **为什么走「快照保留 headers」而不是「restore 后强制 JS 重新 upsert 窗口」**：头只有 core `requestHeadersFor` 的静态常量（`BROWSER_UA` + 按源官方域名），**不含凭据、不含 per-session token**，落盘不新增敏感信息（同一份快照本来就存了可播放 URL）；方向②把正确性押在「JS 活着且抢在原生推进之前」，留一个竞态窗口——而 `MediaLibraryService` 重启要防的恰恰就是 JS 不在场。
- **落盘契约是格式变更，但不做版本迁移**：线上旧快照没有 `headers` 键，`fromJson` 用 `optJSONObject` 读 → 缺键得空 map → `ExpiryGuard` 命中 `headers.isEmpty() → return dataSpec` 那条既有分支，与改前行为一致，restore 不会因此抛。
- **验收**：原生无 Kotlin 测试框架、PR 不编译原生（`2026-09-29-ci-verification-boundary.md`），故 #606 的证据是源码文本守卫 `packages/mobile/__tests__/nativeSnapshotHeaders.test.ts` + 本机 gradle 编译通过；**真机杀进程后 restore 立即播严格源（酷狗/QQ）的抓包仍未做**（本机无设备），见「后果」的证据缺口。

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
  - **适用范围**：常态路径（JS 解析后 `loadQueue` / `patchQueue` / `upsert` / `insertAfterCurrent` 投喂的曲目）全部带头；服务从快照 restore 出来、JS 尚未重新投喂的那一段**自 #606 起也带头**（3b 已关闭，仅剩真机抓包待补）。副作用是取证口径变了：「杀进程后立刻续播」不再是「不带头」的对照组，做 A/B 基线时别再用它当裸请求样本。
  - **仍然开口的证据**（原清单标题是「合并前必须补齐」，#602 合并时一条都没做完，故保留原文）：① 真机（能装 CA / 真实出口 IP）；② **可解析的 QQ/酷狗样本各 ≥N 首**的「带头 vs 不带头」成功率对照；③ 若要保留 §3 的 302 断言，补一个 302 跳转抓包。**#606 的快照带头同样欠 ①**——它这半的现成证据只有源码文本守卫与本机 gradle 编译通过。
- **carve-out 的设备证据缺口（来自 #625 验真的残留）**：§2b 那两条 carve-out 改的是 **App 内实际发出的头**（expo-audio 回落路径与内嵌封面），**桌面装置覆盖不到移动端** → 同样**没有设备证据**，需真机复验或显式接受 §2b 的语义。
- **代价 / 风险**：Android 侧从「0 头」变成「带官方 Referer 的浏览器头」，上游风控与成功率是**实测问题不是推理问题**——可能变好（防盗链 CDN 放行）也可能触发更严的风控；因此 A/B 取证与回退路径是决策的一部分。已知边界里 3b（restore 快照不带头）已由 #606 关闭、待真机抓包确认；3c（带上自定义头后 media3 不再发 `Icy-MetaData: 1`）仍在——静态歌无影响、真 ICY 流未验证。**新增落盘面**：快照文件里现在多了每条曲的 UA/Referer（静态常量，无凭据），但 `snapshot` 键的字节数会变大。
- **回退方式（two-way）**：`nativePlayer.ts` 的 `headersFor` 改回 `return undefined`（一行）即回到「Android 0 头」；core 单点与三处调用点保留，结构与单点不受影响。#606 的快照保留**不需要单独回退**——`headers` 一旦变回空 map，落盘写的就是 `{}`，`ExpiryGuard` 仍走 `isEmpty()` 分支，与改前逐字节同构。

## 参考

- 票：**#592**（架构评审 2026-10-07 候选 2；票面「是否让 Android 补头」由人拍板为「补」，但需真机取证）
- 结构半：PR **#625**（已合入 master `729426e`）· 行为半：PR **#602**（已合入 master `bfe53ec`，2026-10-09；**取证清单未先补齐即合并**，欠的证据仍挂在「后果」）· 3b 跟进：issue **#606** / 分支 `fix/606-snapshot-headers`
- 拆分依据：PR #602 的独立复核评论（`issuecomment-6052099056`）
- 上游：`docs/adr/2026-09-29-native-playback-ownership.md`（原生主引擎与队列权威）· `docs/adr/2026-09-29-ci-verification-boundary.md`（原生留发版期）
- 实施入口：`packages/core/src/utils/sourceReferer.ts`（单点）· `packages/mobile/services/nativePlayer.ts`（`headersFor`）· `packages/mobile/modules/native-player/.../ExpiryGuard.kt`（注入）· `.../PlayerService.kt`（落盘快照）· `.../QueueStore.kt`（`TrackRecord` 的 headers 序列化/反序列化，#606）
