import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AudioTagBadge from '../components/AudioTagBadge';

describe('AudioTagBadge（播放后回写徽标文案）', () => {
  it('preview 显示「试听」', () => {
    render(<AudioTagBadge tag="preview" />);
    expect(screen.getByText('试听')).toBeInTheDocument();
  });

  it('invalid 显示「不可播」', () => {
    render(<AudioTagBadge tag="invalid" />);
    expect(screen.getByText('不可播')).toBeInTheDocument();
  });
});
