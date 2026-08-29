# MPlayer E2E 测试指南

## 概述

本项目有两套 e2e：

- **桌面端（Electron / Web）**：`e2e/*.spec.ts` 用标准 `@playwright/test` 编写（`electron-e2e.spec.ts` 等以 `_electron.launch` 驱动 Electron），`npx playwright test` 运行；另有部分场景按 **MCP Playwright** 交互式风格人工执行（Claude Code 会话内用浏览器自动化工具）。
- **移动端真机**：`scripts/mobile-e2e.sh`，adb + logcat + uiautomator 驱动真机，与 Playwright 无关。见下文[「移动端真机 e2e」](#移动端真机-e2e)。

> 注意：`e2e/` 下的 `*.spec.ts` **不在 CI/verify 流程里**，属本地手工回归工具；`playwright.config.ts` 的 `testDir` 指向本目录。

## 快速开始

### 1. 启动测试服务器

```bash
# 桌面端 dev server（Vite，5174 端口）
npm run dev
```

### 2. 在 Claude Code 中执行测试

使用 MCP Playwright 工具进行交互式测试：

```typescript
// 示例：测试搜索功能

// 1. 导航到应用
await mcp__plugin_playwright_playwright__browser_navigate({
  url: 'http://localhost:5174'
});

// 2. 获取页面快照
const snapshot = await mcp__plugin_playwright_playwright__browser_snapshot();

// 3. 点击搜索框
await mcp__plugin_playwright_playwright__browser_click({
  target: '搜索输入框'
});

// 4. 输入关键词
await mcp__plugin_playwright_playwright__browser_type({
  target: '搜索输入框',
  text: '周杰伦'
});

// 5. 执行搜索
await mcp__plugin_playwright_playwright__browser_press_key({
  key: 'Enter'
});

// 6. 等待结果
await mcp__plugin_playwright_playwright__browser_wait_for({
  text: '搜索结果'
});

// 7. 截图保存
await mcp__plugin_playwright_playwright__browser_take_screenshot({
  type: 'png',
  filename: 'search-result.png'
});
```

## MCP Playwright 工具列表

| 工具 | 功能 | 示例 |
|------|------|------|
| `browser_navigate` | 导航到 URL | `{ url: 'http://localhost:5174' }` |
| `browser_snapshot` | 获取页面快照 | `{}` |
| `browser_click` | 点击元素 | `{ target: '按钮文本' }` |
| `browser_type` | 输入文本 | `{ target: '输入框', text: '内容' }` |
| `browser_press_key` | 按键操作 | `{ key: 'Enter' }` |
| `browser_wait_for` | 等待条件 | `{ text: '加载完成' }` |
| `browser_take_screenshot` | 截图 | `{ type: 'png', filename: 'result.png' }` |
| `browser_console_messages` | 查看控制台日志 | `{ level: 'error' }` |
| `browser_network_requests` | 查看网络请求 | `{ static: false }` |
| `browser_evaluate` | 执行 JavaScript | `{ function: '() => document.title' }` |
| `browser_hover` | 悬停 | `{ target: '元素' }` |
| `browser_drag` | 拖拽 | `{ startTarget: '源', endTarget: '目标' }` |
| `browser_select_option` | 选择下拉选项 | `{ target: '下拉框', values: ['选项1'] }` |
| `browser_fill_form` | 填充表单 | `{ fields: [...] }` |
| `browser_file_upload` | 上传文件 | `{ paths: ['file.txt'] }` |
| `browser_tabs` | 管理标签页 | `{ action: 'new', url: '...' }` |
| `browser_resize` | 调整窗口大小 | `{ width: 1280, height: 720 }` |
| `browser_handle_dialog` | 处理对话框 | `{ accept: true }` |
| `browser_close` | 关闭页面 | `{}` |

## 测试场景

### 场景 1：搜索功能

```typescript
// 步骤 1：打开应用
await browser_navigate({ url: 'http://localhost:5174' });

// 步骤 2：获取页面结构
const snapshot = await browser_snapshot();

// 步骤 3：点击搜索框
await browser_click({ target: '搜索输入框' });

// 步骤 4：输入关键词
await browser_type({ target: '搜索输入框', text: '周杰伦' });

// 步骤 5：执行搜索
await browser_press_key({ key: 'Enter' });

// 步骤 6：等待结果
await browser_wait_for({ text: '搜索结果' });

// 步骤 7：验证结果
const resultSnapshot = await browser_snapshot();

// 步骤 8：截图保存
await browser_take_screenshot({ type: 'png', filename: 'search-result.png' });
```

### 场景 2：播放功能

```typescript
// 步骤 1：打开应用
await browser_navigate({ url: 'http://localhost:5174' });

// 步骤 2：获取页面结构
const snapshot = await browser_snapshot();

// 步骤 3：点击歌曲
await browser_click({ target: '第一首歌曲' });

// 步骤 4：等待播放开始
await browser_wait_for({ text: '播放中' });

// 步骤 5：验证播放状态
const playbackSnapshot = await browser_snapshot();

// 步骤 6：检查播放进度
await browser_take_screenshot({ type: 'png', filename: 'playback.png' });
```

### 场景 3：歌单功能

```typescript
// 步骤 1：打开应用
await browser_navigate({ url: 'http://localhost:5174' });

// 步骤 2：切换到歌单页面
await browser_click({ target: '歌单标签' });

// 步骤 3：获取歌单列表
const playlistSnapshot = await browser_snapshot();

// 步骤 4：点击歌单
await browser_click({ target: '第一个歌单' });

// 步骤 5：等待详情加载
await browser_wait_for({ text: '歌单详情' });

// 步骤 6：验证详情
const detailSnapshot = await browser_snapshot();

// 步骤 7：截图保存
await browser_take_screenshot({ type: 'png', filename: 'playlist-detail.png' });
```

## 验证技巧

### 1. 使用 snapshot 验证页面状态

```typescript
const snapshot = await browser_snapshot();
// snapshot 包含页面元素树，可以验证：
// - 元素是否存在
// - 元素文本内容
// - 元素状态（可见/隐藏）
```

### 2. 使用 console_messages 检查错误

```typescript
const errors = await browser_console_messages({ level: 'error' });
// 检查是否有 JavaScript 错误
```

### 3. 使用 network_requests 验证 API 调用

```typescript
const requests = await browser_network_requests({ static: false });
// 验证：
// - API 请求是否发送
// - 请求参数是否正确
// - 响应状态是否正常
```

### 4. 使用 evaluate 执行自定义验证

```typescript
const title = await browser_evaluate({
  function: '() => document.title'
});

const elementCount = await browser_evaluate({
  function: '() => document.querySelectorAll(".song-item").length'
});
```

## 与传统 Playwright 对比

| 特性 | MCP Playwright | 传统 Playwright |
|------|----------------|-----------------|
| 安装依赖 | 无需安装 | npm install @playwright/test |
| 配置文件 | 无需配置 | playwright.config.ts |
| 测试文件 | 无需编写 | *.spec.ts 文件 |
| 运行方式 | 在 Claude Code 会话中 | npx playwright test |
| 执行环境 | Claude Code 会话 | CI/CD 或本地终端 |
| 结果持久化 | 会话内可用 | HTML 报告 + 截图 |
| 自动化程度 | 交互式（需人工触发） | 完全自动化 |
| 适用场景 | 探索性测试、调试 | 回归测试、CI 集成 |

## 最佳实践

### 1. 测试前准备

- 确保测试服务器运行：`npm run dev`（Vite dev server，5174 端口）
- 清除浏览器缓存（如果需要）
- 准备测试数据

### 2. 测试执行

- 每个步骤后使用 `snapshot` 验证状态
- 使用 `wait_for` 等待异步操作
- 使用 `console_messages` 检查错误

### 3. 结果验证

- 使用 `snapshot` 验证 UI 状态
- 使用 `network_requests` 验证 API 调用
- 使用 `screenshot` 记录关键步骤

### 4. 错误处理

- 检查 `console_messages` 中的错误
- 检查 `network_requests` 中的失败请求
- 使用 `screenshot` 记录错误状态

## WSL 环境配置

在 WSL 中使用 MCP Playwright，需要配置浏览器路径：

```bash
# 方式 1：安装 Playwright 浏览器
npx playwright install chromium

# 方式 2：使用 Windows 的 Chrome
export PLAYWRIGHT_CHROME_PATH="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"

# 方式 3：添加到 ~/.bashrc
echo 'export PLAYWRIGHT_CHROME_PATH="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"' >> ~/.bashrc
source ~/.bashrc
```

## 示例测试文件

查看 `e2e/electron-e2e.spec.ts` 文件，了解完整的测试场景定义（`_electron.launch` 驱动 Electron 的标准写法）。

## 移动端真机 e2e

`scripts/mobile-e2e.sh` 把「usbipd 直挂真机 → Metro → 冷启 → UI 走查 → 点歌出声」的手工验收流程固化为一条命令（adb 驱动，非 Playwright，跑在 WSL 开发机侧，不改 App 代码）。

### 前置条件

1. Android 真机经 usbipd 直挂进 WSL：`scripts/mobile-device/usb-attach.sh`（透传掉线重挂：`adb kill-server` 后 `usbipd attach --wsl --busid <busid>`，见 mobile-device-debugging skill 的陷阱清单）；
2. `@mplayer/core` 已构建（`packages/core/dist` 过期的症状是启动即 `undefined is not a function`，脚本会识别为明确 FAIL）；
3. Metro：8081 已有健康 Metro 则直接复用（校验归属、不杀不起第二个）；没有则脚本代为拉起。
4. 依赖：`adb`（`~/.local/bin/adb`）、`python3`（uiautomator dump 解析）。

### 运行方式

```bash
scripts/mobile-e2e.sh                       # 唯一设备 + 8081 Metro
MOBILE_E2E_SERIAL=<serial> scripts/mobile-e2e.sh          # 多设备时指定
MOBILE_E2E_DIR=/path/to/other/packages/mobile scripts/mobile-e2e.sh   # 复用别的 checkout/worktree 的 Metro
npm run mobile:e2e                          # 同上（包一层 npm script）
```

其余参数（等待秒数、端口、是否代拉 Metro 等）见脚本头部注释。

### 各断言含义

脚本按步骤输出 PASS/FAIL 摘要，任一步失败退出码为 1；每步截图与全程 logcat 存档到 `e2e/artifacts/`（已 gitignore，仅本地留档）：

| 步骤 | 断言 | 说明 |
|------|------|------|
| `device` | `adb devices` 有在位设备 | 双 transport 串线自动断无线；多设备要求 `MOBILE_E2E_SERIAL` |
| `reverse` | `adb reverse tcp:8081` 成功 | 手机侧 `localhost:8081` 通到本机 Metro |
| `metro` | dev server 健康 + manifest `extra.expoClient._internal.projectRoot` 匹配预期目录 | 识破陈年 Metro / 别的 worktree 起的 Metro 串线 |
| `coldstart` | logcat 有 `Running "main"` + `存量数据迁移完成`，且无 `undefined is not a function` | 前两者 = JS 跑起来 + 启动迁移接线跑到；后者 = core dist 断裂症状（FAIL） |
| `discover` | 点「发现」tab 后，排行榜四分区（网易云/QQ · 热歌/新歌）标题齐 + rank 数字行渲染 | 分区标题文本走 uiautomator dump 断言；截图存档供人工复核 |
| `hotlist-detail` | 点「QQ 音乐 · 新歌榜」分区头进详情页，全量列表 rank 节点 ≥8 | 可视行数随迷你播放栏/Toast 浮动，阈值取宽松值；语义是「列表真的渲染了行」 |
| `play` | 点列表第 2 首歌后，logcat 有 `[player] 开始播放《…》` + `播放器就绪(出声)`，屏幕上出现歌名文本 | 出声断言 + 底部迷你播放栏 UI 断言；截图存档 |

### 局限

- UI 坐标按参考机（OPPO PKB110, 1256x2760）手工校准，其他分辨率按 `wm size` 等比缩放，但没在别的机型上验证过；
- 文本断言依赖 uiautomator dump（RN 组件 → 原生 TextView）：uiautomator 在动画/滚动中会间歇性吐空壳树，脚本重试 + 失败即弃旧快照（绝不拿上一轮的过期内容做断言）；logcat 里 RN 多参数 console.log 渲染为 `'[player]', 'msg'`，断言一律匹配消息本体；
- usbipd 直挂的 attach 掉线是常态，脚本带自愈（重挂 + 重建 reverse + 复活 logcat 捕获），设备彻底消失（拔线/关调试）才 FAIL；
- 点歌断言依赖真实网络音源解析，接口故障会命中 FAIL——这是真实验收语义，不是脚本 bug。

## 相关文件

- `e2e/electron-e2e.spec.ts` 等 `*.spec.ts` - 桌面端 Playwright 测试场景
- `scripts/mobile-e2e.sh` - 移动端真机 e2e 一条龙脚本
- `e2e/README.md` - 本文档
- `e2e/artifacts/` - 移动端 e2e 截图与 logcat 存档（gitignore）

## 下一步

1. 配置 WSL 环境的浏览器路径
2. 运行测试服务器
3. 在 Claude Code 中执行测试
4. 根据测试结果调整测试场景
