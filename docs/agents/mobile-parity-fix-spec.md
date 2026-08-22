# 移动端对齐修复 Spec（mobile-parity-gap-list 八项）

> 依据：`docs/agents/mobile-parity-gap-list.md`（含 2026-08-21 真机复测结论）。
> 目标：移动端全面对齐桌面「自建 API 退役 → 直连 + tier3 订阅源接管」新链路。
> 原则：机械替换项按清单直接改；**行为变更项（B/C 部分）按本 spec 的语义执行**，不要自由发挥。
> 所有 UI 文案中文；每批提交前过 CLAUDE.md 验证顺序（lint → typecheck → test）。

## 修复总览

| # | 清单项 | 类型 | 涉及层 | 建议提交批次 |
|---|---|---|---|---|
| ① | 歌词/资源兜底搜索路由化 | 机械 | mobile | C1 |
| ② | 热榜/发现点播改严格匹配回填 | 机械 | mobile | C1 |
| ③ | 换源 deps 路由化 + 批量探测 | 机械 | mobile | C1 |
| ④ | 播放失败兜底解析路由化 | 机械（core） | core + rebuild | C2 |
| ⑤⑥ | 探测转预取 + 播放后徽标回写 + 试听提示 | **行为变更** | mobile | C3 |
| ⑦ | 旧签名端点存量迁移 + 302 判定收窄 | **行为变更（数据）** | core + mobile | C4 |
| ⑧ | tier3 每源统计展示 | 机械 | mobile | C4 |

依赖关系：C3 依赖 ③ 的 `probeSongsBatch` 接线经验但无硬依赖；C4 的 core 改动需 `npm run core:build` 后真机验证。按 C1→C2→C3→C4 顺序实施。

---

## Part A：机械修复（C1/C2）

### ① `songResources.searchStrictMatch` 路由化

- `packages/mobile/services/songResources.ts:19-20`：`musicApi.searchSongs(...)` → `musicApi.searchSongsRouted(...)`；`findBestMatch` → `findExactMatch`（core `songMatcher` 已导出，桌面 `playerStore.ts:289` 同款用法）。
- 影响：歌词兜底（`audioPlayer.fetchLrcInBackground`）与资源刷新恢复工作——**真机验收直接看这条**：播一首无 lrc 的非网易歌，歌词应能补全。

### ② 榜单点播严格匹配回填

- `packages/mobile/components/DiscoverTabs.tsx:124-138` 与 `packages/mobile/app/hotlist.tsx:130-131`：
  `musicApi.searchSongs(item.name, 1, sourceType)` + `results[0]` → `musicApi.searchSongsRouted(...) + findExactMatch({name, artist}, results)`。
- **回填语义（对齐桌面 6f30af5）**：命中后**不播 hit 本体**，只把 `url`/`lrc`（有则）回填到原 item 的 Song 对象再入队播放：
  `s = { ...toSong(item), url: hit.url || '', lrc: hit.lrc || '' }`；未命中保持现回退 `toSong(item)`。
- 禁止回归：不得把 `results[0]`（或 hit 本体）替换进队列——那会改歌名/歌手/ID（播错歌老坑）。

### ③ 换源 deps 路由化

- `packages/mobile/services/sourceSwap.ts:9-17`：
  - `searchSongs: (k,p,s) => musicApi.searchSongsRouted(k,p,s)`
  - `probeSongs: (songs) => musicApi.probeSongsBatch(songs)`（返回 `{songId, tag}[]`，正好匹配 `SourceSwapDeps.probeSongs` 签名；替换现 `Promise.all` 逐首 `probeAudioUrl`）
- 算法本体（core `searchSwapCandidates/probeSwapCandidates/applySwap`）不动。换源弹层内候选渐进探测逻辑（`SongRow.tsx:125`）不动。
- 验收：任意歌曲更多菜单 → 换源 → 候选列表非空、带可播性标记。

### ④ 播放失败兜底解析路由化（core，需 rebuild）

- core `packages/core/src/shared/resolvePlayableUrl.ts:116` 与 `resolveFreshUrl.ts:42`：内部搜索腿 `resolver.searchSongs(...)` → `resolver.searchSongsRouted(...)`（`musicApi` 两方法都有；若担心自定义 resolver 无该方法，用 `resolver.searchSongsRouted?.() ?? resolver.searchSongs?.()` 防御）。
- mobile 侧无需改（`audioPlayer.ts:232` 回退 `resolvePlayableSong(song, musicApi)` 自动受益）。
- **提交 C2 后必须 `npm run core:build` 并重跑桌面 renderer + main 测试**（core 为双端共享）。

---

## Part B：探测转预取 + 播放后徽标回写（C3，行为变更）

### B1 探测职责 = 预取，不再写列表徽标

**新语义**（对齐桌面 `68844b5`，理由：探测预测与实际播放常不符，预测徽标误导）：

- `packages/mobile/services/songProbe.ts`：`probeSongsWithTags` 改名 `probeSongsPrefetch`，实现改为一行语义：
  `await musicApi.probeSongsBatch(songs)`——**不再写 audioTagStore**。
  - 预取写入发生在 core `probeSongsBatch` 内部（`rememberProbeResult`，模块级 Map，TTL 30min/上限 500）；mobile 与 core 同一 JS 运行时，`playSong` → `resolvePlayableSongRouted` 开头查同一缓存，命中 0 等待。**无需额外接线**。
- **`missingAsInvalid` 选项删除**。理由：probeSongsBatch 的 resolver 会为无 url 的歌直连解析并写预取缓存——解析成功的歌若仍被标 invalid 是**错误**标签；预测性徽标整体废弃。专辑/歌手/发现歌单页失去"无效徽标引导换源"的 affordance 是**接受的代价**（对齐桌面）；换源引导改由 SongRow 更多菜单承担。
- 调用点更新（5 处）：`stores/searchStore.ts:74`、`app/album/[id].tsx:48`、`app/artist/[id].tsx:70`、`app/discover-playlist/[id].tsx:53,77`——改调 `probeSongsPrefetch(songs)`（去 options）。searchStore 处可加模块级 `Set` 增量去重（同桌面 probedIds），非硬性要求。
- `SongRow.tsx:53,263,268` 徽标渲染**保留**——徽标来源从"探测预显"变为"播放后回写"（B2）与"换源候选探测"（已有）。

### B2 播放后按实际结果回写徽标 + 试听提示

**回写规则**（对齐桌面 `playerStore.ts:236-243,301-306,318-321`）：

| 播放结果 | 回写 | 可见反馈 |
|---|---|---|
| 解析成功且 `nonFull=true` | `setTag(song, 'preview')` | info Toast「当前为试听版，可换源获取完整版」 |
| 完整版播放成功启动 | `setTag(song, 'valid')`（清旧失败徽标） | 无 |
| 最终失败（fresh 重试也失败、确定跳歌/队列耗尽） | `setTag(song, 'invalid')` | 见下 |

实现要点：

1. `resolvePlayableUrlMobile`（`audioPlayer.ts:223-233`）返回值扩为 `{ url, lrc, nonFull }`：透传 `routed.nonFull`；旧回退 `resolvePlayableSong` 路径 nonFull 恒 `false`。调用点（`playSong` 主链、`prefetchNextSong`）同步解构。
2. `playSong` 内：解析返回 nonFull → `useAudioTagStore.getState().setTag(song, 'preview')` + 发 info 通知；播放成功启动处（`startPlayback` 正常返回、播放器 ready 后）非 nonFull → `setTag(song, 'valid')`。
3. 失败回写时机：catch（`audioPlayer.ts:427-446`）里 **fresh 重试之前不写**（还没定论）；走 `nextSongAfterError` 跳歌或队列耗尽分支时 `setTag(song, 'invalid')`。local 源不回写。
4. **可见提示**：复用 `_layout.tsx` `PlaybackErrorToast` 的瞬态 Toast 模式——`logsStore` 增加通用瞬态通知（如 `lastNotice: { level: 'info' | 'error', text: string }` + `setNotice/clearNotice`），`reportError` 迁移为 `setNotice({level:'error',...})`（保持 `lastError` 兼容或一并替换，二选一，改完无残留引用）；Toast 按 level 区分样式（info 蓝/error 红）。队列耗尽的最终错误文案追加「，可尝试长按歌曲换源」。
5. nonFull 的 info Toast 节流：同一首歌一次播放会话只提示一次（`playbackCtx` 已有单例上下文可挂标志）。

**验收（真机）**：播酷我 M500 试听源 → 秒出声 + Toast 提示 + 列表行 preview 徽标；播一首完整歌 → 徽标消失（valid）；断网播一首 → invalid 徽标 + 错误 Toast 带换源指引。

---

## Part C：存量迁移 + 302 判定收窄 + 统计展示（C4，行为变更）

### C-⑦ 旧签名端点迁移（动用户数据，规则如下）

**规则（对齐桌面 `9725a60`，只清资源字段，绝不删条目）**：

1. `src/shared/legacyUrl.ts` 的 `isLegacyDeadUrl`/`clearLegacyDeadResources` **移入 core** `packages/core/src/utils/legacyUrl.ts` 并从 index 导出；desktop 改从 core import（删除本地文件，`2584ba3` 教训：主进程不要用路径别名 import 共享件）。
2. mobile 迁移挂载点：`_layout.tsx` 启动 effect 中、stores rehydrate 完成后跑一次幂等迁移 `migrateLegacySongs()`：
   - 遍历 `favoriteStore.favorites`、`historyStore.history`、`playlistStore` 各歌单 `songs`；
   - 每首执行 `clearLegacyDeadResources(song)`（清 `url/cover/lrc` 中指向 `api.php?get=*` 的值）；
   - **同时删除条目上的 `audioTag` 与 `nonFull` 字段**（存量预测标签不可信，徽标改由 B2 播放后回写）；
   - 仅当有改动才写回 store（避免无谓 persist）；**不删除任何收藏/历史/歌单条目本身**。
3. `isRedirectEndpoint`（`audioPlayer.ts:213`）收窄：`url.includes('api.php?get=url')` → `!isLegacyDeadUrl(url) && url.includes('api.php?get=url')`。效果：存量死链不再被当有效 302 端点送 `getAudioUrl`（已退役必败），落入"无 url"分支走 `resolvePlayableSongRouted` 现解析。`resolveDirectUrl` 保留作防御。
   - 风险备注：tier3 解析链返回的 URL 理论上可能形似 api.php——但 routed 返回直链不经过 `isRedirectEndpoint` 的 302 解析路径（`resolvePlayableSongRouted` 产物直接可播），风险可控；若真机发现 tier3 源返回 302 端点再单独处理。
4. 迁移日志：`logsStore.addLog('info', '存量数据迁移完成: 清理 N 首旧签名死链')`（N=0 也记，方便真机确认跑过）。

### C-⑧ tier3 每源统计展示

- `packages/mobile/app/settings.tsx` tier3 区块（240-314）底部加「每源解析统计（本次会话）」面板：读 core `getTier3Stats()`（已导出），每源一行 `源名 命中 N / 未命中 M`；提供「清零」按钮（`clearTier3Stats()`）；进入设置页时刷新。样式对齐现有 tier3 条目行。

---

## 验收标准（每批提交前）

```bash
npm run lint                          # 根（C2/C4 动 core 后必跑）
npx tsc --noEmit                      # 桌面 typecheck
npx tsc --noEmit --project packages/mobile/tsconfig.json
npx vitest run                        # 桌面 renderer
npx vitest run --config vitest.main.config.ts
npx vitest run --config packages/mobile/vitest.config.ts
npm run core:build                    # C2/C4 之后（移动端 Metro 吃 dist）
```

**真机复测清单**（对照 gap list §四）：

| 症状 | 修复后预期 | 对应项 |
|---|---|---|
| 无 lrc 的非网易歌歌词不显示 | 歌词能补全 | ① |
| 热榜点播队列歌词全缺 | 点播后歌词正常、队列带 url/lrc | ②+① |
| 换源弹"未在X找到可切换的版本" | 候选非空、带可播性标记 | ③ |
| 高延迟源首次播放慢 | 搜索结果探测后点播 0 等待秒播 | ⑤ |
| 试听版无提示 | Toast「试听版」+ preview 徽标 | ⑥ |
| 播放失败静默跳歌 | invalid 徽标 + 错误 Toast 带换源指引 | ⑥ |
| 存量收藏死链 | 启动日志显示迁移清理计数 | ⑦ |
| tier3 盲调 | 设置页可见每源命中统计 | ⑧ |
