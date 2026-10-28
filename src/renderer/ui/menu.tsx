import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import './overlay.css';

/** 菜单项：默认 menuitem；带 checked 时为 menuitemradio，带 pressed 时为切换型 menuitem。 */
export interface MenuItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** 单选菜单的选中态；传入即按 menuitemradio 渲染。 */
  checked?: boolean;
  /** 切换型菜单项的按下态（aria-pressed）。 */
  pressed?: boolean;
  /** 无障碍名；缺省取 label 的文本。 */
  ariaLabel?: string;
  onSelect?: () => void;
}

export type MenuPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

export interface MenuProps {
  open: boolean;
  /** 触发元素；菜单相对它定位，关闭时焦点也还给它。 */
  anchorRef: React.RefObject<HTMLElement | null>;
  items: MenuItem[];
  onClose: () => void;
  ariaLabel?: string;
  placement?: MenuPlacement;
  /** 打开时首焦点：默认第一项；ArrowUp 打开等场景可指定最后一项。 */
  initialFocus?: 'first' | 'last';
  className?: string;
  minWidth?: number;
}

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])';

/**
 * 共享 Menu 原语（#709）：统一首项聚焦、↑↓ 循环、Home/End、ESC/Tab 关闭与焦点归还。
 * 只负责菜单本体与键盘行为；定位用 fixed + 触发元素矩形，调用方不必再写一套。
 */
export const Menu: React.FC<MenuProps> = ({
  open,
  anchorRef,
  items,
  onClose,
  ariaLabel,
  placement = 'bottom-start',
  initialFocus = 'first',
  className,
  minWidth = 160,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', visibility: 'hidden' });

  const focusItem = useCallback((index: number) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? []);
    if (nodes.length === 0) return;
    const normalized = ((index % nodes.length) + nodes.length) % nodes.length;
    nodes[normalized]?.focus();
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    if (restoreFocus) anchorRef.current?.focus();
    onClose();
  }, [anchorRef, onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const gap = 6;
      const next: React.CSSProperties = { position: 'fixed', visibility: 'visible', minWidth };
      if (placement.startsWith('bottom')) next.top = rect.bottom + gap;
      else next.bottom = window.innerHeight - rect.top + gap;
      if (placement.endsWith('end')) next.right = window.innerWidth - rect.right;
      else next.left = rect.left;
      setStyle(next);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, placement, anchorRef, minWidth]);

  // 首焦点放在 layout effect：必须在菜单完成挂载、定位可见之前落焦，
  // 否则真实浏览器里点击触发按钮后的默认焦点会留在触发元素上。
  useLayoutEffect(() => {
    if (!open) return;
    const index = initialFocus === 'last' ? -1 : 0;
    focusItem(index);
    // 真实浏览器里鼠标点击的默认聚焦发生在 click 派发之后：下一拍再确认一次首焦点。
    const timer = window.setTimeout(() => focusItem(index), 0);
    return () => window.clearTimeout(timer);
  }, [open, focusItem, initialFocus]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Tab') {
        // Tab 是浏览器原生前进路径：只关菜单，不抢焦点回触发按钮。
        onClose();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, focusItem, close, onClose, anchorRef]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? []);
    if (nodes.length === 0) return;
    const currentIndex = nodes.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? nodes.length - 1 : currentIndex - 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = nodes.length - 1;
    else if (event.key === 'Tab') {
      // Tab 在菜单项之间移动；从最后一项再 Tab 才关闭，Shift+Tab 从首项退出。
      // 关闭那一拍把焦点还给 anchor：preventDefault 之后浏览器不会再推进焦点，菜单卸载后
      // 若不显式归还就会落到 body。
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        if (currentIndex <= 0) close(true);
        else focusItem(currentIndex - 1);
      } else if (currentIndex < 0 || currentIndex >= nodes.length - 1) {
        close(true);
      } else {
        focusItem(currentIndex + 1);
      }
      return;
    } else return;
    event.preventDefault();
    focusItem(nextIndex);
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      className={className ? 'ui-menu ' + className : 'ui-menu'}
      style={style}
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => {
        const isRadio = item.checked !== undefined;
        const role = isRadio ? 'menuitemradio' : 'menuitem';
        return (
          <button
            key={item.key}
            type="button"
            role={role}
            aria-checked={isRadio ? item.checked : undefined}
            aria-pressed={!isRadio && item.pressed !== undefined ? item.pressed : undefined}
            aria-label={item.ariaLabel}
            disabled={item.disabled}
            data-danger={item.danger || undefined}
            className="ui-menu__item"
            onClick={(event) => {
              event.stopPropagation();
              if (item.disabled) return;
              item.onSelect?.();
              close(true);
            }}
          >
            {item.icon ? <span className="ui-menu__icon" aria-hidden="true">{item.icon}</span> : null}
            <span className="ui-menu__label">{item.label}</span>
            {isRadio && item.checked ? <Check size={13} className="ui-menu__check" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
};
