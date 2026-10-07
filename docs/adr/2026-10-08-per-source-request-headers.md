# ADR: 每源请求头单点，并让 Android 原生真的发 UA/Referer

- 状态：已接受
- 日期：2026-10-08
- 关联：**#592**（本决策票，架构评审 2026-10-07 候选 2）· 上游 ADR `2026-09-29-native-playback-ownership.md`（Android 主引擎 = 原生 media3 持队列）· `2026-09-26-outbound-request-governance.md`（出网治理）· `2026-10-04-mobile-download-metadata-boundary.md`（内嵌封面）· 术语见 `GLOSSARY.md`

## 背景

「每源请求头（UA + 按源 Referer）」有两件事同时不对：

1. **结构没有单点**。`BROWSER_UA` 与「源 → 官方 Referer」表在 core `utils/sourceReferer.ts`，但拼装动作散在各宿主：
   - `packages/mobile/services/audioPlayer.ts`（iOS 的 expo-audio 回落路径）手拼 `{ 'User-Agent', 'Referer' }`，未知源还发**空字符串** `Referer`；
   - `packages/mobile/services/downloadService.ts`（内嵌封面）手拼一份，源缺失时兜底成 netease；
   - core `shared/directValidation.ts`（直连腿时长取证）手拼一份；
   - `packages/mobile/services/nativePlayer.ts` 的 `headersFor(song)` 是个**恒 `undefined` 的空壳**。
2. **Android 主引擎这条路上，头实际没被应用**。JS 交出的 `Track.headers` 恒 `undefined` → Kotlin `TrackInput.toRecord()` 得到 `emptyMap()` → `ExpiryGuard.resolve()` 走 `if (record.headers.isEmpty()) return dataSpec` 的分支 → **从不上 `DataSpec.withRequestHeaders`**。即原生侧 `ExpiryGuard` 的「① 注入 per-item UA/Referer」是一条空转的死代码。

也就是说：同一首歌走 iOS（expo-audio + 手拼头）能带 Referer，走 Android（media3）则裸奔——而酷狗/QQ 的 CDN 是**校验 Referer 域名**的（带错或不带都 403），网易云 CDN 宽松。这条差异此前没有任何票或注释记录，只在 #592 的评审里被读出来。

**决策权已由人拍板**（#592 票面原为「结构变更可直接做；是否让 Android 补头待决策」，label `ready-for-human`）：**两半都做**，并要求真机 A/B（改前 / 改后成功率）取证。

## 决策

### 1. core 出单点 `requestHeadersFor(source?: string)`

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

### 2. 所有「每源播放/下载头」的拼装点改取这一份

| 调用点 | 改成 | 备注 |
| --- | --- | --- |
| `packages/mobile/services/nativePlayer.ts` `headersFor(song, url)` | `requestHeadersFor(song.sourceType)` | `local` / `file://` 仍返回 `undefined`（本地字节不发 HTTP） |
| `packages/mobile/services/audioPlayer.ts`（expo-audio） | `requestHeadersFor(song.sourceType)` | 未知源不再发空 `Referer` |
| `packages/mobile/services/downloadService.ts` 内嵌封面 | `requestHeadersFor(song.sourceType)` | 不再兜底 `|| 'netease'`；取图循环归 #575，此处只改请求头 |
| `packages/core/src/shared/directValidation.ts` 直连腿取证 | `requestHeadersFor(song.sourceType)` | 与播放器同源 |

### 3. Android 原生真的开始发头（网络行为变更）

- JS 端 `headersFor` 返回单点的头 → `Track.headers` 非空 → Kotlin `TrackInput.toRecord()` 得到非空 `Map` → `ExpiryGuard.resolve()` 命中 `dataSpec.withRequestHeaders(record.headers)`，**media3 的 `DefaultHttpDataSource` 在 302 跟跳后仍会带上这份头**（`AllowCrossProtocolRedirects` 已开，重定向由它自己重建连接并复制请求头）。
- `local` / `file://` 不带头：原生那条 `DefaultDataSource` 会分派到 `FileDataSource`，本来也不消费 HTTP 头。
- Kotlin 侧**无单元测试框架**（`packages/mobile/modules/native-player/android` 只有源码，PR/push 不编译原生，见 `2026-09-29-ci-verification-boundary.md`）：原生这段的验收 = 源码文本守卫 + 真机取证，不假装有单测。

> 注意：**本票不改 Kotlin 逻辑**（只加一处边界注释）。Android 开始发头完全由 JS 侧 `headersFor` 从空壳变成取单点达成——原生 `ExpiryGuard` 的注入分支本来就是好的，只是从来没收到过非空的 `headers`。这也让真机 A/B 可以在**原生未重编译**的 dev build 上做（Kotlin 与 `master` 行为等价）。

### 3b. 已知边界：服务从快照 restore 的队列仍然不带头（本票不修）

`PlayerService.persist()` 落盘前对每条 track 写 `put("headers", JSONObject())`——**落盘快照里的 headers 被显式清空**。于是进程被杀 / 服务重启后，原生按快照 restore 出来的队列没有 per-item UA/Referer（内存态 `TrackRecord` 仍有头）。

- 影响面：只影响「restore 后由**原生**直接推进、而 JS 还没把该曲重新 patch/upsert 回来」的那一段请求。常态路径（JS 解析 → `loadQueue`/`patchQueue`/`upsert`/`insertAfterCurrent` 投喂）都带头。
- 为什么本票不修：它动的是**落盘契约 + restore 路径的验收**（要真机杀进程复现），面比「每源请求头单点」大；且本票的原生面越薄，A/B 取证越干净。已在 `PlayerService.kt` 的 `persist()` 处留注释指向本节。
- 跟进：单独开票处理（要么让快照保留 headers——UA/Referer 是静态常量、不含凭据；要么在 restore 后强制 JS 重新 upsert 窗口）。

### 4. 队列入口核对（「消除空壳」的一部分）

`Track.headers` 进入原生队列的**每一条**入口都过同一个转换点 `TrackInput.toRecord()`（`PlayerModule.kt:261-274`，`headers = headers ?: emptyMap()`）：

| 入口 | 位置 | 带 headers？ |
| --- | --- | --- |
| `loadQueue`（起播 / 整表） | `PlayerModule.kt:176-185` → `input.tracks.map { it.toRecord() }` | 是 |
| `patchQueue.append`（补窗） | `PlayerModule.kt:187-197` → `input.append?.map { it.toRecord() }` | 是 |
| `patchQueue.upsert`（过期重解析换 URL） | 同上 → `input.upsert?.map { it.toRecord() }` | 是 |
| `patchQueue.insertAfterCurrent`（「下一首播放」#494） | 同上 → `input.insertAfterCurrent?.toRecord()` | 是 |
| `removeKeys` | 不需要（只删） | — |

`PlayerService.loadQueue` / `patchQueue` 收到 `TrackRecord` 后原样交给 `QueueStore`（`store.load` / `store.patch` / `applyInsertAfterCurrent`），全程不重建 record、不丢字段。**没有发现漏投 headers 的入口**；唯一的丢头点是上面 3b 的快照落盘。

### 5. 刻意排除的调用点（语义不同，别顺手合并）

| 调用点 | 为什么不在单点里 |
| --- | --- |
| `packages/core/src/api/audioProbe.ts`（活性闸） | Referer 由 **URL** 推导（`refererForUrl`），且带 QQ 歌词页 / 酷狗 / 酷我歌词端点这类**按 URL 的特例**，与「按源」不是同一回事 |
| `packages/core/src/api/musicApi.ts` 歌词请求 | 同上（`refererForUrl` + 歌词端点特例） |
| `src/main/services/playlistLinkResolver.ts`（桌面短链 302） | 它只跟 `163cn.tv` / `music.163.com` 两个域名的歌单分享重定向，**只有 netease 一种来源**、不涉及播放/下载音频，也没有 Referer 语义；它的 UA 字面量是「桌面主进程请求头」问题，与每源播放头无关（本次不动） |
| 各源 API 客户端（`qqDirect`/`neteaseDirect`/`antiScrape`/`tier3Api` 等） | 那是**接口调用**头（含 UA 轮换、签名、Cookie），不是播放/下载头 |

## 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| **只做结构单点，Android 维持 0 头**（#592 票面的默认选项） | 这正是「评审读出来的空转」被保留的选项：`ExpiryGuard` 的注入分支继续是死代码，Android 与 iOS 行为继续分叉，而用户已拍板两半都做。结构单点本身不产生任何行为收益 |
| **原生自己按 `sourceType` 拼头**（Kotlin 持源表） | 把「源 → Referer」表复制进 Kotlin，跨端两张表必然漂移（#592 的成因之一就是拼装点太多）；且原生拿不到 `Song.sourceType` 之外的语义（未知源判定、`file://` 判定） |
| **用 `DefaultHttpDataSource.Factory.setDefaultRequestProperties()` 在工厂级设默认头** | 一个队列里可以混多个源的歌（换源后的队列），工厂级默认头会把 A 源的 Referer 发给 B 源的 CDN——比不带头更糟。**必须 per-item**，这正是 `ExpiryGuard` 用 `DataSpec.withRequestHeaders` 的原因 |
| **在 ExpiryGuard 之外新增一个 `HeadersDataSource`** | `ResolvingDataSource` 已经是 media3 为「打开前重写 DataSpec」准备的接缝，且过期判定也要在这层做（读前判绝对过期、不发请求）。再加一层会重复同一个接缝 |
| **把空 `Referer` 保留成「显式无 Referer」语义** | 空字符串 `Referer` 不是「不带头」，部分 CDN 会当成畸形头；未知源不带头才是想要的行为。改动同时让三端口径一致 |

## 后果

### 结构变更证明了什么

- 每源头的**唯一事实来源**是 `requestHeadersFor`：源表增删只需改 core 一处；四个调用点不再各拼一份，`nativePlayer.headersFor` 不再是空壳。
- 单测（JS 侧，可指认）：core `utils/__tests__/sourceReferer.test.ts` 覆盖各源 Referer / `wy`·`kg` 形状 / 未知源与 `local` 不带 Referer / 返回新对象；mobile `__tests__/nativePlayerHeaders.test.ts` 断言 `buildTrack` 的 `headers`（含 `local` 与 `file://` 无头）。

### 行为变更（Android 开始发头）证明了什么

- **改前**：Android 主引擎发出的请求带 0 个自定义头（`Track.headers === undefined` → Kotlin `emptyMap()` → `ExpiryGuard` 直接 `return dataSpec`）。
- **改后**：与 `Song.sourceType` 对应的 `User-Agent` + `Referer` 真的出现在请求上（media3 302 跟跳后仍带）。
- **A/B 取证**：由独立队友在模拟器 / 真机上对同一批歌分别跑「改前分支 / 改后分支」，判据（成功率、可复核原始输出）写在 PR 里并附证据；证据形态与失败判定见 PR 的 Evidence 段。**这是本 ADR 唯一的「网络行为变更」验收，不可省**。
- **适用范围**：常态路径（JS 解析后 `loadQueue` / `patchQueue` / `upsert` / `insertAfterCurrent` 投喂的曲目）全部带头；**例外是服务从快照 restore 出来、且 JS 尚未重新投喂的那一段**（3b）。取证时不要用「杀进程后立刻续播」来代表全貌。

### 得到与代价

- **得到**：iOS / Android / 下载三条路径同一份头；未知源不发畸形空 Referer；原生 `ExpiryGuard` 的注入分支从死代码变成活路径（restore 那一段除外，见 3b）。
- **代价 / 风险**：Android 侧从「0 头」变成「带官方 Referer 的浏览器头」，上游风控与成功率是**实测问题不是推理问题**——可能变好（防盗链 CDN 放行）也可能触发更严的风控；因此 A/B 取证与回退路径是决策的一部分。另有一处已知边界未修（3b：restore 快照不带头），它不改变本决策的正常路径结论，但会限制「Android 现在真的发头」这句话的适用范围。
- **回退方式（two-way）**：`nativePlayer.ts` 的 `headersFor` 改回 `return undefined`（一行）即回到「Android 0 头」；core 单点与三处调用点保留，结构与单点不受影响。

## 参考

- 票：**#592**（架构评审 2026-10-07 候选 2；票面「是否让 Android 补头」由人拍板为「补」）
- 上游：`docs/adr/2026-09-29-native-playback-ownership.md`（原生主引擎与队列权威）· `docs/adr/2026-09-29-ci-verification-boundary.md`（原生留发版期）
- 实施入口：`packages/core/src/utils/sourceReferer.ts`（单点）· `packages/mobile/services/nativePlayer.ts`（`headersFor`）· `packages/mobile/modules/native-player/.../ExpiryGuard.kt`（注入）· `.../PlayerService.kt`（快照）
