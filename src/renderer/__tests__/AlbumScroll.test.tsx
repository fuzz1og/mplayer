import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AlbumScroll from '../components/AlbumScroll';

/**
 * #694：新碟上架与歌单 / 歌手共用同一个内容网格（列宽下限与间距都来自 global.css 的 token），
 * 三个 tab 切换时栅格不跳。断言拆成两半：组件真的渲染内容网格 + 类里确实是响应式网格。
 */
const songlistCss = readFileSync(
  path.resolve(__dirname, '../styles/songlist.css'),
  'utf8',
);

describe('AlbumScroll', () => {
  it('卡片容器是与歌单 / 歌手同栅格的内容网格，而不是固定宽度的横排', () => {
    const { container } = render(
      <AlbumScroll
        albums={[
          { id: '1', name: 'Album 1', artist: 'Artist 1', picUrl: '', publishTime: '', sourceType: 'netease' },
          { id: '2', name: 'Album 2', artist: 'Artist 2', picUrl: '', publishTime: '', sourceType: 'netease' },
        ]}
        loading={false}
        error={null}
        area="ALL"
        onAreaChange={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    // 新碟上架就是内容网格：同一个 .card-grid + 同一张 CardCover 卡
    expect(container.querySelector('.card-grid')).not.toBeNull();
    expect(container.querySelectorAll('.card-grid .cover-card').length).toBe(2);
    const gridRule = /\.card-grid \{[^}]*\}/.exec(songlistCss)?.[0] ?? '';
    expect(gridRule).toContain('display: grid');
    expect(gridRule).toContain('repeat(auto-fill, minmax(var(--content-grid-min), 1fr))');
    expect(gridRule).toContain('gap: var(--content-grid-row-gap) var(--content-grid-col-gap)');
  });
});
