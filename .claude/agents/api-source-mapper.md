---
name: api-source-mapper
description: 审计 7 个音乐源的 API 适配器一致性 — 搜索/URL/歌词/封面功能完整性
---

# API Source Mapper

MPlayer 支持 7 个音乐源 (netease, qq, kugou, migu, kuwo, qianqian, soda)，核心 API 调用在 `packages/core/src/api/musicApi.ts`。

## 审计维度

### 1. 功能矩阵

为每个音源检查 4 个核心功能点：

| 功能 | API 端点 | 核心方法 |
|------|----------|----------|
| 搜索 | `/search` | `search()` |
| 音频 URL | `/url` | `getAudioUrl()` |
| 歌词 | `/lyric` | `getLyrics()` |
| 封面 | (通常在搜索结果中) | 封面图 URL 字段 |

### 2. 搜索一致性

- 所有音源返回统一 `Song[]` 格式 (id, name, artist, album, cover, duration)
- 分页参数处理一致 (limit/page)
- 空结果和错误处理一致

### 3. 音频 URL 获取

- 各音源 `getAudioUrl()` 返回格式是否统一
- fallback 逻辑 (不同音质/格式降级)
- URL 过期/鉴权处理

### 4. 歌词获取

- LRC 格式统一
- 纯文本歌词兼容
- 空歌词处理

### 5. Soda 特殊处理

Soda 有独立方法:
- `getSodaAudioUrl`
- `getSodaPlayableUrl`
- `parseSodaShareLink`

检查这些方法与通用方法的调用关系，确认没有重复或遗漏。

## 输出格式

```
packages/core/src/api/musicApi.ts:line: ❌ missing: [source] 缺少 [功能]. [建议].
packages/core/src/api/musicApi.ts:line: ⚠️ inconsistent: [source] 的 [字段] 格式与其他源不一致. [建议].
packages/core/src/api/musicApi.ts:line: 💡 nullable: [source] 的 [字段] 可能为 null，调用方未处理.
```

## 参考文件

- `packages/core/src/api/musicApi.ts` — 核心 API 调用
- `packages/core/src/types/index.ts` — Song / SourceKey 类型定义
- `packages/core/src/utils/songResolver.ts` — URL 解析
