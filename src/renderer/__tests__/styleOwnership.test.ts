import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** #696 样式所有权台账：引用者必须恰好等于消费者，入口只留 token/base；改归属就改台账。 */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
/** 本文件在 <root>/src/renderer/__tests__/ 下，基准取 <root>/src */
const srcRoot = join(testDir, '..', '..');
const rendererRoot = join(srcRoot, 'renderer');
const read = (rel: string) => readFileSync(join(srcRoot, rel), 'utf8');
const toPosix = (p: string) => p.split(sep).join('/');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 样式文件 → 谁 import 它（路径相对 src/renderer） */
const OWNERSHIP: Record<string, string[]> = {
  // ── 底座：只由入口 main.tsx 引用 ──
  'styles/global.css': ['main.tsx'],
  'styles/base.css': ['main.tsx'],

  // ── 应用骨架：App.tsx 自己 ──
  'styles/app-shell.css': ['App.tsx'],

  // ── 组件各自拥有 ──
  'styles/titlebar.css': ['components/TitleBar.tsx'],
  'styles/sidebar.css': ['components/Sidebar.tsx'],
  'styles/player-bar.css': [
    'components/PlayerBar.tsx',
    'components/PlayerControls.tsx',
    'components/PlayerProgress.tsx',
    'components/PlayerVolume.tsx',
  ],

  // ── 页面各自拥有 ──
  'styles/settings.css': ['components/SettingsShell.tsx', 'pages/SettingsPage.tsx'],
  'styles/library.css': ['components/DownloadsDialog.tsx', 'pages/LocalPage.tsx'],
  'styles/player.css': ['pages/LyricsPage.tsx'],
  'styles/page-discover.css': [
    'pages/DiscoverPageV2.tsx',
    'pages/DiscoverPlaylistDetailPage.tsx',
    'pages/DiscoverPlaylistListPage.tsx',
  ],
  'styles/page-playlist-detail.css': ['pages/PlaylistDetailPage.tsx'],

  // ── 歌曲列表协议：行 / 菜单 / 骨架 / 封面，谁用谁引 ──
  'styles/songlist.css': [
    'components/AlbumGrid.tsx',
    'components/AlbumScroll.tsx',
    'components/AudioTagBadge.tsx',
    'components/ChartPanel.tsx',
    'components/CollectionGrid.tsx',
    'components/DownloadProgressModal.tsx',
    'components/ErrorBoundary.tsx',
    'components/GroupedSongList.tsx',
    'components/LyricsDisplay.tsx',
    'components/PlaylistPageGrid.tsx',
    'components/QueuePanel.tsx',
    'components/RowActionButtons.tsx',
    'components/SongCover.tsx',
    'components/SongList.tsx',
    'components/SongListSkeleton.tsx',
    'components/SongRow.tsx',
    'components/SortableSongRow.tsx',
    'components/SourceBadge.tsx',
    'components/VirtualSortableList.tsx',
    'pages/AlbumDetailPage.tsx',
    'pages/ArtistDetailPage.tsx',
    'pages/ArtistListPage.tsx',
    'pages/FavoritesPage.tsx',
    'pages/HistoryPage.tsx',
    'pages/HotlistDetailPage.tsx',
    'pages/PlaylistsPage.tsx',
    'pages/RecommendPage.tsx',
  ],

  // ── 内容卡：整仓唯一的封面卡实现，谁渲染都由它自己引样式 ──
  'styles/cover-card.css': ['components/CoverCard.tsx'],

  // ── 原语自带样式（ui/ 目录内，组件与样式同名同目录） ──
  'styles/queue-panel.css': ['components/QueuePanel.tsx'],
  'styles/detail-toolbar.css': ['components/DetailToolbar.tsx'],
  'styles/detail-page.css': [
    'pages/AlbumDetailPage.tsx',
    'pages/ArtistDetailPage.tsx',
    'pages/DiscoverPlaylistDetailPage.tsx',
    'pages/HotlistDetailPage.tsx',
    'pages/PlaylistDetailPage.tsx',
  ],
  'ui/forms.css': ['ui/forms.tsx'],
  'ui/tooltip.css': ['ui/tooltip.tsx'],
  'ui/overlay.css': ['ui/overlay.tsx', 'ui/menu.tsx'],
  'ui/page.css': ['ui/page.tsx'],
  'ui/ui.css': ['ui/button.tsx', 'ui/input.tsx', 'ui/layout.tsx', 'ui/tag.tsx'],
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, acc);
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const sourceFiles = () =>
  walk(rendererRoot).filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'));

/** 抓 import '…css'，按 import 图解析成相对 src/renderer 的样式路径 */
function cssImporters(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of sourceFiles()) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const importer = toPosix(relative(rendererRoot, file));
    const re = /import\s+['"]([^'"]+\.css)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(src)) !== null) {
      const spec = match[1];
      const abs = spec.startsWith('@/')
        ? join(srcRoot, spec.slice(2))
        : spec.startsWith('.')
          ? resolve(dirname(file), spec)
          : join(srcRoot, spec);
      const rel = toPosix(relative(rendererRoot, abs));
      map.set(rel, [...(map.get(rel) ?? []), importer]);
    }
  }
  return map;
}

const sorted = (list: string[]) => [...list].sort();

describe('样式所有权（#696）', () => {
  const importers = cssImporters();

  it('路由与入口不再注入页面/组件样式：合并入口已删除', () => {
    const router = stripComments(read('renderer/router/index.tsx'));
    expect(router).not.toMatch(/import\s+['"][^'"]+\.css['"]/);

    const main = stripComments(read('renderer/main.tsx'));
    const mainCss = [...main.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((m) => m[1]);
    // 入口只拿两样：token 事实源 + 跨页面底座；页面/组件样式一律由自己引
    expect(mainCss.sort()).toEqual(['./styles/base.css', './styles/global.css']);

    const app = stripComments(read('renderer/App.tsx'));
    const appCss = [...app.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((m) => m[1]);
    // App 只拥有自己的骨架样式；页面/组件样式不得经 App 注入
    expect(appCss).toEqual(['./styles/app-shell.css']);

    // shell.css 是被拆掉的那份合并壳样式，不应该再回来
    expect(importers.has('styles/shell.css')).toBe(false);
  });

  it('每个样式文件只被台账里的消费者引用', () => {
    for (const [file, owners] of Object.entries(OWNERSHIP)) {
      expect(sorted(importers.get(file) ?? []), `${file} 的引用者`).toEqual(sorted(owners));
    }
  });

  it('没有孤儿样式文件：renderer 下每份 css 都在台账里', () => {
    const orphans = walk(rendererRoot)
      .filter((file) => file.endsWith('.css'))
      .map((file) => toPosix(relative(rendererRoot, file)))
      .filter((rel) => !(rel in OWNERSHIP));
    expect(orphans).toEqual([]);
  });

  it('global.css 是唯一豁免的 token 文件：不再夹带任何组件/元素样式', () => {
    const css = stripComments(read('renderer/styles/global.css'));
    // design-lint 的 DESKTOP_TOKEN_FILES 豁免的是「颜色/字号事实源」；
    // 豁免文件里出现类选择器就说明组件样式又回流了
    expect(css).not.toMatch(/^\.[a-zA-Z]/m);
    expect(css).not.toMatch(/^[a-zA-Z]+\s*\{/m);
    expect(css).toContain(':root {');
  });

  // #694 回归护栏：拆分样式时漏掉一个「}」不会让 lint 变红，但会让后续规则被解析成嵌套规则而静默失效
  // （标题栏窗口控制就是这样从横排变成竖排的）。这里逐文件校验花括号配平。
  it('每个样式文件的花括号都配平（漏/多一个 } 会让后续规则静默丢失）', () => {
    const dirs = ['styles', 'ui'];
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of readdirSync(join(rendererRoot, dir))) {
        if (!file.endsWith('.css')) continue;
        const rel = dir + '/' + file;
        const css = readFileSync(join(rendererRoot, rel), 'utf8');
        const open = (css.match(/\{/g) ?? []).length;
        const close = (css.match(/\}/g) ?? []).length;
        if (open !== close) offenders.push(rel + ' {' + open + ' / }' + close);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('base.css 只放跨页面底座，不夹带单组件/单页面样式', () => {
    const css = stripComments(read('renderer/styles/base.css'));
    const forbidden = [
      '.player-',
      '.titlebar__',
      '.sidebar__',
      '.settings-',
      '.app-shell',
      '.song-row',
        '.lyrics',
      '.library-',
      '.discover-',
    ];
    for (const selector of forbidden) {
      expect(css.includes(selector), `base.css 不该出现 ${selector}`).toBe(false);
    }
  });
});
