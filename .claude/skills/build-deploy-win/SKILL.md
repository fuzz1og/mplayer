---
name: build-deploy-win
description: 构建 MPlayer 并部署到 Windows 测试。当用户说"构建"、"打包"、"部署"、"试用"、"build"时触发。
---

# MPlayer 构建部署

## 标准构建流程（WSL → Windows）

按顺序执行，每步确认成功后再继续。

### 1. 质量检查

```bash
npm run typecheck
```

失败则**停止**并报告错误。Lint 失败可跳过（不影响构建产物功能）。

### 2. 构建

```bash
npm run electron:build:win
```

产物位于 `dist/`：NSIS 安装包 + portable 版本。

### 3. 部署到 Windows

```bash
cp dist/*.exe /mnt/c/Users/Admin/Downloads/
explorer.exe "$(wslpath -w /mnt/c/Users/Admin/Downloads)"
```

### 4. 报告

输出：文件名、大小、路径（WSL + Windows），提示用户在 Downloads 双击安装。

## 跨平台构建

| 命令 | 平台 | 产物 |
|------|------|------|
| `npm run electron:build` | 当前平台 | 自动检测 |
| `npm run electron:build:win` | Windows | `.exe` (NSIS + portable) |
| `npm run electron:build:mac` | macOS | `.dmg` + `.zip` |
| `npm run electron:build:linux` | Linux | `.AppImage` + `.deb` |

macOS 构建需要 macOS 环境。Linux 构建可用 Wine。

## 故障排查

- **构建失败**：`rm -rf dist/ dist-electron/` 后重试
- **原生模块问题**：`npm rebuild`
- **依赖问题**：`rm -rf node_modules && npm install`
- **Windows Defender 报警**：更多信息 → 仍要运行
