# 桌面：真 Electron / 打包产物

SKILL.md §1 的桌面分支。共享流程（命题清单 / 强度阶梯 / 附 PR）在上层，本节只讲桌面这一层怎么落地。

## 这一层证得到什么

| runtime | 怎么起 | 能证什么 | 证不到什么 |
|---|---|---|---|
| **真 Electron** | `node scripts/start-electron-dev.mjs --remote-debugging-port=9222` → `chromium.connectOverCDP('http://127.0.0.1:9222')` | 真 preload 桥（`window.electronAPI` 由 preload 注入，不是你写的 stub）、IPC 契约（sender 校验 / 通道形状 / 返回值）、主进程、托盘、懒加载路由真的加载 | 声音是否真的响（进程活着 ≠ 有音频输出）；原生合成 / DPI（WSLg 与真机桌面不同） |
| **打包产物** | `npm run electron:build:win` 后运行产物 | `loadFile(dist/index.html)` 这条分支、asar / resource 解析、更新器接线、生产图标 | 迭代速度（分钟级）。**只在改动触及打包 / 更新器 / asar / preload 路径时要求**——这是条件分支，不是每次验收都跑 |
| **Chromium + stub `window.electronAPI`** | `npm run dev`（5174）+ Playwright / 系统浏览器 | 渲染层几何与样式：布局、sticky 偏移、列宽、虚拟滚动、文案 | **preload 与主进程**——stub 的形状是你自己写的，不是契约。用它就必须在 PR 的 Evidence 里写明「证据来自 Chromium + stub」 |

**正面样本**：#564 那条 24px 缝就是这一层定出来的——#565 的 Evidence 写「Playwright + stub IPC 在真实 Chromium（1600×900，scrollTop=900）实测」，量出 `discover-playlist / artist-detail` 表头 `top: 0` / gap `24px` → 改后 `top: -24px` / gap `0`。
**反面样本**：#567「桌面实机点击确认：**未做**（本机无 Electron 运行验收环境）」；#508「**未做：未启动真 Electron**……本 session 未授权启动 Electron」。这样写是诚实的——不许把 stub 那一层的结论说成「已实测」。

## 身份锚

先证明 5174 上那份 Vite 服务的就是**这个 worktree**。这里的坑不是「找不到锚」，而是**跑错了也不报错**：`vite.config.ts:53-54` 只写 `port: 5174`、没写 `strictPort`，端口被别的 checkout 占用时 Vite 自己加一（5175），而 `scripts/start-electron-dev.mjs:10` 照样注入 `http://localhost:5174`——你驱动的是别人的渲染层，IPC 校验还照放行。三条，从弱到强：

1. 读 `npm run dev` 的输出：必须是 `Local: http://localhost:5174/`。出现 `Port 5174 is in use` 就杀干净重来，别接着跑。
2. 断言窗口 URL：`page.url().startsWith('http://localhost:5174')`——只证明「是个 dev server」，不证明是哪一个。
3. **最强的一条**：把这个 worktree 的服务取回来，在里面认出你改的新符号。

```powershell
curl.exe -s http://localhost:5174/src/renderer/components/SongRow.tsx | Select-String -SimpleMatch '你改的新符号'
```

Vite 按需转译（TS → ESM）后原样送出源码文本，符号名与字符串字面量都在；命中即证明这份文件正在被服务（改的是 CSS 就取 `.css`；路径用改动文件的仓库相对路径）。与移动分支对 bundle 做的是同一件事，只是这里的真相源是 dev server 的模块图。

主进程 / preload 的改动**不在** Vite 的模块图里：`vite-plugin-electron` 把它们打到 `dist-electron/`（`vite.config.ts:11-45`，入口 `src/main/main.ts` / `src/main/preload.ts`），换成对产物做同一招：

```powershell
Get-Item dist-electron/main.js | Select-Object LastWriteTime
Select-String -Path dist-electron/main.js -SimpleMatch '你改的新符号'
```

`LastWriteTime` 必须晚于你最后一次编辑 `src/main/**`，否则你驱动的是旧主进程。

没有更干净的锚：本仓库没有 build id、没有 `/health`、也没有「报出自己工作目录」的 IPC。上面就是今天能给的全部——**UNCERTAIN** 的地方只到这一步，别发明第四条。

## 起一次真窗口

四条前置，每条对应一种「看起来像应用坏了」的症状：

1. **`ELECTRON_RUN_AS_NODE` 必须清掉。** DSH 会把它传给子进程；留着 Electron 退化成纯 Node，启动即 `Cannot read properties of undefined (reading 'getVersion')`。`scripts/start-electron-dev.mjs:25` 已代为 `delete`——所以走这个脚本，别自己 `spawn(electron)`。
2. **`packages/core/dist` 必须新鲜**（`npm run core:build`）。Vite 吃 dist、typecheck 吃源码；dist 落后是**白屏**，唯一线索在渲染层控制台：`does not provide an export named '…'`。
3. **`VITE_DEV_SERVER_URL=http://localhost:5174`。** 主进程按它放行 IPC sender（`src/main/main.ts:98-107`）——漏了则所有 IPC 被拒，页面还在但什么都点不动。脚本 `:10` 注入默认值。
4. **路由是 hash 路由**（`src/renderer/router/index.tsx:2,70` 的 `createHashRouter` + 全 `lazy`）：`http://localhost:5174/#/hotlist/netease`。写成 `/hotlist/netease` 会落在首页——看起来像「页面不存在」，其实是路由没匹配。

起法：

```powershell
# 终端 A（等它打出 Local: http://localhost:5174/）
npm run dev
# 终端 B
node scripts/start-electron-dev.mjs --remote-debugging-port=9222
```

接管 + 断言 + 取证的最小骨架，写到 `test-results/tmp-verify.mjs`（`.gitignore:51` 已忽略，跑完删）：

```js
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
// dev 模式主进程会自动开 DevTools（src/main/main.ts:155-159），那是另一个窗口/target
const page = browser.contexts()[0].pages().find((p) => p.url().includes('localhost:5174'));
if (!page) throw new Error('没有 5174 的窗口：确认 Vite 在跑、URL 用 hash 写法');

await page.goto('http://localhost:5174/#/hotlist/netease');
await page.waitForFunction(() => !!document.getElementById('root')?.children.length);

const rows = await page.evaluate(() => document.querySelectorAll('.song-row').length);
const gap = await page.evaluate(() => {
  const th = document.querySelector('thead');
  const scroller = th.closest('.scroll-container'); // UNCERTAIN：换成你页面真正的滚动容器
  return th.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
});
console.log({ rows, gap }); // 这两行输出就是 Evidence 的正文

const cdp = await page.context().newCDPSession(page);
const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('test-results/evidence.png', Buffer.from(shot.data, 'base64'));
await browser.close(); // 只断 CDP，Electron 进程还活着（见「收尾」）
```

窗口还没出现时按 `e2e/player-bar-add-to-playlist.spec.ts:47-54` 那样轮询，不要用 `firstWindow()`。

**截图必须走 CDP `Page.captureScreenshot`**：`page.screenshot()` 在字体没就绪时会卡在 `waiting for fonts to load`（`docs/agents/testing.md:45`）。

**不要在测试里用 `_electron.launch`**：实测在本机 DSH 会话内起出白屏（渲染层报 `renderer.bundle.js script failed to run`，`docs/agents/testing.md:40`）。退路就是上面这条。

## 主进程日志

现状是**没有文件落点**：主进程只有 `console.*`（`src/main/main.ts:100,143,233` 等），落到 Electron 进程的 stdout/stderr，而 `scripts/start-electron-dev.mjs:33` 用 `stdio: 'inherit'` 把它们交给启动它的那个终端。仓库根目录那些 `electron-dev.out.log` 是人手 tee 出来的，没有任何脚本产生它们。**主进程的真相要靠你自己接住**——要么重定向到文件，要么用进程内已有的出口。

重定向（PowerShell 里 `%TEMP%` **不会**展开，写全路径）：

```powershell
node scripts/start-electron-dev.mjs --remote-debugging-port=9222 1> '<绝对路径>\electron-dev.out.log' 2> '<绝对路径>\electron-dev.err.log'
```

进程内已有出口（都要求 dev 模式 / 诊断开启）：

- `playbackTrace:list | clear | export` IPC——主进程播放解析链的会话内环形缓冲，`export` 弹保存对话框写 JSON（`src/main/ipc/playbackTrace.ts:7-21`，架构侧见 `docs/agents/architecture.md:51`）；
- 渲染层 `rendererLogStore`——全局接管 console 的约 30 行环形缓冲，只在诊断开启时记录（`docs/agents/architecture.md:36`）。

## 收尾

**关窗只是隐藏。** `mainWindow.on('close')` 是 `preventDefault()` + `hide()`（`src/main/main.ts:169-174`），`window-all-closed` 只在非 darwin 才 `quit()`（`:427-431`），`before-quit` 才置 `isQuitting`（`:434-436`）；托盘的「✕ 退出」是唯一优雅退出（`src/main/tray/trayManager.ts:53-58`）。所以「窗口没了」不等于「跑完了」，退出要硬杀。

**没有单实例锁**（`src/main/**` grep `requestSingleInstanceLock` = 0 命中）：泄漏的实例会和下一次运行**共享 `%APPDATA%\mplayer`**（同一份 storage / 缓存 / 队列），两个进程互相写盘、互抢 9222，症状是「上一轮的队列还在」「截图里是上一个版本」。

每次跑之前确认没有残留，跑完硬杀：

```powershell
Get-Process electron, MPlayer -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path
Stop-Process -Name electron -Force
```

（打包产物的进程名是 `MPlayer`；`scripts/prebuild.js:8` 也是这么杀的。）截图与临时脚本落 `e2e/screenshots/`、`e2e/artifacts/`、`test-results/`——三者均已 gitignore（`.gitignore:49-51`）。

## 桌面陷阱速查

- **没有稳定入口**：`package.json:15-43` 没有任何 e2e / playwright script，`scripts/verify.mjs:279-289` 没有 e2e scope，接 CI 已被否决（`docs/adr/2026-09-29-ci-verification-boundary.md:35`）。今天唯一跑法是 `npx playwright test`——**当前缺一个稳定入口**，别写出不存在的 `npm run e2e:desktop`。
- **12 个 spec 未接 CI 且已腐化**，用之前先看这三行：`cover-e2e.spec.ts:16` 与 `cover-scenarios.spec.ts:16` 把 dev server 打成 **5173**（Vite 在 5174）；`discover-v2.spec.ts:10` 指向已退役的自建 API；**12 个 spec 里 9 个根本不传 `VITE_DEV_SERVER_URL`**，主进程于是回落到 `loadFile(dist/index.html)`（`src/main/main.ts:155-162`），测的是**上一次构建的产物**而不是工作副本；只有 `player-bar-add-to-playlist.spec.ts:41` 传对了。不先确认这一点，「测过了」是假的。
- **Playwright 二进制缺失**（`Executable doesn't exist at …chromium_headless_shell-…`）：`npx playwright install chromium`（`e2e/README.md:253`）。`connectOverCDP` 接管真 Electron **不需要**它——这条报错只出现在 Playwright 自起浏览器（Chromium+stub 那一层）时。
- **`npm run electron:dev` 会先 `core:build` 并删掉 `dist-electron/main.js`**（`package.json:23`）：它跑着的时候别改主进程源码，也别把重建中的白屏当成改动引入的问题。
- **`npm run build` 有破坏性副作用**：`scripts/prebuild.js:8-13` 在 win32 上 `taskkill /f /im MPlayer.exe`，`:15-18` 删掉 `dist/` 与 `dist-electron/`。跑 build 前先收掉验收窗口，否则 `dist-electron/main.js` 被删、dev 中的 Electron 收不到主进程更新。
- **没有 readiness 信号**：没有 app-ready IPC、没有 health 端点，spec 里全是 `waitForTimeout`（`e2e/electron-e2e.spec.ts:19-20`）。改用 `page.waitForFunction(() => !!document.getElementById('root')?.children.length)` 轮询（`e2e/player-bar-add-to-playlist.spec.ts:59`）。
- **DevTools 是另一个窗口/target**，dev 模式自动开（`src/main/main.ts:155-159`）；`firstWindow()` 可能给你 DevTools，必须按 URL 选窗口（`e2e/player-bar-add-to-playlist.spec.ts:47-54`）。
- **locator 基本只能吃中文文案**：生产代码里 `data-testid` 只有 `PlayerControls.tsx:57` 一处；可用的稳定钩子是 class（`.song-row`，`src/renderer/components/SongRow.tsx:115`）与文案（`page.getByText('发现音乐')`、`page.getByPlaceholder('搜索音乐、歌手、专辑')`，`e2e/electron-e2e.spec.ts:52-60`）。
