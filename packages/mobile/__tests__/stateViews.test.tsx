// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => vi.importActual('react-native-web'));

vi.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    CircleAlert: Icon,
    Music2: Icon,
    RefreshCw: Icon,
  };
});

import { CircleAlert, Music2, RefreshCw } from 'lucide-react-native';
import { ThemeProvider } from '../theme/ThemeProvider';
import EmptyState from '../components/EmptyState';
import InlineError from '../components/InlineError';

afterEach(cleanup);

const renderWithTheme = (node: ReactNode) => render(<ThemeProvider>{node}</ThemeProvider>);

describe('空态 / 错态组件', () => {
  it('page 变体渲染标题与主操作', () => {
    const onAction = vi.fn();
    renderWithTheme(
      <EmptyState
        icon={Music2}
        title="歌单是空的"
        subtitle="从发现页或搜索里添加歌曲"
        actionLabel="去发现音乐"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('歌单是空的')).toBeTruthy();
    fireEvent.click(screen.getByText('去发现音乐'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('embedded 变体同样支持动作与图标', () => {
    const onAction = vi.fn();
    renderWithTheme(
      <EmptyState
        variant="embedded"
        icon={CircleAlert}
        title="搜索失败"
        actionLabel="重试"
        actionIcon={RefreshCw}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByText('重试'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('InlineError 的重试只触发一次', () => {
    const onRetry = vi.fn();
    renderWithTheme(<InlineError message="加载更多失败" onRetry={onRetry} />);
    expect(screen.getByText('加载更多失败')).toBeTruthy();
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
