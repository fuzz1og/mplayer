import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * #694 信息架构真 Electron 证据：侧栏两段 + 四个内容库页 × 1024/1280 × 浅色/深色。
 * 每张截图前断言：侧栏恰好 2 个分组标题、资料库段 4 项、页内 segmented 恰好 3 段。
 * 用法：node e2e/shots-ia.mjs（cwd = 仓库根；输出到 D:/Playground/_mplayer-agent/shots-ia）
 */

const WORKTREE = path.resolve(import.meta.dirname, '..');
const OUT = 'D:/Playground/_mplayer-agent/shots-ia';
const USER_DATA = path.join(OUT, 'user-data');
const FIXTURE = path.join(OUT, 'fixture-music');

const SEED_SONGS = [
  song('n1', '晨雾里的街', '陆行舟', '夜行城市'),
  song('n2', '慢速快门', '陆行舟', '夜行城市'),
  song('n3', '北岸线', '陆行舟', '潮汐手记'),
  song('n4', '未寄出的信', '苏晚', '潮汐手记'),
  song('n5', '纸飞机', '苏晚', '小满'),
  song('n6', '闷热', '苏晚', '小满'),
  song('n7', '雨停之前', '陈屿', '梅雨季'),
  song('n8', '梧桐', '陈屿', '梅雨季'),
  song('n9', '公路电影', 'Wildcard', 'Road Movie'),
  song('n10', 'Late Checkout', 'Wildcard', 'Road Movie'),
  song('n11', 'Midnight Tides', 'Mono Lake', 'Blue Hour'),
  song('n12', 'Static Bloom', 'Mono Lake', 'Blue Hour'),
  song('n13', '旧站台', '陆行舟', '夜行城市'),
  song('n14', '第七个夏天', '苏晚', '小满'),
];

const LOCAL_SONGS = [
  ['本地样例 · 晨雾里的街', '陆行舟', '夜行城市'],
  ['本地样例 · 慢速快门', '陆行舟', '夜行城市'],
  ['本地样例 · 纸飞机', '苏晚', '小满'],
  ['本地样例 · 闷热', '苏晚', '小满'],
  ['本地样例 · 梧桐', '陈屿', '梅雨季'],
];

function song(id, name, artist, album) {
  return { id: 'seed:' + id, name, artist, album, duration: 236, sourceType: 'netease' };
}

function seedLocalLibrary() {
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE, { recursive: true });
  const dataDir = path.join(USER_DATA, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const localSongs = LOCAL_SONGS.map(([name, artist, album], index) => ({
    id: 'local-seed:' + index,
    name,
    artist,
    album,
    duration: 200 + index,
    sourceType: 'local',
    filePath: path.join(FIXTURE, 'track-' + (index + 1) + '.mp3').replace(/\\/g, '/'),
    format: 'mp3',
    fileSize: 4_000_000,
  }));
  for (let index = 0; index < localSongs.length; index += 1) {
    fs.writeFileSync(localSongs[index].filePath, '');
  }

  const hash = crypto.createHash('md5').update(FIXTURE).digest('hex');
  fs.writeFileSync(path.join(dataDir, 'songs-' + hash + '.json'), JSON.stringify(localSongs));
  fs.writeFileSync(
    path.join(dataDir, 'folders.json'),
    JSON.stringify([{ path: FIXTURE, name: '样例曲库', lastScanned: new Date().toISOString() }], null, 2),
  );
}

const VIEWS = [
  { hash: '#/favorites', name: 'favorites', title: '我喜欢的音乐', selected: '我喜欢的音乐' },
  { hash: '#/history', name: 'history', title: '最近播放', selected: '最近播放' },
  { hash: '#/playlists', name: 'playlists', title: '我的歌单', selected: '我的歌单', noSegmented: true },
  { hash: '#/local', name: 'local', title: '本地', selected: '本地' },
];
const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];
const THEMES = ['light', 'dark'];

const failures = [];
const report = { app: 'real electron', worktree: WORKTREE, shots: [], assertions: {}, consoleErrors: [], pageErrors: [] };

function check(ok, message) {
  if (!ok) failures.push(message);
}

async function readIA(page) {
  return page.evaluate(() => ({
    groupLabels: Array.from(document.querySelectorAll('.sidebar__group-label')).map((el) => el.textContent?.trim()),
    labels: Array.from(document.querySelectorAll('.sidebar__label')).map((el) => el.textContent?.trim()),
    segmented: Array.from(document.querySelectorAll('.ui-segmented__option')).map((el) => el.textContent?.trim()),
    h1: document.querySelector('.ui-page-header__title')?.textContent?.trim(),
    selected: Array.from(document.querySelectorAll('.sidebar__item[aria-current="page"]')).map((el) => el.textContent?.replace(/\d+$/, '').trim()),
    sidebarBg: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
  }));
}

async function settle(page, ms = 700) {
  await page.waitForTimeout(ms);
}

async function main() {
  seedLocalLibrary();
  fs.mkdirSync(OUT, { recursive: true });

  const env = { ...process.env, NODE_ENV: 'development' };
  delete env.VITE_DEV_SERVER_URL;
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: ['--no-sandbox', '--force-device-scale-factor=1', '--user-data-dir=' + USER_DATA, '.'],
    cwd: WORKTREE,
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => report.pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  await page.waitForLoadState('domcontentloaded');
  await settle(page, 2500);

  // 收藏 / 历史 / 歌单用真实 IPC 落盘，再 reload 让 store 取到数据
  await page.evaluate(async (songs) => {
    const api = window.electronAPI;
    for (const item of songs) {
      await api.invoke('favorite:add', item);
      await api.invoke('history:add', item);
    }
    for (const name of ['晨间通勤', '写作专注', '深夜电台']) {
      await api.invoke('playlist:create', name, '信息架构验收截图');
    }
  }, SEED_SONGS);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await settle(page, 2000);

  const setSize = async ({ width, height }) => {
    const applied = await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return null;
      win.setBounds({ width: size.width, height: size.height });
      win.setContentSize(size.width, size.height);
      return { bounds: win.getBounds(), content: win.getContentSize() };
    }, { width, height });
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    console.log('[size] ' + JSON.stringify({ requested: { width, height }, applied, viewport }));
    await settle(page, 600);
  };

  const goto = async (hash) => {
    await page.evaluate((next) => { location.hash = next; }, hash);
    await settle(page, 800);
  };

  const themeBackgrounds = { light: new Set(), dark: new Set() };

  for (const size of SIZES) {
    await setSize(size);
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await settle(page, 300);

      for (const view of VIEWS) {
        await goto(view.hash);
        const ia = await readIA(page);

        check(JSON.stringify(ia.groupLabels) === JSON.stringify(['发现', '资料库']), view.name + ': 侧栏分组标题应为 发现/资料库，实际 ' + JSON.stringify(ia.groupLabels));
        check(ia.labels.length === 6, view.name + ': 侧栏入口应为 6 个（2 发现段 + 4 资料库段），实际 ' + JSON.stringify(ia.labels));
        check(JSON.stringify(ia.labels.slice(0, 2)) === JSON.stringify(['推荐', '发现']), view.name + ': 发现段应为 推荐/发现，实际 ' + JSON.stringify(ia.labels.slice(0, 2)));
        check(JSON.stringify(ia.labels.slice(2)) === JSON.stringify(['我喜欢的音乐', '最近播放', '我的歌单', '本地']), view.name + ': 资料库段应为 4 项，实际 ' + JSON.stringify(ia.labels.slice(2)));
        check(ia.h1 === view.title, view.name + ': 页头应为 ' + view.title + '，实际 ' + ia.h1);
        check(JSON.stringify(ia.selected) === JSON.stringify([view.selected]), view.name + ': 侧栏选中项应为 ' + view.selected + '，实际 ' + JSON.stringify(ia.selected));

        if (view.noSegmented) {
          check(ia.segmented.length === 0, view.name + ': 歌单页不应有 segmented，实际 ' + JSON.stringify(ia.segmented));
          const cards = await page.locator('.mcard').count();
          check(cards > 0, view.name + ': 歌单网格应有卡片，实际 ' + cards);
        } else {
          check(JSON.stringify(ia.segmented) === JSON.stringify(['歌曲', '专辑', '歌手']), view.name + ': 页内 segmented 恒为 3 段 歌曲/专辑/歌手，实际 ' + JSON.stringify(ia.segmented));

          // 三视角切换真的落到现有网格组件上（专辑 AlbumGrid / 歌手卡）
          await page.getByRole('radio', { name: '专辑' }).click();
          await settle(page, 400);
          const albumCards = await page.locator('.album-grid__item').count();
          check(albumCards > 0, view.name + ': 专辑段应有聚合专辑卡，实际 ' + albumCards);
          await page.getByRole('radio', { name: '歌手' }).click();
          await settle(page, 400);
          const artistCards = await page.locator('.artist-card').count();
          check(artistCards > 0, view.name + ': 歌手段应有聚合歌手卡，实际 ' + artistCards);
          await page.getByRole('radio', { name: '歌曲' }).click();
          await settle(page, 400);

          if (theme === 'light' && size.width === 1280) {
            await page.getByRole('radio', { name: '专辑' }).click();
            await settle(page, 400);
            await page.screenshot({ path: path.join(OUT, view.name + '-1280-light-albums.png') });
            await page.getByRole('radio', { name: '歌手' }).click();
            await settle(page, 400);
            await page.screenshot({ path: path.join(OUT, view.name + '-1280-light-artists.png') });
            await page.getByRole('radio', { name: '歌曲' }).click();
            await settle(page, 400);
          }
        }

        const file = path.join(OUT, view.name + '-' + size.width + '-' + theme + '.png');
        await page.screenshot({ path: file });
        report.shots.push(file);
        themeBackgrounds[theme].add(ia.sidebarBg);
      }

      // 侧栏证据：选中态（当前页）+ 悬停态（另外一个未选中项）
      await goto('#/favorites');
      await page.locator('.sidebar__item', { hasText: '最近播放' }).hover();
      await settle(page, 300);
      const hoverState = await page.evaluate(() => {
        const hovered = Array.from(document.querySelectorAll('.sidebar__item')).find((el) => el.textContent?.includes('最近播放'));
        const selected = document.querySelector('.sidebar__item[aria-current="page"]');
        return {
          hoverBg: hovered ? getComputedStyle(hovered).backgroundColor : '',
          selectedBg: selected ? getComputedStyle(selected).backgroundColor : '',
          selectedLabel: selected?.textContent?.replace(/\d+$/, '').trim(),
        };
      });
      check(hoverState.hoverBg !== 'rgba(0, 0, 0, 0)' && hoverState.hoverBg !== 'transparent', '侧栏悬停态没有表面变化: ' + hoverState.hoverBg);
      check(hoverState.selectedBg !== 'rgba(0, 0, 0, 0)' && hoverState.selectedBg !== 'transparent', '侧栏选中态没有表面变化: ' + hoverState.selectedBg);
      check(hoverState.selectedLabel === '我喜欢的音乐', '侧栏选中态应停在 我喜欢的音乐，实际 ' + hoverState.selectedLabel);

      const sidebarShot = path.join(OUT, 'sidebar-' + size.width + '-' + theme + '.png');
      await page.locator('.sidebar').screenshot({ path: sidebarShot });
      report.shots.push(sidebarShot);
    }
  }

  // 旧深链：/library 必须落到我喜欢的音乐；/download 必须打开本地页的下载管理弹窗
  await goto('#/library');
  const libraryRedirect = await page.evaluate(() => ({
    hash: location.hash,
    h1: document.querySelector('.ui-page-header__title')?.textContent?.trim(),
  }));
  check(libraryRedirect.hash === '#/favorites', '/library 应重定向到 /favorites，实际 ' + libraryRedirect.hash);
  check(libraryRedirect.h1 === '我喜欢的音乐', '/library 重定向后应是我喜欢的音乐页，实际 ' + libraryRedirect.h1);

  await goto('#/download');
  await settle(page, 700);
  const downloadRedirect = await page.evaluate(() => ({
    hash: location.hash,
    // 同屏可能还有更新提示等应用级弹窗：只认标题为「已下载」的那一块
    dialogTitles: Array.from(document.querySelectorAll('dialog[open] .ui-dialog__title')).map((el) => el.textContent?.trim()),
  }));
  check(downloadRedirect.hash === '#/local?downloads=1', '/download 应重定向到 /local?downloads=1，实际 ' + downloadRedirect.hash);
  check(downloadRedirect.dialogTitles.includes('已下载'), '/download 重定向后应打开下载管理弹窗，实际弹窗 ' + JSON.stringify(downloadRedirect.dialogTitles));
  report.redirects = { library: libraryRedirect, download: downloadRedirect };

  check(themeBackgrounds.light.size === 1 && themeBackgrounds.dark.size === 1, '浅色/深色侧栏背景应各只有一种取值，实际 light=' + Array.from(themeBackgrounds.light) + ' dark=' + Array.from(themeBackgrounds.dark));
  check(Array.from(themeBackgrounds.light)[0] !== Array.from(themeBackgrounds.dark)[0], '浅色与深色应渲染出不同侧栏背景');

  report.assertions = {
    groupLabels: 2,
    libraryItems: 4,
    segmentedPerPage: 3,
    themeBackgrounds: {
      light: Array.from(themeBackgrounds.light),
      dark: Array.from(themeBackgrounds.dark),
    },
  };
  report.failures = failures;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf-8');

  console.log('截图 ' + report.shots.length + ' 张 → ' + OUT);
  console.log('断言失败 ' + failures.length + ' 条');
  for (const failure of failures) console.log('  ✗ ' + failure);
  if (report.pageErrors.length > 0) console.log('页面异常 ' + report.pageErrors.length + ' 条: ' + report.pageErrors.join(' | '));
  if (report.consoleErrors.length > 0) console.log('控制台错误 ' + report.consoleErrors.length + ' 条（前 3 条）: ' + report.consoleErrors.slice(0, 3).join(' | '));

  await app.close();
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
