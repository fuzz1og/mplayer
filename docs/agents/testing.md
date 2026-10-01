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
| Expo 依赖一致性 | 读 Expo 远端 SDK 期望版本（`api.expo.dev`） | `CI=1 npx expo install --check`（`npm run verify -- expo`） | ✅ | `expo-check` |

CI 的 `check`、四个 `test` 分片与 `expo-check` 都只是 `verify.mjs <scope>` 的包装（`./scripts/verify.sh` 是它的两行 shim）；本地全量 = `npm run verify`（Windows 用这条——Windows 上 `bash` 可能是 WSL 的 Linux bash，见 #500）。**`expo` 是本仓唯一「上游可能让它自己变红」的检查**：Expo 发布新的期望补丁时会与仓库改动无关地变红，处置是 `npx expo install --fix`（理由见 ADR `docs/adr/2026-09-29-dependency-update-governance.md`）。Playwright 的 `e2e/` **不在**任何自动化里（见文末）。

- **本机判定口径（#521）**：`all` 会先 `build` 再连跑四套件。本机同时开着模拟器 / Metro，或把多套件**并行**跑时，`waitFor` 型集成用例会顶到超时，表现为**每次挂不同的用例**（实测 ImportWorkflow / sourceSwapFlow / LinkPreviewTable 轮流中招），单独跑分片则稳定全绿。**判绿用分片单跑（`npm run verify -- renderer` 等），不要并行跑多套件**；CI 的四个 `test` job 是独立 runner，不受此影响。
- **本机重装依赖后要补 Electron 二进制**：`npm ci` 会经 `prepare` 装好；与 CI 同款的 `npm ci --ignore-scripts` 跳过了 `electron` 的 postinstall，此后本机跑 `electron:dev` / `electron:build` 会缺 `node_modules/electron/dist` —— 补一条 `npm rebuild electron`（`release.yml` 为这条单独缓存 Electron 二进制）。
- **`verify` 的运行前自检**（先拦，不让你从别处的报错反推环境）：平台与当前 node 一致（#500）、**依赖树与 `package-lock.json` 一致**（#523：`node_modules` 落后时直接给「先 `npm ci`」的人话处置，不让 `lint` 的 `Cannot find module` 或 `core:build` 的 `pako` TS7016 替它背锅）；`core:build` 之后还会自证消费者读到的 dist 就是刚构建的这份（#521）。
- **`static` 的第一步是文档门禁**（`node scripts/docs-gate.mjs`，#523）：活文档里把 `scripts/*.sh`（现全为两行 shim）当命令推荐，或 `docs/agents/architecture.md` 的文件表漏记实现文件，都会让 `static` 与 CI 的 `check` 变红。允许清单（有意不记的文件）在脚本里；历史存档与非 Markdown 不扫。
- **`@mplayer/core` 的来源**：worktree 共享 node_modules（junction）时，`@mplayer/core` 可能解析到**主 clone** 的 `packages/core/dist`，于是新增导出报 `TS2305 has no exported member`（像代码错，实为环境错）。`verify.mjs` 现在启动即自证来源，并在每次 `core:build` 后自证「消费者解析到的 dist 就是刚构建的这份」。
  **但 junction 借不来构建**：Vite 把配置文件临时写到 `<root>/node_modules/.vite-temp/`（经 junction 落到**主 clone**），从那里向上解析永远看不到 worktree 的 `packages/core/node_modules`（`vite-plugin-dts` 装在那里）——`npm run core:build` 报 `Cannot find package 'vite-plugin-dts'`，连带 pre-commit 的 core 新鲜度自检也过不去。worktree 里要跑构建 / `verify` 就**真 `npm install`**（或 `cp -al` 硬链），只 junction root node_modules 只够 typecheck / lint。
- **本机 `node_modules` 可能落后 `package-lock.json`**：CI 走 `npm ci` 装 lock 的版本，主 clone 的可能是更早装的（实测踩过：`babel-preset-expo` 本机 57.0.5 而 lock 是 57.0.13，`react-native` 0.86.2 而 lock 是 0.87.1）。**凡要「引用已安装版本」下结论（读 `node_modules` 源码、报依赖版本、判定上游行为），先 `npm ci`，或只引用 lockfile 的版本**——否则结论对 CI 不成立，而且看起来完全像事实。`verify` 起跑前现在也会直接拦下这种树（#523）。
- **桌面手动驱动 Electron（agent / CDP 场景）**：`_electron.launch` 在本机（DSH 会话内）会起出一个白屏（渲染层报 `renderer.bundle.js script failed to run`），退路是自己起 + `connectOverCDP`，但有四条前置，缺一条就是「白屏」或「Electron 变纯 Node」：
  1. **清掉 `ELECTRON_RUN_AS_NODE`**（DSH 会传给子进程）：留着 Electron 退化成纯 Node，启动即 `Cannot read properties of undefined (reading 'getVersion')`。`scripts/start-electron-dev.mjs` 已代为清理；
  2. **`packages/core/dist` 必须新鲜**（`npm run core:build`）：Vite 吃 dist、typecheck 吃源码，dist 落后时**白屏**，只有渲染层控制台里有 `does not provide an export named '…'`；
  3. 手动 spawn 要带 `VITE_DEV_SERVER_URL=http://localhost:5174`——主进程的 IPC sender 校验按它放行，漏了则所有 IPC 被拒；
  4. 路由是 **HashRouter**：`http://localhost:5174/#/hotlist/netease`（写成 `/hotlist/netease` 会落在首页，看起来像"页面不存在"）。
  起法：`node scripts/start-electron-dev.mjs --remote-debugging-port=9222` → Playwright `chromium.connectOverCDP('http://127.0.0.1:9222')`；截图走 CDP `Page.captureScreenshot`（`page.screenshot()` 在字体没就绪时会卡在 "waiting for fonts to load"）。四条都是一次性踩坑记录（2026-10-01，桌面真机验收）。

- **Renderer（root）**: Vitest + jsdom + @testing-library；配置在 `vite.config.ts` 的 `test` 段（**无独立根 vitest.config.ts**），`include` 覆盖 `src/renderer/__tests__/**` 与 `src/__tests__/*.test.{ts,tsx}`（**仅顶层**；`src/__tests__/main/**` 归 Main 套件，不再在 jsdom 下重复跑一遍）。setup mock electron / `window.electronAPI`、matchMedia、ResizeObserver，并全局 stub antd message/notification；测试各自定义局部 `song()` 构造器（无共享 factory）。`npx vitest run` / `npm run test:run`（**依赖 `packages/core/dist`，先 `npm run core:build`**）
- **Main**: `vitest.main.config.ts`（node env），global electron mock，默认开 v8 coverage（`src/main/**`）。`npm run test:main`
- **Core**: `npx vitest run --config packages/core/vitest.config.ts`（走源码 alias，**不需要** dist），默认开 v8 coverage
- **Mobile**: `packages/mobile/vitest.config.ts`（node env），setup（`__tests__/setup.ts`）全局替身三件：`react-native` 最小面（AppRegistry/NativeModules/Platform/Share/NativeEventEmitter）、`expo`（`requireOptionalNativeModule` → null = 走回落引擎路径）、AsyncStorage；要验原生引擎的用例在自己的文件里 `vi.mock('expo')` 换假原生模块。store 测试用纯 getState/setState。`npx vitest run --config packages/mobile/vitest.config.ts`（按值 import `@mplayer/core` → 先 `npm run core:build`；`verify` 已内置这一步）
- 构造器注入可测性：diskBackend(cacheDir)、localMusicService(userDataPath)
- E2E 桌面: Playwright 在 `e2e/`，测试服务器 `npm run dev`（Vite，5174）；spec 不在 CI/verify 流程，属本地手工回归。**手动驱动（CDP 接管真实窗口）的前置与退路见上面「桌面手动驱动 Electron」那条**
- E2E 移动端: 真机一条龙 `npm run mobile:e2e`（`scripts/mobile-e2e.mjs`，adb + logcat + uiautomator 驱动，前置/断言/局限见 `e2e/README.md`）

### 回归测试的「修前红」配方

bugfix 的测试要证明「修前会红」，否则它在 CI 里只是装饰（规则见 `CODING_STANDARDS.md`）。固定五步：

1. 记下**修前 sha**（该实现最后一次被改之前的提交，通常是分支基座）。
2. 先记绿：`npx vitest run <测试文件> -t '<用例名>'`。
3. **只回退实现文件**（测试保持新版）：`git checkout <修前 sha> -- <实现文件>`，或临时投毒关键行。
4. 再跑同一条命令 → **必须红**；把红原文与退出码写进 PR 的 `Evidence`。
5. `git checkout -- <实现文件>` 还原 → 重跑确认绿 → `git status` 干净。

**第 4 步不红 = 测试没钉住行为**，最常见原因是**下游另有一次同名写入把它覆盖了**（#516 实测：跳歌路径写的游标被随后 `play()` 的同步覆盖，测试因此永远绿）——这时要把实验改成能隔离那一次写入的场景（如让 `play()` 早退）。

## 原生发版构建（本机）

PR / push 的 CI **不编译原生**（边界与理由见 ADR `docs/adr/2026-09-29-ci-verification-boundary.md`），要本机验证就跑发版同款命令：

```bash
cd packages/mobile/android
./gradlew assembleRelease bundleRelease --no-daemon
# 产物：app/build/outputs/apk/release/app-release.apk 与 app/build/outputs/bundle/release/app-release.aab
```

- **深层 worktree 的路径长度是真凶**：在 `.claude/worktrees/<name>` 这类深路径里构建，原生模块的对象路径会顶到 CMake 的 250 字符上限，症状是 `ninja: error: manifest 'build.ninja' still dirty after 100 tries`（**不是**依赖坏了，实测 arm64-v8a / armeabi-v7a / x86_64 都会撞）。两条修法任选：换到短路径检出或给 worktree 加 `subst` 短盘符（详见 skill `mobile-device-debugging` 的陷阱速查「CMake 250 字符对象路径上限」），或把 SDK 自带的 `cmake/<ver>/bin/ninja.exe`（3.22.1 里是 1.10.2）换成 **≥1.12**（较新 Ninja 处理长路径）。**Linux 不受影响**（发版的 `build-mobile` 跑 ubuntu-latest）。
- 原生依赖的版本基线是 **Expo SDK 的期望版本**，判定命令 `npx expo install --check`（即 `npm run verify -- expo`）；不要单独 bump `react-native` / `react-native-screens` / `safe-area-context` / `slider` / `svg`（`.github/dependabot.yml` 已对这些加 ignore），要升就整族随 SDK 一起升。
- **`expo install --check` 只看「已装版本」，不看 package.json 的声明地板**——地板落后它照样绿，所以声明地板要人工按 SDK 期望对齐；`expo` 全仓只保留一份（根与 `packages/mobile` 同范围）。见 ADR `docs/adr/2026-09-29-dependency-update-governance.md`。
- `npx expo-doctor` 只作参考、不作门禁：它会额外报本仓**设计性**的两条——`overrides` 把 metro 钉在 0.84.6 而 `@expo/metro` 要求精确 0.84.5；原生目录已提交 + `app.json` 配置的 CNG 反向布局被判「未同步」。

