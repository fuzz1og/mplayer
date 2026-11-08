import { describe, expect, it, vi } from 'vitest';
import { fetchAllDjRadioPrograms } from '../djRadioPrograms.js';
import type { DjRadioProgram } from '../../types/index.js';

const program = (id: string): DjRadioProgram => ({
  id,
  name: id,
  artist: '主播',
  album: '电台',
  url: '',
  cover: '',
  lrc: '',
  duration: 100,
  sourceType: 'netease',
  programId: `p-${id}`,
  radioId: 'radio',
  serialNum: 1,
  createTime: 0,
  listenerCount: 0,
  description: '',
  coverUrl: '',
});

describe('fetchAllDjRadioPrograms（#742）', () => {
  it('按 200 期串行续页，收齐全部可见节目后才返回', async () => {
    const pages = [
      { programs: [program('1'), program('2')], total: 3, more: true },
      { programs: [program('3')], total: 3, more: false },
    ];
    const fetchPage = vi.fn(async (_id: string, _offset: number, _limit: number) =>
      pages.shift() ?? { programs: [], total: 3, more: false });
    const all = await fetchAllDjRadioPrograms('radio', fetchPage);
    expect(all.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(fetchPage.mock.calls).toEqual([
      ['radio', 0, 200],
      ['radio', 2, 200],
    ]);
  });

  it('空页立即终止且原样上抛失败，不交出半截队列', async () => {
    const emptyFetch = vi.fn(async () => ({ programs: [], total: 0, more: true }));
    await expect(fetchAllDjRadioPrograms('radio', emptyFetch)).resolves.toEqual([]);
    expect(emptyFetch).toHaveBeenCalledTimes(1);

    const failedFetch = vi.fn(async () => {
      throw new Error('code=406 操作频繁，请稍后重试');
    });
    await expect(fetchAllDjRadioPrograms('radio', failedFetch)).rejects.toThrow(/406/);
  });
});
