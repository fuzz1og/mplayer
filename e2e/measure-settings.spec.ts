import { test } from '@playwright/test';

test('measure settings chain', async ({ page }) => {
  await page.addInitScript(() => {
    const noop = async () => undefined;
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      invoke: async (c: string) => {
        if (c === 'settings:getThemeMode') return 'system';
        if (c === 'cache:getStats') return { totalSize: 0, fileCount: 0, songsCount: 0, coversCount: 0, audioCount: 0, urlsCount: 0 };
        return undefined;
      },
      on: noop, removeListener: noop, send: noop,
    };
  });
  await page.goto('http://[::1]:5174/#/settings');
  await page.waitForTimeout(2000);
  const chain = await page.evaluate(() => {
    const rows: string[] = [];
    let el = document.querySelector('.ui-group') as HTMLElement | null;
    while (el && rows.length < 8) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      rows.push(el.className + ' | w=' + Math.round(r.width) + ' x=' + Math.round(r.x) + ' display=' + cs.display + ' flexDir=' + cs.flexDirection + ' alignSelf=' + cs.alignSelf + ' width=' + cs.width + ' maxW=' + cs.maxWidth);
      el = el.parentElement;
    }
    return rows;
  });
  console.log('[CHAIN]\n' + chain.join('\n'));
});
