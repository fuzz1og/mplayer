import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CoverImage from '../components/CoverImage';

describe('CoverImage 失败状态随 src 重置', () => {
  it('src 加载失败显示兜底，换新 src 后重新尝试加载', () => {
    const onError = vi.fn();
    const { rerender } = render(<CoverImage src="https://stale.jpg" alt="x" onError={onError} />);

    // 旧 src 加载失败 → 兜底 + onError 回调
    const img1 = screen.getByAltText('x') as HTMLImageElement;
    fireEvent.error(img1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText('x')).toBeNull(); // 已切兜底（无 img）

    // 换新 src（封面刷新成功）→ failed 状态重置，重新渲染 img
    rerender(<CoverImage src="https://fresh.jpg" alt="x" onError={onError} />);
    const img2 = screen.getByAltText('x') as HTMLImageElement;
    expect(img2.src).toContain('fresh.jpg');

    // 新 src 正常加载则不再兜底
    fireEvent.load(img2);
    expect(screen.getByAltText('x')).toBe(img2);
  });

  it('相同 src 失败后不重置（避免无限重试循环）', () => {
    const onError = vi.fn();
    const { rerender } = render(<CoverImage src="https://same.jpg" alt="x" onError={onError} />);
    fireEvent.error(screen.getByAltText('x'));
    expect(onError).toHaveBeenCalledTimes(1);

    // 相同 src 重新渲染（父级重渲染）→ failed 保持，仍显示兜底
    rerender(<CoverImage src="https://same.jpg" alt="x" onError={onError} />);
    expect(screen.queryByAltText('x')).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1); // 不重复触发
  });
});
