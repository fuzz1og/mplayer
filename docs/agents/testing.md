# MPlayer 质量工具（tsconfig / ESLint / Testing）

低频参考：跑验证或改测试配置时读此处。

## tsconfig Strictness

Root 开 `noUnusedLocals/noUnusedParameters`；root tsconfig `"exclude": ["packages"]`（root typecheck 不含 mobile）。

```bash
npx tsc --noEmit                                        # root
npx tsc --noEmit --project packages/mobile/tsconfig.json # mobile
```

## ESLint

flat config（`eslint.config.js`），全局 ignores 与 `--no-warn-ignored` 语义见该文件；`--max-warnings 0`。

## Testing

- **Renderer**: Vitest + jsdom + @testing-library。setup mock electron/matchMedia；factories 提供 createSong()。`npx vitest run`
- **Main**: `vitest.main.config.ts`（node env），global electron mock。`npx vitest run --config vitest.main.config.ts`
- **Core**: `npm run core:build` 后 `npx vitest run --config packages/core/vitest.config.ts`
- **Mobile**: `packages/mobile/vitest.config.ts`（node env），setup mock AsyncStorage/Alert/musicApi；store 测试用纯 getState/setState。`npx vitest run --config packages/mobile/vitest.config.ts`
- 构造器注入可测性：diskBackend(cacheDir)、localMusicService(userDataPath)
- E2E 桌面: Playwright 在 `e2e/`，测试服务器 `npx vite --config vite.test.config.ts --port 5174`；spec 不在 CI/verify 流程，属本地手工回归
- E2E 移动端: 真机一条龙 `npm run mobile:e2e`（`scripts/mobile-e2e.sh`，adb + logcat + uiautomator 驱动，前置/断言/局限见 `e2e/README.md`）
