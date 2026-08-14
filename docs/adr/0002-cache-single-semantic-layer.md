# ADR-0002: 缓存收编为单一语义层（CacheKernel 内核 + songResourcesCache）

- 状态：已接受（2026-08-15，经 /improve-codebase-architecture 候选 2「缓存」grilling 定稿）
- 关联：ADR-0001（cache 域不并入 `musicApi:call`，保持语义通道）；wayfinder #122（格式嗅探单点复用）

## 背景

「缓存」概念在仓库里有四份实现 + 一组内联 map：

1. `packages/core/src/api/memoryCacheManager.ts` —— 内联 Map + 专属 TTL 表（搜索/URL/歌词/热榜/歌单）；
2. `packages/core/src/cache/cacheKernel.ts` + backends —— 泛化 L1/L2 深内核；
3. `src/main/ipc/cache.ts` —— 桌面 IPC 双轨：legacy 7 通道（渲染在用）+ typed 4 通道（僵尸，零调用）；
4. `src/renderer/services/coverCacheService.ts` —— 封面缓存 + hook，图片头白名单与 diskBackend 逐字节复制；
5. `packages/mobile/services/cacheService.ts` —— 移动 URL 缓存（已包 CacheKernel）；
6. core `musicApi` 内联 map（sodaAudioUrlCache / coverUrlCache / searchFailedSongIds / probeCache）。

**现存 bug**：`setAudio` 写 `audio:`（内核补成 `:bin:audio:`）而 `getAudio` 直读 `:bin:audio:${audioUrl}`——写读键不一致；`getCover` 绕过内核直读磁盘（`getBinaryCachePath` 手工拼 `:bin:cover:`），`setCover` 走内核——封面双键路径。

**关键事实**：legacy `cache:getUrl/setUrl` 已在生产承载 songId → {url, cover, lrc} 三件套（7 处渲染调用点）——语义层早已存在，只是封在 IPC 字符串层里；`cache:getSong/setSong/getAudio/setAudio` 渲染端零调用（僵尸）；`Song.id` 已含源前缀（`${source}:${rawId}`，sourceSwap 生成），跨源唯一。

## 决策

**方案 B：歌曲资源语义接口 + 独立语义模块，CacheKernel 保持通用深内核。**

- **语义模块**：`packages/core/src/cache/songResourcesCache.ts`（纯逻辑，零后端依赖，桌面主进程/渲染端/移动端共享）。方法集：
  - `getSongResources(songId) / setSongResources(songId, {url, cover, lrc})`（三件套，TTL 12h）
  - `getCoverPath(coverUrl)` → 可渲染 file:// 路径或 null（TTL 6h）；`setCoverBytes(coverUrl, bytes)`
  - `invalidateCover(coverUrl)` / `clear` / `getStats`
- **key 规则**：统一 `song:${songId}`（id 已含源前缀）；封面 `cover:<归一化 URL>`。调用方不许手拼 key/TTL——常量与推导内聚在语义模块注册表。
- **IPC**：桌面收窄为 7 个语义通道（`cache:getSongResources` 等，语义名即接口），删除 8 个僵尸通道（getSong/setSong/getAudio/setAudio + typed getJSON/setJSON/getBinary/setBinary）；渲染端 7 处调用点一次改名迁移。cache 域不并入 `musicApi:call`（操作少且无三份拷贝问题，分发层是重复抽象）。
- **封面字节校验**：白名单收进主进程 disk 适配器（写盘前校验），渲染层 `isImageContent` 删除；图片/音频格式头嗅探统一挪到 `core/utils/sniffers.ts` 单点，供 #122 的 isAudio 预检同源复用。
- **范围控制**：core `musicApi` 内联缓存（soda/cover/searchFailed 黑名单/probeCache）**保持内部**，不强行并入（负缓存会让内核接口复杂化；#122 请求层重构会重做这片区域）。
- **TTL 保持现状**：URL 12h、封面 6h，只收拢位置不改变过期行为。
- **移动端**：`cacheService.ts` 并入语义层（`url:${sourceType}:${songId}` 的冗余 sourceType 去掉，key 变化一次无害冷缓存）。

## 后果

- key/TTL 规则单点（语义模块注册表），「这首歌的缓存 key 长什么样」不再跳四个模块；
- 8 个僵尸通道 + 双轨消失；两个 key bug（getAudio/getCover 键不一致）在迁移中修复；
- 白名单从两份收敛到一份（disk 适配器 + sniffers），#122 复用同一嗅探实现；
- 渲染层零 key 知识，封面缓存语义（路径）与现状一致，UI 行为不变；
- 测试面收窄：语义层方法集即缓存契约，cacheKernel.test 9 例全存。

## 回退选项

不采用：方案 A（保留通用接口只去重，key 仍散在调用方）；内嵌语义注册表进 CacheKernel（内核变得懂业务，跨平台复用面变窄）；cache:call 单通道分发（与 ADR-0001 形态一致但 cache 域无接口复制问题）；musicApi 内联缓存并入（负缓存哨兵使接口复杂化）。
