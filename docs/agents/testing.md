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

CI 的 `check` 与四个 `test` 分片都只是 `./scripts/verify.sh <scope>` 的包装；本地全量 = `./scripts/verify.sh`。Playwright 的 `e2e/` **不在**任何自动化里（见文末）。

- **Renderer（root）**: Vitest + jsdom + @testing-library；配置在 `vite.config.ts` 的 `test` 段（**无独立根 vitest.config.ts**），`include` 覆盖 `src/renderer/__tests__/**` 与 `src/__tests__/*.test.{ts,tsx}`（**仅顶层**；`src/__tests__/main/**` 归 Main 套件，不再在 jsdom 下重复跑一遍）。setup mock electron / `window.electronAPI`、matchMedia、ResizeObserver，并全局 stub antd message/notification；测试各自定义局部 `song()` 构造器（无共享 factory）。`npx vitest run` / `npm run test:run`（**依赖 `packages/core/dist`，先 `npm run core:build`**）
- **Main**: `vitest.main.config.ts`（node env），global electron mock，默认开 v8 coverage（`src/main/**`）。`npm run test:main`
- **Core**: `npx vitest run --config packages/core/vitest.config.ts`（走源码 alias，**不需要** dist），默认开 v8 coverage
- **Mobile**: `packages/mobile/vitest.config.ts`（node env），setup 只 mock AsyncStorage（`__tests__/setup.ts`）；store 测试用纯 getState/setState。`npx vitest run --config packages/mobile/vitest.config.ts`（按值 import `@mplayer/core` → 先 `npm run core:build`；`verify.sh` 已内置这一步）
- 构造器注入可测性：diskBackend(cacheDir)、localMusicService(userDataPath)
- E2E 桌面: Playwright 在 `e2e/`，测试服务器 `npm run dev`（Vite，5174）；spec 不在 CI/verify 流程，属本地手工回归
- E2E 移动端: 真机一条龙 `npm run mobile:e2e`（`scripts/mobile-e2e.sh`，adb + logcat + uiautomator 驱动，前置/断言/局限见 `e2e/README.md`）
