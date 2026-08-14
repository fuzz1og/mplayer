# ADR-0001: musicApi 渲染↔主进程接缝收成单通道分发（musicApi:call）

- 状态：已接受（2026-08-15，经 /improve-codebase-architecture 候选 1「IPC 表面」grilling 定稿）
- 关联：wayfinder #122（接缝收敛先行，为其逐源 client 拆解铺路）；候选 2「缓存四份实现」不受影响

## 背景

`musicApi` 接口在桌面端以四份形态存在：

1. `packages/core/src/api/musicApi.ts` 的 `musicApi` 对象（事实来源，约 30 个公开方法 + `getLyrics`）；
2. `src/main/ipc/musicApi.ts` 约 31 个 `musicApi:*` 一对一段通道注册；
3. `src/renderer/services/IpcMusicApi.ts` 手写镜像代理（21 个方法，缺 getAggregatedChart / getNewAlbums / fillSongUrls / getRecommendedPlaylists / getRecommendedSongs / resolveCoverUrl / invalidateCoverUrl / probeAudio / searchSongById / getThrottleWait）；
4. 15 个文件里的裸字符串调用（8 个页面直接 `ipcRenderer.invoke('musicApi:xxx')` 并手动 `as ApiResponse` 解包；7 个文件裸 `IpcClient.invoke('musicApi:xxx')`）。

后果：加一个 core 方法要同步主进程注册 + 渲染镜像三处；镜像不全逼出裸字符串与手动解包；`musicApi:getPlaylists` 已无调用方（死通道）；`lyrics:get` 与 `api:getThrottleWait` 实为 musicApi 域能力却挂在非命名空间通道上。

## 决策

**桌面渲染↔主进程的 music 域收成一条运行时分发通道 `musicApi:call`（方法名 + 参数），契约派生、签名零重复。**

- **契约单一事实来源**：`src/shared/musicApiContract.ts`（零 main 依赖，仅供类型与名字）——
  - `MUSIC_API_METHODS`：暴露的 core 方法名字清单（唯一手写物，加方法 = 加一个字符串）；
  - `MainOnlyMethods`：主进程独有组合方法（当前仅 `getAggregatedChart`，`getThrottleWait` 收编后并入）；
  - `MusicApiMethodMap = Pick<typeof musicApi, MUSIC_API_METHODS> & MainOnlyMethods`——core 签名零重复，core 加方法时 IPC 一个签名不用碰。
- **主进程**：`src/main/ipc/musicApiHandlers.ts`——泛型 forward 自动转发 core 方法 + 手写 MainOnly 实现，整表 `satisfies MusicApiMethodMap`（方法名拼错 / 签名不符 / 漏方法 → 编译期必报错）；`ipcMain.handle('musicApi:call', …)` 查表分发，未知方法返回失败封套（`{ success: false, error: 'unknown musicApi method: …' }`），`ApiResponse` 封套语义不变。
- **渲染端**：删除 `IpcMusicApi.ts`，改为泛型入口 `callMusicApi(method, ...args)`（`src/renderer/services/callMusicApi.ts`），类型自 `MusicApiMethodMap` 派生，全类型安全。
- **收编动作（白名单从 3 缩到 1）**：
  - `probeSongBatch`（main 手写 worker）→ core 新方法 `probeSongsBatch`（空 url → `invalid`，保持桌面现状；内部复用 core `probeSongs` + `getAudioUrl` resolver）；
  - `fillSongUrls` → core 薄方法（包装 `resolveNeteaseSongUrlsBySearch`）；
  - `invalidateCoverUrl` 补进 core `musicApi` 对象（与 `resolveCoverUrl` 同款一行）；
  - `lyrics:get` 作为 core 方法 `getLyrics` 并入；`api:getThrottleWait` 作为 `MainOnlyMethods.getThrottleWait` 并入；
  - 死通道 `musicApi:getPlaylists`（渲染端零调用）删除。
  - 收编后 music 域 = 恰好一条 `musicApi:call`，零例外通道。
- **迁移**：功能域分批（只读数据页 → 播放/收藏链路 → 搜索/换源/封面 → 删 `IpcMusicApi` + 旧注册），旧通道标记 deprecated 并存，每批完成 = 调用点全改 + 无裸 `musicApi:*` 字符串 + 三层测试绿。
- **三层测试**：分发表单测（mock core：转发 / 未知方法 / 封套）+ 渲染 `callMusicApi` 单测 + 完整性测试（vitest 静态扫描：`MUSIC_API_METHODS` ⊆ core 方法 ∪ 白名单；渲染端无裸通道字符串；无 `IpcMusicApi` import；主进程 `musicApi:` 注册只有 `musicApi:call` 一处）。
- **顺手清理**：删除 `App.tsx` 的 `ipc:response` / `ipc:error` 死监听（已核实 main 无任何发送方）。

## 后果

- 加一个 music 域方法 = core 加方法 + `MUSIC_API_METHODS` 加一个字符串，其余自动；编译期与测试期双重兜底，三份拷贝的漂移从「静默」变「必现」。
- 渲染端所有 `ipcMusicApi.xxx(...)` 与裸 `invoke('musicApi:xxx', …)` 调用点改为 `callMusicApi('xxx', …)`，迁移量明确（约 15 个文件）。
- core 新增 `probeSongsBatch` / `fillSongUrls` 两个薄方法，`invalidateCoverUrl` 补进对象——三处行为保持（空 url → `invalid` 语义不变）。
- 其他 invoke 域（cache / favorite / history / playlist / localMusic / settings / download 等）与 main→renderer 推送通道不在本 ADR 范围；`cache:*` 双轨与 key 规则分散归候选 2 另行处理。

## 回退选项

不采用：构建时代码生成（引入工具链，收益只是保留独立通道——而独立通道正是四份拷贝的根源）；每域一条通用通道（music 域外各域薄而稳，收编是「把直的弯成弯的」）。
