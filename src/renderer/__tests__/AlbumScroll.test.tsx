import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import AlbumScroll from '../components/AlbumScroll';

describe('AlbumScroll', () => {
  it('wraps album cards instead of forcing a single horizontal row', () => {
    const { container } = render(
      <AlbumScroll
        albums={[
          { id: '1', name: 'Album 1', artist: 'Artist 1', picUrl: '', publishTime: '' },
          { id: '2', name: 'Album 2', artist: 'Artist 2', picUrl: '', publishTime: '' },
        ]}
        loading={false}
        error={null}
        area="ALL"
        onAreaChange={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(container.innerHTML).toContain('row wrap');
  });
});
