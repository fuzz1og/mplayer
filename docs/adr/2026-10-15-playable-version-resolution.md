# ADR: 可播版本解析上收 core——判据唯一，回填由宿主决定

- 状态：已接受
- 日期：2026-10-15
- 关联：**#639**（本决策，C3）· ADR-0012 `2026-09-10-song-identity-and-playable-resource.md`（跨源录音身份与可播资源值语义）· `2026-09-29-stable-shuffle-order.md`（同为「双端语义只留 core 一份」的先例）· GLOSSARY「跨源录音身份」

## 背景

列表页（排行榜 / 推荐 / 热榜 / 歌手）拿到的歌常常**没有可播地址**：直连只做零请求的可播性判定，不预取直链；路由时代换源候选也天生无 url。要播放就得先把地址补上，于是四处页面各写了一遍「缺 url → 搜索 → 播放」：

- `DiscoverPageV2` 用了**精确匹配**守卫，且只回填 url（正确）；
- `RecommendPage` / `HotlistDetailPage` / `ArtistDetailPage` 直接取 `results[0]`，并且用候选**整首顶替**——换掉了歌名、歌手与封面。

后果是一个已经在本仓被记录过的 bug 类：搜索排序差的源（酷我）会播放**同名不同歌手**的歌（如《单车恋人》→ cover 版）。`DiscoverPageV2` 的注释把这条写得很清楚，但另外三处没跟上——**同一个守卫在一处被装了，另三处还在**。

移动端更早收敛过这一步（`packages/mobile/services/songResources.searchStrictMatch`），它的注释写着这是「『热榜第 6 份漏守卫』的通用修复」。也就是说**两端都证明了这个接缝真实存在**（两个 adapter），但它的判据仍分散在两端各一份。

## 决策

1. **判据与搜索端口上收 core**（`shared/playableVersion`）：精确匹配用 core `findExactMatch`，它实现的正是 GLOSSARY「跨源录音身份」——跨源同一性**只靠歌名 + 歌手的文本精确匹配**，时长只能作一致性护栏、不能作证明。
2. **两个导出，两种宿主需要**：
   - `searchPlayableMatch(song, deps) → Song | null`：返回**命中的候选本体**（未命中 / 搜索失败一律 `null`）；
   - `resolvePlayableVersion(song, deps) → { song, searched, matched }`：在它之上**只回填 `url`**。
   分开的理由是宿主的产物不同：桌面「补一个可播版本」只要地址；移动端的资源兜底要同时回填 url 与 lrc（`hotlist` / `SongRow` / 歌词侧共 5 个调用点）。若只留后者，移动端会被迫放弃 lrc 回填；若只留前者，桌面会重复写「只回填 url」这半段。
3. **「只回填」是契约**：命中后 `{ ...song, url: hit.url }`，**歌名 / 歌手 / 封面一律保持用户点的那份**。用候选整首顶替会让用户点的歌在界面上变成另一首——这正是原先三处的行为。
4. **搜索源 = 歌曲自身 `sourceType`**，不写死任何源。歌手页曾写死 `'netease'`；它在「歌手详情只从网易取」时恰好等价（歌曲的 `sourceType` 就是网易打的），但换源后列表里会出现非网易源的歌（换源候选本就无 url，必然走这条分支），拿它去网易搜是错的。
5. **已有地址 → 不发请求**：这是本决策的完成标准之一，省掉一次必然多余的搜索（原先热榜/歌手页即使歌已有 url 也要搜一次，再用结果顶替）。
6. **未命中一律原样返回**，交给播放链的解析与失败归因（`explainPlaybackFailure` + `skipGuard`）：不新增失败路径，也不预先给一句与实际结果无关的提示。
7. **桌面留一个 adapter**（`renderer/services/playableVersionAdapter`），与 `playlistWriteAdapter` 同模式：宿主只提供「怎么搜」（`callMusicApi('searchSongsRouted', …)`）。移动端 `searchStrictMatch` 改为吃 core 内核，**对外签名不变**（5 个调用点零改动）。

## 备选与否决

- **只做桌面、不上收 core**：否决。两端已有两份同义实现，正是这个 bug 类的成因（判据抄了四份、其中三份漏装）。放桌面本地等于再抄一份，只是这次抄得对。
- **只留 `resolvePlayableVersion` 一个导出**：否决。它会把 lrc 回填挤出移动端（或让移动端拿 `resolvePlayableVersion` 的结果再搜一次），为了接口小一号而牺牲一个真实需要。
- **引入 `identityKey` 作为队列身份**：否决（见下）。
- **在 core 里直接发网络请求**：否决。core 的编排一律收端口（与 `songResourceRefresh` / `playlistWrite` 同风格）——零 I/O 才能零 mock 单测。

## 后果

- **正面**：判据一处；桌面四处内联归零、三处「取第一条」的路径消失；歌手页写死源的隐患一并消掉；`resolvePlayableVersion` / `searchPlayableMatch` 可零 mock 单测（不碰 store / 传输层 / IPC）。
- **负面 / 风险**：搜索端口是**函数注入**，宿主忘记接路由搜索（改成只走直连腿）在编译期不报错——与 ADR-0012 的「端口形状即契约」同源风险，靠 code review 与集成测试兜。移动端日志文案由「资源搜索未匹配」改为 core 统一措辞（无测试断言该文本）。
- **不做的事**：不改 `Song` 类型、不动 IPC 契约、不碰解析链时限预算与 tier3。

## 关于「用 identityKey 修重复 id 队列」的否决记录

`#639` R2 起初诊断为「随机序该用 `identityKey` 而不是裸 `Song.id`」。**探针实测否证了这条**：

| 场景 | `applyShuffleOrder` 结果 | 结论 |
|---|---|---|
| 同一首歌的两条重复成员（重复点播） | 3 → **2** | 真 bug |
| 同歌双 id 形态（`456` / `netease:456`） | 3 → 3 | 不重现 |
| 跨源同 rawId（`netease:123` / `kuwo:123`） | 3 → 3 | 不重现 |

关键在于**重复成员的 `identityKey` 按构造就相等**（`netease:123` 出现两次仍是同一个键），换身份口径修不了这个场景；而它能修的两种场景实测本来就不出错。真正的修法是 core `applyShuffleIndexes` 的**位置化（FIFO）匹配**——「序列第 k 个 a」对应「队列第 k 个 a」，从而让 `applyShuffleOrder` 恢复它自己承诺的「与 `queue` 等长」。移动端早已这样绕开（`shuffleMode.shuffleDisplayIndexes` 的注释：「core 是按 id 建 Map 的，重复 id 的队列会少行」），本决策把那份局部实现上收为唯一一份。
