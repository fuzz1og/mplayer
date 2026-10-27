import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Group, IconButton, Input, Row, Section, Tag } from '@/renderer/ui';

describe('UI 原语', () => {
  describe('Button', () => {
    it('点击触发 onClick', async () => {
      const onClick = vi.fn();
      render(<Button onClick={onClick}>确定</Button>);
      await userEvent.click(screen.getByRole('button', { name: '确定' }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('禁用时不触发', async () => {
      const onClick = vi.fn();
      render(
        <Button disabled onClick={onClick}>
          确定
        </Button>,
      );
      await userEvent.click(screen.getByRole('button', { name: '确定' }));
      expect(onClick).not.toHaveBeenCalled();
    });

    it('图标按钮用 label 作为可访问名', () => {
      render(<IconButton label="关闭" icon={<span />} />);
      expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
    });
  });

  describe('Row', () => {
    it('可点击行是 button 角色，点击生效', async () => {
      const onClick = vi.fn();
      render(<Row label="缓存管理" onClick={onClick} />);
      await userEvent.click(screen.getByRole('button', { name: '缓存管理' }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('键盘 Enter 与空格等价点击', async () => {
      const onClick = vi.fn();
      render(<Row label="下载目录" onClick={onClick} />);
      const row = screen.getByRole('button', { name: '下载目录' });
      row.focus();
      await userEvent.keyboard('{Enter}');
      await userEvent.keyboard(' ');
      expect(onClick).toHaveBeenCalledTimes(2);
    });

    it('选中行暴露 aria-current', () => {
      render(<Row label="外观" selected onClick={() => undefined} />);
      expect(screen.getByRole('button', { name: '外观' }).getAttribute('aria-current')).toBe('true');
    });

    it('禁用行不再是按钮角色', () => {
      render(<Row label="诊断" disabled onClick={() => undefined} />);
      expect(screen.queryByRole('button', { name: '诊断' })).toBeNull();
    });

    it('带 trailing 控件时不把行本身变成按钮（避免控件嵌套）', () => {
      render(<Row label="通知" trailing={<Button>开</Button>} onClick={() => undefined} />);
      expect(screen.queryByRole('button', { name: '通知' })).toBeNull();
      expect(screen.getByRole('button', { name: '开' })).toBeTruthy();
    });
  });

  describe('Tag', () => {
    it('tone 决定样式类，默认 neutral 不带修饰类', () => {
      const { container } = render(
        <div>
          <Tag>默认</Tag>
          <Tag tone="success">可用</Tag>
        </div>,
      );
      const tags = container.querySelectorAll('.ui-tag');
      expect(tags[0].className).toBe('ui-tag');
      expect(tags[1].className).toContain('ui-tag--success');
    });
  });

  describe('Input', () => {
    it('可输入并回传值', async () => {
      const onChange = vi.fn();
      render(<Input aria-label="搜索" placeholder="搜索" onChange={onChange} />);
      await userEvent.type(screen.getByLabelText('搜索'), '周杰伦');
      expect(onChange).toHaveBeenCalled();
      expect((screen.getByLabelText('搜索') as HTMLInputElement).value).toBe('周杰伦');
    });
  });

  describe('Section / Group', () => {
    it('分区渲染标题与脚注', () => {
      render(
        <Section title="通用" footer="说明文字">
          <Group>
            <Row label="外观" />
          </Group>
        </Section>,
      );
      expect(screen.getByText('通用')).toBeTruthy();
      expect(screen.getByText('说明文字')).toBeTruthy();
      expect(screen.getByText('外观')).toBeTruthy();
    });
  });
});
