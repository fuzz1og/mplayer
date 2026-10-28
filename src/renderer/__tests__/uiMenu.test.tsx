import React, { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Menu } from '@/renderer/ui';
import type { MenuItem } from '@/renderer/ui';

afterEach(() => cleanup());

const items: MenuItem[] = [
  { key: 'one', label: '第一项', onSelect: vi.fn() },
  { key: 'two', label: '第二项', disabled: true },
  { key: 'three', label: '第三项', onSelect: vi.fn() },
];

const MenuHarness: React.FC<{ onSelect?: (key: string) => void }> = ({ onSelect }) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItems = items.map((item) => ({
    ...item,
    onSelect: item.onSelect ? () => { item.onSelect?.(); onSelect?.(item.key); } : undefined,
  }));
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        打开菜单
      </button>
      <button type="button">菜单外按钮</button>
      <Menu
        open={open}
        anchorRef={triggerRef}
        items={menuItems}
        onClose={() => setOpen(false)}
        ariaLabel="测试菜单"
      />
    </>
  );
};

describe('Menu 原语', () => {
  it('打开后首项聚焦，方向键在可用项之间循环，Home/End 到首末项', () => {
    render(<MenuHarness />);
    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }));
    const one = screen.getByRole('menuitem', { name: '第一项' });
    const three = screen.getByRole('menuitem', { name: '第三项' });
    expect(one).toHaveFocus();

    fireEvent.keyDown(one, { key: 'ArrowDown' });
    expect(three).toHaveFocus();
    fireEvent.keyDown(three, { key: 'ArrowDown' });
    expect(one).toHaveFocus();
    fireEvent.keyDown(one, { key: 'ArrowUp' });
    expect(three).toHaveFocus();

    fireEvent.keyDown(three, { key: 'Home' });
    expect(one).toHaveFocus();
    fireEvent.keyDown(one, { key: 'End' });
    expect(three).toHaveFocus();
  });

  it('ESC 关闭并把焦点归还触发按钮', () => {
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '打开菜单' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: '测试菜单' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '测试菜单' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('Tab 关闭菜单（不拦截浏览器焦点移动）', () => {
    render(<MenuHarness />);
    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }));
    fireEvent.keyDown(screen.getByRole('menuitem', { name: '第一项' }), { key: 'Tab' });
    expect(screen.queryByRole('menu', { name: '测试菜单' })).toBeNull();
  });

  it('选择菜单项后关闭并把焦点归还触发按钮', () => {
    const onSelect = vi.fn();
    render(<MenuHarness onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: '打开菜单' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '第三项' }));
    expect(onSelect).toHaveBeenCalledWith('three');
    expect(screen.queryByRole('menu', { name: '测试菜单' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('点击菜单外部关闭', () => {
    render(<MenuHarness />);
    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu', { name: '测试菜单' })).toBeNull();
  });

  it('表面语义：菜单用 material-overlay + radius-md，Dialog 用 radius-xl', () => {
    const testDir = dirname(fileURLToPath(String(import.meta.url)));
    const css = readFileSync(join(testDir, '..', 'ui', 'overlay.css'), 'utf8');
    expect(css).toMatch(/\.ui-menu\s*\{[^}]*background:\s*var\(--material-overlay\)/s);
    expect(css).toMatch(/\.ui-menu\s*\{[^}]*border-radius:\s*var\(--radius-md\)/s);
    expect(css).toMatch(/\.ui-dialog\s*\{[^}]*border-radius:\s*var\(--radius-xl\)/s);
  });
});
