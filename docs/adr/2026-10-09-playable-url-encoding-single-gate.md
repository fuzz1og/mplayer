# ADR: 可播 URL 的编码归一落在 core 解析链出口（#622）

- 状态：已接受
- 日期：2026-10-09
- 关联：**#622**（本决策票）· PR #618 的验收评论（真人真机取证：把 `|` 换成 `%7C` 才走通真实 CDN 下载）· 同类「宿主各修一遍」事故见 ADR `2026-10-08-per-source-request-headers.md` 与 #608 取词决策 · 上游 ADR `2026-09-29-native-playback-ownership.md`（Android 主引擎 = media3，URL 由 JS 交给原生）· 术语见 `GLOSSARY.md`（直链编码归一）

## 背景

移动端下载汽水源的歌，`File.downloadFileAsync(url)` 在原生层抛
`The 1st argument cannot be cast to type class java.net.URI`。汽水 CDN 直链的 query 里带着**未编码的 `|`**：

```
https://<soda-cdn>/<sig>/<sig>/video/tos/cn/.../?a=8478&ch=0&cr=5&dr=0&cd=0|0|0|5&br=126&...
```

两个解析器对同一个字符串的判定不同，这才是缺陷能长期潜伏的成因：**WHATWG URL / Chromium / axios 允许 query 出现 `|`**（Node 侧原样发出、CDN 照收，桌面播放与下载都没事），**`java.net.URI` 按 RFC 3986 判它非法**——而 Android 主引擎（media3）与 expo-file-system 都在 JS 的 HTTP 栈之外自己解析 URL。所以「URL 能 fetch」不等于「URL 能交给原生」。

改动面为什么不是「下载调用点补一下」：可播 URL 在本仓有**多个生产者 + 一条旁路**——汽水分享页（`fetchSodaSharePage` 还整条 `decodeURIComponent`，`%7C` 会被它解回 `|`）、track_v2 的 `main_play_url?play_auth=`、`getSodaAudioUrl` 的 10min 内存缓存、`parseSodaShareLink` 写进 `song.url` 的值、tier3 订阅源交回的 URL；桌面 `main/services/downloadService.ts` 更单开一条 soda 分支直接调 `getSodaAudioUrl`，绕开解析链。补在调用点至少要补两处（两端下载服务），并且播放链（ExoPlayer / Howler）一处也吃不到。

## 决策

### 1. 归一实现一份：core `utils/urlEncoding.ts` 的 `normalizeUrlEncoding(url)`

只补 **RFC 3986 排除的字符**（控制字符 / 空格 / `" < > \` ^ { } | \` \\ / 裸的非 ASCII），**不碰 `%`**：`%` 既是合法字符又是转义引导符，动它就把已编码的 `%7C`/`%20` 二次编码成 `%257C`/`%2520`，CDN 签名立刻失效。

「只补非法字符」同时送出三条性质，且都由测试钉住：合法 URL **逐字不变** ⇒ **幂等** ⇒ **不破坏 query 里已工作的转义**。非 ASCII 走 `encodeURIComponent`，多字节按 UTF-8 逐字节转义、代理对不被拆坏。空串原样返回（空 URL 是「没解析出来」，不是「需要编码」）。

### 2. 落点 = 解析链唯一出口 `shared/sourceRouter.ts` 的 `resolveRoutedInner`

两个公开入口（`resolvePlayableSongRouted` 与 `resolvePlayableUrlRouted`）都经这一层，四条腿（直连 / 权威时长 `resolveUrlInfo` / tier3 兜底 / 严格搜索）与**预取缓存命中**也都在这里结算——所以这是「取 URL 的单一落点」的最小充要条件：一处覆盖双端播放 + 双端下载 + 预取，其余五源同样受益（脏 URL 不是汽水的专利）。实现是出口处一次 `{ ...playable, url: normalizeUrlEncoding(playable.url) }`，腿的内部编排不动。

不进 core  barrel 导出：宿主拿不到这个函数，也就没法在宿主侧再归一一次（守卫第 3 条钉它）。

### 3. 桌面下载删掉 soda 旁路

`src/main/services/downloadService.ts` 的 `sourceType === 'soda'` 分支（`song.url` 快路径 + `getSodaAudioUrl` 直调）整段删除，汽水与其余源一样走 `resolvePlayableSongRouted`；`local` 分支保留（那是文件路径，不是 URL）。旁路 = 第二个取 URL 的地方 = 第二份会漂的口径。桌面列表歌的 `url` 自 #171 起恒空，这条分支实际长期只做「重新解析」，删掉后与移动端口径一致。

### 4. 守卫测试（`src/__tests__/downloadUrlEncodingSingleSource.test.ts`，判据只看剥掉注释后的源码）

1. core 生产代码里 `normalizeUrlEncoding` 的**实现恰好一份**、**调用点恰好一处**，且那一处就在 `shared/sourceRouter.ts`；
2. 两条下载链都消费出口（移动端 `resolvePlayableUrlMobile(`、桌面 `resolvePlayableSongRouted(`），桌面源码里不再出现 `getSodaAudioUrl(`；
3. 宿主三个消费文件（移动端下载 / 移动端解析出口 / 桌面下载）不得出现 `normalizeUrlEncoding`、`encodeURI`、`%7C` 任一形状——出现即第二处归一。

行为面的归一测试在 core：`utils/__tests__/urlEncoding.test.ts`（字符集 / 不二次编码 / 幂等 / 合法性判据取 RFC 3986 allowed 集，独立于实现的排除集）+ `shared/__tests__/playableUrlEncoding.test.ts`（四条腿 + 预取命中 + 空 URL 共 6 例）。

## 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| 两个 downloadService 各补一次（票面已明确否决） | 两份口径迟早漂（#608 取词决策就是这么出的事）；播放链一处也吃不到，同一形态的脏 URL 照样进 ExoPlayer |
| 补在汽水 URL 的生产者（`fetchSodaSharePage` / `getSodaAudioUrl` / `sodaDirect.resolveUrlInfo`） | 生产者本来就有三个 + 缓存 + `parseSodaShareLink`，改完仍是多处；tier3 订阅源交回的 URL 修不到；「哪一源脏」会变成一张新的源表要维护 |
| `encodeURI(url)` 一把梭 | 把 `%7C`/`%20` 二次编码成 `%257C`/`%2520`，签名失效——守卫用例对这一版是红的（见 PR 证据） |
| 删掉 `fetchSodaSharePage` 里整条 `decodeURIComponent` | 分享页字段的编码形态不可控，去掉解码只是把脏点挪个位置，还动到 `parseSodaShareLink` 的存量语义 |
| 归一放进 transport / axios 层 | 只证到 JS 的 HTTP 栈这一侧；`java.net.URI` 在栈外（media3、expo-file-system 各自解析），播放链的 URL 还要经原生队列 |

## 后果

- 出口一处 ⇒ 新增源、新增腿、宿主接入都不需要「记得补码」；其他五源带出非法字符时同样被兜住（不回归它们的既有 URL：合法 URL 逐字不变）。
- 代价：每次解析多一次线性正则替换 + 一次浅拷贝，相对网络腿可忽略。`normalizeUrlEncoding` 不进 barrel ⇒ 移动端 Metro 的既有 chunk 不受影响（无新增/改名导出，不需要 `expo start --clear`，见 runtime-verification 陷阱 #576）。
- 已知边界（本笔不修，写清判据）：
  1. **`song.url` 快路径不经出口**——移动端 audioPlayer 的 `audioUrl = song.url` 与桌面主进程 `getSodaPlayableUrl`（IPC 缓存腿，直接 `axios.get`）。两者都只在 JS/Node 栈里发请求，栈自己会转义，不是 `java.net.URI` 那条路；桌面 soda 下载改走出口后也不再有第三条。
  2. **移动端存量资源缓存（12h TTL）里可能还有脏 URL**：活性闸用 JS fetch 判活会放行，一次播放失败后 `fresh` 重试重解析、由出口归一——影响上界是「每个脏条目至多一次失败」，不做批量洗数据。
- 证据层级：归一与出口= 单元（Node，真 core 解析链 + 注入假客户端）；下载链消费出口 = 静态守卫 + 主进程 vitest；**真机 soda 下载 = 已过**（2026-10-10 雷电 emulator-5556 / Android 14 / x86_64 dev build；包身份锚 lastUpdateTime=2026-10-10 00:05:21）：走移动端下载的真实接缝 `resolvePlayableUrlMobile` 取到的直链 `hasRawPipe=false`，`File.downloadFileAsync` 成功落盘；同一台设备、同一会话用未剥到出口的旁腿 `musicApi.getSodaAudioUrl`（返 `hasRawPipe=true`）复现了票面原故障——downloadFileAsync 被原生拒。logcat 原文见 PR #632 验收评论。**仍未覆盖**：CDN 侧字节完整性 / 时长一致性；以及 `musicApi.getSodaAudioUrl` 这条不经出口的残留旁腿（下条）。
- 回退（two-way）：删掉出口那一处调用即回到原状；桌面 soda 分支整段可原样还原。
