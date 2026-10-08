# ADR: 每源播放/下载请求头出 core 单点

- 状态：已接受（**只覆盖结构单点**；#592 的另一半「让 Android 原生真的开始发头」是网络行为变更，**未取证、不在本 ADR 范围**）
- 日期：2026-10-08
- 关联：**#592**（本决策票，架构评审 2026-10-07 候选 2）· 独立复核的拆分结论（PR #602 评审评论）· 上游 ADR `2026-09-29-native-playback-ownership.md`（Android 主引擎 = 原生 media3 持队列）· `2026-09-26-outbound-request-governance.md`（出网治理）· `2026-10-04-mobile-download-metadata-boundary.md`（内嵌封面）· 术语见 `GLOSSARY.md`

## 背景

「每源请求头（UA + 按源 Referer）」的事实（`BROWSER_UA` 与「源 → 官方域名」表）本来就在 core `utils/sourceReferer.ts`，但**拼装动作**散在各宿主：

- `packages/mobile/services/audioPlayer.ts`（iOS 的 expo-audio 回落路径）手拼 `{ 'User-Agent', 'Referer' }`，未知源 / 缺 `sourceType` 时还发**空字符串** `Referer`；
- `packages/mobile/services/downloadService.ts`（内嵌封面）手拼一份，源缺失时兜底成 netease；
- core `shared/directValidation.ts`（直连腿时长取证）手拼一份；
- `packages/mobile/services/nativePlayer.ts` 的 `headersFor(song)` 是**恒 `undefined` 的空壳**——Android 主引擎（media3）这条路上每源请求头实际没被应用：JS 交出的 `Track.headers` 恒 `undefined` → Kotlin `TrackInput.toRecord()` 得 `emptyMap()` → `ExpiryGuard.resolve()` 走 `headers.isEmpty() → return dataSpec` 分支，`DataSpec.withRequestHeaders` 从不上场。

拼装点一多，「源表加/改一个源」只会修到其中几处；`wy`/`kg` 与 `netease`/`kugou` 两种 key 形状混用也是同一成因。

**本笔只处置「结构性单点」。** 上面第四行的空壳**保持现状不动**：让 Android 真的开始发 UA/Referer 会改变线上网络行为（此前 0 个自定义头），正是票面标为「⚠️ 需决策、勿擅自」的那一半，需要真机 A/B 取证（见「后果」）。

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

### 2. 三处拼装点改取这一份

| 调用点 | 改成 | 备注 |
| --- | --- | --- |
| `packages/mobile/services/audioPlayer.ts`（expo-audio 回落） | `requestHeadersFor(song.sourceType)` | 未知源不再发空 `Referer` |
| `packages/mobile/services/downloadService.ts` 内嵌封面 | `requestHeadersFor(song.sourceType)` | 不再兜底 `|| 'netease'`；此处只改请求头，封面档位逻辑不动 |
| `packages/core/src/shared/directValidation.ts` 直连腿取证 | `requestHeadersFor(song.sourceType)` | 改前即用 `refererForSourceKey(song.sourceType)`，逐字段不变 |

**未改（本笔明确不动）**：`packages/mobile/services/nativePlayer.ts` 的 `headersFor` 仍恒 `undefined`——**Android 实际发出的头与本笔之前完全一致**（0 个自定义头）。

### 2b. 与票面验收口径的显式 carve-out：两处「实际发出的头」变了

#592 票面第一条验收写的是「单点 module 落地，双端与原生都引用它（结构变更，**不改现有实际发出的头**）」。本笔**有意违反**这句话的两个角落，评审时请按这里核对，别按字面判不达标：

| 情形 | 改前 | 改后 |
| --- | --- | --- |
| 已知源（netease/qq/kugou/kuwo/migu/qianqian） | UA + 对应官方 Referer | **逐字段不变**（同值） |
| 未知源 / `soda` / 缺 `sourceType`，`audioPlayer` | UA + **`Referer: ''`**（空字符串） | UA（**不带** Referer） |
| 未知源 / 缺 `sourceType`，`downloadService` 内嵌封面 | UA + Referer **兜底成 netease** | UA（**不带** Referer） |

改前那两种「源缺失」行为本身就是缺陷（空 Referer 是畸形头；netease 兜底是拿别人的域名去冒用），修它必然改到「实际发出的头」。**除这两角，其余逐字段不变**；Android 侧本笔**零变化**。

### 3. 刻意排除的调用点（语义不同，别顺手合并）

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
| 顺手把 `nativePlayer.headersFor` 也接上单点 | 那是**网络行为变更**（Android 从 0 头到带头），票面明写「需决策、勿擅自」；且现有取证不足以支撑（见下）。**本笔不做** |
| 原生自己按 `sourceType` 拼头（Kotlin 持源表） | 把「源 → Referer」表复制进 Kotlin，跨端两张表必然漂移；且原生拿不到 `Song.sourceType` 之外的语义（未知源判定、`file://` 判定）。**本笔不涉及原生**，此条留给后续那笔 |

## 后果

- **得到**：每源头的唯一事实来源是 `requestHeadersFor`；源表增删只需改 core 一处；三处拼装点不再各拼一份；未知源不再发畸形空 Referer（三端口径一致）。
- **单测**（JS 侧，可指认）：core `utils/__tests__/sourceReferer.test.ts` 覆盖各源 Referer / `wy`·`kg` 形状 / 未知源与 `local` 不带 Referer / 返回新对象。
- **本笔不改动的部分，以及它的取证状态**（写清以免被误读成「已定论」）：
  - Android 主引擎**仍然 0 头**：`headersFor` 恒 `undefined`，`ExpiryGuard` 的注入分支仍空转；
  - 「Android 到底发什么头 / 该不该发」**仍无定论**：现有取证只有**模拟器 + 受控 http track + 全网易样本**（48 候选仅 2 可解析，QQ/酷狗 0 个），**严格防盗链这一风险面一次没走到**；
  - 「media3 在 302 跟跳后仍带头」这条断言**目前无抓包证据**（受控 probe server 只发 200/206）。要保留它必须补一个 302 跳转抓包——**本 ADR 不作此断言**。
  - 后续若要合入行为变更，至少需要：① 真机（能装 CA / 真实出口 IP）；② 可解析的 QQ/酷狗样本各 ≥N 首的「带头 vs 不带头」成功率对照；③ 若要保留 302 断言，补 302 抓包。
- **回退方式（two-way）**：三处调用点回退即回到「各宿主自己拼」；本笔不改变 Android 发送的任何头。

## 参考

- 票：**#592**（架构评审 2026-10-07 候选 2；票面「是否让 Android 补头」**待决策**）
- 上游：`docs/adr/2026-09-29-native-playback-ownership.md`（原生主引擎与队列权威）· `docs/adr/2026-09-29-ci-verification-boundary.md`（原生留发版期）
- 实施入口：`packages/core/src/utils/sourceReferer.ts`（单点）· 上述三处调用点
