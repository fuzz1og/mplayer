import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AlbumScroll from '../components/AlbumScroll';

/**
 * 1.9.0 起卡片容器不再写内联 flexFlow，改由 .album-scroll__grid 类表达。
 * 断言因此拆成两半：组件挂对了类 + 类里确实是「横向排列且允许换行」。
 * 验的仍是同一个布局事实（卡片横排、超宽换行），只是不再钉「样式写在哪」。
 */
const songlistCss = readFileSync(
  path.resolve(__dirname, '../styles/songlist.css'),
  'utf8',
);

describe('AlbumScroll', () => {
  it('wraps album cards instead of forcing a single horizontal row', () => {
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

    expect(container.querySelector('.album-scroll__grid')).not.toBeNull();
    const gridRule = /\.album-scroll__grid \{[^}]*\}/.exec(songlistCss)?.[0] ?? '';
    expect(gridRule).toContain('display: flex');
    expect(gridRule).toContain('row wrap');
  });
});
