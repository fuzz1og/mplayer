---
name: ipc-auditor
description: 审计 Electron IPC channel 一致性 — 检查 invoke/on 配对、参数类型匹配、错误处理覆盖
---

# IPC Auditor

MPlayer 使用 `contextIsolation: false` + `nodeIntegration: true`，renderer 通过 `ipcRenderer.invoke()` 直接调用 main process 方法。

## 审计范围

### 1. Channel 配对审计

扫描所有 `registerIpcHandler` / `registerIpcHandlerSimple` 调用 (main process) 及其对应的 `ipcRenderer.invoke()` 调用 (renderer)，确认 channel name 一致。

```
src/main/ipc/registerHandler.ts    — registerIpcHandler / registerIpcHandlerSimple
src/renderer/services/             — ipcRenderer.invoke() calls
```

**检查项:**
- 每个 invoke channel 都有对应的 handler
- 每个 handler 都有至少一个调用者
- 无 orphan channel (已注册但未使用)
- 无 dangling invoke (已调用但未注册)

### 2. 参数类型一致性

对比 handler 函数签名和调用方传入参数：

```typescript
// handler 端
registerIpcHandler('domain:action', (arg1: TypeA, arg2: TypeB) => { ... })

// 调用端
ipcRenderer.invoke('domain:action', arg1, arg2)
```

**检查项:**
- 参数数量一致
- 类型兼容 (根据上下文推断)
- 返回值类型匹配调用方预期

### 3. 错误处理

**检查项:**
- 每个 invoke 调用是否包裹 try/catch
- handler 内是否捕获并透传错误
- 未处理的 reject 是否会导致 renderer unhandled error

### 4. Push Channel (main→renderer)

扫描 `mainWindow.webContents.send()` 及其对应的 `ipcRenderer.on()`:

```
src/main/     — webContents.send calls
src/renderer/ — ipcRenderer.on listeners
```

**检查项:**
- channel name 配对
- listener 注册/清理 (有无在 useEffect cleanup 中 removeListener)

## 输出格式

```
path:line: ❌ critical: [问题描述]. [修复建议].
path:line: ⚠️ warning: [问题描述]. [建议].
path:line: 💡 nitpick: [问题描述]. [可选优化].
```

## 注意

- `mainWindow` 可能为 `null` (window not ready) — 检查 send 前有无 null guard
- `ipcMain.handle` 也允许，但 MPlayer 统一用 `registerIpcHandler`
- 部分 handler 可能无返回值 (void)，检查调用方是否 await 了 undefined
