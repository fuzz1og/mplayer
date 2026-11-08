import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');

describe('DJ 电台移动端接线（#742）', () => {
  it('电台节目行按普通歌曲行展示收藏/更多，并暴露单期简介', () => {
    const page = read('app/djradio/[id].tsx');
    expect(page).not.toContain('hideActions');
    expect(page).toContain('hideSwap');
    expect(page).toContain('description={item.description || undefined}');
    const row = read('components/SongRow.tsx');
    expect(row).toContain('accessibilityLabel={description');
  });

  it('电台页保留 reason/message 并给出 404/406/网络失败/不支持三态文案', () => {
    const page = read('app/djradio/[id].tsx');
    expect(page).toContain('describeDjRadioFailure');
    expect(page).toContain('detailFailure');
    expect(page).toContain('programsFailure');
    expect(page).toContain('getDjRadioProgramsRouted');
  });

  it('搜索 djradiosError 是可读字符串，失败显示 406/网络/不支持具体文案', () => {
    const search = read('app/(tabs)/search.tsx');
    expect(search).toContain("useState('')");
    expect(search).toContain('describeDjRadioSearchFailure');
    expect(search).toContain('{djradiosError}');
    expect(search).not.toContain('setDjradiosError(true)');
  });

  it('歌手页电台失败显示轻量错误与重试，卡片与搜索卡片都不显示 programCount', () => {
    const artist = read('app/artist/[id]/index.tsx');
    const search = read('app/(tabs)/search.tsx');
    expect(artist).toContain('radiosError');
    expect(artist).toContain('setRadiosReloadKey');
    for (const source of [artist, search]) {
      expect(source).not.toMatch(/programCount\s*\?/);
    }
  });

  it('播放全部与下载全部共用 core 全量 helper，失败不建半截队列', () => {
    const page = read('app/djradio/[id].tsx');
    expect(page).toContain('fetchAllDjRadioPrograms');
    expect(page).toContain('setQueue(all, 0)');
    expect(page).toContain('allBusyRef.current');
    expect(page).toContain('Alert.alert(\'播放失败\'');
  });
});
