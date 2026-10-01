// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 选择模式的两条操作条（#490）——真实挂载的交互测试。
 *
 * 环境说明：mobile 的 vitest 是 node env（全局 setup 只 mock AsyncStorage），
 * 本文件用 \`@vitest-environment jsdom\` 覆盖，并只在本文件内把 react-native 换成
 * react-native-web、mock 图标与「减弱动效」hook（与 __tests__/settingsSections.test.tsx 同款）。
 */
vi.mock('react-native', () => vi.importActual('react-native-web'));

vi.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { Download: Icon, Heart: Icon, ListMusic: Icon, Trash2: Icon };
});

vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));

import PlaylistSelectionBar from '../components/PlaylistSelectionBar';
import PlaylistBatchBar from '../components/PlaylistBatchBar';
import { ThemeProvider } from '../theme/ThemeProvider';

afterEach(cleanup);

describe('选择模式操作条（#490）', () => {
  it('顶部条：左完成 / 中已选 N 项 / 右全选，随是否全选切换文案', () => {
    const onExit = vi.fn();
    const onToggleAll = vi.fn();
    const view = () => (
      <ThemeProvider>
        <PlaylistSelectionBar count={3} allSelected={false} onExit={onExit} onToggleAll={onToggleAll} />
      </ThemeProvider>
    );
    const { rerender } = render(view());
    expect(screen.getByText('已选 3 项')).toBeTruthy();
    fireEvent.click(screen.getByText('全选'));
    expect(onToggleAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('完成'));
    expect(onExit).toHaveBeenCalledTimes(1);

    // 全选态：右按钮变「取消全选」，计数跟着走
    rerender(
      <ThemeProvider>
        <PlaylistSelectionBar count={5} allSelected onExit={onExit} onToggleAll={onToggleAll} />
      </ThemeProvider>,
    );
    expect(screen.getByText('已选 5 项')).toBeTruthy();
    expect(screen.getByText('取消全选')).toBeTruthy();
    fireEvent.click(screen.getByText('取消全选'));
    expect(onToggleAll).toHaveBeenCalledTimes(2);
  });

  it('底部条：加入歌单 / 下载 / 移除 / 收藏 四项各自回调（收藏独立成项）', () => {
    const onAddToPlaylist = vi.fn();
    const onDownload = vi.fn();
    const onRemove = vi.fn();
    const onFavorite = vi.fn();
    const view = (count: number) => (
      <ThemeProvider>
        <PlaylistBatchBar
          count={count}
          onAddToPlaylist={onAddToPlaylist}
          onDownload={onDownload}
          onRemove={onRemove}
          onFavorite={onFavorite}
        />
      </ThemeProvider>
    );
    render(view(2));
    for (const label of ['加入歌单', '下载', '移除', '收藏']) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
    fireEvent.click(screen.getByText('加入歌单'));
    fireEvent.click(screen.getByText('下载'));
    fireEvent.click(screen.getByText('移除'));
    fireEvent.click(screen.getByText('收藏'));
    expect(onAddToPlaylist).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onFavorite).toHaveBeenCalledTimes(1);
  });

  it('一行都没选时四个动作禁用（点了不产生空操作）', () => {
    const onRemove = vi.fn();
    render(
      <ThemeProvider>
        <PlaylistBatchBar
          count={0}
          onAddToPlaylist={vi.fn()}
          onDownload={vi.fn()}
          onRemove={onRemove}
          onFavorite={vi.fn()}
        />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('移除'));
    expect(onRemove).not.toHaveBeenCalled();
  });
});
