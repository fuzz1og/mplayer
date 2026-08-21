# 移动端 vs 桌面对齐差距清单（e95d70e..HEAD）

> 整理日期：2026-08-21。区间：`e95d70e..HEAD`（17 个提交，15 个非 merge），HEAD = `191b752`。
> 目标：移动端（`packages/mobile`）全面对齐桌面在本区间落地的「自建 API 退役 → 直连 + tier3 订阅源接管」新链路。
> 本文档只是差距清单，不附带代码改动；每项给出对齐动作建议，供后续认领。
>
> **✅ 复测更新（2026-08-21 真机，tier3 已配置）**：主搜索/主播放恢复 ✓；歌词不显示复现 ✓（差距⑤）；换源候选空复现 ✓（差距④，SongRow 更多菜单）；热榜点播基本正常但歌词缺失（差距①重新定性，见下）；播放失败静默跳歌未遇到；高延迟首播慢有感知但不明显。
>
> **🔧 修复落地（2026-08-21）**：八项差距已按 `docs/agents/mobile-parity-fix-spec.md` 全部修复（C1 搜索腿路由化 / C2 core 兜底路由化 / C3 探测转预取+播放后徽标回写 / C4 存量迁移+tier3 统计），lint/typecheck/四套件测试全绿，**待真机复测验收**（见文末复测清单）。

## 判定方法

- 凡落在 `@mplayer/core` 的逻辑（路由、tier3 搜索/解析兜底、探测直连化语义、歌词链路、hostname 源推断、预取缓存**读路径**），移动端**重建 core dist 即自动继承**。
- 注意：移动端 Metro 吃的是 `packages/core/dist` 打包产物（`metro.config.js` 入口即 dist），core 源码改动必须 `npm run core:build` 后重启 Expo（必要时 `expo start -c` 清 Metro 缓存）才生效。当前 dist 已是最新。
- 需要移动端**自己动手**的是两类：仍直调旧入口（`musicApi.searchSongs` 等）的链路缝隙，以及桌面渲染层专属的 UI 逻辑（徽标回写、提示、统计面板）。

---

## 一、已对齐项（无需动作，复测通过）

| 机制 | 说明 | 复测 |
|---|---|---|
| 主搜索链路 | `searchStore` → `searchSongsRouted`（`stores/searchStore.ts:26-31`），直连失败/返回空均触发 tier3 搜索兜底（core `48606e5`） | ✅ 搜索空/报错消失 |
| 主播放解析链 | `resolvePlayableUrlMobile` 先走 `resolvePlayableSongRouted`（`services/audioPlayer.ts:225`），含预取缓存命中 0 等待、preview 不再等 tier3 秒出声（core `68844b5` 读路径） | ✅ 推荐页/搜索结果点播失败消失 |
| 歌词获取与格式兼容 | `PlayerOverlay` 走 core `getLyrics` / `getLyricsBySongId` / `parseLRC`（`components/PlayerOverlay.tsx:138-140`），酷狗两步/酷我 zlib/QQ fcg Referer、`looksLikeLyrics` 坏缓存守卫全部 core 自动继承（`6f30af5`） | ✅（有 lrc 的歌正常；无 lrc 走兜底的复现，见差距⑤） |
| tier3 订阅与来源开关配置 | `app/settings.tsx:207-314` 完整入口，`settingsStore.ts:60-83` 与 core 双向同步 + AsyncStorage 持久化 | ✅ 配置后主链路恢复 |
| 自建 API 设置退役 | `33b2d7d` 已同步删除移动端 API 设置页与 `apiBaseUrl` 状态 | ✅ |
| 空 URL 播放拦截 | `audioPlayer.ts:344-346` 有拦截 + fresh 重试 + 跳下一首（仅缺可见提示与徽标，见差距⑥） | ✅ 主链健康后失败罕见 |
| cacheService 层旧签名端点免疫 | `cacheService.ts:28-33` 只认 `http` 前缀（持久化层缺口见差距⑦） | — |

---

## 二、差距清单（按复测后的严重度排序）

### 🔴 ① 歌词/资源兜底搜索走旧 API + `findBestMatch`【复测确认：歌词不显示持续复现】

- **桌面修复**：`9725a60` 刷新兜底升级为 `searchSongsRouted` + `findExactMatch` 严格匹配。
- **移动端现状**：`songResources.searchStrictMatch` 用 `musicApi.searchSongs`（恒空）+ `findBestMatch`——歌词兜底（`fetchLrcInBackground`，`audioPlayer.ts:172-206`）与资源刷新实际失效。**凡是没有 lrc 的歌（热榜、部分直连结果）歌词必然缺失**。
- **证据**：`services/songResources.ts:16-20`。
- **对齐动作**：改 `searchSongsRouted` + `findExactMatch`。

### 🔴 ② 榜单点播链路退化为"裸 item 入队"——歌词缺失 + 全队列实时解析【复测：点播能播（ID 直连解析救场），但热榜队列歌词全缺】

- **复测定性**（原"播错歌"风险已重新定性）：`searchSongs` 恒空后 `results[0] || toSong(item)`（`DiscoverTabs.tsx:129`）总是回退到原始 hotlist item（无 url/lrc），靠 `resolvePlayableSongRouted` 按 ID 直连解析才播出来——**播错歌风险被"恒空搜索"意外抑制，但代价是入队歌曲无 lrc**（歌词缺失，与差距①叠加）且整张榜单每首都要实时解析。
- **桌面修复**：`6f30af5` 无 url 播放改为 `findExactMatch` 严格匹配、只回填 url/lrc 再播原歌。
- **证据**：`components/DiscoverTabs.tsx:124-138`、`app/hotlist.tsx:130-131`。
- **对齐动作**：两处改 `searchSongsRouted` + `findExactMatch`，命中后回填 url/lrc 再入队，恢复"搜索获取完整 Song"的本意。

### 🟠 ③ 换源 deps 未路由化、探测无批量无预取【复测确认：SongRow 更多菜单 → 换源候选为空】

- **桌面修复**：`6cba30b` 换源搜索改 `searchSongsRouted`；`68844b5` 换源探测改 `probeSongsBatch`。
- **移动端现状**：`services/sourceSwap.ts:10` 搜索腿用旧 `searchSongs`（恒空 → 候选恒空，弹"未在X找到可切换的版本"）、探测腿逐首 `probeAudioUrl`（无解析无预取）。
- **证据**：`services/sourceSwap.ts:9-17`；`components/SongRow.tsx:113-128`（唯一换源入口，搜索/收藏/历史/歌单全部经它）。
- **复测备注**：✅ 已确认——搜索结果页与歌单页的更多菜单换源均弹"未在X找到可切换的版本"（初测时"搜索没问题"实指搜索栏切源搜索结果正常，非换源功能）。所有换源入口同一组件同一死腿。
- **对齐动作**：deps 换 `searchSongsRouted` + `musicApi.probeSongsBatch`（算法本体已共用 core，无需动）。

### 🟠 ④ 失败兜底解析仍走旧自建 API `searchSongs`

- **桌面修复**：`9c40e48`/`6cba30b` 播放/歌词兜底搜索全部改 `searchSongsRouted`。
- **移动端现状**：`resolvePlayableUrlMobile` 失败后回退 `resolvePlayableSong(song, musicApi)`（`audioPlayer.ts:232`），其内部搜索腿与 `resolveFreshUrl`（fresh 重试）都走旧 `searchSongs`——退役后恒空，兜底链等于断路。主链健康时无感（复测未遇到播放失败），但直连抖动时少一层救场。
- **证据**：`services/audioPlayer.ts:232`、core `resolvePlayableUrl.ts:116`、`resolveFreshUrl.ts:42`。
- **对齐动作**：给兜底链注入 routed 搜索腿。

### 🟡 ⑤ 探测未直连化、不写预取缓存——秒播吃不到【复测：有感知但不明显，优先级降】

- **桌面修复**：`8b9108c`/`6f30af5` 探测改 `probeSongsBatch`（仅直连）；`68844b5` 探测结果写预取缓存，播放命中 0 等待；徽标改播放后回写。
- **移动端现状**：`services/songProbe.ts:36-46` 直调 core `probeSongs` 且无 resolver——直探原始 url（多为空，fail-open 标 valid），不写预取缓存，预取命中路径对移动端永远为空；列表徽标仍是已废弃的探测预显旧语义。
- **证据**：`packages/mobile/services/songProbe.ts:36-46` vs core `musicApi.ts:2431-2471`。
- **对齐动作**：`songProbe` 改走 `musicApi.probeSongsBatch`（自动获得直连解析 + 预取写入）。

### 🟡 ⑥ 空 URL 播放失败无可见提示、不回写 invalid 徽标【复测：未遇到（主链健康），低频 UX 债】

- **桌面修复**：`8b9108c` 失败 `message.error`（"可能为 VIP/无版权…可尝试换源"）+ 回写 invalid 徽标；`68844b5` 播放后按实际结果回写 preview/invalid/valid。
- **移动端现状**：有拦截但静默——catch 里日志 + 跳下一首，队列耗尽才弹 Toast（`audioPlayer.ts:427-446`）；不回写 invalid 徽标；`resolvePlayableUrlMobile` 丢弃 `routed.nonFull`，试听版无"可换源"提示。
- **证据**：`services/audioPlayer.ts:223-233, 344-346, 427-446`。
- **对齐动作**：透传 `nonFull` 并提示；失败回写 `audioTagStore` invalid 徽标；连续失败给可见提示。

### ⚪ ⑦ AsyncStorage 存量旧签名端点无迁移

- **桌面修复**：`9725a60` `legacyUrl.ts` + 启动幂等迁移 + 可重跑脚本。
- **移动端现状**：收藏/历史/歌单 persist 整首 Song（含 `url/cover/lrc`），无启动迁移；`audioPlayer.ts:213-215` 仍把 `api.php?get=url` 当**有效** 302 端点主动解析（已退役即死链，只能靠 fresh 重试救）。
- **证据**：`stores/favoriteStore.ts:15-59`、`services/audioPlayer.ts:213-215`。
- **对齐动作**：rehydrate 时清死链字段（逻辑可在 core 共享），`isRedirectEndpoint` 收窄不再放行 `api.php`。

### ⚪ ⑧ tier3 每源统计未展示

- **桌面修复**：`68844b5` `getTier3Stats` 每源命中/失败计数 + 设置页统计面板。
- **移动端现状**：`app/settings.tsx:240-314` tier3 入口完整，无统计展示，盲调订阅。
- **对齐动作**：设置页 tier3 区块加每源 hits/misses 展示（core `getTier3Stats`，会话级）。

---

## 三、不适用项（用户裁定/桌面专属）

| 项 | 裁定 |
|---|---|
| 代理接入（`6f30af5`） | **不适用**——移动端场景不需要代理。备注：现有设置页代理输入框在 RN 网络栈下实际不生效（`settings.tsx:316-345` 仅同步 core 状态），后续可清理或保留占位 |
| dev 端口 5174（`3d3cf75`）、WSLg 环境变量（`a617b24`）、WSLg HiDPI（`191b752`） | 纯桌面开发环境 |
| 主进程相对路径导入修复（`2584ba3`） | 桌面构建专属 |
| `settings:getTier3Stats` IPC、`ApiSection` 删除等主进程/渲染层改动 | 桌面专属（统计展示缺口已单列为⑧） |

---

## 四、真机复测记录（2026-08-21）

前置已满足：tier3 订阅配置 ✓、core dist 最新 ✓。

| 症状 | 预期 | 实测 |
|---|---|---|
| 搜索页返回空/报错 | 消失（主搜索 routed + tier3） | ✅ 消失 |
| 推荐页/搜索结果点播失败 | 大部分消失（routed 解析 + tier3 兜底） | ✅ 消失 |
| 热榜/发现页点播无声或播错歌 | 会复现（差距①→现②） | 🟡 基本没有——ID 直连解析救场，但热榜队列歌词全缺（与差距①叠加） |
| 歌词不显示（无 lrc 的歌） | 会复现（差距⑤→现①） | ❌ 复现 |
| 换源候选为空 | 会复现（差距④→现③） | ❌ 复现（搜索结果页与歌单页更多菜单均弹"未在X找到可切换的版本"） |
| 播放失败静默跳歌无提示 | 会复现（差距⑥） | ✅ 未遇到（主链健康后失败罕见） |
| 高延迟源首次播放慢 | 会复现（差距⑤→现②探测预取） | 🟡 有感知但不明显 |
