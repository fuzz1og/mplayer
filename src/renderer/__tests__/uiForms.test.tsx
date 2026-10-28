import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Alert, Checkbox, Progress, Segmented, Stepper, Switch } from '@/renderer/ui';

describe('Switch', () => {
  it('暴露 switch 角色与 aria-checked，点击切换', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} ariaLabel="桌面通知" />);
    const control = screen.getByRole('switch', { name: '桌面通知' });
    expect(control).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('空格与 Enter 都只切换一次', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} ariaLabel="桌面通知" />);
    const control = screen.getByRole('switch', { name: '桌面通知' });
    control.focus();

    await userEvent.keyboard(' ');
    await userEvent.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, true);
    expect(onChange).toHaveBeenNthCalledWith(2, true);
  });

  it('禁用时不可切换', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} ariaLabel="禁用开关" disabled />);
    const control = screen.getByRole('switch', { name: '禁用开关' });
    expect(control).toBeDisabled();

    await userEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });
});

const SegmentedHarness: React.FC = () => {
  const [value, setValue] = useState('全部');
  return (
    <Segmented
      options={['全部', '歌曲', '专辑']}
      value={value}
      onChange={setValue}
      ariaLabel="资料库筛选"
    />
  );
};

describe('Segmented', () => {
  it('容器是 radiogroup，每段是带 aria-checked 的 radio', () => {
    render(<SegmentedHarness />);
    expect(screen.getByRole('radiogroup', { name: '资料库筛选' })).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('点击选中并回传值', async () => {
    render(<SegmentedHarness />);
    await userEvent.click(screen.getByRole('radio', { name: '专辑' }));
    expect(screen.getByRole('radio', { name: '专辑' })).toHaveAttribute('aria-checked', 'true');
  });

  it('左右方向键移动焦点并选中', async () => {
    render(<SegmentedHarness />);
    const first = screen.getByRole('radio', { name: '全部' });
    first.focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '歌曲' })).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '歌曲' }));

    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: '全部' })).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(first);
  });
});

describe('Progress', () => {
  it('progressbar 暴露当前值与固定区间', () => {
    render(<Progress value={42} label="缓存占用" ariaLabel="缓存占用" />);
    const bar = screen.getByRole('progressbar', { name: '缓存占用' });

    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('缓存占用')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('越界值与非法值收敛到 0-100', () => {
    const { rerender } = render(<Progress value={140} ariaLabel="缓存" />);
    expect(screen.getByRole('progressbar', { name: '缓存' })).toHaveAttribute('aria-valuenow', '100');

    rerender(<Progress value={-8} ariaLabel="缓存" />);
    expect(screen.getByRole('progressbar', { name: '缓存' })).toHaveAttribute('aria-valuenow', '0');

    rerender(<Progress value={Number.NaN} ariaLabel="缓存" />);
    expect(screen.getByRole('progressbar', { name: '缓存' })).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('Alert', () => {
  it('info 用 status，danger 用 alert', () => {
    render(
      <>
        <Alert tone="info" title="直连可用">
          当前源可直连。
        </Alert>
        <Alert tone="danger" title="解析失败">
          已自动跳歌。
        </Alert>
      </>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('直连可用');
    expect(screen.getByRole('alert')).toHaveTextContent('解析失败');
  });

  it('warning 也走 alert，action 可点击', async () => {
    const onRetry = vi.fn();
    render(
      <Alert
        tone="warning"
        title="延迟偏高"
        action={
          <button type="button" onClick={onRetry}>
            重试
          </button>
        }
      >
        建议切换解析源。
      </Alert>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('延迟偏高');
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

const CheckboxHarness: React.FC = () => {
  const [checked, setChecked] = useState(false);
  return <Checkbox checked={checked} onChange={setChecked} label="启用通知" />;
};

describe('Checkbox', () => {
  it('点击标签切换，键盘空格可切换', async () => {
    render(<CheckboxHarness />);
    const input = screen.getByRole('checkbox', { name: '启用通知' });
    expect(input).not.toBeChecked();

    await userEvent.click(screen.getByText('启用通知'));
    expect(input).toBeChecked();

    input.focus();
    await userEvent.keyboard(' ');
    expect(input).not.toBeChecked();
  });

  it('indeterminate 同步到原生属性', () => {
    render(<Checkbox checked={false} onChange={() => undefined} indeterminate ariaLabel="部分选中" />);
    const input = screen.getByRole('checkbox', { name: '部分选中' }) as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
  });

  it('禁用时不触发变更', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="禁用选项" disabled />);
    await userEvent.click(screen.getByText('禁用选项'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

const StepperHarness: React.FC = () => {
  const [value, setValue] = useState(50);
  return <Stepper label="音量" value={value} min={0} max={100} step={5} onChange={setValue} />;
};

describe('Stepper', () => {
  it('加减按步长更新中间数字', async () => {
    render(<StepperHarness />);
    expect(screen.getByText('50')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '增加音量' }));
    expect(screen.getByText('55')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '减少音量' }));
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('到边界禁用按钮，并把结果夹在区间内', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Stepper label="音量" value={0} min={0} max={100} step={5} onChange={onChange} />,
    );
    expect(screen.getByRole('button', { name: '减少音量' })).toBeDisabled();

    rerender(<Stepper label="音量" value={98} min={0} max={100} step={5} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: '增加音量' }));
    expect(onChange).toHaveBeenLastCalledWith(100);

    rerender(<Stepper label="音量" value={100} min={0} max={100} step={5} onChange={onChange} />);
    expect(screen.getByRole('button', { name: '增加音量' })).toBeDisabled();
  });
});
