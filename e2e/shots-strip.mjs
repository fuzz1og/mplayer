import { openShots } from './lib/shots.mjs';

/** 一级页面的页头与首行落点走查（#717 收进统一驱动）：每页一张，打印页头尺寸与首行 y 坐标。 */

const probe = (page) => page.evaluate(() => {
  const el = document.querySelector('.ui-page-header');
  const h1 = document.querySelector('.ui-page-header__title');
  const head = el ? el.getBoundingClientRect() : null;
  const firstRow = document.querySelector('.discover-filters, .list-page__tabs, .rec__flow, .card-grid, .playlists__scroll, .library__body');
  return {
    h1: h1 ? h1.textContent.trim() : null,
    h1box: h1 ? Math.round(h1.getBoundingClientRect().width) + 'x' + Math.round(h1.getBoundingClientRect().height) : null,
    headerH: head ? Math.round(head.height) : null,
    firstRowY: firstRow ? Math.round(firstRow.getBoundingClientRect().y) : null,
    eyebrow: document.querySelectorAll('.ui-page-hero__eyebrow').length,
  };
});

const shots = await openShots('strip');
await shots.go('#/recommend', 4000); await shots.shot('1-recommend', probe);
await shots.go('#/discover', 2500); await shots.shot('2-discover', probe);
await shots.go('#/favorites', 2000); await shots.shot('3-favorites', probe);
await shots.go('#/history', 2000); await shots.shot('4-history', probe);
await shots.go('#/playlists', 1500); await shots.shot('5-playlists', probe);
await shots.go('#/local', 2000); await shots.shot('6-local', probe);
await shots.go('#/settings', 1500); await shots.shot('7-settings', probe);
await shots.go('#/hotlist/3778678', 4000); await shots.shot('8-hotlist', probe);
await shots.finish();
