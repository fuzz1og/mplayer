---
name: electron-build
description: 多平台 Electron 桌面端构建打包 — 版本号检查、构建、产物验证。用户发起时触发。
disable-model-invocation: true
---

# Electron Build

构建打包 Electron 桌面端。

## 使用

```
/electron-build          # 当前平台构建
/electron-build win      # Windows 构建
/electron-build mac      # macOS 构建
/electron-build linux    # Linux 构建
```

## 流程

### 1. 前置检查

```bash
npm run lint
npm run typecheck
npm run test:run
```

失败则停止。

### 2. 确认版本

```bash
node -p 'require("./package.json").version'
```

确认版本号正确，如需变更先 `npm version <patch|minor|major> --no-git-tag-version`。

### 3. 构建

```bash
# 当前平台
npm run electron:build

# 指定平台
npm run electron:build:win    # Windows
npm run electron:build:mac    # macOS
npm run electron:build:linux  # Linux
```

### 4. 产物验证

```bash
# 检查 dist/ 和 dist-electron/ 存在
ls -la dist/ dist-electron/

# 检查安装包
ls -la release/ 2>/dev/null || ls -la dist/

# 产物大小
du -sh release/* 2>/dev/null || du -sh dist/*.{exe,dmg,AppImage,deb} 2>/dev/null
```

### 5. 清理

如需完全重新构建:
```bash
npm run build    # 触发 prebuild.js (清理 dist/ + dist-electron/)
```

## 常见问题

| 错误 | 解决 |
|------|------|
| `electron-builder` 下载失败 | 检查网络，配置镜像源 |
| 代码签名失败 | 跳过签名 `--config.forceCodeSigning=false` |
| 平台不兼容 | 在对应 OS 上构建 (cross-platform 用 CI) |
| Vite 缓存问题 | 删除 `node_modules/.vite/` 后重试 |
