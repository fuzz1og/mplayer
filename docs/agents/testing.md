# MPlayer 质量工具（tsconfig / ESLint / Testing）

低频参考：跑验证或改测试配置时读此处。

## tsconfig Strictness

Root 开 `noUnusedLocals/noUnusedParameters`；root tsconfig `"exclude": ["src/renderer/__tests__", "packages"]`（root typecheck 不含 renderer 测试与 mobile）。

```bash
npx tsc --noEmit                                        # root
npx tsc --noEmit --project packages/mobile/tsconfig.json # mobile
```

## ESLint

flat config（`eslint.config.js`），全局 ignores 与 `--no-warn-ignored` 语义见该文件；`--max-warnings 0`。

## Testing

四套件与验证入口的对应关系（**改测试配置或 CI 时同步这张表**）：

| 套件 | 配置 | 命令 | 本地全量 | CI |
|---|---|---|---|---|
| Renderer + `src/__tests__` 顶层 | `vite.config.ts` 的 `test` 段（jsdom） | `npm run test:run` | ✅ | `test (renderer)` |
| Main（主进程） | `vitest.main.config.ts`（node + v8 coverage） | `npm run test:main` | ✅ | `test (main)` |
| Core | `packages/core/vitest.config.ts`（node + v8 coverage） | `npm test -w packages/core` | ✅ | `test (core)` |
| Mobile | `packages/mobile/vitest.config.ts`（node） | `npx vitest run --config packages/mobile/vitest.config.ts` | ✅ | `test (mobile)` |
| Expo 依赖一致性 | 读 Expo 远端 SDK 期望版本（`api.expo.dev`） | `CI=1 npx expo install --check`（`./scripts/verify.sh expo`） | ✅ | `expo-check` |

CI 的 `check`、四个 `test` 分片与 `expo-check` 都只是 `./scripts/verify.sh <scope>` 的包装；本地全量 = `./scripts/verify.sh`。**`expo` 是本仓唯一「上游可能让它自己变红」的检查**：Expo 发布新的期望补丁时会与仓库改动无关地变红，处置是 `npx expo install --fix`（理由见 ADR `docs/adr/2026-09-29-dependency-update-governance.md`）。Playwright 的 `e2e/` **不在**任何自动化里（见文末）。

- **Renderer（root）**: Vitest + jsdom + @testing-library；配置在 `vite.config.ts` 的 `test` 段（**无独立根 vitest.config.ts**），`include` 覆盖 `src/renderer/__tests__/**` 与 `src/__tests__/*.test.{ts,tsx}`（**仅顶层**；`src/__tests__/main/**` 归 Main 套件，不再在 jsdom 下重复跑一遍）。setup mock electron / `window.electronAPI`、matchMedia、ResizeObserver，并全局 stub antd message/notification；测试各自定义局部 `song()` 构造器（无共享 factory）。`npx vitest run` / `npm run test:run`（**依赖 `packages/core/dist`，先 `npm run core:build`**）
- **Main**: `vitest.main.config.ts`（node env），global electron mock，默认开 v8 coverage（`src/main/**`）。`npm run test:main`
- **Core**: `npx vitest run --config packages/core/vitest.config.ts`（走源码 alias，**不需要** dist），默认开 v8 coverage
- **Mobile**: `packages/mobile/vitest.config.ts`（node env），setup 只 mock AsyncStorage（`__tests__/setup.ts`）；store 测试用纯 getState/setState。`npx vitest run --config packages/mobile/vitest.config.ts`（按值 import `@mplayer/core` → 先 `npm run core:build`；`verify.sh` 已内置这一步）
- 构造器注入可测性：diskBackend(cacheDir)、localMusicService(userDataPath)
- E2E 桌面: Playwright 在 `e2e/`，测试服务器 `npm run dev`（Vite，5174）；spec 不在 CI/verify 流程，属本地手工回归
- E2E 移动端: 真机一条龙 `npm run mobile:e2e`（`scripts/mobile-e2e.sh`，adb + logcat + uiautomator 驱动，前置/断言/局限见 `e2e/README.md`）

## 原生发版构建（本机）

PR / push 的 CI **不编译原生**（边界与理由见 ADR `docs/adr/2026-09-29-ci-verification-boundary.md`），要本机验证就跑发版同款命令：

```bash
cd packages/mobile/android
./gradlew assembleRelease bundleRelease --no-daemon
# 产物：app/build/outputs/apk/release/app-release.apk 与 app/build/outputs/bundle/release/app-release.aab
```

- **Windows 前置**：SDK 自带的 CMake 3.22.1 打包的是 **Ninja 1.10.2**，有已知长路径 bug，C++ 阶段会报 `ninja: error: manifest 'build.ninja' still dirty after 100 tries`（实测 arm64-v8a / armeabi-v7a 都会撞上）。把该 `cmake/<ver>/bin/ninja.exe` 换成 **≥1.12** 即可通过——与 React Native Reanimated 的 *Building for Android on Windows* 指南给出的解法一致。**Linux 不受影响**（发版的 `build-mobile` 跑 ubuntu-latest）。
- 原生依赖的版本基线是 **Expo SDK 的期望版本**，判定命令 `npx expo install --check`；不要单独 bump `react-native` / `react-native-screens` / `safe-area-context` / `slider` / `svg`（`.github/dependabot.yml` 已对这些加 ignore），要升就整族随 SDK 一起升。

