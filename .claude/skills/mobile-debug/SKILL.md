---
name: mobile-debug
description: Expo/React Native 移动端调试助手 — 构建、清理缓存、修复常见 Expo 报错。用户发起时触发。
disable-model-invocation: true
---

# Mobile Debug

Expo/React Native 调试和构建。

## 使用

```
/mobile-debug android    # Android 构建
/mobile-debug web        # Web 预览
/mobile-debug clean      # 清除 Expo 缓存
/mobile-debug fix        # 常见问题修复
```

## 调试流程

### 1. Android 构建

```bash
cd packages/mobile
npx expo run:android
```

先检查:
- Android SDK 环境 (`echo $ANDROID_HOME`)
- `packages/mobile/android/` 是否存在 (不存在先 `npx expo prebuild`)
- 设备/模拟器连接 (`adb devices`)

### 2. Web 预览

```bash
cd packages/mobile
npx expo start --web
```

### 3. 清除缓存

```bash
cd packages/mobile
npx expo start -c          # 清除 metro 缓存
# 或深清
rm -rf node_modules/.cache
npx expo start -c
```

### 4. 常见问题

| 症状 | 修复 |
|------|------|
| Metro bundle 失败 | `npx expo start -c` 清除缓存 |
| prebuild 报错 | 删除 `android/` 和 `ios/` 目录，重新 `npx expo prebuild --clean` |
| babel 配置问题 | 确认 `babel.config.js` 存在且包含 `expo` preset |
| expo-av 编译失败 | 检查原生模块版本与 Expo SDK 兼容性 |
| tsconfig 报错 | 在 `packages/mobile/` 下运行 `npx tsc --noEmit` |
| 包版本冲突 | `npx expo install --fix` 自动修复兼容版本 |

### 5. 构建产物清理

```bash
# 完整重置
cd packages/mobile
rm -rf android ios node_modules
npm install
npx expo prebuild --clean
```

## 注意

- 始终在 `packages/mobile/` 目录下执行命令
- `core:build` 需先执行 (`npm run core:build` 在根目录)
- 不要在 worktree 外运行移动端命令
