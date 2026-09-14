# ADR-0003: 多源搜索编排收进 core（SearchOrchestrator 自持状态深模块）

- 状态：已接受（2026-08-15，经 /improve-codebase-architecture 候选 3「搜索编排」grilling 定稿）
- 关联：ADR-0001（`musicApi:searchAllSources` 退役后从暴露清单移除）；ADR-0002（无直接关系）

## 背景

「多源搜索」概念在三处各有一台状态机：

1. `packages/core/src/shared/searchController.ts`（81 行）—— 单源搜索状态机：seq 防 stale、loadMore 去重合并、loadingMore 泄漏防御；接口 `createSearchController({ searchFn, getState, setState })`，getState/setState 传 `Record<string, any>`，按 store 形状设计（宽接口）；
2. `src/renderer/services/searchService.ts` —— 桌面：controller + 主进程批量探测 + 防抖；setState 做 key 映射（currentKeyword←query）+ 探测副作用；自造 searchSeq（第二份 seq）；
3. `packages/mobile/stores/searchStore.ts` —— 移动：「全部源」路径绕过 controller，自造 `progressiveSearch`（3 worker 并发池，逐源完成即渐进渲染）+ `mergeGroupedResults`（第二套合并语义）+ 模块级 searchSeq（第三份 seq）。

同一概念三份 seq、两套合并语义；移动端注释里记录过的分页/竞态 bug 正是在自造机器里修出来的。桌面 'all' 路径用单次 `searchAllSources`（一次性全量，等最慢源）。

## 决策

**方案 B：core 新深模块 `SearchOrchestrator`，自持状态，接口零 store 形状。**

- **接口**：`createSearchOrchestrator({ searchOneSource(query, page, source), concurrency?, sources? })` 返回 `{ search(query, route), loadMore(), reset(), getState(), subscribe() }`；core 内 ~15 行自定义 observable（零新依赖，zustand vanilla 同款形态）。
- **语义**：route = `'all' | SourceKey`。单源 = 单次调用吐一批；`'all'` = 按源逐源渐进（concurrency 参数化：移动 3、桌面 6-7），每源完成即重组吐结果。seq 防 stale、组内合并、loadingMore 防御全部单一事实来源，存在于编排器内部。
- **组内合并**：`groupIntoSongGroups` 确定性重分组（固定源序拼装保证「逐源到达顺序不改最终分组」不变量）+ 同源分页去重，单一实现。
- **桌面 'all' 变渐进**（行为变更，有意为之）：N 次按源 IPC 调用替代单次 `searchAllSources`；最终分组结果与一次性一致（确定性分组保证）。
- **两端 store 变纯绑定**：subscribe 镜像进 zustand（或 useSyncExternalStore 直读）；source 路由、探测副作用（桌面逐批 probeResults / 移动完成后统一 probeSongsWithTags）、日志留在 store。
- **controller 吸收后删除**；`searchAllSources` 从搜索路径退役（已核实生产调用方仅搜索路径本身），留待 ADR-0001 收编时从 `musicApi:call` 暴露清单移除。

## 后果

- seq/合并/竞态逻辑单点（编排器），「搜索」概念不再跨 5 个文件；
- 桌面获得渐进渲染（首屏不再等最慢源）；IPC 从 1 次 searchAllSources 变为 N 次按源调用（有并发上限，主进程闸门兜底）；
- 两端 store 显著变薄；测试面 = 编排器接口（search → 断言状态迁移），无 store mock；
- `searchAllSources` 通道退役，与 ADR-0001 的暴露清单联动。

## 回退选项

不采用：方案 A（扩展 controller，渐进语义绑架单源状态机，遗留 if-else 融合）；typed setState / onResults 回调（把 store 形状或回调塞进接口）；保留 controller 给单源（两台状态机并存）。
