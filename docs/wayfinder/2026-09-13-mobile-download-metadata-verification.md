# 移动端下载文件嵌入元数据 —— 技术验证归档

> 归档日期：2026-09-13 · 关联 issue #189 · 状态：**暂不排期**（不在 roadmap）
> 性质：开工前的技术验证记录。结论来自源码阅读 + 本机实测；凡未实测处均显式标注，不给推测。

---

## 背景

移动端下载的歌曲没有元数据：文件里未嵌封面/标题/歌手/时长，`.lrc` 侧车常缺失，下载页列表封面是 `Music` 占位图标。桌面端已有完整能力（`writeMetadata`：读文件 → `detectAudioContainer` → `tagStrategyForContainer` → 抓封面 → core `buildID3Frames` → `mp3tag.js` 写 ID3，见 `src/main/services/downloadService.ts:93`）。

issue #189 正文列出的「风险点」三条，开工前逐一实测，结果**两条与预期不同、一条前提已失效**。本文留档，避免后人按旧假设开工。

---

## 一、三项风险实测结论

### ① Metro 能否打包 mp3tag.js（exports map 的 mjs 入口）→ **可通过**

```bash
cd packages/mobile
npx expo export:embed --platform android --entry-file .probe-entry.ts \
  --bundle-output /tmp/probe.bundle --dev false
# → Android Bundled 1394ms .probe-entry.ts (3290 modules)，退出码 0
```

对产物 grep：出现 `node_modules/mp3tag.js/dist/mp3tag.mjs` —— **Metro 实际解析到 ESM 入口**（非 CJS 的 `dist/mp3tag.js`）；产物含 `MP3Tag`、`APIC`、`ID32`、`3.17.0` 符号。代价约 +390KB（未压缩）。

### ② expo File write 写回二进制（覆盖 / 截断语义）→ **覆盖并截断，符合预期**

证据 `node_modules/expo-file-system/android/src/main/java/expo/modules/filesystem/FileSystemFile.kt:87-104`：

```kotlin
fun write(content: TypedArray, append: Boolean = false) {
  if (uri.isContentUri) { file.outputStream(append).use { ... } }   // SAF: "w"
  else { FileOutputStream(javaFile, append).use { it.channel.write(content.toDirectBuffer()) } }
}
```

- `file://` → `FileOutputStream(file, false)`：截断
- `content://`（SAF）→ `SAFDocumentFile.kt:75-79` 的 `openOutputStream(uri, "w")`：截断

实测 m4a 写标签后体积 5,199,428 → 5,191,435 字节（**变小**），覆盖写不留尾巴。

### ③ mp3tag.js 入参契约 → **必须做类型归一化，否则直接抛错**

issue 正文未列此条，但这是最容易踩的坑：

```js
new MP3Tag(uint8array)   // ✗ TypeError: buffer is not ArrayBuffer/Buffer
new MP3Tag(arrayBuffer)  // ✓ read/save 正常
```

而 `File#bytes()` 返回的正是 `Uint8Array`，**不能直接喂给 mp3tag**：

```ts
const u8 = await file.bytes();
const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
// ...
const out = mt.save({ id3v2: { padding: container === 'm4a' ? 0 : 2048 } }); // 返回 Buffer，非 ArrayBuffer
await file.write(new Uint8Array(out as ArrayBuffer));
```

m4a 往返实测通过：`TIT2` / `TPE1` / `TALB` / `TLEN(213000)` / `APIC(image/png, 51B)` 全部写入并可读回，容器头 `ftyp` 完好。

---

## 二、正文需修正的一处（风险点第三条前提已失效）

原「风险点」第三条写「封面 URL 的会话保护（`resolveCoverUrl` 预处理）」—— **该前提已不存在**：

- `resolveCoverUrl` 于 `d4f5f60`（#276 自建 API 机件整删）一并删除；
- `95d6ae8` 桌面渲染层改为直链直渲 + `onError` 重搜。

现无会话保护需要预处理。真正需要的是封面 CDN 的 Referer 校验，core 已有 `refererForUrl` / `refererForSourceKey`（`packages/core/src/utils/sourceReferer.ts`）。但 RN `Image` 组件无法自定义 Referer → **取字节走 `fetch` + 按源 Referer，列表渲染走远端直链**。

---

## 三、修正后的落地方案

### 快档（可独立先落，离线可测）

1. `packages/mobile/stores/downloadStore.ts:5` —— `DownloadItem` 加 `cover?: string`；`doDownload` 的 `addItem` 带上 `song.cover`；`updateStatus` 的 `Partial<Pick<...>>` 白名单同步加 `cover`。persist **不必 bump version**（可选字段，旧记录 `undefined` → 渲染走占位，无需 data migration）。
2. `packages/mobile/app/(tabs)/download.tsx:161-163` —— `<Music>` 占位换 `useRefreshedCover`（复用 `SongRow` 同款失效兜底 + `withCoverSearchSlot` 并发闸门），封面为空/加载失败回退占位。
3. `writeLyricsSidecar`（`packages/mobile/services/downloadService.ts:307`）—— `song.lrc` 为空**或**内容不过 `looksLikeLyrics` 时，用 `searchStrictMatch` 取新 lrc URL 再取一次，仍不过守卫则跳过。失败静默（对齐现有风格）。

### 全档（必须真机验证）

**不抽到 core**：会把 mp3tag.js 拉进 core 的依赖图，波及双端 bundle；抽出的收益仅省约 40 行编排，破坏面大于收益。

在 `packages/mobile/services/downloadService.ts` 新增 `writeMetadata(file, song)`，对齐桌面 `src/main/services/downloadService.ts:93`：

```
@mplayer/core 的 bytes → detectAudioContainer → tagStrategyForContainer === 'skip' 则 return（FLAC/Ogg 不错灌）
→ 类型归一化（Uint8Array → ArrayBuffer）
→ fetch 封面字节（按 song.sourceType 带 Referer）
→ buildID3Frames（core 纯函数，直接复用）
→ new MP3Tag(ab).read() → 写 TIT2/TPE1/TALB/TLEN/APIC → save({ id3v2: { padding: m4a ? 0 : 2048 } })
→ file.write(new Uint8Array(out))
```

- 调用点必须在 `correctContainerName` **之后**（此时扩展名才正确）；
- 整体 try/catch 静默 —— 元数据写失败**不得影响下载结果**，对齐现有「侧车失败不阻断」风格。

### 测试

- 扩展 `packages/mobile/__tests__/downloadService.test.ts` 的 `FakeFile`：加 `bytes()`（返回带真实 ID3/m4a 头的 `Uint8Array`）、`write()` 记录入参。
- **mp3tag.js 用真包**（纯 JS，node 环境可跑）—— mock 掉就测不出「`Uint8Array` 直接抛错」这个真实陷阱。
- 必补断言：① 类型归一化生效（直接传 Uint8Array 会抛错的路径被绕开）；② FLAC 容器不写标签；③ 元数据写失败时 `status === 'done'` 且文件保留。
- core 侧 `tagging.test.ts` / `container.test.ts` 已覆盖纯函数，**无需补**。

---

## 四、唯一未验证项

**Hermes 引擎上真正跑一次 `new MP3Tag(...)`**。打包成功 ≠ 运行时不炸（mp3tag 内含 core-js polyfill 与 `typeof Buffer` 守卫）。这条只能在真机上闭环，是落地时最后一步的核心内容。

---

## 五、任务拆分与回退

依赖顺序：① 下载页封面 → ② 歌词侧车兜底 → ③ `writeMetadata` → ④ 真机验收。

| # | 内容 | 能否离线验证 |
|---|---|---|
| 1 | downloadStore 加 `cover` + download.tsx 渲染 | 单测 |
| 2 | `writeLyricsSidecar` 兜底 | 单测 |
| 3 | `writeMetadata` + 类型归一化 | 单测（真 mp3tag） |
| 4 | 真机验收 + Hermes 运行时确认 | **必须真机** |

**回退方案**：若第 ③ 步在 Hermes 下运行时报错，退化为「另存新文件再 `move` 覆盖」，不影响 ①②。

---

## 附：验证方法可复现性说明

以上 ①②③ 的实测均在主克隆 `packages/mobile/` 下用临时探针文件完成，探针与 `/tmp` 产物已全部删除，工作区未被污染。