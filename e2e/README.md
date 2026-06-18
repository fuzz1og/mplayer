# MPlayer E2E 测试指南

## 概述

本项目使用 **MCP Playwright** 进行 E2E UI 测试。MCP Playwright 是 Claude Code 的一个 MCP 插件，无需安装额外依赖，直接在会话中使用浏览器自动化工具。

## 快速开始

### 1. 启动测试服务器

```bash
# 使用测试专用配置（不包含 Electron 插件）
npx vite --config vite.test.config.ts --port 5174
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

- 确保测试服务器运行：`npx vite --config vite.test.config.ts --port 5174`
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

查看 `e2e/example.spec.ts` 文件，了解完整的测试场景定义。

## 相关文件

- `vite.test.config.ts` - 测试专用 Vite 配置
- `e2e/example.spec.ts` - 测试场景示例
- `e2e/README.md` - 本文档

## 下一步

1. 配置 WSL 环境的浏览器路径
2. 运行测试服务器
3. 在 Claude Code 中执行测试
4. 根据测试结果调整测试场景
