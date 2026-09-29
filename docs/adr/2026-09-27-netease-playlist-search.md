# 网易歌单搜索：`cloudsearch/pc` `type=1000` + `searchArtists` 迁腿

日期：2026-09-27 · 状态：已接受 · 关联：**#415**（本决策票）、#126（各源 cookie 必需性）、#408（出网治理）、#409（列表不内联歌词）
依据：[`docs/research/2026-09-25-netease-playlist-search.md`](../research/2026-09-25-netease-playlist-search.md)（2026-09-25 匿名线上实测，16 条端点矩阵 + 字段映射表 + 三组限流观测，零 Cookie / 零登录 / 零签名）

## 背景

搜索页（桌面 `DiscoverPageV2` / 移动端 `(tabs)/search.tsx`）的二级 tab 只有「单曲 / 歌手」，用户无法按关键词找**歌单**。网易云本身有独立的歌单搜索能力，本仓此前没有接：既有的 `getPlaylists` 是歌单**广场分类列表**（`/api/playlist/list`，无关键词）、`getRecommendedPlaylists` 是个性化推荐，三者能力不重叠。

调研确认可行且**完全匿名**：`POST https://music.163.com/api/cloudsearch/pc`，form `s=<kw>&type=1000&limit=&offset=` —— 这与仓库现有 `searchSongs`（同文件 `CLOUDSEARCH_URL`，现用 `type:'1'`）**是同一条腿**，复用既有 `transport.request` 接缝与既有头即可，无需新增签名/加密/请求头。返回字段与 `DiscoverPlaylist` 1:1 可映射，不需要新类型。

同时记录一个既有弱点（非高频路径）：`searchArtists` 走明文 `GET /api/search/get/web?type=100`，命中非 200（`405`/罕见 `500`）时 `catch` 后**静默 `return []`**——「被限流」与「真没这个歌手」在 UI 上不可区分，歌手 tab 显示「未找到」而非错误。

## 决策

1. **契约：可选内容方法 `searchPlaylists?`（含两处对 issue 原文签名的偏离，理由内联）。**
   - `DirectSourceClient.searchPlaylists?: (keyword: string, limit: number, offset?: number) => Promise<{ playlists: DiscoverPlaylist[]; total: number; more: boolean }>`
   - **偏离 a —— 增加 `offset`（默认 0）**：issue 原文写 `(keyword, limit)`，但该端点**不返回 `hasMore`**，翻页终止只能用 `offset + limit < playlistCount` 推导。没有 offset 就没有可测的翻页语义，也没有「越界 = 到底」这条边界可断言。core 内部对 `offset` 只做 `>= 0` 归一，不做上限钳制（越界由上游返回 `playlistCount=0` 表达，见决策 3）。
   - **偏离 b —— 返回 `{ playlists, total, more }` 而非裸数组**：与同文件同族的 `getPlaylists` 返回形状**逐字一致**（`{ playlists, total, more }`）。`more` 是 `offset + limit < playlistCount` 的唯一落点：只返回数组会让验收项「分页终止：用 `offset + limit < playlistCount` 推导」无处安放，消费端只能靠「不足一页 = 到底」猜（弱关键词回退会打破这个猜法）。
   - `CONTENT_METHODS` 登记 `'searchPlaylists'`（`satisfies readonly (keyof DirectSourceClient)[]` 保证漏登记 = 编译期报错）；桌面 IPC 契约（`src/shared/musicApiContract.ts` 自接口派生、`src/main/ipc/musicApiHandlers.ts` 按清单循环分派）**零手写改动**。未实现该能力的源走既有统一错误「源 X 未实现内容能力 searchPlaylists」。
2. **请求腿 = `POST https://music.163.com/api/cloudsearch/pc`**，form `s/type=1000/limit/offset`，复用既有 `CLOUDSEARCH_URL` 常量、`transport.request` 接缝、`getUserAgent('netease')` 与 Referer/accept/content-type 头。**不新增签名、不新增加密、不新增请求头**（与 `searchSongs` 的头集合逐字一致，有测试断言）。
3. **参数边界（core 内部收口，不交给上游表达）**：
   - `limit` 钳制到 `[1, 100]` —— 上游 `limit>100 → code=400`，钳制让该 400 在正常路径上不可达；
   - 空关键词（含纯空白）**本地拒绝并抛可区分错误**，零请求 —— 上游对空 `s` 也是 `code=400`，本地拒绝省一次请求且错误语义更明确；
   - `offset` 越界：上游 `code=200` 但 `playlistCount=0, playlists=[]` → `{ playlists: [], total: 0, more: false }`，**视为到底，不是错误**（不抛错、不当失败弹窗）；
   - 非 200 的 `code` 一律抛错并带上 code 原文（`405/406 操作频繁`、`400` 参数、`500`），**不再静默空数组**。
4. **缓存（注入的 `ContentCache`，与同文件其他内容腿同一接缝）**：key 含关键词 + limit + offset，TTL **6h**（`SEARCH_TTL_MS`，与搜索/歌手同档）；**空结果不缓存**——瞬时故障与「越界到底」都不该占 6h，保留下次自愈（与 `getPlaylistSongs`/`getAlbumDetail` 既有的「空结果不缓存」取向一致）。
5. **单飞（core 侧，按缓存 key 去重同键并发）**：与 `tier3Inflight` 同取向——底层 promise 结算后才出表。放在客户端而不是 UI，是因为两端调用面不同但**上游只有一个**：桌面经 IPC 落在主进程的同一客户端实例、移动端在进程内，两端都真正只打一发。
6. **懒加载（UI 层）**：双端搜索页新增第三个二级 tab「歌单」，**只有切到该 tab 才发请求**。理由：`cloudsearch/pc` **已是搜索页在用的腿**（关键词变化时网易打 1 发搜索），若歌单搜索也随关键词无条件再打一发，等于把该腿每页请求数翻倍——而这正是调研里被反复强调要避免的（该腿属网易明文风控面，见 #408）。
7. **`searchArtists` 迁到同一条腿 `type=100`**（issue 的「可选硬化」，本次做）。选择「迁腿」而不是「另加可区分失败语义」，因为迁腿**一次改动同时满足两个目标**：① 离开「突发即封」的 `GET /api/search/get/web`（该腿是调研里唯一被实测封禁的腿），② 迁移后走与歌单/单曲同一份 `code !== 200 → 抛错` 逻辑，「405/406 被限流」与「code=200 但没有这个歌手」**天然可区分**，不需要额外发明错误类型。实测 `type=100` 匿名可用（`artistCount=83`）。
8. **空态文案区分**：发现页一级「歌单」= 广场分类列表，搜索页二级「歌单」= 关键词搜索。搜索结果页的歌单空态明确指向歌单广场（`PlaylistPageGrid` 增可选 `emptyText`），避免用户以为两者等价。

## 备选与否决

- **`GET /api/search/get/web?type=1000`（明文，代码更少：只多一个 `type`）**：**否决，但理由不是「它坏了」。** 干净态实测完全可用（`code=200, playlistCount=465, limit=30 → n=30`）。否决理由是**不要拿它当高频腿**：它的限流是**突发 + 滚动窗口**触发，而不是固定发数——
  - `1 发 / 3s × 10`：**10/10 全部 `code=200`**（即正常使用节奏根本不触发）；
  - 紧接着**无间隔连打**：前 5 发 `code=500 system error!`，第 6 发起 `code=405`；
  - 封禁范围是**该腿全 `type` 一起挂**（`type=1/10/100/1000` 统一 405/406，HTTP 仍 200，错误只在 body 的 `code`）；冷却量级 **≥10 分钟**（实测 264 s + 210 s 两段全程 405）；
  - 「第几发触发」**不是稳定常量**（三组独立观测给出不同发数），因此不能写进任何契约或重试策略；
  - 同一时间窗内 `POST /api/cloudsearch/pc` **每一发都是 `code=200`**（两条腿额度独立）。
  结论：这条腿不是「不可用」，而是「不能当高频腿」——而搜索页恰好是高频入口。故不采用。
- **`GET /api/search/get`（无 `/web`）**：会多返回 `hasMore`/`hlWords` 与**每条歌单的 `track` 样例曲**（含完整 artist/album 对象，约 3.8 KB/条），但属同一端点族、同一风控面。**不采用**；它提供的 `hasMore` 由决策 1 的 `offset + limit < playlistCount` 推导补上（`hasMore` 是否存在不构成选腿理由）。
- **`/weapi/cloudsearch/get/web` 及其明文同族 `/api/cloudsearch/get/web`**：无 Cookie 时两腿**恒** `{"code":50000005}`（`type=1` 与 `type=1000` 一样），与 #126 的既有结论一致 → **不可用**。也不为本功能引入任何 Cookie 机制。
- **`POST /weapi/search/get`（`type=1000`）**：实测匿名可用（`code=200, playlistCount=465`），但需 AES+RSA 加密，相对明文 `cloudsearch/pc` **没有任何收益**（同样的数据、同样的风控面、更多的机件）→ 仅记录为备选。
- **严格照 issue 原文只返回 `DiscoverPlaylist[]`**：否决，理由见决策 1b（`more` 无处安放，验收项「分页终止用 `offset + limit < playlistCount` 推导」无法落地，且消费端只能靠「不足一页」猜——弱关键词回退会让这个猜法给出错误结论）。
- **把歌单搜索也做成「关键词变化即发」**：否决。见决策 6——会让 `cloudsearch/pc` 在搜索页的请求数翻倍。
- **只加「可区分失败语义」而不迁 `searchArtists` 的腿**：不选。它保留了那条唯一被实测封禁的腿，需要额外发明一套错误类型才能把 405 与「无命中」分开；迁腿后两者天然可分（决策 7）。
- **歌单搜索的历史记录 / 联想词 / 多源歌单搜索（QQ/Kugou/Migu/…）**：out-of-scope（issue 已列），本决策不涉及。
- **顺手把 `getPlaylists`/`getRecommendedPlaylists` 与 `searchPlaylists` 合并成一个三元方法**：否决。三者的参数面（无关键词 / 个性化 / 关键词）与缓存 TTL 都不同，合并只会得到一个处处可选的三态签名；命名规则 `search<实体>s` / `get<实体>s` 已经足够区分。

## 后果

- **跨端契约面 +1 个可选内容能力**（`searchPlaylists`）。桌面 IPC 面自动派生（零手写），未实现源统一抛「源 X 未实现内容能力 searchPlaylists」。无新类型、无新 IPC 通道。
- **`cloudsearch/pc` 的每页请求数不因本功能增加**：关键词变化时仍只有原搜索的 1 发；切到「歌单」tab 后每（关键词 × limit × offset）最多 1 发上游（core 6h 缓存 + 单飞兜底）。代价是用户切到歌单 tab 时多一次可见的加载态（首屏 127–179 ms 量级）。
- **`searchArtists` 的失败态从「静默空数组」变为「抛错」**：双端 UI 本来就有错误分支（桌面「歌手搜索失败」、移动端 `artistsError`），迁移后这些分支**首次真正可达**；`405/406` 不再伪装成「未找到相关歌手」。**行为变更**：歌手 tab 在限流期间会显示错误而不是空态。
- **网易明文风控面新增一个调用点**（歌单 tab），须纳入 #408 出网治理口径。本决策已做懒加载 + 单飞 + 6h 缓存，也**不做**轮询/联想/预取。
- **弱关键词回退不可消除**：上游对无命中关键词仍返回相关歌单（实测 `s=zzzqqqxyz不存在的关键词` 仍 `playlistCount=300`，首条「不存在的电台」）。UI 无法区分「真命中」与「回退」，因此空态文案只说「没有搜到歌单」，不承诺精确匹配。
- **覆盖图必须转 https**：上游 `coverImgUrl` 实测为 `http://`，桌面 Electron 混合内容会被拦 → 映射时 `replace(/^http:/, 'https:')`（与 `getRecommendedPlaylists` 同款处理）。
- **测试面**：core 新增零真实网络单测（请求形态与头集合、字段映射、分页与越界、`code=405/406/400` 错误路径、空关键词零请求、缓存 TTL 与空结果不入库、单飞）；桌面补渲染测试断言**懒加载**（不切 tab 不发请求）。
- **真机验收**：移动端 `npm run core:build` 后由真机 e2e 覆盖（截图传 PR comment，不入库）。
