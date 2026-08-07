import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CoverImage from '../components/CoverImage';

vi.mock('@/renderer/services/coverUrlResolver', () => ({
  resolveCoverUrl: vi.fn(),
}));

import { resolveCoverUrl } from '@/renderer/services/coverUrlResolver';

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

describe('CoverImage 会话保护封面解析', () => {
  it('解析完成前不渲染 img（避免 onError 抢占），完成后渲染 CDN 直链', async () => {
    let resolveFn!: (url: string) => void;
    vi.mocked(resolveCoverUrl).mockReturnValue(
      new Promise((r) => {
        resolveFn = r;
      })
    );
    const onError = vi.fn();

    const { rerender } = render(
      <CoverImage src="https://api.example.com/api.php?get=pic&id=1&sign=s&t=1" alt="x" onError={onError} />
    );
    expect(screen.queryByAltText('x')).toBeNull(); // 解析中：兜底，无 img
    expect(onError).not.toHaveBeenCalled();

    await act(async () => {
      resolveFn('https://cdn.example.com/cover.jpg');
    });

    const img = screen.getByAltText('x') as HTMLImageElement;
    expect(img.src).toContain('https://cdn.example.com/cover.jpg');
    expect(onError).not.toHaveBeenCalled();

    // src 换新 → 重新进入解析流程
    vi.mocked(resolveCoverUrl).mockReturnValue(Promise.resolve('https://cdn.example.com/new.jpg'));
    rerender(<CoverImage src="https://api.example.com/api.php?get=pic&id=2&sign=s&t=2" alt="x" onError={onError} />);
    await act(async () => {});
    const img2 = screen.getByAltText('x') as HTMLImageElement;
    expect(img2.src).toContain('https://cdn.example.com/new.jpg');
  });
});
