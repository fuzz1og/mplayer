# 通过网易云歌单链接导入歌曲

## 概述

在现有文本导入歌单功能的基础上，新增通过网易云歌单链接导入歌曲的功能。支持短链接（http://163cn.tv/xxx）和完整 URL（https://music.163.com/#/playlist?id=xxx），提供预览确认流程，用户可选择性导入歌曲。

## 架构

```
ImportPlaylistModal
├── Tabs (导入模式切换)
│   ├── TabPane "文本导入"
│   │   └── TextImportForm (现有文本输入逻辑)
│   └── TabPane "链接导入"
│       ├── LinkInputForm (链接输入)
│       └── LinkPreviewTable (预览歌曲列表)
├── ProgressDisplay (进度显示，现有逻辑)
└── ResultDisplay (结果显示，现有逻辑)
```

## 数据流

### 文本导入流程（保持不变）

```
用户输入文本 → setText()
用户点击"开始导入" → handleStartImport()
  → 直接调用 importSongs()
  → setStep('progress')
  → 显示进度
  → 完成后 setStep('result')
```

### 链接导入流程

```
用户输入链接 → setLinkUrl()
用户点击"解析链接" → handleParseLink()
  → 调用 getPlaylistSongsFromThirdParty()
  → setParsedLinkSongs()
  → 显示预览
用户选择歌曲 → setSelectedSongIds()
用户点击"导入" → handleLinkImport()
  → 调用 importLinkSongs()
  → setStep('progress')
  → 显示进度
  → 完成后 setStep('result')
```

## 状态管理

### 现有状态（保持不变）

```typescript
// 步骤状态
step: 'input' | 'progress' | 'result'

// 文本导入相关
text: string
sourceOrder: SourceType[]

// 进度和结果
progress: ProgressState | null
result: ImportResult | null

// UI 状态
importing: boolean
```

### 新增状态

```typescript
// 导入模式
importMode: 'text' | 'link'

// 链接导入相关
linkUrl: string
parsedLinkSongs: Song[]
linkLoading: boolean
linkError: string | null

// 预览选择状态
selectedSongIds: Set<number>  // 用户选择的歌曲 ID
```

## 组件设计

### 1. ImportPlaylistModal (重构)

- 添加 `importMode` 状态管理标签页切换
- 根据 `importMode` 显示不同的输入表单
- 重构步骤逻辑，支持链接导入的预览步骤

### 2. TextImportForm (新组件)

- 封装现有的文本输入逻辑
- props: `text`, `onTextChange`, `sourceOrder`, `onSourceOrderChange`
- 包含源顺序拖拽排序功能

### 3. LinkImportForm (新组件)

- 链接输入框
- 解析按钮
- 加载状态显示
- 错误提示
- props: `linkUrl`, `onLinkUrlChange`, `onParse`, `loading`, `error`

### 4. LinkPreviewTable (新组件)

- 显示解析后的歌曲列表
- 支持选择/取消选择歌曲
- 显示歌曲信息（歌名、歌手、来源）
- props: `songs`, `onConfirm`, `onCancel`

## 服务层设计

### importService.ts (扩展)

```typescript
// 新增：链接导入函数
export async function importFromLink(
  playlistId: number,
  linkUrl: string,
  selectedSongIds: Set<number>,
  existingSongs: Song[],
  onProgress: (state: ProgressState) => void
): Promise<ImportResult>

// 新增：解析链接函数
export function parsePlaylistUrl(url: string): { type: string; id?: string; url?: string } | null
```

### musicApi.ts (复用)

- 复用现有的 `getPlaylistSongsFromThirdParty()` 接口
- 该接口支持网易云歌单链接解析

## 错误处理

### 链接解析错误

| 错误类型 | 检测方式 | 处理方式 | 恢复方式 |
|---------|---------|---------|---------|
| 无效链接格式 | 不包含 `music.163.com` 或 `163cn.tv` | 显示"请输入有效的网易云歌单链接" | 用户修改链接 |
| 网络请求失败 | API 返回空数组或抛出异常 | 显示"网络连接失败，请检查网络后重试" | 提供"重试"按钮 |
| 歌单不存在 | 解析结果为空（`data.code !== 1` 或 `data.data.songs` 为空） | 显示"歌单不存在或已删除" | 用户修改链接 |
| 私密歌单 | API 返回 `data.code === -1`（网易云 API 的私密歌单错误码） | 显示"该歌单为私密歌单，无法导入" | 用户修改链接 |

### 导入错误

| 错误类型 | 检测方式 | 处理方式 |
|---------|---------|---------|
| 单首歌曲导入失败 | `addSongToPlaylist()` 抛出异常 | 记录失败歌曲，继续导入其他歌曲 |
| 批量搜索失败 | `batchSearch()` 抛出异常 | 记录所有歌曲为失败，显示错误信息 |
| 歌单已满 | `addSongToPlaylist()` 返回错误（具体错误码待实现时确认） | 显示"歌单已满，无法添加更多歌曲" |

### 边界情况

- **空歌单**：显示"该歌单没有歌曲"，提供返回修改链接选项
- **重复歌曲**：复用现有的去重逻辑，在结果页面显示跳过列表
- **歌曲在其他平台**：根据源顺序搜索其他平台，显示实际找到的平台

## 测试策略

### 单元测试

- 链接解析函数：测试各种链接格式识别
- 链接导入服务：测试解析成功和失败场景

### 集成测试

- 文本导入流程：测试完整的文本导入流程
- 链接导入流程：测试完整的链接导入流程

### 边界情况测试

- 空输入测试：验证空文本和空链接的提示
- 无效输入测试：验证无效链接格式的错误提示

## 文件变更

| 操作 | 文件 | 说明 |
|-----|------|------|
| 修改 | `src/renderer/components/ImportPlaylistModal.tsx` | 添加标签页切换和链接导入逻辑 |
| 新增 | `src/renderer/components/LinkImportForm.tsx` | 链接输入组件 |
| 新增 | `src/renderer/components/LinkPreviewTable.tsx` | 预览歌曲列表组件 |
| 修改 | `src/renderer/services/importService.ts` | 添加链接导入函数 |
| 新增 | `src/renderer/utils/songMatcher.ts` | 歌曲匹配工具函数 |
| 新增 | `src/renderer/__tests__/ImportPlaylistModal.test.tsx` | ImportPlaylistModal 组件测试 |
| 新增 | `src/renderer/__tests__/ImportWorkflow.test.tsx` | 导入工作流集成测试 |
| 新增 | `src/renderer/__tests__/LinkImportForm.test.tsx` | LinkImportForm 组件测试 |
| 新增 | `src/renderer/__tests__/LinkPreviewTable.test.tsx` | LinkPreviewTable 组件测试 |

## 实现状态

所有任务已完成：

- [x] Task 1: 添加链接解析函数到 importService.ts
- [x] Task 2: 添加链接导入函数到 importService.ts
- [x] Task 3: 创建 LinkImportForm 组件
- [x] Task 4: 创建 LinkPreviewTable 组件
- [x] Task 5: 重构 ImportPlaylistModal 添加标签页切换
- [x] Task 6: 集成测试和最终验证
- [x] Task 7: 文档更新

## 扩展性设计

- 架构支持未来扩展其他平台（QQ 音乐、酷狗等）
- 通过 `importMode` 状态管理支持多种导入方式
- 组件化设计便于添加新的导入方式

## 非目标

- 不支持批量导入多个链接（单个链接即可）
- 不支持其他平台链接（先支持网易云，后续扩展）
- 不修改现有的文本导入逻辑
- 不添加新的 IPC 通道（复用现有的 `getPlaylistSongsFromThirdParty`）