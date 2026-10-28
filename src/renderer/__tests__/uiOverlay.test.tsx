import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, GridList, ToastProvider, useToast } from '@/renderer/ui';
import type { GridListColumn, ToastApi } from '@/renderer/ui';

afterEach(() => {
  cleanup();
});

const DialogHarness: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [open, setOpen] = React.useState(false);
  const close = () => {
    onClose();
    setOpen(false);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开对话框
      </button>
      <Dialog
        open={open}
        title="演示对话框"
        onClose={close}
        footer={
          <button type="button" onClick={close}>
            完成
          </button>
        }
      >
        <p>对话框正文</p>
      </Dialog>
    </>
  );
};

describe('Dialog', () => {
  it('打开后按 ESC 关闭，焦点归还触发按钮，标题由 aria-labelledby 关联', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);

    const trigger = screen.getByRole('button', { name: '打开对话框' });
    await user.click(trigger);

    const dialog = document.querySelector('dialog');
    expect(dialog).not.toBeNull();
    await waitFor(() => expect(dialog?.open).toBe(true));

    const title = screen.getByRole('heading', { name: '演示对话框' });
    expect(dialog?.getAttribute('aria-labelledby')).toBe(title.id);
    // 原生 modal 会把焦点移进 dialog；显式首焦点策略让 jsdom 与真实浏览器一致
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(dialog?.open).toBe(false));
    expect(trigger).toHaveFocus();
  });
});

const ToastHarness: React.FC<{ onReady: (api: ToastApi) => void }> = ({ onReady }) => {
  const api = useToast();
  React.useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return null;
};

function renderToastHarness(): { current: () => ToastApi } {
  let api: ToastApi | null = null;
  render(
    <ToastProvider>
      <ToastHarness
        onReady={(next) => {
          api = next;
        }}
      />
    </ToastProvider>,
  );
  return {
    current: () => {
      if (!api) throw new Error('ToastProvider 尚未就绪');
      return api;
    },
  };
}

describe('Dialog 键盘循环', () => {
  it('Tab / Shift+Tab 在对话框可聚焦元素之间循环', async () => {
    const user = userEvent.setup();
    render(<DialogHarness onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '打开对话框' }));
    const dialog = document.querySelector('dialog');
    await waitFor(() => expect(dialog?.open).toBe(true));

    const closeButton = screen.getByRole('button', { name: '关闭对话框' });
    const doneButton = screen.getByRole('button', { name: '完成' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(doneButton).toHaveFocus();

    fireEvent.keyDown(doneButton, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
  });
});

describe('Toast', () => {
  it('最多同时显示 3 条，关闭一条后排队中的下一条补位，容器可播报', async () => {
    const user = userEvent.setup();
    const toast = renderToastHarness();

    act(() => {
      toast.current().show('消息 1', { duration: 0 });
      toast.current().show('消息 2', { duration: 0 });
      toast.current().show('消息 3', { duration: 0 });
      toast.current().show('消息 4', { duration: 0 });
    });

    const viewport = screen.getByRole('status');
    expect(viewport).toHaveAttribute('aria-live', 'polite');

    expect(screen.getAllByText(/^消息 \d$/)).toHaveLength(3);
    expect(screen.getByText('消息 1')).toBeInTheDocument();
    expect(screen.getByText('消息 3')).toBeInTheDocument();
    expect(screen.queryByText('消息 4')).toBeNull();

    const closeButtons = screen.getAllByRole('button', { name: '关闭提示' });
    expect(closeButtons).toHaveLength(3);
    await user.click(closeButtons[0]);

    expect(screen.queryByText('消息 1')).toBeNull();
    expect(await screen.findByText('消息 4')).toBeInTheDocument();
    expect(screen.getAllByText(/^消息 \d$/)).toHaveLength(3);
  });

  it('到时自动消退', async () => {
    const toast = renderToastHarness();

    act(() => {
      toast.current().show('短暂提示', { duration: 30 });
    });
    expect(screen.getByText('短暂提示')).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText('短暂提示')).toBeNull());
  });

  it('脱离 ToastProvider 时给出明确错误而不是静默', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const BareConsumer: React.FC = () => {
      useToast();
      return null;
    };

    expect(() => render(<BareConsumer />)).toThrow(/ToastProvider/);
    consoleError.mockRestore();
  });
});

interface DemoTrack {
  id: number;
  name: string;
  artist: string;
  duration: string;
}

const demoColumns: GridListColumn<DemoTrack>[] = [
  { key: 'name', title: '歌名', render: (row) => row.name },
  { key: 'artist', title: '歌手', width: 120, render: (row) => row.artist },
  { key: 'duration', title: '时长', width: 80, align: 'right', render: (row) => row.duration },
];

const demoRows: DemoTrack[] = [
  { id: 1, name: '晴天', artist: '周杰伦', duration: '04:29' },
  { id: 2, name: '普通朋友', artist: '陶喆', duration: '04:14' },
  { id: 3, name: '富士山下', artist: '陈奕迅', duration: '04:19' },
];

describe('GridList', () => {
  it('渲染表头与行，点击行触发回调，空态显示文案', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const { rerender } = render(
      <GridList
        columns={demoColumns}
        rows={demoRows}
        rowKey={(row) => row.id}
        onRowClick={onRowClick}
        ariaLabel="歌曲网格"
      />,
    );

    expect(screen.getByRole('table', { name: '歌曲网格' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '歌名' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getByRole('cell', { name: '晴天' })).toBeInTheDocument();

    await user.click(screen.getByRole('cell', { name: '晴天' }));
    expect(onRowClick).toHaveBeenCalledWith(demoRows[0], 0);

    rerender(<GridList columns={demoColumns} rows={[]} rowKey={(row) => row.id} empty="还没有歌曲" />);

    expect(screen.getByText('还没有歌曲')).toBeInTheDocument();
    expect(screen.queryByText('晴天')).toBeNull();
  });
});
